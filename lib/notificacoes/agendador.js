// Agendador do polling da Central de Notificações (decisão aprovada: polling
// de 60 s, sem Supabase Realtime).
//
// Regras:
//   * Com a aba VISÍVEL: atualiza ao iniciar e a cada `intervaloMs`.
//   * Com a aba em segundo plano: o timer é desligado -- nenhuma requisição.
//   * Ao voltar para a aba (visibilitychange), ao focar a janela (focus) e ao
//     reabrir o app (pageshow, inclusive volta do bfcache/PWA no iPhone):
//     atualiza na hora e religa o timer.
//   * Eventos que disparam juntos (visibilitychange + focus) não geram
//     requisições duplicadas: intervalo mínimo `intervaloMinimoMs` entre
//     atualizações automáticas e nunca 2 em paralelo.
//   * forcar(): ignora o intervalo mínimo (ex.: abrir o painel, depois de
//     marcar como lida) -- mas também não dispara 2 em paralelo.
//
// Sem dependência de React/DOM real: documento/janela/timers/relógio são
// injetáveis (testado em lib/notificacoes/__tests__/agendador.test.mjs).

export const INTERVALO_PADRAO_MS = 60_000;
export const INTERVALO_MINIMO_PADRAO_MS = 5_000;

export function criarAgendadorNotificacoes({
  atualizar,
  intervaloMs = INTERVALO_PADRAO_MS,
  intervaloMinimoMs = INTERVALO_MINIMO_PADRAO_MS,
  documento = typeof document !== 'undefined' ? document : null,
  janela = typeof window !== 'undefined' ? window : null,
  agendar = (fn, ms) => setInterval(fn, ms),
  cancelar = (id) => clearInterval(id),
  agora = () => Date.now(),
} = {}) {
  if (typeof atualizar !== 'function') throw new Error('criarAgendadorNotificacoes: informe atualizar().');

  let timer = null;
  let ativo = false;
  let emAndamento = null; // Promise da atualização em curso
  let forcadoPendente = false;
  let ultimaEm = -Infinity;

  const visivel = () => !documento || documento.visibilityState !== 'hidden';

  async function executar(forcado) {
    if (!ativo) return false;
    if (emAndamento) {
      // Já há uma em curso: uma atualização FORÇADA (ex.: depois de marcar
      // como lida) roda de novo logo em seguida, para não exibir um
      // resultado anterior à ação. Automáticas são simplesmente descartadas.
      if (forcado) {
        forcadoPendente = true;
        await emAndamento;
      }
      return false;
    }
    if (!forcado && agora() - ultimaEm < intervaloMinimoMs) return false;
    ultimaEm = agora();
    emAndamento = (async () => {
      try {
        await atualizar();
      } catch {
        // Falha de rede/servidor: o próximo ciclo tenta de novo. Quem chama
        // atualizar() decide como exibir o erro.
      }
    })();
    try {
      await emAndamento;
    } finally {
      emAndamento = null;
    }
    if (forcadoPendente && ativo) {
      forcadoPendente = false;
      await executar(true);
    }
    return true;
  }

  function ligarTimer() {
    if (timer !== null) return;
    timer = agendar(() => {
      if (visivel()) executar(false);
    }, intervaloMs);
  }

  function desligarTimer() {
    if (timer === null) return;
    cancelar(timer);
    timer = null;
  }

  function aoMudarVisibilidade() {
    if (!ativo) return;
    if (visivel()) {
      executar(false);
      ligarTimer();
    } else {
      desligarTimer();
    }
  }

  function aoVoltar() {
    if (!ativo || !visivel()) return;
    executar(false);
    ligarTimer();
  }

  return {
    iniciar() {
      if (ativo) return;
      ativo = true;
      documento?.addEventListener?.('visibilitychange', aoMudarVisibilidade);
      janela?.addEventListener?.('focus', aoVoltar);
      janela?.addEventListener?.('pageshow', aoVoltar);
      if (visivel()) {
        executar(true);
        ligarTimer();
      }
    },
    parar() {
      if (!ativo) return;
      ativo = false;
      desligarTimer();
      documento?.removeEventListener?.('visibilitychange', aoMudarVisibilidade);
      janela?.removeEventListener?.('focus', aoVoltar);
      janela?.removeEventListener?.('pageshow', aoVoltar);
    },
    forcar() {
      return executar(true);
    },
    get ativo() {
      return ativo;
    },
    get timerLigado() {
      return timer !== null;
    },
  };
}
