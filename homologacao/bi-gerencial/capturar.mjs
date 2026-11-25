#!/usr/bin/env node
// HOMOLOGAÇÃO LOCAL DO BI -- capturas e conferências automáticas da página
// /bi rodando na cópia de homologação (dados fictícios). Usa o Chrome
// instalado via DevTools Protocol (sem dependências): navega, rola a página
// para o carregamento progressivo, espera as consultas terminarem e grava
// capturas inteiras (desktop 1440 px e celular 390 px), além de um relatório
// JSON com: erros de console, transbordo horizontal, blocos com erro e
// estados de carregamento pendentes.
//
//   node homologacao/bi-gerencial/capturar.mjs --url=http://localhost:3919 --saida=<pasta> [--chrome=<caminho>] [--cenario=nome:/bi?..]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.join('=')]));
const BASE = args.url || 'http://localhost:3919';
const SAIDA = path.resolve(args.saida || 'capturas-bi');
const CHROME = args.chrome || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => existsSync(c));
mkdirSync(SAIDA, { recursive: true });

const PORTA = 9300 + Math.floor(Math.random() * 500);
const perfil = mkdtempSync(path.join(os.tmpdir(), 'bi-chrome-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORTA}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${perfil}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function alvo() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json();
      const p = lista.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch {
      /* ainda subindo */
    }
    await esperar(500);
  }
  throw new Error('Chrome não respondeu');
}

const ws = new WebSocket(await alvo());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pendentes = new Map();
const consoleErros = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendentes.has(m.id)) {
    pendentes.get(m.id)(m);
    pendentes.delete(m.id);
  } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    consoleErros.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleErros.push(`exception: ${(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text}`.slice(0, 600));
  }
});
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1;
    pendentes.set(seq, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
const avaliar = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await cdp('Page.enable');
const PASTA_DOWNLOADS = path.join(SAIDA, 'downloads');
mkdirSync(PASTA_DOWNLOADS, { recursive: true });
await cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: PASTA_DOWNLOADS });
await cdp('Runtime.enable');

async function carregar(url, largura, altura, movel) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: movel });
  await cdp('Page.navigate', { url: 'about:blank' });
  await cdp('Page.navigate', { url });
  // espera o painel e rola até o fim (carregamento progressivo), devagar
  for (let i = 0; i < 120; i += 1) {
    if (await avaliar(`!!document.querySelector('[data-bloco]')`)) break;
    await esperar(500);
  }
  const t0 = Date.now();
  let ultimaAltura = 0;
  for (let passo = 0; passo < 40; passo += 1) {
    const h = await avaliar('document.documentElement.scrollHeight');
    await avaliar(`window.scrollTo(0, ${Math.min(h, (passo + 1) * altura * 0.8)})`);
    await esperar(700);
    if ((passo + 1) * altura * 0.8 >= h && h === ultimaAltura) break;
    ultimaAltura = h;
  }
  for (let i = 0; i < 240; i += 1) {
    const ocupado = await avaliar(`document.querySelectorAll('[aria-busy="true"]').length`);
    if (!ocupado) break;
    await esperar(500);
  }
  const tempo = Date.now() - t0;
  await avaliar('window.scrollTo(0, 0)');
  await esperar(800);
  return tempo;
}

async function conferir() {
  return avaliar(`(() => {
    const largura = document.documentElement.clientWidth;
    const transborda = document.documentElement.scrollWidth > largura + 1;
    const largos = [];
    if (transborda) document.querySelectorAll('body *').forEach((e) => { const b = e.getBoundingClientRect(); if (b.right > largura + 1 && b.width > 0 && !e.closest('[class*="rolagemX"],[class*="mapa"]')) largos.push(e.tagName + '.' + String(e.className).slice(0, 40)); });
    return {
      largura, scrollWidth: document.documentElement.scrollWidth, transborda, largos: largos.slice(0, 10),
      blocos: [...document.querySelectorAll('[data-bloco]')].map((b) => b.getAttribute('data-bloco')),
      erros: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim().slice(0, 200)),
      carregando: document.querySelectorAll('[aria-busy="true"]').length,
      graficos: [...document.querySelectorAll('[class*="grafico"], [class*="spark"]')].slice(0, 8).map((g) => ({ cls: String(g.className).slice(0, 30), w: Math.round(g.getBoundingClientRect().width), svg: g.querySelector('svg') ? g.querySelector('svg').getAttribute('width') + '/' + getComputedStyle(g.querySelector('svg')).width + '/' + (g.querySelector('.recharts-cartesian-axis-tick') ? g.querySelector('.recharts-cartesian-axis-tick').getAttribute('transform') || '' : '') + '/' + [...g.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')].slice(0,3).map((t) => t.getAttribute('x')).join(',') : null, pai: Math.round(g.parentElement.getBoundingClientRect().width) })),
      menu: [...document.querySelectorAll('nav a, aside a')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 30),
    };
  })()`);
}

async function capturar(nome, largura, movel) {
  const m = await cdp('Page.getLayoutMetrics');
  const altura = Math.ceil(m.cssContentSize ? m.cssContentSize.height : m.contentSize.height);
  // Sem redimensionar a janela (redimensionar faz os gráficos se remedirem
  // no meio da captura): captura além da área visível com recorte.
  await esperar(600);
  // Janela já do tamanho da página (definido no carregamento): captura direta.
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SAIDA, `${nome}.png`), Buffer.from(data, 'base64'));
  return altura;
}

let cenarios;
if (args.roteiro) {
  const { ROTEIRO } = await import(new URL('./roteiro.mjs', import.meta.url).href);
  cenarios = ROTEIRO.filter((c) => args.roteiro === 'todos' || args.roteiro.split(',').some((n) => c.nome.startsWith(n)));
} else {
  cenarios = (args.cenario ? args.cenario.split(',') : ['desktop:/bi|1440|4500|0', 'celular:/bi|390|11500|1']).map((c) => {
    const [nome, resto] = c.split(':');
    const [rota, largura, altura, movel] = resto.split('|');
    return { nome, rota, largura: Number(largura || 1440), altura: Number(altura || 900), movel: movel === '1' };
  });
}

const esperarOcioso = async () => {
  await esperar(600);
  for (let i = 0; i < 240; i += 1) {
    if (!(await avaliar(`document.querySelectorAll('[aria-busy="true"]').length`))) break;
    await esperar(500);
  }
  await esperar(500);
};

const relatorio = {};
let falhasTotais = 0;
for (const c of cenarios) {
  consoleErros.length = 0;
  if (c.antes) {
    await carregar(`${BASE}/homologacao`, c.largura, c.altura, !!c.movel);
    await avaliar(c.antes);
  }
  const tempo = await carregar(`${BASE}${c.rota}`, c.largura, c.altura, !!c.movel);
  if (c.acao) {
    await avaliar(`(async () => { ${c.acao}; })()`);
    await esperarOcioso();
  }
  const conf = await conferir();
  const falhas = c.conferir ? await avaliar(c.conferir) : [];
  for (const arq of c.downloads || []) if (!existsSync(path.join(PASTA_DOWNLOADS, arq))) falhas.push(`download ausente: ${arq}`);
  falhasTotais += (falhas || []).length;
  const altura = await capturar(c.nome, c.largura, !!c.movel);
  // recortes: { sufixo: seletor } -> PNG só daquele elemento (janela já na
  // altura da página, então o recorte usa as coordenadas do documento).
  for (const [sufixo, seletor] of Object.entries(c.recortes || {})) {
    const caixa = await avaliar(`(() => { const e = document.querySelector(${JSON.stringify(seletor)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; })()`);
    if (!caixa) {
      falhas.push(`recorte ausente: ${seletor}`);
      continue;
    }
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { ...caixa, scale: 1 } });
    writeFileSync(path.join(SAIDA, `${c.nome}_${sufixo}.png`), Buffer.from(data, 'base64'));
  }
  if (c.depois) await avaliar(c.depois);
  // Próximo cenário = novo login simulado (filtros persistidos zerados),
  // salvo quando o cenário pede para manter a sessão (teste de persistência).
  if (!c.manterSessao) await avaliar(`localStorage.removeItem('homologacao.sessao')`);
  relatorio[c.nome] = { rota: c.rota, tempoAteOcioso_ms: tempo, alturaPagina: altura, falhas, ...conf, console: [...consoleErros] };
  console.log(`[captura] ${c.nome}: ${tempo} ms, ${conf.blocos.length} blocos, falhas=${JSON.stringify(falhas)}, erros=${conf.erros.filter(Boolean).length}, transborda=${conf.transborda}, console=${consoleErros.length}`);
}
writeFileSync(path.join(SAIDA, 'relatorio.json'), JSON.stringify(relatorio, null, 2));
ws.close();
chrome.kill();
process.exitCode = falhasTotais ? 1 : 0;
