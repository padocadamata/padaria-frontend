import { createClient } from '../supabase/client';
import { lerEmLotes } from '../supabase/lerEmLotes';
import {
  JANELA_MENOR_PRECO_MESES,
  dividirEmBlocosHistorico,
  inicioJanelaMenorPreco,
  lerFornecedoresPorIds,
  lerJanelaMenorPreco,
  reduzirMenorPrecoJanela,
} from './menorPreco';

// Janela móvel de "menor preço recente" -- 3 MESES DE CALENDÁRIO. A regra
// em si (seleção, desempate, comparabilidade) vive em lib/pedidos/menorPreco.js
// e é a MESMA usada pela tabela do Catálogo.
export { JANELA_MENOR_PRECO_MESES };

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
//  - menorPreco3Meses: a compra vencedora da regra única de
//    lib/pedidos/menorPreco.js (menor preco_unitario_base comparável da
//    janela; empate -> mais recente, criado_em, id). `unidadeBase` é o
//    snapshot da unidade-base daquela compra (null em registros antigos).
//
// Leitura: a "última compra" vem da view produtos_resumo_compras (já
// pré-agregada pelo banco, mesma RLS da tabela bruta via security_invoker);
// o "menor preço 3 meses" vem da tabela bruta filtrada pela janela. Ids em
// blocos (URL curta mesmo com centenas de produtos) e cada bloco lido por
// completo com lerEmLotes (o PostgREST corta em 1000 linhas sem erro);
// nomes de fornecedor em lote. Nunca N+1.
//
// ERRO: qualquer falha de consulta LANÇA exceção (nunca devolve um Map
// parcial/vazio, que pareceria "sem histórico"). Quem chama já trata com
// try/catch e mostra "Não foi possível carregar o histórico agora."
//
// RLS: ambas as fontes exigem catalogo_produtos.visualizar (migration
// 0023). Quem chama esta função DEVE checar essa permissão ANTES de
// invocar (ver hasPermissao(permissoes, PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR)
// em quem usa este helper) -- sem a permissão, o Postgres devolve 0 linhas
// silenciosamente (não é erro), o que pareceria "nunca comprado" se não
// checássemos antes. Esta função não sabe nada sobre esse gate -- é
// responsabilidade de quem a chama nunca invocá-la sem a permissão.
//
// `opcoes.supabase`/`opcoes.hoje` só existem para os testes (cliente falso,
// data fixa); as telas chamam só com os ids.
export async function buscarHistoricoComprasEmLote(produtoIds, { supabase = createClient(), hoje } = {}) {
  const idsUnicos = Array.from(new Set((produtoIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) {
    return new Map();
  }

  const inicioJanela = inicioJanelaMenorPreco(hoje);

  const [ultimaCompraResp, historicoJanelaResp] = await Promise.all([
    lerUltimaCompraEmBlocos(supabase, idsUnicos),
    lerJanelaMenorPreco(supabase, { produtoIds: idsUnicos, inicioJanela }),
  ]);

  if (ultimaCompraResp.error) {
    console.error('Erro ao carregar última compra (histórico em lote):', ultimaCompraResp.error);
    throw new Error('Falha ao carregar a última compra do histórico.');
  }
  if (historicoJanelaResp.error) {
    console.error('Erro ao carregar histórico de preços (janela de 3 meses):', historicoJanelaResp.error);
    throw new Error('Falha ao carregar o histórico de preços.');
  }

  const ultimaCompraPorProduto = new Map();
  for (const row of ultimaCompraResp.data) {
    ultimaCompraPorProduto.set(row.produto_id, row);
  }

  const menorPrecoPorProduto = reduzirMenorPrecoJanela(historicoJanelaResp.data, { inicioJanela });

  // Nomes de fornecedor resolvidos em lote (nunca 1 por fornecedor) --
  // mesma fonte/precedência já usada em pages/pedidos.js.
  const idsFornecedores = new Set();
  for (const row of ultimaCompraPorProduto.values()) {
    if (row.ultima_compra_fornecedor_id) idsFornecedores.add(row.ultima_compra_fornecedor_id);
  }
  for (const { linha } of menorPrecoPorProduto.values()) {
    if (linha.fornecedor_id) idsFornecedores.add(linha.fornecedor_id);
  }

  const fornecedores = await lerFornecedoresPorIds(supabase, Array.from(idsFornecedores));
  if (fornecedores.error) {
    console.error('Erro ao carregar nomes de fornecedores (histórico em lote):', fornecedores.error);
    throw new Error('Falha ao carregar os fornecedores do histórico.');
  }
  const nomeFornecedor = (id) => fornecedores.mapa.get(id)?.nome || null;

  const resultado = new Map();
  for (const produtoId of idsUnicos) {
    const ultima = ultimaCompraPorProduto.get(produtoId) || null;
    const menor = menorPrecoPorProduto.get(produtoId)?.linha || null;

    resultado.set(produtoId, {
      ultimaCompra: ultima
        ? {
            data: ultima.ultima_compra_data,
            fornecedor: nomeFornecedor(ultima.ultima_compra_fornecedor_id),
            // Pode ser null (compra sem conversão de unidade conhecida) --
            // estado esperado, ver comentário desta função.
            precoBase: ultima.ultima_compra_preco_base,
          }
        : null,
      menorPreco3Meses: menor
        ? {
            data: menor.data_compra,
            fornecedor: nomeFornecedor(menor.fornecedor_id),
            precoBase: menor.preco_unitario_base,
            unidadeBase: menor.unidade_base_no_momento || null,
          }
        : null,
    });
  }

  return resultado;
}

// produtos_resumo_compras tem no máximo 1 linha por produto; mesmo assim
// cada bloco é lido com lerEmLotes (ordem determinística por produto_id).
async function lerUltimaCompraEmBlocos(supabase, produtoIds) {
  const linhas = [];
  for (const bloco of dividirEmBlocosHistorico(produtoIds)) {
    const { data, error } = await lerEmLotes(() =>
      supabase
        .from('produtos_resumo_compras')
        .select('produto_id, ultima_compra_data, ultima_compra_fornecedor_id, ultima_compra_preco_base')
        .in('produto_id', bloco)
        .order('produto_id', { ascending: true })
    );
    if (error) return { data: null, error };
    linhas.push(...data);
  }
  return { data: linhas, error: null };
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
