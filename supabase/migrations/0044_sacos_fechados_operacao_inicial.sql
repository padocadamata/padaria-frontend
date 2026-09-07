-- 0044_sacos_fechados_operacao_inicial.sql
-- Numeracao definitiva confirmada: 0043 ja pertence a Pedidos/Solicitacoes
-- (publicada em paralelo, ja presente em supabase/migrations/0043_pedidos_solicitacoes.sql
-- no momento em que esta migration foi numerada) -- 0044 e o proximo
-- numero livre real.
--
-- Complementa 0041 (estoque_movimentacoes) + 0042 (produto_fornecedores/
-- sacos_fechados_movimentacoes/registrar_abertura_saco/
-- editar_movimentacao_saco), sem alterar nenhuma das duas. Resolve DOIS
-- bloqueios encontrados na revisao final do frontend:
--
-- BLOQUEIO 1 -- SALDO INICIAL ATOMICO (sacos + estoque juntos):
--   Nao existe hoje nenhuma RPC que crie um saldo POSITIVO de sacos
--   fechados (0042 so criou registrar_abertura_saco, que sempre SUBTRAI).
--   Um INSERT manual isolado em sacos_fechados_movimentacoes (proposto
--   antes, corretamente rejeitado) deixaria +5 sacos sem o +40kg
--   correspondente em estoque_movimentacoes -- exatamente a divergencia
--   estrutural que toda esta frente foi desenhada para impedir. A RPC
--   nova, registrar_saldo_inicial_sacos(), grava as DUAS movimentacoes
--   (sacos positivo + estoque positivo, ligadas 1:1 via origem/origem_id)
--   na MESMA transacao -- mesmo modelo exato de registrar_abertura_saco,
--   so com o sinal invertido e tipo/origem diferentes.
--
--   DOMINIOS/CONSTRAINTS: NENHUMA alteracao necessaria. A combinacao
--   tipo='saldo_inicial' + origem='carga_inicial' + quantidade_sacos
--   POSITIVA ja e permitida pelas constraints exatamente como a 0042 as
--   criou:
--     * sacos_fechados_movimentacoes_sinal_coerente_check: tipo in
--       ('ajuste_manual','saldo_inicial') aceita qualquer sinal nao-zero
--       (positivo incluso);
--     * sacos_fechados_movimentacoes_tipo_origem_coerente_check: ja
--       amarra explicitamente tipo='saldo_inicial' <-> origem='carga_inicial';
--     * sacos_fechados_movimentacoes_pedido_item_coerente_check: exige
--       pedido_item_id NULL para qualquer origem <> 'recebimento_pedido'
--       -- 'carga_inicial' se enquadra trivialmente (a RPC nunca informa
--       pedido_item_id).
--   Do lado de estoque_movimentacoes (0041), `origem` e texto livre, sem
--   CHECK de dominio fechado -- 'sacos_fechados_saldo_inicial' e um valor
--   novo, mas nao exige nenhuma alteracao de schema (a tabela ja foi
--   desenhada para aceitar origens futuras sem migration).
--   CONCLUSAO: este arquivo e 100% CREATE OR REPLACE FUNCTION -- nenhum
--   ALTER TABLE, nenhuma constraint nova, nenhum dominio novo.
--
-- BLOQUEIO 2 -- LEITURA DA TELA NAO PODE DEPENDER DE catalogo_produtos.visualizar:
--   A tela /producao/sacos precisava ler produto_fornecedores (nomes de
--   produto/fornecedor + peso) para montar a tabela de saldo -- mas a RLS
--   de SELECT dessa tabela (migration 0023) exige catalogo_produtos.visualizar,
--   nao producao_sacos.*. Um usuario com SO producao_sacos.visualizar
--   veria a tela vazia. A RPC nova, listar_sacos_fechados_configuracoes()
--   (SECURITY DEFINER, BYPASSRLS do dono), resolve isso: exige apenas
--   producao_sacos.visualizar, devolve SOMENTE os campos que a tela
--   precisa (nunca as colunas inteiras de produto_fornecedores -- sem
--   apresentacao/codigo_produto_fornecedor/observacao/criado_por/etc.),
--   e inclui tanto as configuracoes ATIVAS+CONTROLADAS (para a tabela de
--   saldo) quanto qualquer configuracao HISTORICA com movimentacao
--   existente (para a tabela de Movimentacoes continuar resolvendo nomes
--   corretamente mesmo que a configuracao tenha sido desativada/desmarcada
--   depois). Nao grava nada -- 100% leitura.
--   A leitura de sacos_fechados_movimentacoes em si (tabela de
--   Movimentacoes) JA e independente de catalogo_produtos.visualizar
--   desde a 0042 (a policy de SELECT dessa tabela ja exige so
--   producao_sacos.visualizar) -- nenhuma RPC nova precisou ser criada
--   so para isso.
--
-- ESCOPO -- SOMENTE:
--   1) public.registrar_saldo_inicial_sacos() (nova RPC, escreve
--      atomicamente em sacos_fechados_movimentacoes + estoque_movimentacoes);
--   2) public.listar_sacos_fechados_configuracoes() (nova RPC, READ-ONLY).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em 0041 (estoque_movimentacoes), 0042
--     (produto_fornecedores/sacos_fechados_movimentacoes/
--     registrar_abertura_saco/editar_movimentacao_saco) nem 0043
--     (Pedidos/Solicitacoes);
--   * nenhuma alteracao/constraint nova em nenhuma tabela;
--   * nenhum codigo de permissao novo -- reaproveita producao_sacos.operar
--     (escrita) e producao_sacos.visualizar (leitura), ja seedados pela
--     0042;
--   * nenhuma carga real de saldo -- nenhum INSERT/chamada de RPC nesta
--     migration, so as definicoes de funcao; a carga real da planilha
--     fica para depois, com a planilha final em maos;
--   * nenhuma alteracao em Pedidos/Solicitacoes nem em Agenda.
--
-- Pre-requisitos: 0001..0043 ja aplicadas.

BEGIN;

-- ============================================================
-- 1. RPC registrar_saldo_inicial_sacos -- entrada positiva atomica
--    (sacos + estoque), para teste controlado e futura carga da planilha
-- ============================================================
-- Espelha registrar_abertura_saco (0042) quase linha a linha -- mesmas
-- validacoes de configuracao/peso/unidade KG, mesmo lock FOR UPDATE em
-- produto_fornecedores ANTES de qualquer leitura de saldo (mesmo padrao
-- de 0032), mesma idempotencia via operacao_id. Unicas diferencas:
-- sinal positivo (entrada, nao saida) e tipo/origem proprios
-- (saldo_inicial/carga_inicial, nao abertura/abertura_manual). NAO
-- verifica saldo suficiente (nao faz sentido para uma entrada).
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

  -- Reaproveita producao_sacos.operar -- mesma permissao de
  -- registrar_abertura_saco, sem criar codigo novo (pedido explicito).
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
  -- mesmo padrao de registrar_abertura_saco/0032.
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
  'Entrada POSITIVA atomica de sacos fechados + estoque -- uso controlado (teste funcional, futura carga da planilha real), nunca o fluxo operacional do dia a dia (esse continua sendo registrar_abertura_saco, que so subtrai). Mesmas validacoes de configuracao/peso/unidade KG de registrar_abertura_saco, mesmo lock FOR UPDATE em produto_fornecedores antes de qualquer leitura, mesma idempotencia via operacao_id. Grava tipo=saldo_inicial/origem=carga_inicial em sacos_fechados_movimentacoes e origem=sacos_fechados_saldo_inicial/origem_id=<movimentacao de sacos> em estoque_movimentacoes, na MESMA transacao. Exige producao_sacos.operar (reaproveitado, nenhuma permissao nova). SECURITY DEFINER: mesma razao de registrar_abertura_saco.';

revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from public;
revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from anon;
revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from service_role;
grant execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) to authenticated;


-- ============================================================
-- 2. RPC listar_sacos_fechados_configuracoes -- leitura independente de
--    catalogo_produtos.visualizar
-- ============================================================
-- READ-ONLY (nenhum INSERT/UPDATE/DELETE). Devolve SOMENTE os campos que
-- a tela /producao/sacos precisa -- nunca as colunas inteiras de
-- produto_fornecedores (sem apresentacao/codigo_produto_fornecedor/
-- observacao/criado_por/criado_em/atualizado_em). Inclui:
--   (a) toda configuracao ATIVA + controla_sacos_fechados=true (para a
--       tabela de Saldo);
--   (b) qualquer OUTRA configuracao que tenha pelo menos 1 movimentacao
--       em sacos_fechados_movimentacoes, mesmo que hoje inativa ou
--       desmarcada (para a tabela de Movimentacoes continuar resolvendo
--       produto/fornecedor corretamente em registros historicos).
-- saldo_sacos ja vem calculado (SUM das movimentacoes) -- o frontend nao
-- precisa agregar de novo, so exibir; continua sendo SEMPRE derivado (
-- nunca uma coluna de saldo armazenada em nenhuma tabela) -- calculado a
-- cada chamada desta funcao.
create or replace function public.listar_sacos_fechados_configuracoes()
returns table (
  produto_fornecedor_id  uuid,
  produto_nome           text,
  fornecedor_nome        text,
  peso_por_saco_kg       numeric,
  ativo                  boolean,
  controla_sacos_fechados boolean,
  saldo_sacos            integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('producao_sacos.visualizar')) then
    raise exception using errcode = '42501',
      message = 'listar_sacos_fechados_configuracoes: requer a permissao producao_sacos.visualizar.';
  end if;

  return query
  select
    pf.id,
    p.nome,
    coalesce(f.nome_fantasia, f.razao_social, f.nome),
    pf.peso_por_saco_kg,
    pf.ativo,
    pf.controla_sacos_fechados,
    coalesce((
      select sum(sfm.quantidade_sacos)::integer
      from public.sacos_fechados_movimentacoes sfm
      where sfm.produto_fornecedor_id = pf.id
    ), 0)
  from public.produto_fornecedores pf
  join public.produtos p on p.id = pf.produto_id
  join public.fornecedores f on f.id = pf.fornecedor_id
  where pf.controla_sacos_fechados = true
     or exists (
       select 1 from public.sacos_fechados_movimentacoes sfm
       where sfm.produto_fornecedor_id = pf.id
     );
end;
$$;

comment on function public.listar_sacos_fechados_configuracoes() is
  'Leitura READ-ONLY para a tela Producao > Sacos Fechados, independente de catalogo_produtos.visualizar (a RLS normal de produto_fornecedores exige esse codigo, nao producao_sacos.*) -- SECURITY DEFINER, exige so producao_sacos.visualizar. Devolve so os campos necessarios (produto/fornecedor/peso/ativo/controla_sacos_fechados/saldo_sacos ja somado), nunca as colunas inteiras de produto_fornecedores. Inclui configuracoes ativas+controladas (tabela de Saldo) e qualquer configuracao historica com movimentacao existente (para a tabela de Movimentacoes continuar resolvendo nomes mesmo apos a configuracao ser desativada/desmarcada). Nao grava nada.';

revoke execute on function public.listar_sacos_fechados_configuracoes() from public;
revoke execute on function public.listar_sacos_fechados_configuracoes() from anon;
revoke execute on function public.listar_sacos_fechados_configuracoes() from service_role;
grant execute on function public.listar_sacos_fechados_configuracoes() to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto nenhuma chamada real tiver sido feita (nenhum dado
-- gravado por estas duas funcoes ainda, nesta migration isolada).
-- BEGIN;
--   revoke execute on function public.listar_sacos_fechados_configuracoes() from authenticated;
--   drop function if exists public.listar_sacos_fechados_configuracoes();
--
--   revoke execute on function public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text) from authenticated;
--   drop function if exists public.registrar_saldo_inicial_sacos(uuid, integer, uuid, text);
-- COMMIT;
