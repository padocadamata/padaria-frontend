// HOMOLOGAÇÃO LOCAL -- gera, NA CÓPIA temporária, relatórios .xlsx FICTÍCIOS
// no mesmo formato do G3 (SheetJS, aba "Relatório", textos na célula) para
// testar a Central de Importações. Nenhum dado real.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  vendasProdutoCliente, faturamentoGeral, vendasPeriodo, cenario, vendasEmMassa,
} from '../../lib/importacoes/__tests__/relatoriosFicticios.mjs';

const destino = path.resolve(process.argv[2] || 'homologacao-arquivos');
mkdirSync(destino, { recursive: true });

function salvar(nome, linhas, { regravado = false } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
  wb.Props = { Application: regravado ? 'Microsoft Excel' : 'SheetJS' };
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', bookSST: regravado, compression: regravado });
  writeFileSync(path.join(destino, nome), bytes);
}

const PERIODO = { inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 08:30' };
const vendas = vendasEmMassa({ quantidade: 600, inicio: '2026-06-01', dias: 30, itensPorVenda: 3, primeiroNumero: 1001 });
const c = cenario(vendas);

salvar('1_diario_junho.xlsx', vendasPeriodo({ ...PERIODO, dias: c.dias }));
salvar('2_faturamento_junho.xlsx', faturamentoGeral({ ...PERIODO, vendas: c.fat }));
salvar('3_itens_junho.xlsx', vendasProdutoCliente({ ...PERIODO, itens: c.itens }));

// reexportação posterior: venda 1001 corrigida, 1002 sumiu, 1003 com valor zero
const reexport = c.itens
  .filter((i) => i.numero !== 1002)
  .map((i) => (i.numero === 1001 && i === c.itens.find((x) => x.numero === 1001) ? { ...i, valor: Math.round((i.valor + 1) * 100) / 100 } : i))
  .map((i) => (i.numero === 1003 && i === c.itens.find((x) => x.numero === 1003) ? { ...i, valor: 0 } : i));
salvar('4_itens_junho_reexportado.xlsx', vendasProdutoCliente({ ...PERIODO, gerado: '2026-07-05 09:00', itens: reexport }));

salvar('5_itens_filtrado_salgado.xlsx', vendasProdutoCliente({ ...PERIODO, itens: c.itens.slice(0, 20), filtrosExtras: [['Seção/Categoria', 'SALGADO']] }));

const fatCliente = faturamentoGeral({ ...PERIODO, gerado: '2026-07-02 10:00', vendas: c.fat })
  .map((l) => (l[0] === 1005 ? [l[0], 'MARIA FICTÍCIA DA SILVA', ...l.slice(2)] : l));
salvar('6_faturamento_com_cliente.xlsx', fatCliente);

salvar('7_faturamento_regravado.xlsx', faturamentoGeral({ ...PERIODO, vendas: c.fat }), { regravado: true });
console.log(`[homologação] arquivos fictícios em ${destino}`);
