import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import CabecalhoPrincipal from '../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import NavegacaoAgenda from '../components/agenda/NavegacaoAgenda';
import AgendaFiltros from '../components/agenda/AgendaFiltros';
import AgendaItemForm from '../components/agenda/AgendaItemForm';
import AgendaItemDetalheModal from '../components/agenda/AgendaItemDetalheModal';
import GerenciarCategoriasAgendaModal from '../components/agenda/GerenciarCategoriasAgendaModal';
import ConcluirTarefaModal from '../components/agenda/ConcluirTarefaModal';
import AniversarioOcorrenciaModal from '../components/agenda/AniversarioOcorrenciaModal';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';
import { expandirRecorrencia } from '../lib/agenda/expandirRecorrencia';
import { itemAgendaAniversario } from '../lib/funcionarios/aniversarios';
import { APARENCIA_FIXA } from '../lib/branding/tema';

// FullCalendar manipula o DOM diretamente -- client-only, sem SSR
// (mesmo padrão recomendado pela própria lib para Next.js).
const AgendaCalendario = dynamic(() => import('../components/agenda/AgendaCalendario'), { ssr: false });

const SELECT_ITENS =
  'id, tipo, titulo, descricao, categoria, data_inicio, data_fim, hora_inicio, hora_fim, dia_inteiro, ' +
  'tipo_recorrencia, recorrencia_intervalo, recorrencia_dias_semana, recorrencia_data_fim, ' +
  'concluido_em, concluido_por, observacao_conclusao, criado_por, criado_em, atualizado_em';

function AgendaConteudo() {
  const { permissoes } = useAuth();

  const podeInserir = hasPermissao(permissoes, PERMISSOES.AGENDA_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.AGENDA_EDITAR);
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.AGENDA_EXCLUIR);
  // Aniversário de funcionário é uma integração ADITIVA (ver
  // lib/funcionarios/aniversarios.js:itemAgendaAniversario) -- só busca
  // dados de funcionários quando o usuário atual também tem
  // funcionarios.visualizar, além de já precisar de agenda.visualizar
  // para estar nesta tela. Quem não tem a permissão nunca dispara a
  // consulta e nunca recebe nome/data de nascimento de funcionário por
  // aqui (RLS de public.funcionarios bloquearia de qualquer forma, mas
  // o gate aqui evita até tentar e mostrar um estado de erro confuso).
  const podeVerFuncionarios = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_VISUALIZAR);

  const aparencia = APARENCIA_FIXA;

  const [visao, setVisao] = useState('dayGridMonth');
  const [janela, setJanela] = useState(null); // { inicio, fim }
  const [itens, setItens] = useState([]);
  const [excecoes, setExcecoes] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  const [filtro, setFiltro] = useState({ categoria: 'todas', tipo: 'todos', status: 'todos' });
  const [modalForm, setModalForm] = useState(null); // { modo, item, dataCorte, dataInicialSugerida }
  const [ocorrenciaDetalhe, setOcorrenciaDetalhe] = useState(null);
  const [mostrarCategorias, setMostrarCategorias] = useState(false);
  const [ocorrenciaParaConcluir, setOcorrenciaParaConcluir] = useState(null);
  const [ocorrenciaParaReabrir, setOcorrenciaParaReabrir] = useState(null);
  const [processandoReabertura, setProcessandoReabertura] = useState(false);
  const [erroReabertura, setErroReabertura] = useState('');
  const [funcionariosNascimento, setFuncionariosNascimento] = useState([]);
  const [aniversarioDetalhe, setAniversarioDetalhe] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function carregarCategorias() {
      const supabase = createClient();
      const { data, error: erroCategorias } = await supabase
        .from('agenda_categorias')
        .select('valor, ativo')
        .order('valor', { ascending: true });
      if (!ativo) return;
      if (erroCategorias) {
        console.error('Erro ao carregar categorias da Agenda:', erroCategorias);
        return;
      }
      setCategorias(data || []);
    }
    carregarCategorias();
    return () => {
      ativo = false;
    };
  }, [recarregarTick]);

  // Fonte de verdade continua sendo funcionarios.data_nascimento -- nada
  // é gravado em agenda_itens. Busca só id/nome/data_nascimento (nunca
  // CPF/telefone/endereço) de funcionários ATIVOS; um funcionário
  // inativado some daqui na consulta seguinte, sem nenhuma limpeza
  // manual. Não depende de `janela`: a lista completa de aniversários
  // ativos é pequena (mesmo volume da tabela de funcionários), e
  // lib/agenda/expandirRecorrencia.js já resolve, em memória, quais
  // datas caem dentro da janela visível a cada troca de mês/semana.
  useEffect(() => {
    if (!podeVerFuncionarios) {
      setFuncionariosNascimento([]);
      return undefined;
    }
    let ativo = true;
    async function carregarNascimentos() {
      const supabase = createClient();
      const { data, error: erroNascimentos } = await supabase
        .from('funcionarios')
        .select('id, nome, data_nascimento')
        .eq('ativo', true)
        .not('data_nascimento', 'is', null);
      if (!ativo) return;
      if (erroNascimentos) {
        console.error('Erro ao carregar aniversários de funcionários para a Agenda:', erroNascimentos);
        return;
      }
      setFuncionariosNascimento(data || []);
    }
    carregarNascimentos();
    return () => {
      ativo = false;
    };
  }, [podeVerFuncionarios]);

  const itensAniversario = useMemo(
    () => funcionariosNascimento.map(itemAgendaAniversario),
    [funcionariosNascimento]
  );

  // Consulta por janela (seção 22/6 da arquitetura aprovada): nunca
  // busca "todas as ocorrências futuras" nem superbusca avulsos antigos
  // indefinidamente. 3 consultas em paralelo, cada uma com o filtro
  // correto para o seu caso (mais simples e seguro do que tentar
  // expressar tudo numa única consulta com OR/AND aninhados):
  //   A) eventos avulsos: data_inicio <= fim E
  //      coalesce(data_fim, data_inicio) >= início;
  //   B) tarefas avulsas: data_inicio dentro de [início, fim];
  //   C) itens recorrentes: data_inicio <= fim E (recorrencia_data_fim
  //      IS NULL OU recorrencia_data_fim >= início).
  // agenda_ocorrencias: TODAS as exceções dos itens carregados, sem
  // filtrar por data — necessário porque data_override pode mover uma
  // exceção para dentro/fora da janela (uma exceção cuja data_ocorrencia
  // original está fora da janela mas data_override cai dentro dela não
  // pode ser perdida).
  useEffect(() => {
    if (!janela) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setErro('');
      const supabase = createClient();

      const [eventosAvulsos, tarefasAvulsas, recorrentes] = await Promise.all([
        supabase
          .from('agenda_itens')
          .select(SELECT_ITENS)
          .eq('tipo', 'evento')
          .eq('tipo_recorrencia', 'nenhuma')
          .lte('data_inicio', janela.fim)
          .or(`data_fim.gte.${janela.inicio},and(data_fim.is.null,data_inicio.gte.${janela.inicio})`),
        supabase
          .from('agenda_itens')
          .select(SELECT_ITENS)
          .eq('tipo', 'tarefa')
          .eq('tipo_recorrencia', 'nenhuma')
          .gte('data_inicio', janela.inicio)
          .lte('data_inicio', janela.fim),
        supabase
          .from('agenda_itens')
          .select(SELECT_ITENS)
          .neq('tipo_recorrencia', 'nenhuma')
          .lte('data_inicio', janela.fim)
          .or(`recorrencia_data_fim.is.null,recorrencia_data_fim.gte.${janela.inicio}`),
      ]);

      if (!ativo) return;

      const primeiroErro = eventosAvulsos.error || tarefasAvulsas.error || recorrentes.error;
      if (primeiroErro) {
        console.error('Erro ao carregar itens da Agenda:', primeiroErro);
        setErro('Não foi possível carregar a Agenda.');
        setCarregando(false);
        return;
      }

      const itensCarregados = [
        ...(eventosAvulsos.data || []),
        ...(tarefasAvulsas.data || []),
        ...(recorrentes.data || []),
      ];

      const ids = itensCarregados.map((it) => it.id);
      const excecoesData = ids.length
        ? await supabase.from('agenda_ocorrencias').select('*').in('agenda_item_id', ids)
        : { data: [], error: null };

      if (!ativo) return;
      if (excecoesData.error) {
        console.error('Erro ao carregar exceções da Agenda:', excecoesData.error);
        setErro('Não foi possível carregar a Agenda.');
        setCarregando(false);
        return;
      }

      setItens(itensCarregados);
      setExcecoes(excecoesData.data || []);
      setCarregando(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [janela, recarregarTick]);

  const ocorrencias = useMemo(() => {
    if (!janela) return [];
    // itensAniversario são só expandidos aqui (nunca lidos de volta do
    // banco) -- reaproveita exatamente a mesma expansão de recorrência
    // anual já usada por qualquer evento/tarefa recorrente real, sem
    // nenhuma lógica de data duplicada.
    const todas = expandirRecorrencia({
      itens: [...itens, ...itensAniversario],
      excecoes,
      inicioJanela: janela.inicio,
      fimJanela: janela.fim,
    });
    return todas.filter((oc) => {
      if (filtro.categoria !== 'todas' && oc.item.categoria !== filtro.categoria) return false;
      if (filtro.tipo !== 'todos' && oc.item.tipo !== filtro.tipo) return false;
      if (filtro.status === 'pendente' && (oc.item.tipo !== 'tarefa' || oc.concluida)) return false;
      if (filtro.status === 'concluida' && !oc.concluida) return false;
      return true;
    });
  }, [itens, itensAniversario, excecoes, janela, filtro]);

  const onMudarJanela = useCallback((inicio, fim) => {
    setJanela((atual) => (atual && atual.inicio === inicio && atual.fim === fim ? atual : { inicio, fim }));
  }, []);

  function fecharModalForm() {
    setModalForm(null);
  }

  function aoSalvarForm() {
    fecharModalForm();
    setOcorrenciaDetalhe(null);
    setRecarregarTick((t) => t + 1);
  }

  function aoAtualizarDetalhe() {
    setOcorrenciaDetalhe(null);
    setRecarregarTick((t) => t + 1);
  }

  // Checkbox no card do calendário (AgendaCalendario.js) -- pendente abre
  // o modal de conclusão; já concluída abre a confirmação de reabertura.
  // Mesmos dois pontos de entrada usados pelos botões "Concluir"/"Reabrir"
  // de AgendaItemDetalheModal.js (onAbrirConclusao/onAbrirReabertura
  // abaixo) -- um único fluxo, nunca dois comportamentos diferentes para
  // a mesma ação.
  function aoClicarCheckboxTarefa(ocorrencia) {
    if (!ocorrencia) return;
    if (ocorrencia.concluida) {
      setErroReabertura('');
      setOcorrenciaParaReabrir(ocorrencia);
    } else {
      setOcorrenciaParaConcluir(ocorrencia);
    }
  }

  function aoConcluirTarefa() {
    setOcorrenciaParaConcluir(null);
    setOcorrenciaDetalhe(null);
    setRecarregarTick((t) => t + 1);
  }

  async function confirmarReaberturaTarefa() {
    if (!ocorrenciaParaReabrir) return;
    setProcessandoReabertura(true);
    setErroReabertura('');
    const supabase = createClient();
    const recorrente = ocorrenciaParaReabrir.item.tipo_recorrencia !== 'nenhuma';
    const { error } = recorrente
      ? await supabase.rpc('reabrir_ocorrencia_agenda', {
          p_agenda_item_id: ocorrenciaParaReabrir.item.id,
          p_data_ocorrencia: ocorrenciaParaReabrir.dataOcorrencia,
        })
      : await supabase.rpc('reabrir_tarefa_agenda', { p_item_id: ocorrenciaParaReabrir.item.id });
    setProcessandoReabertura(false);
    if (error) {
      setErroReabertura('Não foi possível reabrir. Tente novamente.');
      return;
    }
    setOcorrenciaParaReabrir(null);
    setOcorrenciaDetalhe(null);
    setRecarregarTick((t) => t + 1);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Agenda" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
          <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Agenda</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {podeEditar && (
              <button
                onClick={() => setMostrarCategorias(true)}
                style={{ padding: '10px 16px', backgroundColor: 'white', color: aparencia.corPrimaria, border: `1px solid ${aparencia.corPrimaria}`, borderRadius: '5px', cursor: 'pointer' }}
              >
                Gerenciar categorias
              </button>
            )}
            {podeInserir && (
              <button
                onClick={() => setModalForm({ modo: 'criar', dataInicialSugerida: undefined })}
                style={{ padding: '10px 20px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                + Novo
              </button>
            )}
          </div>
        </div>

        <NavegacaoAgenda visao={visao} onMudarVisao={setVisao} corPrimaria={aparencia.corPrimaria} />

        <AgendaFiltros categorias={categorias} filtro={filtro} onMudarFiltro={setFiltro} />

        {erro && <p style={{ color: '#f44336' }}>{erro}</p>}

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          {carregando && <p style={{ margin: '0 0 10px 0', color: '#999', fontSize: '13px' }}>Carregando...</p>}
          <AgendaCalendario
            visao={visao}
            ocorrencias={ocorrencias}
            onMudarJanela={onMudarJanela}
            onClicarOcorrencia={(oc) => (oc.item.tipo === 'aniversario' ? setAniversarioDetalhe(oc) : setOcorrenciaDetalhe(oc))}
            onClicarData={(data) => {
              if (podeInserir) setModalForm({ modo: 'criar', dataInicialSugerida: data });
            }}
            onClicarCheckboxTarefa={podeEditar ? aoClicarCheckboxTarefa : () => {}}
          />
        </div>
      </div>

      {modalForm && (
        <AgendaItemForm
          modo={modalForm.modo}
          item={modalForm.item}
          dataCorte={modalForm.dataCorte}
          dataInicialSugerida={modalForm.dataInicialSugerida}
          categorias={categorias.filter((c) => c.ativo || c.valor === modalForm.item?.categoria)}
          corPrimaria={aparencia.corPrimaria}
          onSalvo={aoSalvarForm}
          onCancelar={fecharModalForm}
        />
      )}

      {ocorrenciaDetalhe && (
        <AgendaItemDetalheModal
          ocorrencia={ocorrenciaDetalhe}
          categorias={categorias}
          podeEditar={podeEditar}
          podeExcluir={podeExcluir}
          onFechar={() => setOcorrenciaDetalhe(null)}
          onAtualizado={aoAtualizarDetalhe}
          onEditarSerie={(item) => {
            setOcorrenciaDetalhe(null);
            setModalForm({ modo: 'editar_serie', item });
          }}
          onEditarEstaEProximas={(item, dataCorte) => {
            setOcorrenciaDetalhe(null);
            setModalForm({ modo: 'editar_esta_e_proximas', item, dataCorte });
          }}
          onAbrirConclusao={(oc) => {
            setOcorrenciaDetalhe(null);
            setOcorrenciaParaConcluir(oc);
          }}
          onAbrirReabertura={(oc) => {
            setOcorrenciaDetalhe(null);
            setErroReabertura('');
            setOcorrenciaParaReabrir(oc);
          }}
        />
      )}

      {aniversarioDetalhe && (
        <AniversarioOcorrenciaModal ocorrencia={aniversarioDetalhe} onFechar={() => setAniversarioDetalhe(null)} />
      )}

      {ocorrenciaParaConcluir && (
        <ConcluirTarefaModal
          ocorrencia={ocorrenciaParaConcluir}
          onFechar={() => setOcorrenciaParaConcluir(null)}
          onConcluido={aoConcluirTarefa}
        />
      )}

      {ocorrenciaParaReabrir && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: '20px',
        }}>
          <div style={{
            backgroundColor: 'white', padding: '25px', borderRadius: '10px',
            maxWidth: '380px', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ marginTop: 0 }}>Reabrir tarefa</h3>
            <p style={{ fontSize: '13px', color: '#666' }}>
              Reabrir "{ocorrenciaParaReabrir.titulo}"? Ela voltará para pendente.
            </p>
            {erroReabertura && <p style={{ color: '#f44336' }}>{erroReabertura}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setOcorrenciaParaReabrir(null)}
                disabled={processandoReabertura}
                style={{ padding: '8px 14px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarReaberturaTarefa}
                disabled={processandoReabertura}
                style={{ padding: '8px 14px', backgroundColor: '#9e9e9e', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >
                {processandoReabertura ? 'Reabrindo...' : 'Reabrir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarCategorias && (
        <GerenciarCategoriasAgendaModal
          aberto={mostrarCategorias}
          onFechar={() => setMostrarCategorias(false)}
          categorias={categorias}
          podeGerenciar={podeEditar}
          onAtualizar={() => setRecarregarTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

export default function Agenda() {
  return (
    <RequireAuth permissao={PERMISSOES.AGENDA_VISUALIZAR}>
      <AgendaConteudo />
    </RequireAuth>
  );
}
