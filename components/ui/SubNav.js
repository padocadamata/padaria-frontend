import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { cx } from '../../lib/design/cx';
import styles from './SubNav.module.css';

// Navegação INTERNA de um módulo (abas). Cada aba é um link real (rota).
// No mobile só a própria barra rola na horizontal (a página nunca), e a aba
// ativa é trazida para a área visível ao montar.
//
// itens: [{ chave, rotulo, href }]   ativo: chave do item ativo
export default function SubNav({ itens, ativo, rotulo = 'Seções' }) {
  const ativoRef = useRef(null);

  useEffect(() => {
    const el = ativoRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [ativo]);

  if (!itens || itens.length === 0) return null;

  return (
    <nav aria-label={rotulo} className={styles.nav}>
      <ul className={styles.lista}>
        {itens.map((item) => {
          const ehAtivo = item.chave === ativo;
          return (
            <li key={item.chave}>
              <Link
                href={item.href}
                ref={ehAtivo ? ativoRef : undefined}
                className={cx(styles.aba, ehAtivo && styles.ativa)}
                aria-current={ehAtivo ? 'page' : undefined}
              >
                {item.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
