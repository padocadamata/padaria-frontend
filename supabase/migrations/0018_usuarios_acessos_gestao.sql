-- 0018_usuarios_acessos_gestao.sql
-- RPCs para a tela administrativa "Usuarios e Acessos" (V1): permitem ao
-- proprietario_admin alterar perfil-base, ativar/desativar e gerenciar
-- overrides individuais de um usuario pelo proprio sistema, sem precisar de
-- SQL manual no Supabase.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM EXECUTAR
-- ate autorizacao explicita. Gerado em scratchpad para revisao estatica,
-- SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0016 ja aplicadas (usa public.usuarios,
-- public.usuario_permissoes, public.perfis, public.permissoes,
-- public.logs_auditoria, e as triggers usuarios_protecao_ultimo_admin_trigger
-- e usuario_permissoes_bloquear_admin_trigger, todas da 0016).
--
-- ESCOPO DESTA MIGRATION -- SOMENTE 3 FUNCOES RPC:
--   1. public.aplicar_diff_permissoes_usuario(uuid, jsonb)
--   2. public.alterar_perfil_usuario(uuid, text)
--   3. public.alterar_status_usuario(uuid, boolean)
--
-- NENHUMA tabela, coluna, policy ou trigger nova. NENHUMA alteracao em
-- is_admin() ou has_permissao() -- ambas continuam exatamente como estao
-- desde a 0016.
--
-- REVISAO (pos-auditoria funcional): a versao original deste arquivo era
-- SECURITY INVOKER sem checagem propria de is_admin(), confiando so na RLS
-- ja existente (mesmo padrao de reabrir_producao_registro, migration 0011).
-- A auditoria encontrou um gap real nesse desenho: UPDATE/DELETE filtrados
-- por RLS falham SILENCIOSAMENTE (0 linhas afetadas, sem erro) quando quem
-- chama nao e admin -- diferente de INSERT, que falha alto (erro de RLS).
-- Combinado com o INSERT incondicional em logs_auditoria logo depois, isso
-- permitia que um usuario nao-admin, chamando a funcao sobre si mesmo,
-- fizesse o sistema GRAVAR uma linha de auditoria dizendo que uma mudanca
-- administrativa aconteceu, quando na verdade a RLS bloqueou tudo em
-- silencio (o dado real nunca mudava -- nao era escalonamento de
-- privilegio, mas era auditoria falsa). Por isso as 3 funcoes abaixo agora
-- comecam com uma checagem explicita de is_admin(). Isso NAO substitui a
-- RLS como mecanismo de autorizacao -- a RLS continua sendo o que de fato
-- protege as tabelas, inalterada por esta migration -- e so evita esse
-- modo de falha silenciosa especifico, com um erro alto e imediato.
--
-- As 3 funcoes continuam SECURITY INVOKER: rodam com o papel e a sessao de
-- quem chama, entao a escrita real continua inteiramente sujeita a RLS ja
-- existente (usuarios_update_admin, usuario_permissoes_insert_admin/
-- update_admin/delete_admin -- todas exigem is_admin()).
--
-- A trigger usuario_permissoes_bloquear_admin_trigger (0016) e quem
-- continua impedindo, de forma definitiva, que usuarios.administrar,
-- permissoes.administrar ou configuracoes.administrar sejam concedidos ou
-- negados via override -- ela dispara em qualquer INSERT/UPDATE sobre
-- usuario_permissoes, inclusive os feitos de dentro de
-- aplicar_diff_permissoes_usuario (trigger nao diferencia se o DML veio de
-- um cliente direto ou de dentro de uma funcao). Por isso esta migration
-- NAO duplica a lista desses 3 codigos em lugar nenhum.
--
-- A trigger usuarios_protecao_ultimo_admin_trigger (0016) continua
-- protegendo qualquer UPDATE de usuarios (perfil ou ativo), pelo mesmo
-- motivo -- dispara para qualquer UPDATE na tabela, inclusive os feitos
-- por alterar_perfil_usuario/alterar_status_usuario.

BEGIN;

-- ============================================================
-- 1. public.aplicar_diff_permissoes_usuario(p_usuario_id uuid, p_alteracoes jsonb)
-- ============================================================
-- p_alteracoes e um array JSON, um item por permissao alterada (o frontend
-- monta so o diff real -- nao reenviar permissoes inalteradas):
--   [{ "permissao": "fornecedores.editar", "acao": "conceder",
--      "expira_em": "2026-12-31T23:59:00" | null, "motivo": "..." | null }, ...]
-- acao aceita: 'herdar' | 'conceder' | 'negar'.
--   herdar   -> remove a linha de usuario_permissoes (mesmo se expirada).
--   conceder -> upsert efeito='concede'.
--   negar    -> upsert efeito='nega'.
-- expira_em ausente/null/'' -> NULL (permanente).
--
-- Validacao em DOIS PASSES: o passe 1 valida o array inteiro (formato,
-- acao, existencia de cada permissao no catalogo, duplicata) SEM tocar em
-- nenhuma linha; o passe 2 so comeca a escrever se o passe 1 inteiro
-- passou. Cada item aplicado no passe 2 grava uma linha correspondente em
-- logs_auditoria, na MESMA transacao do lote inteiro: se qualquer coisa
-- falhar em qualquer passe (permissao invalida, duplicata, tentativa de
-- tocar em codigo administrativo -- barrada pela trigger da 0016, erro de
-- tipo em expira_em etc.), a funcao inteira levanta excecao e TODO o diff
-- e revertido -- nao ha aplicacao parcial.
create or replace function public.aplicar_diff_permissoes_usuario(
  p_usuario_id uuid,
  p_alteracoes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item            jsonb;
  v_permissao       text;
  v_acao            text;
  v_expira_texto    text;
  v_expira_em       timestamptz;
  v_motivo          text;
  v_anterior        public.usuario_permissoes%rowtype;
  v_valor_anterior  text;
  v_valor_novo      text;
  v_acao_auditoria  text;
  v_efeito_novo     text;
  v_total_itens     integer;
  v_total_distintos integer;
begin
  if not (select public.is_admin()) then
    raise exception using errcode = '42501',
      message = 'aplicar_diff_permissoes_usuario: requer administrador (proprietario_admin).';
  end if;

  if not exists (select 1 from public.usuarios where id = p_usuario_id) then
    raise exception 'aplicar_diff_permissoes_usuario: usuario % nao encontrado.', p_usuario_id;
  end if;

  if p_alteracoes is null or jsonb_typeof(p_alteracoes) <> 'array' then
    raise exception 'aplicar_diff_permissoes_usuario: p_alteracoes precisa ser um array JSON.';
  end if;

  -- ------------------------------------------------------------
  -- Passe 1 -- validacao completa, SEM nenhuma escrita.
  -- ------------------------------------------------------------
  select count(*), count(distinct item->>'permissao')
  into v_total_itens, v_total_distintos
  from jsonb_array_elements(p_alteracoes) as item;

  if v_total_itens <> v_total_distintos then
    raise exception 'aplicar_diff_permissoes_usuario: p_alteracoes contem permissao duplicada -- cada codigo so pode aparecer uma vez por chamada.';
  end if;

  for v_item in select * from jsonb_array_elements(p_alteracoes)
  loop
    v_permissao := v_item->>'permissao';
    v_acao      := v_item->>'acao';

    if v_permissao is null or btrim(v_permissao) = '' then
      raise exception 'aplicar_diff_permissoes_usuario: item sem "permissao" valida: %', v_item;
    end if;

    if v_acao is null or v_acao not in ('herdar', 'conceder', 'negar') then
      raise exception 'aplicar_diff_permissoes_usuario: acao invalida "%" para %; use herdar, conceder ou negar.', v_acao, v_permissao;
    end if;

    if not exists (select 1 from public.permissoes where codigo = v_permissao) then
      raise exception 'aplicar_diff_permissoes_usuario: permissao "%" nao existe no catalogo.', v_permissao;
    end if;
  end loop;

  -- ------------------------------------------------------------
  -- Passe 2 -- aplicacao. So chega aqui se TODO o array passou no passe 1.
  -- ------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_alteracoes)
  loop
    v_permissao := v_item->>'permissao';
    v_acao      := v_item->>'acao';
    v_motivo    := nullif(btrim(coalesce(v_item->>'motivo', '')), '');

    v_expira_texto := v_item->>'expira_em';
    if v_expira_texto is null or btrim(v_expira_texto) = '' then
      v_expira_em := null;
    else
      v_expira_em := v_expira_texto::timestamptz;
    end if;

    -- Estado anterior (para a linha de auditoria) -- lido antes de
    -- qualquer escrita deste item.
    select * into v_anterior
    from public.usuario_permissoes
    where usuario_id = p_usuario_id and permissao = v_permissao;

    if not found then
      v_valor_anterior := 'herdado';
    else
      v_valor_anterior := v_anterior.efeito || case
        when v_anterior.expira_em is null then ' (permanente)'
        else ' (expira ' || to_char(v_anterior.expira_em, 'YYYY-MM-DD HH24:MI') || ')'
      end;
    end if;

    if v_acao = 'herdar' then
      delete from public.usuario_permissoes
      where usuario_id = p_usuario_id and permissao = v_permissao;

      v_valor_novo     := 'herdado';
      v_acao_auditoria := 'removeu_override';
    else
      v_efeito_novo := case v_acao when 'conceder' then 'concede' else 'nega' end;

      -- INSERT ... ON CONFLICT DO UPDATE: dispara a trigger BEFORE
      -- INSERT (usuario_permissoes_bloquear_admin_trigger) sempre; se
      -- cair no caminho de conflito, dispara tambem a BEFORE UPDATE da
      -- mesma trigger e a de atualizado_em (0016) -- protecao intacta nos
      -- dois caminhos.
      insert into public.usuario_permissoes
        (usuario_id, permissao, efeito, expira_em, concedido_por, motivo)
      values
        (p_usuario_id, v_permissao, v_efeito_novo, v_expira_em, auth.uid(), v_motivo)
      on conflict (usuario_id, permissao) do update
        set efeito        = excluded.efeito,
            expira_em     = excluded.expira_em,
            concedido_por = excluded.concedido_por,
            motivo        = excluded.motivo;

      v_valor_novo := v_efeito_novo || case
        when v_expira_em is null then ' (permanente)'
        else ' (expira ' || to_char(v_expira_em, 'YYYY-MM-DD HH24:MI') || ')'
      end;
      v_acao_auditoria := case v_acao when 'conceder' then 'concedeu' else 'negou' end;
    end if;

    insert into public.logs_auditoria
      (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values
      ('usuario_permissao', p_usuario_id::text, v_acao_auditoria, v_permissao, v_valor_anterior, v_valor_novo);
  end loop;
end;
$$;

comment on function public.aplicar_diff_permissoes_usuario(uuid, jsonb) is
  'Aplica um lote de mudancas de override (usuario_permissoes) de um usuario-alvo, numa unica transacao (tudo ou nada), em dois passes: validacao completa do array (acao, existencia da permissao no catalogo, duplicata) sem nenhuma escrita, seguida da aplicacao (delete para herdar, upsert para conceder/negar) + uma linha em logs_auditoria por item. Comeca exigindo is_admin() explicitamente (alem da RLS de usuario_permissoes, que exige o mesmo) -- ver comentario de cabecalho da migration 0018 sobre por que essa checagem dupla foi adicionada apos a auditoria funcional. A trigger usuario_permissoes_bloquear_admin_trigger (0016) continua sendo quem bloqueia, de forma definitiva, usuarios.administrar/permissoes.administrar/configuracoes.administrar via override, independente de quem chama esta funcao.';

revoke execute on function public.aplicar_diff_permissoes_usuario(uuid, jsonb) from public;
revoke execute on function public.aplicar_diff_permissoes_usuario(uuid, jsonb) from anon;
grant execute on function public.aplicar_diff_permissoes_usuario(uuid, jsonb) to authenticated;


-- ============================================================
-- 2. public.alterar_perfil_usuario(p_usuario_id uuid, p_novo_perfil text)
-- ============================================================
-- Troca o perfil-base de um usuario. Valida que o usuario existe, que o
-- perfil existe e esta ativo, e que a mudanca e real (perfil novo
-- diferente do atual -- senao retorna sem UPDATE nem auditoria). A trigger
-- usuarios_protecao_ultimo_admin_trigger (0016) continua bloqueando, sem
-- nenhuma alteracao aqui, rebaixar o ultimo proprietario_admin ativo do
-- sistema -- se isso acontecer, a excecao dela propaga e nem o UPDATE nem
-- o INSERT de auditoria abaixo chegam a acontecer.
create or replace function public.alterar_perfil_usuario(
  p_usuario_id uuid,
  p_novo_perfil text
)
returns public.usuarios
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_perfil_valido boolean;
  v_perfil_anterior text;
begin
  if not (select public.is_admin()) then
    raise exception using errcode = '42501',
      message = 'alterar_perfil_usuario: requer administrador (proprietario_admin).';
  end if;

  select perfil into v_perfil_anterior
  from public.usuarios
  where id = p_usuario_id;

  if not found then
    raise exception 'alterar_perfil_usuario: usuario % nao encontrado.', p_usuario_id;
  end if;

  select exists (
    select 1 from public.perfis where nome = p_novo_perfil and ativo = true
  ) into v_perfil_valido;

  if not v_perfil_valido then
    raise exception 'alterar_perfil_usuario: perfil "%" nao existe ou nao esta ativo.', p_novo_perfil;
  end if;

  if v_perfil_anterior = p_novo_perfil then
    select * into v_usuario from public.usuarios where id = p_usuario_id;
    return v_usuario;
  end if;

  update public.usuarios
  set perfil = p_novo_perfil
  where id = p_usuario_id
  returning * into v_usuario;

  insert into public.logs_auditoria
    (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('usuario', p_usuario_id::text, 'alterou_perfil', 'perfil', v_perfil_anterior, p_novo_perfil);

  return v_usuario;
end;
$$;

comment on function public.alterar_perfil_usuario(uuid, text) is
  'Altera usuarios.perfil de um usuario-alvo, validando que o usuario existe e que o novo perfil existe/esta ativo; se o valor pedido for igual ao atual, retorna sem UPDATE nem auditoria (idempotente, sem ruido). Grava a mudanca real (anterior->novo) em logs_auditoria na mesma transacao. Comeca exigindo is_admin() explicitamente (alem da RLS de usuarios, que exige o mesmo) -- ver comentario de cabecalho da migration 0018. usuarios_protecao_ultimo_admin_trigger (0016) inalterada.';

revoke execute on function public.alterar_perfil_usuario(uuid, text) from public;
revoke execute on function public.alterar_perfil_usuario(uuid, text) from anon;
grant execute on function public.alterar_perfil_usuario(uuid, text) to authenticated;


-- ============================================================
-- 3. public.alterar_status_usuario(p_usuario_id uuid, p_ativo boolean)
-- ============================================================
-- Altera somente usuarios.ativo. Nao exclui a linha de usuarios, nao toca
-- em auth.users, nao apaga logs_auditoria nem qualquer outro historico. A
-- trigger usuarios_protecao_ultimo_admin_trigger (0016) continua
-- bloqueando desativar o ultimo proprietario_admin ativo, sem alteracao.
create or replace function public.alterar_status_usuario(
  p_usuario_id uuid,
  p_ativo boolean
)
returns public.usuarios
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_ativo_anterior boolean;
begin
  if not (select public.is_admin()) then
    raise exception using errcode = '42501',
      message = 'alterar_status_usuario: requer administrador (proprietario_admin).';
  end if;

  if p_ativo is null then
    raise exception 'alterar_status_usuario: p_ativo nao pode ser nulo.';
  end if;

  select ativo into v_ativo_anterior
  from public.usuarios
  where id = p_usuario_id;

  if not found then
    raise exception 'alterar_status_usuario: usuario % nao encontrado.', p_usuario_id;
  end if;

  if v_ativo_anterior = p_ativo then
    select * into v_usuario from public.usuarios where id = p_usuario_id;
    return v_usuario;
  end if;

  update public.usuarios
  set ativo = p_ativo
  where id = p_usuario_id
  returning * into v_usuario;

  insert into public.logs_auditoria
    (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    (
      'usuario',
      p_usuario_id::text,
      case when p_ativo then 'ativou' else 'desativou' end,
      'ativo',
      v_ativo_anterior::text,
      p_ativo::text
    );

  return v_usuario;
end;
$$;

comment on function public.alterar_status_usuario(uuid, boolean) is
  'Altera usuarios.ativo de um usuario-alvo (nunca exclui a linha, nunca toca em auth.users ou em logs_auditoria existente), rejeitando p_ativo nulo; se o valor pedido for igual ao atual, retorna sem UPDATE nem auditoria. Grava a mudanca real (anterior->novo) em logs_auditoria na mesma transacao. Comeca exigindo is_admin() explicitamente (alem da RLS de usuarios, que exige o mesmo) -- ver comentario de cabecalho da migration 0018. usuarios_protecao_ultimo_admin_trigger (0016) inalterada. Efeito de desativar e imediato para has_permissao()/is_admin() (ambas checam usuarios.ativo=true primeiro), independente de cache no frontend do usuario afetado.';

revoke execute on function public.alterar_status_usuario(uuid, boolean) from public;
revoke execute on function public.alterar_status_usuario(uuid, boolean) from anon;
grant execute on function public.alterar_status_usuario(uuid, boolean) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro: esta migration so cria 3 funcoes (com seus GRANT/REVOKE), nao
-- cria nem altera nenhuma tabela, nao insere nenhum dado de negocio (o
-- unico DML que qualquer coisa aqui produz acontece quando as funcoes sao
-- CHAMADAS depois, nao quando esta migration e aplicada). Nenhuma outra
-- migration/policy/trigger depende destas 3 funcoes -- sao so RPCs
-- chamadas pelo frontend.
-- BEGIN;
-- drop function if exists public.alterar_status_usuario(uuid, boolean);
-- drop function if exists public.alterar_perfil_usuario(uuid, text);
-- drop function if exists public.aplicar_diff_permissoes_usuario(uuid, jsonb);
-- COMMIT;
