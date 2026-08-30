// Fonte única de verdade para o cálculo de datas a partir de
// public.fornecedor_regras_pedido (migration 0007). Extraído de
// components/dashboard/ProximosPedidos.js (onde essas 3 funções nasceram)
// para ser compartilhado também pela criação/edição de Pedidos
// (components/pedidos/PedidoForm.js) — mesmo comportamento, mesma
// implementação, um único lugar para corrigir se um dia precisar mudar.
//
// Convenção de dia da semana: 1=segunda..7=domingo (igual à coluna
// dia_pedido/dia_entrega de fornecedor_regras_pedido e ao restante do
// projeto, ex. components/fornecedores/FornecedorRegras.js).

// Converte Date.getDay() (0=domingo..6=sábado) para a convenção de
// fornecedor_regras_pedido (1=segunda..7=domingo). Mesma técnica segura
// de meio-dia local já usada em todo o projeto — evita que a conversão
// de fuso empurre a data para o dia anterior/seguinte.
export function diaSemanaISO(dataYYYYMMDD) {
  const diaJs = new Date(`${dataYYYYMMDD}T12:00:00`).getDay();
  return diaJs === 0 ? 7 : diaJs;
}

export function adicionarDias(dataYYYYMMDD, dias) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  data.setDate(data.getDate() + dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Data de entrega gerada por UMA ocorrência de pedido desta regra, a
// partir da data em que o pedido teria ocorrido.
//   prazo_dias: soma direta de dias_prazo.
//   dia_fixo: próxima ocorrência do dia_entrega a partir da data do
//     pedido, INCLUSIVE (se o pedido já cair no próprio dia_entrega,
//     a entrega é no mesmo dia — não empurra pra semana seguinte).
export function calcularDataEntrega(dataPedido, regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return adicionarDias(dataPedido, regra.dias_prazo);
  }
  const diferenca = (regra.dia_entrega - diaSemanaISO(dataPedido) + 7) % 7;
  return adicionarDias(dataPedido, diferenca);
}
