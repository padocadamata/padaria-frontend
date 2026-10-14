// Comparadores ÚNICOS de ordenação do sistema (tabelas e opções de filtro).
// Nenhuma tela escreve a própria regra de "A → Z": todas passam por aqui,
// para que acento, caixa, espaços e vazios se comportem igual em todo lugar.
//
// Regras:
//  - texto: pt-BR (Intl.Collator), sem diferença de caixa nem de acento
//    para fins de ordem (Café ~ cafe ~ CAFÉ), números dentro do texto em
//    ordem natural ("Pão 2" antes de "Pão 10") e trim antes de comparar;
//  - vazio/nulo vai SEMPRE para o fim, nos dois sentidos -- "crescente"
//    nunca joga as linhas sem valor para o topo (mesma convenção que o
//    Catálogo já usava);
//  - empate devolve 0: o chamador usa sort estável (Array#sort é estável),
//    então a ordem padrão da tela desempata.

const COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

function textoNormalizado(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

function ehVazio(valor) {
  return valor == null || (typeof valor === 'string' && valor.trim() === '') || (typeof valor === 'number' && Number.isNaN(valor));
}

// Compara dois textos em pt-BR (sem direção; vazios por último).
export function compararTexto(a, b) {
  const x = textoNormalizado(a);
  const y = textoNormalizado(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return COLLATOR.compare(x, y);
}

function paraNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim() !== '') return Number(valor);
  return NaN;
}

// Ordem "natural" por tipo, SEM vazios (eles são tratados fora, para
// ficarem por último independentemente da direção).
const BASE = {
  texto: (a, b) => COLLATOR.compare(textoNormalizado(a), textoNormalizado(b)),
  numero: (a, b) => paraNumero(a) - paraNumero(b),
  // Datas: aceita 'YYYY-MM-DD', timestamptz ISO ou Date. Strings ISO do
  // banco comparam corretamente como texto; Date vira número.
  data: (a, b) => {
    const x = a instanceof Date ? a.getTime() : Date.parse(a);
    const y = b instanceof Date ? b.getTime() : Date.parse(b);
    return x - y;
  },
  // Verdadeiro antes de falso no sentido crescente (ex.: Ativo antes de
  // Inativo) -- convenção explícita, já usada pelo Catálogo.
  booleano: (a, b) => (a === b ? 0 : a ? -1 : 1),
};
BASE.moeda = BASE.numero;

function vazioPorTipo(valor, tipo) {
  if (ehVazio(valor)) return true;
  if (tipo === 'numero' || tipo === 'moeda') return Number.isNaN(paraNumero(valor));
  if (tipo === 'data') return !(valor instanceof Date) && Number.isNaN(Date.parse(valor));
  return false;
}

// Comparação de dois valores JÁ preenchidos, por tipo. `ordem` = lista de
// valores na ordem semântica declarada (ex.: status: pendente, realizada);
// valores fora da lista ficam depois dos conhecidos.
function comparadorBase(tipo, ordem) {
  if (ordem) {
    const posicao = new Map(ordem.map((v, i) => [v, i]));
    const pos = (v) => (posicao.has(v) ? posicao.get(v) : Number.MAX_SAFE_INTEGER);
    return (a, b) => pos(a) - pos(b) || compararTexto(a, b);
  }
  const base = BASE[tipo];
  if (!base) throw new Error(`tipo de ordenação desconhecido: ${tipo}`);
  return base;
}

// Comparador de UMA coluna, sem direção; vazios por último.
export function criarComparador({ tipo = 'texto', ordem } = {}) {
  const base = comparadorBase(tipo, ordem);
  return (a, b) => {
    const va = vazioPorTipo(a, tipo);
    const vb = vazioPorTipo(b, tipo);
    if (va || vb) return va && vb ? 0 : va ? 1 : -1;
    return base(a, b);
  };
}

// Ordena uma CÓPIA de `linhas` por `valor(linha)`. Direção 'desc' inverte
// só os valores preenchidos -- vazios continuam no fim. Estável: empates
// mantêm a ordem recebida (a ordem padrão da tela).
export function ordenarLinhas(linhas, { valor, tipo = 'texto', ordem, direcao = 'asc' }) {
  const base = comparadorBase(tipo, ordem);
  const sinal = direcao === 'desc' ? -1 : 1;
  return linhas
    .map((linha, indice) => {
      const v = valor(linha);
      return { linha, indice, v, vazio: vazioPorTipo(v, tipo) };
    })
    .sort((a, b) => {
      if (a.vazio || b.vazio) {
        if (a.vazio && b.vazio) return a.indice - b.indice;
        return a.vazio ? 1 : -1;
      }
      return sinal * base(a.v, b.v) || a.indice - b.indice;
    })
    .map((x) => x.linha);
}

// Rótulos dos sentidos, pelo tipo da coluna (usados no aria-label/title do
// cabeçalho e no controle de ordenação do celular).
export function rotulosDirecao(tipo = 'texto') {
  switch (tipo) {
    case 'numero':
    case 'moeda':
      return { asc: 'menor → maior', desc: 'maior → menor' };
    case 'data':
      return { asc: 'antiga → recente', desc: 'recente → antiga' };
    case 'texto':
      return { asc: 'A → Z', desc: 'Z → A' };
    default:
      return { asc: 'crescente', desc: 'decrescente' };
  }
}
