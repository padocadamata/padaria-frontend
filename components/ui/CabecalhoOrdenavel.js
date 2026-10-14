import Icon from './Icon';
import { cx } from '../../lib/design/cx';
import { rotulosDirecao } from '../../lib/ordenacao/comparadores';
import styles from './CabecalhoOrdenavel.module.css';

// Conteúdo de um <th> ordenável: botão (foco por teclado, aria-label com o
// sentido atual e o próximo) + seta de direção. A seta ocupa SEMPRE o mesmo
// espaço (visível só na coluna ativa; esmaecida no hover/foco das demais),
// então ativar a ordenação nunca muda a largura do cabeçalho. O <th> que o
// contém é quem declara aria-sort.
//
// Usado pelo DataTable e por tabelas próprias (ex.: grade da Escala Mensal).
export default function CabecalhoOrdenavel({ rotulo, tipo = 'texto', ativa = false, direcao, alinharDireita = false, onOrdenar }) {
  const rotulos = rotulosDirecao(tipo);
  const proxima = ativa && direcao === 'asc' ? 'desc' : 'asc';
  const descricao = ativa
    ? `${rotulo}: ordenado ${rotulos[direcao]}. Clique para ordenar ${rotulos[proxima]}.`
    : `Ordenar por ${rotulo} (${rotulos.asc})`;
  return (
    <button
      type="button"
      className={cx(styles.botao, ativa && styles.botaoAtivo, alinharDireita && styles.botaoDir)}
      onClick={onOrdenar}
      title={descricao}
      aria-label={descricao}
    >
      <span className={styles.rotulo}>{rotulo}</span>
      <span className={styles.seta} aria-hidden="true">
        <Icon nome={ativa && direcao === 'desc' ? 'chevronDown' : 'chevronUp'} tamanho={14} />
      </span>
    </button>
  );
}

// Valor de aria-sort para o <th> (undefined quando a coluna não é a ativa).
export function ariaSort(ativa, direcao) {
  if (!ativa) return undefined;
  return direcao === 'desc' ? 'descending' : 'ascending';
}
