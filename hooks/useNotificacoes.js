import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '../lib/supabase/client';
import { useAuth } from './useAuth';
import { criarAgendadorNotificacoes } from '../lib/notificacoes/agendador';
import {
  TAMANHO_PAINEL,
  aplicarLeituraLocal,
  contarNaoLidas,
  listarNotificacoes,
  marcarComoLidas,
  marcarTodasComoLidas,
} from '../lib/notificacoes/consultas';

// Central de Notificações (migration 0080): contador de não lidas + últimas
// notificações do painel do sino, compartilhados pelos dois sinos do shell
// (Topbar no desktop, MobileHeader no celular) e pela página /notificacoes.
//
// Atualização: polling de 60 s só com a aba visível, e na hora ao voltar à
// aba/janela/app (lib/notificacoes/agendador.js). Sem Supabase Realtime.
//
// Só liga com usuário autenticado e ATIVO. O que aparece já passou pela RLS
// (perfil + permissão efetiva + autor excluído) -- o frontend não decide
// quem vê o quê.
//
// disponivel: null = ainda não sabemos; false = as RPCs da 0080 não existem
// neste banco (migration não aplicada) -> o sino some e o polling para,
// sem erro na tela; true = funcionando.
const NotificacoesContext = createContext(null);

const SEM_NOTIFICACOES = {
  habilitado: false,
  disponivel: false,
  naoLidas: 0,
  recentes: [],
  carregandoRecentes: false,
  erroRecentes: '',
  carregarRecentes: async () => {},
  marcarLidas: async () => {},
  marcarTodas: async () => {},
  atualizar: async () => {},
};

// Função/tabela inexistente (PostgREST PGRST202/PGRST205, Postgres 42883/42P01).
function ehMigrationAusente(erro) {
  const codigo = erro?.causa?.code || erro?.code;
  return codigo === 'PGRST202' || codigo === 'PGRST205' || codigo === '42883' || codigo === '42P01';
}

export function NotificacoesProvider({ children }) {
  const { autenticado, usuarioAuth, perfilUsuario } = useAuth();
  const usuarioId = autenticado && perfilUsuario?.ativo ? usuarioAuth?.id ?? null : null;

  const [disponivel, setDisponivel] = useState(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const [recentes, setRecentes] = useState([]);
  const [carregandoRecentes, setCarregandoRecentes] = useState(false);
  const [erroRecentes, setErroRecentes] = useState('');
  const agendadorRef = useRef(null);
  const usuarioRef = useRef(usuarioId);
  usuarioRef.current = usuarioId;

  const atualizarContador = useCallback(async () => {
    const dono = usuarioRef.current;
    try {
      const total = await contarNaoLidas(createClient());
      if (usuarioRef.current !== dono) return; // trocou de usuário no meio
      setNaoLidas(total);
      setDisponivel(true);
    } catch (erro) {
      if (ehMigrationAusente(erro)) {
        setDisponivel(false);
        agendadorRef.current?.parar();
        return;
      }
      // Erro transitório (rede): mantém o último valor; o próximo ciclo tenta.
      console.error('Notificações: não foi possível atualizar o contador.', erro);
    }
  }, []);

  useEffect(() => {
    setNaoLidas(0);
    setRecentes([]);
    setErroRecentes('');
    setDisponivel(null);
    if (!usuarioId) return undefined;

    const agendador = criarAgendadorNotificacoes({ atualizar: atualizarContador });
    agendadorRef.current = agendador;
    agendador.iniciar();
    return () => {
      agendador.parar();
      if (agendadorRef.current === agendador) agendadorRef.current = null;
    };
  }, [usuarioId, atualizarContador]);

  const atualizar = useCallback(async () => {
    await agendadorRef.current?.forcar();
  }, []);

  const carregarRecentes = useCallback(async () => {
    if (!usuarioRef.current) return;
    const dono = usuarioRef.current;
    setCarregandoRecentes(true);
    setErroRecentes('');
    try {
      const lista = await listarNotificacoes(createClient(), { limite: TAMANHO_PAINEL });
      if (usuarioRef.current !== dono) return;
      setRecentes(lista);
      setDisponivel(true);
    } catch (erro) {
      if (ehMigrationAusente(erro)) {
        setDisponivel(false);
      } else {
        console.error('Notificações: não foi possível carregar a lista.', erro);
        setErroRecentes('Não foi possível carregar as notificações agora.');
      }
    } finally {
      setCarregandoRecentes(false);
    }
    agendadorRef.current?.forcar();
  }, []);

  // Marca como lida(s): atualiza a tela na hora (otimista) e confirma no
  // banco; em seguida recalcula o contador pelo servidor (fonte da verdade).
  const marcarLidas = useCallback(async (ids) => {
    const lista = (ids || []).filter(Boolean);
    if (lista.length === 0) return;
    setRecentes((atual) => aplicarLeituraLocal(atual, lista));
    try {
      await marcarComoLidas(createClient(), lista);
    } catch (erro) {
      console.error('Notificações: não foi possível marcar como lida.', erro);
      throw erro;
    } finally {
      await agendadorRef.current?.forcar();
    }
  }, []);

  const marcarTodas = useCallback(async () => {
    setRecentes((atual) => aplicarLeituraLocal(atual, atual.map((n) => n.id)));
    try {
      await marcarTodasComoLidas(createClient());
    } catch (erro) {
      console.error('Notificações: não foi possível marcar todas como lidas.', erro);
      throw erro;
    } finally {
      await agendadorRef.current?.forcar();
    }
  }, []);

  const valor = useMemo(
    () => ({
      habilitado: !!usuarioId,
      disponivel: disponivel === true,
      naoLidas,
      recentes,
      carregandoRecentes,
      erroRecentes,
      carregarRecentes,
      marcarLidas,
      marcarTodas,
      atualizar,
    }),
    [usuarioId, disponivel, naoLidas, recentes, carregandoRecentes, erroRecentes, carregarRecentes, marcarLidas, marcarTodas, atualizar]
  );

  return <NotificacoesContext.Provider value={valor}>{children}</NotificacoesContext.Provider>;
}

// Fora do provider (ex.: testes de componente isolado) devolve um estado
// "desligado" em vez de quebrar a tela.
export function useNotificacoes() {
  return useContext(NotificacoesContext) || SEM_NOTIFICACOES;
}
