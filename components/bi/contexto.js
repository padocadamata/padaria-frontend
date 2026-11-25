import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFiltrosPersistidos } from '../../lib/filtros/useFiltrosPersistidos';
import { FILTROS_BI, alternarSelecionado as alternarNaLista, codigosSelecaoInicial, precisaSelecaoInicial } from '../../lib/bi/filtros';
import { atribuirCores } from '../../lib/bi/cores';
import { periodoDoAtalho } from '../../lib/bi/datas';

// Estado compartilhado do painel /bi: cliente das RPCs (cache + fila),
// bi_status, filtros gerais, filtros próprios de cada bloco e produtos
// selecionados (com cor fixa por código), seleção automática inicial e
// "Atualizar dados" (atualizacao = { executar, fase, erro } vindo do PainelBi).

const ContextoBi = createContext(null);

export function useBi() {
  const ctx = useContext(ContextoBi);
  if (!ctx) throw new Error('useBi fora do ProvedorBi');
  return ctx;
}

// Exportação geral: cada bloco publica (a cada render, sem re-render) o que
// está usando AGORA -- filtros efetivos, parâmetros da tela (métrica,
// ordenação, Top N, modo...) e os argumentos EXATOS das consultas (os mesmos
// passados ao useConsulta, sem a condição de visibilidade). A exportação lê
// esse registro uma única vez no clique (instantâneo consistente).
export function useRegistroExportacao(nome, registro) {
  const { registrarExportacao } = useBi();
  useEffect(() => {
    registrarExportacao(nome, registro);
  });
}

export function ProvedorBi({ cliente, status, atualizacao = null, children }) {
  const estado = useFiltrosPersistidos('bi', FILTROS_BI);
  const { valores, definir, redefinir } = estado;
  const valoresRef = useRef(valores);
  valoresRef.current = valores;
  const registroExportacao = useRef({});
  const registrarExportacao = useCallback((nome, registro) => {
    registroExportacao.current[nome] = registro;
  }, []);
  const lerRegistroExportacao = useCallback(() => registroExportacao.current, []);

  // Atalho (≠ personalizado): datas recalculadas a partir de bi_status a cada
  // abertura -- "últimos 7 dias completos" acompanha a última importação.
  const referenciaDatas = useMemo(
    () => (status ? { hoje: status.hoje, ultimoCompleto: status.padrao_ate } : null),
    [status]
  );
  const periodoAtalho = useMemo(
    () => (referenciaDatas && valores.atalho !== 'personalizado' ? periodoDoAtalho(valores.atalho, referenciaDatas) : null),
    [referenciaDatas, valores.atalho]
  );
  const geral = useMemo(() => {
    const de = periodoAtalho ? periodoAtalho.de : valores.de;
    const ate = periodoAtalho ? periodoAtalho.ate : valores.ate;
    return {
      atalho: valores.atalho,
      de,
      ate,
      dias: valores.dias,
      agrupamento: valores.agrupamento,
      referencia: valores.referencia,
      refDe: valores.refDe,
      refAte: valores.refAte,
    };
  }, [periodoAtalho, valores]);

  // Personalizado sem datas salvas (1º uso): parte do período padrão.
  useEffect(() => {
    if (!referenciaDatas) return;
    if (valores.atalho === 'personalizado' && (!valores.de || !valores.ate)) {
      const p = periodoDoAtalho('7', referenciaDatas);
      if (p) definir({ de: p.de, ate: p.ate });
    }
    if (valores.referencia === 'livre' && (!valores.refDe || !valores.refAte)) {
      const p = periodoDoAtalho('7', referenciaDatas);
      if (p) definir({ refDe: p.de, refAte: p.ate });
    }
  }, [referenciaDatas, valores.atalho, valores.de, valores.ate, valores.referencia, valores.refDe, valores.refAte, definir]);

  const definirGeral = useCallback(
    (parcial) => {
      if (parcial.atalho && parcial.atalho !== 'personalizado') {
        definir(parcial);
        return;
      }
      if ((parcial.de || parcial.ate) && !parcial.atalho) {
        // Mudou a data à mão: vira personalizado (mantém a outra ponta).
        definir({ atalho: 'personalizado', de: parcial.de ?? geral.de, ate: parcial.ate ?? geral.ate, ...parcial });
        return;
      }
      if (parcial.atalho === 'personalizado') {
        definir({ atalho: 'personalizado', de: geral.de, ate: geral.ate, ...parcial });
        return;
      }
      definir(parcial);
    },
    [definir, geral.de, geral.ate]
  );

  const definirBloco = useCallback(
    (nome, proprio) => {
      definir('blocos', (atual) => {
        const proximo = { ...(atual || {}) };
        if (!proprio || Object.keys(proprio).length === 0) delete proximo[nome];
        else proximo[nome] = proprio;
        return proximo;
      });
    },
    [definir]
  );

  const restaurarTudo = useCallback(() => {
    definir({ atalho: FILTROS_BI.padrao.atalho, de: '', ate: '', dias: FILTROS_BI.padrao.dias, agrupamento: 'dia', referencia: 'anterior', blocos: {} });
  }, [definir]);

  // Cores seguem o produto (nunca a posição).
  const coresRef = useRef({});
  const cores = useMemo(() => {
    const mapa = atribuirCores(valores.selecionados, coresRef.current);
    coresRef.current = mapa;
    return mapa;
  }, [valores.selecionados]);

  // Descrições conhecidas dos códigos selecionados (vêm das RPCs de produto).
  const [descricoes, setDescricoes] = useState({});
  const lembrarDescricoes = useCallback((produtos) => {
    if (!produtos || !produtos.length) return;
    setDescricoes((atual) => {
      let mudou = false;
      const proximo = { ...atual };
      for (const p of produtos) {
        if (p && p.codigo && p.descricao && proximo[p.codigo] !== p.descricao) {
          proximo[p.codigo] = p.descricao;
          mudou = true;
        }
      }
      return mudou ? proximo : atual;
    });
  }, []);

  // Qualquer escolha manual (marcar, desmarcar, remover todos) encerra a
  // seleção automática para sempre nesta sessão de filtros.
  const alternarSelecionado = useCallback(
    (codigo, descricao) => {
      if (descricao) lembrarDescricoes([{ codigo, descricao }]);
      definir('selecionados', (atual) => alternarNaLista(atual, codigo));
      if (!valoresRef.current.selecaoIniciada) definir('selecaoIniciada', true);
    },
    [definir, lembrarDescricoes]
  );

  // Seleção automática inicial: 1º acesso sem seleção registrada -> os 3
  // produtos de maior faturamento do PERÍODO GERAL (mesma consulta do
  // ranking padrão, reaproveitada pelo cache). Não roda de novo ao trocar
  // período/filtros nem ao atualizar os dados; não sobrescreve escolha
  // manual feita enquanto a consulta estava em andamento.
  const precisaInicial = precisaSelecaoInicial(valores);
  useEffect(() => {
    if (!precisaInicial || !geral.de || !geral.ate || geral.de > geral.ate) return undefined;
    let vivo = true;
    cliente
      .consultar('produtos', { de: geral.de, ate: geral.ate, ordem: 'bruto', direcao: 'desc', limite: 10, deslocamento: 0, dias: geral.dias })
      .then(
        (r) => {
          if (!vivo || !precisaSelecaoInicial(valoresRef.current)) return;
          const codigos = codigosSelecaoInicial(r && r.produtos);
          // Período sem produtos: nada a escolher; tenta no próximo acesso.
          if (!codigos.length) return;
          lembrarDescricoes(r.produtos);
          definir({ selecionados: codigos, selecaoIniciada: true });
        },
        () => {}
      );
    return () => {
      vivo = false;
    };
  }, [precisaInicial, cliente, geral.de, geral.ate, geral.dias, definir, lembrarDescricoes]);

  const valor = useMemo(
    () => ({
      cliente,
      status,
      geral,
      definirGeral,
      blocos: valores.blocos,
      definirBloco,
      restaurarTudo,
      redefinir,
      selecionados: valores.selecionados,
      alternarSelecionado,
      cores,
      descricoes,
      lembrarDescricoes,
      rankingTop: valores.rankingTop,
      porPagina: valores.porPagina,
      definirPreferencia: definir,
      atualizacao,
      registrarExportacao,
      lerRegistroExportacao,
    }),
    [cliente, status, geral, definirGeral, valores.blocos, definirBloco, restaurarTudo, redefinir, valores.selecionados, alternarSelecionado, cores, descricoes, lembrarDescricoes, valores.rankingTop, valores.porPagina, definir, atualizacao, registrarExportacao, lerRegistroExportacao]
  );

  return <ContextoBi.Provider value={valor}>{children}</ContextoBi.Provider>;
}
