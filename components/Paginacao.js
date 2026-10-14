import { cx } from '../lib/design/cx';
import styles from './Paginacao.module.css';

// Paginação reutilizável: Anterior | números | Próxima. Aparência do Design
// System (tokens); API e comportamento inalterados.
//
// Os números usam janela com reticências (primeira, última, atual ±1) --
// no máximo 7 itens, então nunca estoura a largura mesmo com centenas de
// páginas. Em telas estreitas (<= 768px) "Anterior" e "Próxima" dividem a
// primeira linha e os números vão para a linha de baixo, centralizados.

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

// `corPrimaria` é aceito por compatibilidade e ignorado (a cor vem do tema).
export default function Paginacao({ paginaAtual, totalPaginas, onMudarPagina, desabilitado = false }) {
  if (totalPaginas <= 1) return null;

  const janela = calcularJanelaPaginas(paginaAtual, totalPaginas);
  const naoTemAnterior = paginaAtual <= 1;
  const naoTemProxima = paginaAtual >= totalPaginas;

  return (
    <nav className={styles.raiz} aria-label="Paginação">
      <button
        type="button"
        className={cx(styles.botao, styles.anterior)}
        onClick={() => onMudarPagina(paginaAtual - 1)}
        disabled={naoTemAnterior || desabilitado}
      >
        Anterior
      </button>

      <div className={styles.numeros}>
        {janela.map((item) => {
          if (typeof item === 'string') {
            return (
              <span key={item} aria-hidden="true" className={styles.reticencias}>
                …
              </span>
            );
          }
          const ativa = item === paginaAtual;
          return (
            <button
              key={item}
              type="button"
              className={cx(styles.botao, styles.numero, ativa && styles.ativa)}
              onClick={() => onMudarPagina(item)}
              disabled={desabilitado}
              aria-label={`Página ${item}`}
              aria-current={ativa ? 'page' : undefined}
            >
              {item}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={cx(styles.botao, styles.proxima)}
        onClick={() => onMudarPagina(paginaAtual + 1)}
        disabled={naoTemProxima || desabilitado}
      >
        Próxima
      </button>
    </nav>
  );
}

// paginarLista mora em lib/paginacao (lógica pura, testável sem CSS); reexportada
// aqui para que as telas continuem importando de components/Paginacao.
export { paginarLista, TAMANHO_PAGINA_PADRAO } from '../lib/paginacao/paginarLista';
