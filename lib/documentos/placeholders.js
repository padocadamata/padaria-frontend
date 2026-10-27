// Variáveis {{chave}} dos modelos de documento (migration 0077).
//
// Mesma sintaxe da mensagem de pedido (lib/pedidos/mensagemPedido.js), mas
// núcleo próprio e mais estrito: o nome vai colado nas chaves, sem espaços
// ({{ motivo }} é inválido) -- assim a regra é idêntica no banco, que
// valida o modelo ao salvar e resolve o texto ao emitir. Sem expressões,
// filtros ou condicionais: {{x}} só é trocado pelo valor de x.
//
// Dois grupos:
//   * AUTOMÁTICAS -- catálogo fixo abaixo, com ponto ({{funcionario.nome}})
//     ou da emissão ({{data_emissao}}); o sistema preenche.
//   * CAMPOS DO MODELO -- chave simples sem ponto ({{motivo}}), preenchida
//     no formulário de emissão.

// Mesmos padrões da migration (folha_documentos_placeholders).
const PADRAO_TOKEN = /\{\{([^{}]*)\}\}/g;
const NOME_VALIDO = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;

// Catálogo ÚNICO das automáticas. somenteIndividual: só existe em modelo
// individual (documento geral não tem funcionário). A ordem é a da lista de
// variáveis do editor de modelo.
export const VARIAVEIS_AUTOMATICAS = [
  { chave: 'funcionario.nome', descricao: 'Nome do funcionário', somenteIndividual: true },
  { chave: 'funcionario.cpf', descricao: 'CPF do funcionário (000.000.000-00)', somenteIndividual: true },
  { chave: 'funcionario.rg', descricao: 'RG do funcionário', somenteIndividual: true },
  { chave: 'funcionario.cargo', descricao: 'Cargo do funcionário', somenteIndividual: true },
  { chave: 'funcionario.admissao', descricao: 'Data de admissão (dd/mm/aaaa)', somenteIndividual: true },
  { chave: 'empresa.nome', descricao: 'Nome da empresa (nome fantasia)', somenteIndividual: false },
  { chave: 'empresa.razao_social', descricao: 'Razão social', somenteIndividual: false },
  { chave: 'empresa.cnpj', descricao: 'CNPJ (00.000.000/0000-00)', somenteIndividual: false },
  { chave: 'empresa.endereco', descricao: 'Endereço da empresa', somenteIndividual: false },
  { chave: 'empresa.cidade_uf', descricao: 'Cidade/UF da empresa', somenteIndividual: false },
  { chave: 'empresa.responsavel', descricao: 'Nome do responsável pela empresa', somenteIndividual: false },
  { chave: 'empresa.responsavel_cargo', descricao: 'Cargo do responsável', somenteIndividual: false },
  { chave: 'data_emissao', descricao: 'Data de emissão (dd/mm/aaaa)', somenteIndividual: false },
  { chave: 'data_emissao_extenso', descricao: 'Data de emissão por extenso (26 de outubro de 2026)', somenteIndividual: false },
  { chave: 'documento.numero', descricao: 'Número do documento (2026/0001)', somenteIndividual: false },
];

const AUTOMATICAS = new Map(VARIAVEIS_AUTOMATICAS.map((v) => [v.chave, v]));

// Chaves que um campo do modelo NÃO pode usar: as automáticas sem ponto e
// os prefixos dos grupos (evita {{funcionario}} ao lado de
// {{funcionario.nome}}).
export const CHAVES_RESERVADAS = ['funcionario', 'empresa', 'documento', 'data_emissao', 'data_emissao_extenso'];

export function ehAutomatica(nome) {
  return AUTOMATICAS.has(nome);
}

export function automaticaSomenteIndividual(nome) {
  return AUTOMATICAS.get(nome)?.somenteIndividual === true;
}

export function variaveisDoEscopo(abrangencia) {
  return VARIAVEIS_AUTOMATICAS.filter((v) => abrangencia === 'individual' || !v.somenteIndividual);
}

// Lê os {{...}} do texto. nomes: cada variável UMA vez, na ordem da 1ª
// aparição (repetir a mesma variável é permitido). malformado: algum
// {{...}} com nome fora do formato, ou "{{"/"}}" solto.
export function analisarPlaceholders(corpo) {
  const texto = String(corpo ?? '');
  const nomes = [];
  let malformado = /\{\{|\}\}/.test(texto.replace(PADRAO_TOKEN, ''));
  for (const m of texto.matchAll(PADRAO_TOKEN)) {
    if (!NOME_VALIDO.test(m[1])) {
      malformado = true;
      continue;
    }
    if (!nomes.includes(m[1])) nomes.push(m[1]);
  }
  return { nomes, malformado };
}

// Troca cada {{nome}} pelo valor em `variaveis`, numa ÚNICA passada (um
// valor digitado que contenha "{{...}}" nunca é resolvido de novo). Mesmo
// algoritmo de folha_documentos_resolver: corta o texto nos tokens e
// intercala os valores. Variável sem valor (ausente ou null): usa
// `ausente(nome)` se informado (prévia), senão lança erro.
export function resolverTemplate(corpo, variaveis, { ausente } = {}) {
  const texto = String(corpo ?? '');
  const partes = texto.split(/\{\{[^{}]*\}\}/);
  const tokens = [...texto.matchAll(PADRAO_TOKEN)].map((m) => m[1]);
  let saida = partes[0];
  tokens.forEach((nome, i) => {
    let valor = Object.prototype.hasOwnProperty.call(variaveis, nome) ? variaveis[nome] : null;
    if (valor === null || valor === undefined) {
      if (!ausente) throw new Error(`Variável sem valor: {{${nome}}}`);
      valor = ausente(nome);
    }
    saida += String(valor) + partes[i + 1];
  });
  return saida;
}
