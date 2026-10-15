import { MODULOS, PERMISSOES, hasPermissao, moduloVisivel } from '../auth/permissoes';

// Modelo de navegação do novo shell (sidebar desktop + bottom navigation
// mobile). Funções PURAS: recebem o Set de permissões efetivas (o mesmo
// que useAuth() já entrega, com perfil-base + overrides individuais) e
// devolvem só o que aquele usuário pode acessar.
//
// REGRA DE ACESSO NÃO É REESCRITA AQUI: rota e permissão de cada módulo vêm
// de MODULOS (lib/auth/permissoes.js) e a visibilidade usa moduloVisivel()
// -- a mesma função que NavegacaoPrincipal/MenuOpcoes já usam. Este arquivo
// só acrescenta apresentação (ícone, rótulo, ordem, prioridade no mobile).
// Esconder um item é só UX; quem protege de verdade continua sendo o
// RequireAuth de cada página e a RLS no banco.
//
// NÃO inventa rotas: só existem aqui as que já existiam nas navegações
// atuais.

// Módulos do topo, na mesma ordem de ITENS_NAVEGACAO_PRINCIPAL.
// prioridadeMobile: ordem de preferência para ocupar os (no máximo) 4 slots
// da bottom navigation -- quem tem poucos módulos vê todos; quem tem muitos
// vê os 4 de maior prioridade + "Mais". Critério: uso operacional presumido
// pela estrutura do sistema (o perfil operacional só enxerga Dashboard,
// Produção e Agenda; Pedidos vem antes de Fornecedores/Catálogo/Folha, que
// são de retaguarda).
const MODULOS_PRINCIPAIS = [
  { chave: 'dashboard', icone: 'home', rotulo: 'Dashboard', rotuloCurto: 'Início', prioridadeMobile: 1 },
  { chave: 'fornecedores', icone: 'truck', rotulo: 'Fornecedores', prioridadeMobile: 5 },
  { chave: 'producao', icone: 'bread', rotulo: 'Produção', prioridadeMobile: 2 },
  // rotaInicial: entrada do módulo pelo menu (Pedidos abre na 1ª aba,
  // Resumo). `rota` continua sendo a base do módulo -- é ela que marca o
  // item como ativo em todas as abas (/pedidos, /pedidos/resumo, ...).
  { chave: 'pedidos', icone: 'package', rotulo: 'Pedidos', prioridadeMobile: 3, rotaInicial: '/pedidos/resumo' },
  { chave: 'catalogo', icone: 'tag', rotulo: 'Catálogo', prioridadeMobile: 6 },
  { chave: 'clientes', icone: 'contato', rotulo: 'Clientes', prioridadeMobile: 6.5 },
  { chave: 'agenda', icone: 'calendar', rotulo: 'Agenda', prioridadeMobile: 4 },
  { chave: 'funcionarios', icone: 'users', rotulo: 'Folha de Pagamento', rotuloCurto: 'Folha', prioridadeMobile: 7 },
  // Migration 0073. Entra direto na única sub-área existente.
  { chave: 'financeiro', icone: 'wallet', rotulo: 'Financeiro', prioridadeMobile: 7.5, rotaInicial: '/financeiro/contas-pagar' },
];

// Módulos que hoje só viviam no menu "Opções": ficam fora da barra
// principal. Usuários (administração) vai num grupo próprio; Perfil vai no
// menu do usuário (topbar) e na aba "Mais" do mobile.
const MODULO_ADMIN = { chave: 'usuarios', icone: 'shield', rotulo: 'Usuários', prioridadeMobile: 8 };
const MODULO_PERFIL = { chave: 'perfil', icone: 'user', rotulo: 'Meu perfil', prioridadeMobile: 9 };

// Subitens = as ABAS internas que já existem como ROTAS reais (mesmas
// rotas e permissões de components/producao/NavegacaoProducao.js e
// components/pedidos/NavegacaoPedidos.js). Uma aba aparece se o usuário tiver
// QUALQUER uma das permissões listadas (mesma semântica dos componentes
// atuais). A sidebar os mostra como sub-lista expansível do módulo.
//
// NÃO estão aqui, de propósito:
//  - Agenda: Mês/Semana/Dia são VISÕES (estado da própria página), não
//    rotas -- continuam controles da página, não itens de navegação.
//  - Folha de Pagamento: FOPAG/Cartão Ponto ainda não existem; quando
//    surgirem como sub-rotas, basta acrescentar na lista abaixo, mesmo
//    padrão de 'escala'/'pagamentos' (migrations 0055/0065/0066).
const SUBITENS = {
  producao: [
    { chave: 'hoje', rotulo: 'Hoje', rota: '/producao', permissoes: [PERMISSOES.PRODUCAO_VISUALIZAR] },
    { chave: 'historico', rotulo: 'Histórico', rota: '/producao/historico', permissoes: [PERMISSOES.HISTORICO_VISUALIZAR] },
    { chave: 'planejamento', rotulo: 'Planejamento', rota: '/producao/planejamento', permissoes: [PERMISSOES.PLANEJAMENTO_VISUALIZAR] },
    { chave: 'produtos', rotulo: 'Produtos', rota: '/producao/produtos', permissoes: [PERMISSOES.PRODUTOS_PRODUCAO_VISUALIZAR] },
    { chave: 'expositores', rotulo: 'Expositores', rota: '/producao/expositores', permissoes: [PERMISSOES.PRODUCAO_EXPOSITORES_VISUALIZAR] },
    { chave: 'sacos', rotulo: 'Sacos Fechados', rota: '/producao/sacos', permissoes: [PERMISSOES.PRODUCAO_SACOS_VISUALIZAR] },
  ],
  pedidos: [
    {
      chave: 'resumo',
      rotulo: 'Resumo',
      rota: '/pedidos/resumo',
      permissoes: [PERMISSOES.PEDIDOS_VISUALIZAR, PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR],
    },
    { chave: 'pedidos', rotulo: 'Pedidos', rota: '/pedidos', permissoes: [PERMISSOES.PEDIDOS_VISUALIZAR] },
    { chave: 'solicitacoes', rotulo: 'Solicitações', rota: '/pedidos/solicitacoes', permissoes: [PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR] },
  ],
  // Migration 0055 (frente Escala) -- mesmo padrão de 'pedidos': cada aba
  // pela sua própria permissão, independente uma da outra.
  funcionarios: [
    { chave: 'funcionarios', rotulo: 'Funcionários', rota: '/funcionarios', permissoes: [PERMISSOES.FUNCIONARIOS_VISUALIZAR] },
    { chave: 'escala', rotulo: 'Escala', rota: '/funcionarios/escala', permissoes: [PERMISSOES.ESCALA_VISUALIZAR] },
    // Migration 0061 -- Calendário (rota raiz) e Cadastro
    // (/funcionarios/tarefas/cadastro) vivem sob esta mesma aba.
    { chave: 'tarefas', rotulo: 'Tarefas', rota: '/funcionarios/tarefas', permissoes: [PERMISSOES.TAREFAS_VISUALIZAR] },
    // Migrations 0065/0066 -- A Pagar/Pagos/Configurações vivem como
    // "visões" dentro desta mesma rota (mesmo padrão de Escala
    // Semanal/Mensal/Cobertura), não sub-rotas separadas.
    { chave: 'pagamentos', rotulo: 'Pagamentos', rota: '/funcionarios/pagamentos', permissoes: [PERMISSOES.FOLHA_PAGAMENTOS_VISUALIZAR] },
  ],
  // Migration 0071 -- Encomendas vive dentro de Clientes, cada aba pela sua
  // própria permissão.
  clientes: [
    { chave: 'clientes', rotulo: 'Clientes', rota: '/clientes', permissoes: [PERMISSOES.CLIENTES_VISUALIZAR] },
    { chave: 'encomendas', rotulo: 'Encomendas', rota: '/clientes/encomendas', permissoes: [PERMISSOES.ENCOMENDAS_VISUALIZAR] },
  ],
  // Migration 0073 -- A Pagar/Pagas/Compras sem lançamento são visões da
  // mesma rota (padrão de Folha > Pagamentos), não sub-rotas.
  financeiro: [
    { chave: 'contas-pagar', rotulo: 'Contas a Pagar', rota: '/financeiro/contas-pagar', permissoes: [PERMISSOES.CONTAS_PAGAR_VISUALIZAR] },
  ],
};

// Sub-rotas (abas) de um módulo que o usuário pode abrir -- mesma regra das
// navegações internas antigas: cada aba pela SUA permissão (qualquer uma das
// listadas), independente de o módulo pai aparecer ou não no menu.
export function subitensDoModulo(chave, permissoes) {
  return (SUBITENS[chave] || []).filter((sub) => sub.permissoes.some((codigo) => hasPermissao(permissoes, codigo)));
}

function resolverModulo(definicao, permissoes) {
  const modulo = MODULOS[definicao.chave];
  if (!modulo || !moduloVisivel(permissoes, modulo)) return null;

  const subitens = subitensDoModulo(definicao.chave, permissoes);

  return { ...definicao, rota: modulo.rota, href: definicao.rotaInicial || modulo.rota, subitens };
}

// Tudo que o shell precisa saber sobre o que o usuário pode ver.
export function navegacaoDoUsuario(permissoes) {
  const principais = MODULOS_PRINCIPAIS.map((d) => resolverModulo(d, permissoes)).filter(Boolean);
  const admin = [resolverModulo(MODULO_ADMIN, permissoes)].filter(Boolean);
  const perfil = resolverModulo(MODULO_PERFIL, permissoes);
  return { principais, admin, perfil };
}

// Bottom navigation: até 4 destinos diretos (por prioridade) + "Mais".
// "Mais" recebe o restante dos módulos principais (na ordem do menu), o
// grupo administrativo e o perfil -- o que o usuário não pode ver simplesmente
// não entra em lugar nenhum.
export const MAX_DESTINOS_DIRETOS_MOBILE = 4;

export function destinosMobile(permissoes) {
  const { principais, admin, perfil } = navegacaoDoUsuario(permissoes);

  const diretos = [...principais]
    .sort((a, b) => a.prioridadeMobile - b.prioridadeMobile)
    .slice(0, MAX_DESTINOS_DIRETOS_MOBILE);
  const chavesDiretas = new Set(diretos.map((d) => d.chave));

  return {
    diretos,
    maisModulos: principais.filter((m) => !chavesDiretas.has(m.chave)),
    maisAdmin: admin,
    maisPerfil: perfil,
  };
}

// Telas navegáveis (Favoritos, migration 0075): cada ROTA estável que o
// menu já oferece -- as abas reais de um módulo (Produção > Hoje, Pedidos >
// Resumo...) ou o próprio módulo quando ele não tem abas (Fornecedores,
// Catálogo, Agenda, Usuários). Fora de propósito: Dashboard (é onde os
// favoritos aparecem) e Meu perfil (menu do usuário). A chave é estável e
// independe da URL ("pedidos.resumo"); rota, rótulo, ícone e permissão vêm
// SEMPRE da configuração atual -- nada disso é gravado no banco.
// podeAcessar(permissoes) usa a MESMA regra do menu (aba: qualquer uma das
// permissões da aba; módulo sem abas: moduloVisivel).
export function telasNavegaveis() {
  const telas = [];
  for (const definicao of [...MODULOS_PRINCIPAIS, MODULO_ADMIN]) {
    if (definicao.chave === 'dashboard') continue;
    const modulo = MODULOS[definicao.chave];
    if (!modulo) continue;
    const abas = SUBITENS[definicao.chave] || [];
    if (abas.length === 0) {
      telas.push({
        chave: definicao.chave,
        rota: modulo.rota,
        rotulo: definicao.rotulo,
        modulo: definicao.rotulo,
        icone: definicao.icone,
        podeAcessar: (permissoes) => moduloVisivel(permissoes, modulo),
      });
      continue;
    }
    for (const aba of abas) {
      telas.push({
        chave: `${definicao.chave}.${aba.chave}`,
        rota: aba.rota,
        rotulo: aba.rotulo === definicao.rotulo ? aba.rotulo : `${definicao.rotulo} › ${aba.rotulo}`,
        modulo: definicao.rotulo,
        icone: definicao.icone,
        podeAcessar: (permissoes) => aba.permissoes.some((codigo) => hasPermissao(permissoes, codigo)),
      });
    }
  }
  return telas;
}

// Módulo ativo: a rota do módulo ou qualquer sub-rota dela (ex.: /producao/
// historico, /catalogo/123). O Dashboard só ativa em /dashboard.
export function moduloEstaAtivo(pathname, rota) {
  return pathname === rota || pathname.startsWith(`${rota}/`);
}

// Subitem ativo: correspondência EXATA -- /producao e /pedidos são também a
// raiz do módulo, então prefixo marcaria "Hoje"/"Pedidos" em todas as abas.
export function subitemEstaAtivo(pathname, rota) {
  return pathname === rota;
}
