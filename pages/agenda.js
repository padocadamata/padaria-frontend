import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import RequireAuth from '../components/RequireAuth';
import NavegacaoAgenda from '../components/agenda/NavegacaoAgenda';
import AgendaFiltros from '../components/agenda/AgendaFiltros';
import AgendaItemForm from '../components/agenda/AgendaItemForm';
import AgendaItemDetalheModal from '../components/agenda/AgendaItemDetalheModal';
import GerenciarCategoriasAgendaModal from '../components/agenda/GerenciarCategoriasAgendaModal';
import ConcluirTarefaModal from '../components/agenda/ConcluirTarefaModal';
import AniversarioOcorrenciaModal from '../components/agenda/AniversarioOcorrenciaModal';
import ConfirmarAcaoModal from '../components/admin/ConfirmarAcaoModal';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';
import { expandirRecorrencia } from '../lib/agenda/expandirRecorrencia';
import { buscarItensDaAgenda, buscarNascimentosParaAgenda } from '../lib/agenda/consultasAgenda';
import { itemAgendaAniversario } from '../lib/funcionarios/aniversarios';
import estilos from '../components/agenda/agenda.module.css';

// FullCalendar manipula o DOM diretamente -- client-only, sem SSR
// (mesmo padrão recomendado pela própria lib para Next.js).
const AgendaCalendario = dynamic(() => import('../components/agenda/AgendaCalendario'), { ssr: false });

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
      const { data, error: erroNascimentos } = await buscarNascimentosParaAgenda(supabase);
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

      const { itens: itensCarregados, excecoes: excecoesCarregadas, erro: erroBusca, cancelado } =
        await buscarItensDaAgenda(supabase, janela, { continuar: () => ativo });

      if (cancelado || !ativo) return;

      if (erroBusca) {
        setErro('Não foi possível carregar a Agenda.');
        setCarregando(false);
        return;
      }

      setItens(itensCarregados);
      setExcecoes(excecoesCarregadas);
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

  function fecharReabertura() {
    setOcorrenciaParaReabrir(null);
    setErroReabertura('');
  }

  return (
    <PageShell titulo="Agenda">
      <PageHeader
        titulo="Agenda"
        acoes={
          <>
            {podeEditar && (
              <Button variante="secondary" onClick={() => setMostrarCategorias(true)}>
                Gerenciar categorias
              </Button>
            )}
            {podeInserir && (
              <Button icone="plus" onClick={() => setModalForm({ modo: 'criar', dataInicialSugerida: undefined })}>
                Novo
              </Button>
            )}
          </>
        }
      />

      <NavegacaoAgenda visao={visao} onMudarVisao={setVisao} />

      <AgendaFiltros categorias={categorias} filtro={filtro} onMudarFiltro={setFiltro} />

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <div className={estilos.superficieCalendario}>
        {carregando && <p className={estilos.carregandoCalendario} role="status">Carregando...</p>}
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

      {modalForm && (
        <AgendaItemForm
          modo={modalForm.modo}
          item={modalForm.item}
          dataCorte={modalForm.dataCorte}
          dataInicialSugerida={modalForm.dataInicialSugerida}
          categorias={categorias.filter((c) => c.ativo || c.valor === modalForm.item?.categoria)}
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
        <ConfirmarAcaoModal
          titulo="Reabrir tarefa"
          mensagem={<>Reabrir "{ocorrenciaParaReabrir.titulo}"? Ela voltará para pendente.</>}
          textoConfirmar="Reabrir"
          confirmando={processandoReabertura}
          erro={erroReabertura}
          onConfirmar={confirmarReaberturaTarefa}
          onCancelar={fecharReabertura}
          modalDS
        />
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
    </PageShell>
  );
}

export default function Agenda() {
  return (
    <RequireAuth permissao={PERMISSOES.AGENDA_VISUALIZAR}>
      <AgendaConteudo />
    </RequireAuth>
  );
}
