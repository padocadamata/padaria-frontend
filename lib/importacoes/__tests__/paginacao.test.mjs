// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/importacoes/__tests__/*.test.mjs
// Paginação NO SERVIDOR da lista de registros do lote (Central de Importações
// G3): lógica pura, consulta paginada (cliente Supabase simulado sobre um lote
// fictício de milhares de registros) e a tela usando o componente padrão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TAMANHOS_PAGINA, TAMANHO_PAGINA_PADRAO, calcularPaginacao, chaveContexto, deslocamentoDaPagina,
  normalizarTamanho, paginaEfetiva, precisaRolar, textoContador,
} from '../paginacao.js';
import { listarLotePaginado, listarPendencias } from '../consultas.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ler = (p) => readFileSync(join(RAIZ, p), 'utf8');

test('tamanhos: 10, 20, 50 e 100; padrão 20; valor inválido cai no padrão', () => {
  assert.deepEqual(TAMANHOS_PAGINA, [10, 20, 50, 100]);
  assert.equal(TAMANHO_PAGINA_PADRAO, 20);
  for (const t of [10, 20, 50, 100, '50']) assert.equal(normalizarTamanho(t), Number(t));
  for (const t of [0, 7, 500, -20, null, undefined, 'abc']) assert.equal(normalizarTamanho(t), 20, String(t));
});

test('deslocamento enviado ao servidor', () => {
  assert.equal(deslocamentoDaPagina(1, 20), 0);
  assert.equal(deslocamentoDaPagina(3, 20), 40);
  assert.equal(deslocamentoDaPagina(2, 100), 100);
  assert.equal(deslocamentoDaPagina(0, 20), 0);
  assert.equal(deslocamentoDaPagina(-4, 50), 0);
  assert.equal(deslocamentoDaPagina(2, 999), 20, 'tamanho inválido = padrão');
});

test('contador "Exibindo X–Y de Z registros" e páginas (inclusive última parcial e lote vazio)', () => {
  let p = calcularPaginacao({ pagina: 1, tamanho: 20, total: 3025 });
  assert.deepEqual(p, { paginaAtual: 1, totalPaginas: 152, total: 3025, primeiro: 1, ultimo: 20 });
  assert.equal(textoContador(p), 'Exibindo 1–20 de 3.025 registros');
  p = calcularPaginacao({ pagina: 152, tamanho: 20, total: 3025 });
  assert.equal(textoContador(p), 'Exibindo 3.021–3.025 de 3.025 registros');
  p = calcularPaginacao({ pagina: 999, tamanho: 100, total: 3025 });
  assert.equal(p.paginaAtual, 31, 'página além do fim cai na última');
  assert.equal(textoContador(calcularPaginacao({ pagina: 1, tamanho: 10, total: 1 })), 'Exibindo 1–1 de 1 registro');
  p = calcularPaginacao({ pagina: 1, tamanho: 20, total: 0 });
  assert.deepEqual(p, { paginaAtual: 1, totalPaginas: 1, total: 0, primeiro: 0, ultimo: 0 });
  assert.equal(textoContador(p), 'Nenhum registro');
});

test('trocar filtro, tamanho ou versão do lote volta para a página 1; trocar de página mantém filtro e tamanho', () => {
  const c = chaveContexto({ acao: 'alterada', tamanho: 20, versao: 0 });
  const estado = { contexto: c, pagina: 7 };
  assert.equal(paginaEfetiva(estado, c), 7);
  assert.equal(paginaEfetiva(estado, chaveContexto({ acao: 'nova', tamanho: 20, versao: 0 })), 1, 'filtro');
  assert.equal(paginaEfetiva(estado, chaveContexto({ acao: null, tamanho: 20, versao: 0 })), 1, 'limpar filtro');
  assert.equal(paginaEfetiva(estado, chaveContexto({ acao: 'alterada', tamanho: 50, versao: 0 })), 1, 'tamanho');
  assert.equal(paginaEfetiva(estado, chaveContexto({ acao: 'alterada', tamanho: 20, versao: 1 })), 1, 'lote recarregado');
  assert.equal(paginaEfetiva(null, c), 1);
  for (const acao of ['nova', 'alterada', 'igual', 'bloqueada', 'ausente', null]) {
    assert.equal(chaveContexto({ acao, tamanho: 20 }), chaveContexto({ acao, tamanho: 20, versao: 0 }));
  }
});

test('rolagem: só quando o início da tabela não está visível', () => {
  assert.equal(precisaRolar(-300, { alturaCabecalho: 68, alturaTela: 800 }), true, 'acima (usuário rolou até o rodapé)');
  assert.equal(precisaRolar(40, { alturaCabecalho: 68, alturaTela: 800 }), true, 'escondido atrás do cabeçalho fixo');
  assert.equal(precisaRolar(200, { alturaCabecalho: 68, alturaTela: 800 }), false, 'já visível');
  assert.equal(precisaRolar(1200, { alturaCabecalho: 68, alturaTela: 800 }), true, 'abaixo da tela');
});

// Cliente Supabase simulado: reproduz o contrato de g3_listar_lote (limite
// 1..500, deslocamento >= 0, ordem estável, "total" do filtro em cada linha).
function loteFicticio(quantidade) {
  const acoesCiclo = ['igual', 'igual', 'igual', 'alterada', 'nova', 'bloqueada', 'ausente', 'igual', 'igual', 'igual'];
  return Array.from({ length: quantidade }, (_, i) => ({
    faceta: 'itens', chave: String(1000 + i), data: `2026-06-${String(1 + Math.floor((i * 30) / quantidade)).padStart(2, '0')}`,
    acao: acoesCiclo[i % acoesCiclo.length], motivo: null, detalhe: null, linhas: [i + 2], valor: 10 + (i % 7),
  }));
}

function supabaseSimulado(registros) {
  const chamadas = [];
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push({ nome, ...args });
      assert.equal(nome, 'g3_listar_lote');
      const limite = Math.min(Math.max(args.p_limite ?? 100, 1), 500);
      const desl = Math.max(args.p_deslocamento ?? 0, 0);
      const filtrados = registros.filter((r) => !args.p_acao || r.acao === args.p_acao);
      const data = filtrados.slice(desl, desl + limite).map((r) => ({ ...r, total: String(filtrados.length) }));
      return { data, error: null };
    },
  };
}

test('consulta paginada: pede só a página (limite/deslocamento), devolve total e registros sem a coluna "total"', async () => {
  const lote = loteFicticio(5000);
  const sb = supabaseSimulado(lote);
  const r = await listarLotePaginado(sb, 'lote-1', { pagina: 3, tamanho: 50 });
  assert.equal(r.total, 5000);
  assert.equal(r.registros.length, 50);
  assert.equal(r.registros[0].chave, '1100');
  assert.ok(r.registros.every((x) => !('total' in x)));
  assert.deepEqual(sb.chamadas, [{ nome: 'g3_listar_lote', p_lote: 'lote-1', p_acao: null, p_limite: 50, p_deslocamento: 100 }]);

  const vazio = await listarLotePaginado(sb, 'lote-1', { pagina: 999, tamanho: 20 });
  assert.deepEqual(vazio, { registros: [], total: 0 });
  const padrao = await listarLotePaginado(sb, 'lote-1');
  assert.equal(padrao.registros.length, 20, 'padrão 20 por página');
  assert.equal(sb.chamadas.at(-1).p_limite, 20);
  await listarLotePaginado(sb, 'lote-1', { tamanho: 1000 });
  assert.equal(sb.chamadas.at(-1).p_limite, 20, 'tamanho fora da lista nunca pede o lote inteiro');
});

test('lote com milhares de registros: cada filtro, em cada tamanho, percorre tudo uma vez só, sem repetir nem pular', async () => {
  const lote = loteFicticio(12345);
  const sb = supabaseSimulado(lote);
  for (const acao of [null, 'nova', 'alterada', 'igual', 'bloqueada', 'ausente']) {
    const esperado = lote.filter((r) => !acao || r.acao === acao);
    for (const tamanho of TAMANHOS_PAGINA) {
      if (acao === null && tamanho < 50) continue; // sem filtro: 12 mil / 10 = muitas chamadas; já coberto por 50 e 100
      const vistos = [];
      const primeira = await listarLotePaginado(sb, 'L', { acao, pagina: 1, tamanho });
      const info = calcularPaginacao({ pagina: 1, tamanho, total: primeira.total });
      assert.equal(primeira.total, esperado.length, `${acao}/${tamanho}: total`);
      vistos.push(...primeira.registros);
      for (let p = 2; p <= info.totalPaginas; p += 1) {
        const r = await listarLotePaginado(sb, 'L', { acao, pagina: p, tamanho });
        assert.equal(r.total, esperado.length);
        assert.ok(r.registros.length <= tamanho);
        vistos.push(...r.registros);
      }
      assert.deepEqual(vistos.map((x) => x.chave), esperado.map((x) => x.chave), `${acao}/${tamanho}`);
      if (acao) assert.ok(vistos.every((x) => x.acao === acao));
    }
  }
  assert.ok(sb.chamadas.every((c) => c.p_limite <= 100), 'nunca pede mais que uma página');
});

test('tela do lote: paginação no servidor com o componente padrão, contador, seletor de tamanho e rolagem ao topo', () => {
  const src = ler('pages/importacoes/[id].js');
  assert.doesNotMatch(src, /Carregar mais/, 'sem o botão antigo');
  assert.match(src, /import Paginacao from '\.\.\/\.\.\/components\/Paginacao'/);
  assert.match(src, /<Paginacao paginaAtual=\{info\.paginaAtual\} totalPaginas=\{info\.totalPaginas\} onMudarPagina=\{irPara\}/);
  assert.match(src, /listarLotePaginado\(supabase, loteId, \{ acao, pagina, tamanho \}\)/);
  assert.match(src, /TAMANHOS_PAGINA\.map/);
  assert.match(src, /textoContador\(info\)/);
  assert.match(src, /scrollIntoView\(\{ block: 'start'/);
  // prévia e lote confirmado usam a mesma tabela; resumo e confirmação ficam fora dela
  assert.match(src, /\{\(emPrevia \|\| confirmado\) && \(/);
  assert.match(src, /<Contadores resumo=\{lote\.resumo\}/);
  const tabela = src.slice(src.indexOf('function TabelaRegistros('), src.indexOf('function Totais('));
  assert.doesNotMatch(tabela, /confirmarImportacao|Contadores/, 'resumo e confirmação não dependem da página');
});

// Pendências abertas: mesmo contrato de g3_listar_pendencias (limite 1..500,
// deslocamento >= 0, filtro por motivo, "total" do filtro e "total_geral").
function supabasePendencias(pendencias) {
  const chamadas = [];
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push({ nome, ...args });
      assert.equal(nome, 'g3_listar_pendencias');
      const limite = Math.min(Math.max(args.p_limite ?? 20, 1), 500);
      const desl = Math.max(args.p_deslocamento ?? 0, 0);
      const filtradas = pendencias.filter((p) => (!args.p_motivo || p.motivo === args.p_motivo) && (!args.p_layout || p.layout === args.p_layout));
      const data = filtradas.slice(desl, desl + limite).map((p) => ({ ...p, total: String(filtradas.length), total_geral: String(pendencias.length) }));
      return { data, error: null };
    },
  };
}

const MOTIVOS_TESTE = ['valor_nao_positivo', 'aritmetica_linha', 'datas_divergentes', 'conflito_numero'];
const pendenciasFicticias = (n) => Array.from({ length: n }, (_, i) => ({
  id: 1 + i, lote_id: 'L', layout: i % 4 === 1 ? 'faturamento_geral' : 'vendas_produto_cliente', faceta: i % 4 === 1 ? 'faturamento' : 'itens',
  chave: String(5000 + i), data: '2026-06-10', motivo: MOTIVOS_TESTE[i % 7 === 0 ? 2 : i % 4 === 1 ? 1 : 0], detalhe: null, linhas: [i], valor: 0,
}));

test('pendências: mais de 1.000 percorridas por página, sem truncamento, em todos os tamanhos e filtros', async () => {
  const todas = pendenciasFicticias(2345);
  const sb = supabasePendencias(todas);
  for (const motivo of [null, ...MOTIVOS_TESTE]) {
    const esperado = todas.filter((p) => !motivo || p.motivo === motivo);
    for (const tamanho of TAMANHOS_PAGINA) {
      const primeira = await listarPendencias(sb, { motivo, pagina: 1, tamanho });
      assert.equal(primeira.total, esperado.length, `${motivo}/${tamanho}: total do filtro`);
      if (esperado.length) assert.equal(primeira.totalGeral, 2345, 'total geral = todas as abertas');
      const vistos = [...primeira.registros];
      const { totalPaginas } = calcularPaginacao({ pagina: 1, tamanho, total: primeira.total });
      for (let p = 2; p <= totalPaginas; p += 1) vistos.push(...(await listarPendencias(sb, { motivo, pagina: p, tamanho })).registros);
      assert.deepEqual(vistos.map((x) => x.id), esperado.map((x) => x.id), `${motivo}/${tamanho}`);
      assert.ok(vistos.every((x) => !('total' in x) && !('total_geral' in x)));
    }
  }
  assert.ok(sb.chamadas.every((c) => c.p_limite <= 100 && c.p_layout === null), 'nunca pede mais que uma página');
  const vazia = await listarPendencias(sb, { pagina: 999 });
  assert.deepEqual(vazia, { registros: [], total: 0, totalGeral: null }, 'página além do fim: vazia, a tela volta para a 1');
  const semNenhuma = await listarPendencias(supabasePendencias([]));
  assert.deepEqual(semNenhuma, { registros: [], total: 0, totalGeral: null });
  await listarPendencias(sb, { tamanho: 5000 });
  assert.equal(sb.chamadas.at(-1).p_limite, 20, 'tamanho fora da lista cai no padrão');
});

test('painel: quadro de pendências paginado no servidor com o componente padrão, filtro por motivo e contador real', () => {
  const painel = ler('pages/importacoes/index.js');
  assert.match(painel, /<PendenciasAbertas supabase=\{supabase\} versao=\{versaoPendencias\} \/>/);
  assert.doesNotMatch(painel, /listarPendencias|pendencias\.length/, 'o painel não carrega mais a lista inteira');
  const quadro = ler('components/importacoes/PendenciasAbertas.js');
  assert.match(quadro, /import Paginacao from '\.\.\/Paginacao'/);
  assert.match(quadro, /listarPendencias\(supabase, \{ motivo: motivo \|\| null, pagina, tamanho \}\)/);
  assert.match(quadro, /<Paginacao paginaAtual=\{info\.paginaAtual\} totalPaginas=\{info\.totalPaginas\} onMudarPagina=\{irPara\}/);
  assert.match(quadro, /TAMANHOS_PAGINA\.map/);
  assert.match(quadro, /textoContador\(info\)/);
  assert.match(quadro, /scrollIntoView\(\{ block: 'start'/);
  assert.match(quadro, /Object\.entries\(MOTIVOS\)/, 'filtro por motivo');
  assert.match(quadro, /Pendências abertas \(\$\{/, 'título com o total geral vindo do servidor');
});

test('migration final: uma única versão de g3_listar_lote e g3_listar_pendencias, paginadas, com contagem e ordem total; EXECUTAR idêntico', () => {
  const sql = ler('supabase/migrations/0081_importacoes_g3.sql');
  const defs = (nome) => sql.split(`create function public.${nome}(`).length - 1;
  assert.equal(defs('g3_listar_lote'), 1);
  assert.equal(defs('g3_listar_pendencias'), 1);
  assert.match(sql, /g3_listar_lote\(p_lote uuid, p_acao text default null, p_limite integer default 100, p_deslocamento integer default 0\)\nreturns table \(faceta text, chave text, data date, acao text, motivo text, detalhe jsonb, linhas integer\[\], valor numeric, total bigint\)/);
  assert.equal((sql.match(/order by x\.data nulls first, lpad\(x\.chave, 20, '0'\), x\.chave, x\.faceta, x\.acao/g) || []).length, 1, 'ordem total no lote confirmado');
  assert.equal((sql.match(/order by p\.data nulls first, lpad\(p\.chave, 20, '0'\), p\.chave, p\.faceta, p\.acao/g) || []).length, 1, 'ordem total na prévia');
  assert.match(sql, /returns table \(id bigint, lote_id uuid, layout text, faceta text, chave text, data date, motivo text,\n\s+detalhe jsonb, linhas integer\[\], valor numeric, total bigint, total_geral bigint\)/);
  assert.match(sql, /order by y\.data nulls first, y\.faceta, lpad\(y\.chave, 20, '0'\), y\.chave, y\.id/);
  assert.equal((sql.match(/least\(greatest\(coalesce\(p_limite, \d+\), 1\), 500\)/g) || []).length, 2, 'teto de 500 nas duas listas');
  assert.match(sql, /grant execute on function public\.g3_listar_lote\(uuid, text, integer, integer\) to authenticated;/);
  assert.match(sql, /grant execute on function public\.g3_listar_pendencias\(text, text, integer, integer\) to authenticated;/);
  const executar = join(RAIZ, '0081_importacoes_g3_EXECUTAR.sql');
  if (existsSync(executar)) assert.equal(readFileSync(executar, 'utf8'), sql, 'EXECUTAR byte-idêntico à migration');
});
