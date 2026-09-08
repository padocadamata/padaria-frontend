// Configuração VISUAL da matriz de permissões da tela Admin → Usuários e
// Acessos. Separado de lib/auth/permissoes.js de propósito — aquele
// arquivo é a fonte de verdade dos códigos (espelha o catálogo do banco);
// este aqui é só curadoria de como apresentar um SUBCONJUNTO deles numa
// grade visual, por módulo.
//
// Curadoria deliberada (V1, decisão de 2026-08-24, ampliada nesta rodada
// -- auditoria de gestão de acessos de Produção): mostra só permissões
// com efeito real hoje. Fora daqui de propósito: perfil.visualizar/
// aparencia.editar (todo perfil já recebe por padrão, não fazem sentido
// como override), fornecedores.cancelar/fornecedores.excluir/
// producao.excluir (reservados — nenhuma policy os lê hoje), usuarios.
// visualizar/auditoria.visualizar/financeiro.visualizar (fora do escopo
// desta V1). Adicionar um desses no futuro é só incluir a linha aqui —
// não exige migration nem mudar RequireAuth/RLS.
//
// CORRIGIDO nesta rodada: Expositores (migration 0030) e Sacos Fechados
// (migrations 0042/0050) tinham sido adicionados ao catálogo de
// permissões DEPOIS do congelamento desta curadoria (2026-08-24) e nunca
// tinham sido incluídos aqui -- por isso a tela Admin > Usuários e
// Acessos nunca oferecia controle algum para eles, mesmo a permissão já
// existindo no banco. Corrigido acrescentando os 2 módulos que faltavam.
//
// `grupo` (novo campo, opcional): agrupa módulos que pertencem à mesma
// ÁREA maior do sistema (hoje só 'producao', reunindo Hoje/Histórico/
// Planejamento/Produtos/Expositores/Sacos) -- usado por
// codigosDoGrupo() abaixo para alimentar o controle "Acesso total à
// Produção" em MatrizPermissoes.js, SEM precisar manter uma segunda
// lista solta dos mesmos códigos. Adicionar um módulo novo a um grupo
// existente no futuro é só marcar `grupo: 'producao'` nele -- o "Acesso
// total" já passa a incluí-lo automaticamente, nenhuma outra lista para
// atualizar.
import { PERMISSOES } from './permissoes';

export const ACAO_LABEL = {
  visualizar: 'Visualizar',
  inserir: 'Inserir',
  operar: 'Operar',
  editar: 'Editar',
  corrigir: 'Corrigir (registro fechado)',
  cancelar: 'Cancelar / Reabrir',
  excluir: 'Excluir definitivamente',
};

// Rótulo do grupo, para o cabeçalho + checkbox "Acesso total" em
// MatrizPermissoes.js.
export const GRUPO_LABEL = {
  producao: 'Produção',
};

export const MODULOS_MATRIZ = [
  {
    chave: 'dashboard',
    label: 'Dashboard',
    itens: [{ codigo: PERMISSOES.DASHBOARD_VISUALIZAR, acao: 'visualizar' }],
  },
  {
    chave: 'fornecedores',
    label: 'Fornecedores',
    itens: [
      { codigo: PERMISSOES.FORNECEDORES_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.FORNECEDORES_INSERIR, acao: 'inserir' },
      { codigo: PERMISSOES.FORNECEDORES_EDITAR, acao: 'editar' },
    ],
  },
  {
    chave: 'producao',
    grupo: 'producao',
    label: 'Produção — Hoje',
    itens: [
      { codigo: PERMISSOES.PRODUCAO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PRODUCAO_INSERIR, acao: 'inserir' },
      { codigo: PERMISSOES.PRODUCAO_EDITAR, acao: 'editar' },
      { codigo: PERMISSOES.PRODUCAO_CANCELAR, acao: 'cancelar' },
      { codigo: PERMISSOES.PRODUCAO_CORRIGIR, acao: 'corrigir' },
    ],
  },
  {
    chave: 'historico',
    grupo: 'producao',
    label: 'Produção — Histórico',
    itens: [
      { codigo: PERMISSOES.HISTORICO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.HISTORICO_EDITAR, acao: 'editar' },
    ],
  },
  {
    chave: 'planejamento',
    grupo: 'producao',
    label: 'Produção — Planejamento',
    itens: [
      { codigo: PERMISSOES.PLANEJAMENTO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PLANEJAMENTO_EDITAR, acao: 'editar' },
    ],
  },
  {
    chave: 'produtos_producao',
    grupo: 'producao',
    label: 'Produção — Produtos', // era "Produtos de Produção" -- só rótulo (0030)
    itens: [
      { codigo: PERMISSOES.PRODUTOS_PRODUCAO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PRODUTOS_PRODUCAO_EDITAR, acao: 'editar' },
    ],
  },
  {
    chave: 'producao_expositores',
    grupo: 'producao',
    label: 'Produção — Expositores',
    itens: [
      { codigo: PERMISSOES.PRODUCAO_EXPOSITORES_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PRODUCAO_EXPOSITORES_OPERAR, acao: 'operar' },
      { codigo: PERMISSOES.PRODUCAO_EXPOSITORES_EDITAR, acao: 'editar' },
      { codigo: PERMISSOES.PRODUCAO_EXPOSITORES_EXCLUIR, acao: 'excluir' },
    ],
  },
  {
    chave: 'producao_sacos',
    grupo: 'producao',
    label: 'Produção — Sacos Fechados',
    itens: [
      { codigo: PERMISSOES.PRODUCAO_SACOS_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PRODUCAO_SACOS_OPERAR, acao: 'operar' },
      { codigo: PERMISSOES.PRODUCAO_SACOS_EDITAR, acao: 'editar' },
      { codigo: PERMISSOES.PRODUCAO_SACOS_EXCLUIR, acao: 'excluir' },
    ],
  },
];

// Todos os códigos de permissão que pertencem a um `grupo` (ex.:
// 'producao'), na ordem em que aparecem em MODULOS_MATRIZ -- fonte única
// para o controle "Acesso total a <grupo>" em MatrizPermissoes.js. Nunca
// precisa ser mantida separadamente: reflete automaticamente qualquer
// módulo que tenha esse `grupo`, incluindo módulos adicionados no futuro.
export function codigosDoGrupo(grupo) {
  return MODULOS_MATRIZ
    .filter((modulo) => modulo.grupo === grupo)
    .flatMap((modulo) => modulo.itens.map((item) => item.codigo));
}

// Só informativo nesta tela — nunca um controle editável. A trigger
// usuario_permissoes_bloquear_admin_trigger (migration 0016) rejeita
// qualquer INSERT/UPDATE em usuario_permissoes para estes 3 códigos,
// venha de onde vier (inclusive da RPC aplicar_diff_permissoes_usuario) —
// por isso a tela nem tenta oferecer um seletor para eles.
export const CODIGOS_ADMINISTRATIVOS = [
  { codigo: PERMISSOES.USUARIOS_ADMINISTRAR, label: 'Usuários — administrar' },
  { codigo: PERMISSOES.PERMISSOES_ADMINISTRAR, label: 'Permissões — administrar' },
  { codigo: PERMISSOES.CONFIGURACOES_ADMINISTRAR, label: 'Configurações administrativas' },
];

const FUSO_PADOCA = 'America/Sao_Paulo';

// Converte um timestamp ISO (ex.: usuario_permissoes.expira_em) para o
// formato exigido por <input type="datetime-local">, sempre no fuso da
// Padoca — nunca no fuso do dispositivo de quem está administrando (mesmo
// raciocínio de lib/data/dataLocal.js, aplicado a data+hora).
export function isoParaInputDatetimeLocal(isoString) {
  if (!isoString) return '';
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_PADOCA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoString));

  const v = {};
  for (const p of partes) {
    if (p.type !== 'literal') v[p.type] = p.value;
  }
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}

// Converte o valor de <input type="datetime-local"> (sem fuso, ex.:
// "2026-12-31T23:59") para um timestamp ISO, interpretando o valor digitado
// como horário da Padoca (America/Sao_Paulo) — não o fuso do navegador.
export function inputDatetimeLocalParaIso(valor) {
  if (!valor) return null;

  const [dataParte, horaParte] = valor.split('T');
  const [ano, mes, dia] = dataParte.split('-').map(Number);
  const [hora, minuto] = horaParte.split(':').map(Number);

  // Trata os números digitados como se já fossem um instante UTC, descobre
  // que horas essa mesma marca temporal apareceria em America/Sao_Paulo, e
  // usa a diferença como o offset real do fuso da Padoca — funciona mesmo
  // se algum dia o horário de verão voltar a existir no Brasil.
  const comoSeUtc = Date.UTC(ano, mes - 1, dia, hora, minuto);

  const partesNoFuso = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_PADOCA,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(comoSeUtc));

  const v = {};
  for (const p of partesNoFuso) {
    if (p.type !== 'literal') v[p.type] = p.value;
  }

  const comoInterpretadoNoFuso = Date.UTC(
    Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute)
  );

  const offsetMs = comoSeUtc - comoInterpretadoNoFuso;
  return new Date(comoSeUtc + offsetMs).toISOString();
}

export function estaExpirado(expiraEmIso) {
  if (!expiraEmIso) return false;
  return new Date(expiraEmIso).getTime() <= Date.now();
}
