import { formatarHora, formatarPeriodo, obterEstadoDia, rotuloDiaSemana, formatarDataCurta, formatarPeriodoSemana, diaDaSemanaIndice } from './escala.js';
import { classificarCelulaMensal } from './escalaFaixas.js';
import { resolverCoberturaPeriodo, nomesComDesambiguacao } from './escalaCobertura.js';
import { rotuloVinculo } from './vinculo.js';
import { mesExibicao } from '../data/dataLocal.js';

// Modelos de EXPORTAÇÃO (PDF/Excel) da Escala -- funções puras que só
// REORGANIZAM o que as visões já calculam, nunca uma regra nova:
//   * Semanal  -> EstadoDia de obterEstadoDia (mesma fonte da grade);
//   * Mensal   -> classificarCelulaMensal (regra M/T publicada, escalaFaixas.js);
//   * Cobertura-> resolverCoberturaPeriodo (motor único, escalaCobertura.js).
// O resultado é agnóstico de biblioteca: `pdf.secoes` (tabelas com texto +
// "tom" semântico) e `planilhas` (colunas tipadas) -- lib/exportacao/pdf.js
// e lib/exportacao/xlsx.js só desenham.
//
// `funcionarios` recebidos aqui já são as LINHAS filtradas pela tela
// (filtrarFuncionariosEscala) -- o arquivo representa exatamente o que está
// na tela. A Cobertura recebe também a base de cálculo (só cargo), ver
// montarExportacaoCobertura.

const ROTULO_OCORRENCIA = { falta: 'Falta', atestado: 'Atestado' };
const ROTULO_NATUREZA = { extra_remunerado: 'Extra remunerado' };

function nomeCargo(funcionario) {
  return funcionario.funcionarios_cargos?.nome || '';
}

function rotuloOcorrencia(ocorrencia) {
  return ocorrencia ? ROTULO_OCORRENCIA[ocorrencia.tipo] || ocorrencia.tipo : '';
}

// "06/10/2026 08:15" no fuso da Padoca (mesmo critério de dataLocal.js:
// nunca o fuso do dispositivo).
export function formatarGeradoEm(data = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);
  const v = {};
  for (const p of partes) v[p.type] = p.value;
  return `${v.day}/${v.month}/${v.year} ${v.hour}:${v.minute}`;
}

function cabecalhoBase({ tipo, rotuloTipo, periodoRotulo, filtroDescricao, geradoEm, nomeArquivo }) {
  return {
    tipo,
    titulo: `Escala — ${rotuloTipo}`,
    rotuloTipo,
    periodoRotulo,
    filtros: { cargo: filtroDescricao?.cargo || null, funcionario: filtroDescricao?.funcionario || null },
    geradoEm: geradoEm || formatarGeradoEm(),
    nomeArquivo,
  };
}

// Aba "Filtros" do Excel -- identifica o relatório dentro do próprio
// arquivo (o PDF faz isso no cabeçalho de cada página).
function planilhaIdentificacao(base) {
  return {
    nome: 'Relatório',
    semFiltro: true,
    colunas: [
      { titulo: 'Campo', tipo: 'texto', largura: 18 },
      { titulo: 'Valor', tipo: 'texto', largura: 48 },
    ],
    linhas: [
      ['Empresa', 'Padoca da Mata'],
      ['Relatório', base.titulo],
      ['Período', base.periodoRotulo],
      ['Cargo', base.filtros.cargo || 'Todos os cargos'],
      ['Funcionária', base.filtros.funcionario || 'Todas as funcionárias'],
      ['Gerado em', base.geradoEm],
    ],
  };
}

function rotuloColunaDia(data) {
  return `${rotuloDiaSemana(data)} ${formatarDataCurta(data)}`;
}

// ------------------------------------------------------------
// Linhas "longas" (1 por funcionária × dia × período) -- usadas pela
// Semanal e pela aba de escala da Cobertura. Dia não definido/folga = 1
// linha sem horário (o estado nunca some do arquivo).
// ------------------------------------------------------------
const COLUNAS_ESCALA_LONGA = [
  { titulo: 'Funcionária', tipo: 'texto', largura: 28 },
  { titulo: 'Cargo', tipo: 'texto', largura: 18 },
  { titulo: 'Vínculo', tipo: 'texto', largura: 11 },
  { titulo: 'Data', tipo: 'data', largura: 12 },
  { titulo: 'Dia da semana', tipo: 'texto', largura: 13 },
  { titulo: 'Estado', tipo: 'texto', largura: 13 },
  { titulo: 'Ocorrência', tipo: 'texto', largura: 12 },
  { titulo: 'Período nº', tipo: 'numero', largura: 11 },
  { titulo: 'Início', tipo: 'hora', largura: 9 },
  { titulo: 'Fim', tipo: 'hora', largura: 9 },
  { titulo: 'Natureza', tipo: 'texto', largura: 17 },
];

function linhasEscalaLonga({ funcionarios, dias, mapaEscala }) {
  const linhas = [];
  for (const f of funcionarios) {
    for (const data of dias) {
      const estado = obterEstadoDia(mapaEscala, f.id, data);
      const base = [f.nome, nomeCargo(f), rotuloVinculo(f.tipo_vinculo), data, rotuloDiaSemana(data)];
      if (!estado) {
        linhas.push([...base, 'Não definido', '', null, null, null, '']);
      } else if (estado.tipo === 'folga') {
        linhas.push([...base, 'Folga', '', null, null, null, '']);
      } else if (estado.periodos.length === 0) {
        linhas.push([...base, 'Trabalho', rotuloOcorrencia(estado.ocorrencia), null, null, null, '']);
      } else {
        estado.periodos.forEach((p, i) => {
          linhas.push([
            ...base,
            'Trabalho',
            rotuloOcorrencia(estado.ocorrencia),
            i + 1,
            formatarHora(p.hora_inicio),
            formatarHora(p.hora_fim),
            ROTULO_NATUREZA[p.natureza_financeira] || 'Normal',
          ]);
        });
      }
    }
  }
  return linhas;
}

// Célula da grade Semanal no PDF: os MESMOS textos da tela (períodos
// reais, Folga, Não definido, selo Falta/Atestado, "· extra").
export function celulaSemanalPdf(estado) {
  if (!estado) return { texto: '—', tom: 'vazio' };
  if (estado.tipo === 'folga') return { texto: 'Folga', tom: 'folga' };
  const linhas = estado.periodos.map((p) => `${formatarPeriodo(p)}${p.natureza_financeira === 'extra_remunerado' ? ' · extra' : ''}`);
  if (estado.ocorrencia) linhas.push(rotuloOcorrencia(estado.ocorrencia).toUpperCase());
  return { texto: linhas.join('\n') || 'Trabalho', tom: estado.ocorrencia ? estado.ocorrencia.tipo : 'trabalho' };
}

function secaoGradeSemanal({ funcionarios, dias, mapaEscala, titulo }) {
  return {
    titulo,
    cabecalho: ['Funcionária', 'Cargo', ...dias.map(rotuloColunaDia)],
    colunasFimDeSemana: dias.map((d, i) => (ehFimDeSemana(d) ? i + 2 : null)).filter((i) => i !== null),
    larguras: { 0: 40, 1: 26 },
    colunasTexto: 2,
    linhas: funcionarios.map((f) => [f.nome, nomeCargo(f), ...dias.map((data) => celulaSemanalPdf(obterEstadoDia(mapaEscala, f.id, data)))]),
    vazio: 'Nenhuma funcionária para este filtro.',
  };
}

function ehFimDeSemana(data) {
  const d = diaDaSemanaIndice(data);
  return d === 0 || d === 6;
}

function intervaloArquivo(dias) {
  return `${dias[0]}_a_${dias[dias.length - 1]}`;
}

// ------------------------------------------------------------
// SEMANAL
// ------------------------------------------------------------
export function montarExportacaoSemanal({ dias, funcionarios, mapaEscala, filtroDescricao, geradoEm }) {
  const base = cabecalhoBase({
    tipo: 'semanal',
    rotuloTipo: 'Semanal',
    periodoRotulo: formatarPeriodoSemana(dias),
    filtroDescricao,
    geradoEm,
    nomeArquivo: `escala-semanal_${intervaloArquivo(dias)}`,
  });

  return {
    ...base,
    pdf: {
      secoes: [secaoGradeSemanal({ funcionarios, dias, mapaEscala })],
      legenda: '— = não definido · Folga = folga programada · FALTA/ATESTADO = ocorrência registrada sobre o horário previsto · extra = período extra remunerado.',
    },
    planilhas: [
      { nome: 'Escala semanal', colunas: COLUNAS_ESCALA_LONGA, linhas: linhasEscalaLonga({ funcionarios, dias, mapaEscala }) },
      planilhaIdentificacao(base),
    ],
  };
}

// ------------------------------------------------------------
// MENSAL -- leitura compacta M/T REUTILIZANDO classificarCelulaMensal
// (nunca reimplementa a regra de faixas).
// ------------------------------------------------------------

// Rótulo compacto de UMA célula: "M+T" / "M" / "T"; um dia de trabalho
// fora das duas faixas mostra os horários reais (a tela mostra M e T
// apagados -- aqui seria ambíguo, então o horário vai por extenso).
export function leituraMensal(info) {
  if (info.tipo === 'nao_definido') return 'Não definido';
  if (info.tipo === 'folga') return 'Folga';
  if (info.manha && info.tarde) return 'M+T';
  if (info.manha) return 'M';
  if (info.tarde) return 'T';
  return '';
}

export function celulaMensalPdf(estado) {
  const info = classificarCelulaMensal(estado);
  if (info.tipo === 'nao_definido') return { texto: '—', tom: 'vazio' };
  if (info.tipo === 'folga') return { texto: 'Folga', tom: 'folga' };
  const leitura = leituraMensal(info) || info.periodos.map(formatarPeriodo).join('\n');
  if (info.ocorrencia) return { texto: `${leitura}\n${rotuloOcorrencia(info.ocorrencia)}`, tom: info.ocorrencia.tipo };
  return { texto: leitura, tom: 'trabalho' };
}

// Divide os dias do mês em blocos legíveis (A4 paisagem): 1–16 e 17–fim,
// em vez de espremer 31 colunas numa página só.
export function blocosDeDiasMensal(dias, tamanho = 16) {
  const blocos = [];
  for (let i = 0; i < dias.length; i += tamanho) blocos.push(dias.slice(i, i + tamanho));
  return blocos;
}

export function montarExportacaoMensal({ dias, funcionarios, mapaEscala, filtroDescricao, geradoEm }) {
  const mes = dias[0].slice(0, 7);
  const base = cabecalhoBase({
    tipo: 'mensal',
    rotuloTipo: 'Mensal',
    periodoRotulo: mesExibicao(dias[0]),
    filtroDescricao,
    geradoEm,
    nomeArquivo: `escala-mensal_${mes}`,
  });

  const secoes = blocosDeDiasMensal(dias).map((bloco, _i, todos) => ({
    titulo: todos.length > 1 ? `Dias ${formatarDataCurta(bloco[0])} a ${formatarDataCurta(bloco[bloco.length - 1])}` : null,
    // Os dois blocos na MESMA página A4 (superior 01–16, inferior 17–fim);
    // só pagina se a quantidade de linhas realmente não couber.
    compacto: true,
    cabecalho: ['Funcionária', ...bloco.map((d) => `${rotuloDiaSemana(d)}\n${d.slice(8, 10)}`)],
    colunasFimDeSemana: bloco.map((d, j) => (ehFimDeSemana(d) ? j + 1 : null)).filter((j) => j !== null),
    // Dias com largura IGUAL (grade regular, independente do conteúdo):
    // 277 mm úteis do A4 paisagem - 45 mm da coluna de nomes.
    larguras: Object.fromEntries([[0, 45], ...bloco.map((_, j) => [j + 1, 232 / bloco.length])]),
    colunasTexto: 1,
    linhas: funcionarios.map((f) => [f.nome, ...bloco.map((data) => celulaMensalPdf(obterEstadoDia(mapaEscala, f.id, data)))]),
    vazio: 'Nenhuma funcionária para este filtro.',
  }));

  const linhasDados = [];
  for (const f of funcionarios) {
    for (const data of dias) {
      const estado = obterEstadoDia(mapaEscala, f.id, data);
      const info = classificarCelulaMensal(estado);
      const trabalho = info.tipo === 'trabalho';
      linhasDados.push([
        f.nome,
        nomeCargo(f),
        data,
        rotuloDiaSemana(data),
        info.tipo === 'nao_definido' ? 'Não definido' : info.tipo === 'folga' ? 'Folga' : 'Trabalho',
        trabalho ? (info.manha ? 'Sim' : 'Não') : '',
        trabalho ? (info.tarde ? 'Sim' : 'Não') : '',
        trabalho ? leituraMensal(info) : '',
        trabalho ? rotuloOcorrencia(info.ocorrencia) : '',
        trabalho ? info.periodos.map(formatarPeriodo).join(' ; ') : '',
      ]);
    }
  }

  const grade = funcionarios.map((f) => [
    f.nome,
    nomeCargo(f),
    ...dias.map((data) => {
      const info = classificarCelulaMensal(obterEstadoDia(mapaEscala, f.id, data));
      if (info.tipo === 'nao_definido') return '';
      const leitura = leituraMensal(info) || info.periodos.map(formatarPeriodo).join(' ; ');
      return info.ocorrencia ? `${leitura} (${rotuloOcorrencia(info.ocorrencia)})` : leitura;
    }),
  ]);

  return {
    ...base,
    pdf: {
      secoes,
      legenda: 'M = ocupa 06:00–12:00 · T = ocupa 12:00–19:30 · M+T = ambas · — = não definido · Falta/Atestado = ocorrência registrada sobre o horário previsto.',
    },
    planilhas: [
      {
        nome: 'Mensal',
        colunas: [
          { titulo: 'Funcionária', tipo: 'texto', largura: 28 },
          { titulo: 'Cargo', tipo: 'texto', largura: 18 },
          { titulo: 'Data', tipo: 'data', largura: 12 },
          { titulo: 'Dia', tipo: 'texto', largura: 7 },
          { titulo: 'Estado', tipo: 'texto', largura: 13 },
          { titulo: 'M', tipo: 'texto', largura: 6 },
          { titulo: 'T', tipo: 'texto', largura: 6 },
          { titulo: 'Leitura', tipo: 'texto', largura: 9 },
          { titulo: 'Ocorrência', tipo: 'texto', largura: 12 },
          { titulo: 'Horários', tipo: 'texto', largura: 30 },
        ],
        linhas: linhasDados,
      },
      {
        nome: 'Grade mensal',
        colunas: [
          { titulo: 'Funcionária', tipo: 'texto', largura: 28 },
          { titulo: 'Cargo', tipo: 'texto', largura: 18 },
          ...dias.map((d) => ({ titulo: `${d.slice(8, 10)} ${rotuloDiaSemana(d)}`, tipo: 'texto', largura: 8 })),
        ],
        linhas: grade,
      },
      planilhaIdentificacao(base),
    ],
  };
}

// ------------------------------------------------------------
// COBERTURA
//
// Semântica (publicada): a cobertura é calculada sobre a EQUIPE do recorte
// de cargo (todos os cargos, ou o cargo filtrado). O filtro de
// FUNCIONÁRIA só restringe as linhas individuais exibidas/exportadas -- a
// quantidade por faixa continua sendo a da equipe, nunca "1" porque uma
// pessoa foi filtrada. Por isso este modelo recebe as duas listas:
//   funcionariosBase  -> entram no cálculo (resolverCoberturaPeriodo);
//   funcionarios      -> linhas exibidas (cargo + funcionária).
// ------------------------------------------------------------
export function montarExportacaoCobertura({ dias, funcionarios, funcionariosBase, mapaEscala, filtroDescricao, geradoEm }) {
  const base = cabecalhoBase({
    tipo: 'cobertura',
    rotuloTipo: 'Cobertura',
    periodoRotulo: formatarPeriodoSemana(dias),
    filtroDescricao,
    geradoEm,
    nomeArquivo: `escala-cobertura_${intervaloArquivo(dias)}`,
  });

  const { faixasPorDia } = resolverCoberturaPeriodo({ funcionarios: funcionariosBase, mapaEscala, dias });
  const recorte = filtroDescricao?.cargo ? `cargo ${filtroDescricao.cargo}` : 'todos os cargos';
  const funcionarioFiltrado = filtroDescricao?.funcionario ? funcionarios[0] || null : null;
  const idsExibidos = new Set(funcionarios.map((f) => f.id));
  const cargoPorId = new Map(funcionariosBase.map((f) => [f.id, nomeCargo(f)]));

  const notaCobertura = filtroDescricao?.funcionario
    ? `Cobertura = pessoas presentes (sem falta/atestado) durante toda a faixa, calculada sobre a equipe (${recorte}). O filtro de funcionária NÃO altera este total -- a coluna "${filtroDescricao.funcionario}" indica se ela está presente na faixa.`
    : `Cobertura = pessoas presentes (sem falta/atestado) durante toda a faixa, calculada sobre a equipe (${recorte}).`;

  const cabecalhoFaixas = ['Data', 'Início', 'Fim', 'Cobertura', 'Previstas', 'Presentes', 'Ausências'];
  if (filtroDescricao?.funcionario) cabecalhoFaixas.push(filtroDescricao.funcionario);

  const linhasFaixasPdf = [];
  const linhasFaixasXlsx = [];
  const linhasPresencas = [];

  for (const data of dias) {
    const faixas = faixasPorDia.get(data) || [];
    const rotuloData = rotuloColunaDia(data);
    if (faixas.length === 0) {
      const linha = [rotuloData, { texto: 'Sem períodos de trabalho escalados neste dia.', tom: 'vazio', colSpan: cabecalhoFaixas.length - 1 }];
      linhasFaixasPdf.push(linha);
      continue;
    }
    for (const f of faixas) {
      // Mesmo formato curto (primeiro nome + desambiguação) dos presentes.
      const nomesAusentes = nomesComDesambiguacao(f.ausentes);
      const ausencias = f.ausentes.map((a, i) => `${nomesAusentes[i]}${a.ocorrenciaTipo ? ` (${ROTULO_OCORRENCIA[a.ocorrenciaTipo] || a.ocorrenciaTipo})` : ''}`);
      const presenteFiltrada = funcionarioFiltrado ? f.efetivos.some((p) => p.funcionario_id === funcionarioFiltrado.id) : null;
      const ausenteFiltrada = funcionarioFiltrado ? f.ausentes.find((a) => a.funcionario_id === funcionarioFiltrado.id) : null;

      const linhaPdf = [
        rotuloData,
        f.inicio,
        f.fim,
        { texto: String(f.efetivos.length), tom: f.efetivos.length === 0 ? 'falta' : 'numero' },
        String(f.previstos.length),
        nomesComDesambiguacao(f.efetivos).join(', ') || '—',
        ausencias.join(', ') || '—',
      ];
      if (filtroDescricao?.funcionario) {
        linhaPdf.push(
          presenteFiltrada
            ? 'Presente'
            : ausenteFiltrada
              ? { texto: ROTULO_OCORRENCIA[ausenteFiltrada.ocorrenciaTipo] || 'Ausente', tom: ausenteFiltrada.ocorrenciaTipo || 'falta' }
              : '—'
        );
      }
      linhasFaixasPdf.push(linhaPdf);

      const linhaXlsx = [data, rotuloDiaSemana(data), f.inicio, f.fim, f.efetivos.length, f.previstos.length, f.ausentes.length, base.filtros.cargo || 'Todos os cargos'];
      if (filtroDescricao?.funcionario) linhaXlsx.push(funcionarioFiltrado ? (presenteFiltrada ? 'Sim' : 'Não') : 'Não');
      linhasFaixasXlsx.push(linhaXlsx);

      // Presenças: 1 linha por pessoa EXIBIDA (filtro) prevista na faixa.
      for (const p of f.previstos) {
        if (!idsExibidos.has(p.funcionario_id)) continue;
        const ausente = f.ausentes.find((a) => a.funcionario_id === p.funcionario_id);
        linhasPresencas.push([
          data,
          rotuloDiaSemana(data),
          f.inicio,
          f.fim,
          p.nome,
          cargoPorId.get(p.funcionario_id) || '',
          ausente ? ROTULO_OCORRENCIA[ausente.ocorrenciaTipo] || 'Ausente' : 'Presente',
          f.efetivos.length,
        ]);
      }
    }
  }

  const colunasFaixas = [
    { titulo: 'Data', tipo: 'data', largura: 12 },
    { titulo: 'Dia', tipo: 'texto', largura: 7 },
    { titulo: 'Início', tipo: 'hora', largura: 9 },
    { titulo: 'Fim', tipo: 'hora', largura: 9 },
    { titulo: 'Cobertura (presentes)', tipo: 'numero', largura: 12 },
    { titulo: 'Previstas', tipo: 'numero', largura: 10 },
    { titulo: 'Ausentes', tipo: 'numero', largura: 10 },
    { titulo: 'Base do cálculo', tipo: 'texto', largura: 20 },
  ];
  if (filtroDescricao?.funcionario) colunasFaixas.push({ titulo: `${filtroDescricao.funcionario} presente`, tipo: 'texto', largura: 22 });

  const larguras = { 0: 22, 1: 13, 2: 13, 3: 18, 4: 18 };

  return {
    ...base,
    pdf: {
      secoes: [
        secaoGradeSemanal({ funcionarios, dias, mapaEscala, titulo: 'Horários no período' }),
        {
          titulo: 'Cobertura por faixa horária',
          nota: notaCobertura,
          cabecalho: cabecalhoFaixas,
          larguras,
          centralizarColunas: [1, 2, 3, 4],
          linhas: linhasFaixasPdf,
          vazio: 'Sem períodos de trabalho escalados no período.',
        },
      ],
      legenda: 'Faixas = intervalos entre horários reais de entrada/saída em que o conjunto de pessoas não muda. Previstas inclui quem tem falta/atestado; Cobertura conta só quem está presente.',
    },
    planilhas: [
      { nome: 'Cobertura por faixa', colunas: colunasFaixas, linhas: linhasFaixasXlsx },
      {
        nome: 'Presenças por faixa',
        colunas: [
          { titulo: 'Data', tipo: 'data', largura: 12 },
          { titulo: 'Dia', tipo: 'texto', largura: 7 },
          { titulo: 'Início', tipo: 'hora', largura: 9 },
          { titulo: 'Fim', tipo: 'hora', largura: 9 },
          { titulo: 'Funcionária', tipo: 'texto', largura: 28 },
          { titulo: 'Cargo', tipo: 'texto', largura: 18 },
          { titulo: 'Situação', tipo: 'texto', largura: 12 },
          { titulo: 'Cobertura da faixa', tipo: 'numero', largura: 12 },
        ],
        linhas: linhasPresencas,
      },
      { nome: 'Escala no período', colunas: COLUNAS_ESCALA_LONGA, linhas: linhasEscalaLonga({ funcionarios, dias, mapaEscala }) },
      { ...planilhaIdentificacao(base), linhas: [...planilhaIdentificacao(base).linhas, ['Base da cobertura', `Equipe (${recorte}) -- não restrita pelo filtro de funcionária`]] },
    ],
  };
}
