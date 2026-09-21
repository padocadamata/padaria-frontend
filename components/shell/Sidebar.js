import { useState } from 'react';
import Link from 'next/link';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import { TEMA } from '../../lib/branding/tema';
import { cx } from '../../lib/design/cx';
import { moduloEstaAtivo, subitemEstaAtivo } from '../../lib/nav/navegacao';
import styles from './shell.module.css';

// Sidebar desktop (>= 769px). Fundo na cor primária -- o logo oficial é
// off-white sobre fundo transparente, feito para fundo escuro.
//
// Cada módulo é um LINK real (<a>); módulos com abas internas (Produção,
// Pedidos) ganham um botão de expandir/recolher com as sub-rotas reais,
// filtradas pelas mesmas permissões das navegações atuais. No modo compacto
// (só ícones) o rótulo some da tela, então o link passa a ter aria-label e
// title com o nome do módulo.
export default function Sidebar({ principais, admin, pathname, compacta }) {
  // Expansão manual dos subitens; sem escolha manual, o módulo ativo abre.
  const [manual, setManual] = useState({});

  function estaExpandido(item, ativo) {
    return item.chave in manual ? manual[item.chave] : ativo;
  }

  function alternar(item, ativo) {
    setManual((atual) => ({ ...atual, [item.chave]: !estaExpandido(item, ativo) }));
  }

  function renderItem(item) {
    const ativo = moduloEstaAtivo(pathname, item.rota);
    const temSub = item.subitens.length > 0;
    const expandido = temSub && estaExpandido(item, ativo);
    const idSub = `subitens-${item.chave}`;

    return (
      <li key={item.chave}>
        <div className={styles.linhaItem}>
          <Link
            href={item.rota}
            className={cx(styles.link, ativo && styles.ativo)}
            aria-current={ativo ? (temSub ? 'true' : 'page') : undefined}
            aria-label={compacta ? item.rotulo : undefined}
            title={compacta ? item.rotulo : undefined}
          >
            <Icon nome={item.icone} tamanho={20} />
            <span className={styles.rotulo}>{item.rotulo}</span>
          </Link>

          {temSub && !compacta && (
            <IconButton
              icone={expandido ? 'chevronUp' : 'chevronDown'}
              tom="inverso"
              tamanho="sm"
              rotulo={`${expandido ? 'Recolher' : 'Expandir'} ${item.rotulo}`}
              aria-expanded={expandido}
              aria-controls={idSub}
              onClick={() => alternar(item, ativo)}
              className={styles.expansor}
            />
          )}
        </div>

        {expandido && !compacta && (
          <ul id={idSub} className={styles.sublista}>
            {item.subitens.map((sub) => {
              const subAtivo = subitemEstaAtivo(pathname, sub.rota);
              return (
                <li key={sub.chave}>
                  <Link
                    href={sub.rota}
                    className={cx(styles.sublink, subAtivo && styles.subativo)}
                    aria-current={subAtivo ? 'page' : undefined}
                  >
                    {sub.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <aside id="menu-lateral" className={styles.sidebar}>
      <div className={styles.marca}>
        <Link href="/dashboard" className={styles.marcaLink}>
          <img src={TEMA.logo.src} alt={TEMA.logo.alt} className={styles.logo} />
        </Link>
      </div>

      <nav aria-label="Navegação principal" className={styles.nav}>
        <ul className={styles.lista}>{principais.map(renderItem)}</ul>

        {admin.length > 0 && (
          <>
            <p className={styles.grupoTitulo}>Administração</p>
            <hr className={styles.grupoSeparador} />
            <ul className={styles.lista}>{admin.map(renderItem)}</ul>
          </>
        )}
      </nav>
    </aside>
  );
}
