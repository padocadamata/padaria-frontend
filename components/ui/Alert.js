import Icon from './Icon';
import { cx } from '../../lib/design/cx';
import styles from './Alert.module.css';

const ICONE = { success: 'check', danger: 'alert', warning: 'alert', info: 'info' };

// Mensagem de feedback (sucesso, erro, aviso, informação). Erros usam
// role="alert" (anunciado na hora); os demais role="status".
export default function Alert({ tom = 'info', className, children, ...resto }) {
  return (
    <div role={tom === 'danger' ? 'alert' : 'status'} className={cx(styles.alerta, styles[tom], className)} {...resto}>
      <span className={styles.icone}>
        <Icon nome={ICONE[tom]} tamanho={18} />
      </span>
      <div className={styles.texto}>{children}</div>
    </div>
  );
}
