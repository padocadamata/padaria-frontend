import { formatarHora, formatarPeriodo, obterEstadoDia, rotuloDiaSemana, formatarDataCurta, formatarPeriodoSemana, diaDaSemanaIndice } from './escala.js';
import { classificarCelulaMensal } from './escalaFaixas.js';
import { resolverCoberturaPeriodo, nomesComDesambiguacao } from './escalaCobertura.js';
import { funcionariasDosGrupos, rotuloQuantidadeFuncionarias } from './escalaGrupos.js';
import { MARCA_FERIADO, legendaFeriados, feriadosDoPeriodo } from './escalaFeriados.js';
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
// `grupos` = os MESMOS grupos por cargo da tela (agruparPorCargo sobre a
// população JÁ FILTRADA por Cargo/Funcionária, com a ordenação escolhida
// aplicada dentro de cada grupo) -- o arquivo representa exatamente o que
// está na tela: sem filtro, a equipe toda cargo a cargo; com filtro, só o
// cargo/a funcionária selecionada (arquivo individual). No PDF o início de
// cada cargo é marcado na própria tabela; no Excel as linhas seguem a mesma
// ordem e a coluna Cargo identifica o grupo.
//
// `filtroDescricao` (descreverFiltroEscala): identifica no arquivo SÓ os
// filtros ativos ("Cargo: …", "Funcionária: …"); em "Todos" nada aparece.
// `feriados` (Map data -> nome, escalaFeriados.js): F* junto à data e o
// nome por extenso (legenda do PDF, coluna "Feriado" no Excel) -- só
// informação, nunca muda nenhum valor da escala.

const ROTULO_OCORRENCIA = { falta: 'Falta', atestado: 'Atestado' };
const ROTULO_NATUREZA = { extra_remunerado: 'Extra remunerado' };
const ROTULO_TODOS_OS_CARGOS = 'Todos os cargos';
const SEM_FERIADOS = new Map();

function marcaFeriado(feriados, data) {
  return feriados.has(data) ? ` ${MARCA_FERIADO}` : '';
}

function juntarLegenda(base, feriados, dias) {
  const extra = legendaFeriados(feriados, dias);
  return extra ? `${base} · ${extra}` : base;
}

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
    // null = critério não aplicado ("Todos") -- não aparece no arquivo.
    filtros: { cargo: filtroDescricao?.cargo || null, funcionario: filtroDescricao?.funcionario || null },
    geradoEm: geradoEm || formatarGeradoEm(),
    nomeArquivo,
  };
}

// Sufixo do nome do arquivo com a funcionária filtrada (arquivo
// individual para enviar a ela): "escala-mensal_2026-10_maria-silva".
function sufixoArquivo(filtroDescricao) {
  const nome = filtroDescricao?.funcionario;
  if (!nome) return '';
  const slug = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `_${slug}` : '';
}

// Aba "Relatório" do Excel -- identifica o relatório dentro do próprio
// arquivo (o PDF faz isso no cabeçalho de cada página).
function planilhaIdentificacao(base, { feriados = SEM_FERIADOS, dias = [] } = {}) {
  const linhas = [
    ['Empresa', 'Padoca da Mata'],
    ['Relatório', base.titulo],
    ['Período', base.periodoRotulo],
  ];
  if (base.filtros.cargo) linhas.push(['Cargo', base.filtros.cargo]);
  if (base.filtros.funcionario) linhas.push(['Funcionária', base.filtros.funcionario]);
  linhas.push(['Organização', base.filtros.cargo || base.filtros.funcionario ? 'Agrupada por cargo (filtro aplicado)' : 'Equipe completa, agrupada por cargo']);
  const doPeriodo = feriadosDoPeriodo(feriados, dias);
  if (doPeriodo.length > 0) linhas.push(['Feriados no período', doPeriodo.map((f) => `${formatarDataCurta(f.data)} ${f.nome}`).join('; ')]);
  linhas.push(['Gerado em', base.geradoEm]);
  return {
    nome: 'Relatório',
    semFiltro: true,
    colunas: [
      { titulo: 'Campo', tipo: 'texto', largura: 18 },
      { titulo: 'Valor', tipo: 'texto', largura: 48 },
    ],
    linhas,
  };
}

function rotuloColunaDia(data, feriados = SEM_FERIADOS) {
  return `${rotuloDiaSemana(data)} ${formatarDataCurta(data)}${marcaFeriado(feriados, data)}`;
}

// Mesma leitura do título da tela: "Atendente · 3 funcionárias".
export function rotuloGrupoArquivo(grupo) {
  return `${grupo.nome} · ${rotuloQuantidadeFuncionarias(grupo.funcionarios.length)}`;
}

// Linhas das funcionárias, grupo a grupo, + onde cada cargo começa
// (`inicioGrupos`: índice da 1ª linha do grupo e rótulo). O PDF marca esse
// início SEM linha extra: borda superior mais forte e o rótulo do cargo em
// letra pequena acima do nome da 1ª funcionária -- uma linha de título a
// mais por cargo tiraria o Mensal da página única (os dois blocos de dias
// já ocupam a página quase inteira no pior caso).
function linhasAgrupadas(grupos, linhaFuncionaria) {
  const linhas = [];
  const inicioGrupos = [];
  for (const grupo of grupos) {
    if (grupo.funcionarios.length === 0) continue;
    inicioGrupos.push({ indice: linhas.length, rotulo: rotuloGrupoArquivo(grupo) });
    for (const f of grupo.funcionarios) linhas.push(linhaFuncionaria(f));
  }
  return { linhas, inicioGrupos };
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
  { titulo: 'Feriado', tipo: 'texto', largura: 24 },
];

function linhasEscalaLonga({ funcionarios, dias, mapaEscala, feriados = SEM_FERIADOS }) {
  const linhas = [];
  for (const f of funcionarios) {
    for (const data of dias) {
      const estado = obterEstadoDia(mapaEscala, f.id, data);
      const base = [f.nome, nomeCargo(f), rotuloVinculo(f.tipo_vinculo), data, rotuloDiaSemana(data)];
      const feriado = feriados.get(data) || '';
      if (!estado) {
        linhas.push([...base, 'Não definido', '', null, null, null, '', feriado]);
      } else if (estado.tipo === 'folga') {
        linhas.push([...base, 'Folga', '', null, null, null, '', feriado]);
      } else if (estado.periodos.length === 0) {
        linhas.push([...base, 'Trabalho', rotuloOcorrencia(estado.ocorrencia), null, null, null, '', feriado]);
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
            feriado,
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

function secaoGradeSemanal({ grupos, dias, mapaEscala, titulo, feriados = SEM_FERIADOS }) {
  const cabecalho = ['Funcionária', 'Cargo', ...dias.map((d) => rotuloColunaDia(d, feriados))];
  return {
    titulo,
    cabecalho,
    colunasFimDeSemana: dias.map((d, i) => (ehFimDeSemana(d) ? i + 2 : null)).filter((i) => i !== null),
    larguras: { 0: 40, 1: 26 },
    colunasTexto: 2,
    ...linhasAgrupadas(grupos, (f) => [f.nome, nomeCargo(f), ...dias.map((data) => celulaSemanalPdf(obterEstadoDia(mapaEscala, f.id, data)))]),
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
export function montarExportacaoSemanal({ dias, grupos, mapaEscala, filtroDescricao, feriados = SEM_FERIADOS, geradoEm }) {
  const base = cabecalhoBase({
    tipo: 'semanal',
    rotuloTipo: 'Semanal',
    periodoRotulo: formatarPeriodoSemana(dias),
    filtroDescricao,
    geradoEm,
    nomeArquivo: `escala-semanal_${intervaloArquivo(dias)}${sufixoArquivo(filtroDescricao)}`,
  });

  return {
    ...base,
    pdf: {
      secoes: [secaoGradeSemanal({ grupos, dias, mapaEscala, feriados })],
      legenda: juntarLegenda('— = não definido · Folga = folga programada · FALTA/ATESTADO = ocorrência registrada sobre o horário previsto · extra = período extra remunerado.', feriados, dias),
    },
    planilhas: [
      { nome: 'Escala semanal', colunas: COLUNAS_ESCALA_LONGA, linhas: linhasEscalaLonga({ funcionarios: funcionariasDosGrupos(grupos), dias, mapaEscala, feriados }) },
      planilhaIdentificacao(base, { feriados, dias }),
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

// Leitura da célula no PDF Mensal: igual à da planilha, exceto manhã+tarde,
// que no PDF fica EMPILHADA ("M" em cima, "T" embaixo, como na grade da
// tela) -- nunca "M+T" numa linha. Só apresentação: mesma regra M/T
// (classificarCelulaMensal); a planilha continua com "M+T" (texto filtrável).
export function leituraMensalPdf(info) {
  if (info.tipo === 'trabalho' && info.manha && info.tarde) return 'M\nT';
  return leituraMensal(info);
}

export function celulaMensalPdf(estado) {
  const info = classificarCelulaMensal(estado);
  if (info.tipo === 'nao_definido') return { texto: '—', tom: 'vazio' };
  if (info.tipo === 'folga') return { texto: 'Folga', tom: 'folga' };
  const leitura = leituraMensalPdf(info) || info.periodos.map(formatarPeriodo).join('\n');
  if (info.ocorrencia) {
    const celula = { texto: `${leitura}\n${rotuloOcorrencia(info.ocorrencia)}`, tom: info.ocorrencia.tipo };
    // "M / T / Falta" (3 linhas): letra menor só nesta célula, para caber
    // na mesma altura de uma linha comum -- o Mensal continua em 1 página.
    if (leitura === 'M\nT') celula.compactar = true;
    return celula;
  }
  return { texto: leitura, tom: 'trabalho' };
}

// Divide os dias do mês em blocos legíveis (A4 paisagem): 1–16 e 17–fim,
// em vez de espremer 31 colunas numa página só.
export function blocosDeDiasMensal(dias, tamanho = 16) {
  const blocos = [];
  for (let i = 0; i < dias.length; i += tamanho) blocos.push(dias.slice(i, i + tamanho));
  return blocos;
}

export function montarExportacaoMensal({ dias, grupos, mapaEscala, filtroDescricao, feriados = SEM_FERIADOS, geradoEm }) {
  const mes = dias[0].slice(0, 7);
  const base = cabecalhoBase({
    tipo: 'mensal',
    rotuloTipo: 'Mensal',
    periodoRotulo: mesExibicao(dias[0]),
    filtroDescricao,
    geradoEm,
    nomeArquivo: `escala-mensal_${mes}${sufixoArquivo(filtroDescricao)}`,
  });
  const funcionarios = funcionariasDosGrupos(grupos);

  const secoes = blocosDeDiasMensal(dias).map((bloco, _i, todos) => ({
    titulo: todos.length > 1 ? `Dias ${formatarDataCurta(bloco[0])} a ${formatarDataCurta(bloco[bloco.length - 1])}` : null,
    // Os dois blocos na MESMA página A4 (superior 01–16, inferior 17–fim);
    // só pagina se a quantidade de linhas realmente não couber.
    compacto: true,
    cabecalho: ['Funcionária', ...bloco.map((d) => `${rotuloDiaSemana(d)}\n${d.slice(8, 10)}${marcaFeriado(feriados, d)}`)],
    colunasFimDeSemana: bloco.map((d, j) => (ehFimDeSemana(d) ? j + 1 : null)).filter((j) => j !== null),
    // Dias com largura IGUAL (grade regular, independente do conteúdo):
    // 277 mm úteis do A4 paisagem - 45 mm da coluna de nomes.
    larguras: Object.fromEntries([[0, 45], ...bloco.map((_, j) => [j + 1, 232 / bloco.length])]),
    colunasTexto: 1,
    ...linhasAgrupadas(grupos, (f) => [f.nome, ...bloco.map((data) => celulaMensalPdf(obterEstadoDia(mapaEscala, f.id, data)))]),
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
        feriados.get(data) || '',
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
      legenda: juntarLegenda('M = ocupa 06:00–12:00 · T = ocupa 12:00–19:30 · M e T empilhados = ambas · — = não definido · Falta/Atestado = ocorrência registrada sobre o horário previsto.', feriados, dias),
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
          { titulo: 'Feriado', tipo: 'texto', largura: 24 },
        ],
        linhas: linhasDados,
      },
      {
        nome: 'Grade mensal',
        colunas: [
          { titulo: 'Funcionária', tipo: 'texto', largura: 28 },
          { titulo: 'Cargo', tipo: 'texto', largura: 18 },
          ...dias.map((d) => ({ titulo: `${d.slice(8, 10)} ${rotuloDiaSemana(d)}${marcaFeriado(feriados, d)}`, tipo: 'texto', largura: 8 })),
        ],
        linhas: grade,
      },
      planilhaIdentificacao(base, { feriados, dias }),
    ],
  };
}

// ------------------------------------------------------------
// COBERTURA
//
// Mesma organização da tela: cobertura GERAL e, havendo mais de um cargo
// na base, a cobertura de cada cargo exibido. Todas vêm do mesmo motor
// (resolverCoberturaPeriodo), só com bases diferentes.
//
// Semântica dos filtros (a publicada antes desta frente): a BASE do cálculo
// é a equipe do recorte de CARGO (gruposBase = agruparPorCargo(
// funcionariosDoCargo(...))); o filtro de FUNCIONÁRIA só restringe as
// linhas individuais (grupos exibidos) -- a cobertura nunca "vira 1"
// porque uma pessoa foi filtrada.
// ------------------------------------------------------------

// Bases de cálculo da Cobertura (tela e arquivo): a geral (equipe da base)
// sempre; uma por cargo só quando a base tem mais de um cargo (com um só,
// seria a geral repetida) e só para os cargos EXIBIDOS. Com um único cargo
// na base (ex.: filtro de cargo), a geral leva o nome desse cargo.
export function basesDeCobertura(gruposBase, gruposExibidos = gruposBase) {
  const todas = funcionariasDosGrupos(gruposBase);
  const geral = { chave: 'geral', rotulo: gruposBase.length === 1 ? gruposBase[0].nome : ROTULO_TODOS_OS_CARGOS, funcionarios: todas };
  if (gruposBase.length <= 1) return [geral];
  const exibidos = new Set(gruposExibidos.map((g) => g.chave));
  return [geral, ...gruposBase.filter((g) => exibidos.has(g.chave)).map((g) => ({ chave: g.chave, rotulo: g.nome, funcionarios: g.funcionarios }))];
}

const NOTA_COBERTURA = 'Cobertura = pessoas presentes (sem falta/atestado) durante toda a faixa.';

export function montarExportacaoCobertura({ dias, grupos, gruposBase = grupos, mapaEscala, filtroDescricao, feriados = SEM_FERIADOS, geradoEm }) {
  const base = cabecalhoBase({
    tipo: 'cobertura',
    rotuloTipo: 'Cobertura',
    periodoRotulo: formatarPeriodoSemana(dias),
    filtroDescricao,
    geradoEm,
    nomeArquivo: `escala-cobertura_${intervaloArquivo(dias)}${sufixoArquivo(filtroDescricao)}`,
  });

  const funcionarios = funcionariasDosGrupos(grupos);
  const idsExibidos = new Set(funcionarios.map((f) => f.id));
  const cargoPorId = new Map(funcionariasDosGrupos(gruposBase).map((f) => [f.id, nomeCargo(f)]));
  const bases = basesDeCobertura(gruposBase, grupos);
  const notaFiltroFuncionaria = filtroDescricao?.funcionario ? ' O filtro de funcionária NÃO altera este total.' : '';
  const cabecalhoFaixas = ['Data', 'Início', 'Fim', 'Cobertura', 'Previstas', 'Presentes', 'Ausências'];
  const larguras = { 0: 22, 1: 13, 2: 13, 3: 18, 4: 18 };

  const secoesFaixas = [];
  const linhasFaixasXlsx = [];
  const linhasPresencas = [];

  for (const baseCalculo of bases) {
    const { faixasPorDia } = resolverCoberturaPeriodo({ funcionarios: baseCalculo.funcionarios, mapaEscala, dias });
    const ehGeral = baseCalculo.chave === 'geral';
    const linhasPdf = [];

    for (const data of dias) {
      const faixas = faixasPorDia.get(data) || [];
      const rotuloData = rotuloColunaDia(data, feriados);
      if (faixas.length === 0) {
        linhasPdf.push([rotuloData, { texto: 'Sem períodos de trabalho escalados neste dia.', tom: 'vazio', colSpan: cabecalhoFaixas.length - 1 }]);
        continue;
      }
      for (const f of faixas) {
        // Mesmo formato curto (primeiro nome + desambiguação) dos presentes.
        const nomesAusentes = nomesComDesambiguacao(f.ausentes);
        const ausencias = f.ausentes.map((a, i) => `${nomesAusentes[i]}${a.ocorrenciaTipo ? ` (${ROTULO_OCORRENCIA[a.ocorrenciaTipo] || a.ocorrenciaTipo})` : ''}`);
        linhasPdf.push([
          rotuloData,
          f.inicio,
          f.fim,
          { texto: String(f.efetivos.length), tom: f.efetivos.length === 0 ? 'falta' : 'numero' },
          String(f.previstos.length),
          nomesComDesambiguacao(f.efetivos).join(', ') || '—',
          ausencias.join(', ') || '—',
        ]);

        linhasFaixasXlsx.push([data, rotuloDiaSemana(data), f.inicio, f.fim, f.efetivos.length, f.previstos.length, f.ausentes.length, baseCalculo.rotulo, feriados.get(data) || '']);

        // Presenças: 1 linha por pessoa EXIBIDA (filtro) prevista na faixa
        // -- só a partir da base GERAL (cada pessoa uma vez, com o cargo).
        if (!ehGeral) continue;
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
            feriados.get(data) || '',
          ]);
        }
      }
    }

    secoesFaixas.push({
      titulo: bases.length > 1 ? `Cobertura por faixa horária · ${baseCalculo.rotulo}` : 'Cobertura por faixa horária',
      nota: ehGeral && gruposBase.length !== 1
        ? `${NOTA_COBERTURA} Calculada sobre a equipe toda.${notaFiltroFuncionaria}`
        : `${NOTA_COBERTURA} Calculada só sobre o cargo ${baseCalculo.rotulo}.${notaFiltroFuncionaria}`,
      cabecalho: cabecalhoFaixas,
      larguras,
      centralizarColunas: [1, 2, 3, 4],
      linhas: linhasPdf,
      vazio: 'Sem períodos de trabalho escalados no período.',
    });
  }

  const colunasFaixas = [
    { titulo: 'Data', tipo: 'data', largura: 12 },
    { titulo: 'Dia', tipo: 'texto', largura: 7 },
    { titulo: 'Início', tipo: 'hora', largura: 9 },
    { titulo: 'Fim', tipo: 'hora', largura: 9 },
    { titulo: 'Cobertura (presentes)', tipo: 'numero', largura: 12 },
    { titulo: 'Previstas', tipo: 'numero', largura: 10 },
    { titulo: 'Ausentes', tipo: 'numero', largura: 10 },
    { titulo: 'Base do cálculo', tipo: 'texto', largura: 22 },
    { titulo: 'Feriado', tipo: 'texto', largura: 24 },
  ];

  return {
    ...base,
    pdf: {
      secoes: [secaoGradeSemanal({ grupos, dias, mapaEscala, titulo: 'Horários no período', feriados }), ...secoesFaixas],
      legenda: juntarLegenda('Faixas = intervalos entre horários reais de entrada/saída em que o conjunto de pessoas não muda. Previstas inclui quem tem falta/atestado; Cobertura conta só quem está presente.', feriados, dias),
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
          { titulo: 'Feriado', tipo: 'texto', largura: 24 },
        ],
        linhas: linhasPresencas,
      },
      { nome: 'Escala no período', colunas: COLUNAS_ESCALA_LONGA, linhas: linhasEscalaLonga({ funcionarios, dias, mapaEscala, feriados }) },
      (() => {
        const identificacao = planilhaIdentificacao(base, { feriados, dias });
        const descricaoBase = bases.length > 1 ? 'Equipe toda (geral) e cada cargo exibido separadamente' : gruposBase.length === 1 ? `Cargo ${bases[0].rotulo}` : 'Equipe toda';
        const nota = filtroDescricao?.funcionario ? ' -- não restrita pelo filtro de funcionária' : '';
        return { ...identificacao, linhas: [...identificacao.linhas, ['Base da cobertura', `${descricaoBase}${nota}`]] };
      })(),
    ],
  };
}
