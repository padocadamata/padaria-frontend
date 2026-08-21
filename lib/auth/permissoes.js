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
  USUARIOS_VISUALIZAR: 'usuarios.visualizar',
  USUARIOS_ADMINISTRAR: 'usuarios.administrar',
  PERMISSOES_ADMINISTRAR: 'permissoes.administrar',
  AUDITORIA_VISUALIZAR: 'auditoria.visualizar',
  CONFIGURACOES_ADMINISTRAR: 'configuracoes.administrar',
  FINANCEIRO_VISUALIZAR: 'financeiro.visualizar',
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
  usuarios: { rota: '/admin/usuarios', label: '👥 Usuários', permissao: PERMISSOES.USUARIOS_ADMINISTRAR },
};

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
