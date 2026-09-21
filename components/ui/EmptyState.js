import { cx } from '../../lib/design/cx';
import styles from './EmptyState.module.css';

// Estado vazio discreto (mensagem existente da tela, sem ilustração).
export default function EmptyState({ className, children }) {
  return <p className={cx(styles.vazio, className)}>{children}</p>;
}
