import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// HOMOLOGAÇÃO LOCAL DO BI -- "Supabase" falso da cópia temporária: um banco
// PGlite EM MEMÓRIA (no processo do next dev) carregado do retrato montado
// por homologacao/bi-gerencial/montar-banco.mjs (migrations REAIS até a
// 0084 + vendas fictícias). Nada sai da máquina. RPCs rodam como o papel
// `authenticated` com o usuário escolhido (mesmas RLS, grants e guardas da
// produção, inclusive g3_exigir_admin -> 42501 para quem não é admin);
// tabelas de apoio (usuarios, permissões...) são lidas sem RLS e escritas
// fora das RPCs são ignoradas. "Hoje" fixo em 25/11/2026 (bi_hoje_int lê a
// GUC teste.hoje neste banco).

const HOJE = '2026-11-25';
const raiz = process.cwd();
const RETRATO = path.join(raiz, 'homologacao', 'bi-gerencial', 'banco.retrato');

async function criarBanco() {
  const modulo = pathToFileURL(path.join(raiz, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href;
  const importar = new Function('m', 'return import(m)');
  const { PGlite } = await importar(modulo);
  const db = new PGlite({ loadDataDir: new Blob([readFileSync(RETRATO)]) });
  await db.waitReady;
  await db.query("select set_config('teste.hoje', $1, false)", [HOJE]);
  return db;
}

function banco({ recriar = false } = {}) {
  if (recriar || !globalThis.__bancoHomologacaoBi) globalThis.__bancoHomologacaoBi = criarBanco();
  return globalThis.__bancoHomologacaoBi;
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

const erro = (e) => ({ data: null, error: { message: e.message, code: e.code } });

// Literal de array do PostgreSQL ('{"a","b"}') para parâmetros text[]/smallint[].
function literalArray(lista) {
  return `{${lista.map((v) => (v === null ? 'NULL' : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)).join(',')}}`;
}

// Metadados da função (devolve linhas? tipos dos argumentos), como o
// PostgREST descobre pelo catálogo.
const metadados = new Map();
async function metaFuncao(db, nome, chaves) {
  const k = `${nome}:${chaves.join(',')}`;
  if (metadados.has(k)) return metadados.get(k);
  const r = await db.query(
    `select p.proretset as conjunto, p.proargnames as nomes,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [nome]
  );
  const opcao = r.rows.find((f) => chaves.every((c) => (f.nomes || []).includes(c))) || r.rows[0];
  if (!opcao) return null;
  const tipos = {};
  (opcao.nomes || []).forEach((n, i) => {
    tipos[n] = opcao.tipos[i];
  });
  const meta = { conjunto: opcao.conjunto, tipos };
  metadados.set(k, meta);
  return meta;
}

function valorParametro(valor, tipo) {
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor) && tipo && tipo.endsWith('[]')) return literalArray(valor);
  if (typeof valor === 'object') return JSON.stringify(valor);
  return valor;
}

async function rpc(db, usuario, nome, args) {
  if (!nome.startsWith('g3_') && !nome.startsWith('bi_')) return { data: null, error: null }; // registrar_acesso etc.
  const chaves = Object.keys(args || {}).map(ident);
  const meta = await metaFuncao(db, ident(nome), chaves);
  if (!meta) return { data: null, error: { code: 'PGRST202', message: `função ${nome} não encontrada` } };
  const lista = chaves.map((k, i) => `${k} => $${i + 1}::${meta.tipos[k] || 'text'}`).join(', ');
  const sql = meta.conjunto ? `select to_jsonb(r) as r from public.${nome}(${lista}) r` : `select to_jsonb(public.${nome}(${lista})) as r`;
  try {
    const resultado = await comoUsuario(db, usuario, () => db.query(sql, chaves.map((k) => valorParametro(args[k], meta.tipos[k]))));
    const valores = resultado.rows.map((l) => l.r);
    return { data: meta.conjunto ? valores : valores[0] ?? null, error: null };
  } catch (e) {
    return erro(e);
  }
}

const OPERADORES = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
const MUTACOES = new Set(['insert', 'update', 'upsert', 'delete']);

async function tabela(db, usuario, nome, ops) {
  const restrita = nome.startsWith('g3_') || nome.startsWith('bi_');
  if (ops.some(([op]) => MUTACOES.has(op))) {
    if (restrita) return { data: null, error: { message: 'homologação: escrita direta bloqueada -- só pelas RPCs.', code: '42501' } };
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
    else if (OPERADORES[op]) {
      params.push(b);
      filtros.push(`${ident(a)} ${OPERADORES[op]} $${params.length}`);
    } else if (op === 'in') {
      params.push(b);
      filtros.push(`${ident(a)} = any($${params.length})`);
    } else if (op === 'is') filtros.push(`${ident(a)} is ${b === null ? 'null' : b ? 'true' : 'false'}`);
    else if (op === 'order') ordem.push(`${ident(a)} ${b?.ascending === false ? 'desc' : 'asc'}`);
    else if (op === 'limit') limite = Number(a) || null;
    else if (op === 'range') {
      deslocamento = Number(a) || 0;
      limite = Number(b) - Number(a) + 1;
    } else if (op === 'maybeSingle' || op === 'single') um = true;
  }
  const sql = `select to_jsonb(x) as j from (select ${colunas} from public.${ident(nome)}`
    + `${filtros.length ? ` where ${filtros.join(' and ')}` : ''}${ordem.length ? ` order by ${ordem.join(', ')}` : ''}`
    + `${limite ? ` limit ${limite}` : ''}${deslocamento ? ` offset ${deslocamento}` : ''}) x`;
  try {
    const executar = () => db.query(sql, params);
    const r = restrita ? await comoUsuario(db, usuario, executar) : await executar();
    const linhas = r.rows.map((l) => l.j);
    return { data: um ? linhas[0] || null : linhas, error: null };
  } catch (e) {
    if (!restrita) return { data: um ? null : [], error: null };
    return erro(e);
  }
}

export const config = { api: { bodyParser: { sizeLimit: '8mb' }, responseLimit: false } };

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
    const t0 = Date.now();
    const resultado = await emFila(() => (tipo === 'rpc' ? rpc(db, usuario, nome, args) : tabela(db, usuario, nomeTabela, ops || [])));
    if (tipo === 'rpc' && process.env.HOMOLOGACAO_LOG_TEMPOS) console.log(`[rpc] ${nome} ${Date.now() - t0} ms`);
    res.json(resultado);
  } catch (e) {
    res.json(erro(e));
  }
}
