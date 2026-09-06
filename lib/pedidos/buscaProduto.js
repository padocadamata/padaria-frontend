// Busca de produtos por relevância -- compartilhada entre o
// SeletorProduto de components/pedidos/PedidoForm.js e o de
// components/pedidos/CompraPresencialForm.js. Os dois componentes
// continuam deliberadamente duplicados (ciclos de vida independentes,
// ver comentário em CompraPresencialForm.js), mas a REGRA DE BUSCA em
// si -- normalização de acento + ranking por relevância -- deixou de
// ser trivial o suficiente para duplicar com segurança, então sai daqui
// como fonte única de verdade para os dois.

// Faixa Unicode "Combining Diacritical Marks" (U+0300 a U+036F) --
// construída via String.fromCharCode (não como literal no regex) de
// proposito, para nunca depender de um caractere combinante de verdade
// sobreviver intacto em cópias/edições futuras deste arquivo.
const MARCA_DIACRITICA_INICIO = 0x0300;
const MARCA_DIACRITICA_FIM = 0x036f;
const REGEX_MARCAS_DIACRITICAS = new RegExp(
  '[' + String.fromCharCode(MARCA_DIACRITICA_INICIO) + '-' + String.fromCharCode(MARCA_DIACRITICA_FIM) + ']',
  'g'
);

// trim -> NFD (decompõe acento em base + marca combinante) -> remove as
// marcas combinantes -> lowercase. Ordem entre NFD e lowercase não
// importa para o resultado (letras acentuadas maiúsculas/minúsculas
// decompõem igualmente bem), mas trim precisa vir antes de tudo.
export function normalizarTexto(texto) {
  return (texto || '')
    .trim()
    .normalize('NFD')
    .replace(REGEX_MARCAS_DIACRITICAS, '')
    .toLowerCase();
}

// Prioridade (menor = mais relevante):
//   1) nome normalizado === busca normalizada;
//   2) nome normalizado começa com a busca;
//   3) alguma palavra do nome (separado por espaço) começa com a busca;
//   4) nome apenas contém a busca em algum lugar.
// Produto que não bate em nenhum critério fica de fora (mesmo
// comportamento do filtro anterior, que também só listava quem desse
// match). Dentro da mesma prioridade, ordena alfabeticamente por
// produto.nome (pt-BR, sensitivity: base) -- só ENTÃO aplica o limite
// visual, nunca antes.
export function buscarProdutosPorRelevancia(produtos, termoBusca, limite = 8) {
  const termo = normalizarTexto(termoBusca);
  if (!termo) return [];

  const encontrados = [];
  for (const produto of produtos) {
    const nomeNormalizado = normalizarTexto(produto.nome);
    let prioridade;
    if (nomeNormalizado === termo) {
      prioridade = 1;
    } else if (nomeNormalizado.startsWith(termo)) {
      prioridade = 2;
    } else if (nomeNormalizado.split(' ').some((palavra) => palavra.startsWith(termo))) {
      prioridade = 3;
    } else if (nomeNormalizado.includes(termo)) {
      prioridade = 4;
    } else {
      continue;
    }
    encontrados.push({ produto, prioridade });
  }

  encontrados.sort((a, b) => {
    if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
    return a.produto.nome.localeCompare(b.produto.nome, 'pt-BR', { sensitivity: 'base' });
  });

  return encontrados.slice(0, limite).map((item) => item.produto);
}
