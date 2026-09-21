import Icon from './Icon';
import { cx } from '../../lib/design/cx';
import styles from './Card.module.css';

// Superfície branca padrão (borda fina, raio 12, sombra leve). Com `titulo`
// renderiza o cabeçalho do card: ícone opcional, título (16/600), subtítulo
// auxiliar e uma área de ação à direita.
export default function Card({ titulo, subtitulo, icone, acao, className, children, ...resto }) {
  const temCabecalho = Boolean(titulo || acao);

  return (
    <section className={cx(styles.card, className)} {...resto}>
      {temCabecalho && (
        <header className={styles.cabecalho}>
          <div className={styles.titulos}>
            {icone && (
              <span className={styles.icone}>
                <Icon nome={icone} tamanho={18} />
              </span>
            )}
            <div className={styles.textos}>
              {titulo && <h2 className={styles.titulo}>{titulo}</h2>}
              {subtitulo && <p className={styles.subtitulo}>{subtitulo}</p>}
            </div>
          </div>
          {acao && <div className={styles.acao}>{acao}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
