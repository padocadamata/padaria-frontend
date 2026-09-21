import { cx } from '../../lib/design/cx';
import styles from './Badge.module.css';

// Selo de status (pílula). Tons: neutral | primary | success | warning |
// danger | info. Sempre leva texto -- cor sozinha nunca comunica o status.
export default function Badge({ tom = 'neutral', className, children }) {
  return <span className={cx(styles.badge, styles[tom], className)}>{children}</span>;
}
