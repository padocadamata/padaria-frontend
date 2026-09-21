import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from '../ui/Icon';
import { cx } from '../../lib/design/cx';
import styles from './shell.module.css';

// Menu do usuário na topbar: identifica quem está logado e concentra "Meu
// perfil" (só se a pessoa tiver a permissão de perfil) e "Sair". Padrão
// "disclosure": botão com aria-expanded + lista de links/botões (sem
// role="menu", que exigiria navegação por setas). Fecha com Esc (devolvendo
// o foco ao botão) e ao clicar/tocar fora.
export default function UserMenu({ usuario, perfil, onSair }) {
  const [aberto, setAberto] = useState(false);
  const raizRef = useRef(null);
  const botaoRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;

    function aoClicarFora(evento) {
      if (raizRef.current && !raizRef.current.contains(evento.target)) setAberto(false);
    }
    function aoTeclar(evento) {
      if (evento.key === 'Escape') {
        setAberto(false);
        botaoRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('touchstart', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('touchstart', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  return (
    <div className={styles.usuario} ref={raizRef}>
      <button
        ref={botaoRef}
        type="button"
        className={styles.usuarioBotao}
        aria-expanded={aberto}
        aria-controls="menu-usuario"
        onClick={() => setAberto((valor) => !valor)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {usuario.iniciais}
        </span>
        <span className={styles.usuarioNome}>{usuario.nome}</span>
        <Icon nome="chevronDown" tamanho={16} />
      </button>

      {aberto && (
        <div id="menu-usuario" className={styles.dropdown}>
          <div className={styles.dropdownCabecalho}>
            <span className={styles.dropdownNome}>{usuario.nome}</span>
            {usuario.email && <span className={styles.dropdownEmail}>{usuario.email}</span>}
          </div>

          {perfil && (
            <Link href={perfil.rota} className={styles.dropdownItem} onClick={() => setAberto(false)}>
              <Icon nome="user" tamanho={18} />
              {perfil.rotulo}
            </Link>
          )}

          <button type="button" className={cx(styles.dropdownItem, styles.sair)} onClick={onSair}>
            <Icon nome="logout" tamanho={18} />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
