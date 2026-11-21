// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/importacoes/__tests__/*.test.mjs
// Envio em blocos, impressão digital e tratamento de erros (Supabase falso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSha256, dividirEmBlocos, enviarImportacao, ErroEnvio, TAMANHO_BLOCO } from '../envio.js';
import { mensagemDeErro, contagensDoResumo, formatarData, formatarBytes, somarDias } from '../consultas.js';

test('sha256 (vetor conhecido) e divisão em blocos de 2000 linhas com início 1-based', async () => {
  assert.equal(await calcularSha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const linhas = Array.from({ length: 4500 }, (_, i) => [i]);
  const blocos = dividirEmBlocos(linhas);
  assert.equal(TAMANHO_BLOCO, 2000);
  assert.deepEqual(blocos.map((b) => [b.inicio, b.linhas.length]), [[1, 2000], [2001, 2000], [4001, 500]]);
  assert.deepEqual(blocos[1].linhas[0], [2000]);
});

function supabaseFalso(roteiro) {
  const chamadas = [];
  return {
    chamadas,
    async rpc(nome, args) {
      chamadas.push([nome, args]);
      const r = roteiro(nome, args, chamadas);
      return r instanceof Promise ? r : r;
    },
  };
}

const ARQ = { nome: 'faturamento.xlsx', tamanho: 123, sha256: 'a'.repeat(64) };
const META = { abas: 1, formulas: 0, macros: false, original: true, produtor: 'SheetJS', textosCompartilhados: false };

test('fluxo: iniciar -> blocos -> prévia; repete bloco em falha de rede; progresso informado', async () => {
  let falhas = 1;
  const sb = supabaseFalso((nome, args) => {
    if (nome === 'g3_iniciar_importacao') return { data: 'lote-1', error: null };
    if (nome === 'g3_enviar_linhas') {
      if (args.p_inicio === 2001 && falhas-- > 0) return { data: null, error: { message: 'Failed to fetch', code: '' } };
      return { data: args.p_inicio + args.p_linhas.length - 1, error: null };
    }
    if (nome === 'g3_gerar_previa') return { data: { status: 'previa' }, error: null };
    throw new Error(nome);
  });
  const linhas = Array.from({ length: 4100 }, (_, i) => ['L', i]);
  const progresso = [];
  const r = await enviarImportacao(sb, { layout: 'faturamento_geral', arquivo: ARQ, metadados: META, linhas, mascarados: 2, aoProgredir: (p) => progresso.push(p.etapa + ':' + p.enviadas) });
  assert.deepEqual(r, { id: 'lote-1', previa: { status: 'previa' } });
  assert.deepEqual(sb.chamadas.map((c) => c[0] + (c[1].p_inicio ? '@' + c[1].p_inicio : '')),
    ['g3_iniciar_importacao', 'g3_enviar_linhas@1', 'g3_enviar_linhas@2001', 'g3_enviar_linhas@2001', 'g3_enviar_linhas@4001', 'g3_gerar_previa']);
  assert.equal(sb.chamadas[0][1].p_linhas_total, 4100);
  assert.equal(sb.chamadas[0][1].p_metadados.clientes_mascarados, 2);
  assert.deepEqual(progresso, ['iniciando:0', 'enviando:2000', 'enviando:4000', 'enviando:4100', 'previa:4100']);
});

test('erro de regra (dados pessoais, acesso) não é repetido e chega com a mensagem do servidor', async () => {
  const sb = supabaseFalso((nome) => {
    if (nome === 'g3_iniciar_importacao') return { data: 'lote-2', error: null };
    return { data: null, error: { code: '22023', message: 'Linha 7: dado pessoal de cliente detectado.' } };
  });
  await assert.rejects(
    enviarImportacao(sb, { layout: 'faturamento_geral', arquivo: ARQ, metadados: META, linhas: [['x']] }),
    (e) => e instanceof ErroEnvio && /dado pessoal/.test(e.message)
  );
  assert.equal(sb.chamadas.filter((c) => c[0] === 'g3_enviar_linhas').length, 1);
});

test('mensagens: migration ausente, acesso negado, rede; formatações', () => {
  assert.match(mensagemDeErro({ code: 'PGRST202', message: 'Could not find the function public.g3_cobertura' }), /ainda não está instalada/);
  assert.match(mensagemDeErro({ code: '42501', message: 'Acesso restrito ao perfil proprietario_admin.' }), /Acesso restrito/);
  assert.match(mensagemDeErro({ message: 'TypeError: Failed to fetch' }), /conexão/);
  assert.equal(mensagemDeErro({ code: '22023', message: 'Previa desatualizada' }), 'Previa desatualizada');
  assert.deepEqual(contagensDoResumo({ por_acao: { igual: 3, nova: 1, ausente: 2 } }).map((x) => x.acao), ['nova', 'igual', 'ausente']);
  assert.equal(formatarData('2026-06-03'), '03/06/2026');
  assert.equal(formatarBytes(3.5 * 1024 * 1024), '3,5 MB');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
});
