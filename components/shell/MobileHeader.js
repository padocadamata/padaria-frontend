import Link from 'next/link';
import { TEMA } from '../../lib/branding/tema';
import SinoNotificacoes from './SinoNotificacoes';
import styles from './shell.module.css';

// Header compacto do mobile (<= 768px): logo oficial, contexto e o sino da
// Central de Notificações (migration 0080) no canto direito. A navegação
// fica na bottom navigation.
export default function MobileHeader({ titulo }) {
  return (
    <header className={styles.mobileHeader}>
      <Link href="/dashboard" className={styles.mobileLogoLink}>
        <img src={TEMA.logo.src} alt={TEMA.logo.alt} className={styles.mobileLogo} />
      </Link>
      <div className={styles.mobileDireita}>
        <span className={styles.mobileTitulo}>{titulo}</span>
        <SinoNotificacoes variante="mobile" />
      </div>
    </header>
  );
}
