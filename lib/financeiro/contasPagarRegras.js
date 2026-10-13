import { somarDias } from '../data/dataLocal';
import { lerValorMonetario, formatarValorEditavel } from '../funcionarios/pagamentosCalculo';

// Financeiro > Contas a Pagar (migration 0073) -- regras PURAS de
// apresentação e montagem de payload (sem Supabase, testáveis com node).
// O banco é a autoridade: valida soma, datas, formas e permissões de novo
// em toda RPC. Aqui só se evita mandar algo que ele certamente recusaria e
// se faz a conta automática do parcelamento em centavos.

export const FORMAS_PAGAMENTO = [
  { valor: 'pix', rotulo: 'PIX' },
  { valor: 'boleto', rotulo: 'Boleto' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'cartao_debito', rotulo: 'Cartão de débito' },
  { valor: 'cartao_credito', rotulo: 'Cartão de crédito' },
  { valor: 'transferencia', rotulo: 'Transferência' },
  { valor: 'outro', rotulo: 'Outro' },
];

// Cartão é sempre pago no ato (a fatura é outra camada); boleto nunca é
// pago no ato -- mesmas regras do CHECK contas_pagar_forma_coerente.
export const FORMAS_NO_ATO = FORMAS_PAGAMENTO.filter((f) => f.valor !== 'boleto');
export const FORMAS_A_PRAZO = FORMAS_PAGAMENTO.filter((f) => !f.valor.startsWith('cartao_'));

export function rotuloForma(valor) {
  return FORMAS_PAGAMENTO.find((f) => f.valor === valor)?.rotulo || valor || '—';
}

export const CONDICOES = { no_ato: 'Pago no ato', a_prazo: 'A prazo' };

export const SITUACAO_CONTA = {
  pendente: { rotulo: 'Pendente', tom: 'warning' },
  parcial: { rotulo: 'Parcialmente paga', tom: 'info' },
  paga: { rotulo: 'Paga', tom: 'success' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutral' },
};

// Situação de UMA parcela para a tela, a partir da situação do banco
// (pendente/paga/cancelada) + vencimento e "hoje" em America/Sao_Paulo.
// Vencida/vence hoje/próximos 7 dias/depois nunca são gravados -- são
// derivados aqui, como "atrasado" em Pedidos.
export function classificarParcela(parcela, hoje) {
  if (parcela.situacao === 'cancelada') return 'cancelada';
  if (parcela.situacao === 'paga') return 'paga';
  if (parcela.vencimento < hoje) return 'vencida';
  if (parcela.vencimento === hoje) return 'vence_hoje';
  if (parcela.vencimento <= somarDias(hoje, 7)) return 'proximos_7';
  return 'depois';
}

export const GRUPOS_A_PAGAR = [
  { chave: 'vencida', rotulo: 'Vencidas', tom: 'danger' },
  { chave: 'vence_hoje', rotulo: 'Vence hoje', tom: 'warning' },
  { chave: 'proximos_7', rotulo: 'Próximos 7 dias', tom: 'info' },
  { chave: 'depois', rotulo: 'Depois', tom: 'neutral' },
];

export function rotuloClassificacao(chave) {
  if (chave === 'paga') return 'Paga';
  if (chave === 'cancelada') return 'Cancelada';
  return GRUPOS_A_PAGAR.find((g) => g.chave === chave)?.rotulo || chave;
}

export function tomClassificacao(chave) {
  if (chave === 'paga') return 'success';
  if (chave === 'cancelada') return 'neutral';
  return GRUPOS_A_PAGAR.find((g) => g.chave === chave)?.tom || 'neutral';
}

export function centavos(valor) {
  return Math.round(Number(valor || 0) * 100);
}

export function deCentavos(c) {
  return Math.round(c) / 100;
}

// Totalizadores das parcelas PENDENTES (A Pagar) por grupo + total geral.
export function totalizarAPagar(parcelas, hoje) {
  const total = { geral: 0, vencida: 0, vence_hoje: 0, proximos_7: 0, depois: 0, quantidade: 0 };
  for (const p of parcelas) {
    const c = classificarParcela(p, hoje);
    if (!(c in total)) continue;
    total[c] += centavos(p.valor);
    total.geral += centavos(p.valor);
    total.quantidade += 1;
  }
  return Object.fromEntries(Object.entries(total).map(([k, v]) => [k, k === 'quantidade' ? v : deCentavos(v)]));
}

// Divide um total (em REAIS) em n parcelas iguais, em centavos; a diferença
// de arredondamento vai para a PRIMEIRA parcela. Ex.: 100,00 / 3 ->
// 33,34 + 33,33 + 33,33.
export function dividirEmParcelas(total, n) {
  const quantidade = Math.max(1, Math.floor(Number(n) || 1));
  const t = centavos(total);
  const base = Math.floor(t / quantidade);
  const resto = t - base * quantidade;
  return Array.from({ length: quantidade }, (_, i) => deCentavos(i === 0 ? base + resto : base));
}

// Vencimentos: o primeiro informado e os demais a cada `intervaloDias`.
export function gerarVencimentos(primeiroVencimento, n, intervaloDias = 30) {
  const quantidade = Math.max(1, Math.floor(Number(n) || 1));
  const passo = Math.max(1, Math.floor(Number(intervaloDias) || 30));
  return Array.from({ length: quantidade }, (_, i) => somarDias(primeiroVencimento, i * passo));
}

export function gerarParcelas({ total, quantidade, primeiroVencimento, intervaloDias }) {
  const valores = dividirEmParcelas(total, quantidade);
  const vencimentos = gerarVencimentos(primeiroVencimento, quantidade, intervaloDias);
  return valores.map((valor, i) => ({ vencimento: vencimentos[i], valorTexto: formatarValorEditavel(valor) }));
}

// valor efetivamente pago = original + juros + multa - desconto (mesma
// equação da coluna gerada contas_pagar_baixas.valor_pago), em centavos.
export function valorEfetivo({ original, juros = 0, multa = 0, desconto = 0 }) {
  return deCentavos(centavos(original) + centavos(juros) + centavos(multa) - centavos(desconto));
}

// Estado inicial da seção "Pagamento" (receber pedido, compra presencial,
// lançar financeiro, nova despesa).
export function estadoPagamentoInicial({ dataBase, modo = 'nao_lancar' } = {}) {
  return {
    modo, // 'nao_lancar' | 'no_ato' | 'a_prazo'
    forma: modo === 'a_prazo' ? 'boleto' : 'pix',
    pagoEm: dataBase || '',
    quantidade: '1',
    primeiroVencimento: dataBase ? somarDias(dataBase, 30) : '',
    intervaloDias: '30',
    parcelas: [],
    observacao: '',
  };
}

// Converte o estado da seção num payload para as RPCs.
//   total: número (reais) quando conhecido -- obrigatório para "a prazo"
//          de compra (a soma precisa bater exatamente); null para despesa
//          manual (o total É a soma das parcelas).
// -> { semFinanceiro: true } | { erro } | { payload: { condicao, forma, parcelas, pagoEm, observacao } }
export function montarPagamento(estado, { total = null, hoje, exigeLancamento = false } = {}) {
  if (!estado || estado.modo === 'nao_lancar') {
    return exigeLancamento ? { erro: 'Escolha "Pago no ato" ou "A prazo".' } : { semFinanceiro: true };
  }
  const observacao = (estado.observacao || '').trim() || null;
  if (!estado.forma) return { erro: 'Informe a forma de pagamento.' };

  if (estado.modo === 'no_ato') {
    if (estado.forma === 'boleto') return { erro: 'Boleto não é pagamento no ato -- use "A prazo".' };
    if (!estado.pagoEm) return { erro: 'Informe a data do pagamento.' };
    if (hoje && estado.pagoEm > hoje) return { erro: 'A data do pagamento não pode ser no futuro.' };
    return { payload: { condicao: 'no_ato', forma: estado.forma, parcelas: null, pagoEm: estado.pagoEm, observacao } };
  }

  if (estado.forma.startsWith('cartao_')) return { erro: 'Cartão é sempre pago no ato.' };
  if (!estado.parcelas || estado.parcelas.length === 0) return { erro: 'Gere ou informe ao menos uma parcela.' };
  const parcelas = [];
  for (let i = 0; i < estado.parcelas.length; i += 1) {
    const p = estado.parcelas[i];
    const valor = lerValorMonetario(p.valorTexto);
    if (!p.vencimento) return { erro: `Informe o vencimento da parcela ${i + 1}.` };
    if (valor === null || valor <= 0) return { erro: `Informe um valor maior que zero na parcela ${i + 1}.` };
    parcelas.push({ vencimento: p.vencimento, valor });
  }
  if (total !== null && total !== undefined) {
    const soma = parcelas.reduce((s, p) => s + centavos(p.valor), 0);
    if (soma !== centavos(total)) {
      return { erro: `A soma das parcelas (${formatarReais(deCentavos(soma))}) precisa ser exatamente o total (${formatarReais(total)}).` };
    }
  }
  return { payload: { condicao: 'a_prazo', forma: estado.forma, parcelas, pagoEm: null, observacao } };
}

export function somaParcelasTexto(parcelas) {
  return deCentavos((parcelas || []).reduce((s, p) => s + centavos(lerValorMonetario(p.valorTexto) || 0), 0));
}

export function formatarReais(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Total que o banco vai calcular para a compra: soma de round(qtd x valor, 2)
// por item (mesma conta da coluna gerada valor_total_recebido).
export function totalDosItens(itens) {
  let soma = 0;
  for (const item of itens) {
    const q = Number(item.quantidade);
    const v = Number(item.valorUnitario);
    if (!Number.isFinite(q) || !Number.isFinite(v)) return null;
    soma += Math.round(Number((q * v).toFixed(6)) * 100);
  }
  return deCentavos(soma);
}

// Competência (mês) a partir de uma data -> 'YYYY-MM-01'.
export function competenciaDe(dataYYYYMMDD) {
  return dataYYYYMMDD ? `${dataYYYYMMDD.slice(0, 7)}-01` : '';
}

// Nomes curtos persistidos em MAIÚSCULAS (política do projeto) -- o banco
// normaliza de novo; aqui é só para a pessoa ver o que vai ser gravado.
export function normalizarNomeCurto(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ').toUpperCase();
}
