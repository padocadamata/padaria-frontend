import Link from 'next/link';
import { TEMA } from '../../lib/branding/tema';
import styles from './shell.module.css';

// Header compacto do mobile (<= 768px): logo oficial + contexto. A
// navegação fica na bottom navigation.
export default function MobileHeader({ titulo }) {
  return (
    <header className={styles.mobileHeader}>
      <Link href="/dashboard" className={styles.mobileLogoLink}>
        <img src={TEMA.logo.src} alt={TEMA.logo.alt} className={styles.mobileLogo} />
      </Link>
      <span className={styles.mobileTitulo}>{titulo}</span>
    </header>
  );
}
