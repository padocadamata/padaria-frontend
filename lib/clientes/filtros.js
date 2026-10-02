import { somenteDigitos } from './telefone';

// Normalização de dados do cadastro de Clientes (migration 0069). Regra
// global do projeto: nome (dado mestre curto) em MAIÚSCULAS preservando
// acentos e com espaços colapsados; observação é texto livre (só trim).
// O banco (salvar_cliente) aplica a mesma regra -- aqui é para a tela
// mostrar exatamente o que será gravado.
export function normalizarNomeCliente(texto) {
  return String(texto ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('pt-BR');
}

export function normalizarObservacao(texto) {
  const limpo = String(texto ?? '').trim();
  return limpo || null;
}

// Comparação de nome sem acento/caixa, para a busca.
function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Filtro puro da listagem (pages/clientes.js). cliente = { nome, telefone,
// ativo, produtos: [{ produto_id }] }.
//   termo   -> nome (sem acento/caixa) OU dígitos do telefone (2+ dígitos);
//   produto -> id do produto de interesse ('' = todos);
//   status  -> 'ativos' | 'inativos' | 'todos'.
export function clientePassaFiltro(cliente, { termo = '', produto = '', status = 'ativos' } = {}) {
  if (status === 'ativos' && !cliente.ativo) return false;
  if (status === 'inativos' && cliente.ativo) return false;
  if (produto && !(cliente.produtos || []).some((p) => p.produto_id === produto)) return false;

  const t = String(termo).trim();
  if (!t) return true;
  const digitos = somenteDigitos(t);
  const porNome = semAcento(cliente.nome).includes(semAcento(t));
  const porTelefone = digitos.length >= 2 && String(cliente.telefone || '').includes(digitos);
  return porNome || porTelefone;
}

// Produtos que aparecem no filtro "Produto de interesse": só os que algum
// cliente carregado tem (lista curta, ordenada por nome, sem repetição).
export function produtosComInteresse(clientes) {
  const mapa = new Map();
  for (const c of clientes || []) {
    for (const p of c.produtos || []) {
      if (!mapa.has(p.produto_id)) mapa.set(p.produto_id, { id: p.produto_id, nome: p.nome, ativo: p.ativo, disponivel: p.disponivel !== false, quantidade: 0 });
      mapa.get(p.produto_id).quantidade += 1;
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Situação de um interesse já gravado: o produto pode ter sido inativado
// ou desmarcado no Catálogo depois -- o interesse continua, só não pode
// ser readicionado enquanto não voltar a ser elegível.
export function rotuloSituacaoProduto(produto) {
  if (produto.ativo === false) return 'inativo';
  if (produto.disponivel === false) return 'indisponível';
  return '';
}
