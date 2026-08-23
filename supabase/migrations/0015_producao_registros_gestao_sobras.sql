-- 0015_producao_registros_gestao_sobras.sql
-- Revisão da regra funcional de sobras de producao_registros: permite
-- fechar um turno manual só com sobra_total (classificação em
-- sobra_aproveitavel/perda_descarte vira opcional e pode ser complementada
-- depois, com o registro já fechado), permite classificação PARCIAL
-- (sobra_aproveitavel + perda_descarte <= sobra_total, sobra restante fica
-- "não classificada", calculada em runtime, sem coluna nova), e permite
-- que um administrador complemente essa classificação posteriormente
-- também em registros origem='historico' (a planilha antiga nunca teve
-- esse dado — não inventamos nada na importação — mas isso não impede o
-- usuário de complementar quando souber o destino real depois).
--
-- Introduz uma nova ação "gerenciar sobras": edita sobra_total/
-- sobra_aproveitavel/perda_descarte (e recalcula quantidade_vendida só
-- para origem='manual') com o registro já 'fechado', SEM passar pela
-- reabertura formal — reabertura continua exclusiva para os campos
-- estruturais (quantidade_produzida, receita_id, data, turno,
-- custo_producao).
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rode manualmente no SQL Editor do
-- Supabase, depois de 0010, 0011 e 0004 (logs_auditoria), já aplicadas.
--
-- ESCOPO — SOMENTE:
--   * 2 CHECK constraints substituídas + 1 CHECK constraint removida em
--     public.producao_registros;
--   * a função da trigger public.producao_registros_protecao substituída
--     (CREATE OR REPLACE — mesmo nome, mesma trigger já instalada por
--     0010, não recriamos a trigger em si);
--   * 1 função RPC nova: public.gerenciar_sobras_producao_registro(...).
-- Esta migration NÃO faz: nenhuma coluna nova, nenhuma tabela nova,
-- nenhuma alteração de RLS/policies (as policies de producao_registros
-- continuam exatamente as de 0010), nenhum INSERT/UPDATE/DELETE de dado
-- de negócio, nenhuma alteração em fornecedores/receitas/produtos.
--
-- Retrocompatibilidade das 2 CHECKs substituídas: ambas as novas versões
-- são estritamente MAIS PERMISSIVAS que as atuais (menos campos
-- obrigatórios; "=" virou "<=") — qualquer linha que já satisfaz a
-- constraint atual automaticamente satisfaz a nova. Aplicadas já como
-- VALID, sem necessidade de validação retroativa adiada (mesmo raciocínio
-- de 0012/0013). Confirmar com as consultas de auditoria pré-migration
-- anexadas à parte antes de rodar.
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão.

BEGIN;

-- ============================================================
-- 1. CHECK removida: histórico deixa de ser proibido de receber
--    classificação de sobra posteriormente.
-- ============================================================
-- A regra de negócio de NÃO INVENTAR dado na importação continua valendo
-- (nenhuma migration jamais popula sobra_aproveitavel/perda_descarte para
-- os registros históricos existentes) — o que muda é só que um
-- administrador agora PODE complementar essa informação depois, via
-- public.gerenciar_sobras_producao_registro, quando souber o destino real.

alter table public.producao_registros
  drop constraint if exists producao_registros_historico_sem_classificacao;


-- ============================================================
-- 2. CHECK substituída: fechamento manual não exige mais classificação
--    completa, só sobra_total (Cenário A: fechar sabendo só a sobra
--    total, classificar depois).
-- ============================================================

alter table public.producao_registros
  drop constraint if exists producao_registros_campos_fechamento_obrigatorios_manual;

alter table public.producao_registros
  add constraint producao_registros_campos_fechamento_obrigatorios_manual
  check (
    origem <> 'manual' or status <> 'fechado'
    or (quantidade_vendida is not null and sobra_total is not null)
  );


-- ============================================================
-- 3. CHECK substituída: soma da classificação pode ser MENOR que
--    sobra_total (classificação parcial), nunca maior. Regra passa a
--    valer sempre que sobra_total estiver preenchido, independente de
--    status — sobra pode ser gerenciada com o registro já fechado.
-- ============================================================

alter table public.producao_registros
  drop constraint if exists producao_registros_soma_sobra;

alter table public.producao_registros
  add constraint producao_registros_soma_sobra
  check (
    sobra_total is null
    or (coalesce(sobra_aproveitavel, 0) + coalesce(perda_descarte, 0)) <= sobra_total
  );


-- ============================================================
-- 4. Trigger public.producao_registros_protecao — substituída
-- ============================================================
-- Mesma trigger (drop/create trigger NÃO refeito, só a função é
-- substituída via CREATE OR REPLACE — a trigger já instalada por 0010
-- continua apontando para esta função). Muda só o ramo fechado->fechado:
-- separa "campos protegidos" (quantidade_produzida/receita_id/data/
-- turno/custo_producao — só mudam via reabertura formal, comportamento
-- IDÊNTICO ao anterior) de "campos de sobra" (sobra_total/
-- sobra_aproveitavel/perda_descarte/quantidade_vendida — agora podem
-- mudar com o registro ainda fechado). Para origem='manual', a policy
-- producao_registros_update (has_permissao('producao.editar')) já é
-- suficiente e não precisa ser reafirmada aqui. Para origem='historico',
-- a RLS sozinha NÃO é suficiente (ela só exige producao.editar, igual
-- para os dois casos) — por isso a checagem extra abaixo, só para
-- histórico, exigindo administrador.

create or replace function public.producao_registros_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campos_protegidos_alterados boolean;
  v_campos_sobra_alterados boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'reaberto' then
      raise exception
        'producao_registros: nao e permitido inserir um registro diretamente com status = reaberto.';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' a partir daqui.

  if new.origem <> old.origem then
    raise exception
      'producao_registros: origem e imutavel apos o INSERT (registro %).', old.id;
  end if;

  if new.status = 'aberto' and old.status <> 'aberto' then
    raise exception
      'producao_registros: nao e permitido voltar o registro % para o status aberto.', old.id;
  end if;

  if new.status = 'reaberto' and old.status not in ('fechado', 'reaberto') then
    raise exception
      'producao_registros: so e possivel reabrir um registro que esteja fechado (registro %).', old.id;
  end if;

  -- campos protegidos: só mudam via reabertura formal.
  v_campos_protegidos_alterados :=
    new.quantidade_produzida <> old.quantidade_produzida
    or new.receita_id <> old.receita_id
    or new.data <> old.data
    or new.turno <> old.turno
    or new.custo_producao is distinct from old.custo_producao;

  -- campos de sobra: podem mudar com o registro fechado, via a nova ação
  -- "gerenciar sobras" (gate de permissão feito mais abaixo).
  v_campos_sobra_alterados :=
    new.quantidade_vendida is distinct from old.quantidade_vendida
    or new.sobra_total is distinct from old.sobra_total
    or new.sobra_aproveitavel is distinct from old.sobra_aproveitavel
    or new.perda_descarte is distinct from old.perda_descarte;

  if old.status = 'fechado' and new.status = 'reaberto' then
    if new.origem = 'historico' then
      if not (select public.is_admin()) then
        raise exception
          'producao_registros: reabertura de registro historico (%) requer administrador (procedimento extraordinario).', old.id;
      end if;
    else
      if not (select public.has_permissao('producao.cancelar')) then
        raise exception
          'producao_registros: reabertura do registro % requer a permissao producao.cancelar.', old.id;
      end if;
    end if;

    -- separacao atomica: o UPDATE de reabertura em si nao corrige dado
    -- nenhum (nem estrutural, nem de sobra), so muda o status (e, se
    -- quiser, atualizado_em/observacoes).
    if v_campos_protegidos_alterados or v_campos_sobra_alterados then
      raise exception
        'producao_registros: a reabertura do registro % deve alterar somente o status (e atualizado_em); corrija os demais campos em um UPDATE separado, feito depois, com o registro ja em status = reaberto.', old.id;
    end if;
  end if;

  if old.status = 'fechado' and new.status = 'fechado' then
    if v_campos_protegidos_alterados then
      raise exception
        'producao_registros: registro % esta fechado; reabra-o (producao.cancelar ou administrador, conforme a origem) antes de editar quantidade_produzida/receita/data/turno/custo.', old.id;
    end if;

    if v_campos_sobra_alterados and new.origem = 'historico' then
      if not (select public.is_admin()) then
        raise exception
          'producao_registros: gerenciar sobras de um registro historico (%) fechado requer administrador.', old.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.producao_registros_protecao() is
  'BEFORE INSERT/UPDATE trigger de producao_registros. Bloqueia INSERT direto com status=reaberto; torna origem imutavel; restringe transicoes de status a aberto->fechado->reaberto->fechado; exige has_permissao(producao.cancelar) para reabrir registro manual e is_admin() para reabrir registro historico; separa atomicamente a reabertura (fechado->reaberto so pode alterar status/atualizado_em) da correcao dos dados estruturais (so permitida em UPDATE posterior, com o registro ja em status=reaberto); bloqueia edicao de quantidade_produzida/receita_id/data/turno/custo_producao enquanto o registro permanece fechado (fechado->fechado). A partir desta versao (0015), permite gerenciar sobra_total/sobra_aproveitavel/perda_descarte/quantidade_vendida com o registro ja fechado (sem reabertura): producao.editar basta para origem=manual (ja exigido pela RLS), is_admin() e exigido adicionalmente para origem=historico. Preserva observacoes/atualizado_em livres em qualquer situacao; preserva os valores antigos durante a reabertura (nao zera nada).';


-- ============================================================
-- 5. Nova função RPC: public.gerenciar_sobras_producao_registro
-- ============================================================
-- Edita sobra_total/sobra_aproveitavel/perda_descarte de um registro
-- (tipicamente já fechado), sem tocar em quantidade_produzida/receita_id/
-- data/turno/origem/status — nenhum desses aparece no SET, estruturalmente
-- impossível esta função alterá-los. Defensiva: normaliza/calcula
-- v_sobra_total_nova no backend (não confia que o frontend já fez essa
-- conta), valida não-negatividade e a soma da classificação, e — para
-- origem='manual' — valida que a sobra não excede a produção e recalcula
-- quantidade_vendida; para 'historico', preserva quantidade_vendida como
-- estava. Grava em logs_auditoria (campo/valor_anterior/valor_novo, uma
-- linha por atributo + uma linha para o motivo) na MESMA transação — se o
-- log falhar, a alteração inteira reverte junto.

create or replace function public.gerenciar_sobras_producao_registro(
  p_registro_id uuid,
  p_sobra_total integer,
  p_sobra_aproveitavel integer,
  p_perda_descarte integer,
  p_motivo text
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro_antes  public.producao_registros;
  v_registro_depois public.producao_registros;
  v_sobra_total_nova integer;
  v_vendida_nova     integer;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception
      'gerenciar_sobras_producao_registro: motivo e obrigatorio.';
  end if;

  select * into v_registro_antes
  from public.producao_registros
  where id = p_registro_id;

  if v_registro_antes.id is null then
    raise exception
      'gerenciar_sobras_producao_registro: registro % nao encontrado.', p_registro_id;
  end if;

  -- Normalizacao/calculo defensivo de sobra_total: nao confia que o
  -- frontend ja fez essa conta.
  if p_sobra_total is not null then
    v_sobra_total_nova := p_sobra_total;
  elsif p_sobra_aproveitavel is not null or p_perda_descarte is not null then
    v_sobra_total_nova := coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0);
  else
    raise exception
      'gerenciar_sobras_producao_registro: informe ao menos sobra_total, ou sobra_aproveitavel/perda_descarte para calcula-la automaticamente.';
  end if;

  if v_sobra_total_nova < 0 then
    raise exception
      'gerenciar_sobras_producao_registro: sobra_total nao pode ser negativa.';
  end if;

  if p_sobra_aproveitavel is not null and p_sobra_aproveitavel < 0 then
    raise exception
      'gerenciar_sobras_producao_registro: sobra_aproveitavel nao pode ser negativa.';
  end if;

  if p_perda_descarte is not null and p_perda_descarte < 0 then
    raise exception
      'gerenciar_sobras_producao_registro: perda_descarte nao pode ser negativa.';
  end if;

  if (coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0)) > v_sobra_total_nova then
    raise exception
      'gerenciar_sobras_producao_registro: sobra_aproveitavel + perda_descarte (%) nao pode ultrapassar sobra_total (%).',
      coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0), v_sobra_total_nova;
  end if;

  if v_registro_antes.origem = 'manual' then
    if v_sobra_total_nova > v_registro_antes.quantidade_produzida then
      raise exception
        'gerenciar_sobras_producao_registro: sobra_total (%) nao pode ser maior que quantidade_produzida (%).',
        v_sobra_total_nova, v_registro_antes.quantidade_produzida;
    end if;

    v_vendida_nova := v_registro_antes.quantidade_produzida - v_sobra_total_nova;
  else
    -- historico: quantidade_vendida preservada como esta, nunca
    -- recalculada — nao reescrevemos artificialmente dado historico real.
    v_vendida_nova := v_registro_antes.quantidade_vendida;
  end if;

  update public.producao_registros
  set sobra_total = v_sobra_total_nova,
      sobra_aproveitavel = p_sobra_aproveitavel,
      perda_descarte = p_perda_descarte,
      quantidade_vendida = v_vendida_nova,
      atualizado_em = current_timestamp
  where id = p_registro_id
  returning * into v_registro_depois;

  -- usuario_id/usuario_nome/usuario_email sao preenchidos pelo trigger
  -- logs_auditoria_preencher_usuario (migration 0004), que tambem ja
  -- lanca excecao se nao houver sessao autenticada — nao duplicamos essa
  -- checagem aqui. Uma linha por atributo (campo/valor_anterior/
  -- valor_novo, exatamente a estrutura real ja existente da tabela) mais
  -- uma linha para o motivo. Se qualquer um destes INSERTs falhar, a
  -- excecao propaga e o UPDATE acima e revertido junto, pois estao na
  -- mesma transacao implicita desta chamada de funcao.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'motivo',
      null, p_motivo),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'sobra_total',
      v_registro_antes.sobra_total::text, v_registro_depois.sobra_total::text),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'sobra_aproveitavel',
      v_registro_antes.sobra_aproveitavel::text, v_registro_depois.sobra_aproveitavel::text),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'perda_descarte',
      v_registro_antes.perda_descarte::text, v_registro_depois.perda_descarte::text),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'quantidade_vendida',
      v_registro_antes.quantidade_vendida::text, v_registro_depois.quantidade_vendida::text);

  return v_registro_depois;
end;
$$;

comment on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) is
  'Atualiza sobra_total/sobra_aproveitavel/perda_descarte de um registro de producao_registros (tipicamente ja fechado), sem tocar em quantidade_produzida/receita_id/data/turno/origem/status. Calcula/normaliza sobra_total no backend quando nao informado diretamente (soma de aproveitavel+perda, tratando NULL como 0); rejeita se os tres vierem NULL. Valida nao-negatividade e que a soma da classificacao nao ultrapassa sobra_total. Para origem=manual, valida sobra_total <= quantidade_produzida e recalcula quantidade_vendida = quantidade_produzida - sobra_total; para origem=historico, preserva quantidade_vendida original. Grava auditoria em logs_auditoria (uma linha por campo alterado, usando as colunas reais campo/valor_anterior/valor_novo, mais uma linha para o motivo) na MESMA transacao. SECURITY INVOKER: o UPDATE roda como o usuario chamador — a policy producao_registros_update (producao.editar) e a trigger producao_registros_protecao (exige is_admin() adicional para origem=historico) continuam valendo. Exige motivo nao vazio.';

revoke execute on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) from public;
revoke execute on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) from anon;
grant execute on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Mecanicamente executável (nenhuma constraint impede reverter), MAS
-- deixa de ser seguro do ponto de vista de DADO assim que
-- gerenciar_sobras_producao_registro começar a ser usada de verdade (ex.:
-- um registro histórico já classificado, ou um registro manual fechado só
-- com sobra_total e sem classificação, criados DEPOIS desta migration,
-- passariam a violar as constraints antigas se você restaurá-las). Antes
-- de rodar, é obrigatório auditar (SELECT) se alguma linha já foi tocada
-- pela nova RPC (ver logs_auditoria WHERE acao='gerenciou_sobras') e
-- decidir deliberadamente se essa perda de flexibilidade é aceitável —
-- nunca rodar este bloco "por segurança" ou de forma automática.
--
-- BEGIN;
--
-- drop function if exists public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text);
--
-- -- restaura a função da trigger para a versão anterior (0010) — copie o
-- -- corpo original de 0010_producao_registros.sql se for reverter de fato.
--
-- alter table public.producao_registros
--   drop constraint if exists producao_registros_soma_sobra;
-- alter table public.producao_registros
--   add constraint producao_registros_soma_sobra
--   check (
--     status <> 'fechado'
--     or sobra_aproveitavel is null or perda_descarte is null
--     or sobra_total = sobra_aproveitavel + perda_descarte
--   );
--
-- alter table public.producao_registros
--   drop constraint if exists producao_registros_campos_fechamento_obrigatorios_manual;
-- alter table public.producao_registros
--   add constraint producao_registros_campos_fechamento_obrigatorios_manual
--   check (
--     origem <> 'manual' or status <> 'fechado'
--     or (quantidade_vendida is not null
--         and sobra_total is not null
--         and sobra_aproveitavel is not null
--         and perda_descarte is not null)
--   );
--
-- alter table public.producao_registros
--   add constraint producao_registros_historico_sem_classificacao
--   check (
--     origem <> 'historico'
--     or (sobra_aproveitavel is null and perda_descarte is null)
--   );
--
-- COMMIT;
