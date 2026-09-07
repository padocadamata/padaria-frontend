-- 0043_pedidos_solicitacoes.sql
--
-- Evolução do módulo Pedidos -- Solicitações internas de compra (V1).
-- NÃO toca em nenhuma tabela/RPC/arquivo da frente Sacos Fechados/Estoque
-- (0041_estoque_movimentacoes_fundacao/0042_producao_sacos_fechados, já
-- aplicadas e pós-auditadas com sucesso -- estoque_movimentacoes,
-- sacos_fechados_movimentacoes, controla_sacos_fechados, peso_por_saco_kg,
-- registrar_abertura_saco, editar_movimentacao_saco) nem nas RPCs
-- fechadas de Pedidos (criar_pedido, receber_pedido, cancelar_pedido,
-- excluir_pedido, reabrir_recebimento_pedido, registrar_compra_
-- presencial, editar_compra_presencial) -- todas permanecem bit-a-bit
-- como estavam. Número seguinte livre para uma futura integração
-- automática Pedidos<->Sacos: 0044 ou posterior (não reservado aqui).
--
-- Arquitetura (auditoria aprovada): uma única tabela nova,
-- public.pedidos_solicitacoes, RLS com política de SELECT apenas (mesmo
-- padrão de public.pedidos -- "sem policy de INSERT/UPDATE/DELETE direto,
-- toda escrita passa por RPC SECURITY DEFINER"). produto_id é referência
-- AUXILIAR nullable (on delete set null, mesmo padrão de
-- pedido_itens.produto_id) -- descricao/unidade são sempre SNAPSHOT,
-- nunca recalculados a partir do cadastro atual do produto. pedido_id
-- nullable diretamente na solicitação permite N solicitações -> 1 pedido
-- (agrupamento futuro) sem tabela associativa -- mas, diferente de
-- produto_id, usa ON DELETE RESTRICT (não SET NULL): uma solicitação
-- REALIZADA POR MEIO DE UM PEDIDO precisa preservar permanentemente qual
-- pedido a realizou -- excluir esse pedido depois (via excluir_pedido,
-- que só apaga aguardando_entrega) precisa ser bloqueado pela FK, nunca
-- silenciosamente desvincular a solicitação. "Realizada sem pedido"
-- (pedido_id NULL) continua um estado válido -- só surge por uma via
-- diferente (marcar_solicitacao_realizada), nunca por uma exclusão de
-- pedido depois do fato.

-- ============================================================
-- 1. TABELA public.pedidos_solicitacoes
-- ============================================================
create table public.pedidos_solicitacoes (
  id                     uuid primary key default gen_random_uuid(),

  -- Referência AUXILIAR (mesmo raciocínio de pedido_itens.produto_id):
  -- se o produto for removido do Catálogo depois, a solicitação
  -- histórica sobrevive intacta, só perde o vínculo. A fonte de verdade
  -- de "o que foi pedido" é sempre descricao/unidade, nunca este campo.
  produto_id             uuid references public.produtos(id) on delete set null,

  -- Snapshot no momento da criação/edição -- nome do produto (quando
  -- produto_id preenchido) OU texto livre digitado pelo solicitante
  -- (quando não cadastrado). Nunca recalculado a partir de produtos.nome.
  descricao              text not null,

  -- Snapshot de produtos.unidade_medida quando produto_id preenchido;
  -- NULL quando não cadastrado (não pedimos essa informação do
  -- solicitante nesse caso -- V1 simples, ver auditoria seção 6).
  unidade                text,

  quantidade             numeric(12,3) not null,

  -- "Solicitado em" -- SEMPRE vem do frontend (dataLocalHoje(), mesma
  -- fonte única de verdade já usada em pedidos.data_pedido/
  -- agenda_itens.data_inicio) -- nunca current_date do Postgres
  -- (Supabase roda em UTC, divergiria do dia operacional real da
  -- Padoca). Editável -- não é necessariamente "agora".
  data_solicitacao       date not null,

  observacao             text,

  status                 text not null default 'pendente',

  -- Vínculo com o pedido gerado a partir desta solicitação (seção 19 da
  -- auditoria: nullable direto aqui, sem tabela associativa -- permite
  -- N solicitações -> 1 pedido nativamente, sem UNIQUE). ON DELETE
  -- RESTRICT (decisão revisada -- NÃO SET NULL): uma solicitação
  -- realizada por meio de um pedido precisa preservar PERMANENTEMENTE
  -- qual pedido a realizou. excluir_pedido() (0025) só apaga pedido
  -- ainda aguardando_entrega -- se isso acontecer com um pedido nascido
  -- de uma solicitação, a exclusão deve ser BLOQUEADA pela FK, nunca
  -- desvincular a solicitação silenciosamente (o estado
  -- status='realizada' + pedido_id=NULL só é válido quando alcançado por
  -- marcar_solicitacao_realizada -- "realizada sem pedido" de propósito
  -- -- nunca como efeito colateral de uma exclusão de pedido). Se um dia
  -- for necessário tratar essa exclusão de outra forma, será decisão
  -- explícita de outra migration -- não se altera excluir_pedido() aqui.
  pedido_id              uuid references public.pedidos(id) on delete restrict,

  realizado_em           timestamptz,
  realizado_por          uuid references auth.users(id),

  -- Observação do administrativo ao concluir SEM pedido (seção 26) --
  -- campo distinto de `observacao` (que é do solicitante), mesmo
  -- raciocínio de agenda_itens.observacao_conclusao vs. descricao.
  observacao_realizacao  text,

  -- Autoria/timestamps -- nunca vindos do cliente (trigger
  -- pedidos_solicitacoes_protecao, seção 3). Sem atualizado_por: nenhuma
  -- tabela recente do projeto (pedidos, agenda_itens, agenda_ocorrencias)
  -- tem essa coluna -- "quem alterou o quê" fica em logs_auditoria
  -- (mesmo padrão já usado em alterar_ocorrencia_agenda), não numa
  -- coluna própria.
  criado_por             uuid not null references auth.users(id),
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz,

  constraint pedidos_solicitacoes_status_check
    check (status in ('pendente', 'realizada')),

  constraint pedidos_solicitacoes_descricao_nao_vazia_check
    check (btrim(descricao) <> ''),

  constraint pedidos_solicitacoes_quantidade_positiva_check
    check (quantidade > 0),

  -- Única constraint de coerência de ciclo de vida necessária (seção 10):
  -- pendente exige realizado_em/realizado_por/pedido_id todos NULL;
  -- realizada exige realizado_em/realizado_por preenchidos (pedido_id
  -- pode ou não estar preenchido -- "marcar realizada sem pedido" é
  -- válido). Como status só tem 2 valores, isto já implica sozinho
  -- "pedido_id preenchido -> status=realizada" (não precisa de uma
  -- segunda constraint redundante para isso).
  constraint pedidos_solicitacoes_realizacao_coerente_check
    check (
      (status = 'realizada' and realizado_em is not null and realizado_por is not null)
      or (status = 'pendente' and realizado_em is null and realizado_por is null and pedido_id is null)
    )
);

comment on table public.pedidos_solicitacoes is
  'Solicitação interna de compra (V1) -- "precisamos comprar isso", registrada por um funcionário autorizado e tratada pelo administrativo. NÃO é um pedido -- não gera nenhum efeito em public.pedidos/pedido_itens até que o administrativo explicitamente crie um pedido a partir dela (ver concluir_solicitacao_com_pedido) ou a marque realizada sem pedido (marcar_solicitacao_realizada). Família de permissões pedidos_solicitacoes.* totalmente independente de pedidos.* -- um funcionário pode solicitar sem nunca ter acesso a Pedidos. Sem policy de INSERT/UPDATE/DELETE para authenticated (mesmo padrão de public.pedidos) -- toda escrita passa por RPC SECURITY DEFINER (seção 4). Sem status "cancelada": uma solicitação pendente sem pedido vinculado é excluída fisicamente (excluir_solicitacao_pendente) em vez de arquivada -- decisão deliberada para não acumular histórico operacional de baixo valor (seção 11 da auditoria aprovada).';

comment on column public.pedidos_solicitacoes.produto_id is
  'Referência AUXILIAR ao Catálogo (public.produtos) -- nullable, on delete set null. NULL = solicitação de item não cadastrado (descricao é texto livre). Nunca é a fonte de verdade do que foi solicitado -- ver descricao/unidade.';

comment on column public.pedidos_solicitacoes.pedido_id is
  'Pedido gerado a partir desta solicitação, quando aplicável. ON DELETE RESTRICT -- excluir um pedido vinculado a uma solicitação realizada é bloqueado (nunca desvincula silenciosamente); "realizada sem pedido" (NULL) só surge via marcar_solicitacao_realizada, nunca como efeito colateral de exclusão de pedido. Nullable mesmo com status=realizada por esse motivo. Múltiplas solicitações podem compartilhar o mesmo pedido_id (agrupamento futuro, V2) -- por isso NÃO existe UNIQUE(pedido_id) aqui.';

create index pedidos_solicitacoes_status_data_idx
  on public.pedidos_solicitacoes (status, data_solicitacao);

create index pedidos_solicitacoes_produto_id_idx
  on public.pedidos_solicitacoes (produto_id);

create index pedidos_solicitacoes_pedido_id_idx
  on public.pedidos_solicitacoes (pedido_id);


-- ============================================================
-- 2. SEED -- novos códigos no catálogo de permissões
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('pedidos_solicitacoes.visualizar', 'pedidos_solicitacoes', 'visualizar', 'Ver solicitações internas de compra.'),
  ('pedidos_solicitacoes.inserir',    'pedidos_solicitacoes', 'inserir',    'Criar uma nova solicitação interna de compra, via criar_solicitacao_pedido().'),
  ('pedidos_solicitacoes.editar',     'pedidos_solicitacoes', 'editar',     'Editar qualquer solicitação ainda pendente (não é restrito a "minhas solicitações").'),
  ('pedidos_solicitacoes.excluir',    'pedidos_solicitacoes', 'excluir',    'Excluir definitivamente qualquer solicitação ainda pendente e sem pedido vinculado.'),
  ('pedidos_solicitacoes.realizar',   'pedidos_solicitacoes', 'realizar',   'Marcar uma solicitação como realizada (com ou sem pedido vinculado).');

-- proprietario_admin preserva "acesso total" -- mesmo padrão exato de
-- todo código novo desde a migration 0016 (seed original da 0001 não é
-- retroativo). Nenhum outro perfil recebe por padrão.
insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo like 'pedidos_solicitacoes.%';


-- ============================================================
-- 3. TRIGGER DE PROTEÇÃO
-- ============================================================
-- Mesmo espírito de pedidos_protecao (0022)/agenda_itens_protecao
-- (0038): defesa em profundidade -- como não existe NENHUMA policy de
-- INSERT/UPDATE/DELETE para authenticated nesta tabela, só as RPCs
-- SECURITY DEFINER conseguem escrever aqui de qualquer forma; esta
-- trigger garante que, MESMO que uma RPC futura erre ou que alguém tente
-- um UPDATE bruto como owner, autoria/status/realizado_em/realizado_por
-- nunca são falsificáveis e uma solicitação já realizada nunca é
-- alterada de novo (não existe reabertura na V1).
create or replace function public.pedidos_solicitacoes_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    -- Uma solicitação nunca nasce realizada, qualquer que seja o valor
    -- enviado no payload.
    new.status := 'pendente';
    new.realizado_em := null;
    new.realizado_por := null;
    new.pedido_id := null;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id then
    raise exception 'pedidos_solicitacoes: id e imutavel.';
  end if;
  if new.criado_por is distinct from old.criado_por then
    raise exception 'pedidos_solicitacoes: criado_por e imutavel.';
  end if;
  if new.criado_em is distinct from old.criado_em then
    raise exception 'pedidos_solicitacoes: criado_em e imutavel.';
  end if;

  new.atualizado_em := now();

  -- Solicitação já realizada é terminal -- nenhum UPDATE passa daqui pra
  -- frente (nem edição de conteúdo, nem uma segunda tentativa de
  -- realizar/vincular pedido -- essas tentativas são responsabilidade
  -- das próprias RPCs rejeitarem ANTES de chegar aqui com uma mensagem
  -- de erro específica; esta trigger é só a rede de segurança final).
  if old.status = 'realizada' then
    raise exception 'pedidos_solicitacoes: solicitacao % ja esta realizada, nao pode ser alterada.', old.id;
  end if;

  if new.status <> old.status then
    -- Única transição possível a partir daqui: pendente -> realizada
    -- (old.status='realizada' já foi bloqueado acima; o CHECK de status
    -- já impede qualquer outro valor).
    if not (select public.has_permissao('pedidos_solicitacoes.realizar')) then
      raise exception 'pedidos_solicitacoes: marcar como realizada requer a permissao pedidos_solicitacoes.realizar.';
    end if;

    -- Nunca confia no cliente/RPC para estes 2 campos.
    new.realizado_em := now();
    new.realizado_por := auth.uid();

    -- Realizar (com ou sem pedido) só pode tocar status/realizado_em/
    -- realizado_por/pedido_id/observacao_realizacao/atualizado_em --
    -- nada do conteúdo original da solicitação muda nesta transição
    -- (mesma filosofia de "separação atômica" de pedidos_protecao ao
    -- marcar recebido/cancelado).
    if new.produto_id is distinct from old.produto_id
      or new.descricao is distinct from old.descricao
      or new.unidade is distinct from old.unidade
      or new.quantidade is distinct from old.quantidade
      or new.data_solicitacao is distinct from old.data_solicitacao
      or new.observacao is distinct from old.observacao
    then
      raise exception 'pedidos_solicitacoes: a transicao para realizada nao pode alterar o conteudo original da solicitacao %.', old.id;
    end if;
  else
    -- Edição comum (ainda pendente) -- exige pedidos_solicitacoes.editar,
    -- e não pode tocar em nenhum campo de realização (que só a transição
    -- acima pode preencher).
    if not (select public.has_permissao('pedidos_solicitacoes.editar')) then
      raise exception 'pedidos_solicitacoes: editar requer a permissao pedidos_solicitacoes.editar.';
    end if;

    if new.realizado_em is distinct from old.realizado_em
      or new.realizado_por is distinct from old.realizado_por
      or new.pedido_id is distinct from old.pedido_id
      or new.observacao_realizacao is distinct from old.observacao_realizacao
    then
      raise exception 'pedidos_solicitacoes: edicao comum nao pode alterar campos de realizacao.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.pedidos_solicitacoes_protecao() is
  'BEFORE INSERT/UPDATE em pedidos_solicitacoes. INSERT: forca criado_por/criado_em/atualizado_em e garante que a linha nunca nasce realizada. UPDATE: id/criado_por/criado_em imutaveis; uma solicitacao ja realizada e terminal (nenhum UPDATE prossegue); a transicao pendente->realizada exige pedidos_solicitacoes.realizar, forca realizado_em=now()/realizado_por=auth.uid() (nunca confia no cliente) e nao pode alterar o conteudo original da solicitacao; uma edicao comum (permanece pendente) exige pedidos_solicitacoes.editar e nao pode tocar nos campos de realizacao. Defesa em profundidade -- a tabela nao tem NENHUMA policy de INSERT/UPDATE/DELETE para authenticated, entao só uma RPC SECURITY DEFINER chega a este ponto de qualquer forma.';

revoke execute on function public.pedidos_solicitacoes_protecao() from public;
revoke execute on function public.pedidos_solicitacoes_protecao() from anon;
revoke execute on function public.pedidos_solicitacoes_protecao() from authenticated;
revoke execute on function public.pedidos_solicitacoes_protecao() from service_role;

drop trigger if exists pedidos_solicitacoes_protecao_trigger on public.pedidos_solicitacoes;
create trigger pedidos_solicitacoes_protecao_trigger
  before insert or update on public.pedidos_solicitacoes
  for each row
  execute function public.pedidos_solicitacoes_protecao();


-- ============================================================
-- 4. RLS -- SOMENTE SELECT; toda escrita via RPC (seção 5)
-- ============================================================
alter table public.pedidos_solicitacoes enable row level security;

drop policy if exists pedidos_solicitacoes_select on public.pedidos_solicitacoes;
create policy pedidos_solicitacoes_select on public.pedidos_solicitacoes
  for select to authenticated
  using ((select public.has_permissao('pedidos_solicitacoes.visualizar')));

-- Deliberadamente SEM policy de INSERT/UPDATE/DELETE -- mesmo padrão de
-- public.pedidos (0022): a única forma de escrever é através das RPCs
-- SECURITY DEFINER abaixo, que rodam como o owner (bypassa RLS por não
-- haver FORCE ROW LEVEL SECURITY nesta tabela) e fazem sua própria
-- checagem explícita de permissão.


-- ============================================================
-- 5. RPCs -- única superfície de escrita
-- ============================================================

-- 5.1 criar_solicitacao_pedido -- único caminho de INSERT.
create or replace function public.criar_solicitacao_pedido(
  p_produto_id       uuid,
  p_descricao_livre  text,
  p_quantidade       numeric,
  p_data_solicitacao date,
  p_observacao       text
)
returns public.pedidos_solicitacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produto      public.produtos%rowtype;
  v_descricao    text;
  v_unidade      text;
  v_solicitacao  public.pedidos_solicitacoes;
begin
  if auth.uid() is null then
    raise exception 'criar_solicitacao_pedido: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos_solicitacoes.inserir')) then
    raise exception 'criar_solicitacao_pedido: requer a permissao pedidos_solicitacoes.inserir.';
  end if;

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'criar_solicitacao_pedido: quantidade deve ser maior que zero.';
  end if;

  if p_data_solicitacao is null then
    raise exception 'criar_solicitacao_pedido: data_solicitacao e obrigatoria.';
  end if;

  -- Snapshot SEMPRE derivado do banco (seção 16) -- nunca confia no
  -- frontend para descricao/unidade de um produto_id preenchido, mesmo
  -- que o valor "pareça" certo no payload.
  if p_produto_id is not null then
    select * into v_produto from public.produtos where id = p_produto_id;
    if v_produto.id is null then
      raise exception 'criar_solicitacao_pedido: produto % nao encontrado.', p_produto_id;
    end if;
    v_descricao := v_produto.nome;
    v_unidade := v_produto.unidade_medida;
  else
    v_descricao := btrim(coalesce(p_descricao_livre, ''));
    if v_descricao = '' then
      raise exception 'criar_solicitacao_pedido: informe uma descricao para produto nao cadastrado.';
    end if;
    v_unidade := null;
  end if;

  insert into public.pedidos_solicitacoes (
    produto_id, descricao, unidade, quantidade, data_solicitacao, observacao
  ) values (
    p_produto_id, v_descricao, v_unidade, p_quantidade, p_data_solicitacao,
    nullif(btrim(coalesce(p_observacao, '')), '')
  )
  returning * into v_solicitacao;

  return v_solicitacao;
end;
$$;

comment on function public.criar_solicitacao_pedido(uuid, text, numeric, date, text) is
  'Cria uma solicitacao interna de compra. p_produto_id preenchido: descricao/unidade sao SEMPRE derivados de public.produtos no momento da chamada (nunca confia no frontend) -- snapshot imutavel depois. p_produto_id NULL: exige p_descricao_livre nao vazia (produto nao cadastrado), unidade fica NULL. Sem auditoria de criacao em logs_auditoria -- criado_por/criado_em ja capturam quem/quando (mesmo padrao de criar_pedido, 0022). SECURITY DEFINER -- unico jeito de escrever nesta tabela (sem policy de INSERT).';

revoke execute on function public.criar_solicitacao_pedido(uuid, text, numeric, date, text) from public;
revoke execute on function public.criar_solicitacao_pedido(uuid, text, numeric, date, text) from anon;
revoke execute on function public.criar_solicitacao_pedido(uuid, text, numeric, date, text) from service_role;
grant execute on function public.criar_solicitacao_pedido(uuid, text, numeric, date, text) to authenticated;


-- 5.2 editar_solicitacao_pedido -- único caminho de UPDATE de conteúdo,
-- só enquanto pendente. Loga em logs_auditoria por campo (mesmo padrão
-- de alterar_ocorrencia_agenda, migration 0038) -- é onde "quem
-- atualizou o quê" fica registrado (esta tabela não tem atualizado_por).
create or replace function public.editar_solicitacao_pedido(
  p_id               uuid,
  p_produto_id       uuid,
  p_descricao_livre  text,
  p_quantidade       numeric,
  p_data_solicitacao date,
  p_observacao       text
)
returns public.pedidos_solicitacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes        public.pedidos_solicitacoes;
  v_depois       public.pedidos_solicitacoes;
  v_produto      public.produtos%rowtype;
  v_descricao    text;
  v_unidade      text;
  v_observacao   text;
  v_registro_id  text;
begin
  if not (select public.has_permissao('pedidos_solicitacoes.editar')) then
    raise exception 'editar_solicitacao_pedido: requer a permissao pedidos_solicitacoes.editar.';
  end if;

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'editar_solicitacao_pedido: quantidade deve ser maior que zero.';
  end if;

  if p_data_solicitacao is null then
    raise exception 'editar_solicitacao_pedido: data_solicitacao e obrigatoria.';
  end if;

  select * into v_antes from public.pedidos_solicitacoes where id = p_id for update;
  if v_antes.id is null then
    raise exception 'editar_solicitacao_pedido: solicitacao % nao encontrada.', p_id;
  end if;

  if v_antes.status <> 'pendente' then
    raise exception 'editar_solicitacao_pedido: somente solicitacoes pendentes podem ser editadas.';
  end if;

  if p_produto_id is not null then
    select * into v_produto from public.produtos where id = p_produto_id;
    if v_produto.id is null then
      raise exception 'editar_solicitacao_pedido: produto % nao encontrado.', p_produto_id;
    end if;
    v_descricao := v_produto.nome;
    v_unidade := v_produto.unidade_medida;
  else
    v_descricao := btrim(coalesce(p_descricao_livre, ''));
    if v_descricao = '' then
      raise exception 'editar_solicitacao_pedido: informe uma descricao para produto nao cadastrado.';
    end if;
    v_unidade := null;
  end if;

  v_observacao := nullif(btrim(coalesce(p_observacao, '')), '');
  v_registro_id := p_id::text;

  update public.pedidos_solicitacoes
  set produto_id = p_produto_id,
      descricao = v_descricao,
      unidade = v_unidade,
      quantidade = p_quantidade,
      data_solicitacao = p_data_solicitacao,
      observacao = v_observacao
  where id = p_id
  returning * into v_depois;

  if v_antes.descricao is distinct from v_depois.descricao then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido_solicitacao', v_registro_id, 'editou', 'descricao', v_antes.descricao, v_depois.descricao);
  end if;
  if v_antes.quantidade is distinct from v_depois.quantidade then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido_solicitacao', v_registro_id, 'editou', 'quantidade', v_antes.quantidade::text, v_depois.quantidade::text);
  end if;
  if v_antes.data_solicitacao is distinct from v_depois.data_solicitacao then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido_solicitacao', v_registro_id, 'editou', 'data_solicitacao', v_antes.data_solicitacao::text, v_depois.data_solicitacao::text);
  end if;
  if v_antes.observacao is distinct from v_depois.observacao then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido_solicitacao', v_registro_id, 'editou', 'observacao', v_antes.observacao, v_depois.observacao);
  end if;

  return v_depois;
end;
$$;

comment on function public.editar_solicitacao_pedido(uuid, uuid, text, numeric, date, text) is
  'Edita o conteudo de uma solicitacao AINDA pendente (rejeita se ja realizada). Mesma logica de snapshot de produto_id de criar_solicitacao_pedido -- nunca confia no frontend para descricao/unidade quando produto_id vem preenchido. Nao restrita a "minhas solicitacoes" -- qualquer usuario com pedidos_solicitacoes.editar pode editar qualquer pendente (decisao aprovada). Registra em logs_auditoria 1 linha por campo que de fato mudou (descricao/quantidade/data_solicitacao/observacao), null-safe -- nenhuma linha se nada mudou. SECURITY DEFINER -- unico jeito de escrever nesta tabela.';

revoke execute on function public.editar_solicitacao_pedido(uuid, uuid, text, numeric, date, text) from public;
revoke execute on function public.editar_solicitacao_pedido(uuid, uuid, text, numeric, date, text) from anon;
revoke execute on function public.editar_solicitacao_pedido(uuid, uuid, text, numeric, date, text) from service_role;
grant execute on function public.editar_solicitacao_pedido(uuid, uuid, text, numeric, date, text) to authenticated;


-- 5.3 excluir_solicitacao_pendente -- único caminho de DELETE.
create or replace function public.excluir_solicitacao_pendente(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solicitacao public.pedidos_solicitacoes;
begin
  if not (select public.has_permissao('pedidos_solicitacoes.excluir')) then
    raise exception 'excluir_solicitacao_pendente: requer a permissao pedidos_solicitacoes.excluir.';
  end if;

  select * into v_solicitacao from public.pedidos_solicitacoes where id = p_id for update;
  if v_solicitacao.id is null then
    raise exception 'excluir_solicitacao_pendente: solicitacao % nao encontrada.', p_id;
  end if;

  -- Redundante com a constraint pedidos_solicitacoes_realizacao_coerente_check
  -- (pendente ja implica pedido_id null), mas checado explicitamente aqui
  -- para uma mensagem de erro clara em vez de deixar vazar um erro de
  -- constraint (nunca deveria acontecer de qualquer forma, dado o CHECK).
  if v_solicitacao.status <> 'pendente' or v_solicitacao.pedido_id is not null then
    raise exception 'excluir_solicitacao_pendente: somente solicitacoes pendentes e sem pedido vinculado podem ser excluidas.';
  end if;

  -- Log ANTES do DELETE -- mesma tecnica de reabrir_ocorrencia_agenda
  -- (0038): depois da linha ser apagada nao ha mais nada pra capturar.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('pedido_solicitacao', p_id::text, 'excluiu', 'descricao', v_solicitacao.descricao, null);

  delete from public.pedidos_solicitacoes where id = p_id;
end;
$$;

comment on function public.excluir_solicitacao_pendente(uuid) is
  'Exclui DEFINITIVAMENTE uma solicitacao ainda pendente e sem pedido vinculado -- nunca uma ja realizada/vinculada (mesmo com status ainda no banco mostrando algo diferente por algum motivo, checado explicitamente, redundante de proposito com o CHECK da tabela). Registra em logs_auditoria (acao=excluiu) ANTES do DELETE, unica forma de preservar o que foi excluido. SECURITY DEFINER -- unico jeito de excluir desta tabela (sem policy de DELETE).';

revoke execute on function public.excluir_solicitacao_pendente(uuid) from public;
revoke execute on function public.excluir_solicitacao_pendente(uuid) from anon;
revoke execute on function public.excluir_solicitacao_pendente(uuid) from service_role;
grant execute on function public.excluir_solicitacao_pendente(uuid) to authenticated;


-- 5.4 marcar_solicitacao_realizada -- "realizada" SEM pedido (seção 26).
-- CONCORRÊNCIA: UPDATE condicional (WHERE status='pendente'), mesmo
-- mecanismo aprovado para concluir_tarefa_agenda (migration 0039) --
-- uma segunda tentativa concorrente encontra 0 linhas afetadas e é
-- rejeitada explicitamente, nunca duas conclusões nem log duplicado.
create or replace function public.marcar_solicitacao_realizada(
  p_id uuid,
  p_observacao_realizacao text
)
returns public.pedidos_solicitacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_depois public.pedidos_solicitacoes;
begin
  if not (select public.has_permissao('pedidos_solicitacoes.realizar')) then
    raise exception 'marcar_solicitacao_realizada: requer a permissao pedidos_solicitacoes.realizar.';
  end if;

  update public.pedidos_solicitacoes
  set status = 'realizada',
      observacao_realizacao = nullif(btrim(coalesce(p_observacao_realizacao, '')), '')
  where id = p_id
    and status = 'pendente'
  returning * into v_depois;

  if v_depois.id is null then
    if not exists (select 1 from public.pedidos_solicitacoes where id = p_id) then
      raise exception 'marcar_solicitacao_realizada: solicitacao % nao encontrada.', p_id;
    end if;
    raise exception 'marcar_solicitacao_realizada: esta solicitacao ja esta realizada.';
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('pedido_solicitacao', p_id::text, 'realizou', 'status', 'pendente', 'realizada');

  return v_depois;
end;
$$;

comment on function public.marcar_solicitacao_realizada(uuid, text) is
  'Marca uma solicitacao pendente como realizada SEM vincular pedido (ex.: item comprado diretamente por outro meio). pedido_id permanece NULL. observacao_realizacao opcional. CONCORRENCIA: UPDATE condicional (WHERE status=pendente) -- uma segunda chamada concorrente encontra a solicitacao ja realizada e e rejeitada explicitamente (nunca sucesso silencioso, nunca log duplicado). realizado_em/realizado_por preenchidos pela trigger pedidos_solicitacoes_protecao. SECURITY DEFINER -- unico jeito de escrever nesta tabela.';

revoke execute on function public.marcar_solicitacao_realizada(uuid, text) from public;
revoke execute on function public.marcar_solicitacao_realizada(uuid, text) from anon;
revoke execute on function public.marcar_solicitacao_realizada(uuid, text) from service_role;
grant execute on function public.marcar_solicitacao_realizada(uuid, text) to authenticated;


-- 5.5 concluir_solicitacao_com_pedido -- vincula um pedido JÁ CRIADO
-- (pelo fluxo normal do frontend, via criar_pedido/registrar_compra_
-- presencial, RPCs INALTERADAS) e marca a solicitação como realizada.
-- IDEMPOTENTE para a MESMA (solicitacao_id, pedido_id) -- seção 23:
-- permite retry seguro do fluxo de recuperação da seção 22 sem nunca
-- criar um segundo vínculo nem um segundo log.
create or replace function public.concluir_solicitacao_com_pedido(
  p_id        uuid,
  p_pedido_id uuid
)
returns public.pedidos_solicitacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes  public.pedidos_solicitacoes;
  v_depois public.pedidos_solicitacoes;
begin
  if not (select public.has_permissao('pedidos_solicitacoes.realizar')) then
    raise exception 'concluir_solicitacao_com_pedido: requer a permissao pedidos_solicitacoes.realizar.';
  end if;

  if p_pedido_id is null then
    raise exception 'concluir_solicitacao_com_pedido: pedido_id e obrigatorio.';
  end if;

  if not exists (select 1 from public.pedidos where id = p_pedido_id) then
    raise exception 'concluir_solicitacao_com_pedido: pedido % nao encontrado.', p_pedido_id;
  end if;

  select * into v_antes from public.pedidos_solicitacoes where id = p_id for update;
  if v_antes.id is null then
    raise exception 'concluir_solicitacao_com_pedido: solicitacao % nao encontrada.', p_id;
  end if;

  -- IDEMPOTENCIA (secao 23 da auditoria + secao 7 da revisao aprovada):
  --   A) pendente + pedido X -> realiza/vincula (cai no UPDATE abaixo).
  --   B) ja realizada + MESMO pedido X -> sucesso idempotente, devolve o
  --      estado atual sem tocar em nada de novo (nenhum log duplicado).
  --   C) ja realizada + pedido Y DIFERENTE -> erro explicito.
  --   D) ja realizada SEM pedido (pedido_id NULL) -> NAO pode receber um
  --      pedido depois "silenciosamente" -- tambem erro explicito (bloqueado
  --      por definicao: v_antes.pedido_id IS NULL nunca satisfaz
  --      "v_antes.pedido_id = p_pedido_id", pois NULL = qualquer_coisa
  --      nunca e TRUE em SQL -- cai direto no ramo de erro, com mensagem
  --      dedicada distinguindo esse caso do caso C).
  if v_antes.status = 'realizada' then
    if v_antes.pedido_id = p_pedido_id then
      return v_antes;
    end if;
    if v_antes.pedido_id is null then
      raise exception 'concluir_solicitacao_com_pedido: esta solicitacao ja foi marcada realizada SEM pedido -- nao pode receber um pedido vinculado depois. Se isso foi um engano, trate manualmente.';
    end if;
    raise exception 'concluir_solicitacao_com_pedido: esta solicitacao ja esta realizada e vinculada a um pedido diferente.';
  end if;

  update public.pedidos_solicitacoes
  set status = 'realizada',
      pedido_id = p_pedido_id
  where id = p_id
    and status = 'pendente'
  returning * into v_depois;

  if v_depois.id is null then
    -- Corrida real: outra transacao concluiu entre o SELECT FOR UPDATE
    -- acima e este UPDATE nao deveria ser possivel (o FOR UPDATE ja
    -- serializa), mas o guard fica aqui por seguranca -- nunca confia
    -- silenciosamente em "0 linhas" sem checar de novo o estado real.
    select * into v_depois from public.pedidos_solicitacoes where id = p_id;
    if v_depois.status = 'realizada' and v_depois.pedido_id = p_pedido_id then
      return v_depois;
    end if;
    raise exception 'concluir_solicitacao_com_pedido: nao foi possivel concluir a solicitacao (estado mudou durante a operacao). Recarregue e tente novamente.';
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('pedido_solicitacao', p_id::text, 'realizou', 'status', 'pendente', 'realizada');

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('pedido_solicitacao', p_id::text, 'realizou', 'pedido_id', null, p_pedido_id::text);

  return v_depois;
end;
$$;

comment on function public.concluir_solicitacao_com_pedido(uuid, uuid) is
  'Vincula um pedido JA CRIADO (por criar_pedido/registrar_compra_presencial, RPCs inalteradas -- esta funcao NUNCA cria pedido) a uma solicitacao e a marca realizada. IDEMPOTENTE para a mesma (id, pedido_id): chamar de novo com o MESMO pedido_id em uma solicitacao ja realizada com esse pedido retorna sucesso sem duplicar nada. Chamar com um pedido_id DIFERENTE, OU quando a solicitacao ja foi realizada SEM nenhum pedido, e rejeitado explicitamente nos dois casos (mensagens distintas) -- nunca vincula um pedido "silenciosamente" depois do fato. SECURITY DEFINER -- unico jeito de escrever nesta tabela.';

revoke execute on function public.concluir_solicitacao_com_pedido(uuid, uuid) from public;
revoke execute on function public.concluir_solicitacao_com_pedido(uuid, uuid) from anon;
revoke execute on function public.concluir_solicitacao_com_pedido(uuid, uuid) from service_role;
grant execute on function public.concluir_solicitacao_com_pedido(uuid, uuid) to authenticated;
