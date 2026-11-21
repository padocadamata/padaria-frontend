import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// HOMOLOGAÇÃO LOCAL -- "Supabase" falso da cópia temporária: um banco
// PGlite EM MEMÓRIA (no processo do next dev) carregado do retrato montado
// por homologacao/importacoes-g3/montar-banco.mjs (migrations REAIS até a
// 0081 + usuários fictícios). Nada sai da máquina. RPCs e tabelas g3_*
// rodam como o papel `authenticated` com o usuário escolhido (mesmas RLS,
// grants e guardas da produção); tabelas de apoio (usuarios, permissões...)
// são lidas sem RLS e escritas fora da Central são ignoradas.

const raiz = process.cwd();
const RETRATO = path.join(raiz, 'homologacao', 'importacoes-g3', 'banco.retrato');

async function criarBanco() {
  const modulo = pathToFileURL(path.join(raiz, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href;
  const importar = new Function('m', 'return import(m)');
  const { PGlite } = await importar(modulo);
  const db = new PGlite({ loadDataDir: new Blob([readFileSync(RETRATO)]) });
  await db.waitReady;
  return db;
}

function banco({ recriar = false } = {}) {
  if (recriar || !globalThis.__bancoHomologacaoG3) globalThis.__bancoHomologacaoG3 = criarBanco();
  return globalThis.__bancoHomologacaoG3;
}

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
  await db.exec(`set role authenticated; select set_config('teste.uid', '${uuid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('teste.uid', '', false);`);
  }
}

const valorSql = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const erro = (e) => ({ data: null, error: { message: e.message, code: e.code } });

// RPCs que devolvem linhas (as demais devolvem um valor só).
const FUNCOES_DE_TABELA = new Set(['g3_listar_lote', 'g3_listar_pendencias', 'g3_cobertura', 'g3_conciliacao_diaria', 'g3_espaco_ocupado']);

async function rpc(db, usuario, nome, args) {
  if (!nome.startsWith('g3_')) return { data: null, error: null }; // registrar_acesso etc.
  const chaves = Object.keys(args || {}).map(ident);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const deTabela = FUNCOES_DE_TABELA.has(nome);
  const sql = deTabela
    ? `select to_jsonb(r) as r from public.${ident(nome)}(${lista}) r`
    : `select public.${ident(nome)}(${lista}) as r`;
  try {
    const resultado = await comoUsuario(db, usuario, () => db.query(sql, chaves.map((k) => valorSql(args[k]))));
    const valores = resultado.rows.map((l) => l.r);
    return { data: deTabela ? valores : valores[0] ?? null, error: null };
  } catch (e) {
    return erro(e);
  }
}

const OPERADORES = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
const MUTACOES = new Set(['insert', 'update', 'upsert', 'delete']);

async function tabela(db, usuario, nome, ops) {
  const daCentral = nome.startsWith('g3_');
  if (ops.some(([op]) => MUTACOES.has(op))) {
    if (daCentral) return { data: null, error: { message: 'homologação: escrita direta bloqueada -- só pelas RPCs da 0081.', code: '42501' } };
    return { data: null, error: null };
  }
  let colunas = '*';
  const filtros = [];
  const params = [];
  const ordem = [];
  let limite = null;
  let deslocamento = null;
  let um = false;
  for (const [op, a, b] of ops) {
    if (op === 'select') colunas = a || '*';
    else if (OPERADORES[op]) { params.push(b); filtros.push(`${ident(a)} ${OPERADORES[op]} $${params.length}`); }
    else if (op === 'in') { params.push(b); filtros.push(`${ident(a)} = any($${params.length})`); }
    else if (op === 'is') filtros.push(`${ident(a)} is ${b === null ? 'null' : b ? 'true' : 'false'}`);
    else if (op === 'order') ordem.push(`${ident(a)} ${b?.ascending === false ? 'desc' : 'asc'}`);
    else if (op === 'limit') limite = Number(a) || null;
    else if (op === 'range') { deslocamento = Number(a) || 0; limite = Number(b) - Number(a) + 1; }
    else if (op === 'maybeSingle' || op === 'single') um = true;
  }
  const sql = `select to_jsonb(x) as j from (select ${colunas} from public.${ident(nome)}`
    + `${filtros.length ? ` where ${filtros.join(' and ')}` : ''}${ordem.length ? ` order by ${ordem.join(', ')}` : ''}`
    + `${limite ? ` limit ${limite}` : ''}${deslocamento ? ` offset ${deslocamento}` : ''}) x`;
  try {
    const executar = () => db.query(sql, params);
    const r = daCentral ? await comoUsuario(db, usuario, executar) : await executar();
    const linhas = r.rows.map((l) => l.j);
    return { data: um ? linhas[0] || null : linhas, error: null };
  } catch (e) {
    if (!daCentral) return { data: um ? null : [], error: null };
    return erro(e);
  }
}

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

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
