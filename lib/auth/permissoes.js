// Fonte única de verdade das permissões no FRONTEND — espelha o catálogo
// seedado em supabase/migrations/0001_perfis_e_permissoes.sql.
//
// Isso existe para nunca mais espalhar `if (perfil === 'admin')` ou
// `if (email === '...')` pelas páginas (Prompt 04, seção 7). Toda checagem
// de UI passa por hasPermissao(permissoes, codigo).
//
// A permissão REAL, que protege dado, é sempre a policy de RLS no banco
// (via public.has_permissao() lá do lado do Postgres) — isto aqui só
// controla o que a UI mostra/esconde. Esconder menu != segurança.

export const PERMISSOES = {
  DASHBOARD_VISUALIZAR: 'dashboard.visualizar',
  PERFIL_VISUALIZAR: 'perfil.visualizar',
  APARENCIA_EDITAR: 'aparencia.editar',
  FORNECEDORES_VISUALIZAR: 'fornecedores.visualizar',
  FORNECEDORES_INSERIR: 'fornecedores.inserir',
  FORNECEDORES_EDITAR: 'fornecedores.editar',
  FORNECEDORES_CANCELAR: 'fornecedores.cancelar',
  FORNECEDORES_EXCLUIR: 'fornecedores.excluir',
  PRODUCAO_VISUALIZAR: 'producao.visualizar',
  PRODUCAO_INSERIR: 'producao.inserir',
  PRODUCAO_EDITAR: 'producao.editar',
  PRODUCAO_CANCELAR: 'producao.cancelar',
  PRODUCAO_EXCLUIR: 'producao.excluir',
  // Migration 0019: correção estreita de quantidade_produzida (+ sobra/
  // venda) via editar_producao_registro, sem conceder reabertura nem
  // qualquer outra ação de producao.cancelar. Ver podeEditarProducaoRegistro
  // em pages/producao/historico.js.
  PRODUCAO_CORRIGIR: 'producao.corrigir',
  // Códigos novos (migration 0016). Historico.* é gate de TELA apenas — a
  // RLS real de producao_registros continua exigindo producao.visualizar/
  // producao.editar (Rota A, decisão de 2026-08-24). Planejamento.* e
  // produtos_producao.* já são a autorização real (RLS das tabelas
  // planejamento_producao/receitas/receita_ingredientes usa esses códigos
  // diretamente, sem depender de producao.*).
  HISTORICO_VISUALIZAR: 'historico.visualizar',
  HISTORICO_EDITAR: 'historico.editar',
  PLANEJAMENTO_VISUALIZAR: 'planejamento.visualizar',
  PLANEJAMENTO_EDITAR: 'planejamento.editar',
  PRODUTOS_PRODUCAO_VISUALIZAR: 'produtos_producao.visualizar',
  PRODUTOS_PRODUCAO_EDITAR: 'produtos_producao.editar',
  USUARIOS_VISUALIZAR: 'usuarios.visualizar',
  USUARIOS_ADMINISTRAR: 'usuarios.administrar',
  PERMISSOES_ADMINISTRAR: 'permissoes.administrar',
  AUDITORIA_VISUALIZAR: 'auditoria.visualizar',
  CONFIGURACOES_ADMINISTRAR: 'configuracoes.administrar',
  FINANCEIRO_VISUALIZAR: 'financeiro.visualizar',
  // Migration 0022 (Fase A de Pedidos/Compras) semeou 5 códigos no banco.
  // Fase A.2 adiciona receber/cancelar (marcar_pedido_recebido/
  // cancelar_pedido) — pedidos.editar ainda não tem uso no frontend
  // (edição de pedido é fase futura).
  PEDIDOS_VISUALIZAR: 'pedidos.visualizar',
  PEDIDOS_INSERIR: 'pedidos.inserir',
  PEDIDOS_RECEBER: 'pedidos.receber',
  PEDIDOS_CANCELAR: 'pedidos.cancelar',
  // Migrations 0023/0024 (Catálogo de Produtos): catálogo mestre de
  // public.produtos, distinto de "Produtos de Produção" (receitas).
  // Um único código de escrita cobre produtos, produto_fornecedores e
  // produtos_historico_compras (origem=manual) — mesmo padrão de
  // produtos_producao.*, sem granularidade extra sem necessidade.
  CATALOGO_PRODUTOS_VISUALIZAR: 'catalogo_produtos.visualizar',
  CATALOGO_PRODUTOS_EDITAR: 'catalogo_produtos.editar',
};

// Mapeia cada rota/item de menu para a permissão que ela exige. Adicionar
// um módulo novo no futuro é só adicionar uma linha aqui + seedar a
// permissão no banco — não exige mexer em RequireAuth nem no menu.
export const MODULOS = {
  dashboard: { rota: '/dashboard', label: '🏠 Início', permissao: PERMISSOES.DASHBOARD_VISUALIZAR },
  perfil: { rota: '/perfil', label: '👤 Perfil', permissao: PERMISSOES.PERFIL_VISUALIZAR },
  aparencia: { rota: '/admin-aparencia', label: '🎨 Aparência', permissao: PERMISSOES.APARENCIA_EDITAR },
  fornecedores: { rota: '/fornecedores', label: '🚚 Fornecedores', permissao: PERMISSOES.FORNECEDORES_VISUALIZAR },
  producao: { rota: '/producao', label: '🍞 Produção', permissao: PERMISSOES.PRODUCAO_VISUALIZAR },
  pedidos: { rota: '/pedidos', label: '📦 Pedidos', permissao: PERMISSOES.PEDIDOS_VISUALIZAR },
  // Rótulo com "de Produtos" só aqui (menu "Opções") — na barra principal
  // (NavegacaoPrincipal.js) o rótulo é só "Catálogo", mais curto,
  // combinando com Dashboard/Fornecedores/Produção/Pedidos. Rota/label
  // deliberadamente distintos de "Produtos de Produção" (aba dentro de
  // Produção, na verdade public.receitas) — catálogos conceitualmente
  // diferentes, nomes que não podem se confundir.
  catalogo: { rota: '/catalogo', label: '🏷️ Catálogo de Produtos', permissao: PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR },
  usuarios: { rota: '/admin/usuarios', label: '👥 Usuários', permissao: PERMISSOES.USUARIOS_ADMINISTRAR },
};

// Barra horizontal principal (components/NavegacaoPrincipal.js) — subconjunto
// de MODULOS, deliberadamente sem perfil/aparencia/usuarios (esses só ficam
// no menu "Opções"). Preparado para crescer: Catálogo de Produtos e
// Cotações (futuros) só precisam de uma linha aqui + a entrada
// correspondente em MODULOS, quando existirem — nenhuma página precisa ser
// tocada de novo.
export const ITENS_NAVEGACAO_PRINCIPAL = ['dashboard', 'fornecedores', 'producao', 'pedidos', 'catalogo'];

export function hasPermissao(permissoesUsuario, codigo) {
  if (!permissoesUsuario) return false;
  return permissoesUsuario.has(codigo);
}

// Só para UX (ex.: mostrar/esconder o botão de reabrir um registro de
// produção com origem='historico', que a trigger producao_registros_protecao
// exige is_admin() no banco). Nunca autoriza nada sozinho — a checagem que
// importa é sempre a do Postgres.
export function isAdmin(perfilUsuario) {
  return !!perfilUsuario && perfilUsuario.ativo === true && perfilUsuario.perfil === 'proprietario_admin';
}
