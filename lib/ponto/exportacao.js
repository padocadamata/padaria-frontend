import { TEMA } from '../branding/tema.js';
import { FORA_VINCULO, ROTULO_ATESTADO, ROTULO_SITUACAO } from './apuracao.js';
import { colunasPrincipais } from './lancamento.js';
import {
  faltanteDeDiasNaoLancados, formatarData, formatarDataHora, horas, leituraDoCartao, leituraDoSaldo, nomeArquivoCartao,
  rotuloCompetencia, rotuloDia, textoPeriodos, textoPrevisto,
} from './apresentacao.js';

// Cartão-Ponto -- MODELO de exportação (PDF e Excel), montado só com o que
// a tela já tem: cartão FECHADO = exclusivamente o snapshot gravado no
// fechamento; aberto/não aberto = base atual, marcado "PRÉVIA — NÃO
// FECHADO". Só TEMPO (nenhum valor). lib/ponto/pdf.js desenha o PDF e
// lib/exportacao/xlsx.js gera o Excel -- aqui ninguém desenha nada.

export const MARCA_PREVIA = 'PRÉVIA — NÃO FECHADO';

export const LEGENDA =
  'Saldo do dia = trabalho fora do previsto − previsto não coberto (positivo = extra, negativo = faltante), apurado minuto a minuto, sem tolerância e sem compensação entre dias. ' +
  'Atestado = horas previstas justificadas (não são horas trabalhadas). Fora do vínculo e dias futuros não são apurados (—). ' +
  'A LANÇAR = dia de trabalho já passado ainda sem horário: é pendência, não falta; até o lançamento, o previsto do dia entra no Faltante. ' +
  'Observação: fora = trabalho fora do previsto; não cob. = previsto não coberto.';

// Leitura do saldo do dia (mesma da tela). O valor em minutos é sempre o da apuração.
export const LEITURA_SALDO = {
  nao_lancado: 'A lançar (sem horário)',
  falta: 'Falta registrada',
  pendente: 'Pendente',
  apurado: 'Apurado',
  nao_apurado: '',
};

function situacaoTexto(dia) {
  if (dia.fora_vinculo) return FORA_VINCULO[dia.fora_vinculo];
  const rotulo = ROTULO_SITUACAO[dia.situacao] || dia.situacao;
  if (dia.situacao !== dia.situacao_escala) return `${rotulo} (Escala: ${ROTULO_SITUACAO[dia.situacao_escala]})`;
  return rotulo;
}

function tomDaSituacao(dia) {
  if (dia.fora_vinculo || dia.futuro) return 'vazio';
  if (dia.situacao === 'folga') return 'folga';
  if (dia.situacao === 'falta') return 'falta';
  if (dia.situacao === 'atestado' || dia.atestado_cobertura === 'parcial') return 'atestado';
  if (dia.pendencias.length > 0) return 'pendente';
  return null;
}

function observacaoDoDia(diaBase, dia, extras, leitura) {
  const partes = [];
  if (leitura.estado === 'nao_lancado') partes.push(`A lançar: ${leitura.nota}`);
  if (leitura.estado === 'falta') partes.push('Falta registrada');
  if (leitura.estado === 'apurado') {
    // Desvios do dia em forma curta (cabe numa linha do PDF; legenda explica).
    if (dia.trabalhado_fora_previsto_min > 0) partes.push(`fora ${horas(dia.trabalhado_fora_previsto_min)}`);
    if (dia.previsto_nao_coberto_min > 0) partes.push(`não cob. ${horas(dia.previsto_nao_coberto_min)}`);
  }
  if (extras.length > 0) partes.push(`+ ${textoPeriodos(extras, ['entrada', 'saida'])}`);
  if (dia.ajustado && diaBase.lancamento?.motivo) partes.push(`Ajuste: ${diaBase.lancamento.motivo}`);
  if (diaBase.lancamento?.observacao) partes.push(diaBase.lancamento.observacao);
  if (dia.futuro) partes.push('Dia futuro');
  if (dia.pendencias.some((p) => p !== 'sem_lancamento')) partes.push('PENDENTE');
  return partes.join(' · ');
}

// baseComCartao = retorno de folha_ponto_base. empresa = folha_documentos_config
// (ou null) -- num cartão fechado vale a do snapshot.
export function montarExportacaoCartao(baseComCartao, { empresa = null, geradoEm = new Date().toISOString() } = {}) {
  const { base, apuracao, status } = leituraDoCartao(baseComCartao);
  const cartao = baseComCartao.cartao;
  const fechado = status === 'fechado';
  const dadosEmpresa = (fechado ? cartao.snapshot.empresa : empresa) || {};
  const funcionaria = base.funcionario;
  const porData = new Map(base.dias.map((d) => [d.data, d]));

  const dias = apuracao.dias.map((dia) => {
    const diaBase = porData.get(dia.data);
    const col = colunasPrincipais(diaBase.lancamento?.periodos || []);
    const leitura = leituraDoSaldo(dia);
    return {
      data: dia.data,
      dia: rotuloDia(dia),
      feriado: dia.feriado,
      previsto: dia.fora_vinculo ? '' : textoPrevisto(diaBase.escala),
      situacao: situacaoTexto(dia),
      tom: tomDaSituacao(dia),
      entrada: col.entrada,
      saida_intervalo: col.saida_intervalo,
      retorno_intervalo: col.retorno_intervalo,
      saida: col.saida,
      extras: col.extras,
      periodos: textoPeriodos(diaBase.lancamento?.periodos || [], ['entrada', 'saida']),
      previsto_min: dia.previsto_min,
      trabalhado_min: dia.trabalhado_min,
      fora_min: dia.trabalhado_fora_previsto_min,
      atestado_min: dia.atestado_min,
      nao_coberto_min: dia.previsto_nao_coberto_min,
      extra_min: dia.extra_min,
      faltante_min: dia.faltante_min,
      saldo_min: leitura.minutos,
      saldo: leitura.estado === 'nao_lancado' ? 'A LANÇAR' : leitura.texto,
      estado_saldo: leitura.estado,
      leitura_saldo: LEITURA_SALDO[leitura.estado],
      observacao: observacaoDoDia(diaBase, dia, col.extras, leitura),
      motivo: dia.ajustado ? diaBase.lancamento?.motivo || '' : '',
      pendente: dia.pendencias.length > 0,
    };
  });

  const t = apuracao.totais;
  const aLancarMin = faltanteDeDiasNaoLancados(apuracao);
  const totais = [
    ['Previsto', horas(t.previsto_min), t.previsto_min],
    ['Trabalhado', horas(t.trabalhado_min), t.trabalhado_min],
    ['Trabalhado dentro do previsto', horas(t.trabalhado_no_previsto_min), t.trabalhado_no_previsto_min],
    ['Trabalhado fora do previsto', horas(t.trabalhado_fora_previsto_min), t.trabalhado_fora_previsto_min],
    ['Atestado (justificado)', horas(t.atestado_min), t.atestado_min],
    ['Previsto não coberto', horas(t.previsto_nao_coberto_min), t.previsto_nao_coberto_min],
    ['Extra (soma dos saldos positivos)', horas(t.extra_min), t.extra_min],
    ['Faltante (soma dos saldos negativos)', horas(t.faltante_min), t.faltante_min],
    // Faltante que inclui dias sem horário: diz quanto é pendência e quanto já foi apurado.
    ...(aLancarMin > 0 ? [
      ['   dos quais: dias ainda não lançados', horas(aLancarMin), aLancarMin],
      ['   dos quais: saldo negativo já apurado', horas(t.faltante_min - aLancarMin), t.faltante_min - aLancarMin],
    ] : []),
    ['Faltas (dias)', String(t.faltas_qtd), t.faltas_qtd],
    ['Atestados de dia inteiro (dias)', String(t.atestados_integrais_qtd), t.atestados_integrais_qtd],
    ['Dias trabalhados', String(t.dias_trabalhados), t.dias_trabalhados],
    ['Dias pendentes', String(t.dias_pendentes), t.dias_pendentes],
  ];

  const atestados = (base.atestados || []).map((a) => ({
    tipo: ROTULO_ATESTADO[a.tipo] || a.tipo,
    abrangencia: a.abrangencia === 'parcial' ? 'Parcial' : 'Dia inteiro',
    data_inicio: String(a.data_inicio).slice(0, 10),
    data_fim: String(a.data_fim).slice(0, 10),
    hora_inicio: a.hora_inicio ? String(a.hora_inicio).slice(0, 5) : '',
    hora_fim: a.hora_fim ? String(a.hora_fim).slice(0, 5) : '',
    descricao: a.descricao || '',
    registrado_por: a.registrado_por_nome || '',
    registrado_em: a.registrado_em || '',
  }));

  const competencia = base.competencia;
  const situacaoDocumento = fechado
    ? `Fechado em ${formatarDataHora(cartao.fechado_em)}${cartao.fechado_por_nome ? ` por ${cartao.fechado_por_nome}` : ''}` +
      (cartao.snapshot.conferido_em ? ` · Conferido em ${formatarDataHora(cartao.snapshot.conferido_em)}${cartao.snapshot.conferido_por_nome ? ` por ${cartao.snapshot.conferido_por_nome}` : ''}` : '')
    : MARCA_PREVIA;

  const modelo = {
    titulo: 'Cartão-Ponto',
    competencia,
    competenciaRotulo: rotuloCompetencia(competencia),
    nomeArquivo: nomeArquivoCartao(funcionaria.nome, competencia) + (fechado ? '' : '_PREVIA'),
    previa: !fechado,
    situacaoDocumento,
    geradoEm: formatarDataHora(geradoEm),
    empresa: {
      nome: dadosEmpresa.nome_fantasia || TEMA.nomeEmpresa,
      razao_social: dadosEmpresa.razao_social || '',
      cnpj: dadosEmpresa.cnpj || '',
      cidade_uf: dadosEmpresa.cidade_uf || '',
    },
    funcionaria: {
      nome: funcionaria.nome,
      cargo: funcionaria.cargo || '',
      admissao: funcionaria.data_admissao ? formatarData(funcionaria.data_admissao) : '',
      desligamento: funcionaria.data_demissao ? formatarData(funcionaria.data_demissao) : '',
    },
    dias,
    totais,
    atestados,
    legenda: LEGENDA,
  };
  modelo.planilhas = planilhasDoCartao(modelo);
  return modelo;
}

// Excel: abas Dias, Totais e Atestados. Durações do dia como HORA (hh:mm,
// sempre < 24h); totais como texto HH:MM + minutos (podem passar de 24h).
export function planilhasDoCartao(modelo) {
  const h = (min) => (min === null || min === undefined ? null : horas(min));
  const cabecalho = [
    ['Empresa', modelo.empresa.nome, null],
    ['Funcionária', modelo.funcionaria.nome, null],
    ['Cargo', modelo.funcionaria.cargo, null],
    ['Competência', modelo.competenciaRotulo, null],
    ['Documento', modelo.situacaoDocumento, null],
    ['Gerado em', modelo.geradoEm, null],
  ];
  return [
    {
      nome: 'Dias',
      colunas: [
        { titulo: 'Data', tipo: 'data', largura: 12 },
        { titulo: 'Dia', tipo: 'texto', largura: 8 },
        { titulo: 'Feriado', tipo: 'texto', largura: 18 },
        { titulo: 'Previsto (Escala)', tipo: 'texto', largura: 24 },
        { titulo: 'Situação', tipo: 'texto', largura: 26 },
        { titulo: 'Entrada', tipo: 'hora', largura: 9 },
        { titulo: 'Saída intervalo', tipo: 'hora', largura: 10 },
        { titulo: 'Retorno intervalo', tipo: 'hora', largura: 10 },
        { titulo: 'Saída', tipo: 'hora', largura: 9 },
        { titulo: 'Todos os períodos', tipo: 'texto', largura: 28 },
        { titulo: 'Previsto (h)', tipo: 'hora', largura: 10 },
        { titulo: 'Trabalhado (h)', tipo: 'hora', largura: 11 },
        { titulo: 'Fora do previsto (h)', tipo: 'hora', largura: 12 },
        { titulo: 'Atestado (h)', tipo: 'hora', largura: 10 },
        { titulo: 'Não coberto (h)', tipo: 'hora', largura: 11 },
        { titulo: 'Saldo do dia', tipo: 'texto', largura: 11 },
        { titulo: 'Saldo (min)', tipo: 'numero', largura: 10 },
        { titulo: 'Leitura do saldo', tipo: 'texto', largura: 20 },
        { titulo: 'Motivo do ajuste', tipo: 'texto', largura: 28 },
        { titulo: 'Observação', tipo: 'texto', largura: 36 },
      ],
      linhas: modelo.dias.map((d) => [
        d.data, d.dia.slice(3), d.feriado || '', d.previsto, d.situacao,
        d.entrada || null, d.saida_intervalo || null, d.retorno_intervalo || null, d.saida || null, d.periodos,
        h(d.previsto_min), h(d.trabalhado_min), h(d.fora_min), h(d.atestado_min), h(d.nao_coberto_min),
        d.saldo === '—' ? '' : d.saldo, d.saldo_min, d.leitura_saldo, d.motivo, d.observacao,
      ]),
    },
    {
      nome: 'Totais',
      semFiltro: true,
      colunas: [
        { titulo: 'Item', tipo: 'texto', largura: 36 },
        { titulo: 'Valor', tipo: 'texto', largura: 44 },
        { titulo: 'Minutos / quantidade', tipo: 'numero', largura: 20 },
      ],
      linhas: [...cabecalho, [null, null, null], ...modelo.totais],
    },
    {
      nome: 'Atestados',
      colunas: [
        { titulo: 'Tipo', tipo: 'texto', largura: 18 },
        { titulo: 'Abrangência', tipo: 'texto', largura: 12 },
        { titulo: 'Início', tipo: 'data', largura: 12 },
        { titulo: 'Fim', tipo: 'data', largura: 12 },
        { titulo: 'Hora início', tipo: 'hora', largura: 10 },
        { titulo: 'Hora fim', tipo: 'hora', largura: 10 },
        { titulo: 'Descrição', tipo: 'texto', largura: 40 },
        { titulo: 'Registrado por', tipo: 'texto', largura: 20 },
      ],
      linhas: modelo.atestados.map((a) => [
        a.tipo, a.abrangencia, a.data_inicio, a.data_fim, a.hora_inicio || null, a.hora_fim || null, a.descricao, a.registrado_por,
      ]),
    },
  ];
}
