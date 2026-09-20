// Paginação reutilizável: Anterior | números | Próxima.
//
// Os números usam janela com reticências (primeira, última, atual ±1) --
// no máximo 7 itens, então nunca estoura a largura mesmo com centenas de
// páginas. Em telas estreitas (<= 600px) "Anterior" e "Próxima" dividem a
// primeira linha e os números vão para a linha de baixo, centralizados.
// O @media fica num <style> com classes prefixadas porque o projeto usa
// estilos inline e não tem CSS global.

export function calcularJanelaPaginas(paginaAtual, totalPaginas) {
  if (totalPaginas <= 7) {
    return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  }

  const itens = [1];
  const inicio = Math.max(2, paginaAtual - 1);
  const fim = Math.min(totalPaginas - 1, paginaAtual + 1);

  // Reticências só quando escondem 2+ páginas; se escondessem só uma,
  // mostra a própria página (continua no máximo 7 itens).
  if (inicio === 3) itens.push(2);
  else if (inicio > 3) itens.push('...inicio');
  for (let p = inicio; p <= fim; p += 1) itens.push(p);
  if (fim === totalPaginas - 2) itens.push(totalPaginas - 1);
  else if (fim < totalPaginas - 2) itens.push('...fim');

  itens.push(totalPaginas);
  return itens;
}

const CSS = `
.pag-raiz { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; margin-top: 18px; }
.pag-numeros { display: flex; align-items: center; justify-content: center; gap: 6px; }
.pag-btn { min-width: 40px; min-height: 40px; padding: 0 12px; border-radius: 5px; font-size: 14px; box-sizing: border-box; }
@media (max-width: 600px) {
  .pag-raiz { gap: 10px; }
  .pag-anterior { order: 1; flex: 1 1 40%; }
  .pag-proxima { order: 2; flex: 1 1 40%; }
  .pag-numeros { order: 3; flex: 1 1 100%; }
}
`;

export default function Paginacao({ paginaAtual, totalPaginas, onMudarPagina, desabilitado = false, corPrimaria = '#8B4513' }) {
  if (totalPaginas <= 1) return null;

  const janela = calcularJanelaPaginas(paginaAtual, totalPaginas);
  const naoTemAnterior = paginaAtual <= 1;
  const naoTemProxima = paginaAtual >= totalPaginas;

  function estiloBotao(desativado) {
    return {
      backgroundColor: 'white',
      color: desativado ? '#aaa' : corPrimaria,
      border: `1px solid ${desativado ? '#ddd' : corPrimaria}`,
      cursor: desativado ? 'not-allowed' : 'pointer',
    };
  }

  return (
    <nav className="pag-raiz" aria-label="Paginação">
      <style>{CSS}</style>

      <button
        type="button"
        className="pag-btn pag-anterior"
        onClick={() => onMudarPagina(paginaAtual - 1)}
        disabled={naoTemAnterior || desabilitado}
        style={estiloBotao(naoTemAnterior || desabilitado)}
      >
        Anterior
      </button>

      <div className="pag-numeros">
        {janela.map((item) => {
          if (typeof item === 'string') {
            return (
              <span key={item} aria-hidden="true" style={{ minWidth: '20px', textAlign: 'center', color: '#888' }}>
                …
              </span>
            );
          }
          const ativa = item === paginaAtual;
          return (
            <button
              key={item}
              type="button"
              className="pag-btn"
              onClick={() => onMudarPagina(item)}
              disabled={desabilitado}
              aria-label={`Página ${item}`}
              aria-current={ativa ? 'page' : undefined}
              style={{
                backgroundColor: ativa ? corPrimaria : 'white',
                color: ativa ? 'white' : corPrimaria,
                border: `1px solid ${corPrimaria}`,
                fontWeight: ativa ? 'bold' : 'normal',
                cursor: desabilitado ? 'wait' : 'pointer',
                padding: '0 6px',
              }}
            >
              {item}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="pag-btn pag-proxima"
        onClick={() => onMudarPagina(paginaAtual + 1)}
        disabled={naoTemProxima || desabilitado}
        style={estiloBotao(naoTemProxima || desabilitado)}
      >
        Próxima
      </button>
    </nav>
  );
}

// Paginação VISUAL de uma lista que já está inteira em memória (telas cujo
// conjunto completo precisa existir para outros cálculos/edições). Fatia a
// lista e já devolve a página "efetiva": se a lista encolher e a página
// pedida deixar de existir (filtro, exclusão, recarga), cai na última
// página válida -- a tela nunca renderiza uma página vazia.
export const TAMANHO_PAGINA_PADRAO = 20;

export function paginarLista(lista, pagina, tamanho = TAMANHO_PAGINA_PADRAO) {
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * tamanho;
  return {
    itens: lista.slice(inicio, inicio + tamanho),
    paginaAtual,
    totalPaginas,
    total,
    primeiro: total === 0 ? 0 : inicio + 1,
    ultimo: Math.min(inicio + tamanho, total),
  };
}
