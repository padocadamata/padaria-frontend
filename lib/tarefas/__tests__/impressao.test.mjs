// node --test lib/tarefas/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codigoFrequenciaImpressao, montarImpressao, rotuloMesImpressao } from '../impressao.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ler = (arq) => readFileSync(join(raiz, arq), 'utf8');

const categorias = [
  { valor: 'LIMPEZA', ordem: 1 },
  { valor: 'ABASTECIMENTO E CONTROLE', ordem: 2 },
  { valor: 'FECHAMENTO', ordem: 3 },
];
const tarefas = [
  { id: 'coifa', descricao: 'Coifa', categoria: 'LIMPEZA', ordem: 1, ativo: true },
  { id: 'forno', descricao: 'Forno Pão de Queijo', categoria: 'LIMPEZA', ordem: 3, ativo: true },
  { id: 'vidros', descricao: 'Expositores - Vidros externos dos Balcões e estufa', categoria: 'LIMPEZA', ordem: 13, ativo: true },
  { id: 'lanches', descricao: 'Preparar / Verificar os lanches naturais', categoria: 'ABASTECIMENTO E CONTROLE', ordem: 11, ativo: true },
  {
    id: 'tomadas',
    descricao: 'Conferir tomadas e desligar água e equipamentos (máq. de café, luzes dos expositores, balanças, microondas, chapa e notebook)',
    categoria: 'FECHAMENTO',
    ordem: 13,
    ativo: true,
  },
];
const regra = (tipo, dias = null, semanas = null, grupo_id = null) => [{ vigente_desde: '2026-10-01', tipo, dias_semana: dias, semanas_do_mes: semanas, grupo_id }];
const regrasPorTarefa = new Map([
  ['coifa', regra('semanas_do_mes', [3], [2, 4])],
  ['forno', regra('dias_semana', [3])],
  ['vidros', regra('diaria')],
  ['lanches', regra('sem_programacao')],
  ['tomadas', regra('diaria', null, null, 'grupo-bloco-3')],
]);

let seq = 0;
const occ = (tarefa_id, data, parcial = {}) => ({
  id: `o${++seq}`, tarefa_id, data, origem: 'programada', posicao: 1, posicao_programada: 1,
  responsavel_nome: null, responsavel_avulso: null, ajustado_em: null, concluida: false, cancelada: false, ...parcial,
});

test('meses de 28, 29, 30 e 31 dias (nunca assume 30)', () => {
  const base = { categorias, tarefas, regrasPorTarefa, ocorrencias: [] };
  assert.equal(montarImpressao({ ...base, mes: '2027-02-01' }).dias.length, 28);
  assert.equal(montarImpressao({ ...base, mes: '2028-02-01' }).dias.length, 29);
  assert.equal(montarImpressao({ ...base, mes: '2026-11-01' }).dias.length, 30);
  const out = montarImpressao({ ...base, mes: '2026-10-01' });
  assert.equal(out.dias.length, 31);
  assert.equal(out.rotuloMes, 'Outubro 2026');
  assert.deepEqual(out.dias[0], { data: '2026-10-01', numero: 1, sigla: 'Qui', fimDeSemana: false });
  assert.equal(out.dias[2].sigla, 'Sáb');
  assert.equal(out.dias[2].fimDeSemana, true);
  assert.equal(out.dias[30].data, '2026-10-31');
  assert.equal(rotuloMesImpressao('2028-02-15'), 'Fevereiro 2028');
});

test('categorias, nome completo, codigo de frequencia e ordem do calendario', () => {
  const out = montarImpressao({ categorias, tarefas, regrasPorTarefa, ocorrencias: [], mes: '2026-10-01' });
  assert.deepEqual(out.secoes.map((s) => s.categoria), ['LIMPEZA', 'ABASTECIMENTO E CONTROLE', 'FECHAMENTO']);
  const limpeza = out.secoes[0].linhas;
  assert.deepEqual(limpeza.map((l) => l.tarefaId), ['coifa', 'forno', 'vidros'], 'menos frequente primeiro, diaria por ultimo');
  assert.deepEqual(limpeza.map((l) => l.frequencia), ['15', '1x', 'D']);
  assert.equal(out.secoes[1].linhas[0].frequencia, '—');
  const tomadas = out.secoes[2].linhas[0];
  assert.equal(tomadas.descricao, tarefas[4].descricao, 'nome completo, sem truncar');
  assert.equal(out.secoes.every((s) => s.linhas.every((l) => l.celulas.length === 31)), true);
  // Sem periodicidade/dias da semana no papel.
  const linhas = out.secoes.flatMap((s) => s.linhas);
  assert.equal(linhas.some((l) => 'periodicidade' in l), false);
  assert.equal(/quarta|Semanal|Quinzenal|Diária|Sem programação/.test(JSON.stringify(linhas.map(({ celulas, ...l }) => l))), false);
});

test('fim de semana derivado da data real: cabecalho e TODAS as celulas da coluna', () => {
  const out = montarImpressao({ categorias, tarefas, regrasPorTarefa, ocorrencias: [], mes: '2026-10-01' });
  const fds = out.dias.filter((d) => d.fimDeSemana).map((d) => d.numero);
  assert.deepEqual(fds, [3, 4, 10, 11, 17, 18, 24, 25, 31], 'sabados e domingos de outubro/2026');
  for (const linha of out.secoes.flatMap((s) => s.linhas)) {
    linha.celulas.forEach((c, i) => {
      assert.equal(c.data, out.dias[i].data);
      assert.equal(c.fimDeSemana, out.dias[i].fimDeSemana, `${linha.tarefaId} ${c.data}`);
    });
  }
  // Outro mes: as posicoes mudam (fevereiro/2027 comeca numa segunda).
  const fev = montarImpressao({ categorias, tarefas, regrasPorTarefa, ocorrencias: [], mes: '2027-02-01' });
  assert.deepEqual(fev.dias.filter((d) => d.fimDeSemana).map((d) => d.numero), [6, 7, 13, 14, 20, 21, 27, 28]);
  assert.equal(fev.secoes[0].linhas[0].celulas[5].fimDeSemana, true);
  assert.equal(fev.secoes[0].linhas[0].celulas[2].fimDeSemana, false);
});

test('codigo Freq.: D / 3x / 2x / 1x / 15 / — (nunca dias da semana)', () => {
  const r = (tipo, dias_semana = null, semanas_do_mes = null) => ({ tipo, dias_semana, semanas_do_mes });
  assert.equal(codigoFrequenciaImpressao(r('diaria')), 'D');
  assert.equal(codigoFrequenciaImpressao(r('dias_semana', [1, 2, 3, 4, 5, 6, 7])), 'D');
  assert.equal(codigoFrequenciaImpressao(r('dias_semana', [1, 3, 5])), '3x');
  assert.equal(codigoFrequenciaImpressao(r('dias_semana', [2, 5])), '2x');
  assert.equal(codigoFrequenciaImpressao(r('dias_semana', [6, 7])), '2x', 'Sab/Dom = 2 dias por semana');
  assert.equal(codigoFrequenciaImpressao(r('dias_semana', [3])), '1x');
  assert.equal(codigoFrequenciaImpressao(r('semanas_do_mes', [3], [2, 4])), '15');
  assert.equal(codigoFrequenciaImpressao(r('sem_programacao')), '—');
  assert.equal(codigoFrequenciaImpressao(null), '—');
});

test('celulas: posicao PLANEJADA (efetiva), nunca executor/conclusao; cancelada vazia', () => {
  const ocorrencias = [
    occ('vidros', '2026-10-01', { posicao: 2, posicao_programada: 2, responsavel_nome: 'Maria' }),
    occ('vidros', '2026-10-02', { posicao: 3, posicao_programada: 1, ajustado_em: '2026-10-01T10:00:00Z', responsavel_avulso: 'Joana' }),
    occ('vidros', '2026-10-03', { posicao: 1, concluida: true, concluido_em: '2026-10-03T20:00:00Z', concluido_por: 'u1' }),
    occ('vidros', '2026-10-04', { posicao: 2, cancelada: true, cancelado_motivo: 'fechado' }),
    occ('coifa', '2026-10-14', { posicao: 1 }),
    occ('coifa', '2026-11-11', { posicao: 3 }),
  ];
  const out = montarImpressao({ categorias, tarefas, regrasPorTarefa, ocorrencias, mes: '2026-10-01' });
  const vidros = out.secoes[0].linhas.find((l) => l.tarefaId === 'vidros').celulas;
  assert.equal(vidros[0].texto, 'F2', 'nome da posicao nao aparece');
  assert.equal(vidros[1].texto, 'F3', 'ajuste manual da posicao e respeitado; avulso nao aparece');
  assert.equal(vidros[2].texto, 'F1', 'concluida imprime igual (so planejamento)');
  assert.equal(vidros[3].texto, '', 'cancelada = sem tarefa');
  assert.equal(vidros[4].texto, '');
  const coifa = out.secoes[0].linhas.find((l) => l.tarefaId === 'coifa').celulas;
  assert.equal(coifa.filter((c) => c.texto).length, 1, 'ocorrencia de outro mes nao entra');
  // Conclusao/executor nao muda nada no conteudo impresso.
  const semConclusao = montarImpressao({ categorias, tarefas, regrasPorTarefa, ocorrencias: ocorrencias.map((o) => ({ ...o, concluida: false, concluido_em: null, concluido_por: null })), mes: '2026-10-01' });
  assert.deepEqual(semConclusao, out);
  const texto = JSON.stringify(out);
  for (const proibido of ['Maria', 'Joana', 'concluid', 'grupo-bloco-3', 'Bloco', 'Tapetes + Lixeiras']) {
    assert.equal(texto.includes(proibido), false, proibido);
  }
});

test('componente/pagina de impressao: sem checkbox/botoes no papel, com RESPONSAVEIS e A4 paisagem', () => {
  const componente = ler('components/tarefas/CalendarioImpressao.js');
  const codigo = componente.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/checkbox|<input|<button|Button|Icon|execuc|concluid/i.test(codigo), false);
  assert.match(componente, /RESPONSÁVEIS/);
  assert.match(componente, /\[1, 2, 3\]\.map/);
  assert.match(componente, />Freq\.</);
  assert.equal(/periodicidade|estilos\.periodo/.test(componente), false, 'sem periodicidade abaixo do nome');
  const css = ler('components/tarefas/impressao.module.css');
  assert.match(css, /\.linhaTarefa > th,\s*\.linhaTarefa > td \{\s*height: /, 'altura fixa e igual para toda linha de tarefa');
  assert.match(css, /\.nomeDuasLinhas \{/, 'nome quebrado cabe na mesma altura');
  assert.equal(/text-overflow|ellipsis/.test(css), false, 'nome nunca truncado com "..."');
  assert.match(css, /\.cabDiaFimDeSemana,\s*\.celFimDeSemana \{\s*background: #f0f0f0;\s*-webkit-print-color-adjust: exact;\s*print-color-adjust: exact;/,
    'coluna de fim de semana inteira (cabecalho + celulas) em cinza muito claro, impresso');
  assert.match(css, /\.linhaCategoria th \{[^}]*background: #dedede;[^}]*print-color-adjust: exact;/, 'faixa de categoria');
  assert.match(componente, /c\.fimDeSemana \? estilos\.celFimDeSemana/, 'celula usa a data da propria celula');
  assert.match(css, /\.barra \{\s*display: none !important;/, 'barra de controles escondida na impressao');
  assert.match(css, /break-inside: avoid/);
  const pagina = ler('pages/funcionarios/tarefas/imprimir.js');
  assert.match(pagina, /size: A4 landscape/);
  assert.equal(/PageShell|Sidebar|FuncionariosSubNav|TarefasFiltros/.test(pagina), false, 'sem menu/sidebar/filtros');
  assert.match(pagina, /router\.query\.imprimir !== '1'/, 'so imprime quando aberto pelo botao');
  const calendario = ler('pages/funcionarios/tarefas/index.js');
  assert.match(calendario, /Imprimir calendário/);
  assert.equal(/window\.print/.test(calendario), false, 'abrir o calendario nunca imprime');
});
