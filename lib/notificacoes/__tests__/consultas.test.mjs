// node --test lib/notificacoes/__tests__/*.test.mjs
// Cliente Supabase falso -- nenhuma chamada real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarLeituraLocal,
  contarNaoLidas,
  listarNotificacoes,
  marcarComoLidas,
  marcarTodasComoLidas,
  TAMANHO_PAGINA,
} from '../consultas.js';

function clienteFalso(respostas = {}) {
  const chamadas = [];
  return {
    chamadas,
    rpc: async (nome, args) => {
      chamadas.push({ nome, args });
      const r = respostas[nome];
      return typeof r === 'function' ? r(args) : r ?? { data: null, error: null };
    },
  };
}

test('contarNaoLidas usa a RPC notificacoes_contar_nao_lidas', async () => {
  const c = clienteFalso({ notificacoes_contar_nao_lidas: { data: 4, error: null } });
  assert.equal(await contarNaoLidas(c), 4);
  assert.deepEqual(c.chamadas, [{ nome: 'notificacoes_contar_nao_lidas', args: undefined }]);
});

test('erro da RPC vira exceção com o erro original em .causa (código preservado)', async () => {
  const c = clienteFalso({ notificacoes_contar_nao_lidas: { data: null, error: { code: 'PGRST202', message: 'not found' } } });
  await assert.rejects(contarNaoLidas(c), (e) => e.causa.code === 'PGRST202');
});

test('listarNotificacoes: primeira página e cursor', async () => {
  const c = clienteFalso({ notificacoes_listar: { data: [{ id: 'a' }], error: null } });
  await listarNotificacoes(c);
  assert.deepEqual(c.chamadas[0], {
    nome: 'notificacoes_listar',
    args: { p_limite: TAMANHO_PAGINA, p_antes_em: null, p_antes_id: null, p_leitura: 'todas', p_somente_pendencias_abertas: false },
  });
  await listarNotificacoes(c, { limite: 5, cursor: { criado_em: 'T', id: 'x' }, leitura: 'nao_lidas', somentePendenciasAbertas: true });
  assert.deepEqual(c.chamadas[1].args, {
    p_limite: 5, p_antes_em: 'T', p_antes_id: 'x', p_leitura: 'nao_lidas', p_somente_pendencias_abertas: true,
  });
});

test('marcarComoLidas: remove vazios/duplicados e não chama o banco com lista vazia', async () => {
  const c = clienteFalso({ notificacoes_marcar_lidas: { data: 2, error: null } });
  assert.equal(await marcarComoLidas(c, []), 0);
  assert.equal(await marcarComoLidas(c, [null, undefined]), 0);
  assert.equal(c.chamadas.length, 0);
  assert.equal(await marcarComoLidas(c, ['a', 'a', 'b', null]), 2);
  assert.deepEqual(c.chamadas[0].args, { p_ids: ['a', 'b'] });
});

test('marcarTodasComoLidas', async () => {
  const c = clienteFalso({ notificacoes_marcar_todas_lidas: { data: 3, error: null } });
  assert.equal(await marcarTodasComoLidas(c), 3);
});

test('aplicarLeituraLocal: marca só as indicadas, preserva as já lidas e devolve a mesma lista se nada mudou', () => {
  const lista = [{ id: 'a', lida_em: null }, { id: 'b', lida_em: '2026-01-01' }, { id: 'c', lida_em: null }];
  const nova = aplicarLeituraLocal(lista, ['a', 'b'], 'AGORA');
  assert.deepEqual(nova.map((n) => n.lida_em), ['AGORA', '2026-01-01', null]);
  assert.equal(lista[0].lida_em, null, 'não muta a original');
  assert.equal(aplicarLeituraLocal(lista, ['b']), lista);
  assert.equal(aplicarLeituraLocal(lista, ['zzz']), lista);
});
