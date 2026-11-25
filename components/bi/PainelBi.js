import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProvedorBi, useBi } from './contexto';
import { Cabecalho, FaixaCobertura, FiltrosGerais, Indicadores } from './Topo';
import { EvolucaoFaturamento, MediaDiaSemana } from './Faturamento';
import { EvolucaoProdutos, ParticipacaoFaturamento, RankingProdutos, TabelaProdutos } from './Produtos';
import { CurvaHorario, MapaCalor, ProdutosPorHorario } from './Horarios';
import { Comparativo } from './Comparativo';
import { criarClienteBi } from '../../lib/bi/consultas';
import { useConsulta } from '../../lib/bi/useConsulta';
import { LIMITES, diasNoIntervalo } from '../../lib/bi/datas';
import { numero } from '../../lib/bi/formatos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

// BI Gerencial: UMA página (sem abas nem subpáginas). Ordem e distribuição
// dos blocos = mockup aprovado em 2026-11-25. Carregamento progressivo:
// status -> filtros -> indicadores (acima da dobra) -> demais blocos ao
// entrarem na tela, com no máximo 3 chamadas simultâneas.

function Conteudo() {
  const { cliente, geral } = useBi();
  const n = geral.de && geral.ate && geral.de <= geral.ate ? diasNoIntervalo(geral.de, geral.ate) : 0;
  const acima = n > LIMITES.geral;
  const resumo = useConsulta(cliente, 'resumo', n > 0 && !acima ? { de: geral.de, ate: geral.ate, dias: geral.dias } : null);
  return (
    <>
      <Cabecalho />
      <FiltrosGerais />
      {acima && (
        <div className={cx(s.aviso, s.avisoAt)} style={{ marginTop: 10 }}>
          ⚠ <span>O período geral tem {numero(n)} dias; o máximo é {numero(LIMITES.geral)}. Escolha um período menor.</span>
        </div>
      )}
      {!acima && (
        <>
          <FaixaCobertura resumo={resumo} />
          <Indicadores resumo={resumo} />

          <div className={s.secao}>Faturamento</div>
          <div className={s.grade}>
            <EvolucaoFaturamento />
            <MediaDiaSemana />
          </div>

          <div className={s.secao}>Produtos</div>
          <div className={s.grade}>
            <RankingProdutos />
            <ParticipacaoFaturamento />
            <EvolucaoProdutos />
            <TabelaProdutos />
          </div>

          <div className={s.secao}>Horários</div>
          <div className={s.grade}>
            <CurvaHorario />
            <MapaCalor />
            <ProdutosPorHorario />
          </div>

          <div className={s.secao}>Comparativos</div>
          <div className={s.grade}>
            <Comparativo />
          </div>
        </>
      )}
    </>
  );
}

// "Atualizar dados": relê bi_status (cobertura e última importação) SEM
// iniciar importação do G3; só depois invalida o cache e todos os blocos
// montados consultam de novo com os MESMOS filtros e a MESMA seleção.
// fase: 'ocioso' | 'status' (relendo bi_status) | 'relatorios' (blocos
// recarregando). Cliques durante a atualização são ignorados.
const ESPERA_MINIMA_MS = 450; // > debounce dos blocos (ATRASO_MS)

function useAtualizacao(cliente, aoReceberStatus) {
  const [fase, setFase] = useState('ocioso');
  const [erro, setErro] = useState(null);
  const [concluidaEm, setConcluidaEm] = useState(null);
  const emAndamento = useRef(false);

  const executar = useCallback(() => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setErro(null);
    setFase('status');
    cliente.consultar('status', {}, { ignorarCache: true }).then(
      (dados) => {
        cliente.invalidar();
        aoReceberStatus(dados);
        setFase('relatorios');
      },
      (e) => {
        emAndamento.current = false;
        setErro(e && e.message ? e.message : 'Não foi possível atualizar.');
        setFase('ocioso');
      }
    );
  }, [cliente, aoReceberStatus]);

  // Fim: depois do debounce dos blocos, quando a fila de consultas esvaziar.
  useEffect(() => {
    if (fase !== 'relatorios') return undefined;
    let cancelar = () => {};
    const t = setTimeout(() => {
      const verificar = () => {
        if (cliente.ocupado()) return;
        cancelar();
        emAndamento.current = false;
        setConcluidaEm(new Date());
        setFase('ocioso');
      };
      cancelar = cliente.assinar(verificar);
      verificar();
    }, ESPERA_MINIMA_MS);
    return () => {
      clearTimeout(t);
      cancelar();
    };
  }, [fase, cliente]);

  return useMemo(() => ({ executar, fase, erro, concluidaEm }), [executar, fase, erro, concluidaEm]);
}

export default function PainelBi({ supabase }) {
  const cliente = useMemo(() => criarClienteBi(supabase), [supabase]);
  const [tentativa, setTentativa] = useState(0);
  const [st, setSt] = useState({ status: 'carregando', dados: null, erro: null });
  const aoReceberStatus = useCallback((dados) => setSt({ status: 'ok', dados, erro: null }), []);
  const atualizacao = useAtualizacao(cliente, aoReceberStatus);

  useEffect(() => {
    let vivo = true;
    setSt({ status: 'carregando', dados: null, erro: null });
    cliente.consultar('status', {}).then(
      (dados) => vivo && setSt({ status: 'ok', dados, erro: null }),
      (e) => vivo && setSt({ status: 'erro', dados: null, erro: e.message })
    );
    return () => {
      vivo = false;
    };
  }, [cliente, tentativa]);

  return (
    <div className={s.painel}>
      {st.status === 'carregando' && (
        <>
          <div className={s.cab}>
            <h1 style={{ margin: 0, color: 'var(--ds-primary)', fontSize: 24 }}>BI Gerencial</h1>
          </div>
          <div className={s.esqueleto} style={{ height: 64, marginBottom: 16 }} aria-busy="true" aria-label="Carregando" />
          <div className={s.esqueleto} style={{ height: 116 }} />
        </>
      )}
      {st.status === 'erro' && (
        <>
          <div className={s.cab}>
            <h1 style={{ margin: 0, color: 'var(--ds-primary)', fontSize: 24 }}>BI Gerencial</h1>
          </div>
          <div className={cx(s.aviso, s.avisoErro)} role="alert">
            <span>{st.erro}</span>
            <button
              type="button"
              className={s.btnLink}
              onClick={() => {
                cliente.limpar();
                setTentativa((t) => t + 1);
              }}
            >
              Tentar de novo
            </button>
          </div>
        </>
      )}
      {st.status === 'ok' && (
        <ProvedorBi cliente={cliente} status={st.dados} atualizacao={atualizacao}>
          <Conteudo />
        </ProvedorBi>
      )}
    </div>
  );
}
