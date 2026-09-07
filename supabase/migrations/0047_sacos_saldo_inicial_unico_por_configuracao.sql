-- 0047_sacos_saldo_inicial_unico_por_configuracao.sql
-- Numeracao confirmada em disco antes de nomear este arquivo: 0046 e a
-- ultima migration aplicada (Sacos); nenhum arquivo 0047+ existe ainda em
-- supabase/migrations/ nem na raiz do repositorio.
--
-- GAP DE INTEGRIDADE ENCONTRADO NESTA RODADA (revisao pedida antes de
-- expor "Lancar saldo inicial" na tela real): registrar_saldo_inicial_
-- sacos() (0044) so garante idempotencia via operacao_id -- duas chamadas
-- com operacao_id DIFERENTES para a MESMA configuracao comercial criam
-- DOIS registros tipo='saldo_inicial' distintos, cada um com seu proprio
-- estoque_movimentacoes vinculado, ambos somados normalmente pelo saldo
-- (SUM). Nada no banco impede isso hoje. Sem esta correcao, duas
-- SUBMISSOES diferentes de "Lancar saldo inicial" (nao um duplo-clique na
-- mesma submissao -- esse caso ja e coberto pela idempotencia de
-- operacao_id) acumulariam saldo inicial indevidamente.
--
-- CORRECAO -- DUAS CAMADAS (mesmo principio ja usado em toda a
-- arquitetura de sacos: RPC valida com mensagem amigavel, banco garante
-- com constraint/indice independente da RPC):
--   1) registrar_saldo_inicial_sacos(): novo EXISTS check, logo apos
--      validar peso/configuracao, ANTES do insert -- se ja existe
--      QUALQUER linha tipo='saldo_inicial' para este
--      produto_fornecedor_id, aborta com mensagem amigavel orientando a
--      usar editar_movimentacao_saco em vez de lancar um novo.
--   2) indice unico parcial NOVO em sacos_fechados_movimentacoes:
--      UNIQUE (produto_fornecedor_id) WHERE tipo = 'saldo_inicial' --
--      defesa em profundidade contra corrida entre duas transacoes
--      concorrentes (o EXISTS do item 1 ja roda DEPOIS do lock FOR UPDATE
--      em produto_fornecedores, que serializa chamadas concorrentes desta
--      MESMA funcao -- o indice cobre qualquer outro caminho de escrita
--      que venha a existir no futuro).
--
-- PRE-AUDITADO nesta mesma rodada (arquivo separado, read-only): confirma
-- zero linhas tipo='saldo_inicial' duplicadas hoje -- a tabela
-- sacos_fechados_movimentacoes esta vazia em producao (nenhuma RPC de
-- sacos foi executada ainda), entao o indice novo e criado sem risco de
-- falhar por dado existente.
--
-- ESCOPO -- SOMENTE:
--   1) public.registrar_saldo_inicial_sacos() -- CREATE OR REPLACE (mesmo
--      corpo de 0044 + o novo EXISTS check).
--   2) indice unico parcial novo em sacos_fechados_movimentacoes.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em 0041, 0042, 0043, 0045, 0046;
--   * nenhuma alteracao em listar_sacos_fechados_configuracoes,
--     registrar_abertura_saco ou editar_movimentacao_saco;
--   * nenhuma carga real de dados;
--   * nenhuma alteracao em Pedidos/Solicitacoes nem Agenda.
--
-- Pre-requisitos: 0001..0046 ja aplicadas.

BEGIN;

create or replace function public.registrar_saldo_inicial_sacos(
  p_produto_fornecedor_id uuid,
  p_quantidade_sacos      integer,
  p_operacao_id           uuid,
  p_observacao            text default null
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config          public.produto_fornecedores%rowtype;
  v_existente       public.sacos_fechados_movimentacoes%rowtype;
  v_movimentacao    public.sacos_fechados_movimentacoes%rowtype;
  v_unidade_produto text;
begin
  if auth.uid() is null then
    raise exception 'registrar_saldo_inicial_sacos: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.operar')) then
    raise exception using errcode = '42501',
      message = 'registrar_saldo_inicial_sacos: requer a permissao producao_sacos.operar.';
  end if;

  if p_produto_fornecedor_id is null then
    raise exception 'registrar_saldo_inicial_sacos: produto_fornecedor_id e obrigatorio.';
  end if;

  if p_quantidade_sacos is null or p_quantidade_sacos <= 0 then
    raise exception 'registrar_saldo_inicial_sacos: quantidade_sacos deve ser um inteiro maior que zero.';
  end if;

  if p_operacao_id is null then
    raise exception 'registrar_saldo_inicial_sacos: operacao_id e obrigatorio (idempotencia -- gere um uuid novo no cliente antes de chamar esta funcao).';
  end if;

  -- Idempotencia: mesmo padrao de registrar_abertura_saco -- verificada
  -- ANTES de travar/validar qualquer coisa.
  select * into v_existente
  from public.sacos_fechados_movimentacoes
  where operacao_id = p_operacao_id;

  if found then
    return v_existente;
  end if;

  -- Trava a linha de CONFIGURACAO antes de qualquer outra leitura --
  -- mesmo padrao de registrar_abertura_saco/0032. Tambem serializa a
  -- checagem de saldo_inicial duplicado (abaixo) contra outra chamada
  -- concorrente desta mesma funcao para a mesma configuracao.
  select * into v_config
  from public.produto_fornecedores
  where id = p_produto_fornecedor_id
  for update;

  if v_config.id is null then
    raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % nao encontrada.', p_produto_fornecedor_id;
  end if;

  if not v_config.ativo then
    raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % esta inativa.', p_produto_fornecedor_id;
  end if;

  if not v_config.controla_sacos_fechados then
    raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % nao esta marcada para controle de sacos fechados.', p_produto_fornecedor_id;
  end if;

  if v_config.peso_por_saco_kg is null or v_config.peso_por_saco_kg <= 0 then
    raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % nao tem peso_por_saco_kg valido cadastrado.', p_produto_fornecedor_id;
  end if;

  -- Novo nesta migration (0047): uma unica movimentacao tipo=saldo_inicial
  -- por configuracao comercial -- corrigir um saldo inicial ja lancado e
  -- SEMPRE editar_movimentacao_saco, nunca lancar um segundo. Reforcado
  -- por indice unico parcial criado logo abaixo (ver cabecalho).
  if exists (
    select 1 from public.sacos_fechados_movimentacoes
    where produto_fornecedor_id = p_produto_fornecedor_id
      and tipo = 'saldo_inicial'
  ) then
    raise exception 'registrar_saldo_inicial_sacos: ja existe um saldo inicial registrado para esta configuracao comercial -- edite a movimentacao existente em vez de lancar um novo.';
  end if;

  select unidade_medida into v_unidade_produto
  from public.produtos
  where id = v_config.produto_id;

  if upper(btrim(coalesce(v_unidade_produto, ''))) <> 'KG' then
    raise exception 'registrar_saldo_inicial_sacos: produto % tem unidade_medida=%, mas Sacos Fechados so opera sobre produtos cuja unidade-base seja KG.',
      v_config.produto_id, v_unidade_produto;
  end if;

  insert into public.sacos_fechados_movimentacoes (
    produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot,
    tipo, origem, operacao_id, observacao
  ) values (
    p_produto_fornecedor_id, p_quantidade_sacos, v_config.peso_por_saco_kg,
    'saldo_inicial', 'carga_inicial', p_operacao_id, nullif(btrim(coalesce(p_observacao, '')), '')
  )
  returning * into v_movimentacao;

  insert into public.estoque_movimentacoes (
    produto_id, quantidade, unidade, origem, origem_id, observacao
  ) values (
    v_config.produto_id,
    p_quantidade_sacos::numeric * v_config.peso_por_saco_kg,
    v_unidade_produto,
    'sacos_fechados_saldo_inicial',
    v_movimentacao.id,
    nullif(btrim(coalesce(p_observacao, '')), '')
  );

  return v_movimentacao;
end;
$$;

comment on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) is
  'Entrada POSITIVA atomica de sacos fechados + estoque -- uso controlado (teste funcional, futura carga da planilha real, e a acao "Lancar saldo inicial" da tela real). Mesmas validacoes de configuracao/peso/unidade KG de registrar_abertura_saco, mesmo lock FOR UPDATE em produto_fornecedores antes de qualquer leitura, mesma idempotencia via operacao_id. NOVO (0047): rejeita um segundo saldo_inicial para a mesma configuracao comercial (corrigir e sempre editar_movimentacao_saco) -- reforcado por indice unico parcial em sacos_fechados_movimentacoes. Grava tipo=saldo_inicial/origem=carga_inicial em sacos_fechados_movimentacoes e origem=sacos_fechados_saldo_inicial/origem_id=<movimentacao de sacos> em estoque_movimentacoes, na MESMA transacao. Exige producao_sacos.operar. SECURITY DEFINER: mesma razao de registrar_abertura_saco.';

revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from public;
revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from anon;
revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from service_role;
grant execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) to authenticated;


-- ============================================================
-- indice unico parcial -- defesa em profundidade contra corrida
-- ============================================================
create unique index if not exists sacos_fechados_movimentacoes_saldo_inicial_unico_idx
  on public.sacos_fechados_movimentacoes (produto_fornecedor_id)
  where tipo = 'saldo_inicial';

comment on index public.sacos_fechados_movimentacoes_saldo_inicial_unico_idx is
  'No maximo 1 movimentacao tipo=saldo_inicial por configuracao comercial (0047) -- defesa em profundidade contra corrida entre duas chamadas concorrentes de registrar_saldo_inicial_sacos (o EXISTS check dentro da funcao ja cobre o caminho comum nao-concorrente, com mensagem amigavel). Corrigir um saldo inicial ja lancado e sempre editar_movimentacao_saco, nunca uma segunda linha.';

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto nenhum segundo saldo_inicial real tiver sido tentado
-- (nenhum dado gravado por esta migration -- so a funcao e o indice).
-- BEGIN;
--   drop index if exists public.sacos_fechados_movimentacoes_saldo_inicial_unico_idx;
--
--   create or replace function public.registrar_saldo_inicial_sacos(
--     p_produto_fornecedor_id uuid,
--     p_quantidade_sacos      integer,
--     p_operacao_id           uuid,
--     p_observacao            text default null
--   )
--   returns public.sacos_fechados_movimentacoes
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_config          public.produto_fornecedores%rowtype;
--     v_existente       public.sacos_fechados_movimentacoes%rowtype;
--     v_movimentacao    public.sacos_fechados_movimentacoes%rowtype;
--     v_unidade_produto text;
--   begin
--     if auth.uid() is null then
--       raise exception 'registrar_saldo_inicial_sacos: requer sessao autenticada.';
--     end if;
--     if not (select public.has_permissao('producao_sacos.operar')) then
--       raise exception using errcode = '42501',
--         message = 'registrar_saldo_inicial_sacos: requer a permissao producao_sacos.operar.';
--     end if;
--     if p_produto_fornecedor_id is null then
--       raise exception 'registrar_saldo_inicial_sacos: produto_fornecedor_id e obrigatorio.';
--     end if;
--     if p_quantidade_sacos is null or p_quantidade_sacos <= 0 then
--       raise exception 'registrar_saldo_inicial_sacos: quantidade_sacos deve ser um inteiro maior que zero.';
--     end if;
--     if p_operacao_id is null then
--       raise exception 'registrar_saldo_inicial_sacos: operacao_id e obrigatorio (idempotencia -- gere um uuid novo no cliente antes de chamar esta funcao).';
--     end if;
--     select * into v_existente from public.sacos_fechados_movimentacoes where operacao_id = p_operacao_id;
--     if found then
--       return v_existente;
--     end if;
--     select * into v_config from public.produto_fornecedores where id = p_produto_fornecedor_id for update;
--     if v_config.id is null then
--       raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % nao encontrada.', p_produto_fornecedor_id;
--     end if;
--     if not v_config.ativo then
--       raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % esta inativa.', p_produto_fornecedor_id;
--     end if;
--     if not v_config.controla_sacos_fechados then
--       raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % nao esta marcada para controle de sacos fechados.', p_produto_fornecedor_id;
--     end if;
--     if v_config.peso_por_saco_kg is null or v_config.peso_por_saco_kg <= 0 then
--       raise exception 'registrar_saldo_inicial_sacos: configuracao comercial % nao tem peso_por_saco_kg valido cadastrado.', p_produto_fornecedor_id;
--     end if;
--     select unidade_medida into v_unidade_produto from public.produtos where id = v_config.produto_id;
--     if upper(btrim(coalesce(v_unidade_produto, ''))) <> 'KG' then
--       raise exception 'registrar_saldo_inicial_sacos: produto % tem unidade_medida=%, mas Sacos Fechados so opera sobre produtos cuja unidade-base seja KG.',
--         v_config.produto_id, v_unidade_produto;
--     end if;
--     insert into public.sacos_fechados_movimentacoes (produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot, tipo, origem, operacao_id, observacao)
--     values (p_produto_fornecedor_id, p_quantidade_sacos, v_config.peso_por_saco_kg, 'saldo_inicial', 'carga_inicial', p_operacao_id, nullif(btrim(coalesce(p_observacao, '')), ''))
--     returning * into v_movimentacao;
--     insert into public.estoque_movimentacoes (produto_id, quantidade, unidade, origem, origem_id, observacao)
--     values (v_config.produto_id, p_quantidade_sacos::numeric * v_config.peso_por_saco_kg, v_unidade_produto, 'sacos_fechados_saldo_inicial', v_movimentacao.id, nullif(btrim(coalesce(p_observacao, '')), ''));
--     return v_movimentacao;
--   end;
--   $$;
--   revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from public;
--   revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from anon;
--   revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from service_role;
--   grant execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) to authenticated;
-- COMMIT;
