import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import { cx } from '../../lib/design/cx';
import { moduloEstaAtivo } from '../../lib/nav/navegacao';
import styles from './shell.module.css';

const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Bottom sheet "Mais": os módulos que não couberam nos 4 destinos diretos,
// o grupo administrativo, o perfil e "Sair". role="dialog" + aria-modal;
// foco vai para o botão fechar ao abrir, Tab fica preso dentro do sheet,
// Esc fecha e o foco volta ao botão "Mais". A rolagem do fundo é travada
// enquanto está aberto.
function MaisSheet({ pathname, maisModulos, maisAdmin, maisPerfil, usuario, onSair, onFechar }) {
  const sheetRef = useRef(null);
  // onFechar muda a cada render do pai; a ref evita reexecutar o efeito (e
  // refocar/religar a trava de rolagem) a cada re-render.
  const onFecharRef = useRef(onFechar);
  onFecharRef.current = onFechar;

  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.querySelector(SELETOR_FOCAVEL)?.focus(); // 1º focável = botão Fechar

    function aoTeclar(evento) {
      if (evento.key === 'Escape') {
        onFecharRef.current();
        return;
      }
      if (evento.key !== 'Tab' || !sheetRef.current) return;

      const focaveis = [...sheetRef.current.querySelectorAll(SELETOR_FOCAVEL)];
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener('keydown', aoTeclar);
    };
  }, []);

  function itemLink(item) {
    const ativo = moduloEstaAtivo(pathname, item.rota);
    return (
      <li key={item.chave}>
        <Link
          href={item.rota}
          className={cx(styles.sheetItem, ativo && styles.sheetItemAtivo)}
          aria-current={ativo ? 'page' : undefined}
          onClick={onFechar}
        >
          <Icon nome={item.icone} tamanho={22} />
          {item.rotulo}
        </Link>
      </li>
    );
  }

  return (
    <div className={styles.overlay} onClick={onFechar}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mais-titulo"
        className={styles.sheet}
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className={styles.sheetTopo}>
          <h2 id="mais-titulo" className={styles.sheetTitulo}>
            Mais
          </h2>
          <IconButton icone="close" rotulo="Fechar" onClick={onFechar} />
        </div>

        <div className={styles.sheetUsuario}>
          <span className={styles.avatar} aria-hidden="true">
            {usuario.iniciais}
          </span>
          <div className={styles.sheetUsuarioTextos}>
            <span className={styles.dropdownNome}>{usuario.nome}</span>
            {usuario.email && <span className={styles.dropdownEmail}>{usuario.email}</span>}
          </div>
        </div>

        {maisModulos.length > 0 && <ul className={styles.sheetLista}>{maisModulos.map(itemLink)}</ul>}

        {maisAdmin.length > 0 && (
          <>
            <p className={styles.sheetGrupo}>Administração</p>
            <ul className={styles.sheetLista}>{maisAdmin.map(itemLink)}</ul>
          </>
        )}

        <p className={styles.sheetGrupo}>Conta</p>
        <ul className={styles.sheetLista}>
          {maisPerfil && itemLink(maisPerfil)}
          <li>
            <button type="button" className={cx(styles.sheetItem, styles.sair)} onClick={onSair}>
              <Icon nome="logout" tamanho={22} />
              Sair
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

// Bottom navigation (<= 768px, fixa): até 4 destinos diretos + "Mais".
// Os destinos vêm de destinosMobile() -- já filtrados pelas permissões
// reais. Respeita a área segura do iPhone (env(safe-area-inset-bottom)) no
// CSS; alvos de toque >= 44px.
export default function BottomNav({ pathname, destinos, usuario, onSair }) {
  const [maisAberto, setMaisAberto] = useState(false);
  const maisBotaoRef = useRef(null);

  const { diretos, maisModulos, maisAdmin, maisPerfil } = destinos;

  const algumDiretoAtivo = diretos.some((item) => moduloEstaAtivo(pathname, item.rota));
  const restoAtivo = [...maisModulos, ...maisAdmin, ...(maisPerfil ? [maisPerfil] : [])].some((item) =>
    moduloEstaAtivo(pathname, item.rota)
  );
  const maisEmDestaque = maisAberto || (!algumDiretoAtivo && restoAtivo);

  function fechar() {
    setMaisAberto(false);
    maisBotaoRef.current?.focus();
  }

  return (
    <>
      <nav className={styles.bottomNav} aria-label="Navegação principal">
        <ul className={styles.bottomLista}>
          {diretos.map((item) => {
            const ativo = moduloEstaAtivo(pathname, item.rota);
            return (
              <li key={item.chave}>
                <Link
                  href={item.rota}
                  className={cx(styles.bottomItem, ativo && styles.bottomAtivo)}
                  aria-current={ativo ? 'page' : undefined}
                >
                  <Icon nome={item.icone} tamanho={22} />
                  <span className={styles.bottomRotulo}>{item.rotuloCurto || item.rotulo}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              ref={maisBotaoRef}
              type="button"
              className={cx(styles.bottomItem, maisEmDestaque && styles.bottomAtivo)}
              aria-haspopup="dialog"
              aria-expanded={maisAberto}
              onClick={() => setMaisAberto(true)}
            >
              <Icon nome="more" tamanho={22} />
              <span className={styles.bottomRotulo}>Mais</span>
            </button>
          </li>
        </ul>
      </nav>

      {maisAberto && (
        <MaisSheet
          pathname={pathname}
          maisModulos={maisModulos}
          maisAdmin={maisAdmin}
          maisPerfil={maisPerfil}
          usuario={usuario}
          onSair={onSair}
          onFechar={fechar}
        />
      )}
    </>
  );
}
