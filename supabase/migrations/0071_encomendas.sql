-- 0071_encomendas.sql
-- CLIENTES > ENCOMENDAS | PADOCA DA MATA -- registro simples de encomendas
-- de clientes (cliente, retirada em data/hora, itens do Catalogo com
-- quantidade e comentario livre, data do pedido, status). Sem preco,
-- pagamento, entrega, estoque, producao automatica ou WhatsApp.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria (pre_auditoria_0071_encomendas_EXECUTAR.sql).
--
-- ============================================================
-- DIAGNOSTICO QUE FUNDAMENTA ESTA MIGRATION (codigo/schema real)
-- ============================================================
--   * Clientes (0069/0070, publicada): public.clientes (nome MAIUSCULAS,
--     telefone so digitos UNICO, ativo), escrita so por salvar_cliente /
--     definir_status_cliente. Esta migration NAO altera nada de Clientes:
--     o cadastro rapido de cliente dentro da encomenda chama a MESMA RPC
--     salvar_cliente (mesmas regras de nome/telefone/duplicidade).
--   * Agenda (0038/0039): agenda_itens/agenda_ocorrencias com escrita
--     direta via RLS (agenda.inserir/editar/excluir). Aniversarios de
--     funcionarios JA sao uma projecao: nunca gravados em agenda_itens,
--     sintetizados no navegador a partir de funcionarios.data_nascimento
--     e expandidos pela mesma lib/agenda/expandirRecorrencia.js.
--   * Dashboard: o card "Agenda de hoje" usa as MESMAS consultas da
--     Agenda (lib/agenda/consultasAgenda.js) + resumo puro
--     (lib/agenda/resumoDoDia.js); nao ha tabela de alertas da Agenda.
--     (dashboard_lembretes, 0021, e o post-it manual -- outra coisa.)
--
-- ============================================================
-- ARQUITETURA ENCOMENDAS x AGENDA x DASHBOARD
-- ============================================================
--   * FONTE UNICA DE VERDADE = public.encomendas. A Agenda e o Dashboard
--     PROJETAM a encomenda (mesmo padrao dos aniversarios): nada e gravado
--     em agenda_itens/agenda_ocorrencias, nenhum trigger sincroniza nada.
--     Consequencias por construcao: nao existe evento orfao, duplicado ou
--     divergente; mudar data/hora/status da encomenda muda a Agenda e o
--     lembrete na proxima leitura. Nenhum objeto da Agenda e alterado.
--   * Leitura pela RPC listar_encomendas(inicio, fim) (encomendas.visualizar)
--     -- a mesma funcao alimenta a tela de Encomendas, a Agenda e o
--     Dashboard (nome/telefone do cliente vem junto, sem exigir
--     clientes.visualizar de quem so cuida de encomendas).
--   * LEMBRETE PADRAO (regra do modulo, sem escolha do usuario): toda
--     encomenda PENDENTE gera, no Dashboard (card "Agenda de hoje"), um
--     lembrete no DIA ANTERIOR a data de retirada; no proprio dia ela
--     aparece como compromisso com horario. Calculado na leitura (sem
--     tabela de lembretes): cancelada/concluida nao geram lembrete,
--     mudar a data move o lembrete, encomenda criada para o mesmo dia
--     nao gera lembrete retroativo. Detalhado em lib/encomendas/agenda.js.
--
-- ============================================================
-- PRODUTO ENCOMENDAVEL (conceito diferente de "interesse de cliente")
-- ============================================================
--   * public.produtos ganha disponivel_encomenda boolean NOT NULL DEFAULT
--     false -- FONTE DE VERDADE para NOVOS itens de encomenda, marcada no
--     Catalogo ("Disponivel para encomenda"). Produto novo nunca fica
--     encomendavel sozinho. disponivel_interesse_cliente NAO e reutilizada.
--   * BACKFILL INICIAL (so na execucao que CRIA a coluna -- reexecutar
--     nunca remarca o que o administrador desmarcou): produtos ATIVOS que
--     hoje sao Produto de Producao (receita ativa vinculada,
--     receitas.catalogo_produto_id) -- o que a Padoca faz e, portanto,
--     pode ser encomendado. Revenda/insumo/embalagem ficam de fora; o
--     administrador ajusta produto a produto no Catalogo.
--   * Regra permanente (public.encomendas_produto_elegivel): produto
--     existe, ativo e disponivel_encomenda. Um item ja gravado continua
--     valido se o produto for desmarcado/inativado depois (historico
--     preservado; reaparece identificado na edicao).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   0. public.produtos.disponivel_encomenda + backfill + indice parcial.
--   1. public.encomendas (cliente_id FK restrict, data_retirada,
--      hora_retirada, data_pedido, status pendente/concluida/cancelada,
--      criado/atualizado em/por, status_atualizado_em/por).
--   2. public.encomendas_itens (produto_id FK restrict, quantidade > 0,
--      comentario livre opcional, ordem). Itens sao substituidos em bloco
--      pela RPC de salvar (edicao atomica, mesma transacao).
--   3. RLS: SELECT por encomendas.visualizar; NENHUMA policy de escrita.
--   4. RPCs (SECURITY DEFINER, search_path vazio, EXECUTE so authenticated):
--      salvar_encomenda, definir_status_encomenda, listar_encomendas,
--      buscar_clientes_encomenda, buscar_produtos_encomenda.
--      Helper interno encomendas_produto_elegivel (sem EXECUTE p/ API).
--   5. Permissoes encomendas.visualizar / encomendas.editar, concedidas
--      inicialmente so a proprietario_admin (mesmo padrao de Clientes).
--
-- NAO faz, e nao deve fazer: nenhuma alteracao em clientes/
-- clientes_produtos/funcoes de Clientes, agenda_*, dashboard_lembretes,
-- excluir_produto_catalogo, public.pagamentos (fornecedores/NF-e) ou
-- qualquer tabela de Folha/Pedidos/Producao. Cancelamento e logico
-- (status); nao existe exclusao fisica de encomenda.
--
-- Datas: data_pedido/data_retirada sao datas de calendario da Padoca;
-- "hoje" = (now() at time zone 'America/Sao_Paulo')::date (mesmo idioma
-- de 0026/0037). Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

-- ============================================================
-- 0a. Premissas -- aborta (nada muda) se o estado nao for o esperado.
-- ============================================================
do $$
begin
  if to_regclass('public.clientes') is null or to_regprocedure('public.salvar_cliente(uuid,text,text,text,uuid[])') is null then
    raise exception '0071 abortada: Clientes (0069) nao encontrado.';
  end if;
  if pg_get_function_result(to_regprocedure('public.buscar_produtos_interesse_cliente(text,integer)')) is distinct from 'TABLE(id uuid, nome text)'
     or position('p.nome::text' in (select prosrc from pg_proc where oid = to_regprocedure('public.buscar_produtos_interesse_cliente(text,integer)'))) = 0 then
    raise exception '0071 abortada: a 0070 (busca de produtos com nome::text) nao esta aplicada.';
  end if;
  if to_regclass('public.produtos') is null or to_regclass('public.receitas') is null then
    raise exception '0071 abortada: public.produtos/public.receitas nao encontradas.';
  end if;
  if to_regprocedure('public.has_permissao(text)') is null or to_regclass('public.permissoes') is null
     or to_regclass('public.perfil_permissoes') is null then
    raise exception '0071 abortada: has_permissao/permissoes/perfil_permissoes nao encontrados.';
  end if;
  if not exists (select 1 from public.perfis where nome = 'proprietario_admin') then
    raise exception '0071 abortada: perfil proprietario_admin nao encontrado.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('encomendas', 'encomendas_itens'))
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'encomendas' and column_name = 'hora_retirada') then
    raise exception '0071 abortada: ja existe public.encomendas/encomendas_itens com estrutura desconhecida -- nada foi alterado.';
  end if;
end $$;

-- ============================================================
-- 0b. public.produtos.disponivel_encomenda + backfill inicial (no MESMO
--     bloco da criacao da coluna: so roda quando a coluna nasce).
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'produtos' and column_name = 'disponivel_encomenda') then
    raise notice '0071: produtos.disponivel_encomenda ja existe -- backfill NAO reaplicado.';
    return;
  end if;

  alter table public.produtos
    add column disponivel_encomenda boolean not null default false;

  update public.produtos p
  set disponivel_encomenda = true
  where p.ativo
    and exists (select 1 from public.receitas r where r.catalogo_produto_id = p.id and r.ativo);
end $$;

comment on column public.produtos.disponivel_encomenda is
  'Migration 0071. true = o produto pode entrar em NOVOS itens de encomenda (Clientes > Encomendas). Default false: produto novo so fica encomendavel quando o administrador marca no Catalogo. Desmarcar nao altera encomendas ja registradas. Conceito independente de disponivel_interesse_cliente. Backfill inicial: Produto de Producao (receita ativa) ativo.';

create index if not exists produtos_disponivel_encomenda_idx
  on public.produtos (nome)
  where ativo and disponivel_encomenda;

-- ============================================================
-- 1. public.encomendas
-- ============================================================
create table if not exists public.encomendas (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references public.clientes(id) on delete restrict,
  data_retirada         date not null,
  hora_retirada         time not null,
  data_pedido           date not null,
  status                text not null default 'pendente',
  criado_em             timestamptz not null default now(),
  criado_por            uuid references auth.users(id) on delete set null,
  atualizado_em         timestamptz,
  atualizado_por        uuid references auth.users(id) on delete set null,
  status_atualizado_em  timestamptz,
  status_atualizado_por uuid references auth.users(id) on delete set null,
  constraint encomendas_status_valido
    check (status in ('pendente', 'concluida', 'cancelada')),
  constraint encomendas_pedido_ate_retirada
    check (data_pedido <= data_retirada)
);

comment on table public.encomendas is
  'Migration 0071. Encomenda de um cliente (Clientes > Encomendas): retirada em data_retirada/hora_retirada, data_pedido (quando o pedido foi feito; padrao hoje, editavel para lancamento posterior). FONTE UNICA DE VERDADE -- Agenda e Dashboard so projetam (nada em agenda_itens). status: pendente (participa da Agenda e do lembrete de 1 dia antes) / concluida (fica na Agenda como concluida, sem lembrete) / cancelada (some da Agenda e do lembrete). Cancelamento logico, sem exclusao fisica. Escrita so pelas RPCs salvar_encomenda / definir_status_encomenda.';

create index if not exists encomendas_data_retirada_idx on public.encomendas (data_retirada);
create index if not exists encomendas_cliente_idx on public.encomendas (cliente_id);

-- ============================================================
-- 2. public.encomendas_itens
-- ============================================================
create table if not exists public.encomendas_itens (
  id            uuid primary key default gen_random_uuid(),
  encomenda_id  uuid not null references public.encomendas(id) on delete cascade,
  produto_id    uuid not null references public.produtos(id) on delete restrict,
  quantidade    numeric(12,3) not null,
  comentario    text,
  ordem         integer not null,
  constraint encomendas_itens_quantidade_valida
    check (quantidade > 0 and quantidade <= 99999),
  constraint encomendas_itens_comentario_valido
    check (comentario is null or (btrim(comentario) <> '' and char_length(comentario) <= 500)),
  constraint encomendas_itens_ordem_unica
    unique (encomenda_id, ordem)
);

comment on table public.encomendas_itens is
  'Migration 0071. Itens de uma encomenda: produto do Catalogo, quantidade (> 0; decimal permitido para produtos por KG) e comentario livre opcional (texto como digitado, nunca convertido para maiusculas). O mesmo produto pode aparecer em mais de uma linha (ex.: comentarios diferentes). Substituidos em bloco por salvar_encomenda (mesma transacao). produto_id ON DELETE RESTRICT: produto usado em encomenda nao pode ser excluido do Catalogo (inative-o).';

create index if not exists encomendas_itens_produto_idx on public.encomendas_itens (produto_id);

-- ============================================================
-- 3. RLS -- leitura por encomendas.visualizar; escrita so via RPC.
-- ============================================================
alter table public.encomendas enable row level security;
alter table public.encomendas_itens enable row level security;

drop policy if exists encomendas_select on public.encomendas;
create policy encomendas_select on public.encomendas
  for select to authenticated
  using ((select public.has_permissao('encomendas.visualizar')));

drop policy if exists encomendas_itens_select on public.encomendas_itens;
create policy encomendas_itens_select on public.encomendas_itens
  for select to authenticated
  using ((select public.has_permissao('encomendas.visualizar')));

-- ============================================================
-- 4. Helper interno -- produto pode entrar em NOVO item de encomenda.
-- ============================================================
create or replace function public.encomendas_produto_elegivel(p_produto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.produtos p
    where p.id = p_produto_id and p.ativo and p.disponivel_encomenda
  );
$$;
comment on function public.encomendas_produto_elegivel(uuid) is
  'Migration 0071. true = produto existe, ativo e disponivel_encomenda. Usado so por salvar_encomenda (sem EXECUTE para nenhum papel da API).';
revoke execute on function public.encomendas_produto_elegivel(uuid) from public;
revoke execute on function public.encomendas_produto_elegivel(uuid) from anon;
revoke execute on function public.encomendas_produto_elegivel(uuid) from authenticated;
revoke execute on function public.encomendas_produto_elegivel(uuid) from service_role;

-- ============================================================
-- 5. salvar_encomenda -- cria ou edita (cabecalho + itens) atomicamente.
--    p_itens: jsonb array de { produto_id, quantidade, comentario }.
-- ============================================================
create or replace function public.salvar_encomenda(
  p_encomenda_id   uuid,
  p_cliente_id     uuid,
  p_data_retirada  date,
  p_hora_retirada  time,
  p_data_pedido    date,
  p_itens          jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_status_atual    text;
  v_cliente_atual   uuid;
  v_retirada_atual  date;
  v_cliente     record;
  v_id          uuid;
  v_item        jsonb;
  v_produto     uuid;
  v_quantidade  numeric;
  v_comentario  text;
  v_ordem       integer := 0;
  v_anteriores  uuid[] := '{}';
begin
  if not (select public.has_permissao('encomendas.editar')) then
    raise exception using errcode = '42501',
      message = 'salvar_encomenda: requer a permissao encomendas.editar.';
  end if;

  if p_encomenda_id is not null then
    select e.status, e.cliente_id, e.data_retirada into v_status_atual, v_cliente_atual, v_retirada_atual
    from public.encomendas e where e.id = p_encomenda_id for update;
    if v_status_atual is null then
      raise exception 'salvar_encomenda: encomenda % nao encontrada.', p_encomenda_id;
    end if;
    if v_status_atual <> 'pendente' then
      raise exception 'salvar_encomenda: so encomendas pendentes podem ser editadas (reabra a encomenda antes).';
    end if;
    select coalesce(array_agg(produto_id), '{}') into v_anteriores
    from public.encomendas_itens where encomenda_id = p_encomenda_id;
  end if;

  -- Cliente: precisa existir; NOVA encomenda (ou troca de cliente) exige
  -- cliente ativo. Manter o mesmo cliente ja inativado e permitido.
  select c.id, c.ativo into v_cliente from public.clientes c where c.id = p_cliente_id;
  if v_cliente.id is null then
    raise exception 'salvar_encomenda: informe o cliente.';
  end if;
  if not v_cliente.ativo and v_cliente_atual is distinct from p_cliente_id then
    raise exception 'salvar_encomenda: cliente inativo -- reative o cadastro do cliente antes.';
  end if;

  if p_data_retirada is null or p_hora_retirada is null then
    raise exception 'salvar_encomenda: informe a data e o horario da retirada.';
  end if;
  if p_data_pedido is null then
    raise exception 'salvar_encomenda: informe a data do pedido.';
  end if;
  if p_data_pedido > v_hoje then
    raise exception 'salvar_encomenda: a data do pedido nao pode ser futura.';
  end if;
  if p_data_pedido > p_data_retirada then
    raise exception 'salvar_encomenda: a data do pedido nao pode ser depois da retirada.';
  end if;
  -- Retirada no passado: so e aceita quando a data nao mudou (editar
  -- outro campo de uma encomenda ja vencida continua possivel).
  if p_data_retirada < v_hoje and v_retirada_atual is distinct from p_data_retirada then
    raise exception 'salvar_encomenda: a data de retirada nao pode estar no passado.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'salvar_encomenda: inclua pelo menos um produto.';
  end if;
  if jsonb_array_length(p_itens) > 100 then
    raise exception 'salvar_encomenda: no maximo 100 itens por encomenda.';
  end if;

  if p_encomenda_id is null then
    insert into public.encomendas (cliente_id, data_retirada, hora_retirada, data_pedido, status, criado_por)
    values (p_cliente_id, p_data_retirada, p_hora_retirada, p_data_pedido, 'pendente', auth.uid())
    returning id into v_id;
  else
    update public.encomendas
    set cliente_id = p_cliente_id,
        data_retirada = p_data_retirada,
        hora_retirada = p_hora_retirada,
        data_pedido = p_data_pedido,
        atualizado_em = now(),
        atualizado_por = auth.uid()
    where id = p_encomenda_id;
    v_id := p_encomenda_id;
    delete from public.encomendas_itens where encomenda_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    v_ordem := v_ordem + 1;
    begin
      v_produto := nullif(v_item ->> 'produto_id', '')::uuid;
      v_quantidade := (v_item ->> 'quantidade')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'salvar_encomenda: item % com produto ou quantidade invalidos.', v_ordem;
    end;
    v_comentario := nullif(btrim(coalesce(v_item ->> 'comentario', '')), '');

    if v_produto is null then
      raise exception 'salvar_encomenda: item % sem produto.', v_ordem;
    end if;
    if not exists (select 1 from public.produtos where id = v_produto) then
      raise exception 'salvar_encomenda: produto % nao encontrado no Catalogo.', v_produto;
    end if;
    -- Produto novo nesta encomenda precisa ser encomendavel; produto que
    -- ja estava nela continua aceito mesmo se foi desmarcado/inativado.
    if not (v_produto = any (v_anteriores)) and not public.encomendas_produto_elegivel(v_produto) then
      raise exception 'salvar_encomenda: o produto "%" nao pode ser encomendado (precisa estar ativo e marcado como disponivel para encomenda no Catalogo).',
        (select nome::text from public.produtos where id = v_produto);
    end if;
    if v_quantidade is null or v_quantidade <= 0 or v_quantidade > 99999 then
      raise exception 'salvar_encomenda: quantidade invalida no item % (maior que zero, ate 99999).', v_ordem;
    end if;
    if round(v_quantidade, 3) <> v_quantidade then
      raise exception 'salvar_encomenda: quantidade com mais de 3 casas decimais no item %.', v_ordem;
    end if;
    if v_comentario is not null and char_length(v_comentario) > 500 then
      raise exception 'salvar_encomenda: comentario muito longo no item % (maximo 500 caracteres).', v_ordem;
    end if;

    insert into public.encomendas_itens (encomenda_id, produto_id, quantidade, comentario, ordem)
    values (v_id, v_produto, v_quantidade, v_comentario, v_ordem);
  end loop;

  return v_id;
end;
$$;
comment on function public.salvar_encomenda(uuid, uuid, date, time, date, jsonb) is
  'Migration 0071. Cria (p_encomenda_id null) ou edita uma encomenda PENDENTE: cabecalho + substituicao completa dos itens na mesma transacao (atomico). Valida cliente (ativo para nova/troca), data do pedido (nao futura, ate a retirada), retirada nao passada quando muda, 1..100 itens, produto encomendavel para itens novos, quantidade > 0 (ate 3 casas), comentario <= 500. Requer encomendas.editar.';
revoke execute on function public.salvar_encomenda(uuid, uuid, date, time, date, jsonb) from public;
revoke execute on function public.salvar_encomenda(uuid, uuid, date, time, date, jsonb) from anon;
revoke execute on function public.salvar_encomenda(uuid, uuid, date, time, date, jsonb) from service_role;
grant execute on function public.salvar_encomenda(uuid, uuid, date, time, date, jsonb) to authenticated;

-- ============================================================
-- 6. definir_status_encomenda -- concluir / cancelar / reabrir.
-- ============================================================
create or replace function public.definir_status_encomenda(p_encomenda_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual record;
begin
  if not (select public.has_permissao('encomendas.editar')) then
    raise exception using errcode = '42501',
      message = 'definir_status_encomenda: requer a permissao encomendas.editar.';
  end if;
  if p_status is null or p_status not in ('pendente', 'concluida', 'cancelada') then
    raise exception 'definir_status_encomenda: status invalido.';
  end if;

  select * into v_atual from public.encomendas where id = p_encomenda_id for update;
  if v_atual.id is null then
    raise exception 'definir_status_encomenda: encomenda % nao encontrada.', p_encomenda_id;
  end if;
  if v_atual.status = p_status then
    raise exception 'definir_status_encomenda: a encomenda ja esta com este status.';
  end if;
  -- concluida <-> cancelada passa obrigatoriamente por pendente (reabrir).
  if v_atual.status <> 'pendente' and p_status <> 'pendente' then
    raise exception 'definir_status_encomenda: reabra a encomenda antes de mudar para outro status.';
  end if;

  update public.encomendas
  set status = p_status,
      status_atualizado_em = now(),
      status_atualizado_por = auth.uid()
  where id = p_encomenda_id;
end;
$$;
comment on function public.definir_status_encomenda(uuid, text) is
  'Migration 0071. pendente -> concluida | cancelada; concluida/cancelada -> pendente (reabrir). Registra status_atualizado_em/por. Cancelamento logico (nunca DELETE). Requer encomendas.editar.';
revoke execute on function public.definir_status_encomenda(uuid, text) from public;
revoke execute on function public.definir_status_encomenda(uuid, text) from anon;
revoke execute on function public.definir_status_encomenda(uuid, text) from service_role;
grant execute on function public.definir_status_encomenda(uuid, text) to authenticated;

-- ============================================================
-- 7. listar_encomendas -- leitura unica para Encomendas, Agenda e
--    Dashboard (retirada dentro de [p_inicio, p_fim], ate 2000 linhas).
-- ============================================================
create or replace function public.listar_encomendas(p_inicio date, p_fim date)
returns table (
  id               uuid,
  cliente_id       uuid,
  cliente_nome     text,
  cliente_telefone text,
  cliente_ativo    boolean,
  data_retirada    date,
  hora_retirada    time,
  data_pedido      date,
  status           text,
  criado_em        timestamptz,
  atualizado_em    timestamptz,
  itens            jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('encomendas.visualizar')) then
    raise exception using errcode = '42501',
      message = 'listar_encomendas: requer a permissao encomendas.visualizar.';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'listar_encomendas: periodo invalido.';
  end if;
  if p_fim - p_inicio > 400 then
    raise exception 'listar_encomendas: periodo maximo de 400 dias.';
  end if;

  return query
  select e.id,
         e.cliente_id,
         c.nome::text,
         c.telefone::text,
         c.ativo,
         e.data_retirada,
         e.hora_retirada,
         e.data_pedido,
         e.status::text,
         e.criado_em,
         e.atualizado_em,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'produto_id', i.produto_id,
                    'produto_nome', p.nome::text,
                    'produto_ativo', p.ativo,
                    'produto_disponivel', p.disponivel_encomenda,
                    'quantidade', i.quantidade,
                    'comentario', i.comentario
                  ) order by i.ordem)
           from public.encomendas_itens i
           join public.produtos p on p.id = i.produto_id
           where i.encomenda_id = e.id
         ), '[]'::jsonb)
  from public.encomendas e
  join public.clientes c on c.id = e.cliente_id
  where e.data_retirada between p_inicio and p_fim
  order by e.data_retirada, e.hora_retirada, c.nome
  limit 2000;
end;
$$;
comment on function public.listar_encomendas(date, date) is
  'Migration 0071. Encomendas com retirada em [p_inicio, p_fim] (max 400 dias, ate 2000 linhas), com nome/telefone do cliente e itens (jsonb, na ordem). Leitura UNICA da tela de Encomendas, da projecao na Agenda e do lembrete do Dashboard. Requer encomendas.visualizar.';
revoke execute on function public.listar_encomendas(date, date) from public;
revoke execute on function public.listar_encomendas(date, date) from anon;
revoke execute on function public.listar_encomendas(date, date) from service_role;
grant execute on function public.listar_encomendas(date, date) to authenticated;

-- ============================================================
-- 8. buscar_clientes_encomenda -- localizar cliente ATIVO por nome ou
--    telefone (digitos) ao criar/editar encomenda. No maximo 20.
-- ============================================================
create or replace function public.buscar_clientes_encomenda(p_termo text, p_limite integer default 20)
returns table (
  id        uuid,
  nome      text,
  telefone  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_termo   text := btrim(coalesce(p_termo, ''));
  v_padrao  text := replace(replace(replace(btrim(coalesce(p_termo, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_digitos text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
  v_limite  integer := least(greatest(coalesce(p_limite, 20), 1), 20);
begin
  if not (select public.has_permissao('encomendas.editar')) then
    raise exception using errcode = '42501',
      message = 'buscar_clientes_encomenda: requer a permissao encomendas.editar.';
  end if;
  if v_termo = '' then
    return;
  end if;

  return query
  select c.id, c.nome::text, c.telefone::text
  from public.clientes c
  where c.ativo
    and (c.nome ilike '%' || v_padrao || '%'
         or (char_length(v_digitos) >= 3 and c.telefone like '%' || v_digitos || '%'))
  order by case when c.nome ilike v_padrao || '%' then 0 else 1 end, c.nome
  limit v_limite;
end;
$$;
comment on function public.buscar_clientes_encomenda(text, integer) is
  'Migration 0071. Busca clientes ATIVOS por nome (ilike, curingas tratados como texto) ou telefone (3+ digitos) -- no maximo 20; termo vazio devolve nada. Requer encomendas.editar (quem lanca encomendas precisa achar o cliente sem precisar de clientes.visualizar).';
revoke execute on function public.buscar_clientes_encomenda(text, integer) from public;
revoke execute on function public.buscar_clientes_encomenda(text, integer) from anon;
revoke execute on function public.buscar_clientes_encomenda(text, integer) from service_role;
grant execute on function public.buscar_clientes_encomenda(text, integer) to authenticated;

-- ============================================================
-- 9. buscar_produtos_encomenda -- produtos encomendaveis, no maximo 50.
--    nome::text: produtos.nome e varchar(255) (licao da 0070).
-- ============================================================
create or replace function public.buscar_produtos_encomenda(p_termo text, p_limite integer default 50)
returns table (
  id    uuid,
  nome  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_termo  text := btrim(coalesce(p_termo, ''));
  v_padrao text := replace(replace(replace(btrim(coalesce(p_termo, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 50);
begin
  if not (select public.has_permissao('encomendas.editar')) then
    raise exception using errcode = '42501',
      message = 'buscar_produtos_encomenda: requer a permissao encomendas.editar.';
  end if;
  if v_termo = '' then
    return;
  end if;

  return query
  select p.id, p.nome::text
  from public.produtos p
  where p.ativo
    and p.disponivel_encomenda
    and p.nome ilike '%' || v_padrao || '%'
  order by case when p.nome ilike v_padrao || '%' then 0 else 1 end, p.nome
  limit v_limite;
end;
$$;
comment on function public.buscar_produtos_encomenda(text, integer) is
  'Migration 0071. Busca (por nome, ilike, curingas do termo tratados como texto) produtos com ativo = true e disponivel_encomenda = true -- no maximo 50 por chamada; termo vazio devolve nada. Requer encomendas.editar.';
revoke execute on function public.buscar_produtos_encomenda(text, integer) from public;
revoke execute on function public.buscar_produtos_encomenda(text, integer) from anon;
revoke execute on function public.buscar_produtos_encomenda(text, integer) from service_role;
grant execute on function public.buscar_produtos_encomenda(text, integer) to authenticated;

-- ============================================================
-- 10. Permissoes (padrao modulo.acao) -- so proprietario_admin.
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('encomendas.visualizar', 'encomendas', 'visualizar', 'Ver encomendas de clientes (lista, Agenda e lembrete do Dashboard).'),
  ('encomendas.editar',     'encomendas', 'editar',     'Registrar e editar encomendas, concluir, cancelar e reabrir.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'encomendas.visualizar'),
  ('proprietario_admin', 'encomendas.editar')
on conflict do nothing;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: apaga as encomendas registradas e a marcacao "disponivel para
-- encomenda" do Catalogo. Nenhuma outra tabela e afetada.
-- BEGIN;
-- drop function if exists public.buscar_produtos_encomenda(text, integer);
-- drop function if exists public.buscar_clientes_encomenda(text, integer);
-- drop function if exists public.listar_encomendas(date, date);
-- drop function if exists public.definir_status_encomenda(uuid, text);
-- drop function if exists public.salvar_encomenda(uuid, uuid, date, time, date, jsonb);
-- drop function if exists public.encomendas_produto_elegivel(uuid);
-- drop table if exists public.encomendas_itens;
-- drop table if exists public.encomendas;
-- drop index if exists public.produtos_disponivel_encomenda_idx;
-- alter table public.produtos drop column if exists disponivel_encomenda;
-- delete from public.perfil_permissoes where permissao in ('encomendas.visualizar', 'encomendas.editar');
-- delete from public.usuario_permissoes where permissao in ('encomendas.visualizar', 'encomendas.editar');
-- delete from public.permissoes where codigo in ('encomendas.visualizar', 'encomendas.editar');
-- COMMIT;
