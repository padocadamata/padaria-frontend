import { PERMISSOES, hasPermissao } from '../auth/permissoes';

// Favoritos por usuário (migration 0075) -- funções PURAS. O banco guarda só
// a CHAVE estável da tela (ex.: "pedidos.resumo"); rota, rótulo, ícone e a
// regra de acesso vêm sempre do catálogo atual (telasNavegaveis, em
// lib/nav/navegacao.js). Um favorito nunca dá acesso a nada: a tela continua
// protegida pelo RequireAuth e pela RLS; aqui só se decide o que MOSTRAR.

// Mesmo formato do CHECK de public.usuario_favoritos.chave (0075).
export const PADRAO_CHAVE_FAVORITO = /^[a-z0-9_]+(\.[a-z0-9_-]+)?$/;
export const TAMANHO_MAXIMO_CHAVE = 60;
// Mesmo limite do trigger usuario_favoritos_limitar (0075).
export const MAXIMO_FAVORITOS = 40;

export function chaveFavoritoValida(chave) {
  return typeof chave === 'string' && chave.length <= TAMANHO_MAXIMO_CHAVE && PADRAO_CHAVE_FAVORITO.test(chave);
}

// Tela do catálogo cuja rota é EXATAMENTE a atual (sem query/hash). Telas de
// detalhe (/catalogo/[id], /funcionarios/novo...) não estão no catálogo e
// não ganham estrela.
export function telaDaRota(pathname, telas) {
  if (!pathname) return null;
  const caminho = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return telas.find((t) => t.rota === caminho) || null;
}

// Favoritar exige poder abrir a tela E ver o Dashboard (onde os favoritos
// aparecem) -- a mesma exigência da policy de INSERT no banco.
export function podeFavoritar(tela, permissoes) {
  return !!tela && tela.podeAcessar(permissoes) && hasPermissao(permissoes, PERMISSOES.DASHBOARD_VISUALIZAR);
}

// Favoritos que o usuário pode USAR agora, na ordem em que foram salvos.
// Chave desconhecida (tela removida/renomeada) ou sem permissão (perdeu o
// acesso depois de favoritar) simplesmente não aparece -- a linha continua
// no banco e volta a valer se o acesso voltar.
export function favoritosVisiveis(chaves, permissoes, telas) {
  const porChave = new Map(telas.map((t) => [t.chave, t]));
  const vistos = new Set();
  const resultado = [];
  for (const chave of chaves || []) {
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const tela = porChave.get(chave);
    if (tela && tela.podeAcessar(permissoes)) resultado.push(tela);
  }
  return resultado;
}
