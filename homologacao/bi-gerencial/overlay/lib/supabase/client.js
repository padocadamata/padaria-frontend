// HOMOLOGAÇÃO LOCAL -- substitui lib/supabase/client.js SÓ na cópia
// temporária criada por homologacao/bi-gerencial/preparar.mjs. NÃO existe
// conexão com o Supabase: login simulado (usuário escolhido em
// /homologacao) e todas as consultas/RPCs vão para /api/homologacao, que
// roda as migrations reais (até a 0084) num banco PGlite EM MEMÓRIA, com
// dados fictícios.

const CHAVE_USUARIO = 'homologacao.usuario';
// Sessão simulada: cada "login" em /homologacao abre uma sessão nova (como
// no Supabase), então os filtros persistidos por sessão (lib/filtros)
// funcionam aqui do mesmo jeito que em produção: mantidos entre recargas da
// página, zerados num novo login.
const CHAVE_SESSAO = 'homologacao.sessao';
export const USUARIOS_HOMOLOGACAO = [
  { id: '00000000-0000-0000-0000-00000000000a', nome: 'Admin Teste', descricao: 'proprietario_admin ativo: acesso total ao BI Gerencial' },
  { id: '00000000-0000-0000-0000-00000000000c', nome: 'Gestão Teste', descricao: 'perfil gestao: NÃO vê o BI (menu escondido e acesso negado; RPCs recusam com 42501)' },
];

function usuarioAtual() {
  if (typeof window === 'undefined') return null;
  let id = null;
  try {
    id = window.localStorage.getItem(CHAVE_USUARIO);
  } catch {
    id = null;
  }
  if (id === 'sair') return null;
  const u = USUARIOS_HOMOLOGACAO.find((x) => x.id === id) || USUARIOS_HOMOLOGACAO[0];
  return { id: u.id, email: `${u.nome}@homologacao.invalid`, user_metadata: { nome: u.nome } };
}

function novoUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

function sessaoAtual() {
  try {
    let id = window.localStorage.getItem(CHAVE_SESSAO);
    if (!id) {
      id = novoUuid();
      window.localStorage.setItem(CHAVE_SESSAO, id);
    }
    return id;
  } catch {
    return null;
  }
}

// Token no formato JWT só para carregar a claim session_id (nada assina nem
// verifica nada aqui; quem autoriza é a API local com o banco PGlite).
function tokenFalso() {
  const sessao = sessaoAtual();
  if (!sessao) return 'homologacao';
  const b64 = (o) => window.btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ session_id: sessao, homologacao: true })}.homologacao`;
}

export function escolherUsuario(id) {
  window.localStorage.setItem(CHAVE_USUARIO, id);
  window.localStorage.setItem(CHAVE_SESSAO, novoUuid());
}

async function chamar(corpo) {
  try {
    const resposta = await fetch('/api/homologacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpo, usuario: usuarioAtual()?.id || null }),
    });
    return await resposta.json();
  } catch (e) {
    return { data: null, error: { message: `homologação: ${e.message}` } };
  }
}

// Query builder encadeável: registra as operações e executa no `await`.
function consulta(tabela) {
  const ops = [];
  const proxy = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (ok, falha) => chamar({ tipo: 'tabela', tabela, ops }).then(ok, falha);
      return (...args) => {
        ops.push([prop, ...args]);
        return proxy;
      };
    },
  });
  return proxy;
}

let cliente;

export function createClient() {
  if (cliente) return cliente;
  const ouvintes = new Set();
  cliente = {
    auth: {
      getUser: async () => ({ data: { user: usuarioAtual() }, error: null }),
      getSession: async () => {
        const user = usuarioAtual();
        return { data: { session: user ? { user, access_token: tokenFalso() } : null }, error: null };
      },
      onAuthStateChange: (fn) => {
        ouvintes.add(fn);
        return { data: { subscription: { unsubscribe: () => ouvintes.delete(fn) } } };
      },
      signInWithPassword: async () => {
        escolherUsuario(USUARIOS_HOMOLOGACAO[0].id);
        return { data: { user: usuarioAtual() }, error: null };
      },
      signOut: async () => {
        window.localStorage.setItem(CHAVE_USUARIO, 'sair');
        ouvintes.forEach((fn) => fn('SIGNED_OUT', null));
        return { error: null };
      },
    },
    from: consulta,
    rpc: (nome, args = {}) => chamar({ tipo: 'rpc', nome, args }),
  };
  return cliente;
}
