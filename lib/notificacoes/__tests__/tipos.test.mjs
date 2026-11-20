// node --test lib/notificacoes/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataHoraNotificacao,
  ehUuid,
  iconeDaNotificacao,
  linkDaNotificacao,
  rotuloAcessivelDoSino,
  rotuloDoTipo,
  situacaoDaPendencia,
  textoContador,
  textoResolucao,
  TIPOS_NOTIFICACAO,
} from '../tipos.js';

const ID = '3f2b8c1e-9a4d-4c2b-8e7f-1a2b3c4d5e6f';

test('link da solicitação aponta para /pedidos/solicitacoes?id=<uuid>', () => {
  assert.equal(linkDaNotificacao({ tipo: 'pedidos_solicitacoes.criada', registro_id: ID }), `/pedidos/solicitacoes?id=${ID}`);
});

test('link: registro_id inválido, tipo desconhecido ou ausente -> sem link (nunca URL arbitrária)', () => {
  assert.equal(linkDaNotificacao({ tipo: 'pedidos_solicitacoes.criada', registro_id: 'javascript:alert(1)' }), null);
  assert.equal(linkDaNotificacao({ tipo: 'pedidos_solicitacoes.criada', registro_id: `${ID}&x=1` }), null);
  assert.equal(linkDaNotificacao({ tipo: 'pedidos_solicitacoes.criada', registro_id: null }), null);
  assert.equal(linkDaNotificacao({ tipo: 'g3.importacao_concluida', registro_id: ID }), null);
  assert.equal(linkDaNotificacao(null), null);
  assert.equal(linkDaNotificacao({}), null);
});

test('link: um tipo que tentasse devolver URL externa é bloqueado', () => {
  TIPOS_NOTIFICACAO['teste.externo'] = { link: () => '//evil.example/x' };
  TIPOS_NOTIFICACAO['teste.absoluto'] = { link: () => 'https://evil.example/x' };
  try {
    assert.equal(linkDaNotificacao({ tipo: 'teste.externo', registro_id: ID }), null);
    assert.equal(linkDaNotificacao({ tipo: 'teste.absoluto', registro_id: ID }), null);
  } finally {
    delete TIPOS_NOTIFICACAO['teste.externo'];
    delete TIPOS_NOTIFICACAO['teste.absoluto'];
  }
});

test('tipo desconhecido continua exibível (ícone e rótulo genéricos)', () => {
  assert.equal(iconeDaNotificacao({ tipo: 'algo.novo' }), 'bell');
  assert.equal(rotuloDoTipo({ tipo: 'algo.novo' }), 'Notificação');
  assert.equal(iconeDaNotificacao({ tipo: 'pedidos_solicitacoes.criada' }), 'package');
  assert.equal(rotuloDoTipo({ tipo: 'pedidos_solicitacoes.criada' }), 'Solicitação de produto');
});

test('ehUuid', () => {
  assert.equal(ehUuid(ID), true);
  assert.equal(ehUuid(ID.toUpperCase()), true);
  assert.equal(ehUuid('123'), false);
  assert.equal(ehUuid(undefined), false);
});

test('contador compacto do sino', () => {
  assert.equal(textoContador(0), '');
  assert.equal(textoContador(-3), '');
  assert.equal(textoContador(undefined), '');
  assert.equal(textoContador(1), '1');
  assert.equal(textoContador(99), '99');
  assert.equal(textoContador(100), '99+');
  assert.equal(textoContador(5000), '99+');
});

test('rótulo acessível do sino', () => {
  assert.equal(rotuloAcessivelDoSino(0), 'Notificações');
  assert.equal(rotuloAcessivelDoSino(1), 'Notificações, 1 não lida');
  assert.equal(rotuloAcessivelDoSino(7), 'Notificações, 7 não lidas');
  assert.equal(rotuloAcessivelDoSino(250), 'Notificações, mais de 99 não lidas');
});

test('situação da pendência', () => {
  assert.deepEqual(situacaoDaPendencia('aberta'), { texto: 'Pendente', tom: 'warning' });
  assert.deepEqual(situacaoDaPendencia('resolvida'), { texto: 'Resolvida', tom: 'success' });
  assert.deepEqual(situacaoDaPendencia('descartada'), { texto: 'Descartada', tom: 'neutral' });
  assert.equal(situacaoDaPendencia(null), null);
});

test('data e hora sempre no fuso de São Paulo', () => {
  // 17:05 UTC = 14:05 em São Paulo (UTC-3).
  assert.equal(dataHoraNotificacao('2026-11-20T17:05:00Z'), '20/11/2026 às 14:05');
  // Virada do dia: 01:30 UTC do dia 21 ainda é dia 20 em São Paulo.
  assert.equal(dataHoraNotificacao('2026-11-21T01:30:00Z'), '20/11/2026 às 22:30');
  assert.equal(dataHoraNotificacao(null), '');
  assert.equal(dataHoraNotificacao('não é data'), '');
});

test('texto de resolução', () => {
  assert.equal(
    textoResolucao({ pendencia_status: 'resolvida', resolvida_por_nome: 'Ana', resolvida_em: '2026-11-20T17:05:00Z' }),
    'Resolvida por Ana em 20/11/2026 às 14:05'
  );
  assert.equal(textoResolucao({ pendencia_status: 'descartada', resolvida_em: '2026-11-20T17:05:00Z' }), 'Descartada em 20/11/2026 às 14:05');
  assert.equal(textoResolucao({ pendencia_status: 'aberta' }), '');
  assert.equal(textoResolucao({ pendencia_status: null }), '');
});
