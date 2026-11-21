// Acesso da Central de Importações do G3 ao banco (migration 0081). Tudo é
// exclusivo do perfil proprietario_admin: a RLS (is_admin()) devolve vazio
// para os demais e as RPCs recusam com 42501.

import { TAMANHO_PAGINA_PADRAO, deslocamentoDaPagina, normalizarTamanho } from './paginacao.js';

export const ROTULOS_LAYOUT = {
  vendas_produto_cliente: 'Itens (Vendas_ProdCliente)',
  faturamento_geral: 'Faturamento (FaturamGeral)',
  vendas_periodo: 'Totais diários (Vendas_Periodo)',
};

export const STATUS = {
  recebendo: { rotulo: 'Recebendo', tom: 'info' },
  previa: { rotulo: 'Em prévia', tom: 'warning' },
  rejeitado: { rotulo: 'Rejeitado', tom: 'danger' },
  confirmado: { rotulo: 'Confirmado', tom: 'success' },
  descartado: { rotulo: 'Descartado', tom: 'neutral' },
  expirado: { rotulo: 'Expirado', tom: 'neutral' },
  revertido: { rotulo: 'Revertido', tom: 'neutral' },
};

export const ACOES = {
  nova: { rotulo: 'Novas', tom: 'success', descricao: 'Ainda não existiam no sistema.' },
  alterada: { rotulo: 'Alteradas', tom: 'warning', descricao: 'Já existiam com outro conteúdo; a versão anterior fica guardada.' },
  igual: { rotulo: 'Iguais', tom: 'neutral', descricao: 'Já existiam com o mesmo conteúdo; nada muda.' },
  reaparecida: { rotulo: 'Reapareceram', tom: 'info', descricao: 'Estavam marcadas como ausentes e voltaram no G3.' },
  superada: { rotulo: 'Superadas', tom: 'neutral', descricao: 'Já existe versão de um relatório gerado depois; nada muda.' },
  bloqueada: { rotulo: 'Bloqueadas', tom: 'danger', descricao: 'Ficam pendentes de revisão; a última versão válida é preservada.' },
  ausente: { rotulo: 'Ausentes', tom: 'danger', descricao: 'Já importadas, mas não aparecem neste relatório em dias que ele cobre por completo.' },
};

export const ORDEM_ACOES = ['nova', 'alterada', 'igual', 'reaparecida', 'superada', 'bloqueada', 'ausente'];

export const MOTIVOS = {
  valor_nao_positivo: 'Quantidade ou valor zerado/negativo (devoluções ainda não são tratadas)',
  aritmetica_linha: 'As contas da linha não fecham',
  datas_divergentes: 'A mesma venda aparece com datas diferentes',
  conflito_numero: 'Número já existe no sistema com outra data',
};

export const FACETAS = { itens: 'Venda (itens)', faturamento: 'Venda (faturamento)', dia: 'Dia' };

export const COBERTURA = {
  completo: { rotulo: 'Completo', tom: 'success' },
  parcial: { rotulo: 'Parcial', tom: 'warning' },
  com_pendencias: { rotulo: 'Com pendências', tom: 'danger' },
  sem_dados: { rotulo: 'Sem dados', tom: 'neutral' },
};

export const ESTADO_DIA = {
  conciliado: { rotulo: 'Conciliado', tom: 'success' },
  divergente: { rotulo: 'Divergente', tom: 'danger' },
  com_pendencias: { rotulo: 'Com pendências', tom: 'danger' },
  incompleto: { rotulo: 'Incompleto', tom: 'warning' },
};

export class ErroConsulta extends Error {
  constructor(mensagem, causa) {
    super(mensagem);
    this.name = 'ErroConsulta';
    this.causa = causa;
  }
}

// Mensagem para a tela a partir de um erro do Supabase. A Central degrada
// sem quebrar quando a migration ainda não foi aplicada.
export function mensagemDeErro(error) {
  const e = error?.causa || error;
  const codigo = String(e?.code || '');
  const msg = String(e?.message || error?.message || '');
  if (codigo === 'PGRST202' || codigo === '42883' || codigo === '42P01' || /could not find the function|does not exist/i.test(msg)) {
    return 'A Central de Importações ainda não está instalada no banco (migration 0081).';
  }
  if (codigo === '42501' || /proprietario_admin|permission denied/i.test(msg)) {
    return 'Acesso restrito ao perfil proprietário/administrador.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return 'Falha de conexão. Verifique a internet e tente de novo.';
  }
  return msg || 'Não foi possível concluir agora.';
}

function falhou(error) {
  return new ErroConsulta(mensagemDeErro(error), error);
}

const COLUNAS_LISTA = 'id, seq, layout, status, arquivo_nome, arquivo_tamanho, arquivo_metadados, linhas_total, gerado_em, periodo_inicio, periodo_fim, cobertura_completa_fim, dia_parcial, resumo, criado_por_nome, criado_em, confirmado_por_nome, confirmado_em, revertido_por_nome, revertido_em, motivo_reversao';

export async function listarImportacoes(supabase, { limite = 30, deslocamento = 0, status = null } = {}) {
  let q = supabase.from('g3_importacoes').select(COLUNAS_LISTA).order('criado_em', { ascending: false }).range(deslocamento, deslocamento + limite - 1);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw falhou(error);
  return data || [];
}

export async function obterImportacao(supabase, id) {
  const { data, error } = await supabase.from('g3_importacoes').select('*').eq('id', id).maybeSingle();
  if (error) throw falhou(error);
  return data;
}

export async function listarLote(supabase, id, { acao = null, limite = 100, deslocamento = 0 } = {}) {
  const { data, error } = await supabase.rpc('g3_listar_lote', { p_lote: id, p_acao: acao, p_limite: limite, p_deslocamento: deslocamento });
  if (error) throw falhou(error);
  return data || [];
}

// Uma página dos registros do lote, paginada NO SERVIDOR: devolve só as linhas
// da página e o total do filtro (coluna "total" de g3_listar_lote, contada
// antes do limit/offset). Página além do fim: registros vazio e total 0.
export async function listarLotePaginado(supabase, id, { acao = null, pagina = 1, tamanho = TAMANHO_PAGINA_PADRAO } = {}) {
  const limite = normalizarTamanho(tamanho);
  const linhas = await listarLote(supabase, id, { acao, limite, deslocamento: deslocamentoDaPagina(pagina, limite) });
  return {
    registros: linhas.map(({ total, ...resto }) => resto),
    total: linhas.length ? Number(linhas[0].total) || 0 : 0,
  };
}

export async function gerarPrevia(supabase, id) {
  const { data, error } = await supabase.rpc('g3_gerar_previa', { p_lote: id });
  if (error) throw falhou(error);
  return data;
}

export async function confirmarImportacao(supabase, id, { estadoBase, reconhecerAusentes = false }) {
  const { data, error } = await supabase.rpc('g3_confirmar_importacao', {
    p_lote: id,
    p_estado_base: estadoBase,
    p_reconhecer_ausentes: reconhecerAusentes,
  });
  if (error) throw falhou(error);
  return data;
}

export async function descartarImportacao(supabase, id) {
  const { error } = await supabase.rpc('g3_descartar_importacao', { p_lote: id });
  if (error) throw falhou(error);
}

export async function reverterImportacao(supabase, id, motivo) {
  const { data, error } = await supabase.rpc('g3_reverter_importacao', { p_lote: id, p_motivo: motivo });
  if (error) throw falhou(error);
  return data;
}

// Pendências abertas, paginadas NO SERVIDOR (a API do Supabase corta respostas
// em 1000 linhas: nunca se pede o conjunto inteiro). Filtro opcional por
// motivo. total = pendências do filtro; totalGeral = todas as abertas (null
// quando a página veio vazia e o servidor não informou).
export async function listarPendencias(supabase, { motivo = null, pagina = 1, tamanho = TAMANHO_PAGINA_PADRAO } = {}) {
  const limite = normalizarTamanho(tamanho);
  const { data, error } = await supabase.rpc('g3_listar_pendencias', {
    p_motivo: motivo, p_layout: null, p_limite: limite, p_deslocamento: deslocamentoDaPagina(pagina, limite),
  });
  if (error) throw falhou(error);
  const linhas = data || [];
  return {
    registros: linhas.map(({ total, total_geral: totalGeral, ...resto }) => resto),
    total: linhas.length ? Number(linhas[0].total) || 0 : 0,
    totalGeral: linhas.length ? Number(linhas[0].total_geral) || 0 : null,
  };
}

export async function conciliacaoDiaria(supabase, inicio, fim) {
  const { data, error } = await supabase.rpc('g3_conciliacao_diaria', { p_inicio: inicio, p_fim: fim });
  if (error) throw falhou(error);
  return data || [];
}

export async function espacoOcupado(supabase) {
  const { data, error } = await supabase.rpc('g3_espaco_ocupado');
  if (error) throw falhou(error);
  return (data || []).reduce((s, l) => s + Number(l.bytes || 0), 0);
}

export async function limparExpirados(supabase) {
  const { data, error } = await supabase.rpc('g3_limpar');
  if (error) throw falhou(error);
  return data;
}

// ---------- formatação ----------
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatarMoeda = (v) => (v === null || v === undefined || v === '' ? '—' : moeda.format(Number(v)));

export function formatarData(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatarBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Somatório dos contadores do resumo da prévia, na ordem de exibição.
export function contagensDoResumo(resumo) {
  const por = resumo?.por_acao || {};
  return ORDEM_ACOES.filter((a) => por[a]).map((a) => ({ acao: a, quantidade: por[a], valor: resumo?.valor_por_acao?.[a] ?? null, ...ACOES[a] }));
}

// Data de hoje em São Paulo (AAAA-MM-DD) e deslocamentos em dias.
export function hojeSP() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
export function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
