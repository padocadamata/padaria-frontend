// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/importacoes/__tests__/*.test.mjs
// Leitor de .xlsx do navegador (SheetJS vendorizado) com planilhas geradas
// na hora a partir de relatórios FICTÍCIOS: original do G3 (textos na célula,
// sem compressão), regravado (textos compartilhados + compressão), fórmulas,
// várias abas, macros, zip corrompido e "zip bomb".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { lerPlanilha, inspecionarZip, ErroLeitura, TAMANHO_MAXIMO } from '../leitorXlsx.js';
import { vendasProdutoCliente, faturamentoGeral, cenario } from './relatoriosFicticios.mjs';

const VENDAS = [
  { numero: 10, dataHora: '2026-06-03 08:10', itens: [{ produto: 'PÃO FRANCÊS', codigo: 1, qtd: 0.5, valor: 9.5 }, { produto: 'CAFÉ', codigo: 2, qtd: 1, valor: 6 }] },
  { numero: 11, dataHora: '2026-06-03 09:00', itens: [{ produto: 'BOLO & TORTA <GRANDE>', codigo: 3, qtd: 1, valor: 25 }] },
];
const PERIODO = { inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 09:00' };

function gerar(linhas, opcoes = {}, preparar = () => {}) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
  wb.Props = { Application: 'SheetJS' };
  preparar(wb, ws);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: false, ...opcoes }));
}

const limpar = (linhas) => linhas.map((l) => {
  const c = l.map((v) => (v === undefined || v === '' ? null : v));
  while (c.length && c[c.length - 1] === null) c.pop();
  return c;
});

test('lê o formato do G3 (textos na célula, sem compressão) idêntico às linhas de origem e marca como original', async () => {
  const origem = vendasProdutoCliente({ ...PERIODO, itens: cenario(VENDAS).itens });
  const { linhas, metadados } = await lerPlanilha(gerar(origem));
  assert.deepEqual(linhas, limpar(origem));
  assert.equal(metadados.abas, 1);
  assert.equal(metadados.formulas, 0);
  assert.equal(metadados.textosCompartilhados, false);
  assert.equal(metadados.produtor, 'SheetJS');
  assert.equal(metadados.original, true);
});

test('arquivo regravado (textos compartilhados + compressão): mesmo conteúdo, marcado como não original', async () => {
  const origem = faturamentoGeral({ ...PERIODO, vendas: cenario(VENDAS).fat });
  const bytes = gerar(origem, { bookSST: true, compression: true }, (wb) => { wb.Props = { Application: 'Microsoft Excel' }; });
  assert.ok(inspecionarZip(bytes).entradas.some((e) => e.nome === 'xl/sharedStrings.xml'));
  const { linhas, metadados } = await lerPlanilha(bytes);
  assert.deepEqual(linhas, limpar(origem));
  assert.equal(metadados.textosCompartilhados, true);
  assert.equal(metadados.original, false);
});

test('linhas vazias no meio e no fim: numeração preservada (índice = linha do Excel - 1), vazios finais removidos', async () => {
  const origem = [['TITULO'], [], ['A', null, 'C'], [], []];
  const { linhas } = await lerPlanilha(gerar(origem));
  assert.deepEqual(linhas, [['TITULO'], [], ['A', null, 'C']]);
});

test('recusa: fórmulas, mais de uma aba, macros, não-zip, vazio, grande demais, zip bomb, zip corrompido', async () => {
  const base = vendasProdutoCliente({ ...PERIODO, itens: cenario(VENDAS).itens });
  const comFormula = gerar(base, {}, (wb, ws) => { ws.G20 = { t: 'n', v: 0, f: 'SUM(G13:G15)' }; ws['!ref'] = 'A1:G20'; });
  await assert.rejects(lerPlanilha(comFormula), (e) => e instanceof ErroLeitura && /fórmulas/.test(e.message));

  const duasAbas = gerar(base, {}, (wb) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Outra'));
  await assert.rejects(lerPlanilha(duasAbas), /2 abas/);

  const comMacro = gerar(base, { bookType: 'xlsm', bookVBA: true }, (wb) => { wb.vbaraw = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]); });
  assert.ok(inspecionarZip(comMacro).entradas.some((e) => /vbaProject\.bin$/.test(e.nome)), 'fixture com macro');
  await assert.rejects(lerPlanilha(comMacro), /macros/);

  await assert.rejects(lerPlanilha(new TextEncoder().encode('Produto;Codigo\nPAO;1')), /não é um \.xlsx válido/);
  await assert.rejects(lerPlanilha(new Uint8Array(0)), /vazio/);
  await assert.rejects(lerPlanilha(new Uint8Array(TAMANHO_MAXIMO + 1)), /30 MB/);

  // zip bomb: tamanho descompactado declarado gigantesco no diretório central
  const bomba = gerar(base);
  const fim = bomba.length - 22;
  const dv = new DataView(bomba.buffer, bomba.byteOffset);
  let p = dv.getUint32(fim + 16, true);
  dv.setUint32(p + 24, 0xfffffff0, true);
  await assert.rejects(lerPlanilha(bomba), /descompactado/);

  const corrompido = gerar(base).slice(0, 400);
  await assert.rejects(lerPlanilha(corrompido), ErroLeitura);
});

test('células estranhas viram texto marcador (o servidor recusa como ilegível), nunca quebram a leitura', async () => {
  const bytes = gerar([['TITULO'], [true, null, 'x']], {}, (wb, ws) => { ws.C2 = { t: 'e', v: 7 }; });
  const { linhas } = await lerPlanilha(bytes);
  assert.deepEqual(linhas[1], ['VERDADEIRO', null, '#ERRO']);
});
