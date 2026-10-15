import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '../lib/supabase/client';
import { useAuth } from './useAuth';
import { chaveFavoritoValida } from '../lib/favoritos/favoritos';

// Favoritos do usuário logado (public.usuario_favoritos, migration 0075),
// carregados UMA vez por sessão e compartilhados pelo PageHeader (estrela) e
// pelo Dashboard (atalhos). Escrita sempre confirmada pelo banco antes de
// mudar a tela (sem atualização otimista): enquanto uma chave está sendo
// gravada, novos cliques nela são ignorados.
//
// disponivel = false quando a tabela ainda não existe/não pode ser lida
// (0075 não aplicada): a estrela some e o Dashboard não mostra a seção --
// nada é guardado em outro lugar como substituto.
const FavoritosContext = createContext(null);

export function FavoritosProvider({ children }) {
  const { usuarioAuth, perfilUsuario } = useAuth();
  const usuarioId = perfilUsuario?.ativo ? usuarioAuth?.id : null;
  const [chaves, setChaves] = useState([]);
  const [disponivel, setDisponivel] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [gravando, setGravando] = useState(() => new Set());
  const [erro, setErro] = useState('');
  const gravandoRef = useRef(new Set());

  useEffect(() => {
    let ativo = true;
    if (!usuarioId) {
      setChaves([]);
      setDisponivel(false);
      setCarregando(false);
      return undefined;
    }
    async function carregar() {
      setCarregando(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('usuario_favoritos')
        .select('chave, criado_em')
        .order('criado_em', { ascending: true })
        .order('chave', { ascending: true });
      if (!ativo) return;
      if (error) {
        console.error('Favoritos indisponíveis:', error);
        setChaves([]);
        setDisponivel(false);
      } else {
        setChaves((data || []).map((f) => f.chave));
        setDisponivel(true);
      }
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [usuarioId]);

  const alternar = useCallback(
    async (chave) => {
      if (!disponivel || !chaveFavoritoValida(chave) || gravandoRef.current.has(chave)) return false;
      gravandoRef.current.add(chave);
      setGravando(new Set(gravandoRef.current));
      setErro('');
      const supabase = createClient();
      const jaFavorito = chaves.includes(chave);
      // usuario_id é forçado para auth.uid() pelo banco (trigger + RLS); o
      // valor daqui é só o do próprio usuário logado.
      const { error } = jaFavorito
        ? await supabase.from('usuario_favoritos').delete().eq('chave', chave)
        : await supabase.from('usuario_favoritos').insert({ usuario_id: usuarioId, chave });
      gravandoRef.current.delete(chave);
      setGravando(new Set(gravandoRef.current));
      if (error) {
        console.error('Erro ao atualizar favorito:', error);
        setErro(
          error.message?.includes('limite de favoritos')
            ? 'Limite de favoritos atingido. Remova algum antes de adicionar outro.'
            : 'Não foi possível atualizar o favorito. Tente novamente.'
        );
        return false;
      }
      setChaves((atuais) => (jaFavorito ? atuais.filter((c) => c !== chave) : [...atuais.filter((c) => c !== chave), chave]));
      return true;
    },
    [chaves, disponivel, usuarioId]
  );

  const value = useMemo(
    () => ({ chaves, disponivel, carregando, erro, gravando, alternar, limparErro: () => setErro('') }),
    [chaves, disponivel, carregando, erro, gravando, alternar]
  );

  return <FavoritosContext.Provider value={value}>{children}</FavoritosContext.Provider>;
}

export function useFavoritos() {
  const ctx = useContext(FavoritosContext);
  if (!ctx) throw new Error('useFavoritos() precisa ser usado dentro de <FavoritosProvider> (ver pages/_app.js).');
  return ctx;
}
