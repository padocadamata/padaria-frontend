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
  // Migration 0030 (Controle de Expositores): 4 codigos dedicados,
  // concedidos inicialmente so a proprietario_admin no banco. visualizar
  // = ver a aba Expositores; operar = criar/editar lote (pre-conclusao)
  // + concluir retirada (fluxo diario); editar = corrigir lote JA
  // concluido (mais restritiva, correcao administrativa); excluir =
  // exclusao definitiva de um lote, independente de status.
  PRODUCAO_EXPOSITORES_VISUALIZAR: 'producao_expositores.visualizar',
  PRODUCAO_EXPOSITORES_OPERAR: 'producao_expositores.operar',
  PRODUCAO_EXPOSITORES_EDITAR: 'producao_expositores.editar',
  PRODUCAO_EXPOSITORES_EXCLUIR: 'producao_expositores.excluir',
  USUARIOS_VISUALIZAR: 'usuarios.visualizar',
  USUARIOS_ADMINISTRAR: 'usuarios.administrar',
  PERMISSOES_ADMINISTRAR: 'permissoes.administrar',
  AUDITORIA_VISUALIZAR: 'auditoria.visualizar',
  CONFIGURACOES_ADMINISTRAR: 'configuracoes.administrar',
  FINANCEIRO_VISUALIZAR: 'financeiro.visualizar',
  // Migration 0022 (Fase A de Pedidos/Compras) semeou 5 códigos no banco;
  // migration 0025 acrescentou pedidos.excluir (exclusão definitiva,
  // somente aguardando_entrega, via excluir_pedido()). Os 6 já existiam
  // no banco -- esta rodada só passa a reconhecer editar/excluir no
  // frontend (edição de pedido e exclusão definitiva).
  PEDIDOS_VISUALIZAR: 'pedidos.visualizar',
  PEDIDOS_INSERIR: 'pedidos.inserir',
  PEDIDOS_EDITAR: 'pedidos.editar',
  PEDIDOS_RECEBER: 'pedidos.receber',
  PEDIDOS_CANCELAR: 'pedidos.cancelar',
  PEDIDOS_EXCLUIR: 'pedidos.excluir',
  // Migration 0027: desfaz atomicamente um recebimento (via
  // reabrir_recebimento_pedido()), devolvendo o pedido para
  // aguardando_entrega. Separada de pedidos.receber de proposito (mais
  // sensivel -- remove historico de compra ja gerado no Catalogo);
  // concedida inicialmente so a proprietario_admin no banco.
  PEDIDOS_REABRIR_RECEBIMENTO: 'pedidos.reabrir_recebimento',
  // Migrations 0023/0024 (Catálogo de Produtos): catálogo mestre de
  // public.produtos, distinto de "Produtos de Produção" (receitas).
  // Um único código de escrita cobre produtos, produto_fornecedores e
  // produtos_historico_compras (origem=manual) — mesmo padrão de
  // produtos_producao.*, sem granularidade extra sem necessidade.
  CATALOGO_PRODUTOS_VISUALIZAR: 'catalogo_produtos.visualizar',
  CATALOGO_PRODUTOS_EDITAR: 'catalogo_produtos.editar',
  // Migration 0029: exclusão definitiva de um produto do Catálogo (via
  // excluir_produto_catalogo()), SOMENTE quando não há nenhuma utilização
  // (cotações, pedido_itens, produto_fornecedores,
  // produtos_historico_compras, receita_ingredientes). Separada de
  // catalogo_produtos.editar de propósito (mais destrutiva — mesmo
  // raciocínio de pedidos.excluir vs. pedidos.editar); concedida
  // inicialmente só a proprietario_admin no banco.
  CATALOGO_PRODUTOS_EXCLUIR: 'catalogo_produtos.excluir',
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
