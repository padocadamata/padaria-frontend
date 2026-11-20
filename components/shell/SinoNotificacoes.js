import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Icon from '../ui/Icon';
import ItemNotificacao from '../notificacoes/ItemNotificacao';
import { cx } from '../../lib/design/cx';
import { useNotificacoes } from '../../hooks/useNotificacoes';
import { rotuloAcessivelDoSino, textoContador } from '../../lib/notificacoes/tipos';
import styles from '../notificacoes/notificacoes.module.css';

// Sino da Central de Notificações (migration 0080), no canto superior direito.
// variante 'topbar' (desktop, fundo claro) ou 'mobile' (header do celular,
// fundo da cor primária). No desktop o painel abre ancorado ao sino; no
// celular, ocupa a largura da tela entre o header e a navegação inferior --
// SEM overlay e sem cobrir a bottom nav (tocar nela fecha o painel e navega
// normalmente).
//
// Padrão "disclosure" (mesmo do UserMenu): botão com aria-expanded; Esc
// fecha e devolve o foco; clique/toque fora fecha; trocar de rota fecha.
export default function SinoNotificacoes({ variante = 'topbar' }) {
  const router = useRouter();
  const {
    habilitado,
    disponivel,
    naoLidas,
    recentes,
    carregandoRecentes,
    erroRecentes,
    carregarRecentes,
    marcarLidas,
    marcarTodas,
  } = useNotificacoes();
  const [aberto, setAberto] = useState(false);
  const [erroAcao, setErroAcao] = useState('');
  const raizRef = useRef(null);
  const botaoRef = useRef(null);
  const idPainel = `painel-notificacoes-${variante}`;

  const fechar = useCallback((devolverFoco = false) => {
    setAberto(false);
    if (devolverFoco) botaoRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;

    function aoClicarFora(evento) {
      if (raizRef.current && !raizRef.current.contains(evento.target)) setAberto(false);
    }
    function aoTeclar(evento) {
      if (evento.key === 'Escape') fechar(true);
    }

    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('touchstart', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('touchstart', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto, fechar]);

  useEffect(() => {
    const aoNavegar = () => setAberto(false);
    router.events?.on('routeChangeStart', aoNavegar);
    return () => router.events?.off('routeChangeStart', aoNavegar);
  }, [router.events]);

  if (!habilitado || !disponivel) return null;

  function alternar() {
    const abrir = !aberto;
    setAberto(abrir);
    setErroAcao('');
    if (abrir) carregarRecentes();
  }

  async function executar(acao) {
    setErroAcao('');
    try {
      await acao();
    } catch {
      setErroAcao('Não foi possível atualizar agora. Tente de novo.');
    }
  }

  function abrirRegistro(n) {
    if (!n.lida_em) executar(() => marcarLidas([n.id]));
    setAberto(false);
  }

  const contador = textoContador(naoLidas);
  const algumaNaoLida = naoLidas > 0 || recentes.some((n) => !n.lida_em);

  return (
    <div className={cx(styles.sino, variante === 'mobile' && styles.sinoMobile)} ref={raizRef}>
      <button
        ref={botaoRef}
        type="button"
        className={cx(styles.sinoBotao, variante === 'mobile' && styles.sinoBotaoMobile)}
        aria-label={rotuloAcessivelDoSino(naoLidas)}
        title={rotuloAcessivelDoSino(naoLidas)}
        aria-expanded={aberto}
        aria-controls={idPainel}
        onClick={alternar}
      >
        <Icon nome="bell" tamanho={22} />
        {contador && (
          <span className={styles.contador} aria-hidden="true">
            {contador}
          </span>
        )}
      </button>

      {aberto && (
        <div
          id={idPainel}
          className={cx(styles.painel, variante === 'mobile' && styles.painelMobile)}
          role="region"
          aria-label="Notificações"
        >
          <div className={styles.painelTopo}>
            <h2 className={styles.painelTitulo}>Notificações</h2>
            <button
              type="button"
              className={styles.acaoBotao}
              onClick={() => executar(marcarTodas)}
              disabled={!algumaNaoLida}
            >
              <Icon nome="check" tamanho={16} />
              Marcar todas como lidas
            </button>
          </div>

          {erroAcao && (
            <p className={styles.painelErro} role="alert">
              {erroAcao}
            </p>
          )}

          <div className={styles.painelLista} aria-live="polite" aria-busy={carregandoRecentes}>
            {carregandoRecentes && recentes.length === 0 ? (
              <p className={styles.painelVazio}>Carregando…</p>
            ) : erroRecentes ? (
              <p className={styles.painelErro} role="alert">
                {erroRecentes}
              </p>
            ) : recentes.length === 0 ? (
              <p className={styles.painelVazio}>Nenhuma notificação por aqui.</p>
            ) : (
              <ul className={styles.lista}>
                {recentes.map((n) => (
                  <ItemNotificacao
                    key={n.id}
                    notificacao={n}
                    compacto
                    onAbrir={abrirRegistro}
                    onMarcarLida={(item) => executar(() => marcarLidas([item.id]))}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className={styles.painelRodape}>
            <Link href="/notificacoes" className={styles.acaoLink} onClick={() => setAberto(false)}>
              Ver histórico completo
              <Icon nome="chevronRight" tamanho={16} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
