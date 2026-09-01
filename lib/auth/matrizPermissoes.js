// Configuração VISUAL da matriz de permissões da tela Admin → Usuários e
// Acessos. Separado de lib/auth/permissoes.js de propósito — aquele
// arquivo é a fonte de verdade dos códigos (espelha o catálogo do banco);
// este aqui é só curadoria de como apresentar um SUBCONJUNTO deles numa
// grade visual, por módulo.
//
// Curadoria deliberada (V1, decisão de 2026-08-24): mostra só permissões
// com efeito real hoje. Fora daqui de propósito: perfil.visualizar/
// aparencia.editar (todo perfil já recebe por padrão, não fazem sentido
// como override), fornecedores.cancelar/fornecedores.excluir/
// producao.excluir (reservados — nenhuma policy os lê hoje), usuarios.
// visualizar/auditoria.visualizar/financeiro.visualizar (fora do escopo
// desta V1). Adicionar um desses no futuro é só incluir a linha aqui —
// não exige migration nem mudar RequireAuth/RLS.
import { PERMISSOES } from './permissoes';

export const ACAO_LABEL = {
  visualizar: 'Visualizar',
  inserir: 'Inserir',
  editar: 'Editar',
  cancelar: 'Cancelar / Reabrir',
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
    label: 'Produção — Hoje',
    itens: [
      { codigo: PERMISSOES.PRODUCAO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PRODUCAO_INSERIR, acao: 'inserir' },
      { codigo: PERMISSOES.PRODUCAO_EDITAR, acao: 'editar' },
      { codigo: PERMISSOES.PRODUCAO_CANCELAR, acao: 'cancelar' },
    ],
  },
  {
    chave: 'historico',
    label: 'Histórico',
    itens: [
      { codigo: PERMISSOES.HISTORICO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.HISTORICO_EDITAR, acao: 'editar' },
    ],
  },
  {
    chave: 'planejamento',
    label: 'Planejamento',
    itens: [
      { codigo: PERMISSOES.PLANEJAMENTO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PLANEJAMENTO_EDITAR, acao: 'editar' },
    ],
  },
  {
    chave: 'produtos_producao',
    label: 'Produtos', // era "Produtos de Produção" -- só rótulo (0030)
    itens: [
      { codigo: PERMISSOES.PRODUTOS_PRODUCAO_VISUALIZAR, acao: 'visualizar' },
      { codigo: PERMISSOES.PRODUTOS_PRODUCAO_EDITAR, acao: 'editar' },
    ],
  },
];

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
