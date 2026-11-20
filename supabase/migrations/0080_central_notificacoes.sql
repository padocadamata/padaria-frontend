-- 0080_central_notificacoes.sql
-- Central de Notificacoes (fundacao) + 1o tipo: nova solicitacao de produto
-- (Pedidos > Solicitacoes).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Aplicar manualmente no SQL Editor, depois do
-- PREAUDIT (0080_pre_auditoria_central_notificacoes_EXECUTAR.sql); conferir
-- com o POSTAUDIT (0080_pos_auditoria_central_notificacoes_EXECUTAR.sql).
--
-- ARQUITETURA (auditoria aprovada em 2026-11-20): "evento + publico +
-- leitura por usuario".
--   * public.notificacoes -- 1 linha por EVENTO (nunca 1 por destinatario).
--     Quem enxerga e decidido NA LEITURA pela RLS, a partir de 3 regras
--     gravadas na propria linha:
--       permissao_requerida  (obrigatoria) -> has_permissao() do leitor,
--                            com perfil-base + overrides concede/nega +
--                            expiracao (0016) e usuario ativo;
--       perfis_destinatarios (opcional)    -> perfil do leitor precisa
--                            estar na lista (NULL = qualquer perfil);
--       destinatario_id      (opcional)    -> notificacao individual
--                            (NULL = publico inteiro da regra acima).
--     O autor da acao (autor_id) NUNCA ve a propria notificacao.
--     Perder a permissao/perfil/ativo esconde na hora; nada e copiado por
--     usuario, entao overrides e expiracoes valem sem reprocessar nada.
--   * public.notificacoes_leituras -- 1 linha por (usuario, notificacao)
--     lida. Sem linha = nao lida.
--   * public.notificacoes_pendencia_historico -- trilha de cada mudanca de
--     pendencia (aberta -> resolvida -> aberta -> ...). Nada e apagado.
--   * public.notificacoes_falhas -- diagnostico: erro ao emitir/resolver
--     uma notificacao NUNCA desfaz a operacao de negocio; o erro fica aqui
--     (le so proprietario_admin).
--
-- 1o TIPO -- 'pedidos_solicitacoes.criada':
--   publico = perfis gestao + proprietario_admin, ativos, COM
--   pedidos_solicitacoes.visualizar efetiva (decisao aprovada; NAO usa
--   pedidos_solicitacoes.realizar como criterio). Emitida por trigger AFTER
--   INSERT em pedidos_solicitacoes; pendencia aberta -> resolvida
--   (realizada) -> aberta (reaberta pela exclusao do pedido vinculado, 0045)
--   -> descartada (solicitacao excluida).
--
-- NAO FAZ: nenhuma permissao nova; nenhuma concessao a perfil/usuario;
-- nenhuma alteracao em RPC/trigger/policy/tabela existente (so ADICIONA um
-- trigger AFTER em pedidos_solicitacoes, que nao altera a linha); nenhum
-- backfill (solicitacoes anteriores a 0080 nao geram notificacao); nenhum
-- Realtime; nenhum DELETE/UPDATE de dado existente.
--
-- Seguranca:
--   * Escrita em notificacoes/historico/falhas: SOMENTE pelas funcoes
--     internas SECURITY DEFINER (notificacoes_emitir,
--     notificacoes_atualizar_pendencia, trigger), sem EXECUTE para
--     public/anon/authenticated/service_role. Nenhuma policy/grant de
--     INSERT/UPDATE/DELETE para authenticated nessas tabelas.
--   * Leitura: RLS por notificacao_visivel() (SECURITY DEFINER minima: so
--     responde sobre o PROPRIO auth.uid()).
--   * RPCs do app (contar/listar/marcar) sao SECURITY INVOKER: rodam com a
--     RLS do proprio usuario -- nao ha caminho para ler ou marcar
--     notificacao alheia.
--   * Leitura marcada: usuario_id/lida_em forcados pelo servidor; so
--     INSERT (nada de UPDATE/DELETE); a policy exige que a notificacao seja
--     visivel para quem marca.
--   * O banco nunca guarda URL: o link e montado no frontend a partir de
--     (tipo, registro_id) -- lib/notificacoes/tipos.js.
--
-- Transacional (BEGIN/COMMIT). Aborta sem criar nada se os pressupostos nao
-- forem verdadeiros ou se algum objeto desta migration ja existir.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente
-- ============================================================
DO $$
begin
  if to_regprocedure('public.has_permissao(text)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.perfis') is null
     or to_regclass('public.permissoes') is null
     or to_regclass('public.pedidos_solicitacoes') is null then
    raise exception '0080 abortada: objetos base (has_permissao/is_admin/usuarios/perfis/permissoes/pedidos_solicitacoes) nao encontrados.';
  end if;

  if not exists (select 1 from public.permissoes where codigo = 'pedidos_solicitacoes.visualizar') then
    raise exception '0080 abortada: permissao pedidos_solicitacoes.visualizar nao encontrada.';
  end if;

  if (select count(*) from public.perfis where nome in ('gestao', 'proprietario_admin')) <> 2 then
    raise exception '0080 abortada: perfis gestao/proprietario_admin nao encontrados.';
  end if;

  if (select count(*) from pg_attribute
       where attrelid = 'public.usuarios'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'nome', 'perfil', 'ativo')) <> 4 then
    raise exception '0080 abortada: colunas esperadas (id/nome/perfil/ativo) ausentes em public.usuarios.';
  end if;

  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.usuarios'::regclass and (i.indisprimary or i.indisunique)
      and i.indnatts = 1 and a.attname = 'id'
  ) then
    raise exception '0080 abortada: public.usuarios.id sem chave primaria/unica (necessaria para as FKs).';
  end if;

  if (select count(*) from pg_attribute
       where attrelid = 'public.pedidos_solicitacoes'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'descricao', 'unidade', 'quantidade', 'data_solicitacao', 'status',
                         'pedido_id', 'produto_id', 'realizado_por', 'criado_por', 'criado_em')) <> 11 then
    raise exception '0080 abortada: colunas esperadas ausentes em public.pedidos_solicitacoes.';
  end if;

  if to_regclass('public.notificacoes') is not null
     or to_regclass('public.notificacoes_leituras') is not null
     or to_regclass('public.notificacoes_pendencia_historico') is not null
     or to_regclass('public.notificacoes_falhas') is not null
     or to_regprocedure('public.notificacao_visivel(text, text[], uuid, uuid)') is not null
     or to_regprocedure('public.notificacoes_emitir(text, text, text, text, text, text, jsonb, text, text[], uuid, uuid, text, boolean)') is not null
     or to_regprocedure('public.notificacoes_atualizar_pendencia(text, text, text, text, text, uuid)') is not null
     or to_regprocedure('public.notificacoes_registrar_falha(text, text, text, text, text, text)') is not null
     or to_regprocedure('public.notificacoes_protecao()') is not null
     or to_regprocedure('public.notificacoes_leituras_preencher()') is not null
     or to_regprocedure('public.notificacoes_contar_nao_lidas()') is not null
     or to_regprocedure('public.notificacoes_listar(integer, timestamptz, uuid, text, boolean)') is not null
     or to_regprocedure('public.notificacoes_marcar_lidas(uuid[])') is not null
     or to_regprocedure('public.notificacoes_marcar_todas_lidas()') is not null
     or to_regprocedure('public.pedidos_solicitacoes_notificar()') is not null
     or exists (select 1 from pg_trigger
                 where tgrelid = 'public.pedidos_solicitacoes'::regclass
                   and tgname = 'pedidos_solicitacoes_notificar_trigger') then
    raise exception '0080 abortada: objetos desta migration ja existem -- ela ja parece aplicada.';
  end if;
end $$;

-- ============================================================
-- 1. public.notificacoes
-- ============================================================
create table public.notificacoes (
  id                       uuid primary key default gen_random_uuid(),
  tipo                     text not null,
  modulo                   text not null,
  entidade                 text not null,
  registro_id              text not null,
  titulo                   text not null,
  descricao                text,
  dados                    jsonb,

  -- Regras de publico (ver cabecalho).
  permissao_requerida      text not null references public.permissoes(codigo) on delete restrict,
  perfis_destinatarios     text[],
  destinatario_id          uuid references public.usuarios(id) on delete restrict,

  autor_id                 uuid references auth.users(id) on delete set null,
  autor_nome               text,

  chave_dedupe             text not null,
  criado_em                timestamptz not null default now(),

  -- Pendencia (NULL = notificacao so informativa).
  pendencia_status         text,
  pendencia_atualizada_em  timestamptz,
  resolvida_em             timestamptz,
  resolvida_por            uuid references auth.users(id) on delete set null,
  resolvida_por_nome       text,
  resolucao_motivo         text,

  constraint notificacoes_chave_dedupe_unica unique (chave_dedupe),
  constraint notificacoes_tipo_formato
    check (char_length(tipo) <= 80 and tipo ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  constraint notificacoes_modulo_formato
    check (char_length(modulo) <= 60 and modulo ~ '^[a-z0-9_]+$'),
  constraint notificacoes_entidade_formato
    check (char_length(entidade) <= 60 and entidade ~ '^[a-z0-9_]+$'),
  constraint notificacoes_registro_id_valido
    check (btrim(registro_id) <> '' and char_length(registro_id) <= 200),
  constraint notificacoes_titulo_valido
    check (btrim(titulo) <> '' and char_length(titulo) <= 200),
  constraint notificacoes_descricao_valida
    check (descricao is null or char_length(descricao) <= 1000),
  constraint notificacoes_dados_objeto
    check (dados is null or jsonb_typeof(dados) = 'object'),
  constraint notificacoes_perfis_validos
    check (perfis_destinatarios is null
           or (cardinality(perfis_destinatarios) between 1 and 20
               and array_position(perfis_destinatarios, null) is null)),
  constraint notificacoes_chave_dedupe_valida
    check (btrim(chave_dedupe) <> '' and char_length(chave_dedupe) <= 300),
  constraint notificacoes_pendencia_coerente
    check (
      (pendencia_status is null
        and pendencia_atualizada_em is null and resolvida_em is null
        and resolvida_por is null and resolvida_por_nome is null and resolucao_motivo is null)
      or (pendencia_status = 'aberta'
        and pendencia_atualizada_em is not null and resolvida_em is null)
      or (pendencia_status in ('resolvida', 'descartada')
        and pendencia_atualizada_em is not null and resolvida_em is not null)
    ),
  constraint notificacoes_resolucao_motivo_valido
    check (resolucao_motivo is null or char_length(resolucao_motivo) <= 500)
);

comment on table public.notificacoes is
  'Migration 0080. Central de Notificacoes: 1 linha por EVENTO. Visibilidade decidida na leitura pela RLS (notificacao_visivel): has_permissao(permissao_requerida) do leitor (perfil + overrides + expiracao + ativo), perfil do leitor em perfis_destinatarios (NULL = qualquer), destinatario_id (NULL = publico todo) e o autor nunca ve a propria. Escrita SOMENTE pelas funcoes internas notificacoes_emitir/notificacoes_atualizar_pendencia. Historico permanente: nada e apagado.';
comment on column public.notificacoes.tipo is
  'Identificador estavel do evento (ex.: pedidos_solicitacoes.criada). O frontend (lib/notificacoes/tipos.js) traduz tipo + registro_id em icone/rotulo/link -- o banco nunca guarda URL.';
comment on column public.notificacoes.registro_id is
  'Id do registro relacionado em `entidade` (texto, sem FK: o registro pode ser excluido depois; a notificacao continua no historico).';
comment on column public.notificacoes.dados is
  'Dados complementares estruturados (snapshot do momento do evento), so para exibicao.';
comment on column public.notificacoes.permissao_requerida is
  'Obrigatoria: quem nao tem esta permissao efetiva nunca ve a notificacao -- garante que modulo sem acesso nao aparece.';
comment on column public.notificacoes.perfis_destinatarios is
  'Perfis (public.perfis.nome) que formam o publico. NULL = qualquer perfil (a permissao continua obrigatoria).';
comment on column public.notificacoes.destinatario_id is
  'Notificacao individual: so este usuario ve (e ainda precisa da permissao/perfil). NULL = publico inteiro.';
comment on column public.notificacoes.chave_dedupe is
  'Chave unica do evento (ex.: pedidos_solicitacoes.criada:<uuid>). Reemitir o mesmo evento nunca duplica.';
comment on column public.notificacoes.pendencia_status is
  'NULL = so informativa; aberta | resolvida | descartada. Mudancas registradas em notificacoes_pendencia_historico.';

create index notificacoes_criado_em_idx on public.notificacoes (criado_em desc, id desc);
create index notificacoes_entidade_registro_idx on public.notificacoes (entidade, registro_id);
create index notificacoes_pendencias_abertas_idx on public.notificacoes (criado_em desc) where pendencia_status = 'aberta';
create index notificacoes_destinatario_idx on public.notificacoes (destinatario_id) where destinatario_id is not null;
create index notificacoes_permissao_idx on public.notificacoes (permissao_requerida);

-- ============================================================
-- 2. public.notificacoes_leituras
-- ============================================================
create table public.notificacoes_leituras (
  usuario_id      uuid not null default auth.uid()
    references public.usuarios(id) on delete cascade,
  notificacao_id  uuid not null
    references public.notificacoes(id) on delete cascade,
  lida_em         timestamptz not null default now(),

  constraint notificacoes_leituras_pkey primary key (usuario_id, notificacao_id)
);

comment on table public.notificacoes_leituras is
  'Migration 0080. Leitura individual: 1 linha por (usuario, notificacao) lida; sem linha = nao lida. usuario_id/lida_em forcados pelo servidor (trigger); so INSERT, nunca UPDATE/DELETE; a policy exige que a notificacao seja visivel para quem marca.';

create index notificacoes_leituras_notificacao_idx on public.notificacoes_leituras (notificacao_id);

-- ============================================================
-- 3. public.notificacoes_pendencia_historico
-- ============================================================
create table public.notificacoes_pendencia_historico (
  id               uuid primary key default gen_random_uuid(),
  notificacao_id   uuid not null references public.notificacoes(id) on delete cascade,
  status_anterior  text,
  status_novo      text not null,
  motivo           text,
  alterado_por     uuid references auth.users(id) on delete set null,
  alterado_em      timestamptz not null default now(),

  constraint notificacoes_pendencia_historico_status_valido
    check (status_novo in ('aberta', 'resolvida', 'descartada')
           and (status_anterior is null or status_anterior in ('aberta', 'resolvida', 'descartada')))
);

comment on table public.notificacoes_pendencia_historico is
  'Migration 0080. Trilha das mudancas de pendencia de cada notificacao (inclui a abertura inicial). Escrita so pelas funcoes internas; leitura para quem ve a notificacao.';

create index notificacoes_pendencia_historico_notificacao_idx
  on public.notificacoes_pendencia_historico (notificacao_id, alterado_em);

-- ============================================================
-- 4. public.notificacoes_falhas (diagnostico)
-- ============================================================
create table public.notificacoes_falhas (
  id           uuid primary key default gen_random_uuid(),
  ocorrido_em  timestamptz not null default now(),
  origem       text not null,
  entidade     text,
  registro_id  text,
  sqlstate     text,
  mensagem     text,
  detalhe      text,
  usuario_id   uuid
);

comment on table public.notificacoes_falhas is
  'Migration 0080. Erros ao emitir/resolver notificacoes. A operacao de negocio (ex.: criar solicitacao) NUNCA e desfeita por uma falha de notificacao -- o erro fica registrado aqui (e em RAISE WARNING). Leitura so proprietario_admin.';

create index notificacoes_falhas_ocorrido_idx on public.notificacoes_falhas (ocorrido_em desc);

-- ============================================================
-- 5. Protecao (defesa em profundidade)
-- ============================================================
-- notificacoes: nunca apagada; so os campos de pendencia mudam; autor_id
-- so pode virar NULL (FK on delete set null de auth.users).
create function public.notificacoes_protecao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'notificacoes: historico permanente -- notificacoes nao podem ser excluidas.';
  end if;

  if new.id is distinct from old.id
     or new.tipo is distinct from old.tipo
     or new.modulo is distinct from old.modulo
     or new.entidade is distinct from old.entidade
     or new.registro_id is distinct from old.registro_id
     or new.titulo is distinct from old.titulo
     or new.descricao is distinct from old.descricao
     or new.dados is distinct from old.dados
     or new.permissao_requerida is distinct from old.permissao_requerida
     or new.perfis_destinatarios is distinct from old.perfis_destinatarios
     or new.destinatario_id is distinct from old.destinatario_id
     or new.autor_nome is distinct from old.autor_nome
     or new.chave_dedupe is distinct from old.chave_dedupe
     or new.criado_em is distinct from old.criado_em
     or (new.autor_id is distinct from old.autor_id and new.autor_id is not null) then
    raise exception 'notificacoes: somente os campos de pendencia podem ser alterados.';
  end if;

  if old.pendencia_status is null and new.pendencia_status is not null then
    raise exception 'notificacoes: notificacao informativa nao vira pendencia depois de emitida.';
  end if;

  return new;
end;
$$;

comment on function public.notificacoes_protecao() is
  'Migration 0080. BEFORE UPDATE/DELETE em notificacoes: bloqueia DELETE (historico permanente) e qualquer mudanca fora dos campos de pendencia (autor_id so pode virar NULL pela FK).';

create trigger notificacoes_protecao_trigger
  before update or delete on public.notificacoes
  for each row
  execute function public.notificacoes_protecao();

-- notificacoes_leituras: dono e horario sempre do servidor.
create function public.notificacoes_leituras_preencher()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'notificacoes_leituras: requer sessao autenticada.';
  end if;
  new.usuario_id := auth.uid();
  new.lida_em := now();
  return new;
end;
$$;

comment on function public.notificacoes_leituras_preencher() is
  'Migration 0080. BEFORE INSERT em notificacoes_leituras: forca usuario_id = auth.uid() e lida_em = now() (nunca confia no cliente).';

create trigger notificacoes_leituras_preencher_trigger
  before insert on public.notificacoes_leituras
  for each row
  execute function public.notificacoes_leituras_preencher();

-- ============================================================
-- 6. Visibilidade
-- ============================================================
-- SECURITY DEFINER minima: so responde se o PROPRIO auth.uid() veria uma
-- notificacao com estas regras (precisa ler public.usuarios sem depender
-- da RLS dela). Nao devolve nenhum dado.
create function public.notificacao_visivel(
  p_permissao     text,
  p_perfis        text[],
  p_destinatario  uuid,
  p_autor         uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_autor is distinct from auth.uid()
    and (p_destinatario is null or p_destinatario = auth.uid())
    and exists (
      select 1 from public.usuarios u
      where u.id = auth.uid()
        and u.ativo = true
        and (p_perfis is null or u.perfil = any (p_perfis))
    )
    and public.has_permissao(p_permissao);
$$;

comment on function public.notificacao_visivel(text, text[], uuid, uuid) is
  'Migration 0080. Regra unica de visibilidade (usada pela RLS): usuario autenticado e ativo, nao e o autor, e o destinatario (quando houver), tem perfil na lista (quando houver) e has_permissao(permissao) -- inclui overrides nega/concede e expiracao (0016). So responde sobre o proprio auth.uid().';

-- ============================================================
-- 7. Funcoes internas (sem EXECUTE para nenhum papel do app)
-- ============================================================
create function public.notificacoes_registrar_falha(
  p_origem       text,
  p_entidade     text,
  p_registro_id  text,
  p_sqlstate     text,
  p_mensagem     text,
  p_detalhe      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notificacoes_falhas (origem, entidade, registro_id, sqlstate, mensagem, detalhe, usuario_id)
  values (left(p_origem, 120), left(p_entidade, 60), left(p_registro_id, 200), p_sqlstate,
          left(p_mensagem, 2000), left(p_detalhe, 4000), auth.uid());
  raise warning 'notificacoes: falha em % (% %): % [%]', p_origem, p_entidade, p_registro_id, p_mensagem, p_sqlstate;
exception when others then
  -- Nem o registro da falha pode derrubar a operacao de negocio.
  raise warning 'notificacoes: falha em % e nao foi possivel registra-la: %', p_origem, sqlerrm;
end;
$$;

comment on function public.notificacoes_registrar_falha(text, text, text, text, text, text) is
  'Migration 0080. Interna. Registra em notificacoes_falhas (e RAISE WARNING) um erro de emissao/resolucao; nunca propaga erro.';

create function public.notificacoes_emitir(
  p_tipo                  text,
  p_modulo                text,
  p_entidade              text,
  p_registro_id           text,
  p_titulo                text,
  p_descricao             text,
  p_dados                 jsonb,
  p_permissao_requerida   text,
  p_perfis_destinatarios  text[],
  p_destinatario_id       uuid,
  p_autor_id              uuid,
  p_chave_dedupe          text,
  p_com_pendencia         boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_autor_nome  text;
  v_desconhecido text;
begin
  if p_permissao_requerida is null then
    raise exception 'notificacoes_emitir: permissao_requerida e obrigatoria.';
  end if;

  if p_perfis_destinatarios is not null then
    select p into v_desconhecido
      from unnest(p_perfis_destinatarios) as p
     where not exists (select 1 from public.perfis pf where pf.nome = p)
     limit 1;
    if found then
      raise exception 'notificacoes_emitir: perfil % nao existe.', v_desconhecido;
    end if;
  end if;

  if p_autor_id is not null then
    select coalesce(nullif(btrim(u.nome), ''), u.email) into v_autor_nome
      from public.usuarios u where u.id = p_autor_id;
  end if;

  insert into public.notificacoes (
    tipo, modulo, entidade, registro_id, titulo, descricao, dados,
    permissao_requerida, perfis_destinatarios, destinatario_id,
    autor_id, autor_nome, chave_dedupe,
    pendencia_status, pendencia_atualizada_em
  ) values (
    p_tipo, p_modulo, p_entidade, p_registro_id, left(p_titulo, 200), left(p_descricao, 1000), p_dados,
    p_permissao_requerida, p_perfis_destinatarios, p_destinatario_id,
    p_autor_id, v_autor_nome, p_chave_dedupe,
    case when p_com_pendencia then 'aberta' end,
    case when p_com_pendencia then now() end
  )
  on conflict (chave_dedupe) do nothing
  returning id into v_id;

  if v_id is null then
    -- Evento ja emitido: devolve o existente, sem duplicar nada.
    select n.id into v_id from public.notificacoes n where n.chave_dedupe = p_chave_dedupe;
    return v_id;
  end if;

  if p_com_pendencia then
    insert into public.notificacoes_pendencia_historico (notificacao_id, status_anterior, status_novo, motivo, alterado_por)
    values (v_id, null, 'aberta', 'Pendencia aberta.', p_autor_id);
  end if;

  return v_id;
end;
$$;

comment on function public.notificacoes_emitir(text, text, text, text, text, text, jsonb, text, text[], uuid, uuid, text, boolean) is
  'Migration 0080. Interna (sem EXECUTE para o app). Emite uma notificacao; idempotente por chave_dedupe (ON CONFLICT DO NOTHING -> devolve o id existente). p_com_pendencia abre pendencia e registra no historico. Para um tipo novo (ex.: importacao G3ERP), basta chamar esta funcao de um trigger/RPC SECURITY DEFINER do modulo de origem.';

create function public.notificacoes_atualizar_pendencia(
  p_entidade     text,
  p_registro_id  text,
  p_tipo         text,
  p_status       text,
  p_motivo       text,
  p_por          uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome   text;
  v_total  integer;
begin
  if p_status not in ('aberta', 'resolvida', 'descartada') then
    raise exception 'notificacoes_atualizar_pendencia: status % invalido.', p_status;
  end if;

  if p_por is not null then
    select coalesce(nullif(btrim(u.nome), ''), u.email) into v_nome
      from public.usuarios u where u.id = p_por;
  end if;

  with alvo as (
    select n.id, n.pendencia_status as anterior
      from public.notificacoes n
     where n.entidade = p_entidade
       and n.registro_id = p_registro_id
       and n.tipo = p_tipo
       and n.pendencia_status is not null
       and n.pendencia_status <> p_status
     for update
  ), atualizadas as (
    update public.notificacoes n
       set pendencia_status = p_status,
           pendencia_atualizada_em = now(),
           resolvida_em = case when p_status = 'aberta' then null else now() end,
           resolvida_por = case when p_status = 'aberta' then null else p_por end,
           resolvida_por_nome = case when p_status = 'aberta' then null else v_nome end,
           resolucao_motivo = left(p_motivo, 500)
      from alvo
     where n.id = alvo.id
    returning n.id, alvo.anterior
  )
  insert into public.notificacoes_pendencia_historico (notificacao_id, status_anterior, status_novo, motivo, alterado_por)
  select a.id, a.anterior, p_status, left(p_motivo, 500), p_por from atualizadas a;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function public.notificacoes_atualizar_pendencia(text, text, text, text, text, uuid) is
  'Migration 0080. Interna (sem EXECUTE para o app). Resolve, descarta ou reabre a pendencia das notificacoes de (entidade, registro_id, tipo); ignora notificacoes informativas e as que ja estao no status pedido; registra cada mudanca em notificacoes_pendencia_historico. Devolve quantas mudaram.';

-- ============================================================
-- 8. Integracao com Pedidos > Solicitacoes
-- ============================================================
-- AFTER INSERT / UPDATE OF status / DELETE: nao altera a linha (AFTER,
-- retorna NULL). Qualquer erro aqui e capturado, registrado em
-- notificacoes_falhas e NUNCA desfaz a criacao/realizacao/exclusao da
-- solicitacao.
create function public.pedidos_solicitacoes_notificar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro    text;
  v_solicitante text;
  v_quantidade  text;
  v_descricao   text;
  v_estado      text;
  v_mensagem    text;
  v_detalhe     text;
begin
  v_registro := coalesce(new.id, old.id)::text;

  begin
    if tg_op = 'INSERT' then
      select coalesce(nullif(btrim(u.nome), ''), u.email) into v_solicitante
        from public.usuarios u where u.id = new.criado_por;
      v_solicitante := coalesce(v_solicitante, 'Um usuário');

      -- numeric(12,3) -> "2", "2,5", "0,125" (sem zeros a direita).
      v_quantidade := replace(rtrim(rtrim(new.quantidade::text, '0'), '.'), '.', ',');

      v_descricao := v_solicitante || ' solicitou ' || v_quantidade
        || case when nullif(btrim(coalesce(new.unidade, '')), '') is not null then ' ' || btrim(new.unidade) else '' end
        || ' de ' || new.descricao || '.';

      perform public.notificacoes_emitir(
        'pedidos_solicitacoes.criada',
        'pedidos',
        'pedidos_solicitacoes',
        v_registro,
        'Nova solicitação de produto',
        v_descricao,
        jsonb_build_object(
          'solicitacao_id', new.id,
          'produto_id', new.produto_id,
          'descricao', new.descricao,
          'quantidade', new.quantidade,
          'unidade', new.unidade,
          'data_solicitacao', new.data_solicitacao,
          'solicitado_em', new.criado_em,
          'solicitante_nome', v_solicitante
        ),
        'pedidos_solicitacoes.visualizar',
        array['gestao', 'proprietario_admin'],
        null,
        new.criado_por,
        'pedidos_solicitacoes.criada:' || v_registro,
        true
      );

    elsif tg_op = 'UPDATE' then
      if old.status = 'pendente' and new.status = 'realizada' then
        perform public.notificacoes_atualizar_pendencia(
          'pedidos_solicitacoes', v_registro, 'pedidos_solicitacoes.criada', 'resolvida',
          case when new.pedido_id is not null
               then 'Solicitação realizada com pedido vinculado.'
               else 'Solicitação marcada como realizada.' end,
          coalesce(new.realizado_por, auth.uid())
        );
      elsif old.status = 'realizada' and new.status = 'pendente' then
        perform public.notificacoes_atualizar_pendencia(
          'pedidos_solicitacoes', v_registro, 'pedidos_solicitacoes.criada', 'aberta',
          'Solicitação reaberta (pedido vinculado excluído).',
          auth.uid()
        );
      end if;

    elsif tg_op = 'DELETE' then
      perform public.notificacoes_atualizar_pendencia(
        'pedidos_solicitacoes', v_registro, 'pedidos_solicitacoes.criada', 'descartada',
        'Solicitação excluída.',
        auth.uid()
      );
    end if;
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_mensagem = message_text, v_detalhe = pg_exception_context;
    perform public.notificacoes_registrar_falha(
      'pedidos_solicitacoes_notificar:' || lower(tg_op), 'pedidos_solicitacoes', v_registro,
      v_estado, v_mensagem, v_detalhe
    );
  end;

  return null;
end;
$$;

comment on function public.pedidos_solicitacoes_notificar() is
  'Migration 0080. AFTER INSERT/UPDATE OF status/DELETE em pedidos_solicitacoes. INSERT: emite pedidos_solicitacoes.criada (publico gestao+proprietario_admin com pedidos_solicitacoes.visualizar; autor excluido; pendencia aberta). pendente->realizada: resolve; realizada->pendente (0045): reabre; DELETE: descarta. Erros sao capturados e registrados em notificacoes_falhas -- nunca desfazem a operacao da solicitacao. Nao altera a linha.';

create trigger pedidos_solicitacoes_notificar_trigger
  after insert or update of status or delete on public.pedidos_solicitacoes
  for each row
  execute function public.pedidos_solicitacoes_notificar();

-- ============================================================
-- 9. RPCs do app (SECURITY INVOKER -- valem a RLS do proprio usuario)
-- ============================================================
create function public.notificacoes_contar_nao_lidas()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.notificacoes n
   where not exists (
     select 1 from public.notificacoes_leituras l
      where l.notificacao_id = n.id and l.usuario_id = auth.uid()
   );
$$;

comment on function public.notificacoes_contar_nao_lidas() is
  'Migration 0080. Quantidade de notificacoes visiveis (RLS) e nao lidas pelo usuario atual. Usada pelo polling do sino.';

create function public.notificacoes_listar(
  p_limite                     integer default 20,
  p_antes_em                   timestamptz default null,
  p_antes_id                   uuid default null,
  p_leitura                    text default 'todas',
  p_somente_pendencias_abertas boolean default false
)
returns table (
  id                       uuid,
  tipo                     text,
  modulo                   text,
  entidade                 text,
  registro_id              text,
  titulo                   text,
  descricao                text,
  dados                    jsonb,
  autor_nome               text,
  criado_em                timestamptz,
  pendencia_status         text,
  pendencia_atualizada_em  timestamptz,
  resolvida_em             timestamptz,
  resolvida_por_nome       text,
  resolucao_motivo         text,
  lida_em                  timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(p_leitura, '') not in ('todas', 'nao_lidas', 'lidas') then
    raise exception 'notificacoes_listar: filtro de leitura invalido (use todas, nao_lidas ou lidas).';
  end if;

  return query
  select n.id, n.tipo, n.modulo, n.entidade, n.registro_id, n.titulo, n.descricao, n.dados,
         n.autor_nome, n.criado_em, n.pendencia_status, n.pendencia_atualizada_em,
         n.resolvida_em, n.resolvida_por_nome, n.resolucao_motivo, l.lida_em
    from public.notificacoes n
    left join public.notificacoes_leituras l
      on l.notificacao_id = n.id and l.usuario_id = auth.uid()
   where (p_antes_em is null
          or n.criado_em < p_antes_em
          or (n.criado_em = p_antes_em and p_antes_id is not null and n.id < p_antes_id))
     and (p_leitura = 'todas'
          or (p_leitura = 'nao_lidas' and l.lida_em is null)
          or (p_leitura = 'lidas' and l.lida_em is not null))
     and (not coalesce(p_somente_pendencias_abertas, false) or n.pendencia_status = 'aberta')
   order by n.criado_em desc, n.id desc
   limit least(greatest(coalesce(p_limite, 20), 1), 100);
end;
$$;

comment on function public.notificacoes_listar(integer, timestamptz, uuid, text, boolean) is
  'Migration 0080. Lista as notificacoes visiveis (RLS) do usuario atual, mais recentes primeiro, paginacao por cursor (p_antes_em + p_antes_id = ultima linha da pagina anterior), limite 1..100. Filtros: leitura (todas/nao_lidas/lidas) e somente pendencias abertas.';

create function public.notificacoes_marcar_lidas(p_ids uuid[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'notificacoes_marcar_lidas: requer sessao autenticada.';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'notificacoes_marcar_lidas: no maximo 500 notificacoes por chamada.';
  end if;

  insert into public.notificacoes_leituras (notificacao_id)
  select n.id from public.notificacoes n where n.id = any (p_ids)
  on conflict (usuario_id, notificacao_id) do nothing;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function public.notificacoes_marcar_lidas(uuid[]) is
  'Migration 0080. Marca como lidas (para o usuario atual) as notificacoes informadas que ele consegue ver; ids invisiveis/inexistentes sao ignorados. Idempotente. Devolve quantas foram marcadas agora.';

create function public.notificacoes_marcar_todas_lidas()
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'notificacoes_marcar_todas_lidas: requer sessao autenticada.';
  end if;

  insert into public.notificacoes_leituras (notificacao_id)
  select n.id from public.notificacoes n
   where not exists (
     select 1 from public.notificacoes_leituras l
      where l.notificacao_id = n.id and l.usuario_id = auth.uid()
   )
  on conflict (usuario_id, notificacao_id) do nothing;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function public.notificacoes_marcar_todas_lidas() is
  'Migration 0080. Marca como lidas todas as notificacoes visiveis e ainda nao lidas do usuario atual. Idempotente.';

-- ============================================================
-- 10. RLS
-- ============================================================
alter table public.notificacoes enable row level security;
alter table public.notificacoes_leituras enable row level security;
alter table public.notificacoes_pendencia_historico enable row level security;
alter table public.notificacoes_falhas enable row level security;

create policy notificacoes_select on public.notificacoes
  for select to authenticated
  using (public.notificacao_visivel(permissao_requerida, perfis_destinatarios, destinatario_id, autor_id));

create policy notificacoes_leituras_select on public.notificacoes_leituras
  for select to authenticated
  using (usuario_id = (select auth.uid()));

create policy notificacoes_leituras_insert on public.notificacoes_leituras
  for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and exists (select 1 from public.notificacoes n where n.id = notificacao_id)
  );

create policy notificacoes_pendencia_historico_select on public.notificacoes_pendencia_historico
  for select to authenticated
  using (exists (select 1 from public.notificacoes n where n.id = notificacao_id));

create policy notificacoes_falhas_select on public.notificacoes_falhas
  for select to authenticated
  using ((select public.is_admin()));

comment on policy notificacoes_select on public.notificacoes is 'Visivel conforme notificacao_visivel(): permissao efetiva, perfil, destinatario, ativo, autor excluido.';
comment on policy notificacoes_leituras_select on public.notificacoes_leituras is 'Cada usuario le so as proprias leituras.';
comment on policy notificacoes_leituras_insert on public.notificacoes_leituras is 'So para si mesmo e so de notificacao que ele consegue ver (o EXISTS passa pela RLS de notificacoes).';
comment on policy notificacoes_pendencia_historico_select on public.notificacoes_pendencia_historico is 'Historico visivel para quem ve a notificacao.';
comment on policy notificacoes_falhas_select on public.notificacoes_falhas is 'Diagnostico: somente proprietario_admin.';

-- ============================================================
-- 11. Grants minimos
-- ============================================================
revoke all on public.notificacoes, public.notificacoes_leituras,
              public.notificacoes_pendencia_historico, public.notificacoes_falhas
  from public, anon, authenticated;

grant select on public.notificacoes to authenticated;
grant select, insert on public.notificacoes_leituras to authenticated;
grant select on public.notificacoes_pendencia_historico to authenticated;
grant select on public.notificacoes_falhas to authenticated;

-- Funcoes de trigger e internas: ninguem do app executa diretamente.
revoke execute on function public.notificacoes_protecao() from public, anon, authenticated, service_role;
revoke execute on function public.notificacoes_leituras_preencher() from public, anon, authenticated, service_role;
revoke execute on function public.pedidos_solicitacoes_notificar() from public, anon, authenticated, service_role;
revoke execute on function public.notificacoes_registrar_falha(text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.notificacoes_emitir(text, text, text, text, text, text, jsonb, text, text[], uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.notificacoes_atualizar_pendencia(text, text, text, text, text, uuid) from public, anon, authenticated, service_role;

-- Visibilidade: usada pela RLS (precisa de EXECUTE para authenticated).
revoke execute on function public.notificacao_visivel(text, text[], uuid, uuid) from public, anon, service_role;
grant execute on function public.notificacao_visivel(text, text[], uuid, uuid) to authenticated;

-- RPCs do app.
revoke execute on function public.notificacoes_contar_nao_lidas() from public, anon, service_role;
revoke execute on function public.notificacoes_listar(integer, timestamptz, uuid, text, boolean) from public, anon, service_role;
revoke execute on function public.notificacoes_marcar_lidas(uuid[]) from public, anon, service_role;
revoke execute on function public.notificacoes_marcar_todas_lidas() from public, anon, service_role;
grant execute on function public.notificacoes_contar_nao_lidas() to authenticated;
grant execute on function public.notificacoes_listar(integer, timestamptz, uuid, text, boolean) to authenticated;
grant execute on function public.notificacoes_marcar_lidas(uuid[]) to authenticated;
grant execute on function public.notificacoes_marcar_todas_lidas() to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, so se precisar desfazer -- APAGA todas as notificacoes,
-- leituras, historico e falhas gravados depois da aplicacao):
-- BEGIN;
-- drop trigger if exists pedidos_solicitacoes_notificar_trigger on public.pedidos_solicitacoes;
-- drop function if exists public.pedidos_solicitacoes_notificar();
-- drop function if exists public.notificacoes_marcar_todas_lidas();
-- drop function if exists public.notificacoes_marcar_lidas(uuid[]);
-- drop function if exists public.notificacoes_listar(integer, timestamptz, uuid, text, boolean);
-- drop function if exists public.notificacoes_contar_nao_lidas();
-- drop table if exists public.notificacoes_falhas;
-- drop table if exists public.notificacoes_pendencia_historico;
-- drop table if exists public.notificacoes_leituras;
-- drop trigger if exists notificacoes_protecao_trigger on public.notificacoes;
-- drop table if exists public.notificacoes;
-- drop function if exists public.notificacoes_atualizar_pendencia(text, text, text, text, text, uuid);
-- drop function if exists public.notificacoes_emitir(text, text, text, text, text, text, jsonb, text, text[], uuid, uuid, text, boolean);
-- drop function if exists public.notificacoes_registrar_falha(text, text, text, text, text, text);
-- drop function if exists public.notificacao_visivel(text, text[], uuid, uuid);
-- drop function if exists public.notificacoes_leituras_preencher();
-- drop function if exists public.notificacoes_protecao();
-- COMMIT;
-- ============================================================
