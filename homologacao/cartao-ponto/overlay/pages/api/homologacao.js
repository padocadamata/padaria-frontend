import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// HOMOLOGAÇÃO LOCAL -- "Supabase" falso da cópia temporária: um banco
// PGlite EM MEMÓRIA (no processo do next dev) com o stub do ambiente de
// testes + a migration 0078 REAL + dados fictícios (seed.sql). Nada sai da
// máquina. Reiniciar o next dev (ou "Recriar banco" em /homologacao) zera
// tudo. RPCs e tabelas folha_ponto_* rodam como o papel `authenticated`
// com o usuário escolhido (mesmas permissões, RLS e guardas da produção);
// tabelas de apoio (usuarios, perfil...) são lidas sem RLS e escritas
// fora do Cartão-Ponto (ex.: favoritos) são ignoradas.

const raiz = process.cwd();
const arquivo = (...p) => readFileSync(path.join(raiz, ...p), 'utf8');

async function criarBanco() {
  const modulo = pathToFileURL(path.join(raiz, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href;
  const importar = new Function('m', 'return import(m)');
  const { PGlite } = await importar(modulo);
  const db = new PGlite();
  await db.exec(arquivo('lib', 'ponto', '__tests__', 'sql', 'ambiente.sql'));
  await db.exec(arquivo('supabase', 'migrations', '0078_folha_cartao_ponto.sql'));
  await db.exec(arquivo('homologacao', 'cartao-ponto', 'seed.sql'));
  return db;
}

function banco({ recriar = false } = {}) {
  if (recriar || !globalThis.__bancoHomologacao) globalThis.__bancoHomologacao = criarBanco();
  return globalThis.__bancoHomologacao;
}

// Uma operação por vez (o papel/usuário da sessão é global no PGlite).
let fila = Promise.resolve();
function emFila(fn) {
  const r = fila.then(fn, fn);
  fila = r.catch(() => {});
  return r;
}

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`identificador inválido: ${s}`);
  return s;
};

async function comoUsuario(db, usuario, fn) {
  const uuid = usuario && /^[0-9a-f-]{36}$/i.test(usuario) ? usuario : '';
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uuid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const valorSql = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const erro = (e) => ({ data: null, error: { message: e.message, code: e.code } });

async function rpc(db, usuario, nome, args) {
  const chaves = Object.keys(args || {}).map(ident);
  try {
    const r = await comoUsuario(db, usuario, () => db.query(
      `select public.${ident(nome)}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, chaves.map((k) => valorSql(args[k]))));
    return { data: r.rows[0].r, error: null };
  } catch (e) {
    return erro(e);
  }
}

const OPERADORES = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
const MUTACOES = new Set(['insert', 'update', 'upsert', 'delete']);

async function tabela(db, usuario, nome, ops) {
  const doPonto = nome.startsWith('folha_ponto');
  if (ops.some(([op]) => MUTACOES.has(op))) {
    if (doPonto) return { data: null, error: { message: 'homologação: escrita direta bloqueada -- só pelas RPCs da 0078.', code: '42501' } };
    return { data: null, error: null };
  }
  let colunas = '*';
  const filtros = [];
  const params = [];
  const ordem = [];
  let limite = null;
  let um = false;
  for (const [op, a, b] of ops) {
    if (op === 'select') colunas = a || '*';
    else if (OPERADORES[op]) { params.push(b); filtros.push(`${ident(a)} ${OPERADORES[op]} $${params.length}`); }
    else if (op === 'in') { params.push(b); filtros.push(`${ident(a)} = any($${params.length})`); }
    else if (op === 'is') filtros.push(`${ident(a)} is ${b === null ? 'null' : b ? 'true' : 'false'}`);
    else if (op === 'order') ordem.push(`${ident(a)} ${b?.ascending === false ? 'desc' : 'asc'}`);
    else if (op === 'limit') limite = Number(a) || null;
    else if (op === 'maybeSingle' || op === 'single') um = true;
  }
  const sql = `select to_jsonb(x) as j from (select ${colunas} from public.${ident(nome)}`
    + `${filtros.length ? ` where ${filtros.join(' and ')}` : ''}${ordem.length ? ` order by ${ordem.join(', ')}` : ''}`
    + `${limite ? ` limit ${limite}` : ''}) x`;
  try {
    const executar = () => db.query(sql, params);
    const r = doPonto ? await comoUsuario(db, usuario, executar) : await executar();
    const linhas = r.rows.map((l) => l.j);
    return { data: um ? linhas[0] || null : linhas, error: null };
  } catch (e) {
    // Tabela de outro módulo (não existe no banco de homologação) ou
    // sintaxe de embed do PostgREST: devolve vazio, como uma lista sem dados.
    if (!doPonto) return { data: um ? null : [], error: null };
    return erro(e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'use POST' });
    return;
  }
  const { tipo, usuario, nome, args, tabela: nomeTabela, ops } = req.body || {};
  try {
    if (tipo === 'recriar') {
      await emFila(() => banco({ recriar: true }));
      res.json({ data: true, error: null });
      return;
    }
    const db = await banco();
    const resultado = await emFila(() => (tipo === 'rpc' ? rpc(db, usuario, nome, args) : tabela(db, usuario, nomeTabela, ops || [])));
    res.json(resultado);
  } catch (e) {
    res.json(erro(e));
  }
}
