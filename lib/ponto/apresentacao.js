import { formatarMinutos } from './tempo.js';
import {
  FORA_VINCULO, PENDENCIAS, ROTULO_ATESTADO, ROTULO_SITUACAO, apurarCartao, apuracaoParaExibir, atestadosDoDia, situacaoDaEscala,
} from './apuracao.js';
import { MENSAGENS, codigoDoErro, colunasPrincipais, igualAoPrevisto, itemVazio, periodosDasColunas, validarItemDia } from './lancamento.js';

// Cartão-Ponto -- APRESENTAÇÃO (Etapa 2). Funções puras usadas pela tela,
// pelo PDF e pelo Excel: textos, selos, estado do cartão, rascunho de
// edição e prévias. Nenhuma regra de apuração/validação nova: tudo vem de
// apuracao.js e lancamento.js (as mesmas regras do SQL). Só TEMPO -- nada
// de valores (Pagamentos fica fora).

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// --- Competência ----------------------------------------------------------------

// 'AAAA-MM' (forma da URL) a partir de qualquer 'AAAA-MM[-DD]'.
export function mesDaCompetencia(valor) {
  return String(valor || '').slice(0, 7);
}

export function mesValido(valor) {
  if (typeof valor !== 'string') return false;
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function somarMeses(mes, quantidade) {
  const [a, m] = mes.split('-').map(Number);
  const total = a * 12 + (m - 1) + quantidade;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function rotuloCompetencia(valor) {
  const [a, m] = mesDaCompetencia(valor).split('-').map(Number);
  return `${MESES[m - 1]}/${a}`;
}

// --- Formatação -------------------------------------------------------------------

export function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '';
  const [a, m, d] = dataYYYYMMDD.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(data);
}

export function rotuloDia(dia) {
  return `${dia.data.slice(8, 10)} ${DIAS_SEMANA[dia.dia_semana]}`;
}

// Duração 'HH:MM'; null (dia não apurado) -> '—'.
export function horas(minutos) {
  return minutos === null || minutos === undefined ? '—' : formatarMinutos(minutos);
}

// Saldo LÍQUIDO do dia (extra − faltante): '+00:30', '−01:00', '00:00'.
export function saldoDoDia(dia) {
  if (dia.extra_min === null || dia.extra_min === undefined) return { minutos: null, texto: '—', tom: 'neutral' };
  const minutos = dia.extra_min - dia.faltante_min;
  if (minutos > 0) return { minutos, texto: `+${formatarMinutos(minutos)}`, tom: 'success' };
  if (minutos < 0) return { minutos, texto: `−${formatarMinutos(-minutos)}`, tom: 'danger' };
  return { minutos: 0, texto: '00:00', tom: 'neutral' };
}

// Desvios do dia, sempre visíveis mesmo com saldo zero.
export function desviosDoDia(dia) {
  const partes = [];
  if (dia.trabalhado_fora_previsto_min > 0) partes.push(`fora do previsto ${formatarMinutos(dia.trabalhado_fora_previsto_min)}`);
  if (dia.previsto_nao_coberto_min > 0) partes.push(`não coberto ${formatarMinutos(dia.previsto_nao_coberto_min)}`);
  return partes.join(' · ');
}

// Dia de trabalho já passado ainda SEM horário (nem atestado parcial).
export function diaNaoLancado(dia) {
  return dia.pendencias.includes('sem_lancamento');
}

// Parte do Faltante que vem de dias ainda NÃO lançados (o previsto inteiro
// conta como não coberto até haver horário). Só soma valores da apuração.
export function faltanteDeDiasNaoLancados(apuracao) {
  return apuracao.dias.filter(diaNaoLancado).reduce((soma, d) => soma + (d.faltante_min ?? 0), 0);
}

// Como a tela, o PDF e o Excel mostram o saldo do dia -- só leitura dos valores da apuração
// (nada recalculado). Separa o que ainda não foi lançado (pendência, não
// falta) da Falta registrada, do previsto não coberto e do saldo apurado:
//   estado: 'nao_apurado' | 'nao_lancado' | 'falta' | 'pendente' | 'apurado'
// `minutos` é sempre o saldo da apuração (o mesmo do PDF/Excel e dos totais).
export function leituraDoSaldo(dia) {
  const s = saldoDoDia(dia);
  if (dia.fora_vinculo || dia.futuro) return { ...s, estado: 'nao_apurado', nota: null };
  if (diaNaoLancado(dia)) {
    return {
      ...s,
      estado: 'nao_lancado',
      texto: 'A lançar',
      tom: 'warning',
      nota: dia.previsto_min ? `previsto ${formatarMinutos(dia.previsto_min)}` : 'sem horário',
    };
  }
  if (dia.situacao === 'falta') return { ...s, estado: 'falta', nota: 'Falta registrada' };
  if (dia.pendencias.length > 0) return { ...s, estado: 'pendente', tom: s.tom === 'danger' ? 'warning' : s.tom, nota: 'pendente' };
  return { ...s, estado: 'apurado', nota: desviosDoDia(dia) || null };
}

export function textoPeriodos(periodos, campos = ['inicio', 'fim']) {
  return (periodos || []).map((p) => `${String(p[campos[0]]).slice(0, 5)}–${String(p[campos[1]]).slice(0, 5)}`).join(' · ');
}

// O que a Escala prevê para o dia (texto curto).
export function textoPrevisto(escala) {
  if (!escala) return 'Não definido';
  if (escala.tipo === 'folga') return 'Folga';
  const horarios = textoPeriodos(escala.periodos) || 'Sem horário';
  if (escala.ocorrencia?.tipo === 'falta') return `${horarios} · Falta`;
  if (escala.ocorrencia?.tipo === 'atestado') return `${horarios} · Atestado`;
  return horarios;
}

const TOM_SITUACAO = {
  trabalho: 'neutral', folga: 'primary', falta: 'danger', atestado: 'warning', nao_definido: 'warning', fora_vinculo: 'neutral',
};

// Selo da situação CONSIDERADA no cartão + de onde veio, quando difere da
// Escala (ex.: "Escala: Falta" num dia que virou Atestado).
export function seloSituacao(dia) {
  const rotulo = dia.fora_vinculo ? FORA_VINCULO[dia.fora_vinculo] : ROTULO_SITUACAO[dia.situacao] || dia.situacao;
  const origem = !dia.fora_vinculo && dia.situacao !== dia.situacao_escala ? `Escala: ${ROTULO_SITUACAO[dia.situacao_escala]}` : null;
  return { rotulo, tom: dia.fora_vinculo ? 'neutral' : TOM_SITUACAO[dia.situacao] || 'neutral', origem, ajustado: Boolean(dia.ajustado) };
}

export function textoPendencias(dia) {
  return dia.pendencias.map((p) => PENDENCIAS[p] || p);
}

export function rotuloAtestado(a) {
  const tipo = ROTULO_ATESTADO[a.tipo] || a.tipo;
  const inicio = String(a.data_inicio).slice(0, 10);
  const fim = String(a.data_fim).slice(0, 10);
  if (a.abrangencia === 'parcial') return `${tipo} · ${formatarData(inicio)} ${String(a.hora_inicio).slice(0, 5)}–${String(a.hora_fim).slice(0, 5)}`;
  const dias = Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000) + 1;
  return inicio === fim ? `${tipo} · ${formatarData(inicio)} (dia inteiro)` : `${tipo} · ${formatarData(inicio)} a ${formatarData(fim)} (${dias} dias)`;
}

// --- Estado do cartão -------------------------------------------------------------

export const STATUS_CARTAO = {
  nao_aberto: { rotulo: 'Não aberto', tom: 'neutral' },
  em_preenchimento: { rotulo: 'Em preenchimento', tom: 'info' },
  conferido: { rotulo: 'Conferido', tom: 'primary' },
  conferencia_desatualizada: { rotulo: 'Conferência desatualizada', tom: 'warning' },
  fechado: { rotulo: 'Fechado', tom: 'success' },
};

// cartao = base.cartao (folha_ponto_base) ou null.
export function statusDoCartao(cartao) {
  if (!cartao) return 'nao_aberto';
  if (cartao.status === 'fechado') return 'fechado';
  if (cartao.conferido_em) return cartao.conferencia_atual ? 'conferido' : 'conferencia_desatualizada';
  return 'em_preenchimento';
}

// Linha do resumo da competência ANTES de a base ser lida (sem saber se a
// conferência ainda vale).
export function statusDoResumo(linha) {
  if (!linha.cartao_id) return 'nao_aberto';
  if (linha.status === 'fechado') return 'fechado';
  return linha.conferido ? 'conferido' : 'em_preenchimento';
}

// O que a tela mostra: snapshot (fechado) ou base atual + apuração.
export function leituraDoCartao(baseComCartao) {
  const exibir = apuracaoParaExibir(baseComCartao);
  return { ...exibir, status: statusDoCartao(baseComCartao.cartao) };
}

// Resumo de uma funcionária na lista (pendentes apurados da base lida).
export function resumoDaBase(baseComCartao) {
  const { apuracao, status } = leituraDoCartao(baseComCartao);
  return { status, pendentes: apuracao.totais.dias_pendentes, encerrada: apuracao.competencia_encerrada };
}

// Ações do cabeçalho: { visivel, habilitado, motivo } por ação -- o banco
// confere de novo; aqui é só para a tela explicar por que não dá.
export function acoesDoCartao({ status, apuracao, pode, competenciaFutura = false, semVinculo = false }) {
  const pendentes = apuracao?.totais.dias_pendentes ?? 0;
  const encerrada = Boolean(apuracao?.competencia_encerrada);
  const bloqueioConferir = !encerrada ? 'A competência ainda não terminou.' : pendentes > 0 ? `Há ${pendentes} dia(s) pendente(s).` : null;
  return {
    abrir: {
      visivel: status === 'nao_aberto' && pode.lancar,
      habilitado: !competenciaFutura && !semVinculo,
      motivo: competenciaFutura ? 'Competência futura.' : semVinculo ? 'Sem vínculo CLT nesta competência.' : null,
    },
    lancar: { visivel: pode.lancar && status !== 'nao_aberto' && status !== 'fechado' },
    conferir: {
      visivel: pode.fechar && (status === 'em_preenchimento' || status === 'conferencia_desatualizada'),
      habilitado: !bloqueioConferir,
      motivo: bloqueioConferir,
    },
    fechar: {
      visivel: pode.fechar && (status === 'conferido' || status === 'em_preenchimento' || status === 'conferencia_desatualizada'),
      habilitado: status === 'conferido',
      motivo: status === 'conferido' ? null : status === 'conferencia_desatualizada' ? 'Confira de novo antes de fechar.' : 'Confira o cartão antes de fechar.',
    },
    reabrir: { visivel: pode.reabrir && status === 'fechado', habilitado: true, motivo: null },
  };
}

export function permissoesDoPonto(permissoes, hasPermissao, PERMISSOES) {
  return {
    visualizar: hasPermissao(permissoes, PERMISSOES.FOLHA_PONTO_VISUALIZAR),
    lancar: hasPermissao(permissoes, PERMISSOES.FOLHA_PONTO_LANCAR),
    fechar: hasPermissao(permissoes, PERMISSOES.FOLHA_PONTO_FECHAR),
    reabrir: hasPermissao(permissoes, PERMISSOES.FOLHA_PONTO_REABRIR),
  };
}

// --- Rascunho de edição -------------------------------------------------------------

// Rascunho de um dia = o lançamento como a tela edita: situação (null =
// segue a Escala), motivo, observação e as colunas de horário.
export function rascunhoDoDia(dia) {
  const l = dia.lancamento || null;
  return {
    situacao: l?.situacao ?? null,
    motivo: l?.motivo ?? '',
    observacao: l?.observacao ?? '',
    ...colunasPrincipais(l?.periodos || []),
  };
}

export function itemDoRascunho(data, rascunho) {
  return {
    data,
    situacao: rascunho.situacao ?? null,
    motivo: rascunho.motivo ?? null,
    observacao: rascunho.observacao ?? null,
    periodos: periodosDasColunas(rascunho),
  };
}

function normalizado(item) {
  const t = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return JSON.stringify({
    situacao: item.situacao ?? null,
    motivo: item.situacao ? t(item.motivo) : null,
    observacao: t(item.observacao),
    periodos: [...(item.periodos || [])].map((p) => [p.entrada || '', p.saida || '']).sort(),
  });
}

// Dias cujo rascunho difere do lançamento gravado.
export function diasAlterados(base, rascunhos) {
  return base.dias
    .filter((d) => rascunhos[d.data])
    .filter((d) => normalizado(itemDoRascunho(d.data, rascunhos[d.data])) !== normalizado(itemDoRascunho(d.data, rascunhoDoDia(d))))
    .map((d) => d.data);
}

// Lote para folha_ponto_dias_salvar, validado com as MESMAS regras do banco
// (validarItemDia). erros = { data: {codigo, mensagem} }.
export function montarLote(base, rascunhos) {
  const porData = new Map(base.dias.map((d) => [d.data, d]));
  const itens = [];
  const erros = {};
  for (const data of diasAlterados(base, rascunhos)) {
    const r = validarItemDia(itemDoRascunho(data, rascunhos[data]), {
      dia: porData.get(data), funcionario: base.funcionario, hoje: base.hoje, atestados: base.atestados || [],
    });
    if (r.erro) erros[data] = r.erro;
    else itens.push(r.item);
  }
  return { itens, erros, total: itens.length + Object.keys(erros).length };
}

// Base com os rascunhos aplicados (só no navegador) -- a grade e os totais
// mostram o efeito ANTES de salvar, com a mesma apuração.
export function baseComRascunhos(base, rascunhos) {
  const alterados = new Set(diasAlterados(base, rascunhos));
  if (alterados.size === 0) return base;
  return {
    ...base,
    dias: base.dias.map((d) => {
      if (!alterados.has(d.data)) return d;
      const item = itemDoRascunho(d.data, rascunhos[d.data]);
      const periodos = item.periodos.filter((p) => p.entrada && p.saida);
      const vazio = itemVazio({ ...item, periodos });
      return {
        ...d,
        lancamento: vazio ? null : {
          ...(d.lancamento || {}),
          situacao: item.situacao, motivo: item.motivo, observacao: item.observacao, periodos,
        },
      };
    }),
  };
}

// "Igual ao previsto" no rascunho.
export function rascunhoIgualAoPrevisto(dia, rascunho) {
  return { ...rascunho, ...colunasPrincipais(igualAoPrevisto(dia.escala)) };
}

// Pode lançar horário neste dia? (só a tela; o banco confere de novo)
export function diaEditavel(dia, { aberto, atestados = [] }) {
  if (!aberto || dia.fora_vinculo || dia.futuro) return { horarios: false, ajuste: false };
  const integral = atestadosDoDia(atestados, dia.data).integral;
  return { horarios: !integral, ajuste: true };
}

// Situação da Escala para o rascunho (o select de ajuste parte dela).
export function situacaoBaseDoDia(dia) {
  return situacaoDaEscala(dia.escala || null);
}

// --- Prévia do impacto de um atestado -----------------------------------------------

// atestado = como validarAtestado devolve; idEditado = o que está sendo
// alterado (sai da lista antes de entrar a versão nova). Compara a
// apuração do mês antes x depois, só no navegador.
export function impactoDoAtestado(base, atestado, idEditado = null) {
  const atuais = (base.atestados || []).filter((a) => a.id !== idEditado);
  const antes = apurarCartao(base);
  const depois = apurarCartao({ ...base, atestados: atestado ? [...atuais, { ...atestado, id: idEditado || 'novo' }] : atuais });
  const mudancas = [];
  depois.dias.forEach((d, i) => {
    const a = antes.dias[i];
    if (a.situacao !== d.situacao || a.atestado_min !== d.atestado_min || a.atestado_cobertura !== d.atestado_cobertura) {
      mudancas.push({
        data: d.data,
        de: ROTULO_SITUACAO[a.situacao] || a.situacao,
        para: ROTULO_SITUACAO[d.situacao] || d.situacao,
        atestado_antes: a.atestado_min,
        atestado_depois: d.atestado_min,
        falta_coberta: a.situacao === 'falta' && d.situacao === 'atestado',
        futuro: d.futuro,
        fora_vinculo: Boolean(d.fora_vinculo),
      });
    }
  });
  // Mesma regra do banco (atestado_com_trabalho): integral não cobre dia
  // com horário trabalhado -- a tela avisa antes de enviar (só o mês aberto;
  // os demais meses o banco confere).
  const diasComTrabalho = atestado?.abrangencia === 'integral'
    ? base.dias.filter((d) => d.data >= atestado.data_inicio && d.data <= atestado.data_fim && (d.lancamento?.periodos || []).length > 0).map((d) => d.data)
    : [];
  return {
    mudancas,
    diasComTrabalho,
    totais: {
      atestado_antes: antes.totais.atestado_min,
      atestado_depois: depois.totais.atestado_min,
      faltas_antes: antes.totais.faltas_qtd,
      faltas_depois: depois.totais.faltas_qtd,
      faltante_antes: antes.totais.faltante_min,
      faltante_depois: depois.totais.faltante_min,
    },
  };
}

// --- Totais (cards) -------------------------------------------------------------------

export function cardsDeTotais(totais) {
  return [
    { chave: 'previsto', rotulo: 'Previsto', valor: horas(totais.previsto_min) },
    { chave: 'trabalhado', rotulo: 'Trabalhado', valor: horas(totais.trabalhado_min) },
    { chave: 'atestado', rotulo: 'Atestado', valor: horas(totais.atestado_min), ajuda: 'Horas previstas justificadas por atestado (não são horas trabalhadas).' },
    { chave: 'fora', rotulo: 'Fora do previsto', valor: horas(totais.trabalhado_fora_previsto_min), ajuda: 'Trabalho realizado fora do horário da Escala.' },
    { chave: 'nao_coberto', rotulo: 'Previsto não coberto', valor: horas(totais.previsto_nao_coberto_min), ajuda: 'Horário previsto sem trabalho nem atestado.' },
    { chave: 'extra', rotulo: 'Extra (saldo)', valor: horas(totais.extra_min), tom: totais.extra_min > 0 ? 'success' : null, ajuda: 'Soma dos saldos positivos de cada dia (sem compensação entre dias).' },
    { chave: 'faltante', rotulo: 'Faltante (saldo)', valor: horas(totais.faltante_min), tom: totais.faltante_min > 0 ? 'danger' : null, ajuda: 'Soma dos saldos negativos de cada dia (sem compensação entre dias).' },
    { chave: 'faltas', rotulo: 'Faltas', valor: String(totais.faltas_qtd), sufixo: 'dia(s)' },
    { chave: 'atestados', rotulo: 'Atestados', valor: String(totais.atestados_integrais_qtd), sufixo: 'dia(s)' },
    { chave: 'pendentes', rotulo: 'Pendentes', valor: String(totais.dias_pendentes), sufixo: 'dia(s)', tom: totais.dias_pendentes > 0 ? 'warning' : null },
  ];
}

// Resumo do topo do cartão: 4 números principais (Previsto, Trabalhado,
// Saldo, Dias pendentes) e o resto em área secundária -- os MESMOS valores
// de cardsDeTotais, só reorganizados. Saldo = Extra − Faltante (soma dos
// saldos de cada dia); quando parte dele vem de dias ainda sem horário,
// a nota diz quanto e o tom é de pendência, não de falta.
export function resumoDoCartao(apuracao) {
  const { totais } = apuracao;
  const cards = cardsDeTotais(totais);
  const porChave = Object.fromEntries(cards.map((c) => [c.chave, c]));
  const saldo = totais.extra_min - totais.faltante_min;
  const aLancarMin = faltanteDeDiasNaoLancados(apuracao);
  const texto = saldo > 0 ? `+${formatarMinutos(saldo)}` : saldo < 0 ? `−${formatarMinutos(-saldo)}` : '00:00';
  let tom = saldo > 0 ? 'success' : null;
  if (saldo < 0) tom = aLancarMin > 0 ? 'warning' : 'danger';
  const principais = [
    porChave.previsto,
    porChave.trabalhado,
    {
      chave: 'saldo',
      rotulo: 'Saldo',
      valor: texto,
      tom,
      nota: aLancarMin > 0 ? `inclui −${formatarMinutos(aLancarMin)} de dias ainda não lançados` : null,
      ajuda: 'Extra − Faltante: a soma dos saldos de cada dia. Detalhe em "Mais indicadores".',
    },
    { ...porChave.pendentes, rotulo: 'Dias pendentes' },
  ];
  const secundarios = cards
    .filter((c) => !['previsto', 'trabalhado', 'pendentes'].includes(c.chave))
    .map((c) => (c.chave === 'faltante' && aLancarMin > 0
      ? { ...c, tom: 'warning', nota: `${formatarMinutos(aLancarMin)} a lançar + ${formatarMinutos(totais.faltante_min - aLancarMin)} apurado` }
      : c));
  return { principais, secundarios };
}

// Avisos do cabeçalho do cartão, em ordem de importância.
export function avisosDoCartao({ status, apuracao, cartao, divergencias = [], competencia, semVinculo = false }) {
  const avisos = [];
  if (semVinculo) {
    avisos.push({ tom: 'info', texto: `Sem vínculo CLT em nenhum dia de ${rotuloCompetencia(competencia)} (antes da admissão, depois do desligamento ou outro vínculo). Não há cartão a abrir.` });
    return avisos;
  }
  if (status === 'fechado') {
    avisos.push({ tom: 'success', texto: `Cartão fechado em ${formatarDataHora(cartao.fechado_em)}${cartao.fechado_por_nome ? ` por ${cartao.fechado_por_nome}` : ''}. Este é o documento congelado no fechamento.` });
    if (divergencias.length > 0) {
      avisos.push({ tom: 'info', texto: `A Escala mudou depois do fechamento em ${divergencias.length} dia(s) (${divergencias.slice(0, 5).map(formatarData).join(', ')}${divergencias.length > 5 ? '…' : ''}). O cartão fechado não muda; reabra se precisar corrigir.` });
    }
    return avisos;
  }
  if (status === 'nao_aberto') {
    avisos.push({ tom: 'info', texto: 'Prévia: o cartão desta competência ainda não foi aberto. Nada foi gravado.' });
  }
  if (status === 'conferencia_desatualizada') {
    avisos.push({ tom: 'warning', texto: 'A Escala ou o cartão mudou depois da conferência. Confira de novo antes de fechar.' });
  }
  if (status === 'conferido') {
    avisos.push({ tom: 'info', texto: `Conferido em ${formatarDataHora(cartao.conferido_em)}${cartao.conferido_por_nome ? ` por ${cartao.conferido_por_nome}` : ''}. Pronto para fechar.` });
  }
  if (!apuracao.competencia_encerrada) {
    avisos.push({ tom: 'info', texto: `Competência em andamento (${rotuloCompetencia(competencia)}): conferência e fechamento só depois do último dia.`, discreto: true });
  }
  if (apuracao.totais.dias_pendentes > 0) {
    avisos.push({ tom: 'warning', texto: `${apuracao.totais.dias_pendentes} dia(s) pendente(s).`, pendentes: true });
  }
  return avisos;
}

// Rótulos do histórico.
export const ROTULO_EVENTO = {
  abrir: 'Cartão aberto',
  ajustar_situacao: 'Situação ajustada',
  conferir: 'Conferido',
  fechar: 'Fechado',
  reabrir: 'Reaberto',
  atestado_registrar: 'Atestado registrado',
  atestado_alterar: 'Atestado alterado',
  atestado_cancelar: 'Atestado cancelado',
};

export function descricaoEvento(evento) {
  const partes = [ROTULO_EVENTO[evento.acao] || evento.acao];
  if (evento.data) partes.push(formatarData(evento.data));
  if (evento.acao === 'ajustar_situacao') {
    const de = ROTULO_SITUACAO[evento.situacao_anterior] || evento.situacao_anterior || 'Escala';
    const para = ROTULO_SITUACAO[evento.situacao_nova] || evento.situacao_nova || 'segue a Escala';
    partes.push(`${de} → ${para}`);
  }
  return partes.join(' · ');
}

// Nome de arquivo seguro: "Cartao-Ponto_2026-11_Sabrina-Souza".
export function nomeArquivoCartao(nome, competencia) {
  const limpo = String(nome || 'funcionaria').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `Cartao-Ponto_${mesDaCompetencia(competencia)}_${limpo || 'funcionaria'}`;
}

// --- Erros ----------------------------------------------------------------------------

// Código estável do banco ("folha_ponto: [codigo] ...") -> mensagem da
// tela (MENSAGENS de lancamento.js). Sem permissão (42501) e falha de rede
// ganham texto próprio. Erro já "amigável" (validação local) passa direto.
export function mensagemErroPonto(e) {
  if (e?.amigavel) return e.message;
  if (e?.code === '42501') return 'Você não tem permissão para esta ação no Cartão-Ponto.';
  const codigo = codigoDoErro(e?.message);
  if (codigo && MENSAGENS[codigo]) return MENSAGENS[codigo];
  if (/fetch|network|Failed to fetch/i.test(String(e?.message || ''))) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  return 'Não foi possível concluir a operação no Cartão-Ponto. Tente de novo.';
}

// Conflito de versão (outra pessoa/aba salvou antes): a tela oferece recarregar.
export function ehConflito(e) {
  return ['cartao_alterado', 'atestado_alterado'].includes(codigoDoErro(e?.message));
}

export function erroAmigavel(mensagem) {
  const e = new Error(mensagem);
  e.amigavel = true;
  return e;
}
