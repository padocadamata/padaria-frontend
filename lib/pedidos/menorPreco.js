import { lerEmLotes } from '../supabase/lerEmLotes';
import { dataLocalHoje, subtrairMeses } from '../data/dataLocal';
import { nomeExibicaoFornecedor } from '../fornecedores/nomeExibicao';

// REGRA ÚNICA de "Menor preço (3 meses)" do sistema -- usada por Pedidos >
// Solicitações (Histórico de Compras, via lib/pedidos/historicoCompras.js)
// e pela tabela do Catálogo. Nenhuma tela reimplementa esta seleção.
//
// Regra (auditoria aprovada da frente "Pedidos > Solicitações -- Histórico
// de Compras", 2026-09-27, + desempate determinístico da frente Catálogo,
// 2026-10-23):
//  - janela móvel de 3 MESES DE CALENDÁRIO (subtrairMeses), nunca 90 dias;
//  - só compras COMPARÁVEIS: preco_unitario_base conhecido (coluna
//    GENERATED = preço comercial ÷ fator_conversao_base). Compra sem fator
//    não participa -- nunca se compara preço comercial entre unidades;
//  - vence o MENOR preco_unitario_base;
//  - empate de preço: compra mais recente (data_compra desc), depois
//    criado_em desc, depois id desc -- exatamente o desempate da view
//    produtos_resumo_compras (migration 0023), então o vencedor nunca
//    depende da ordem em que as linhas chegaram;
//  - o fornecedor exibido é o da compra vencedora.
export const JANELA_MENOR_PRECO_MESES = 3;

// Ids por consulta .in(): mesmo tamanho de bloco da leitura da Escala
// (lib/funcionarios/escala.js) -- mantém a URL do PostgREST curta mesmo
// com centenas de produtos/fornecedores.
export const TAMANHO_BLOCO_IDS_HISTORICO = 200;

const COLUNAS_JANELA = 'id, produto_id, fornecedor_id, preco_unitario_base, data_compra, criado_em, unidade_base_no_momento';

export function inicioJanelaMenorPreco(hoje = dataLocalHoje()) {
  return subtrairMeses(hoje, JANELA_MENOR_PRECO_MESES);
}

export function dividirEmBlocosHistorico(itens, tamanho = TAMANHO_BLOCO_IDS_HISTORICO) {
  const blocos = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}

function precoComparavel(linha) {
  if (linha.preco_unitario_base == null) return null;
  const preco = Number(linha.preco_unitario_base);
  return Number.isFinite(preco) ? preco : null;
}

function compararTextoDesc(a, b) {
  const x = a == null ? '' : String(a);
  const y = b == null ? '' : String(b);
  if (x === y) return 0;
  return x < y ? 1 : -1;
}

// criado_em vem do PostgREST como timestamptz ISO; compara pelo instante e,
// se empatar (precisão de milissegundos), pelo texto -- que preserva os
// microssegundos no mesmo formato.
function compararInstanteDesc(a, b) {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return y - x;
  return compararTextoDesc(a, b);
}

// < 0 quando `a` vence `b`. Só para linhas comparáveis.
export function compararCandidatosMenorPreco(a, b) {
  const diferencaPreco = precoComparavel(a) - precoComparavel(b);
  if (diferencaPreco !== 0) return diferencaPreco;
  return (
    compararTextoDesc(a.data_compra, b.data_compra) ||
    compararInstanteDesc(a.criado_em, b.criado_em) ||
    compararTextoDesc(a.id, b.id)
  );
}

export function normalizarUnidade(unidade) {
  return String(unidade ?? '').trim().toLowerCase();
}

// Função PURA: recebe linhas brutas de produtos_historico_compras (qualquer
// ordem) e devolve Map<produto_id, { linha, unidadesNaJanela }> com a
// compra vencedora de cada produto. `inicioJanela` (opcional) descarta
// linhas anteriores à janela -- a consulta já filtra, isto é defesa.
//
// unidadesNaJanela: unidades-base (snapshot unidade_base_no_momento,
// migration 0026) distintas entre as compras comparáveis da janela. Mais de
// uma significa que o cadastro do produto mudou de unidade-base dentro da
// janela -- a seleção NÃO muda (mesma regra de Solicitações), mas quem
// apresenta consegue avisar em vez de esconder.
export function reduzirMenorPrecoJanela(linhas, { inicioJanela } = {}) {
  const resultado = new Map();
  for (const linha of linhas || []) {
    if (!linha || !linha.produto_id) continue;
    if (precoComparavel(linha) == null) continue;
    if (inicioJanela && (!linha.data_compra || linha.data_compra < inicioJanela)) continue;

    let item = resultado.get(linha.produto_id);
    if (!item) {
      item = { linha, unidades: new Map() };
      resultado.set(linha.produto_id, item);
    } else if (compararCandidatosMenorPreco(linha, item.linha) < 0) {
      item.linha = linha;
    }
    const unidade = normalizarUnidade(linha.unidade_base_no_momento);
    if (unidade && !item.unidades.has(unidade)) item.unidades.set(unidade, String(linha.unidade_base_no_momento).trim());
  }

  const final = new Map();
  for (const [produtoId, item] of resultado) {
    final.set(produtoId, { linha: item.linha, unidadesNaJanela: Array.from(item.unidades.values()) });
  }
  return final;
}

function consultaJanela(supabase, inicioJanela) {
  return supabase
    .from('produtos_historico_compras')
    .select(COLUNAS_JANELA)
    .gte('data_compra', inicioJanela)
    .not('preco_unitario_base', 'is', null)
    .order('data_compra', { ascending: false })
    .order('criado_em', { ascending: false })
    .order('id', { ascending: false });
}

// Linhas comparáveis da janela, lidas POR COMPLETO (lerEmLotes -- o
// PostgREST corta cada resposta em 1000 linhas sem erro).
//  - produtoIds null: a janela INTEIRA, sem .in() (Catálogo: todos os
//    produtos já estão na tela; um .in() com centenas de UUIDs estouraria
//    a URL). Número de consultas depende só do volume de compras da
//    janela, nunca da quantidade de produtos.
//  - produtoIds lista: ids em blocos de TAMANHO_BLOCO_IDS_HISTORICO.
// Qualquer erro interrompe e é devolvido -- nunca um resultado parcial.
export async function lerJanelaMenorPreco(supabase, { produtoIds = null, inicioJanela }) {
  if (produtoIds == null) {
    return lerEmLotes(() => consultaJanela(supabase, inicioJanela));
  }
  const linhas = [];
  for (const bloco of dividirEmBlocosHistorico(produtoIds)) {
    const { data, error } = await lerEmLotes(() => consultaJanela(supabase, inicioJanela).in('produto_id', bloco));
    if (error) return { data: null, error };
    linhas.push(...data);
  }
  return { data: linhas, error: null };
}

// Map<fornecedor_id, { nome, ativo }> -- nome de exibição único do sistema
// (nomeExibicaoFornecedor, com o id como último recurso, como já era).
// Fornecedor inativo continua identificado: a regra não o exclui.
export async function lerFornecedoresPorIds(supabase, ids) {
  const mapa = new Map();
  for (const bloco of dividirEmBlocosHistorico(Array.from(new Set((ids || []).filter(Boolean))))) {
    const { data, error } = await lerEmLotes(() =>
      supabase.from('fornecedores').select('id, nome, nome_fantasia, razao_social, ativo').in('id', bloco).order('id', { ascending: true })
    );
    if (error) return { mapa: null, error };
    for (const f of data) mapa.set(f.id, { nome: nomeExibicaoFornecedor(f, f.id), ativo: f.ativo !== false });
  }
  return { mapa, error: null };
}

// Menor preço (3 meses) por produto, pronto para exibir:
// Map<produto_id, { precoBase, data, fornecedorId, fornecedor, fornecedorAtivo,
//                   unidadeBase, unidadesNaJanela }>.
// Produto ausente do Map = nenhuma compra comparável na janela. Devolve
// { mapa, error }: erro de qualquer consulta vira `error` (mapa null) --
// nunca é confundido com "sem histórico".
export async function buscarMenorPrecoJanela(supabase, { produtoIds = null, hoje } = {}) {
  const inicioJanela = inicioJanelaMenorPreco(hoje);
  const janela = await lerJanelaMenorPreco(supabase, { produtoIds, inicioJanela });
  if (janela.error) return { mapa: null, error: janela.error };

  const vencedores = reduzirMenorPrecoJanela(janela.data, { inicioJanela });
  const fornecedores = await lerFornecedoresPorIds(
    supabase,
    Array.from(vencedores.values(), (v) => v.linha.fornecedor_id)
  );
  if (fornecedores.error) return { mapa: null, error: fornecedores.error };

  const mapa = new Map();
  for (const [produtoId, { linha, unidadesNaJanela }] of vencedores) {
    const fornecedor = fornecedores.mapa.get(linha.fornecedor_id) || null;
    mapa.set(produtoId, {
      precoBase: precoComparavel(linha),
      data: linha.data_compra,
      fornecedorId: linha.fornecedor_id,
      // null quando o fornecedor não veio (RLS) -- quem apresenta decide.
      fornecedor: fornecedor ? fornecedor.nome : null,
      fornecedorAtivo: fornecedor ? fornecedor.ativo : null,
      // Snapshot da unidade-base usada NAQUELA compra (null em registros
      // anteriores à migration 0026).
      unidadeBase: linha.unidade_base_no_momento ? String(linha.unidade_base_no_momento).trim() : null,
      unidadesNaJanela,
    });
  }
  return { mapa, error: null };
}

// Unidade a exibir junto do preço-base, sem NUNCA converter nada:
//  - a unidade-base registrada na compra vencedora (snapshot), quando
//    existe -- é nela que o preco_unitario_base foi calculado;
//  - registro antigo sem snapshot (anterior à 0026): a unidade atual do
//    produto, única informação existente (mesma premissa de antes);
//  - divergente: snapshot ≠ unidade atual do cadastro (o produto mudou de
//    unidade depois da compra) -- o preço continua na unidade da compra e
//    a tela avisa;
//  - unidadesMistas: a janela tem compras em mais de uma unidade-base, então
//    a comparação misturou unidades -- a tela avisa.
export function unidadeDoMenorPreco(menor, unidadeAtual) {
  const atual = unidadeAtual ? String(unidadeAtual).trim() : '';
  const historica = menor?.unidadeBase || '';
  const unidade = historica || atual || null;
  const divergente = !!historica && !!atual && normalizarUnidade(historica) !== normalizarUnidade(atual);
  const unidadesMistas = (menor?.unidadesNaJanela || []).length > 1;
  return { unidade, unidadeAtual: atual || null, divergente, unidadesMistas };
}
