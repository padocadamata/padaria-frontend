// BI Gerencial -- exportação geral (Excel/PDF), acesso rápido e extensões
// aditivas dos geradores de relatório.
//   node --test lib/bi/__tests__/exportacaoGeral.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

import {
  capturarInstantaneo, coletarDadosExportacao, montarExportacaoGeral, textoPdf, BLOCOS_EXPORTACAO, PAGINA_EXPORTACAO,
} from '../exportacaoGeral.js';
import { gerarXlsx } from '../../exportacao/xlsx.js';
import { gerarPdfRelatorio } from '../../exportacao/pdf.js';
import { corParaRgb, escalaEixo } from '../../exportacao/graficosPdf.js';
import { situacaoVariacaoCartao, linhaComparativoGeral, INDICADORES_COMPARATIVO } from '../modelos.js';

// ---------------------------------------------------------------------------
// Fixtures (formas reais das RPCs, valores fictícios)
// ---------------------------------------------------------------------------
const F = { de: '2026-11-18', ate: '2026-11-24', dias: [0, 1, 2, 3, 4, 5, 6], agrupamento: 'dia', referencia: 'anterior', atalho: '7', proprios: [] };
const REF = { de: '2026-11-11', ate: '2026-11-17' };

const RESUMO = {
  motivo: null,
  avisos: [],
  dias: { completo: 6, sem_importacao: 1 },
  base_media: { bruto: 23192.35, liquido: 23054.95, vendas: 1268, ticket: 18.18, descontos: 137.4, media_diaria_bruto: 3865.39, media_diaria_vendas: 211.33, media_diaria_descontos: 22.9, percentual_descontos: 0.0059, dias_validos: 6 },
  registrado: { bruto: 23192.35, liquido: 23054.95, vendas: 1268, ticket: 18.18, descontos: 137.4, percentual_descontos: 0.0059 },
};
const geralComp = (comparavel = true) => ({
  comparavel,
  motivo: comparavel ? null : 'cobertura_insuficiente',
  base_zero: false,
  a: { bruto: 23192.35, liquido: 23054.95, vendas: 1268, descontos: 137.4, media_diaria_bruto: 3865.39, media_diaria_vendas: 211.3, ticket: 18.18, media_diaria_descontos: 22.9, percentual_descontos: 0.0059, cobertura: 0.86 },
  b: { bruto: 25172.87, liquido: 25025.91, vendas: 1361, descontos: 146.96, media_diaria_bruto: 4195.48, media_diaria_vendas: 226.8, ticket: 18.39, media_diaria_descontos: 24.49, percentual_descontos: 0.0058, cobertura: 0.86 },
  diferencas: comparavel ? { bruto: -1980.52, liquido: -1970.96, vendas: -93, descontos: -9.56, media_diaria_bruto: -330.09, media_diaria_vendas: -15.5, ticket: -0.21, media_diaria_descontos: -1.59, percentual_descontos: 0.0001 } : null,
  variacoes: comparavel ? { bruto: -0.0787, liquido: -0.0788, vendas: -0.0683, descontos: -0.0651, media_diaria_bruto: -0.0787, media_diaria_vendas: -0.0683, ticket: -0.0114, media_diaria_descontos: -0.0651, percentual_descontos: 0.015 } : null,
});
const COMPARAR = (comparavel = true, criterio = 'pareado') => ({
  criterio,
  periodos: { a: { de: F.de, ate: F.ate, dias_filtrados: 7 }, b: { ...REF, dias_filtrados: 7 } },
  pareamento: { pares: 7, pares_validos_vendas: 6, mesmo_dia_semana: true },
  cobertura_minima: 0.8,
  geral: geralComp(comparavel),
  avisos: [],
  produtos: [
    { codigo: '900', descricao: 'PAO FRANCES', comparavel: true, a: { media_diaria_bruto: 1046.04, preco_medio: 18.9, participacao: 0.2718 }, b: { media_diaria_bruto: 1261.57, preco_medio: 18.9, participacao: 0.3036 }, diferencas: { media_diaria_bruto: -215.53 }, variacoes: { media_diaria_bruto: -0.1708 } },
  ],
});
const serieDia = (inicio, classe, bruto) => ({
  inicio, fim: inicio, rotulo: inicio.split('-').reverse().join('/'), classe, hora_limite: null,
  media_diaria_bruto: classe === 'completo' ? bruto : null, media_diaria_liquido: classe === 'completo' ? bruto - 10 : null, media_diaria_vendas: classe === 'completo' ? 200 : null,
  ticket_media: classe === 'completo' ? 18.5 : null, media_diaria_descontos: classe === 'completo' ? 20 : null,
  bruto: classe === 'sem_importacao' ? null : bruto, liquido: classe === 'sem_importacao' ? null : bruto - 10, vendas: classe === 'sem_importacao' ? null : 200, descontos: classe === 'sem_importacao' ? null : 20,
  dias_validos: classe === 'completo' ? 1 : 0, dias_calendario: 1,
});
const SERIE_A = [serieDia('2026-11-18', 'completo', 3548.26), serieDia('2026-11-19', 'sem_importacao', null), serieDia('2026-11-20', 'completo', 3949.27)];
const SERIE_B = [serieDia('2026-11-11', 'completo', 3937.76), serieDia('2026-11-12', 'completo', 3450.19), serieDia('2026-11-13', 'completo', 3784.29)];
const HORARIOS = [
  { dia_semana: null, hora: 7, vendas: 30, bruto: 600, liquido: 590, dias_considerados: 6 },
  { dia_semana: null, hora: 8, vendas: 0, bruto: 0, liquido: 0, dias_considerados: 6 },
  { dia_semana: null, hora: 9, vendas: 4, bruto: 80, liquido: 78, dias_considerados: 6 },
  { dia_semana: 3, hora: 7, vendas: 5, bruto: 100, liquido: 98, dias_considerados: 1 },
  { dia_semana: 3, hora: 8, vendas: 0, bruto: 0, liquido: 0, dias_considerados: 1 },
];
const prod = (codigo, descricao, bruto, extra = {}) => ({ codigo, descricao, bruto, quantidade: 10, vendas: 8, preco_medio: 5, participacao: Math.round((bruto / 1000) * 10000) / 10000, ...extra });
const PRODUTOS = {
  motivo: null,
  avisos: [],
  cobertura: { dias_validos: 6, dias_com_dados: 6 },
  totais: { bruto_total_periodo: 1000, produtos_distintos: 7 },
  paginacao: { total_linhas: 7, deslocamento: 0, retornadas: 7, tem_mais: false },
  produtos: [prod('311', 'OVO', 300), prod('341', 'OVO', 200), prod('900', 'PAO', 150), prod('120', 'QUEIJO', 100), prod('410', 'CROISSANT', 90), prod('520', 'BOLO', 80), prod('610', 'COXINHA', 80)],
};
const PRODUTO_SERIE = [
  { codigo: '311', descricao: 'OVO', inicio: '2026-11-18', fim: '2026-11-18', quantidade: 3, vendas: 2, bruto: 30, dias_registrados: 1, dias_validos: 1, dias_calendario: 1, cobertura: 'completa', quantidade_media_dia: 3, vendas_media_dia: 2, bruto_media_dia: 30 },
  { codigo: '311', descricao: 'OVO', inicio: '2026-11-19', fim: '2026-11-19', quantidade: null, vendas: null, bruto: null, dias_registrados: 0, dias_validos: 0, dias_calendario: 1, cobertura: 'sem_dados', quantidade_media_dia: null, vendas_media_dia: null, bruto_media_dia: null },
];
const PROD_HORARIOS = [
  { codigo: '311', descricao: 'OVO', dia_semana: null, hora: 7, vendas: 3, bruto: 3, participacao_no_produto: 0.75, media_bruto_dia: 0.5, participacao_no_horario: 0.01, dias_considerados: 6 },
  { codigo: '311', descricao: 'OVO', dia_semana: null, hora: null, vendas: 4, bruto: 4, participacao_no_produto: 1, dias_considerados: 6 },
];
const CALENDARIO = [
  { dia: '2026-11-18', classe_vendas: 'completo', classe_itens: 'completo', entra_media_vendas: true, entra_media_itens: true, vendas_registradas: 186, bruto_registrado: 3548.26, vendas_nao_conciliadas: 1 },
  { dia: '2026-11-19', classe_vendas: 'sem_importacao', classe_itens: 'sem_importacao', entra_media_vendas: false, entra_media_itens: false, vendas_registradas: 0, bruto_registrado: 0, vendas_nao_conciliadas: 0 },
];

function registroPadrao() {
  return {
    resumo: { filtros: { ...F }, ref: REF, parametros: { podeComparar: true, referencia: 'anterior' }, consultas: { resumo: { tipo: 'resumo', args: { de: F.de, ate: F.ate } }, comparar: { tipo: 'comparar', args: { a: F, b: REF } }, calendario: { tipo: 'calendario', args: { de: F.de, ate: F.ate } } } },
    evolucao: { filtros: { ...F }, ref: REF, parametros: { metrica: 'bruto' }, consultas: { a: { tipo: 'serie', args: { lado: 'a' } }, b: { tipo: 'serie', args: { lado: 'b' } } }, avisos: [] },
    semana: { filtros: { ...F }, ref: REF, parametros: {}, consultas: { a: { tipo: 'horarios', args: { lado: 'a' } }, b: { tipo: 'horarios', args: { lado: 'b' } } } },
    ranking: { filtros: { ...F }, parametros: { ordem: 'bruto', rankingTop: 5 }, consultas: { produtos: { tipo: 'produtos', args: { ranking: true } } } },
    participacao: { filtros: { ...F }, parametros: {}, consultas: { produtos: { tipo: 'produtos', args: { participacao: true } } } },
    evoprod: { filtros: { ...F }, parametros: { metrica: 'bruto', selecionados: ['311'] }, consultas: { serie: { tipo: 'produtoSerie', args: {} } } },
    tabela: { filtros: { ...F }, parametros: { busca: '', ordem: 'bruto', direcao: 'desc', ordemRotulo: 'Faturamento (decrescente)', porPagina: 20, pagina: 2 }, consultas: { todos: { tipo: 'produtos', args: { tabela: true }, paginado: true } } },
    curva: { filtros: { ...F }, ref: REF, parametros: { metrica: 'ticket' }, consultas: { a: { tipo: 'horarios', args: { lado: 'a' } }, b: { tipo: 'horarios', args: { lado: 'b' } } } },
    calor: { filtros: { ...F, dias: [1, 2, 3, 4, 5, 6] }, parametros: { indicador: 'ticket' }, consultas: { horarios: { tipo: 'horarios', args: { lado: 'a' } } } },
    prodhora: { filtros: { ...F }, ref: REF, parametros: { modo: 'escolhidos', compararB: true, unico: '311', selecionados: ['311'] }, consultas: { top: null, escolhidos: { tipo: 'produtoHorarios', args: {} }, referencia: { tipo: 'produtoHorarios', args: { b: true } } } },
    comparativo: { filtros: null, parametros: { modo: 'anterior', rotuloModo: 'Período anterior', periodos: { a: F, b: REF, dias: F.dias }, selecionados: ['900'] }, consultas: { comparar: { tipo: 'comparar', args: { comparativo: true } } } },
  };
}

// Cliente falso com a mesma interface do criarClienteBi (consultar).
function clienteFalso({ falhar = () => false, compararComparavel = true } = {}) {
  const chamadas = [];
  return {
    chamadas,
    consultar: async (tipo, args) => {
      chamadas.push([tipo, args]);
      if (falhar(tipo, args)) throw new Error('Não foi possível conectar ao servidor.');
      switch (tipo) {
        case 'resumo': return RESUMO;
        case 'comparar': return COMPARAR(compararComparavel);
        case 'calendario': return CALENDARIO;
        case 'serie': return args.lado === 'b' ? SERIE_B : SERIE_A;
        case 'horarios': return HORARIOS;
        case 'produtos':
          if (args.tabela) {
            // paginação real: 2 páginas
            const todos = Array.from({ length: PAGINA_EXPORTACAO + 3 }, (_, i) => prod(String(1000 + i), `ITEM ${i}`, 1));
            const pagina = todos.slice(args.deslocamento, args.deslocamento + args.limite);
            return { ...PRODUTOS, produtos: pagina, paginacao: { total_linhas: todos.length, deslocamento: args.deslocamento, retornadas: pagina.length, tem_mais: args.deslocamento + args.limite < todos.length } };
          }
          return PRODUTOS;
        case 'produtoSerie': return PRODUTO_SERIE;
        case 'produtoHorarios': return PROD_HORARIOS;
        default: return null;
      }
    },
  };
}

const instantaneo = (registro = registroPadrao()) =>
  capturarInstantaneo({
    registro,
    geral: { ...F, refDe: '', refAte: '' },
    status: { ultima_importacao_em: '2026-11-25T15:50:00+00:00', padrao_ate: '2026-11-24', hoje: '2026-11-25', relatorios: [{ layout: 'faturamento_geral', dia_parcial: '2026-11-25', hora_limite: '12:44' }] },
    selecionados: ['311', '900'],
    descricoes: { 311: 'OVO', 900: 'PAO' },
    cores: { 311: '#00897a', 900: '#c8622f' },
    geradoEm: '25/11/2026 16:00:00',
  });

// leitura mínima do .xlsx (zip sem compressão)
function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const arquivos = new Map();
  let pos = 0;
  while (dv.getUint32(pos, true) === 0x04034b50) {
    const tamanho = dv.getUint32(pos + 18, true);
    const nomeLen = dv.getUint16(pos + 26, true);
    const extraLen = dv.getUint16(pos + 28, true);
    const nome = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nomeLen));
    arquivos.set(nome, new TextDecoder().decode(bytes.subarray(pos + 30 + nomeLen + extraLen, pos + 30 + nomeLen + extraLen + tamanho)));
    pos += 30 + nomeLen + extraLen + tamanho;
  }
  return arquivos;
}

const planilha = (modelo, nome) => modelo.planilhas.find((p) => p.nome === nome);
const valor = (c) => (c && typeof c === 'object' && 'valor' in c ? c.valor : c);

// ---------------------------------------------------------------------------
test('instantâneo: cópia profunda — mudar o painel durante a geração não altera a exportação', () => {
  const registro = registroPadrao();
  const inst = instantaneo(registro);
  registro.ranking.parametros.rankingTop = 20;
  registro.evolucao.filtros.de = '2026-01-01';
  assert.equal(inst.registro.ranking.parametros.rankingTop, 5);
  assert.equal(inst.registro.evolucao.filtros.de, '2026-11-18');
});

test('coleta: usa as consultas registradas; tabela inteira (todas as páginas); erro isolado por consulta', async () => {
  const cli = clienteFalso({ falhar: (tipo, args) => tipo === 'serie' && args.lado === 'b' });
  const inst = instantaneo();
  const dados = await coletarDadosExportacao(cli, inst);
  assert.equal(dados.evolucao.b.estado, 'erro');
  assert.equal(dados.evolucao.a.estado, 'ok');
  assert.equal(dados.prodhora.top.estado, 'inativa');
  assert.equal(dados.tabela.todos.dados.produtos.length, PAGINA_EXPORTACAO + 3);
  assert.equal(cli.chamadas.filter(([t, a]) => t === 'produtos' && a.tabela).length, 2);
  // Referência com erro: exportação declarada INCOMPLETA (nunca silenciosa)
  const m = montarExportacaoGeral(inst, dados);
  assert.equal(m.completo, false);
  assert.equal(m.situacoes.find((s) => s.bloco === 'evolucao').estado, 'parcial');
  assert.ok(planilha(m, 'Filtros e Cobertura').notas.some((n) => /INCOMPLETA/.test(typeof n === 'string' ? n : n.texto)));
  assert.ok(planilha(m, 'Evolução do Faturamento').notas.some((n) => typeof n === 'object' && /SITUAÇÃO: PARCIAL/.test(n.texto)));
  assert.ok(m.pdf.secoes[0].texto.some((t) => t.tom === 'aviso' && /INCOMPLETA/.test(t.texto)));
  assert.ok(m.pdf.secoes.some((s) => /Situação dos blocos/.test(s.titulo || '')), 'quadro de situação no início quando incompleto');
});

test('montagem: 11 blocos, abas esperadas, valores iguais aos das RPCs (mesma base do painel)', async () => {
  const inst = instantaneo();
  const m = montarExportacaoGeral(inst, await coletarDadosExportacao(clienteFalso(), inst));
  assert.equal(m.completo, true);
  assert.equal(m.situacoes.length, BLOCOS_EXPORTACAO.length);
  assert.deepEqual(m.planilhas.map((p) => p.nome), [
    'Resumo Gerencial', 'Evolução do Faturamento', 'Média por Dia da Semana', 'Ranking de Produtos', 'Participação', 'Produtos', 'Evolução dos Produtos',
    'Vendas por Horário', 'Mapa de Calor', 'Produtos por Horário', 'Comparativos Gerais', 'Comparativos por Produto', 'Filtros e Cobertura', 'Calendário',
  ]);
  const resumo = planilha(m, 'Resumo Gerencial').linhas;
  const bruto = resumo.find((l) => l[0] === 'Faturamento bruto');
  assert.deepEqual([valor(bruto[1]), valor(bruto[3]), valor(bruto[4]), valor(bruto[5])], [23192.35, 25172.87, -1980.52, -0.0787]);
  assert.equal(bruto[1].tipo, 'decimal');
  assert.equal(resumo.find((l) => l[0] === 'Vendas')[1].tipo, 'numero');
  assert.equal(resumo.find((l) => l[0] === '% de desconto sobre o bruto')[1].tipo, 'percentual');
  // Tabela: todas as linhas, mesmas colunas da exportação individual (sem desconto)
  const p = planilha(m, 'Produtos');
  assert.equal(p.linhas.length, PAGINA_EXPORTACAO + 3);
  assert.ok(!p.colunas.some((c) => /desconto/i.test(c.titulo)));
  // Identificação dos filtros em cada aba de bloco
  for (const nome of ['Evolução do Faturamento', 'Ranking de Produtos', 'Mapa de Calor', 'Produtos']) {
    assert.ok(planilha(m, nome).notas.some((n) => /Filtros: Período 18\/11\/2026 a 24\/11\/2026/.test(typeof n === 'string' ? n : n.texto)), nome);
  }
  // Sem custo/lucro/margem em lugar nenhum
  assert.ok(!/custo|lucro|margem/i.test(JSON.stringify(m.planilhas.map((x) => [x.colunas, x.notas]))));
});

test('ausência nunca vira zero: lacuna da série, calendário sem importação, ticket sem vendas, parciais sem variação', async () => {
  const inst = instantaneo();
  const m = montarExportacaoGeral(inst, await coletarDadosExportacao(clienteFalso(), inst));
  const evo = planilha(m, 'Evolução do Faturamento');
  const lacuna = evo.linhas.find((l) => l[0] === 'A' && l[1] === '2026-11-19');
  assert.equal(lacuna[4], 'sem importação: lacuna, não é zero');
  assert.deepEqual(lacuna.slice(7, 16), [null, null, null, null, null, null, null, null, null]);
  assert.equal(lacuna[17], null); // diferença inexistente
  assert.equal(lacuna[18], null); // variação inexistente
  const cal = planilha(m, 'Calendário').linhas.find((l) => l[0] === '2026-11-19');
  assert.deepEqual(cal.slice(8, 11), [null, null, null]); // RPC devolve 0; aqui é ausência
  const calor = planilha(m, 'Mapa de Calor').linhas;
  const quaSemVenda = calor.find((l) => l[0] === 'Quarta' && l[1] === '8h');
  assert.equal(quaSemVenda[3], 0); // faturamento: zero real (dia completo sem vendas na hora)
  assert.equal(quaSemVenda[5], null); // ticket: não se aplica
  const dom = calor.find((l) => l[0] === 'Domingo');
  assert.equal(dom[3], null);
  assert.match(dom[6], /fora do filtro/);
  const evoprod = planilha(m, 'Evolução dos Produtos').linhas.find((l) => l[2] === '2026-11-19');
  assert.equal(evoprod[10], null);
  // Período só com dia parcial: registrado, sem variação, médias "sem dados"
  const inst2 = instantaneo();
  const dados2 = await coletarDadosExportacao(clienteFalso(), inst2);
  dados2.resumo.resumo = { estado: 'ok', dados: { ...RESUMO, base_media: { dias_validos: 0 }, registrado: { bruto: 900.5, liquido: 890, vendas: 50, ticket: 17.8, descontos: 10.5, percentual_descontos: 0.0117 } } };
  const m2 = montarExportacaoGeral(inst2, dados2);
  const r2 = planilha(m2, 'Resumo Gerencial').linhas;
  assert.equal(valor(r2.find((l) => l[0] === 'Faturamento bruto')[1]), 900.5);
  assert.equal(valor(r2.find((l) => l[0] === 'Faturamento bruto')[5]), null);
  assert.match(r2.find((l) => l[0] === 'Faturamento bruto')[6], /parcial/);
  assert.equal(valor(r2.find((l) => l[0] === 'Média diária (bruto)')[1]), null);
});

test('comparabilidade: sem comparação válida não há variação; totais fora do pareado não variam', async () => {
  const inst = instantaneo();
  const m = montarExportacaoGeral(inst, await coletarDadosExportacao(clienteFalso({ compararComparavel: false }), inst));
  const r = planilha(m, 'Resumo Gerencial').linhas;
  assert.ok(r.slice(0, 9).every((l) => valor(l[5]) === null));
  assert.match(r[0][6], /não comparável/);
  const g = planilha(m, 'Comparativos Gerais');
  assert.ok(g.linhas.every((l) => valor(l[4]) === null));
  assert.ok(g.notas.some((n) => /NÃO COMPARÁVEL/.test(typeof n === 'string' ? n : n.texto)));
  // critério média: totais sem variação (mesma regra da tela)
  const media = COMPARAR(true, 'media');
  assert.equal(situacaoVariacaoCartao(media, 'bruto', { total: true }).estado, 'so_medias');
  assert.equal(situacaoVariacaoCartao(media, 'media_diaria_bruto').estado, 'ok');
  const linhaBruto = linhaComparativoGeral(media, INDICADORES_COMPARATIVO[0]);
  assert.equal(linhaBruto.variacao, null);
  assert.match(linhaBruto.observacao, /durações diferentes/);
});

test('participação: proporções pelos valores originais e denominador fixo; códigos iguais na descrição separados', async () => {
  const inst = instantaneo();
  const m = montarExportacaoGeral(inst, await coletarDadosExportacao(clienteFalso(), inst));
  const p = planilha(m, 'Participação').linhas;
  assert.deepEqual(p.slice(0, 2).map((l) => [l[0], l[1], l[3]]), [['311', 'OVO', 0.3], ['341', 'OVO', 0.2]]);
  const demais = p.find((l) => /Demais/.test(l[1]));
  assert.equal(demais[2], 160);
  assert.deepEqual(p[p.length - 1].slice(1, 4), ['Total do período (denominador)', 1000, 1]);
});

test('Excel: arquivo real com notas acima da tabela, cabeçalho congelado, autofiltro e células numéricas', async () => {
  const inst = instantaneo();
  const m = montarExportacaoGeral(inst, await coletarDadosExportacao(clienteFalso(), inst));
  const bytes = gerarXlsx({ planilhas: m.planilhas, titulo: m.titulo });
  const zip = lerZip(bytes);
  const wb = zip.get('xl/workbook.xml');
  assert.equal((wb.match(/<sheet /g) || []).length, m.planilhas.length);
  const aba = zip.get('xl/worksheets/sheet1.xml');
  const h = m.planilhas[0].notas.length + 2;
  assert.match(aba, new RegExp(`<pane ySplit="${h}" topLeftCell="A${h + 1}"`));
  assert.match(aba, new RegExp(`<autoFilter ref="A${h}:G`));
  assert.match(aba, /<c r="B\d+" s="5"><v>23192.35<\/v><\/c>/); // R$ como número (#,##0.00)
  assert.match(aba, /<c r="F\d+" s="7"><v>-0.0787<\/v><\/c>/); // variação como percentual
  assert.match(wb, new RegExp(`\\$A\\$${h}:\\$G\\$`)); // _FilterDatabase acompanha
});

test('xlsx: sem notas o arquivo é idêntico ao de antes (cabeçalho na linha 1); célula com tipo próprio', () => {
  const bytes = gerarXlsx({ planilhas: [{ nome: 'A', colunas: [{ titulo: 'X', tipo: 'texto' }, { titulo: 'V', tipo: 'decimal' }], linhas: [['a', { valor: 0.5, tipo: 'percentual' }], ['b', 2]] }] });
  const aba = lerZip(bytes).get('xl/worksheets/sheet1.xml');
  assert.match(aba, /<pane ySplit="1" topLeftCell="A2"/);
  assert.match(aba, /<autoFilter ref="A1:B3"\/>/);
  assert.match(aba, /<c r="B2" s="7"><v>0.5<\/v><\/c>/);
  assert.match(aba, /<c r="B3" s="5"><v>2<\/v><\/c>/);
});

test('PDF: relatório completo com gráficos vetoriais, paginação e anexo; texto seguro para a fonte padrão', async () => {
  const inst = instantaneo();
  const m = montarExportacaoGeral(inst, await coletarDadosExportacao(clienteFalso(), inst));
  const bytes = new Uint8Array(gerarPdfRelatorio(m, { jsPDF, autoTable }));
  const texto = new TextDecoder('latin1').decode(bytes);
  assert.ok(texto.startsWith('%PDF-'));
  const paginas = (texto.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(paginas >= 8, `páginas: ${paginas}`);
  assert.ok(m.pdf.secoes.some((s) => s.grafico) && m.pdf.secoes.some((s) => /Anexo/.test(s.titulo || '')));
  assert.equal(textoPdf('▲ +12,3% − x'), '+12,3% - x');
  assert.ok(!JSON.stringify(m.pdf.secoes.map((s) => [s.titulo, s.nota, s.linhas])).match(/[▲▼■−]/));
});

test('PDF: opções aditivas não mudam relatórios existentes (sem gráfico/texto, mesmas páginas)', () => {
  const modelo = { titulo: 'X', periodoRotulo: 'P', geradoEm: 'G', filtros: {}, pdf: { secoes: [{ titulo: 'T', cabecalho: ['A', 'B'], linhas: [['1', '2']] }] } };
  const a = new Uint8Array(gerarPdfRelatorio(modelo, { jsPDF, autoTable }));
  assert.ok(new TextDecoder('latin1').decode(a).startsWith('%PDF-'));
  assert.deepEqual(corParaRgb('rgb(1, 2, 3)'), [1, 2, 3]);
  assert.deepEqual(corParaRgb('#00897a'), [0, 137, 122]);
  const e = escalaEixo(0, 5180);
  assert.equal(e.minimo, 0);
  assert.ok(e.maximo >= 5180 && e.marcas.length >= 3);
});

test('acesso rápido do Dashboard: BI Gerencial só para o admin ativo, no fim, com rota /bi e ícone do menu', async () => {
  const { atalhosDashboard, navegacaoDoUsuario, ITEM_BI_GERENCIAL } = await import('../../nav/navegacao.js');
  const perms = new Set(['producao.visualizar', 'pedidos.visualizar']);
  const admin = { perfil: 'proprietario_admin', ativo: true };
  const a = atalhosDashboard(perms, admin);
  const principais = navegacaoDoUsuario(perms, admin).principais.filter((m) => m.chave !== 'dashboard');
  assert.deepEqual(a.slice(0, -1).map((m) => m.chave), principais.map((m) => m.chave)); // demais atalhos preservados
  assert.equal(a[a.length - 1].chave, 'bi');
  assert.equal(a[a.length - 1].href, '/bi');
  assert.equal(a[a.length - 1].icone, ITEM_BI_GERENCIAL.icone);
  assert.ok(!a.some((m) => m.chave === 'importacoes' || m.chave === 'usuarios'), 'nenhum outro item administrativo');
  // Imediatamente após Financeiro quando o Financeiro aparece
  const { PERMISSOES } = await import('../../auth/permissoes.js');
  const comFin = atalhosDashboard(new Set(Object.values(PERMISSOES)), admin);
  const iFin = comFin.findIndex((m) => m.chave === 'financeiro');
  assert.ok(iFin >= 0, 'Financeiro visível com todas as permissões');
  assert.equal(comFin[iFin + 1].chave, 'bi');
  for (const outro of [{ perfil: 'gestao', ativo: true }, { perfil: 'proprietario_admin', ativo: false }, null]) {
    assert.ok(!atalhosDashboard(perms, outro).some((m) => m.chave === 'bi'), JSON.stringify(outro));
  }
});
