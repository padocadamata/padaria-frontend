// Catálogo de TIPOS de notificação no frontend (migration 0080).
//
// O banco grava só (tipo, registro_id, título, descrição, dados) -- NUNCA uma
// URL. Este arquivo é o único lugar que traduz um tipo em ícone, rótulo e
// link. Tipo desconhecido (ex.: criado por uma versão mais nova do banco)
// continua aparecendo na lista, só sem link.
//
// Para um tipo novo (ex.: importações do G3ERP): 1) emitir no banco via
// public.notificacoes_emitir() a partir do módulo de origem; 2) acrescentar
// uma entrada aqui com rótulo, ícone (components/ui/Icon.js) e link(n). O
// link só pode apontar para rota interna e deve validar o registro_id.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor) {
  return typeof valor === 'string' && UUID.test(valor);
}

export const TIPOS_NOTIFICACAO = {
  'pedidos_solicitacoes.criada': {
    rotulo: 'Solicitação de produto',
    icone: 'package',
    link: (n) => (ehUuid(n.registro_id) ? `/pedidos/solicitacoes?id=${n.registro_id}` : null),
  },
};

export function definicaoDoTipo(tipo) {
  return TIPOS_NOTIFICACAO[tipo] || null;
}

export function iconeDaNotificacao(n) {
  return definicaoDoTipo(n?.tipo)?.icone || 'bell';
}

export function rotuloDoTipo(n) {
  return definicaoDoTipo(n?.tipo)?.rotulo || 'Notificação';
}

// Rota interna para abrir o registro relacionado, ou null. Defesa extra: só
// aceita caminhos que começam com "/" e não com "//" (nada de URL externa).
export function linkDaNotificacao(n) {
  const definicao = definicaoDoTipo(n?.tipo);
  if (!definicao || typeof definicao.link !== 'function') return null;
  const link = definicao.link(n);
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return null;
  return link;
}

// Contador compacto do sino: '' (nada a mostrar), '1'..'99', '99+'.
export function textoContador(quantidade) {
  const n = Number(quantidade);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 99) return '99+';
  return String(Math.floor(n));
}

export function rotuloAcessivelDoSino(quantidade) {
  const n = Number(quantidade) || 0;
  if (n <= 0) return 'Notificações';
  if (n === 1) return 'Notificações, 1 não lida';
  return `Notificações, ${n > 99 ? 'mais de 99' : n} não lidas`;
}

// Situação da pendência para o selo (Badge). null = notificação informativa.
export function situacaoDaPendencia(status) {
  switch (status) {
    case 'aberta':
      return { texto: 'Pendente', tom: 'warning' };
    case 'resolvida':
      return { texto: 'Resolvida', tom: 'success' };
    case 'descartada':
      return { texto: 'Descartada', tom: 'neutral' };
    default:
      return null;
  }
}

const FUSO = 'America/Sao_Paulo';
const formatoDia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// "20/11/2026 às 14:05" (sempre no fuso da padaria, independente do aparelho).
export function dataHoraNotificacao(iso) {
  if (!iso) return '';
  const data = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return `${formatoDia.format(data)} às ${formatoHora.format(data)}`;
}

// Linha de resolução exibida sob a notificação ("Resolvida por Ana em ...").
export function textoResolucao(n) {
  if (!n || (n.pendencia_status !== 'resolvida' && n.pendencia_status !== 'descartada')) return '';
  const verbo = n.pendencia_status === 'resolvida' ? 'Resolvida' : 'Descartada';
  const quem = n.resolvida_por_nome ? ` por ${n.resolvida_por_nome}` : '';
  const quando = n.resolvida_em ? ` em ${dataHoraNotificacao(n.resolvida_em)}` : '';
  return `${verbo}${quem}${quando}`;
}
