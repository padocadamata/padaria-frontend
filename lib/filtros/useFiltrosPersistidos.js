import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { aplicarDefinicao, camposParaSanear, persistenciaFiltros as persistenciaPadrao } from './persistenciaFiltros';

// Hooks de filtros persistidos por sessão de login (ver
// ./persistenciaFiltros.js para a regra e o formato).
//
// Hidratação: as páginas protegidas só montam o conteúdo DEPOIS que o
// AuthProvider resolveu a sessão (RequireAuth mostra "Verificando sessão…"
// antes, inclusive no SSR) -- e o AuthProvider informa o session_id antes
// de liberar. Por isso o useState abaixo já nasce com o valor restaurado:
// a PRIMEIRA consulta da tela usa o filtro salvo (nunca padrão -> consulta
// -> restaura -> segunda consulta) e não há flash do padrão.

function useNamespaceFiltros(persistencia) {
  return useSyncExternalStore(persistencia.assinar, persistencia.obterNamespace, persistencia.obterNamespace);
}

// tela: identificador estável da tela (ex.: 'catalogo'); null = sem
// persistência (estado local comum, como antes desta frente).
// definicao: { versao, padrao, validadores?, normalizar? }. Aumentar a
// versão invalida só o estado salvo desta tela.
//
// Devolve { valores, definir, redefinir, padrao }:
//   definir('campo', valor | (anterior) => novo)  ou  definir({ parcial })
//   redefinir() -> volta tudo ao padrão (botão "Limpar filtros").
export function useFiltrosPersistidos(tela, definicao, { persistencia = persistenciaPadrao } = {}) {
  const definicaoRef = useRef(definicao);
  definicaoRef.current = definicao;

  const namespace = useNamespaceFiltros(persistencia);
  const ns = tela ? namespace : null;

  const carregar = (nsAlvo) => {
    const { valores, precisaGravar } = persistencia.lerTela(nsAlvo, tela, definicaoRef.current);
    return { ns: nsAlvo, valores, gravar: precisaGravar };
  };

  const [estado, setEstado] = useState(() => carregar(ns));

  // Sessão mudou com a tela montada (logout/login em outra aba, troca de
  // usuário): descarta o estado da sessão anterior e lê o da nova.
  let atual = estado;
  if (estado.ns !== ns) {
    atual = carregar(ns);
    setEstado(atual);
  }

  useEffect(() => {
    if (!atual.gravar || !atual.ns) return;
    persistencia.gravarTela(atual.ns, tela, definicaoRef.current.versao, atual.valores);
  }, [atual, persistencia, tela]);

  const definir = useCallback((campoOuParcial, valor) => {
    setEstado((anterior) => {
      const valores = aplicarDefinicao(anterior.valores, definicaoRef.current.padrao, campoOuParcial, valor);
      return valores === anterior.valores ? anterior : { ns: anterior.ns, valores, gravar: true };
    });
  }, []);

  const redefinir = useCallback(() => {
    setEstado((anterior) => ({ ns: anterior.ns, valores: { ...definicaoRef.current.padrao }, gravar: true }));
  }, []);

  return { valores: atual.valores, definir, redefinir, padrao: definicao.padrao };
}

// Saneamento contra opções carregadas (ver camposParaSanear). Devolve os
// valores JÁ saneados para a renderização (sem um quadro com a opção
// inexistente) e persiste o saneamento -- só do campo inválido, só depois
// que as opções daquele campo estão prontas.
export function useSanearFiltros(filtros, regras) {
  const patch = camposParaSanear(filtros.valores, regras, filtros.padrao);
  const chavePatch = patch ? JSON.stringify(patch) : '';
  const { definir } = filtros;

  useEffect(() => {
    if (chavePatch) definir(JSON.parse(chavePatch));
  }, [chavePatch, definir]);

  return patch ? { ...filtros.valores, ...patch } : filtros.valores;
}
