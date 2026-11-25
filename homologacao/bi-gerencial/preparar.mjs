#!/usr/bin/env node
// HOMOLOGAÇÃO LOCAL DO BI GERENCIAL -- prepara uma CÓPIA
// TEMPORÁRIA do sistema que roda as telas reais contra um banco PGlite em
// memória (migrations REAIS até a 0084 + vendas fictícias). Não gera
// arquivos. Nenhuma conexão com o Supabase. O
// repositório de origem NÃO é alterado: tudo acontece na cópia.
//
//   node homologacao/bi-gerencial/preparar.mjs [pasta-destino] [--iniciar] [--porta=3919]
//
// Depois: abrir http://localhost:3919/homologacao (com --iniciar o servidor
// já sobe; sem ele: cd <destino> && npx next dev -p 3919).

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSAO_PGLITE = '0.5.17'; // a mesma usada nos testes automatizados (0081 a 0084)
const aqui = path.dirname(fileURLToPath(import.meta.url));
const origem = path.resolve(aqui, '..', '..');
const args = process.argv.slice(2);
const destino = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(os.tmpdir(), 'padoca-homologacao-bi'));
const porta = (args.find((a) => a.startsWith('--porta=')) || '--porta=3919').split('=')[1];

function falhar(msg) {
  console.error(`\n[homologação] ${msg}`);
  process.exit(1);
}

if (destino === origem || destino.startsWith(origem + path.sep)) falhar('o destino precisa ficar FORA do repositório.');
for (const necessario of ['supabase/migrations/0084_bi_complementar.sql', 'supabase/tests/ambiente_pedidos.mjs', 'pages/bi.js', 'vendor/xlsx-0.20.3.tgz']) {
  if (!existsSync(path.join(origem, necessario))) falhar(`arquivo esperado não encontrado na origem: ${necessario}`);
}

console.log(`[homologação] origem:  ${origem}`);
console.log(`[homologação] destino: ${destino}`);
mkdirSync(destino, { recursive: true });

// 1. Cópia do código (sem node_modules, .next, .git, .env* e SQLs avulsos da raiz).
const ignorar = new Set(['node_modules', '.next', '.git', '.claude', '.vercel']);
cpSync(origem, destino, {
  recursive: true,
  force: true,
  filter: (fonte) => {
    const rel = path.relative(origem, fonte);
    if (!rel) return true;
    const partes = rel.split(path.sep);
    if (partes.some((p) => ignorar.has(p))) return false;
    if (partes.length === 1 && (/^\.env/.test(partes[0]) || /\.sql$/i.test(partes[0]))) return false;
    return true;
  },
});

// 2. Sobreposição de homologação (cliente Supabase falso, API local, painel).
cpSync(path.join(aqui, 'overlay'), destino, { recursive: true, force: true });

// 3. Faixa fixa "HOMOLOGAÇÃO LOCAL" em todas as telas da cópia.
const caminhoApp = path.join(destino, 'pages', '_app.js');
const app = readFileSync(caminhoApp, 'utf8');
const alvo = '<Component {...pageProps} />';
if (!app.includes(alvo)) falhar('pages/_app.js mudou: não encontrei onde inserir a faixa de homologação.');
if (!app.includes('HOMOLOGAÇÃO LOCAL')) {
  const faixa = '<div style={{ position: \'fixed\', top: 0, left: 0, right: 0, zIndex: 99999, background: \'#b45309\', color: \'#fff\', font: \'600 12px system-ui, sans-serif\', textAlign: \'center\', padding: \'2px 8px\', pointerEvents: \'none\' }}>HOMOLOGAÇÃO LOCAL — dados fictícios, sem conexão com o Supabase</div>';
  writeFileSync(caminhoApp, app.replace(alvo, `<>${faixa}${alvo}</>`));
}

// 4. Variáveis FICTÍCIAS (o cliente falso nem as usa; garantem que nada aponte para produção).
writeFileSync(path.join(destino, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL=https://homologacao.invalid\nNEXT_PUBLIC_SUPABASE_KEY=homologacao-sem-chave\n');

// 5. Dependências da cópia (+ PGlite, só nela).
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function rodar(cmd, lista) {
  const r = spawnSync(cmd, lista, { cwd: destino, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) falhar(`falhou: ${cmd} ${lista.join(' ')}`);
}
if (!existsSync(path.join(destino, 'node_modules', 'next', 'package.json'))) {
  console.log('[homologação] instalando dependências na cópia (pode levar alguns minutos)…');
  rodar(npm, ['install', '--no-audit', '--no-fund']);
}
if (!existsSync(path.join(destino, 'node_modules', '@electric-sql', 'pglite', 'package.json'))) {
  rodar(npm, ['install', '--no-save', '--no-audit', '--no-fund', `@electric-sql/pglite@${VERSAO_PGLITE}`]);
}

// 6. Banco fictício (retrato carregado pela API local).
// (via "node" do PATH: o caminho do executável pode ter espaços, ex.: C:\Program Files)
rodar('node', [path.join('homologacao', 'bi-gerencial', 'montar-banco.mjs')]);

console.log('\n[homologação] pronto.');
console.log(`  Iniciar:  cd "${destino}" && npx next dev -p ${porta}`);
console.log(`  Abrir:    http://localhost:${porta}/homologacao\n`);

if (args.includes('--iniciar')) rodar(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', porta]);
