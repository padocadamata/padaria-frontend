import { somarDias } from '../data/dataLocal';
import { somenteDigitos } from '../clientes/telefone';

// Regras de apresentação/validação de Encomendas (migration 0071). Funções
// puras -- o banco (salvar_encomenda) valida tudo de novo; aqui é só para
// avisar antes de salvar e montar o que a tela mostra.

export const STATUS_ENCOMENDA = {
  pendente: { rotulo: 'Pendente', tom: 'warning' },
  concluida: { rotulo: 'Concluída', tom: 'success' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutral' },
};

export const MAX_ITENS_ENCOMENDA = 100;
export const MAX_COMENTARIO_ITEM = 500;
export const QUANTIDADE_MAXIMA = 99999;

// "2", "1,5", "1.5", " 30 " -> número; inválido/zero/negativo/> teto/mais de
// 3 casas -> null (mesmas regras da RPC e da constraint).
export function normalizarQuantidade(texto) {
  const limpo = String(texto ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  const [, decimais = ''] = limpo.split('.');
  if (decimais.length > 3) return null;
  const valor = Number(limpo);
  if (!(valor > 0) || valor > QUANTIDADE_MAXIMA) return null;
  return valor;
}

export function formatarQuantidade(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';
  return numero.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function formatarHora(hora) {
  return hora ? hora.slice(0, 5) : '';
}

// Rascunho do formulário -> mensagem do primeiro problema ('' = ok).
// `retiradaOriginal`: data já gravada (edição) -- retirada no passado só é
// aceita se não mudou, como no banco.
export function validarEncomenda({ clienteId, dataRetirada, horaRetirada, dataPedido, itens, hoje, retiradaOriginal = null }) {
  if (!clienteId) return 'Escolha o cliente (ou cadastre um novo).';
  if (!dataRetirada || !horaRetirada) return 'Informe a data e o horário da retirada.';
  if (!dataPedido) return 'Informe a data do pedido.';
  if (dataPedido > hoje) return 'A data do pedido não pode ser futura.';
  if (dataPedido > dataRetirada) return 'A data do pedido não pode ser depois da retirada.';
  if (dataRetirada < hoje && dataRetirada !== retiradaOriginal) return 'A data de retirada não pode estar no passado.';
  if (!itens || itens.length === 0) return 'Inclua pelo menos um produto.';
  if (itens.length > MAX_ITENS_ENCOMENDA) return `No máximo ${MAX_ITENS_ENCOMENDA} itens por encomenda.`;
  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i];
    if (!item.produto_id) return `Item ${i + 1}: escolha o produto.`;
    if (normalizarQuantidade(item.quantidade) === null) {
      return `Item ${i + 1} (${item.nome}): quantidade inválida — maior que zero, até ${QUANTIDADE_MAXIMA}, no máximo 3 casas decimais.`;
    }
    if ((item.comentario || '').trim().length > MAX_COMENTARIO_ITEM) return `Item ${i + 1} (${item.nome}): comentário muito longo (máximo ${MAX_COMENTARIO_ITEM} caracteres).`;
  }
  return '';
}

// Itens do formulário -> p_itens da RPC. Comentário vai como digitado
// (só trim; nunca maiúsculas).
export function montarItensPayload(itens) {
  return itens.map((item) => ({
    produto_id: item.produto_id,
    quantidade: normalizarQuantidade(item.quantidade),
    comentario: (item.comentario || '').trim() || null,
  }));
}

// "2× BOLO CASEIRO DE FUBÁ, 30× SALGADO X +1"
export function resumoItens(itens, max = 2) {
  const lista = itens || [];
  const visiveis = lista.slice(0, max).map((i) => `${formatarQuantidade(i.quantidade)}× ${i.produto_nome}`);
  const resto = lista.length - visiveis.length;
  return visiveis.join(', ') + (resto > 0 ? ` +${resto}` : '');
}

// Busca livre (cliente, telefone ou produto) + status + produto.
export function encomendaPassaFiltro(encomenda, { termo = '', status = 'todos', produto = '' } = {}) {
  if (status !== 'todos' && encomenda.status !== status) return false;
  if (produto && !encomenda.itens.some((i) => i.produto_id === produto)) return false;
  const t = termo.trim().toLocaleUpperCase('pt-BR');
  if (!t) return true;
  const digitos = somenteDigitos(termo);
  if (encomenda.cliente_nome.toLocaleUpperCase('pt-BR').includes(t)) return true;
  if (digitos.length >= 3 && encomenda.cliente_telefone.includes(digitos)) return true;
  return encomenda.itens.some((i) => i.produto_nome.toLocaleUpperCase('pt-BR').includes(t));
}

// Produtos presentes nas encomendas carregadas (para o filtro por produto).
export function produtosDasEncomendas(encomendas) {
  const mapa = new Map();
  for (const e of encomendas) {
    for (const i of e.itens) {
      const atual = mapa.get(i.produto_id) || { id: i.produto_id, nome: i.produto_nome, quantidade: 0 };
      atual.quantidade += 1;
      mapa.set(i.produto_id, atual);
    }
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Períodos do filtro -> janela de retirada consultada no banco (sempre
// <= 400 dias, o teto de listar_encomendas).
export const PERIODOS = {
  proximos: { rotulo: 'Próximos 30 dias', janela: (hoje) => ({ inicio: hoje, fim: somarDias(hoje, 30) }) },
  hoje: { rotulo: 'Hoje', janela: (hoje) => ({ inicio: hoje, fim: hoje }) },
  amanha: { rotulo: 'Amanhã', janela: (hoje) => ({ inicio: somarDias(hoje, 1), fim: somarDias(hoje, 1) }) },
  semana: { rotulo: 'Próximos 7 dias', janela: (hoje) => ({ inicio: hoje, fim: somarDias(hoje, 6) }) },
  passados: { rotulo: 'Últimos 30 dias', janela: (hoje) => ({ inicio: somarDias(hoje, -30), fim: somarDias(hoje, -1) }) },
  personalizado: { rotulo: 'Personalizado', janela: null },
};

export function janelaDoPeriodo(periodo, hoje, { inicio, fim } = {}) {
  if (periodo !== 'personalizado') return PERIODOS[periodo].janela(hoje);
  if (!inicio || !fim) return { erro: 'Informe as duas datas do período.' };
  if (fim < inicio) return { erro: 'A data final é anterior à inicial.' };
  if (somarDias(inicio, 400) < fim) return { erro: 'Período máximo de 400 dias.' };
  return { inicio, fim };
}
