-- 0052_reabertura_sacos_cardinalidade_saldo_agregado.sql
-- Fortalece EXCLUSIVAMENTE public.reabrir_recebimento_pedido() (0027,
-- estendida pela 0051 para desfazer Sacos+Estoque) -- 0051 JA FOI
-- APLICADA no Supabase real e NAO e alterada por este arquivo (0051
-- permanece intocada, esta migration so faz um novo CREATE OR REPLACE
-- de reabrir_recebimento_pedido, preservando a assinatura). Numeracao
-- confirmada em disco/git: 0051 e a ultima migration em supabase/
-- migrations/, nenhum arquivo 0052+ existia no momento em que este
-- arquivo foi escrito.
--
-- ============================================================
-- INSPECAO DO CORPO EXATO ATUALMENTE VERSIONADO (antes de desenhar esta
-- migration, conforme pedido) -- ver relatorio consolidado entregue ao
-- usuario para o texto linha a linha de cada funcao abaixo:
-- ============================================================
--   * reabrir_recebimento_pedido (0051): le fresh do arquivo, secao "4b)"
--     -- loop por linha de sacos_fechados_movimentacoes, saldo calculado
--     excluindo SO a propria linha (`id <> v_sacos_row.id`), DELETE de
--     estoque_movimentacoes SEM checagem de cardinalidade antes, snapshot
--     de auditoria (`sacos_removidos`) sem contrapartida de estoque.
--   * receber_pedido (0051): NAO tocada por esta migration -- confirmado
--     que nao ha nenhuma razao para alteracao (o gap e exclusivo do lado
--     de desfazimento).
--   * excluir_movimentacao_saco (0050) / editar_movimentacao_saco (0046):
--     ambas ja usam o padrao "count(*) into v_qtd_estoque_vinculado ...
--     if v_qtd_estoque_vinculado <> 1 then raise exception 'esperada
--     exatamente 1 movimentacao de estoque vinculada (origem=%,
--     origem_id=%), encontrada(s) % -- abortando para nao dessincronizar
--     silenciosamente.'" -- confirmado por grep direto nos dois arquivos.
--     Esta migration ADAPTA esse padrao (com mensagens SEPARADAS para
--     0 e >1, pedido explicito do usuario) para reabrir_recebimento_pedido.
--   * logs_auditoria (0004): valor_anterior e text -- ja recebe JSON
--     serializado via ::text em toda esta frente (0025/0027/0037/0051).
--     Nenhuma tabela nova necessaria -- so uma chave nova
--     ('estoque_removido') no MESMO jsonb_build_object ja usado.
--   * estoque_movimentacoes (0041) / sacos_fechados_movimentacoes (0042):
--     schema INTACTO, nenhuma alteracao nesta migration.
--
-- ============================================================
-- ACHADO CRITICO NESTA REVISAO -- MAIS SERIO que os 2 gaps originalmente
-- reportados, encontrado ao demonstrar numericamente o comportamento
-- pedido pelo usuario (secao 8): a checagem de saldo da 0051 e
-- LINHA-A-LINHA (exclui so a propria linha sendo avaliada), nao
-- AGREGADA por configuracao. Quando um MESMO pedido tem 2+ itens
-- vinculados a MESMA configuracao (2+ entradas automaticas do mesmo
-- produto_fornecedor_id), isso pode aprovar uma reabertura que na
-- verdade deixaria o saldo negativo:
--
--   Config X. Pedido P com 2 itens, ambos vinculados a X:
--     entrada A (pedido_item 1): +1 saco
--     entrada B (pedido_item 2): +1 saco
--   Movimento manual depois do recebimento: M (abertura): -1 saco
--   Saldo real atual = A+B+M = 1+1-1 = 1 (1 saco fisico sobrando).
--
--   Reabrir P remove A E B juntas (as duas pertencem ao mesmo pedido).
--   Saldo real resultante = so M = -1 -- NEGATIVO, deveria bloquear.
--
--   Checagem da 0051 (linha a linha, so exclui a propria linha):
--     avaliando remover A: soma dos "outros" = B + M = 1 - 1 = 0 -- OK, passa.
--     avaliando remover B: soma dos "outros" = A + M = 1 - 1 = 0 -- OK, passa.
--   AMBAS passam individualmente -- a 0051 removeria A e B, deixando o
--   saldo real do banco em -1 (so M restante) -- uma inconsistencia
--   REAL gravada, exatamente o tipo de divergencia silenciosa que esta
--   arquitetura inteira foi desenhada para impedir.
--
-- CORRIGIDO nesta migration: a validacao de saldo passa a ser AGREGADA
-- POR CONFIGURACAO -- para cada produto_fornecedor_id distinto entre as
-- entradas automaticas deste pedido, calcula o saldo resultante
-- excluindo TODAS as entradas automaticas deste pedido PARA AQUELA
-- CONFIGURACAO de uma vez (nao uma de cada vez) -- ANTES de qualquer
-- DELETE. Reexecutando o exemplo acima com a formula corrigida: saldo
-- resultante para X = SUM(quantidade_sacos) WHERE produto_fornecedor_id=X
-- AND id NOT IN (A, B) = M = -1 -- NEGATIVO, bloqueia corretamente, como
-- deveria.
--
-- ============================================================
-- DESENHO DA CORRECAO -- validar TUDO antes de qualquer DELETE (pedido
-- explicito do usuario, secao 7: "Se for mais seguro validar todos os
-- movimentos-alvo antes de comecar os DELETEs, prefira essa abordagem")
-- ============================================================
--   PASSO A -- coleta: v_ids_sacos = todos os ids de sacos_fechados_
--     movimentacoes com pedido_item_id = algum item deste pedido E
--     origem='recebimento_pedido' (mesmo filtro da 0051, inalterado --
--     estruturalmente nunca inclui movimento manual, CHECK
--     sacos_fechados_movimentacoes_tipo_origem_coerente_check, 0042).
--
--   PASSO B -- VALIDACAO DE SALDO, agregada por configuracao (CORRIGE o
--     achado critico acima): para cada produto_fornecedor_id DISTINTO
--     entre as linhas de v_ids_sacos, na ORDEM do proprio
--     produto_fornecedor_id (determinismo -- evita deadlock entre duas
--     reaberturas concorrentes que toquem as mesmas configuracoes em
--     ordem cruzada, mesmo raciocinio ja documentado em toda esta
--     frente): trava a configuracao (FOR UPDATE, mesma ordem de lock das
--     4 RPCs de escrita de Sacos + receber_pedido), calcula o saldo
--     resultante excluindo TODAS as linhas de v_ids_sacos de uma vez
--     (nao uma por vez), aborta com mensagem clara se negativo. NENHUM
--     DELETE acontece neste passo.
--
--   PASSO C -- VALIDACAO DE CARDINALIDADE, uma linha de sacos por vez
--     (CORRIGE o gap 1 originalmente reportado): para CADA linha em
--     v_ids_sacos, conta quantas linhas de estoque_movimentacoes tem
--     origem='sacos_fechados_recebimento_pedido' e origem_id=<esta
--     linha>. Se 0: aborta com mensagem explicita de inconsistencia
--     (nenhum vinculo encontrado). Se >1: aborta com mensagem SEPARADA e
--     igualmente explicita (mais de um vinculo -- inconsistencia,
--     nao deveria ser possivel dado o indice unico (origem,origem_id) da
--     0041, mas verificado mesmo assim -- defesa em profundidade, mesmo
--     principio do "confirme, nao presuma" ja usado em toda esta
--     conversa). NENHUM DELETE acontece neste passo tambem.
--
--   PASSO D -- SNAPSHOTS COMPLETOS (CORRIGE o gap 2 originalmente
--     reportado): so depois que os passos B e C passarem por INTEIRO
--     sem levantar nenhuma excecao -- monta v_snapshot_sacos (todas as
--     linhas de sacos_fechados_movimentacoes em v_ids_sacos) E
--     v_snapshot_estoque (todas as linhas de estoque_movimentacoes
--     vinculadas a elas) -- grava os DOIS em logs_auditoria, no MESMO
--     jsonb_build_object ja usado (chave nova 'estoque_removido' ao lado
--     de 'sacos_removidos', 'historicos_removidos', 'itens', 'pedido').
--     Continua sendo o UNICO insert em logs_auditoria desta funcao,
--     ANTES de qualquer DELETE (mesma garantia de "se a transacao
--     reverter depois, o log tambem reverte" ja documentada na 0027).
--
--   PASSO E -- DELETES em lote (agora seguros, tudo ja validado): apaga
--     TODAS as linhas de estoque_movimentacoes vinculadas (um unico
--     DELETE com origem_id = any(v_ids_sacos)), depois TODAS as linhas
--     de sacos_fechados_movimentacoes (um unico DELETE com id =
--     any(v_ids_sacos)) -- mais simples que o loop anterior, e
--     igualmente atomico (mesma transacao) -- so possivel porque B e C
--     ja garantiram que cada remocao e segura, individualmente e em
--     conjunto.
--
--   PASSOS SEGUINTES (F, G) -- INALTERADOS da 0051: limpa unidade_
--     recebida/quantidade_recebida/valor_unitario_recebido/quantidade_
--     sacos_recebidos em pedido_itens; transiciona pedidos.status para
--     aguardando_entrega.
--
-- ============================================================
-- DEMONSTRACAO NUMERICA (secao 8 do pedido do usuario) -- reconfirmada
-- com a formula CORRIGIDA:
-- ============================================================
--   Config X, pedido P com A(+1, item1) e B(+1, item2), manual M(-1).
--   v_ids_sacos = {A, B}. Configuracoes distintas envolvidas: {X}.
--   PASSO B, unica iteracao (config X): saldo resultante =
--     SUM(quantidade_sacos) WHERE produto_fornecedor_id=X AND
--     id NOT IN {A,B} = M = -1 -- NEGATIVO -- ABORTA aqui, antes de
--     qualquer DELETE, com mensagem identificando a configuracao e o
--     saldo que resultaria. Nenhuma linha de Sacos/Estoque/historico/
--     pedido e tocada -- transacao inteira desfeita (nem chega no
--     PASSO C).
--
--   Variante SEGURA (mesmo exemplo, sem o manual M, ou com M=0):
--   saldo resultante = 0 -- permite a reabertura -- A e B removidas,
--   saldo final real = 0. Confere com o comportamento esperado.
--
--   Variante com saldo manual POSITIVO suficiente (ex.: saldo_inicial
--   extra de +3 alem de A/B, sem nenhuma abertura): saldo resultante
--   excluindo A e B = +3 -- permite a reabertura, saldo final = 3.
--
-- ============================================================
-- O QUE ESTA MIGRATION PRESERVA INTEGRALMENTE (verificado linha a linha
-- contra o corpo atual, nao presumido):
-- ============================================================
--   * protecao contra saldo negativo -- preservada, agora CORRIGIDA para
--     ser agregada por configuracao (mais forte, nao mais fraca -- o
--     caso de 1 unica entrada por configuracao, o mais comum, continua
--     se comportando EXATAMENTE igual: soma de "todas as outras exceto
--     as do pedido" com 1 elemento no conjunto de exclusao e identica a
--     "excluir so a propria linha");
--   * lock de produto_fornecedores FOR UPDATE antes de tocar
--     sacos_fechados_movimentacoes -- preservado, mesma ordem;
--   * lock do pedido (FOR UPDATE) -- preservado, inalterado;
--   * suporte a multiplos itens, INCLUSIVE multiplos itens da MESMA
--     produto_fornecedor_id -- preservado e agora CORRETO (era o proprio
--     achado critico desta migration);
--   * remocao do historico de compra (produtos_historico_compras,
--     origem=recebimento_pedido) -- preservada, byte a byte;
--   * limpeza de unidade_recebida/quantidade_recebida/valor_unitario_
--     recebido/quantidade_sacos_recebidos -- preservada, byte a byte;
--   * transicao de pedidos.status para aguardando_entrega -- preservada,
--     byte a byte;
--   * permissao exigida (pedidos.reabrir_recebimento) -- inalterada;
--   * grants -- revoke de public/anon reafirmados (idempotente); grant a
--     authenticated reafirmado; SEM revoke de service_role (mesma
--     decisao ja aprovada na 0051 -- grant legado desde a 0027, fora de
--     escopo, nao corrigido nem ampliado aqui);
--   * ZERO alteracao em receber_pedido, registrar_compra_presencial,
--     editar_compra_presencial, registrar_abertura_saco, registrar_
--     saldo_inicial_sacos, editar_movimentacao_saco, excluir_
--     movimentacao_saco, listar_sacos_fechados_configuracoes,
--     pedido_itens_protecao, pedidos_protecao, Expositores.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1) public.reabrir_recebimento_pedido(uuid) -- CREATE OR REPLACE
--      (mesma assinatura, corpo fortalecido conforme descrito acima).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao de schema (nenhum ALTER TABLE, nenhuma
--     constraint/indice novo -- os indices/constraints existentes de
--     0041/0042 ja sao suficientes);
--   * nenhuma alteracao em receber_pedido nem em nenhuma outra RPC;
--   * nenhum codigo de permissao novo;
--   * nenhuma correcao do grant legado de service_role;
--   * nenhuma carga real de dados.
--
-- Pre-requisitos: 0001..0051 ja aplicadas (0051 confirmada aplicada e
-- pos-auditada com sucesso pelo usuario antes desta migration ser
-- escrita).

BEGIN;

create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido               public.pedidos%rowtype;
  v_ids_itens            uuid[];
  v_snapshot_itens       jsonb;
  v_snapshot_historicos  jsonb;
  -- Novas/revisadas (0052) -- validacao completa ANTES de qualquer
  -- DELETE, saldo agregado por configuracao, cardinalidade exigida,
  -- snapshot de estoque incluido na auditoria.
  v_ids_sacos            uuid[];
  v_snapshot_sacos       jsonb;
  v_snapshot_estoque     jsonb;
  v_config_id            uuid;
  v_saldo_resultante     integer;
  v_sacos_row            public.sacos_fechados_movimentacoes%rowtype;
  v_qtd_estoque_vinculado integer;
begin
  -- 1) sessao autenticada + permissao -- portao explicito de aplicacao
  --    (redundante com o gate estrutural das triggers, defesa em
  --    profundidade, mesmo padrao das demais RPCs deste modulo).
  if auth.uid() is null then
    raise exception 'reabrir_recebimento_pedido: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
    raise exception using errcode = '42501',
      message = 'reabrir_recebimento_pedido: requer a permissao pedidos.reabrir_recebimento.';
  end if;

  -- 2) localiza e BLOQUEIA o pedido -- mesma razao de receber_pedido/
  --    excluir_pedido: impede duas reaberturas concorrentes do mesmo
  --    pedido, ou uma reabertura concorrente com qualquer outra
  --    transicao. Uma segunda chamada so prossegue apos a primeira
  --    commitar (ou reverter) -- e ai encontra status<>recebido e falha
  --    no proximo passo, nunca reprocessando o mesmo pedido.
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'reabrir_recebimento_pedido: pedido % nao encontrado.', p_pedido_id;
  end if;

  if v_pedido.status <> 'recebido' then
    raise exception 'reabrir_recebimento_pedido: pedido % tem status=%, somente pedidos recebidos podem ter o recebimento reaberto.',
      p_pedido_id, v_pedido.status;
  end if;

  select array_agg(id) into v_ids_itens
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(pi.*)) into v_snapshot_itens
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(phc.*)) into v_snapshot_historicos
  from public.produtos_historico_compras phc
  where phc.pedido_item_id = any(v_ids_itens)
    and phc.origem = 'recebimento_pedido';

  -- PASSO A -- coleta todas as entradas automaticas de Sacos deste
  -- pedido (mesmo filtro da 0051 -- origem='recebimento_pedido' garante
  -- estruturalmente, via CHECK sacos_fechados_movimentacoes_tipo_
  -- origem_coerente_check (0042), que nenhum movimento manual do
  -- usuario e alcancado aqui).
  select array_agg(sfm.id) into v_ids_sacos
  from public.sacos_fechados_movimentacoes sfm
  where sfm.pedido_item_id = any(v_ids_itens)
    and sfm.origem = 'recebimento_pedido';

  -- PASSO B -- VALIDACAO DE SALDO, AGREGADA POR CONFIGURACAO (corrige o
  -- achado critico desta migration -- ver cabecalho). Para cada
  -- configuracao distinta entre as entradas deste pedido, na ORDEM do
  -- proprio id (determinismo, evita deadlock entre reaberturas
  -- concorrentes que toquem configuracoes em ordem cruzada): trava a
  -- configuracao, calcula o saldo excluindo TODAS as entradas deste
  -- pedido para ELA de uma vez (nao uma por vez), aborta se negativo.
  -- NENHUM DELETE acontece neste passo.
  for v_config_id in
    select distinct sfm.produto_fornecedor_id
    from public.sacos_fechados_movimentacoes sfm
    where sfm.id = any(coalesce(v_ids_sacos, array[]::uuid[]))
    order by sfm.produto_fornecedor_id
  loop
    perform 1 from public.produto_fornecedores
    where id = v_config_id
    for update;

    v_saldo_resultante := (
      select coalesce(sum(quantidade_sacos), 0)
      from public.sacos_fechados_movimentacoes
      where produto_fornecedor_id = v_config_id
        and id <> all(coalesce(v_ids_sacos, array[]::uuid[]))
    );

    if v_saldo_resultante < 0 then
      raise exception 'reabrir_recebimento_pedido: nao e possivel desfazer as entradas automaticas de Sacos Fechados da configuracao % -- removendo TODAS as entradas automaticas deste pedido para esta configuracao de uma vez, o saldo resultante seria negativo (% sacos). Sacos ja foram consumidos (abertos) depois deste(s) recebimento(s) -- ajuste as movimentacoes manuais de Sacos Fechados (ex.: exclua ou edite a abertura correspondente) antes de reabrir este recebimento.',
        v_config_id, v_saldo_resultante;
    end if;
  end loop;

  -- PASSO C -- VALIDACAO DE CARDINALIDADE, uma linha de sacos por vez
  -- (corrige o gap 1 originalmente reportado -- mesmo padrao ja usado
  -- por editar_movimentacao_saco/0046 e excluir_movimentacao_saco/0050,
  -- adaptado com mensagens SEPARADAS para 0 e >1, pedido explicito do
  -- usuario). NENHUM DELETE acontece neste passo tambem.
  for v_sacos_row in
    select * from public.sacos_fechados_movimentacoes
    where id = any(coalesce(v_ids_sacos, array[]::uuid[]))
  loop
    select count(*) into v_qtd_estoque_vinculado
    from public.estoque_movimentacoes
    where origem = 'sacos_fechados_recebimento_pedido'
      and origem_id = v_sacos_row.id;

    if v_qtd_estoque_vinculado = 0 then
      raise exception 'reabrir_recebimento_pedido: nenhuma movimentacao de estoque vinculada encontrada para a entrada automatica de Sacos % (item %, origem=sacos_fechados_recebimento_pedido, origem_id=%) -- inconsistencia estrutural, abortando sem alterar nada.',
        v_sacos_row.id, v_sacos_row.pedido_item_id, v_sacos_row.id;
    elsif v_qtd_estoque_vinculado > 1 then
      raise exception 'reabrir_recebimento_pedido: mais de uma movimentacao de estoque vinculada encontrada para a entrada automatica de Sacos % (item %, origem=sacos_fechados_recebimento_pedido, origem_id=%, encontradas=%) -- inconsistencia estrutural, abortando sem alterar nada.',
        v_sacos_row.id, v_sacos_row.pedido_item_id, v_sacos_row.id, v_qtd_estoque_vinculado;
    end if;
  end loop;

  -- PASSO D -- SNAPSHOTS COMPLETOS, so depois que B e C passaram por
  -- INTEIRO sem excecao (corrige o gap 2 originalmente reportado --
  -- estoque_removido agora ao lado de sacos_removidos). UNICO insert em
  -- logs_auditoria desta funcao, ANTES de qualquer DELETE.
  select jsonb_agg(to_jsonb(sfm.*)) into v_snapshot_sacos
  from public.sacos_fechados_movimentacoes sfm
  where sfm.id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  select jsonb_agg(to_jsonb(em.*)) into v_snapshot_estoque
  from public.estoque_movimentacoes em
  where em.origem = 'sacos_fechados_recebimento_pedido'
    and em.origem_id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior)
  values (
    'pedido',
    p_pedido_id::text,
    'pedido_recebimento_reaberto',
    jsonb_build_object(
      'pedido', to_jsonb(v_pedido.*),
      'itens', coalesce(v_snapshot_itens, '[]'::jsonb),
      'historicos_removidos', coalesce(v_snapshot_historicos, '[]'::jsonb),
      'sacos_removidos', coalesce(v_snapshot_sacos, '[]'::jsonb),
      'estoque_removido', coalesce(v_snapshot_estoque, '[]'::jsonb),
      'usuario', auth.uid(),
      'reaberto_em', now()
    )::text
  );

  -- PASSO E -- exclui SOMENTE historico origem=recebimento_pedido
  -- vinculado a itens DESTE pedido (byte a byte igual a 0027/0051).
  delete from public.produtos_historico_compras
  where pedido_item_id = any(v_ids_itens)
    and origem = 'recebimento_pedido';

  -- Deletes em lote -- agora seguros, tudo ja validado nos passos B/C.
  -- Estoque primeiro, depois Sacos (mesma ordem da 0051).
  delete from public.estoque_movimentacoes
  where origem = 'sacos_fechados_recebimento_pedido'
    and origem_id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  delete from public.sacos_fechados_movimentacoes
  where id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  -- PASSO F -- limpa os campos de recebimento -- roda ENQUANTO o pedido
  -- ainda e recebido (a transicao de status so acontece no passo G);
  -- pedido_itens_protecao (0051) permite esta UPDATE especifica e SO
  -- esta -- byte a byte igual a 0051.
  update public.pedido_itens
  set unidade_recebida = null,
      quantidade_recebida = null,
      valor_unitario_recebido = null,
      quantidade_sacos_recebidos = null
  where pedido_id = p_pedido_id;

  -- PASSO G -- transicao formal -- pedidos_protecao (0027, intocada)
  -- libera esta UPDATE especifica, forca recebido_em=null -- byte a
  -- byte igual a 0027/0051.
  update public.pedidos
  set status = 'aguardando_entrega'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.reabrir_recebimento_pedido(uuid) is
  'Desfaz atomicamente o recebimento de um pedido: grava snapshot completo (pedido+itens, incluindo quantidade_sacos_recebidos+historicos removidos+sacos removidos+estoque removido, 0052) em logs_auditoria ANTES de qualquer DELETE, exclui de produtos_historico_compras todo registro origem=recebimento_pedido vinculado a itens deste pedido, desfaz atomicamente qualquer entrada automatica de sacos_fechados_movimentacoes/estoque_movimentacoes vinculada (origem=recebimento_pedido). NOVO (0052): a protecao contra saldo negativo agora e AGREGADA POR CONFIGURACAO -- soma o efeito de remover TODAS as entradas automaticas deste pedido para uma mesma configuracao de uma vez (corrige um caso real em que 2+ entradas do mesmo produto_fornecedor_id no mesmo pedido podiam escapar da checagem antiga, que so excluia a propria linha); exige EXATAMENTE 1 movimentacao de estoque vinculada a cada entrada de sacos antes de excluir (mensagens separadas para 0 e >1 vinculos), abortando a reabertura INTEIRA (sem nenhuma escrita) se qualquer uma das duas validacoes falhar. Nunca toca movimento manual (origem sempre recebimento_pedido, estruturalmente exclusivo por CHECK). Limpa unidade_recebida/quantidade_recebida/valor_unitario_recebido/quantidade_sacos_recebidos em pedido_itens, e transiciona pedidos.status de recebido para aguardando_entrega. Exige sessao autenticada + pedidos.reabrir_recebimento. Bloqueia a linha do pedido (FOR UPDATE) e cada configuracao comercial de Sacos envolvida (FOR UPDATE, ordem determinada por produto_fornecedor_id, evita deadlock). SECURITY DEFINER: necessario tanto para a escrita quanto para satisfazer o gate rolbypassrls das triggers pedidos_protecao/pedido_itens_protecao. Qualquer falha em qualquer etapa desfaz a transacao inteira -- validacao completa (saldo agregado + cardinalidade) acontece ANTES de qualquer DELETE. Pedidos legados (sem dados detalhados/historico/sacos) sao suportados sem nenhuma logica especial.';

-- NAO revoga de service_role -- mesma decisao/justificativa ja aprovada
-- na 0051 (grant legado desde a 0027, fora de escopo desta frente).
revoke execute on function public.reabrir_recebimento_pedido(uuid) from public;
revoke execute on function public.reabrir_recebimento_pedido(uuid) from anon;
grant execute on function public.reabrir_recebimento_pedido(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: qualquer reabertura ja realizada APOS esta migration ser
-- aplicada (e antes do rollback) ja usou a validacao CORRIGIDA -- este
-- rollback restaura o CODIGO exato da 0051 (validacao linha-a-linha,
-- SEM a correcao do achado critico, SEM checagem de cardinalidade, SEM
-- estoque_removido na auditoria), mas NAO desfaz nenhum efeito de dados
-- ja ocorrido sob a versao corrigida.
-- BEGIN;
--   create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid)
--   returns public.pedidos
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_pedido               public.pedidos%rowtype;
--     v_ids_itens            uuid[];
--     v_snapshot_itens       jsonb;
--     v_snapshot_historicos  jsonb;
--     v_snapshot_sacos       jsonb;
--     v_sacos_row            public.sacos_fechados_movimentacoes%rowtype;
--     v_saldo_outros         integer;
--   begin
--     if auth.uid() is null then
--       raise exception 'reabrir_recebimento_pedido: requer sessao autenticada.';
--     end if;
--     if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
--       raise exception using errcode = '42501',
--         message = 'reabrir_recebimento_pedido: requer a permissao pedidos.reabrir_recebimento.';
--     end if;
--     select * into v_pedido from public.pedidos where id = p_pedido_id for update;
--     if v_pedido.id is null then
--       raise exception 'reabrir_recebimento_pedido: pedido % nao encontrado.', p_pedido_id;
--     end if;
--     if v_pedido.status <> 'recebido' then
--       raise exception 'reabrir_recebimento_pedido: pedido % tem status=%, somente pedidos recebidos podem ter o recebimento reaberto.',
--         p_pedido_id, v_pedido.status;
--     end if;
--     select array_agg(id) into v_ids_itens from public.pedido_itens where pedido_id = p_pedido_id;
--     select jsonb_agg(to_jsonb(pi.*)) into v_snapshot_itens from public.pedido_itens pi where pi.pedido_id = p_pedido_id;
--     select jsonb_agg(to_jsonb(phc.*)) into v_snapshot_historicos from public.produtos_historico_compras phc where phc.pedido_item_id = any(v_ids_itens) and phc.origem = 'recebimento_pedido';
--     select jsonb_agg(to_jsonb(sfm.*)) into v_snapshot_sacos from public.sacos_fechados_movimentacoes sfm where sfm.pedido_item_id = any(v_ids_itens) and sfm.origem = 'recebimento_pedido';
--     insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior)
--     values ('pedido', p_pedido_id::text, 'pedido_recebimento_reaberto',
--       jsonb_build_object('pedido', to_jsonb(v_pedido.*), 'itens', coalesce(v_snapshot_itens, '[]'::jsonb), 'historicos_removidos', coalesce(v_snapshot_historicos, '[]'::jsonb), 'sacos_removidos', coalesce(v_snapshot_sacos, '[]'::jsonb), 'usuario', auth.uid(), 'reaberto_em', now())::text);
--     delete from public.produtos_historico_compras where pedido_item_id = any(v_ids_itens) and origem = 'recebimento_pedido';
--     for v_sacos_row in
--       select * from public.sacos_fechados_movimentacoes where pedido_item_id = any(v_ids_itens) and origem = 'recebimento_pedido' order by criado_em
--     loop
--       perform 1 from public.produto_fornecedores where id = v_sacos_row.produto_fornecedor_id for update;
--       v_saldo_outros := (select coalesce(sum(quantidade_sacos), 0) from public.sacos_fechados_movimentacoes where produto_fornecedor_id = v_sacos_row.produto_fornecedor_id and id <> v_sacos_row.id);
--       if v_saldo_outros < 0 then
--         raise exception 'reabrir_recebimento_pedido: nao e possivel desfazer a entrada automatica de Sacos Fechados do item % -- sacos ja foram consumidos (abertos) depois deste recebimento, e desfazer deixaria o saldo negativo (% sacos). Ajuste as movimentacoes manuais de Sacos Fechados (ex.: exclua ou edite a abertura correspondente) antes de reabrir este recebimento.',
--           v_sacos_row.pedido_item_id, v_saldo_outros;
--       end if;
--       delete from public.estoque_movimentacoes where origem = 'sacos_fechados_recebimento_pedido' and origem_id = v_sacos_row.id;
--       delete from public.sacos_fechados_movimentacoes where id = v_sacos_row.id;
--     end loop;
--     update public.pedido_itens set unidade_recebida = null, quantidade_recebida = null, valor_unitario_recebido = null, quantidade_sacos_recebidos = null where pedido_id = p_pedido_id;
--     update public.pedidos set status = 'aguardando_entrega' where id = p_pedido_id returning * into v_pedido;
--     return v_pedido;
--   end;
--   $$;
--   revoke execute on function public.reabrir_recebimento_pedido(uuid) from public;
--   revoke execute on function public.reabrir_recebimento_pedido(uuid) from anon;
--   grant execute on function public.reabrir_recebimento_pedido(uuid) to authenticated;
-- COMMIT;
