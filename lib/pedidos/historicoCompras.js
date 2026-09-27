import { createClient } from '../supabase/client';
import { dataLocalHoje, subtrairMeses } from '../data/dataLocal';

// Janela móvel de "menor preço recente" em Pedidos > Solicitações --
// 3 MESES DE CALENDÁRIO (ver subtrairMeses em lib/data/dataLocal.js),
// nunca 90 dias fixos. Auditoria aprovada da frente "Pedidos > Solicitações
// -- Histórico de Compras" (2026-09-27).
export const JANELA_MENOR_PRECO_MESES = 3;

// Busca em LOTE (nunca 1 query por produto) o histórico de compras de um
// conjunto de produto_id, devolvendo dois indicadores por produto:
//
//  - ultimaCompra: a compra CRONOLOGICAMENTE mais recente conhecida,
//    independente de estar ou não dentro dos últimos 3 meses, e
//    independente de ter conversão de unidade conhecida (precoBase pode
//    vir null quando aquela compra específica não tem
//    fator_conversao_base -- ver comentário de produtos_resumo_compras na
//    migration 0023; é um estado esperado, tratado por quem apresenta,
//    nunca inventamos uma conversão aqui).
//
//  - menorPreco3Meses: o menor preco_unitario_base já registrado DENTRO da
//    janela de 3 meses-calendário, entre compras COMPARÁVEIS (preco_
//    unitario_base conhecido) -- nunca compara preco_unitario_comercial
//    entre unidades comerciais distintas (regra crítica da auditoria
//    aprovada, seção 7).
//
// Arquitetura (documentada na auditoria aprovada, seção 4): a "última
// compra" vem da view produtos_resumo_compras (já pré-agregada pelo banco,
// mesma RLS da tabela bruta via security_invoker); o "menor preço 3 meses"
// não tem equivalente na view (que não tem janela de tempo) e por isso é
// calculado aqui, a partir de UMA ÚNICA consulta à tabela bruta filtrada
// pela janela + por precoBase conhecido. No total: até 3 consultas para
// QUALQUER quantidade de produtos (última compra em lote + histórico bruto
// em lote + nomes de fornecedor em lote) -- nunca N+1.
//
// RLS: ambas as fontes exigem catalogo_produtos.visualizar (migration
// 0023). Quem chama esta função DEVE checar essa permissão ANTES de
// invocar (ver hasPermissao(permissoes, PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR)
// em quem usa este helper) -- sem a permissão, o Postgres devolve 0 linhas
// silenciosamente (não é erro), o que pareceria "nunca comprado" se não
// checássemos antes. Esta função não sabe nada sobre esse gate -- é
// responsabilidade de quem a chama nunca invocá-la sem a permissão.
export async function buscarHistoricoComprasEmLote(produtoIds) {
  const idsUnicos = Array.from(new Set((produtoIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) {
    return new Map();
  }

  const supabase = createClient();
  const inicioJanela = subtrairMeses(dataLocalHoje(), JANELA_MENOR_PRECO_MESES);

  const [ultimaCompraResp, historicoJanelaResp] = await Promise.all([
    supabase
      .from('produtos_resumo_compras')
      .select('produto_id, ultima_compra_data, ultima_compra_fornecedor_id, ultima_compra_preco_base')
      .in('produto_id', idsUnicos),
    supabase
      .from('produtos_historico_compras')
      .select('produto_id, fornecedor_id, preco_unitario_base, data_compra')
      .in('produto_id', idsUnicos)
      .gte('data_compra', inicioJanela)
      .not('preco_unitario_base', 'is', null)
      .order('data_compra', { ascending: false }),
  ]);

  if (ultimaCompraResp.error) {
    console.error('Erro ao carregar última compra (histórico em lote):', ultimaCompraResp.error);
  }
  if (historicoJanelaResp.error) {
    console.error('Erro ao carregar histórico de preços (janela de 3 meses):', historicoJanelaResp.error);
  }

  const ultimaCompraPorProduto = new Map();
  for (const row of ultimaCompraResp.data || []) {
    ultimaCompraPorProduto.set(row.produto_id, row);
  }

  // Menor preço-base dentro da janela, por produto -- mesmo critério de
  // desempate de menor_preco_base em produtos_resumo_compras (menor preço,
  // depois compra mais recente): a consulta já vem ordenada por
  // data_compra desc, então ao percorrer em ordem só substituímos quando o
  // preço é ESTRITAMENTE menor (preserva a ocorrência mais recente em caso
  // de empate, pois foi vista primeiro).
  const menorPrecoPorProduto = new Map();
  for (const row of historicoJanelaResp.data || []) {
    const atual = menorPrecoPorProduto.get(row.produto_id);
    if (!atual || row.preco_unitario_base < atual.preco_unitario_base) {
      menorPrecoPorProduto.set(row.produto_id, row);
    }
  }

  // Nomes de fornecedor resolvidos em UMA ÚNICA consulta em lote (nunca 1
  // por fornecedor) -- mesma fonte/precedência já usada em
  // pages/pedidos.js (fornecedorNomePorId).
  const idsFornecedores = new Set();
  for (const row of ultimaCompraPorProduto.values()) {
    if (row.ultima_compra_fornecedor_id) idsFornecedores.add(row.ultima_compra_fornecedor_id);
  }
  for (const row of menorPrecoPorProduto.values()) {
    if (row.fornecedor_id) idsFornecedores.add(row.fornecedor_id);
  }

  const nomePorFornecedorId = {};
  if (idsFornecedores.size > 0) {
    const { data: fornecedoresData, error: erroFornecedores } = await supabase
      .from('fornecedores')
      .select('id, nome, nome_fantasia, razao_social')
      .in('id', Array.from(idsFornecedores));
    if (erroFornecedores) {
      console.error('Erro ao carregar nomes de fornecedores (histórico em lote):', erroFornecedores);
    }
    for (const f of fornecedoresData || []) {
      nomePorFornecedorId[f.id] = f.nome_fantasia || f.razao_social || f.nome || f.id;
    }
  }

  const resultado = new Map();
  for (const produtoId of idsUnicos) {
    const ultima = ultimaCompraPorProduto.get(produtoId) || null;
    const menor = menorPrecoPorProduto.get(produtoId) || null;

    resultado.set(produtoId, {
      ultimaCompra: ultima
        ? {
            data: ultima.ultima_compra_data,
            fornecedor: nomePorFornecedorId[ultima.ultima_compra_fornecedor_id] || null,
            // Pode ser null (compra sem conversão de unidade conhecida) --
            // estado esperado, ver comentário desta função.
            precoBase: ultima.ultima_compra_preco_base,
          }
        : null,
      menorPreco3Meses: menor
        ? {
            data: menor.data_compra,
            fornecedor: nomePorFornecedorId[menor.fornecedor_id] || null,
            precoBase: menor.preco_unitario_base,
          }
        : null,
    });
  }

  return resultado;
}

// Formata um preco_unitario_base em moeda + unidade-base (ex.: "R$
// 14,80/kg") -- NUNCA inventa a unidade: recebe exatamente a mesma
// unidade-base já usada em outro lugar do sistema para este produto
// (produtos.unidade_medida, já disponível em quem chama sem query extra:
// pedidos_solicitacoes.unidade já é esse snapshot -- migration 0043 -- e o
// próprio formulário já carrega produtos.unidade_medida na lista de
// produtos). precoBase null (compra sem conversão conhecida) devolve null
// -- quem apresenta decide a mensagem adequada, nunca mostramos "R$
// 0,00" nem qualquer valor inventado.
export function formatarPrecoBase(precoBase, unidadeBase) {
  if (precoBase == null) return null;
  const valor = precoBase.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return unidadeBase ? `${valor}/${unidadeBase}` : valor;
}

// dd/mm/aaaa a partir de uma data pura YYYY-MM-DD (mesmo padrão repetido em
// pages/pedidos.js, pages/pedidos/resumo.js, SolicitacoesLista.js -- sem
// componente de hora nem fuso envolvido, é só formatação de exibição).
export function formatarDataHistorico(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}
