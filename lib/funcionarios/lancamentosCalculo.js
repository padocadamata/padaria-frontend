import { centavos, lerValorMonetario } from './pagamentosCalculo';

// Folha > Pagamentos > Lançamentos (migration 0076) -- funções PURAS.
// Lançamento = desconto ou acréscimo de uma funcionária, registrado sem
// pagamento (pendente) e incluído depois, por escolha, num pagamento. O
// valor que vale é sempre o do banco (RPCs); aqui é só o espelho para a
// pessoa conferir antes de confirmar.

export const NATUREZAS_LANCAMENTO = [
  { valor: 'desconto', rotulo: 'Desconto', sinal: '−' },
  { valor: 'acrescimo', rotulo: 'Acréscimo', sinal: '+' },
];

export function rotuloNatureza(natureza) {
  return NATUREZAS_LANCAMENTO.find((n) => n.valor === natureza)?.rotulo || '—';
}

// Sinal textual (nunca só cor): − desconto, + acréscimo.
export function sinalNatureza(natureza) {
  return natureza === 'acrescimo' ? '+' : '−';
}

// Formulário do modal -> payload das RPCs folha_lancamento_criar/_editar.
// Erros por campo (nunca some em silêncio). `hoje` = data operacional da
// Padoca (dataLocalHoje, America/Sao_Paulo): data futura é recusada aqui e,
// de novo, no banco (folha_hoje).
export function validarLancamento({ funcionarioId, tipoId, natureza, valor, data, observacao, hoje = null } = {}) {
  const erros = {};
  if (!funcionarioId) erros.funcionarioId = 'Escolha a funcionária.';
  if (!tipoId) erros.tipoId = 'Escolha o tipo.';
  if (!NATUREZAS_LANCAMENTO.some((n) => n.valor === natureza)) erros.natureza = 'Escolha desconto ou acréscimo.';
  const numero = lerValorMonetario(valor);
  if (numero === null || numero <= 0) erros.valor = 'Informe um valor maior que zero.';
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(String(data))) erros.data = 'Informe a data.';
  else if (hoje && String(data) > String(hoje)) erros.data = 'A data não pode ser no futuro.';
  const obs = String(observacao ?? '').trim();
  if (Object.keys(erros).length > 0) return { payload: null, erros };
  return {
    payload: { funcionarioId, tipoId, natureza, valor: numero, data, observacao: obs || null },
    erros: {},
  };
}

// Totais de uma lista de lançamentos (em centavos -> reais).
export function totaisLancamentos(lancamentos) {
  let acrescimos = 0;
  let descontos = 0;
  for (const l of lancamentos || []) {
    if (l.natureza === 'acrescimo') acrescimos += centavos(l.valor);
    else descontos += centavos(l.valor);
  }
  return { quantidade: (lancamentos || []).length, acrescimos: acrescimos / 100, descontos: descontos / 100 };
}

// Resumo do pagamento com lançamentos selecionados:
//   líquido = bruto + acréscimos - (descontos digitados + descontos de lançamento)
// Mesma conta das RPCs da 0076 (liquido negativo é recusado lá).
export function resumirComLancamentos(bruto, descontosPayload, lancamentosSelecionados) {
  const brutoC = centavos(bruto);
  const manuaisC = (descontosPayload || []).reduce((s, d) => s + centavos(d.valor), 0);
  const t = totaisLancamentos(lancamentosSelecionados);
  const acrescimosC = centavos(t.acrescimos);
  const descontosLancC = centavos(t.descontos);
  const descontosC = manuaisC + descontosLancC;
  return {
    bruto: brutoC / 100,
    acrescimos: acrescimosC / 100,
    descontosManuais: manuaisC / 100,
    descontosLancamentos: descontosLancC / 100,
    descontos: descontosC / 100,
    liquido: (brutoC + acrescimosC - descontosC) / 100,
  };
}

// Pendentes agrupados por funcionária: Map<funcionario_id, { lancamentos,
// acrescimos, descontos, quantidade }>, na ordem de data.
export function agruparPendentesPorFuncionaria(lancamentos) {
  const mapa = new Map();
  const ordenados = [...(lancamentos || [])].sort(
    (a, b) => String(a.data_lancamento).localeCompare(String(b.data_lancamento)) || String(a.criado_em || '').localeCompare(String(b.criado_em || '')),
  );
  for (const l of ordenados) {
    if (!mapa.has(l.funcionario_id)) mapa.set(l.funcionario_id, []);
    mapa.get(l.funcionario_id).push(l);
  }
  const resultado = new Map();
  for (const [id, lista] of mapa) resultado.set(id, { lancamentos: lista, ...totaisLancamentos(lista) });
  return resultado;
}

function moeda(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "2 lançamentos pendentes · − R$ 32,50 · + R$ 20,00" (sinal + palavra no
// rótulo acessível; nunca depende só de cor).
export function descreverPendentes(resumo) {
  if (!resumo || resumo.quantidade === 0) return '';
  const partes = [`${resumo.quantidade} ${resumo.quantidade === 1 ? 'lançamento pendente' : 'lançamentos pendentes'}`];
  if (resumo.descontos > 0) partes.push(`− ${moeda(resumo.descontos)}`);
  if (resumo.acrescimos > 0) partes.push(`+ ${moeda(resumo.acrescimos)}`);
  return partes.join(' · ');
}

// Ids dos lançamentos marcados, na ordem da lista (payload p_lancamentos).
export function idsSelecionados(lancamentos, selecionados) {
  return (lancamentos || []).filter((l) => selecionados.has(l.id)).map((l) => l.id);
}

// Tipos para o seletor do modal: ativos + (na edição) o tipo atual mesmo
// que tenha sido inativado depois -- nunca some em silêncio.
export function tiposParaSelecao(tipos, tipoAtualId = null) {
  return (tipos || [])
    .filter((t) => t.ativo || t.id === tipoAtualId)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
