-- 0040_pedidos_fornecedor_ativo_qualquer_modalidade.sql
-- Unificacao frontend de Pedidos (Entrega/Retirada num unico formulario,
-- ver PedidoForm.js) expos a ultima peca de backend ainda amarrada a
-- modalidade principal do fornecedor: criar_pedido() (migration 0037,
-- inalterada desde a 0022 nesse ponto) so aceitava fornecedor com
-- modalidade_compra='pedido_com_entrega'. Fornecedores sao entidades
-- unicas -- "modalidade_compra" na tabela fornecedores e so a
-- caracteristica PADRAO/mais comum dele, nunca uma trava de uso; a
-- coluna pedidos.modalidade_compra (snapshot imutavel por pedido,
-- migration 0037) e quem de fato registra qual foi a modalidade usada em
-- cada pedido, independente do "padrao" do fornecedor.
--
-- DUAS MUDANCAS SEMANTICAS nesta migration, ambas so em criar_pedido():
--
-- A) a validacao de fornecedor passa a exigir so `ativo = true` (mesma
--    exigencia ja usada por registrar_compra_presencial/
--    editar_compra_presencial), removendo
--    `and modalidade_compra = 'pedido_com_entrega'`. A mensagem de erro
--    tambem muda, de proposito, para o mesmo texto ja usado por essas
--    duas RPCs ('fornecedor % nao encontrado ou inativo.') -- o frontend
--    (PedidoForm.js/mensagemErroCriacaoEntrega) ja verifica exatamente
--    esse texto, nenhuma mudanca de frontend necessaria.
--
-- B) fecha um gap de grants encontrado na pre-auditoria real desta
--    migration (0040): a role service_role tinha EXECUTE nesta funcao,
--    apesar de NENHUMA migration deste repositorio jamais ter concedido
--    isso explicitamente. Causa confirmada: o mecanismo de bootstrap de
--    privilegios padrao do proprio Supabase concede EXECUTE a
--    anon/authenticated/service_role automaticamente na criacao de
--    QUALQUER funcao nova no schema public, por fora do historico de
--    migrations -- ja documentado neste mesmo arquivo 0037 (comentario
--    acima de _resolver_config_comercial_historico) e ja corrigido antes
--    para aquela mesma funcao via correcao_grants_0037_compras_presenciais.
--    A migration 0022 (criacao original de criar_pedido()) e a 0037
--    (CREATE OR REPLACE, que preserva ACL existente) sempre revogaram so
--    de public/anon e concederam a authenticated -- nunca revogaram de
--    service_role, deixando o grant de bootstrap sobrevivendo intacto ate
--    hoje. Nossa arquitetura pretendida para esta RPC de cliente:
--    authenticated=EXECUTE, postgres=dono (implicito), PUBLIC/anon/
--    service_role=sem EXECUTE. Corrigido abaixo com mais um
--    `revoke execute ... from service_role`, no mesmo estilo ja usado por
--    toda funcao "de verdade" (nao-trigger) deste projeto.
--
-- NADA MAIS muda: assinatura, corpo de validacao dos itens, insert em
-- pedidos (continua gravando modalidade_compra='pedido_com_entrega'
-- explicitamente -- esta funcao SEMPRE cria pedido com entrega, isso nao
-- e afetado por este ajuste), insert em pedido_itens, retorno,
-- security definer, search_path (continua `set search_path = ''`,
-- inalterado -- ver nota sobre a representacao `search_path=""` no
-- pre-audit consolidado), dono. Nenhuma outra funcao/tabela/trigger/RLS e
-- tocada.
--
-- Numeracao 0040 confirmada livre (ultimas publicadas: 0037, 0038, 0039).

create or replace function public.criar_pedido(
  p_fornecedor_id     uuid,
  p_data_pedido       date,
  p_previsao_entrega  date,
  p_observacoes       text,
  p_itens             jsonb
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido        public.pedidos%rowtype;
  v_item          jsonb;
  v_quantidade    numeric;
  v_valor_texto   text;
  v_valor         numeric;
  v_produto_texto text;
  v_produto_id    uuid;
begin
  if not (select public.has_permissao('pedidos.inserir')) then
    raise exception using errcode = '42501',
      message = 'criar_pedido: requer a permissao pedidos.inserir.';
  end if;

  if p_fornecedor_id is null
     or not exists (
       select 1 from public.fornecedores
       where id = p_fornecedor_id
         and ativo = true
     ) then
    raise exception 'criar_pedido: fornecedor % nao encontrado ou inativo.', p_fornecedor_id;
  end if;

  if p_data_pedido is null then
    raise exception 'criar_pedido: data_pedido e obrigatoria.';
  end if;

  if p_previsao_entrega is not null and p_previsao_entrega < p_data_pedido then
    raise exception 'criar_pedido: previsao_entrega nao pode ser anterior a data_pedido.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'criar_pedido: e obrigatorio informar ao menos 1 item.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'criar_pedido: cada item deve ser um objeto JSON, recebido: %', v_item;
    end if;

    if coalesce(btrim(v_item->>'descricao'), '') = '' then
      raise exception 'criar_pedido: item sem descricao valida: %', v_item;
    end if;
    if coalesce(btrim(v_item->>'unidade'), '') = '' then
      raise exception 'criar_pedido: item sem unidade valida: %', v_item;
    end if;

    begin
      v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    exception when invalid_text_representation then
      raise exception 'criar_pedido: quantidade_pedida invalida (nao numerica) no item: %', v_item;
    end;
    if v_quantidade is null or v_quantidade <= 0 then
      raise exception 'criar_pedido: quantidade_pedida deve ser maior que zero no item: %', v_item;
    end if;

    v_valor_texto := nullif(btrim(coalesce(v_item->>'valor_unitario', '')), '');
    if v_valor_texto is not null then
      begin
        v_valor := v_valor_texto::numeric;
      exception when invalid_text_representation then
        raise exception 'criar_pedido: valor_unitario invalido (nao numerico) no item: %', v_item;
      end;
      if v_valor < 0 then
        raise exception 'criar_pedido: valor_unitario nao pode ser negativo no item: %', v_item;
      end if;
    end if;

    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    if v_produto_texto is not null then
      begin
        v_produto_id := v_produto_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'criar_pedido: produto_id invalido (nao e um UUID) no item: %', v_item;
      end;
      if not exists (select 1 from public.produtos where id = v_produto_id) then
        raise exception 'criar_pedido: produto_id % nao existe.', v_produto_id;
      end if;
    end if;
  end loop;

  insert into public.pedidos (fornecedor_id, data_pedido, previsao_entrega, observacoes, modalidade_compra)
  values (p_fornecedor_id, p_data_pedido, p_previsao_entrega, nullif(btrim(p_observacoes), ''), 'pedido_com_entrega')
  returning * into v_pedido;

  insert into public.pedido_itens (pedido_id, produto_id, descricao, quantidade_pedida, unidade, valor_unitario, observacao)
  select
    v_pedido.id,
    nullif(btrim(coalesce(item->>'produto_id', '')), '')::uuid,
    btrim(item->>'descricao'),
    (item->>'quantidade_pedida')::numeric,
    btrim(item->>'unidade'),
    nullif(btrim(coalesce(item->>'valor_unitario', '')), '')::numeric,
    nullif(btrim(coalesce(item->>'observacao', '')), '')
  from jsonb_array_elements(p_itens) as item;

  return v_pedido;
end;
$$;

comment on function public.criar_pedido(uuid, date, date, text, jsonb) is
  'Unico caminho de criacao de pedido COM ENTREGA (cabecalho + itens), em uma unica transacao. SECURITY DEFINER -- ver comentario historico na migration 0022. Exige pedidos.inserir. Valida fornecedor ativo (qualquer modalidade -- migration 0040), pelo menos 1 item, e cada item completamente ANTES de qualquer escrita. Grava explicitamente modalidade_compra=pedido_com_entrega (migration 0037) -- inalterado em todo o resto.';

revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from public;
revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from anon;
revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from service_role;
grant execute on function public.criar_pedido(uuid, date, date, text, jsonb) to authenticated;
