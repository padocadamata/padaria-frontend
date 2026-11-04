// HOMOLOGAÇÃO LOCAL -- substitui lib/supabase/client.js SÓ na cópia
// temporária criada por homologacao/cartao-ponto/preparar.mjs. NÃO existe
// conexão com o Supabase: login simulado (usuário escolhido em
// /homologacao) e todas as consultas/RPCs vão para /api/homologacao, que
// roda a migration 0078 num banco PGlite EM MEMÓRIA com dados fictícios.

const CHAVE_USUARIO = 'homologacao.usuario';
export const USUARIOS_HOMOLOGACAO = [
  { id: '00000000-0000-4000-8000-0000000000a1', nome: 'Admin Homologação', descricao: 'proprietario_admin: ver, lançar, conferir, fechar, reabrir' },
  { id: '00000000-0000-4000-8000-0000000000a2', nome: 'Lançadora Homologação', descricao: 'ver e lançar (sem conferir/fechar/reabrir)' },
  { id: '00000000-0000-4000-8000-0000000000a3', nome: 'Leitora Homologação', descricao: 'só ver' },
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

export function escolherUsuario(id) {
  window.localStorage.setItem(CHAVE_USUARIO, id);
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
        return { data: { session: user ? { user, access_token: 'homologacao' } : null }, error: null };
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
