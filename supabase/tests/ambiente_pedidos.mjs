// Ambiente de teste de Pedidos/Compras + Financeiro: PostgreSQL embutido
// (PGlite) com as migrations REAIS do repositório, na ordem, sobre stubs
// mínimos das tabelas legadas que nunca tiveram migration de criação
// (usuarios, fornecedores, produtos, receitas, producao_diaria) e do
// Supabase (auth.users/auth.uid, papéis, default privileges). Nada aqui
// toca o Supabase real.
//
// Migrations que dependem de DADOS reais de Produção (0012/0014/0033/
// 0034/0036/0049/0053) e as que dependem delas (Clientes/Encomendas)
// ficam fora -- não tocam Pedidos, Financeiro nem Folha. Ajustes de texto
// SÓ em guardas de contagem de dados reais (0037) e na parte de RLS de
// receitas da 0016 (tabelas de Produção ausentes) -- nenhuma regra de
// Pedidos/Folha é alterada.
//
//   npm i --no-save @electric-sql/pglite

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { PGlite } = await import('@electric-sql/pglite');

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(aqui, '..', '..');
const PASTA = join(aqui, '..', 'migrations');

export const ADMIN = '00000000-0000-0000-0000-00000000000a';
export const FINANCEIRO = '00000000-0000-0000-0000-00000000000b';
export const GESTAO = '00000000-0000-0000-0000-00000000000c';
export const OPERACIONAL = '00000000-0000-0000-0000-00000000000d';
export const RECEBEDOR = '00000000-0000-0000-0000-00000000000e'; // gestao + pedidos.receber/visualizar individuais
export const FORNECEDOR_A = '00000000-0000-0000-0000-0000000000f1';
export const FORNECEDOR_B = '00000000-0000-0000-0000-0000000000f2';
export const FORNECEDOR_INATIVO = '00000000-0000-0000-0000-0000000000f3';

// Todo banco criado aqui fica registrado para ser fechado no fim do
// arquivo de teste (instâncias abertas impedem o processo de terminar).
const abertos = new Set();
function registrar(db) {
  abertos.add(db);
  return db;
}
export async function fecharBancos() {
  for (const db of abertos) {
    try {
      await db.close();
    } catch {
      // já fechado
    }
  }
  abertos.clear();
}

export function lerMigration(nome) {
  return readFileSync(join(PASTA, nome), 'utf8');
}

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email varchar(255), created_at timestamptz not null default now(),
    email_confirmed_at timestamptz, last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('teste.uid', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table public.usuarios (id uuid primary key, nome text, email text, perfil text, senha text,
    ativo boolean default true, criado_em timestamptz default now(), atualizado_em timestamptz);
  create table public.fornecedores (id uuid primary key default gen_random_uuid(), nome text, cnpj text, telefone text,
    email text, endereco text, forma_pagamento text, data_pedido_padrao text, data_entrega_padrao text,
    ativo boolean not null default true, criado_em timestamptz default now(), atualizado_em timestamptz);
  create table public.produtos (id uuid primary key default gen_random_uuid(), nome text not null, secao text,
    unidade_medida text, categoria text, preco_custo numeric, preco_venda numeric, codigo_barras text,
    estoque_minimo numeric, ativo boolean not null default true, criado_em timestamptz default now(), atualizado_em timestamptz);
  create table public.receitas (id uuid primary key default gen_random_uuid(), nome text not null, descricao text,
    rendimento numeric, ativo boolean not null default true, criado_em timestamptz default now(), atualizado_em timestamptz);
  create table public.producao_diaria (id uuid primary key default gen_random_uuid(), data date, receita_id uuid,
    quantidade numeric, criado_em timestamptz default now());
`;

const ATE_0072 = [
  '0001', '0002b', '0003', '0004', '0005b', '0007', '0010', '0011', '0016', '0018', '0021',
  '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0037', '0038', '0039', '0040',
  '0041', '0042', '0043', '0044', '0045', '0046', '0047', '0048', '0050', '0051', '0052',
  '0054', '0055', '0056', '0057', '0058', '0059', '0060', '0061', '0062', '0063', '0064',
  '0065', '0066', '0067', '0068', '0072',
];

const AJUSTES = {
  // 0016 também mexe em RLS de tabelas de Produção ausentes neste banco.
  '0016': (s) => s.replace(/-- =+\s*\n-- 6\. RLS de receitas[\s\S]*?(?=-- =+\s*\n-- 8\.)/, ''),
  // 0037 confere contagens EXATAS do banco real (12 pedidos, 33 itens...).
  '0037': (s) => s.replace(/raise exception 'compras_presenciais: (total|apos)/g, "raise notice 'compras_presenciais: $1"),
};

function arquivosDe(prefixos) {
  const todos = readdirSync(PASTA).sort();
  return prefixos.map((p) => {
    const achado = todos.find((f) => f.startsWith(`${p}_`));
    if (!achado) throw new Error(`migration ${p} não encontrada`);
    return achado;
  });
}

export async function aplicarMigration(db, arquivo) {
  const prefixo = arquivo.split('_')[0];
  let sql = lerMigration(arquivo);
  if (AJUSTES[prefixo]) sql = AJUSTES[prefixo](sql);
  await db.exec(sql);
}

// "Hoje" controlável: depois das migrations, contas_pagar_hoje() passa a ler
// a GUC teste.hoje (quando definida).
export const HOJE_TESTE = `
  create or replace function public.contas_pagar_hoje() returns date language sql stable set search_path = '' as $$
    select coalesce(nullif(current_setting('teste.hoje', true), '')::date, (now() at time zone 'America/Sao_Paulo')::date)
  $$;
  revoke execute on function public.contas_pagar_hoje() from public, anon, authenticated, service_role;
`;

const DADOS = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 'admin@padoca.test'), ('${FINANCEIRO}', 'fin@padoca.test'),
    ('${GESTAO}', 'gestao@padoca.test'), ('${OPERACIONAL}', 'op@padoca.test'),
    ('${RECEBEDOR}', 'receb@padoca.test');
  insert into public.usuarios (id, nome, email, perfil, ativo) values
    ('${ADMIN}', 'ADMIN TESTE', 'admin@padoca.test', 'proprietario_admin', true),
    ('${FINANCEIRO}', 'FINANCEIRO TESTE', 'fin@padoca.test', 'financeiro_administrativo', true),
    ('${GESTAO}', 'GESTAO TESTE', 'gestao@padoca.test', 'gestao', true),
    ('${OPERACIONAL}', 'OPERACIONAL TESTE', 'op@padoca.test', 'operacional', true),
    ('${RECEBEDOR}', 'RECEBEDOR TESTE', 'receb@padoca.test', 'gestao', true);
  insert into public.usuario_permissoes (usuario_id, permissao, efeito) values
    ('${RECEBEDOR}', 'pedidos.visualizar', 'concede'),
    ('${RECEBEDOR}', 'pedidos.inserir', 'concede'),
    ('${RECEBEDOR}', 'pedidos.receber', 'concede');
  insert into public.fornecedores (id, nome, nome_fantasia, ativo, modalidade_compra) values
    ('${FORNECEDOR_A}', 'FORNECEDOR A', 'MOINHO A', true, 'pedido_com_entrega'),
    ('${FORNECEDOR_B}', 'FORNECEDOR B', 'MERCADO B', true, 'compra_presencial'),
    ('${FORNECEDOR_INATIVO}', 'FORNECEDOR C', 'ANTIGO C', false, 'pedido_com_entrega');
`;

export async function como(db, uid, { hoje } = {}) {
  await db.query("select set_config('teste.uid', $1, false), set_config('teste.hoje', $2, false)", [uid ?? '', hoje ?? '']);
}

// Banco com as migrations até a 0072 (+ dados mínimos) e, opcionalmente, a
// 0073 (ou qualquer lista extra de arquivos).
export async function novoBanco({ extras = ['0073_contas_pagar.sql'], dados = true } = {}) {
  const db = registrar(new PGlite());
  await db.exec(STUBS);
  for (const arquivo of arquivosDe(ATE_0072)) await aplicarMigration(db, arquivo);
  if (dados) await db.exec(DADOS);
  for (const arquivo of extras) await aplicarMigration(db, arquivo);
  if (extras.some((a) => a.startsWith('0073'))) await db.exec(HOJE_TESTE);
  await como(db, ADMIN);
  return db;
}

// Snapshot reaproveitável: monta o banco UMA vez por arquivo de teste e
// devolve uma cópia isolada (loadDataDir) a cada chamada.
export function fabricaDeBancos(opcoes) {
  let snapshot;
  return async () => {
    if (!snapshot) {
      const base = await novoBanco(opcoes);
      snapshot = await base.dumpDataDir('none');
      await base.close();
    }
    const db = registrar(new PGlite({ loadDataDir: snapshot }));
    await db.waitReady;
    await como(db, ADMIN);
    return db;
  };
}

export async function valor(db, sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
}

export const hojeSP = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
