import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useAuth } from '../../hooks/useAuth';
import { TEMA } from '../../lib/branding/tema';
import { MQ_ABAIXO_DESKTOP } from '../../lib/design/breakpoints';
import { cx } from '../../lib/design/cx';
import { destinosMobile, navegacaoDoUsuario } from '../../lib/nav/navegacao';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileHeader from './MobileHeader';
import BottomNav from './BottomNav';
import styles from './shell.module.css';

const CHAVE_PREFERENCIA_SIDEBAR = 'padoca.sidebar';

function iniciaisDe(texto) {
  const partes = String(texto || '')
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Casca do Design System: sidebar + topbar + conteúdo no desktop; header
// compacto + bottom navigation no mobile (<= 768px). Só é usada pelas telas
// já migradas (por enquanto o Dashboard) -- as demais continuam com o
// cabeçalho/navegação antigos até serem migradas.
//
// Autorização: este componente NÃO decide acesso. Continua dentro de
// <RequireAuth permissao=...> em cada página; a navegação só EXIBE o que
// useAuth().permissoes (perfil-base + overrides individuais) já libera, via
// lib/nav/navegacao.js -> moduloVisivel().
//
// `titulo` é o contexto mostrado na topbar/header mobile e no <title>.
export default function PageShell({ titulo, children }) {
  const router = useRouter();
  const { permissoes, perfilUsuario, usuarioAuth, signOut } = useAuth();
  const pathname = router.pathname;

  const navegacao = useMemo(() => navegacaoDoUsuario(permissoes), [permissoes]);
  const mobile = useMemo(() => destinosMobile(permissoes), [permissoes]);

  // Sidebar: preferência explícita do usuário (salva neste navegador) ou,
  // sem preferência, compacta abaixo de 1024px e expandida acima.
  const [preferencia, setPreferencia] = useState(null); // 'expandida' | 'recolhida' | null
  const [abaixoDesktop, setAbaixoDesktop] = useState(false);

  useEffect(() => {
    try {
      const salva = window.localStorage.getItem(CHAVE_PREFERENCIA_SIDEBAR);
      if (salva === 'expandida' || salva === 'recolhida') setPreferencia(salva);
    } catch {
      // localStorage indisponível (modo privado etc.): segue sem persistir.
    }

    const consulta = window.matchMedia(MQ_ABAIXO_DESKTOP);
    const atualizar = () => setAbaixoDesktop(consulta.matches);
    atualizar();
    consulta.addEventListener('change', atualizar);
    return () => consulta.removeEventListener('change', atualizar);
  }, []);

  // O fundo do <body> e a margem padrão só mudam enquanto o shell está
  // montado; ao navegar para uma página antiga o efeito é desfeito.
  useEffect(() => {
    document.body.classList.add('ds-body');
    return () => document.body.classList.remove('ds-body');
  }, []);

  const compacta = preferencia ? preferencia === 'recolhida' : abaixoDesktop;

  const alternarSidebar = useCallback(() => {
    const proxima = compacta ? 'expandida' : 'recolhida';
    setPreferencia(proxima);
    try {
      window.localStorage.setItem(CHAVE_PREFERENCIA_SIDEBAR, proxima);
    } catch {
      // ignora
    }
  }, [compacta]);

  const sair = useCallback(async () => {
    await signOut();
    router.push('/');
  }, [signOut, router]);

  const nome = perfilUsuario?.nome || usuarioAuth?.email || 'Usuário';
  const usuario = {
    nome,
    email: usuarioAuth?.email || '',
    iniciais: iniciaisDe(perfilUsuario?.nome || usuarioAuth?.email),
  };

  return (
    <div className={cx('ds', styles.shell)} data-compacta={compacta ? 'true' : 'false'}>
      <Head>
        <title>{`${titulo} · ${TEMA.nomeEmpresa}`}</title>
        {/* viewport-fit=cover só enquanto o shell está montado: habilita
            env(safe-area-inset-*) no iPhone sem mexer nas páginas antigas. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <a href="#conteudo-principal" className={styles.pular}>
        Pular para o conteúdo
      </a>

      <Sidebar
        principais={navegacao.principais}
        admin={navegacao.admin}
        pathname={pathname}
        compacta={compacta}
      />

      <div className={styles.coluna}>
        <Topbar
          titulo={titulo}
          compacta={compacta}
          onAlternarSidebar={alternarSidebar}
          usuario={usuario}
          perfil={navegacao.perfil}
          onSair={sair}
        />
        <MobileHeader titulo={titulo} />

        <main id="conteudo-principal" className={styles.conteudo}>
          {children}
        </main>
      </div>

      <BottomNav pathname={pathname} destinos={mobile} usuario={usuario} onSair={sair} />
    </div>
  );
}
