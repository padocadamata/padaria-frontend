import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RequireAuth from '../../../components/RequireAuth';
import PageShell from '../../../components/shell/PageShell';
import PageHeader from '../../../components/ui/PageHeader';
import TarefasAbas from '../../../components/tarefas/TarefasAbas';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import EmptyState from '../../../components/ui/EmptyState';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import TarefasMatriz from '../../../components/tarefas/TarefasMatriz';
import TarefasFiltros from '../../../components/tarefas/TarefasFiltros';
import ResumoDiaModal, { ResumoDiaConteudo } from '../../../components/tarefas/ResumoDia';
import OcorrenciaModal, { NovaAvulsaModal } from '../../../components/tarefas/OcorrenciaModal';
import ProgramarMesModal from '../../../components/tarefas/ProgramarMesModal';
import PosicoesModal from '../../../components/tarefas/PosicoesModal';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../../lib/auth/permissoes';
import { dataLocalHoje, mesExibicao } from '../../../lib/data/dataLocal';
import { MQ_MOBILE } from '../../../lib/design/breakpoints';
import { useMediaQuery } from '../../../lib/design/useMediaQuery';
import {
  FILTROS_PADRAO,
  agruparExecucoes,
  dataExtensa,
  diasDoMes,
  inicioDoMes,
  montarMatriz,
  opcoesResponsavel,
  somarMeses,
} from '../../../lib/tarefas/calendario';
import {
  carregarCadastro,
  carregarExecucoes,
  carregarMesProgramado,
  carregarOcorrencias,
  criarOcorrenciaAvulsa,
  removerExecucao,
} from '../../../lib/tarefas/consultas';
import { mensagemErro } from '../../../lib/tarefas/erros';
import estilos from '../../../components/tarefas/tarefas.module.css';

// Folha de Pagamento > Tarefas -- calendário mensal (migrations 0061/0062).
//
// A tela SÓ LÊ ocorrências materializadas: abrir a tela nunca programa
// nada. "Programar mês" é uma ação explícita (prévia + confirmação). Os
// filtros são visuais. No celular, a matriz de 31 colunas dá lugar ao
// resumo do dia com navegação dia a dia.

function TarefasCalendario() {
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.TAREFAS_EDITAR);
  const podeConcluir = hasPermissao(permissoes, PERMISSOES.TAREFAS_CONCLUIR);
  const mobile = useMediaQuery(MQ_MOBILE);
  const hoje = dataLocalHoje();

  const [mes, setMes] = useState(() => inicioDoMes(hoje));
  const [cadastro, setCadastro] = useState(null);
  const [ocorrencias, setOcorrencias] = useState([]);
  const [execucoesPorOcorrencia, setExecucoesPorOcorrencia] = useState(() => new Map());
  const execucoesRef = useRef(execucoesPorOcorrencia);
  execucoesRef.current = execucoesPorOcorrencia;
  const [mesProgramado, setMesProgramado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);

  const [diaAberto, setDiaAberto] = useState('');
  const [diaMobile, setDiaMobile] = useState(hoje);
  const [ocorrenciaAberta, setOcorrenciaAberta] = useState(null); // { ocorrencia, tarefa }
  const [novaAvulsa, setNovaAvulsa] = useState(null); // { tarefa, data }
  const [programarAberto, setProgramarAberto] = useState(false);
  const [posicoesAberto, setPosicoesAberto] = useState(false);

  const dias = useMemo(() => diasDoMes(mes), [mes]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const [c, o, m, e] = await Promise.all([
          carregarCadastro(),
          carregarOcorrencias(dias[0], dias[dias.length - 1]),
          carregarMesProgramado(mes),
          carregarExecucoes(dias[0], dias[dias.length - 1]),
        ]);
        if (!ativo) return;
        setCadastro(c);
        setOcorrencias(o);
        setExecucoesPorOcorrencia(agruparExecucoes(e));
        setMesProgramado(m);
      } catch (e) {
        console.error('Erro ao carregar Tarefas:', e);
        if (ativo) setErro(`Não foi possível carregar as tarefas: ${mensagemErro(e)}`);
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [mes, dias, recarregar]);

  // Dia exibido no celular acompanha o mês navegado.
  useEffect(() => {
    setDiaMobile((atual) => (atual.startsWith(mes.slice(0, 7)) ? atual : hoje.startsWith(mes.slice(0, 7)) ? hoje : mes));
  }, [mes, hoje]);

  const tarefasPorId = useMemo(() => new Map((cadastro?.tarefas || []).map((t) => [t.id, t])), [cadastro]);
  const dataReferencia = useMemo(() => {
    const fim = dias[dias.length - 1];
    return hoje < dias[0] ? dias[0] : hoje > fim ? fim : hoje;
  }, [dias, hoje]);

  const secoes = useMemo(
    () => (cadastro
      ? montarMatriz({ ...cadastro, ocorrencias, filtros, dataReferencia })
      : []),
    [cadastro, ocorrencias, filtros, dataReferencia]
  );
  const opcoesFiltroResponsavel = useMemo(() => opcoesResponsavel(ocorrencias), [ocorrencias]);

  const substituir = useCallback((nova) => {
    setOcorrencias((lista) => lista.map((o) => (o.id === nova.id ? nova : o)));
  }, []);

  // Resultado das RPCs de execução (0062): ocorrência (espelho de
  // conclusão) + lista de execuções.
  const aplicarExecucoes = useCallback((ocorrencia, execucoes) => {
    setOcorrencias((lista) => lista.map((o) => (o.id === ocorrencia.id ? ocorrencia : o)));
    setExecucoesPorOcorrencia((mapa) => {
      const novo = new Map(mapa);
      if (execucoes.length > 0) novo.set(ocorrencia.id, execucoes);
      else novo.delete(ocorrencia.id);
      return novo;
    });
  }, []);

  const abrirOcorrencia = useCallback((ocorrencia, tarefa) => setOcorrenciaAberta({ ocorrencia, tarefa }), []);

  // Checkbox (matriz/resumo): marcar abre o detalhe para informar QUEM
  // executou (nome obrigatório, 0062); desmarcar com 1 execução remove essa
  // execução; com 2 execuções abre o detalhe para escolher qual remover.
  // Sem bloqueio de data futura (antecipação permitida). Remoção com
  // atualização otimista; em erro, volta ao estado anterior.
  const alternarConclusao = useCallback(async (ocorrencia, concluir, tarefa) => {
    setErro('');
    const execucoes = execucoesRef.current.get(ocorrencia.id) || [];
    if (concluir || execucoes.length > 1) {
      setOcorrenciaAberta({ ocorrencia, tarefa });
      return;
    }
    setOcorrencias((lista) => lista.map((o) => (o.id === ocorrencia.id ? { ...o, concluida: false } : o)));
    try {
      const r = execucoes.length === 1 ? await removerExecucao(execucoes[0].id) : null;
      if (r) aplicarExecucoes(r.ocorrencia, r.execucoes);
      else setRecarregar((n) => n + 1);
    } catch (e) {
      setOcorrencias((lista) => lista.map((o) => (o.id === ocorrencia.id ? ocorrencia : o)));
      setErro(mensagemErro(e));
    }
  }, [aplicarExecucoes]);
  const abrirNovaAvulsa = useCallback((tarefa, data) => setNovaAvulsa({ tarefa, data }), []);

  const mesJaTerminou = dias[dias.length - 1] < hoje;
  const semProgramacao = !carregando && !erro && !mesProgramado;

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="tarefas" />
      <PageHeader titulo="Tarefas" subtitulo="Distribuição das tarefas operacionais entre F1, F2 e F3." />
      <TarefasAbas ativo="calendario" />

      <div className={estilos.barraMes}>
        <div className={estilos.navegacaoMes}>
          <Button variante="secondary" tamanho="sm" onClick={() => setMes((m) => somarMeses(m, -1))} aria-label="Mês anterior">←</Button>
          <Button variante="secondary" tamanho="sm" onClick={() => setMes(inicioDoMes(hoje))}>Hoje</Button>
          <Button variante="secondary" tamanho="sm" onClick={() => setMes((m) => somarMeses(m, 1))} aria-label="Próximo mês">→</Button>
        </div>
        <h2 className={estilos.tituloMes}>{mesExibicao(mes)}</h2>
        <div className={estilos.acoesMes}>
          <Button
            variante="secondary"
            tamanho="sm"
            onClick={() => window.open(`/funcionarios/tarefas/imprimir?mes=${mes}&imprimir=1`, '_blank', 'noopener')}
            disabled={carregando || !mesProgramado}
            title={mesProgramado ? 'Abre a versão A4 paisagem para imprimir ou salvar em PDF' : 'Programe o mês antes de imprimir'}
          >
            Imprimir calendário
          </Button>
          <Button variante="secondary" tamanho="sm" onClick={() => setPosicoesAberto(true)} disabled={!cadastro}>
            Identificar F1/F2/F3
          </Button>
          {podeEditar && !mesJaTerminou && (
            <Button tamanho="sm" onClick={() => setProgramarAberto(true)} disabled={carregando || !cadastro}>
              {mesProgramado ? 'Atualizar programação' : 'Programar mês'}
            </Button>
          )}
        </div>
      </div>

      {mensagem && <Alert tom="success" className={estilos.mensagem}>{mensagem}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      {semProgramacao && (
        <Alert tom="info" className={estilos.mensagem}>
          {mesJaTerminou
            ? 'Este mês não foi programado.'
            : podeEditar
              ? 'Este mês ainda não foi programado. Use "Programar mês" para gerar o calendário a partir das regras cadastradas.'
              : 'Este mês ainda não foi programado.'}
        </Alert>
      )}

      {cadastro && (
        <TarefasFiltros
          filtros={filtros}
          onMudar={setFiltros}
          opcoesResponsavel={opcoesFiltroResponsavel}
          categorias={cadastro.categorias}
        />
      )}

      {carregando ? (
        <p role="status">Carregando tarefas...</p>
      ) : !cadastro ? null : mobile ? (
        <section aria-label="Tarefas do dia">
          <div className={estilos.navegacaoDia}>
            <Button
              variante="secondary"
              tamanho="sm"
              disabled={diaMobile <= dias[0]}
              onClick={() => setDiaMobile(dias[Math.max(0, dias.indexOf(diaMobile) - 1)])}
              aria-label="Dia anterior"
            >
              ←
            </Button>
            <h3 className={estilos.tituloDia}>{dataExtensa(diaMobile)}</h3>
            <Button
              variante="secondary"
              tamanho="sm"
              disabled={diaMobile >= dias[dias.length - 1]}
              onClick={() => setDiaMobile(dias[Math.min(dias.length - 1, dias.indexOf(diaMobile) + 1)])}
              aria-label="Próximo dia"
            >
              →
            </Button>
          </div>
          <ResumoDiaConteudo
            data={diaMobile}
            ocorrencias={ocorrencias}
            execucoesPorOcorrencia={execucoesPorOcorrencia}
            tarefasPorId={tarefasPorId}
            categorias={cadastro.categorias}
            filtros={filtros}
            hoje={hoje}
            podeConcluir={podeConcluir}
            onAlternarConclusao={alternarConclusao}
            onAbrirOcorrencia={abrirOcorrencia}
          />
        </section>
      ) : secoes.length === 0 ? (
        <EmptyState>{ocorrencias.length > 0 ? 'Nenhuma tarefa corresponde aos filtros.' : 'Nenhuma tarefa programada neste mês.'}</EmptyState>
      ) : (
        <>
          <TarefasMatriz
            secoes={secoes}
            dias={dias}
            hoje={hoje}
            execucoesPorOcorrencia={execucoesPorOcorrencia}
            podeConcluir={podeConcluir}
            podeEditar={podeEditar && Boolean(mesProgramado)}
            onAlternarConclusao={alternarConclusao}
            onAbrirOcorrencia={abrirOcorrencia}
            onAbrirDia={setDiaAberto}
            onNovaAvulsa={abrirNovaAvulsa}
          />
          <div className={estilos.legenda}>
            <span className={estilos.itemLegenda}><span className={`${estilos.chipPosicao} ${estilos.pos1}`}>F1</span></span>
            <span className={estilos.itemLegenda}><span className={`${estilos.chipPosicao} ${estilos.pos2}`}>F2</span></span>
            <span className={estilos.itemLegenda}><span className={`${estilos.chipPosicao} ${estilos.pos3}`}>F3</span></span>
            <span className={estilos.itemLegenda}>☑ concluída (×2 = duas execuções)</span>
            <span className={estilos.itemLegenda}>✕ cancelada</span>
            <span className={estilos.itemLegenda}>● ajustada</span>
            <span className={estilos.itemLegenda}>contorno tracejado = avulsa</span>
            <span className={estilos.itemLegenda}>F1/F2/F3 = programação. Clique no dia para o resumo; no responsável para registrar quem executou.</span>
          </div>
        </>
      )}

      {diaAberto && cadastro && (
        <ResumoDiaModal
          data={diaAberto}
          ocorrencias={ocorrencias}
          execucoesPorOcorrencia={execucoesPorOcorrencia}
          tarefasPorId={tarefasPorId}
          categorias={cadastro.categorias}
          filtros={filtros}
          hoje={hoje}
          podeConcluir={podeConcluir}
          onAlternarConclusao={alternarConclusao}
          onAbrirOcorrencia={abrirOcorrencia}
          onFechar={() => setDiaAberto('')}
        />
      )}

      {ocorrenciaAberta && cadastro && (
        <OcorrenciaModal
          ocorrencia={ocorrencias.find((o) => o.id === ocorrenciaAberta.ocorrencia.id) || ocorrenciaAberta.ocorrencia}
          execucoes={execucoesPorOcorrencia.get(ocorrenciaAberta.ocorrencia.id) || []}
          tarefa={ocorrenciaAberta.tarefa}
          nomes={cadastro.nomes}
          podeEditar={podeEditar}
          podeConcluir={podeConcluir}
          onAlterada={substituir}
          onExecucoes={aplicarExecucoes}
          onRemovida={(o) => setOcorrencias((lista) => lista.filter((x) => x.id !== o.id))}
          onFechar={() => setOcorrenciaAberta(null)}
        />
      )}

      {novaAvulsa && cadastro && (
        <NovaAvulsaModal
          tarefa={novaAvulsa.tarefa}
          data={novaAvulsa.data}
          nomes={cadastro.nomes}
          criar={criarOcorrenciaAvulsa}
          onCriada={(nova) => setOcorrencias((lista) => [...lista, nova])}
          onFechar={() => setNovaAvulsa(null)}
        />
      )}

      {programarAberto && (
        <ProgramarMesModal
          mes={mes}
          jaProgramado={Boolean(mesProgramado)}
          onFechar={() => setProgramarAberto(false)}
          onConcluido={(r) => {
            setProgramarAberto(false);
            setMensagem(`${mesExibicao(mes)}: ${r.criadas} ocorrência(s) criada(s), ${r.removidas} removida(s), ${r.preservadas} preservada(s).`);
            setRecarregar((n) => n + 1);
          }}
        />
      )}

      {posicoesAberto && cadastro && (
        <PosicoesModal
          nomes={cadastro.nomes}
          hoje={hoje}
          podeEditar={podeEditar}
          onFechar={() => setPosicoesAberto(false)}
          onSalvo={(r) => {
            setPosicoesAberto(false);
            setMensagem(`Identificação de F${r.posicao} registrada a partir de ${r.aplicar_a_partir_de.split('-').reverse().join('/')}. ${r.nomes_atualizados} ocorrência(s) futura(s) atualizada(s).`);
            setRecarregar((n) => n + 1);
          }}
        />
      )}
    </PageShell>
  );
}

export default function TarefasPage() {
  return (
    <RequireAuth permissao={PERMISSOES.TAREFAS_VISUALIZAR}>
      <TarefasCalendario />
    </RequireAuth>
  );
}
