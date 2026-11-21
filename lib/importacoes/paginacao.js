// Paginação NO SERVIDOR da lista de registros de um lote (Central de
// Importações G3). Lógica pura (testável sem React): a tela pede só a página
// atual a g3_listar_lote (limite/deslocamento) e recebe a contagem total do
// filtro junto com as linhas.

export const TAMANHOS_PAGINA = [10, 20, 50, 100];
export const TAMANHO_PAGINA_PADRAO = 20;

export function normalizarTamanho(tamanho) {
  const n = Number(tamanho);
  return TAMANHOS_PAGINA.includes(n) ? n : TAMANHO_PAGINA_PADRAO;
}

// Página pedida -> deslocamento enviado ao servidor.
export function deslocamentoDaPagina(pagina, tamanho) {
  const p = Math.max(1, Math.floor(Number(pagina) || 1));
  return (p - 1) * normalizarTamanho(tamanho);
}

// Estado exibido a partir do total devolvido pelo servidor.
export function calcularPaginacao({ pagina, tamanho, total }) {
  const t = normalizarTamanho(tamanho);
  const n = Math.max(0, Number(total) || 0);
  const totalPaginas = Math.max(1, Math.ceil(n / t));
  const paginaAtual = Math.min(Math.max(1, Math.floor(Number(pagina) || 1)), totalPaginas);
  const inicio = (paginaAtual - 1) * t;
  return {
    paginaAtual,
    totalPaginas,
    total: n,
    primeiro: n === 0 ? 0 : inicio + 1,
    ultimo: Math.min(inicio + t, n),
  };
}

const numero = (n) => Number(n).toLocaleString('pt-BR');

export function textoContador({ primeiro, ultimo, total }) {
  if (!total) return 'Nenhum registro';
  return `Exibindo ${numero(primeiro)}–${numero(ultimo)} de ${numero(total)} ${total === 1 ? 'registro' : 'registros'}`;
}

// A página vale para um "contexto" (filtro + tamanho + versão do lote): quando
// o contexto muda, a tela volta para a página 1 sem pedir antes a página antiga.
export function chaveContexto({ acao, tamanho, versao }) {
  return `${acao || 'todas'}|${normalizarTamanho(tamanho)}|${versao ?? 0}`;
}

export function paginaEfetiva(estado, contexto) {
  return estado && estado.contexto === contexto ? estado.pagina : 1;
}

// Rolagem ao trocar de página: só quando o início da tabela não está visível
// (acima da área útil, abaixo do cabeçalho fixo, ou além do fim da tela).
export function precisaRolar(topo, { alturaCabecalho = 0, alturaTela = Infinity } = {}) {
  return topo < alturaCabecalho || topo > alturaTela;
}
