// Pedidos > Gerar mensagem (migration 0075) -- funções PURAS.
//
// A mensagem sai do MODELO GLOBAL (public.pedidos_mensagem_config.template)
// com os dados REAIS do pedido. O que o usuário altera no preview nunca é
// gravado; o modelo só muda pelo editor (somente proprietario_admin).

// Mesmo texto inserido pela migration 0075 (o teste compara os dois). Usado
// em "Restaurar padrão" do editor e quando o modelo ainda não pode ser lido.
export const TEMPLATE_PADRAO = [
  'Olá, {{fornecedor}}!',
  '',
  'Gostaria de fazer o seguinte pedido:',
  '',
  '{{itens}}',
  '',
  'Previsão de entrega: {{previsao_entrega}}',
  'Observações: {{observacoes}}',
  '',
  'Obrigado!',
].join('\n');

export const TAMANHO_MAXIMO_TEMPLATE = 4000;

// Placeholders suportados -- todos resolvidos com dados que o detalhe do
// pedido já carrega. opcional = pode ficar vazio (ver gerarMensagemPedido).
export const PLACEHOLDERS = [
  { chave: 'fornecedor', descricao: 'Nome do fornecedor (o mesmo exibido no pedido)', opcional: false },
  { chave: 'data_pedido', descricao: 'Data do pedido (dd/mm/aaaa)', opcional: false },
  { chave: 'previsao_entrega', descricao: 'Previsão de entrega (dd/mm/aaaa); vazio em retirada ou sem previsão', opcional: true },
  { chave: 'modalidade', descricao: 'Entrega ou Retirada', opcional: false },
  { chave: 'observacoes', descricao: 'Observações do pedido; vazio quando não houver', opcional: true },
  { chave: 'itens', descricao: 'Lista dos itens: nome, quantidade pedida e unidade (uma linha por item)', opcional: false },
];

const CHAVES = new Set(PLACEHOLDERS.map((p) => p.chave));
const PADRAO_PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const MODALIDADE = { pedido_com_entrega: 'Entrega', compra_presencial: 'Retirada' };

function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '';
  const [ano, mes, dia] = String(dataYYYYMMDD).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// Quantidade pedida em pt-BR, sem zeros à direita (numeric(12,3) do banco):
// 10 -> "10", 2.5 -> "2,5", 0.125 -> "0,125".
export function formatarQuantidade(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor ?? '');
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// Uma linha por item, na ordem do detalhe do pedido. O nome é o MESMO que o
// pedido exibe como item (pedido_itens.descricao, snapshot gravado no pedido
// -- não o nome atual do catálogo); a quantidade é a PEDIDA (nunca a
// recebida) e a unidade é a do item.
export function linhasDeItens(itens) {
  return (itens || []).map((item) => {
    const unidade = (item.unidade || '').trim();
    return `- ${(item.descricao || '').trim()}: ${formatarQuantidade(item.quantidade_pedida)}${unidade ? ` ${unidade}` : ''}`;
  });
}

export function valoresDoPedido({ pedido, itens, fornecedorNome }) {
  const ehRetirada = pedido?.modalidade_compra === 'compra_presencial';
  return {
    fornecedor: (fornecedorNome || '').trim(),
    data_pedido: formatarData(pedido?.data_pedido),
    previsao_entrega: ehRetirada ? '' : formatarData(pedido?.previsao_entrega),
    modalidade: MODALIDADE[pedido?.modalidade_compra] || '',
    observacoes: (pedido?.observacoes || '').trim(),
    itens: linhasDeItens(itens).join('\n'),
  };
}

// Placeholders do texto que o sistema não conhece (ex.: {{numero_pedido}}).
export function placeholdersDesconhecidos(template) {
  const desconhecidos = new Set();
  for (const m of String(template || '').matchAll(PADRAO_PLACEHOLDER)) {
    if (!CHAVES.has(m[1])) desconhecidos.add(m[1]);
  }
  return [...desconhecidos];
}

// Validação do editor do modelo (o banco também limita o tamanho).
export function validarTemplate(template) {
  const texto = String(template ?? '');
  if (!texto.trim()) return 'O modelo não pode ficar vazio.';
  if (texto.length > TAMANHO_MAXIMO_TEMPLATE) return `O modelo pode ter no máximo ${TAMANHO_MAXIMO_TEMPLATE} caracteres.`;
  const desconhecidos = placeholdersDesconhecidos(texto);
  if (desconhecidos.length > 0) {
    return `Campo(s) desconhecido(s): ${desconhecidos.map((d) => `{{${d}}}`).join(', ')}. Use só os campos da lista.`;
  }
  if (!/\{\{\s*itens\s*\}\}/.test(texto)) return 'O modelo precisa conter {{itens}} (a lista de produtos do pedido).';
  return '';
}

// Monta a mensagem. Regras:
//  - cada placeholder conhecido vira o valor do pedido;
//  - placeholder DESCONHECIDO fica no texto como está (visível no preview, e
//    listado em `desconhecidos` para a tela avisar) -- nunca some calado;
//  - linha cujos placeholders ficaram TODOS vazios (ex.: "Observações:
//    {{observacoes}}" num pedido sem observação) é removida inteira, para
//    não sobrar rótulo sem valor; linhas sem placeholder ficam intactas;
//  - mais de uma linha em branco seguida vira uma só.
export function gerarMensagemPedido(template, dados) {
  const valores = valoresDoPedido(dados);
  const desconhecidos = placeholdersDesconhecidos(template);
  const linhas = [];
  for (const linha of String(template || '').replace(/\r\n/g, '\n').split('\n')) {
    const encontrados = [...linha.matchAll(PADRAO_PLACEHOLDER)].map((m) => m[1]);
    const conhecidos = encontrados.filter((c) => CHAVES.has(c));
    if (conhecidos.length > 0 && conhecidos.length === encontrados.length && conhecidos.every((c) => !valores[c])) continue;
    linhas.push(linha.replace(PADRAO_PLACEHOLDER, (original, chave) => (CHAVES.has(chave) ? valores[chave] : original)));
  }
  const texto = linhas
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { texto, desconhecidos };
}
