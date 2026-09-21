import styles from './SectionHeader.module.css';

// Título de seção dentro da página (18/600), com ação opcional à direita.
export default function SectionHeader({ titulo, id, acao }) {
  return (
    <div className={styles.secao}>
      <h2 id={id} className={styles.titulo}>
        {titulo}
      </h2>
      {acao && <div>{acao}</div>}
    </div>
  );
}
