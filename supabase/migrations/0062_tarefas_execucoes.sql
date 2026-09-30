-- 0062_tarefas_execucoes.sql
-- FOLHA DE PAGAMENTO > TAREFAS -- execucoes reais por ocorrencia (ate 2)
-- e fim do bloqueio de conclusao em data futura.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
-- Pre-requisito: 0061 APLICADA (e Outubro/2026 ja programado -- esta
-- migration e incremental e compativel com as ocorrencias existentes).
--
-- ============================================================
-- DIAGNOSTICO (0061)
-- ============================================================
--   A conclusao vive em 3 colunas da propria ocorrencia: concluida,
--   concluido_em, concluido_por -- sem nome de quem executou e com no
--   maximo 1 conclusao. concluida sustenta regras da 0061 que NAO mudam:
--   o plano de sincronizacao (ocorrencia "intocada"), cancelar_ocorrencia_
--   tarefa, excluir_ocorrencia_avulsa_tarefa e as constraints
--   tarefas_ocorrencias_conclusao_coerente/_cancelada_nao_concluida.
--
-- ============================================================
-- ARQUITETURA
-- ============================================================
--   * Nova tabela FILHA public.tarefas_ocorrencias_execucoes: 0, 1 ou 2
--     execucoes por ocorrencia, cada uma com nome LIVRE e OBRIGATORIO (sem
--     FK para funcionarios; NOT NULL + CHECK sem vazio/espacos, ate 60
--     caracteres), quem registrou e quando. Limite estrutural: ordem
--     IN (1,2) + UNIQUE (ocorrencia_id, ordem) -- uma 3a execucao e
--     impossivel pela estrutura, nao so pela RPC.
--   * A ocorrencia continua UNICA. posicao_programada, posicao,
--     responsavel_nome (nome materializado da PROGRAMACAO) e
--     responsavel_avulso nao sao tocados por execucoes.
--   * concluida/concluido_em/concluido_por da ocorrencia passam a ser um
--     ESPELHO mantido por trigger: concluida = existe >= 1 execucao;
--     concluido_em/_por = da execucao mais antiga. Assim TODA a logica da
--     0061 (plano, cancelamento, avulsa, constraints) continua valendo sem
--     nenhuma alteracao.
--   * Status: 0 execucoes = Pendente; >= 1 = Concluida (a 2a e registro
--     adicional permitido, nunca exigido).
--   * Conclusao em data FUTURA passa a ser permitida (antecipacao).
--     Continua proibido: registrar execucao em ocorrencia cancelada.
--
-- ============================================================
-- COMPATIBILIDADE (ocorrencias ja materializadas)
-- ============================================================
--   Nenhuma ocorrencia e apagada, recriada ou reprogramada. Cada
--   ocorrencia ja concluida pela 0061 ganha UMA execucao (ordem 1,
--   responsavel_nome = 'NÃO INFORMADO' -- marcador LEGADO/sistemico, em
--   maiusculas; concluido_em/_por copiados). Execucoes NOVAS sempre exigem
--   o nome real de quem executou.
--   Idempotente: so para concluidas sem execucao + ON CONFLICT ON
--   CONSTRAINT. O trigger-espelho so escreve quando algo difere -- como os
--   valores copiados sao iguais, as ocorrencias migradas nao sao tocadas.
--
-- ESCOPO: 1 tabela + 3 triggers + 3 RPCs novas (registrar/remover/
-- renomear execucao) + marcar_conclusao_tarefa redefinida com a MESMA
-- assinatura (true agora e recusado: execucao nova exige nome -> use
-- registrar_execucao_tarefa; false remove todas) + 1 funcao interna +
-- migracao das conclusoes existentes + correcao de
-- tarefas_normalizar_texto (secao 0: espacos em branco nas pontas).
-- NAO altera: tabelas/colunas da 0061, motor de distribuicao, grupos,
-- regras, permissoes (usa tarefas.concluir / tarefas.visualizar).

BEGIN;

-- ============================================================
-- 0. Correcao da funcao interna de normalizacao (0061)
-- ============================================================
-- A versao da 0061 fazia btrim (so ESPACO) antes de colapsar \s+: um texto
-- so de tabulacao/quebra de linha virava ' ' em vez de NULL e escapava da
-- validacao "obrigatorio" das RPCs (caia depois na CHECK constraint, com
-- mensagem tecnica). Agora colapsa TODO espaco em branco primeiro e so
-- depois apara. Mesma assinatura/retorno; grants inalterados (CREATE OR
-- REPLACE preserva o REVOKE da 0061). Resultado identico para qualquer
-- texto sem tab/quebra de linha nas pontas.
create or replace function public.tarefas_normalizar_texto(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')), '')
$$;

-- ============================================================
-- 1. Tabela de execucoes
-- ============================================================
create table if not exists public.tarefas_ocorrencias_execucoes (
  id               uuid primary key default gen_random_uuid(),
  ocorrencia_id    uuid not null references public.tarefas_ocorrencias(id) on delete restrict,
  ordem            smallint not null,
  responsavel_nome text not null,
  concluido_por    uuid references auth.users(id) on delete set null,
  concluido_em     timestamptz not null,

  criado_por       uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_por   uuid references auth.users(id) on delete set null,
  atualizado_em    timestamptz,

  constraint tarefas_execucoes_ordem_valida check (ordem between 1 and 2),
  constraint tarefas_execucoes_ocorrencia_ordem_unica unique (ocorrencia_id, ordem),
  constraint tarefas_execucoes_nome_valido
    check (responsavel_nome = btrim(responsavel_nome) and responsavel_nome <> '' and char_length(responsavel_nome) <= 60)
);

comment on table public.tarefas_ocorrencias_execucoes is
  'Execucoes REAIS de uma ocorrencia de Tarefas (0062): no maximo 2 (ordem 1..2, UNIQUE por ocorrencia), cada uma com o nome LIVRE de quem executou (sem vinculo com funcionarios; OBRIGATORIO -- ''NÃO INFORMADO'' so para conclusoes legadas migradas da 0061). Nao confundir com tarefas_ocorrencias.responsavel_nome (nome da POSICAO programada). A ocorrencia fica concluida com >= 1 execucao (espelho mantido por trigger). Escrita somente via RPC.';

comment on column public.tarefas_ocorrencias_execucoes.ordem is
  'Vaga 1 ou 2 (nao e manha/tarde): a 1a vaga livre e usada no registro. Garante no maximo 2 execucoes por ocorrencia pela estrutura.';

-- ============================================================
-- 2. Triggers
-- ============================================================
drop trigger if exists tarefas_execucoes_auditoria_trigger on public.tarefas_ocorrencias_execucoes;
create trigger tarefas_execucoes_auditoria_trigger
  before insert or update on public.tarefas_ocorrencias_execucoes
  for each row execute function public.tarefas_auditoria();

-- So o nome pode ser corrigido; o resto da execucao e fato registrado.
create or replace function public.tarefas_execucoes_protecao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ocorrencia_id is distinct from old.ocorrencia_id
     or new.ordem is distinct from old.ordem
     or new.concluido_em is distinct from old.concluido_em
     or new.concluido_por is distinct from old.concluido_por then
    raise exception 'tarefas_ocorrencias_execucoes: ocorrencia_id, ordem, concluido_em e concluido_por sao imutaveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists tarefas_execucoes_protecao_trigger on public.tarefas_ocorrencias_execucoes;
create trigger tarefas_execucoes_protecao_trigger
  before update on public.tarefas_ocorrencias_execucoes
  for each row execute function public.tarefas_execucoes_protecao();

-- Espelho na ocorrencia: concluida = existe execucao; concluido_em/_por =
-- da execucao mais antiga. So escreve quando algum valor difere.
create or replace function public.tarefas_execucoes_espelhar_ocorrencia()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ocorrencia_id uuid;
  v_em            timestamptz;
  v_por           uuid;
begin
  if tg_op = 'DELETE' then
    v_ocorrencia_id := old.ocorrencia_id;
  else
    v_ocorrencia_id := new.ocorrencia_id;
  end if;

  select e.concluido_em, e.concluido_por
    into v_em, v_por
  from public.tarefas_ocorrencias_execucoes as e
  where e.ocorrencia_id = v_ocorrencia_id
  order by e.concluido_em, e.ordem
  limit 1;

  update public.tarefas_ocorrencias as o
     set concluida = (v_em is not null),
         concluido_em = v_em,
         concluido_por = v_por
   where o.id = v_ocorrencia_id
     and (o.concluida, o.concluido_em, o.concluido_por) is distinct from ((v_em is not null), v_em, v_por);

  return null;
end;
$$;

comment on function public.tarefas_execucoes_espelhar_ocorrencia() is
  'AFTER INSERT/DELETE em tarefas_ocorrencias_execucoes (0062): mantem concluida/concluido_em/concluido_por da ocorrencia como espelho das execucoes (>= 1 execucao = concluida). Preserva toda a logica da 0061 que depende de concluida.';

drop trigger if exists tarefas_execucoes_espelho_trigger on public.tarefas_ocorrencias_execucoes;
create trigger tarefas_execucoes_espelho_trigger
  after insert or delete on public.tarefas_ocorrencias_execucoes
  for each row execute function public.tarefas_execucoes_espelhar_ocorrencia();

revoke execute on function public.tarefas_execucoes_protecao() from public;
revoke execute on function public.tarefas_execucoes_espelhar_ocorrencia() from public;

-- ============================================================
-- 3. RLS -- leitura por tarefas.visualizar; sem policy de escrita.
-- ============================================================
alter table public.tarefas_ocorrencias_execucoes enable row level security;

drop policy if exists tarefas_ocorrencias_execucoes_select on public.tarefas_ocorrencias_execucoes;
create policy tarefas_ocorrencias_execucoes_select on public.tarefas_ocorrencias_execucoes
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

-- ============================================================
-- 4. Funcao interna: ocorrencia + execucoes (retorno das RPCs)
-- ============================================================
create or replace function public.tarefas_ocorrencia_com_execucoes(p_ocorrencia_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ocorrencia', to_jsonb(o),
    'execucoes', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.concluido_em, e.ordem)
      from public.tarefas_ocorrencias_execucoes as e
      where e.ocorrencia_id = o.id
    ), '[]'::jsonb)
  )
  from public.tarefas_ocorrencias as o
  where o.id = p_ocorrencia_id
$$;

revoke execute on function public.tarefas_ocorrencia_com_execucoes(uuid) from public, anon, authenticated, service_role;

-- ============================================================
-- 5. RPCs (tarefas.concluir -- nunca exigem/concedem tarefas.editar)
-- ============================================================

-- 5.1 Registrar execucao (1a ou 2a). Permitido em data futura.
create or replace function public.registrar_execucao_tarefa(
  p_ocorrencia_id    uuid,
  p_responsavel_nome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
  v_nome       text := public.tarefas_normalizar_texto(p_responsavel_nome);
  v_ordem      smallint;
  v_execucao   public.tarefas_ocorrencias_execucoes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'registrar_execucao_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.concluir')) then
    raise exception using errcode = '42501', message = 'registrar_execucao_tarefa: requer a permissao tarefas.concluir.';
  end if;
  if v_nome is null then
    raise exception 'registrar_execucao_tarefa: informe o nome de quem executou.';
  end if;
  if char_length(v_nome) > 60 then
    raise exception 'registrar_execucao_tarefa: o nome pode ter no maximo 60 caracteres.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'registrar_execucao_tarefa: ocorrencia nao encontrada.';
  end if;
  if v_ocorrencia.cancelada then
    raise exception 'registrar_execucao_tarefa: ocorrencia cancelada nao pode ser concluida.';
  end if;

  select vaga.ordem into v_ordem
  from (values (1::smallint), (2::smallint)) as vaga(ordem)
  where not exists (
    select 1 from public.tarefas_ocorrencias_execucoes as e
    where e.ocorrencia_id = p_ocorrencia_id and e.ordem = vaga.ordem
  )
  order by vaga.ordem
  limit 1;

  if v_ordem is null then
    raise exception 'registrar_execucao_tarefa: esta ocorrencia ja tem 2 execucoes registradas (maximo).';
  end if;

  insert into public.tarefas_ocorrencias_execucoes (ocorrencia_id, ordem, responsavel_nome, concluido_por, concluido_em)
  values (p_ocorrencia_id, v_ordem, v_nome, auth.uid(), now())
  returning * into v_execucao;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('tarefa_execucao', v_execucao.id::text, 'registrou', 'execucao', null,
          format('ocorrencia=%s; data=%s; ordem=%s; nome=%s', p_ocorrencia_id, v_ocorrencia.data, v_ordem, v_nome));

  return public.tarefas_ocorrencia_com_execucoes(p_ocorrencia_id);
end;
$$;

comment on function public.registrar_execucao_tarefa(uuid, text) is
  'Registra uma execucao real numa ocorrencia (0062) com o nome OBRIGATORIO de quem executou (livre, trim, 1..60): usa a 1a vaga livre (1 ou 2); recusa a 3a e ocorrencia cancelada. Data futura permitida. Nao altera posicao/responsavel da programacao. Trava a ocorrencia (FOR UPDATE), registra em logs_auditoria e devolve {ocorrencia, execucoes}. Exige tarefas.concluir.';

-- 5.2 Remover UMA execucao (as demais permanecem).
create or replace function public.remover_execucao_tarefa(p_execucao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia_id uuid;
  v_execucao      public.tarefas_ocorrencias_execucoes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'remover_execucao_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.concluir')) then
    raise exception using errcode = '42501', message = 'remover_execucao_tarefa: requer a permissao tarefas.concluir.';
  end if;

  select e.ocorrencia_id into v_ocorrencia_id
  from public.tarefas_ocorrencias_execucoes as e
  where e.id = p_execucao_id;
  if v_ocorrencia_id is null then
    raise exception 'remover_execucao_tarefa: execucao nao encontrada.';
  end if;

  -- Mesma ordem de lock de registrar_execucao_tarefa: ocorrencia primeiro.
  perform 1 from public.tarefas_ocorrencias as o where o.id = v_ocorrencia_id for update;

  select * into v_execucao
  from public.tarefas_ocorrencias_execucoes as e
  where e.id = p_execucao_id
  for update;
  if v_execucao.id is null then
    raise exception 'remover_execucao_tarefa: execucao nao encontrada.';
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('tarefa_execucao', v_execucao.id::text, 'removeu', 'execucao',
          format('ocorrencia=%s; ordem=%s; nome=%s; concluido_em=%s; concluido_por=%s',
                 v_execucao.ocorrencia_id, v_execucao.ordem, v_execucao.responsavel_nome,
                 v_execucao.concluido_em, coalesce(v_execucao.concluido_por::text, '-')),
          null);

  delete from public.tarefas_ocorrencias_execucoes as e where e.id = p_execucao_id;

  return public.tarefas_ocorrencia_com_execucoes(v_ocorrencia_id);
end;
$$;

comment on function public.remover_execucao_tarefa(uuid) is
  'Remove UMA execucao registrada (0062), mantendo as demais; sem execucoes a ocorrencia volta a Pendente (espelho). Snapshot completo em logs_auditoria antes da remocao. Exige tarefas.concluir.';

-- 5.3 Corrigir o nome de uma execucao.
create or replace function public.renomear_execucao_tarefa(p_execucao_id uuid, p_responsavel_nome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome          text := public.tarefas_normalizar_texto(p_responsavel_nome);
  v_ocorrencia_id uuid;
  v_execucao      public.tarefas_ocorrencias_execucoes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'renomear_execucao_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.concluir')) then
    raise exception using errcode = '42501', message = 'renomear_execucao_tarefa: requer a permissao tarefas.concluir.';
  end if;
  if v_nome is null then
    raise exception 'renomear_execucao_tarefa: informe o nome de quem executou.';
  end if;
  if char_length(v_nome) > 60 then
    raise exception 'renomear_execucao_tarefa: o nome pode ter no maximo 60 caracteres.';
  end if;

  select e.ocorrencia_id into v_ocorrencia_id
  from public.tarefas_ocorrencias_execucoes as e
  where e.id = p_execucao_id;
  if v_ocorrencia_id is null then
    raise exception 'renomear_execucao_tarefa: execucao nao encontrada.';
  end if;

  perform 1 from public.tarefas_ocorrencias as o where o.id = v_ocorrencia_id for update;

  select * into v_execucao
  from public.tarefas_ocorrencias_execucoes as e
  where e.id = p_execucao_id
  for update;
  if v_execucao.id is null then
    raise exception 'renomear_execucao_tarefa: execucao nao encontrada.';
  end if;

  if v_execucao.responsavel_nome is distinct from v_nome then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('tarefa_execucao', v_execucao.id::text, 'renomeou', 'responsavel_nome',
            v_execucao.responsavel_nome, v_nome);

    update public.tarefas_ocorrencias_execucoes as e
       set responsavel_nome = v_nome
     where e.id = p_execucao_id;
  end if;

  return public.tarefas_ocorrencia_com_execucoes(v_ocorrencia_id);
end;
$$;

comment on function public.renomear_execucao_tarefa(uuid, text) is
  'Corrige o nome livre de quem executou (0062) -- nunca vazio (trim, 1..60). Registra antes/depois em logs_auditoria. Exige tarefas.concluir.';

-- 5.4 marcar_conclusao_tarefa -- MESMA assinatura da 0061 (compatibilidade):
--   true : RECUSADO se nao ha execucao -- execucao nova exige o nome de
--          quem executou (use registrar_execucao_tarefa, que a tela usa);
--          idempotente se a ocorrencia ja esta concluida;
--   false: remove TODAS as execucoes (snapshot em logs_auditoria).
--   O bloqueio de data futura da 0061 deixa de existir.
create or replace function public.marcar_conclusao_tarefa(p_ocorrencia_id uuid, p_concluida boolean)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
  v_execucoes  text;
begin
  if auth.uid() is null then
    raise exception 'marcar_conclusao_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.concluir')) then
    raise exception using errcode = '42501', message = 'marcar_conclusao_tarefa: requer a permissao tarefas.concluir.';
  end if;
  if p_concluida is null then
    raise exception 'marcar_conclusao_tarefa: informe se a ocorrencia esta concluida.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'marcar_conclusao_tarefa: ocorrencia nao encontrada.';
  end if;

  if p_concluida then
    if v_ocorrencia.cancelada then
      raise exception 'marcar_conclusao_tarefa: ocorrencia cancelada nao pode ser concluida.';
    end if;
    if not exists (select 1 from public.tarefas_ocorrencias_execucoes as e where e.ocorrencia_id = p_ocorrencia_id) then
      raise exception 'marcar_conclusao_tarefa: informe o nome de quem executou -- use registrar_execucao_tarefa.';
    end if;
  else
    select string_agg(format('ordem=%s nome=%s em=%s por=%s', e.ordem, e.responsavel_nome, e.concluido_em, coalesce(e.concluido_por::text, '-')), ' | ' order by e.ordem)
      into v_execucoes
    from public.tarefas_ocorrencias_execucoes as e
    where e.ocorrencia_id = p_ocorrencia_id;

    if v_execucoes is not null then
      insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
      values ('tarefa_ocorrencia', p_ocorrencia_id::text, 'desmarcou_conclusao', 'execucoes', v_execucoes, 'pendente');

      delete from public.tarefas_ocorrencias_execucoes as e where e.ocorrencia_id = p_ocorrencia_id;
    end if;
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id;
  return v_ocorrencia;
end;
$$;

comment on function public.marcar_conclusao_tarefa(uuid, boolean) is
  'Compatibilidade (0061 -> 0062): true e RECUSADO se nao houver execucao (execucao nova exige nome -> registrar_execucao_tarefa) e idempotente se ja concluida; false remove todas as execucoes (snapshot em logs_auditoria). SEM bloqueio de data futura desde a 0062. Recusa cancelada. Exige SOMENTE tarefas.concluir.';

-- ============================================================
-- 6. Grants
-- ============================================================
revoke execute on function public.registrar_execucao_tarefa(uuid, text) from public, anon, service_role;
revoke execute on function public.remover_execucao_tarefa(uuid) from public, anon, service_role;
revoke execute on function public.renomear_execucao_tarefa(uuid, text) from public, anon, service_role;
revoke execute on function public.marcar_conclusao_tarefa(uuid, boolean) from public, anon, service_role;

grant execute on function public.registrar_execucao_tarefa(uuid, text) to authenticated;
grant execute on function public.remover_execucao_tarefa(uuid) to authenticated;
grant execute on function public.renomear_execucao_tarefa(uuid, text) to authenticated;
grant execute on function public.marcar_conclusao_tarefa(uuid, boolean) to authenticated;

-- ============================================================
-- 7. Migracao das conclusoes ja registradas pela 0061
-- ============================================================
-- Cada ocorrencia concluida SEM execucao ganha a execucao 1 com os mesmos
-- concluido_em/concluido_por e o marcador LEGADO 'NÃO INFORMADO' (a 0061
-- nunca registrou quem executou). Idempotente.
insert into public.tarefas_ocorrencias_execucoes (ocorrencia_id, ordem, responsavel_nome, concluido_por, concluido_em)
select o.id, 1::smallint, 'NÃO INFORMADO', o.concluido_por, o.concluido_em
from public.tarefas_ocorrencias as o
where o.concluida
  and o.concluido_em is not null
  and not exists (
    select 1 from public.tarefas_ocorrencias_execucoes as e where e.ocorrencia_id = o.id
  )
on conflict on constraint tarefas_execucoes_ocorrencia_ordem_unica do nothing;

COMMIT;

-- ============================================================
-- ROLLBACK (manual). ATENCAO: apaga os NOMES das execucoes. A conclusao
-- (concluida/concluido_em/concluido_por) continua na ocorrencia, mas a
-- 0061 original volta a bloquear conclusao em data futura.
-- ============================================================
-- BEGIN;
-- drop function if exists public.renomear_execucao_tarefa(uuid, text);
-- drop function if exists public.remover_execucao_tarefa(uuid);
-- drop function if exists public.registrar_execucao_tarefa(uuid, text);
-- drop function if exists public.tarefas_ocorrencia_com_execucoes(uuid);
-- drop table if exists public.tarefas_ocorrencias_execucoes;
-- drop function if exists public.tarefas_execucoes_espelhar_ocorrencia();
-- drop function if exists public.tarefas_execucoes_protecao();
-- -- e reaplicar a secao 7.9 (marcar_conclusao_tarefa) da 0061.
-- COMMIT;
