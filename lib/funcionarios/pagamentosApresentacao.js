import { formatarChavePixExibicao, rotuloTipoChavePix } from './normalizacao';
import { centavos, chaveJornada, resolverValorAPagar, somarValoresAPagar } from './pagamentosCalculo';

// Apresentação da visão "A Pagar" (Folha de Pagamento > Pagamentos) em
// tabela contínua por modalidade. Funções PURAS e só de exibição: nenhum
// cálculo novo -- os valores vêm das RPCs (folha_calcular_pendencias_*) e
// a resolução "calculado x digitado" é a mesma resolverValorAPagar de
// sempre. O valor efetivamente pago continua decidido no modal de
// pagamento (descontos etc.), como antes.

// PIX cadastrado em Funcionários (funcionarios.tipo_chave_pix/chave_pix,
// migration 0056) -- somente leitura aqui.
export function descreverPix(funcionario) {
  const valor = funcionario?.chave_pix;
  if (!valor) return { cadastrado: false, texto: 'PIX não cadastrado' };
  const tipo = rotuloTipoChavePix(funcionario.tipo_chave_pix);
  const chave = formatarChavePixExibicao(funcionario.tipo_chave_pix, valor);
  return { cadastrado: true, tipo, chave, texto: tipo ? `PIX (${tipo}): ${chave}` : `PIX: ${chave}` };
}

// Total das jornadas pendentes de 1 pessoa (por hora / regularização):
// soma do "Valor a pagar" de cada jornada (digitado ou calculado);
// `semValor` = jornadas ainda sem valor resolvido (sem valor/hora ou
// digitado inválido) -- não entram no total e são sinalizadas.
export function totalPendenteJornadas(jornadas, digitados = {}) {
  const lista = jornadas || [];
  const semValor = lista.filter((j) => resolverValorAPagar(j.valor ?? null, digitados[chaveJornada(j)]).valor === null).length;
  return { total: somarValoresAPagar(lista, digitados), semValor, quantidade: lista.length };
}

// Total pendente de 1 pessoa mensal na competência: saldo da base + extras
// remunerados pendentes (mesma resolução de valor das jornadas).
export function totalPendenteMensal(resumo, digitados = {}) {
  if (!resumo) return { total: 0, semValor: 0, extras: 0 };
  const extras = resumo.extras_pendentes || [];
  const t = totalPendenteJornadas(extras, digitados);
  const saldo = Math.max(0, centavos(resumo.saldo_base));
  return { total: (saldo + centavos(t.total)) / 100, semValor: t.semValor, extras: extras.length };
}

// Jornadas pendentes em ordem cronológica (data, depois horário),
// agrupadas por mês da data (competência "YYYY-MM-01") -- só para separar
// visualmente dentro do bloco da pessoa; não muda nenhuma pendência.
export function agruparPorCompetencia(jornadas) {
  const ordenadas = [...(jornadas || [])].sort((a, b) =>
    a.data === b.data ? String(a.hora_inicio).localeCompare(String(b.hora_inicio)) : a.data < b.data ? -1 : 1
  );
  const grupos = [];
  for (const j of ordenadas) {
    const competencia = `${j.data.slice(0, 7)}-01`;
    const atual = grupos[grupos.length - 1];
    if (atual && atual.competencia === competencia) atual.jornadas.push(j);
    else grupos.push({ competencia, jornadas: [j] });
  }
  return grupos;
}

// "1 jornada", "2 jornadas" -- nunca "jornada(s)".
export function plural(n, singular, pluralTexto) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

// Resumo do cabeçalho do bloco: "Nada pendente" | "1 jornada pendente" |
// "2 jornadas pendentes" | "1 jornada · 2 meses" | "3 jornadas · 2 meses".
export function descreverPendencias(quantidade, meses = 1) {
  if (!quantidade) return 'Nada pendente';
  if (meses > 1) return `${plural(quantidade, 'jornada', 'jornadas')} · ${plural(meses, 'mês', 'meses')}`;
  return plural(quantidade, 'jornada pendente', 'jornadas pendentes');
}
