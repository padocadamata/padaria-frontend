import { cx } from '../../lib/design/cx';
import styles from './Checkbox.module.css';

// Caixa de seleção com rótulo clicável e área de toque >= 44px.
export default function Checkbox({ rotulo, className, ...resto }) {
  return (
    <label className={cx(styles.linha, className)}>
      <input type="checkbox" className={styles.caixa} {...resto} />
      <span>{rotulo}</span>
    </label>
  );
}
