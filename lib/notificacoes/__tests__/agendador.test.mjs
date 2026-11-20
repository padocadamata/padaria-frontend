// node --test lib/notificacoes/__tests__/*.test.mjs
// Documento/janela/timers/relógio falsos -- nenhum navegador real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAgendadorNotificacoes, INTERVALO_PADRAO_MS } from '../agendador.js';

function ambiente({ visivel = true } = {}) {
  const ouvintes = { doc: {}, win: {} };
  const alvo = (mapa) => ({
    addEventListener: (ev, fn) => ((mapa[ev] ||= new Set()).add(fn)),
    removeEventListener: (ev, fn) => mapa[ev]?.delete(fn),
  });
  const documento = { visibilityState: visivel ? 'visible' : 'hidden', ...alvo(ouvintes.doc) };
  const janela = alvo(ouvintes.win);
  const timers = new Map();
  let proximo = 1;
  let relogio = 0;
  return {
    documento,
    janela,
    agendar: (fn, ms) => {
      const id = proximo++;
      timers.set(id, { fn, ms });
      return id;
    },
    cancelar: (id) => timers.delete(id),
    agora: () => relogio,
    avancar: (ms) => {
      relogio += ms;
    },
    async tick() {
      for (const { fn } of [...timers.values()]) fn();
      await new Promise((r) => setImmediate(r));
    },
    disparar: async (onde, ev) => {
      for (const fn of [...(ouvintes[onde][ev] || [])]) fn();
      await new Promise((r) => setImmediate(r));
    },
    ocultar() {
      documento.visibilityState = 'hidden';
    },
    mostrar() {
      documento.visibilityState = 'visible';
    },
    timers,
    ouvintes,
  };
}

const esperar = () => new Promise((r) => setImmediate(r));

function novo(amb, atualizar) {
  return criarAgendadorNotificacoes({
    atualizar,
    documento: amb.documento,
    janela: amb.janela,
    agendar: amb.agendar,
    cancelar: amb.cancelar,
    agora: amb.agora,
  });
}

test('intervalo padrão é 60 s', () => {
  assert.equal(INTERVALO_PADRAO_MS, 60_000);
});

test('aba visível: atualiza ao iniciar e a cada tick do intervalo', async () => {
  const amb = ambiente();
  let chamadas = 0;
  const ag = novo(amb, async () => chamadas++);
  ag.iniciar();
  await esperar();
  assert.equal(chamadas, 1);
  assert.equal([...amb.timers.values()][0].ms, 60_000);
  amb.avancar(60_000);
  await amb.tick();
  assert.equal(chamadas, 2);
  amb.avancar(60_000);
  await amb.tick();
  assert.equal(chamadas, 3);
  ag.parar();
});

test('aba em segundo plano: timer desligado, nenhuma requisição; ao voltar atualiza na hora', async () => {
  const amb = ambiente();
  let chamadas = 0;
  const ag = novo(amb, async () => chamadas++);
  ag.iniciar();
  await esperar();
  amb.ocultar();
  await amb.disparar('doc', 'visibilitychange');
  assert.equal(ag.timerLigado, false);
  assert.equal(amb.timers.size, 0);
  amb.avancar(10 * 60_000);
  await amb.tick();
  assert.equal(chamadas, 1, 'nada enquanto oculta');

  amb.mostrar();
  await amb.disparar('doc', 'visibilitychange');
  assert.equal(chamadas, 2, 'voltou: atualiza na hora');
  assert.equal(ag.timerLigado, true);
  ag.parar();
});

test('iniciar com a aba oculta não faz requisição até ficar visível', async () => {
  const amb = ambiente({ visivel: false });
  let chamadas = 0;
  const ag = novo(amb, async () => chamadas++);
  ag.iniciar();
  await esperar();
  assert.equal(chamadas, 0);
  assert.equal(ag.timerLigado, false);
  amb.mostrar();
  await amb.disparar('doc', 'visibilitychange');
  assert.equal(chamadas, 1);
  ag.parar();
});

test('focus e pageshow (reabrir o app) atualizam, sem duplicar quando disparam juntos', async () => {
  const amb = ambiente();
  let chamadas = 0;
  const ag = novo(amb, async () => chamadas++);
  ag.iniciar();
  await esperar();
  amb.avancar(30_000);
  await amb.disparar('win', 'focus');
  await amb.disparar('doc', 'visibilitychange');
  await amb.disparar('win', 'pageshow');
  assert.equal(chamadas, 2, 'um único refresh para a rajada de eventos');
  amb.avancar(30_000);
  await amb.disparar('win', 'pageshow');
  assert.equal(chamadas, 3);
  ag.parar();
});

test('forcar() ignora o intervalo mínimo; nunca 2 em paralelo; forçado durante outra roda de novo depois', async () => {
  const amb = ambiente();
  let chamadas = 0;
  let liberar;
  const ag = novo(amb, () => {
    chamadas++;
    return new Promise((r) => {
      liberar = r;
    });
  });
  ag.iniciar(); // 1ª em andamento (não resolvida)
  await esperar();
  assert.equal(chamadas, 1);
  const forcada = ag.forcar(); // chega durante a 1ª
  await esperar();
  assert.equal(chamadas, 1, 'não roda em paralelo');
  liberar();
  await forcada;
  await esperar();
  assert.equal(chamadas, 2, 'a forçada roda logo depois da que estava em curso');
  liberar(); // conclui a 2ª
  await esperar();
  const terceira = ag.forcar();
  await esperar();
  assert.equal(chamadas, 3, 'forçada ignora o intervalo mínimo');
  liberar();
  assert.equal(await terceira, true);
  ag.parar();
});

test('erro em atualizar() não derruba o agendador', async () => {
  const amb = ambiente();
  let chamadas = 0;
  const ag = novo(amb, async () => {
    chamadas++;
    throw new Error('rede caiu');
  });
  ag.iniciar();
  await esperar();
  amb.avancar(60_000);
  await amb.tick();
  assert.equal(chamadas, 2);
  ag.parar();
});

test('parar() remove timer e ouvintes; nada mais é chamado', async () => {
  const amb = ambiente();
  let chamadas = 0;
  const ag = novo(amb, async () => chamadas++);
  ag.iniciar();
  await esperar();
  ag.parar();
  assert.equal(amb.timers.size, 0);
  assert.equal(amb.ouvintes.doc.visibilitychange.size, 0);
  assert.equal(amb.ouvintes.win.focus.size, 0);
  assert.equal(amb.ouvintes.win.pageshow.size, 0);
  amb.avancar(120_000);
  await amb.disparar('win', 'focus');
  assert.equal(await ag.forcar(), false);
  assert.equal(chamadas, 1);
});
