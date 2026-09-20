import { useEffect, useState } from 'react';
import CabecalhoPrincipal from '../../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import ReaberturaModal from '../../components/producao/ReaberturaModal';
import FechamentoTurnoForm from '../../components/producao/FechamentoTurnoForm';
import GerenciarSobrasModal from '../../components/producao/GerenciarSobrasModal';
import VisualizarRegistroModal from '../../components/producao/VisualizarRegistroModal';
import LancarProducaoRetroativaModal from '../../components/producao/LancarProducaoRetroativaModal';
import CompletarProducaoRetroativaModal from '../../components/producao/CompletarProducaoRetroativaModal';
import EditarProducaoModal from '../../components/producao/EditarProducaoModal';
import ExcluirRegistroModal from '../../components/producao/ExcluirRegistroModal';
import MarcadorFalta from '../../components/producao/MarcadorFalta';
import {
  BotaoIconeAcao,
  IconeOlho,
  IconeLapis,
  IconeCaixa,
  IconeCheck,
  IconeReabrir,
  IconeLixeira,
} from '../../components/producao/IconesAcoes';
import { PERMISSOES, hasPermissao, isAdmin } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { APARENCIA_FIXA } from '../../lib/branding/tema';
import { somarDias } from '../../lib/data/dataLocal';
import Paginacao from '../../components/Paginacao';
import BotaoLimparFiltros, { campoFiltroEstilo } from '../../components/BotaoLimparFiltros';

const TURNO_LABEL = { manha: 'Manhã', tarde: 'Tarde' };

// Paginação NA CONSULTA (Supabase .range() + count exact): o histórico só
// cresce, então nada de carregar tudo no navegador (além de crescer sem
// limite, o PostgREST corta silenciosamente em 1000 linhas por resposta).
const TAMANHO_PAGINA = 20;
const TAMANHO_BLOCO_LEITURA = 1000;

// Teto de datas enviadas em .in('data', [...]) para o filtro de dia da
// semana (~10 anos de um mesmo dia da semana; ~6 KB de URL).
const MAX_DATAS_DIA_SEMANA = 520;

// Opções do filtro de dia da semana, na ordem operacional (segunda a
// domingo) — value é o índice real de Date.getDay() (0=domingo), não a
// posição na lista, por isso não é sequencial aqui.
const DIA_SEMANA_OPCOES = [
  { value: '1', label: 'Segunda-feira' },
  { value: '2', label: 'Terça-feira' },
  { value: '3', label: 'Quarta-feira' },
  { value: '4', label: 'Quinta-feira' },
  { value: '5', label: 'Sexta-feira' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
];

// Mesma técnica segura já usada em lib/producao/sugestaoProducao.js
// (indiceDiaSemana) e lib/data/dataLocal.js (diaDaSemanaExibicao):
// meio-dia local evita que a conversão de fuso empurre a data para o dia
// anterior/seguinte — data de calendário puro, sem componente de hora.
function indiceDiaSemana(dataYYYYMMDD) {
  return new Date(`${dataYYYYMMDD}T12:00:00`).getDay();
}

const STATUS_LABEL = { aberto: 'Aberto', fechado: 'Fechado', reaberto: 'Reaberto' };
const ORIGEM_LABEL = { manual: 'Manual', historico: 'Histórico', retroativo: 'Retroativo' };
const ORIGEM_COR = { manual: '#2196F3', historico: '#795548', retroativo: '#9C27B0' };

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarPercentualVenda(quantidadeVendida, quantidadeProduzida) {
  if (quantidadeVendida == null || !quantidadeProduzida) {
    return '—';
  }

  const percentual = (quantidadeVendida / quantidadeProduzida) * 100;
  return `${percentual.toFixed(1)}%`;
}

// Dia da semana não é coluna de producao_registros (derivado de `data`),
// então o filtro vira uma lista de datas de calendário -- todas as datas
// do dia da semana escolhido entre inicio e fim (YYYY-MM-DD, aritmética
// de calendário puro) -- aplicada com .in('data', ...) na consulta.
// Devolve null se passar do teto (período longo demais para a URL).
function datasDoDiaDaSemana(inicio, fim, diaSemana) {
  const deslocamento = (Number(diaSemana) - indiceDiaSemana(inicio) + 7) % 7;
  const datas = [];
  let atual = somarDias(inicio, deslocamento);
  while (atual <= fim) {
    if (datas.length >= MAX_DATAS_DIA_SEMANA) return null;
    datas.push(atual);
    atual = somarDias(atual, 7);
  }
  return datas;
}

function BadgeStatus({ status }) {
  const cores = { aberto: '#FF9800', fechado: '#4CAF50', reaberto: '#f44336' };

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: cores[status] || '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function BadgeOrigem({ origem }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: ORIGEM_COR[origem] || '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {ORIGEM_LABEL[origem] || origem}
    </span>
  );
}

function HistoricoConteudo() {
  const { permissoes, perfilUsuario } = useAuth();

  const [registros, setRegistros] = useState([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [receitaNomePorId, setReceitaNomePorId] = useState({});
  const [receitaIdsComRegistro, setReceitaIdsComRegistro] = useState([]);
  const [produtosAtivos, setProdutosAtivos] = useState([]);
  const [carregandoBase, setCarregandoBase] = useState(true);
  const [baseCarregada, setBaseCarregada] = useState(false);
  const [carregandoRegistros, setCarregandoRegistros] = useState(true);
  const [erro, setErro] = useState('');
  const [erroRegistros, setErroRegistros] = useState('');
  const [pagina, setPagina] = useState(1);

  const [registroVisualizado, setRegistroVisualizado] = useState(null);
  // tipo: 'reabrir' | 'fechar' | 'sobras' | 'completar_retroativo' | 'editar_producao' | 'excluir'
  const [acaoRegistro, setAcaoRegistro] = useState(null);
  const [mostrarLancarRetroativo, setMostrarLancarRetroativo] = useState(false);
  const [recarregarTick, setRecarregarTick] = useState(0);

  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');
  const [filtroProduto, setFiltroProduto] = useState('todos');
  const [filtroTurno, setFiltroTurno] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroDiaSemana, setFiltroDiaSemana] = useState('todos');

  const aparencia = APARENCIA_FIXA;

  // Carga "base" (não depende de filtro/página): nomes das receitas, lista
  // de produtos ativos (seletor de "Lançar produção passada") e quais
  // receitas têm ao menos um registro (opções do filtro Produto -- antes
  // derivadas dos registros carregados, que agora vêm só de 20 em 20).
  // Os registros em si vêm da consulta paginada mais abaixo.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarHistorico() {
      setCarregandoBase(true);
      setErro('');

      const supabase = createClient();

      // Leitura leve (só receita_id) em blocos de 1000 -- o PostgREST
      // limita cada resposta, e um único select cortaria em silêncio.
      async function lerReceitaIdsComRegistro() {
        const ids = new Set();
        for (let inicio = 0; ; inicio += TAMANHO_BLOCO_LEITURA) {
          const { data, error } = await supabase
            .from('producao_registros')
            .select('receita_id')
            .order('id')
            .range(inicio, inicio + TAMANHO_BLOCO_LEITURA - 1);
          if (error) return { data: null, error };
          for (const linha of data || []) ids.add(linha.receita_id);
          if ((data || []).length < TAMANHO_BLOCO_LEITURA) return { data: Array.from(ids), error: null };
        }
      }

      const [idsComRegistroResp, receitasResp, produtosAtivosResp] = await Promise.all([
        lerReceitaIdsComRegistro(),
        // CONTEXTO HISTÓRICO: LEFT embed (produtos, sem !inner) -- nunca
        // pode esconder um registro/receita histórica por causa de um
        // vínculo ausente ou de um produto desativado depois. Fallback
        // produto.nome ?? receita.nome (snapshot legado) na montagem do
        // mapa abaixo, exatamente como pedido para este caso.
        supabase.from('receitas').select('id, nome, produtos(nome)'),
        // Lista separada da acima: aqui só produtos ATUALMENTE ativos em
        // Produção, para o seletor de "Lançar produção passada" -- este
        // sim é um contexto operacional atual, não histórico, então exige
        // defesa em profundidade (produtos.ativo=true E receitas.ativo=
        // true) e identidade vinda do produto mestre. A lista de cima
        // continua incluindo também produtos já desativados, para não
        // perder o nome de registros históricos que os referenciam.
        supabase
          .from('receitas')
          .select('id, produtos!inner(nome)')
          .eq('ativo', true)
          .eq('produtos.ativo', true),
      ]);

      if (!efeitoAtivo) {
        return;
      }

      const primeiroErro = idsComRegistroResp.error || receitasResp.error || produtosAtivosResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar histórico de produção:', primeiroErro);
        setErro('Não foi possível carregar o histórico de produção.');
        setReceitaIdsComRegistro([]);
        setReceitaNomePorId({});
        setProdutosAtivos([]);
        setCarregandoBase(false);
        return;
      }

      const mapa = {};
      for (const r of receitasResp.data || []) {
        mapa[r.id] = r.produtos?.nome ?? r.nome;
      }

      // Achata para {id, nome} -- mesma forma usada por LancarProducaoRetroativaModal
      // antes da unificação. Ordenado no cliente por nome.
      const produtosAtivosAchatados = (produtosAtivosResp.data || [])
        .map((p) => ({ id: p.id, nome: p.produtos?.nome || '' }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

      setReceitaIdsComRegistro(idsComRegistroResp.data || []);
      setReceitaNomePorId(mapa);
      setProdutosAtivos(produtosAtivosAchatados);
      setBaseCarregada(true);
      setCarregandoBase(false);
    }

    carregarHistorico();

    return () => {
      efeitoAtivo = false;
    };
  }, [recarregarTick]);

  // Consulta paginada de registros (filtros + página). Ordem: data mais
  // recente primeiro, manhã antes de tarde, e id como desempate final
  // para a paginação ser estável entre páginas.
  useEffect(() => {
    if (!baseCarregada) return undefined;
    let efeitoAtivo = true;

    function vazio() {
      setRegistros([]);
      setTotalRegistros(0);
      setCarregandoRegistros(false);
    }

    async function carregarRegistros() {
      setCarregandoRegistros(true);
      setErroRegistros('');

      const supabase = createClient();

      // Dia da semana -> lista de datas (ver datasDoDiaDaSemana). Sem
      // período completo, as pontas vêm da menor/maior data existente.
      let datasDiaSemana = null;
      if (filtroDiaSemana !== 'todos') {
        let inicio = filtroPeriodoInicio;
        let fim = filtroPeriodoFim;

        if (!inicio || !fim) {
          const [menorResp, maiorResp] = await Promise.all([
            supabase.from('producao_registros').select('data').order('data', { ascending: true }).limit(1),
            supabase.from('producao_registros').select('data').order('data', { ascending: false }).limit(1),
          ]);
          if (!efeitoAtivo) return;

          const erroLimites = menorResp.error || maiorResp.error;
          if (erroLimites) {
            console.error('Erro ao carregar histórico de produção:', erroLimites);
            setErroRegistros('Não foi possível carregar o histórico de produção.');
            setCarregandoRegistros(false);
            return;
          }

          const menor = menorResp.data?.[0]?.data;
          const maior = maiorResp.data?.[0]?.data;
          if (!menor || !maior) {
            vazio();
            return;
          }
          inicio = inicio || menor;
          fim = fim || maior;
        }

        datasDiaSemana = datasDoDiaDaSemana(inicio, fim, filtroDiaSemana);
        if (datasDiaSemana === null) {
          setErroRegistros(
            'Período muito longo para filtrar por dia da semana. Informe um período inicial e final mais curto.'
          );
          vazio();
          return;
        }
        if (datasDiaSemana.length === 0) {
          vazio();
          return;
        }
      }

      let consulta = supabase
        .from('producao_registros')
        .select(
          'id, data, turno, receita_id, origem, status, quantidade_produzida, quantidade_vendida, sobra_total, sobra_aproveitavel, perda_descarte, observacoes, houve_falta, criado_em, atualizado_em',
          { count: 'exact' }
        );

      if (filtroPeriodoInicio) consulta = consulta.gte('data', filtroPeriodoInicio);
      if (filtroPeriodoFim) consulta = consulta.lte('data', filtroPeriodoFim);
      if (filtroProduto !== 'todos') consulta = consulta.eq('receita_id', filtroProduto);
      if (filtroTurno !== 'todos') consulta = consulta.eq('turno', filtroTurno);
      if (filtroStatus !== 'todos') consulta = consulta.eq('status', filtroStatus);
      if (datasDiaSemana) consulta = consulta.in('data', datasDiaSemana);

      const inicioLinha = (pagina - 1) * TAMANHO_PAGINA;
      const { data, count, error } = await consulta
        .order('data', { ascending: false })
        .order('turno', { ascending: true })
        .order('id', { ascending: true })
        .range(inicioLinha, inicioLinha + TAMANHO_PAGINA - 1);

      if (!efeitoAtivo) return;

      if (error) {
        console.error('Erro ao carregar histórico de produção:', error);
        setErroRegistros('Não foi possível carregar o histórico de produção.');
        setCarregandoRegistros(false);
        return;
      }

      // Página fora do intervalo (ex.: excluiu o único registro da última
      // página): volta para a última página válida -- o efeito roda de
      // novo com a página corrigida.
      const total = count ?? 0;
      if ((data || []).length === 0 && total > 0 && pagina > 1) {
        setPagina(Math.ceil(total / TAMANHO_PAGINA));
        return;
      }

      setRegistros(data || []);
      setTotalRegistros(total);
      setCarregandoRegistros(false);
    }

    carregarRegistros();

    return () => {
      efeitoAtivo = false;
    };
  }, [
    baseCarregada,
    recarregarTick,
    pagina,
    filtroPeriodoInicio,
    filtroPeriodoFim,
    filtroProduto,
    filtroTurno,
    filtroStatus,
    filtroDiaSemana,
  ]);

  // Qualquer mudança de filtro volta para a página 1.
  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  const filtrosAtivos =
    filtroPeriodoInicio !== '' ||
    filtroPeriodoFim !== '' ||
    filtroProduto !== 'todos' ||
    filtroTurno !== 'todos' ||
    filtroStatus !== 'todos' ||
    filtroDiaSemana !== 'todos';

  function limparFiltros() {
    setFiltroPeriodoInicio('');
    setFiltroPeriodoFim('');
    setFiltroProduto('todos');
    setFiltroTurno('todos');
    setFiltroStatus('todos');
    setFiltroDiaSemana('todos');
    setPagina(1);
  }

  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA));

  function abrirVisualizar(registro) {
    setRegistroVisualizado(registro);
  }

  function fecharVisualizar() {
    setRegistroVisualizado(null);
  }

  function abrirAcao(tipo, registro) {
    setAcaoRegistro({ tipo, registro });
  }

  function fecharAcao() {
    setAcaoRegistro(null);
  }

  function aoAtualizarRegistro() {
    fecharAcao();
    setRecarregarTick((tick) => tick + 1);
  }

  function abrirLancarRetroativo() {
    setMostrarLancarRetroativo(true);
  }

  function fecharLancarRetroativo() {
    setMostrarLancarRetroativo(false);
  }

  function aoLancarRetroativo() {
    fecharLancarRetroativo();
    setRecarregarTick((tick) => tick + 1);
  }

  const produtosDisponiveis = receitaIdsComRegistro
    .map((id) => ({ id, nome: receitaNomePorId[id] || id }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // Rota A (decisão de 2026-08-24): historico.editar é o gate de TELA das
  // ações de edição do Histórico; a RLS real de producao_registros continua
  // exigindo producao.editar por baixo. Os dois têm que estar vigentes —
  // ter só um dos dois não é suficiente (evita mostrar um botão que a RLS
  // recusaria, ou destravar a tela sem a permissão operacional real).
  const podeEditar =
    hasPermissao(permissoes, PERMISSOES.HISTORICO_EDITAR) &&
    hasPermissao(permissoes, PERMISSOES.PRODUCAO_EDITAR);

  // Mesmo par de gates (tela + RLS real) de podeEditar, mas para a ação
  // de criar (producao.inserir), não editar.
  const podeLancarRetroativo =
    hasPermissao(permissoes, PERMISSOES.HISTORICO_EDITAR) &&
    hasPermissao(permissoes, PERMISSOES.PRODUCAO_INSERIR);

  // Reabertura clássica (fechado->reaberto) — exclusiva de producao.cancelar
  // (ou admin para histórico). producao.corrigir NUNCA entra aqui: usada
  // somente pelo botão "Reabrir" e por qualquer ação real de cancelamento.
  function podeReabrirRegistro(registro) {
    return registro.origem === 'historico'
      ? isAdmin(perfilUsuario)
      : hasPermissao(permissoes, PERMISSOES.PRODUCAO_CANCELAR);
  }

  // "Editar produção" (correção de quantidade_produzida/sobra, atômica,
  // migration 0019) — aceita producao.cancelar OU producao.corrigir para
  // manual/retroativo. Gateia os dois botões "Editar produção" (fechado e
  // reaberto), nunca o botão "Reabrir".
  function podeEditarProducaoRegistro(registro) {
    return registro.origem === 'historico'
      ? isAdmin(perfilUsuario)
      : hasPermissao(permissoes, PERMISSOES.PRODUCAO_CANCELAR) ||
        hasPermissao(permissoes, PERMISSOES.PRODUCAO_CORRIGIR);
  }

  // Gerenciar sobras: producao.editar (+ historico.editar, gate de tela)
  // para manual (ação operacional, não estrutural), admin para histórico —
  // mesma regra de CardTurno.js, mas com o gate de tela do Histórico
  // aplicado por cima.
  function podeGerenciarSobrasRegistro(registro) {
    return registro.origem === 'historico' ? isAdmin(perfilUsuario) : podeEditar;
  }

  // Marcar/desmarcar houve_falta: correção operacional simples (mesmo
  // espírito de observações, nunca uma correção estrutural), então usa o
  // mesmo par de gates (tela + RLS real) de podeEditar para manual/
  // retroativo, e admin para histórico — mesma regra já aplicada a
  // "Gerenciar sobras" acima.
  function podeMarcarFaltaRegistro(registro) {
    return registro.origem === 'historico' ? isAdmin(perfilUsuario) : podeEditar;
  }

  // Exclusão definitiva (migration 0020) — exclusiva de administrador,
  // independente de origem/status. A garantia real é a RLS
  // (producao_registros_delete, is_admin()) + a checagem explícita dentro
  // da RPC excluir_producao_registro; este gate aqui é só UI.
  const podeExcluir = isAdmin(perfilUsuario);

  // Tela cheia de "Carregando" só na carga base ou na primeira consulta; nas
  // trocas de filtro/página a tabela anterior fica visível, esmaecida.
  const carregando = carregandoBase || (carregandoRegistros && registros.length === 0 && !erroRegistros);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Produção" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <NavegacaoProducao abaAtiva="historico" corPrimaria={aparencia.corPrimaria} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Histórico</h2>

          {podeLancarRetroativo && (
            <button
              onClick={abrirLancarRetroativo}
              style={{
                padding: '10px 18px',
                backgroundColor: aparencia.corPrimaria,
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              + Lançar produção passada
            </button>
          )}
        </div>

        {erro && <p style={{ color: '#f44336', marginTop: '10px' }}>{erro}</p>}

        <div
          style={{
            backgroundColor: '#f9f9f9',
            padding: '15px',
            borderRadius: '5px',
            marginBottom: '20px',
            marginTop: '15px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '15px',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Período inicial
              </label>
              <input
                type="date"
                value={filtroPeriodoInicio}
                onChange={(e) => alterarFiltro(setFiltroPeriodoInicio)(e.target.value)}
                style={campoFiltroEstilo}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Período final
              </label>
              <input
                type="date"
                value={filtroPeriodoFim}
                onChange={(e) => alterarFiltro(setFiltroPeriodoFim)(e.target.value)}
                style={campoFiltroEstilo}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Produto
              </label>
              <select
                value={filtroProduto}
                onChange={(e) => alterarFiltro(setFiltroProduto)(e.target.value)}
                style={campoFiltroEstilo}
              >
                <option value="todos">Todos</option>
                {produtosDisponiveis.map((produto) => (
                  <option key={produto.id} value={produto.id}>
                    {produto.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Turno
              </label>
              <select
                value={filtroTurno}
                onChange={(e) => alterarFiltro(setFiltroTurno)(e.target.value)}
                style={campoFiltroEstilo}
              >
                <option value="todos">Todos</option>
                <option value="manha">Manhã</option>
                <option value="tarde">Tarde</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Status
              </label>
              <select
                value={filtroStatus}
                onChange={(e) => alterarFiltro(setFiltroStatus)(e.target.value)}
                style={campoFiltroEstilo}
              >
                <option value="todos">Todos</option>
                <option value="aberto">Aberto</option>
                <option value="fechado">Fechado</option>
                <option value="reaberto">Reaberto</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Dia da semana
              </label>
              <select
                value={filtroDiaSemana}
                onChange={(e) => alterarFiltro(setFiltroDiaSemana)(e.target.value)}
                style={campoFiltroEstilo}
              >
                <option value="todos">Todos</option>
                {DIA_SEMANA_OPCOES.map((opcao) => (
                  <option key={opcao.value} value={opcao.value}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <BotaoLimparFiltros
                filtrosAtivos={filtrosAtivos}
                onClick={limparFiltros}
                corPrimaria={aparencia.corPrimaria}
              />
            </div>
          </div>
        </div>

        {erroRegistros && <p style={{ color: '#f44336', marginTop: '10px' }}>{erroRegistros}</p>}

        {carregando ? (
          <p>Carregando histórico...</p>
        ) : totalRegistros === 0 ? (
          erroRegistros ? null : (
            <p>{filtrosAtivos ? 'Nenhum resultado para esta busca/filtro.' : 'Nenhum registro encontrado.'}</p>
          )
        ) : (
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '5px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ overflowX: 'auto', opacity: carregandoRegistros ? 0.55 : 1, transition: 'opacity 0.15s' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  {[
                    'Data',
                    'Produto',
                    'Turno',
                    'Produzido',
                    'Vendido',
                    '% Venda',
                    'Sobra total',
                    'Status/Origem',
                    'Obs. / Falta',
                    'Ações',
                  ].map((coluna) => (
                    <th
                      key={coluna}
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        color: aparencia.corPrimaria,
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {registros.map((registro) => {
                  const pendente = registro.status !== 'fechado';
                  const temObservacao = !!(registro.observacoes && registro.observacoes.trim());

                  return (
                    <tr
                      key={registro.id}
                      style={{
                        borderBottom: '1px solid #ddd',
                        backgroundColor: pendente ? '#fff8e1' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                        {formatarDataExibicao(registro.data)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {receitaNomePorId[registro.receita_id] || registro.receita_id}
                      </td>
                      <td style={{ padding: '12px' }}>{TURNO_LABEL[registro.turno] || registro.turno}</td>
                      <td style={{ padding: '12px' }}>{registro.quantidade_produzida}</td>
                      <td style={{ padding: '12px' }}>{registro.quantidade_vendida ?? '—'}</td>
                      <td style={{ padding: '12px' }}>
                        {formatarPercentualVenda(registro.quantidade_vendida, registro.quantidade_produzida)}
                      </td>
                      <td style={{ padding: '12px' }}>{registro.sobra_total ?? '—'}</td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          <BadgeStatus status={registro.status} />
                          <BadgeOrigem origem={registro.origem} />
                          {pendente && (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#8a6d00',
                                backgroundColor: '#ffe082',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Pendência
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          {temObservacao ? (
                            <span
                              title="Possui observação"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                backgroundColor: '#FF9800',
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '12px',
                                cursor: 'default',
                              }}
                            >
                              !
                            </span>
                          ) : (
                            '—'
                          )}
                          <MarcadorFalta
                            registro={registro}
                            podeEditar={podeMarcarFaltaRegistro(registro)}
                            onAtualizado={() => setRecarregarTick((tick) => tick + 1)}
                          />
                        </div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <BotaoIconeAcao
                            rotulo="Visualizar"
                            icone={IconeOlho}
                            onClick={() => abrirVisualizar(registro)}
                          />

                          {registro.status === 'aberto' && registro.origem === 'manual' && podeEditar && (
                            <BotaoIconeAcao
                              rotulo="Fechar agora"
                              icone={IconeCheck}
                              cor="#FF9800"
                              onClick={() => abrirAcao('fechar', registro)}
                            />
                          )}

                          {registro.status === 'aberto' && registro.origem === 'retroativo' && podeEditar && (
                            <BotaoIconeAcao
                              rotulo="Completar lançamento"
                              icone={IconeCheck}
                              cor="#FF9800"
                              onClick={() => abrirAcao('completar_retroativo', registro)}
                            />
                          )}

                          {(registro.status === 'reaberto' || registro.status === 'fechado') &&
                            podeEditarProducaoRegistro(registro) && (
                              <BotaoIconeAcao
                                rotulo="Editar produção"
                                icone={IconeLapis}
                                cor={aparencia.corPrimaria}
                                onClick={() => abrirAcao('editar_producao', registro)}
                              />
                            )}

                          {registro.status === 'fechado' && podeGerenciarSobrasRegistro(registro) && (
                            <BotaoIconeAcao
                              rotulo="Gerenciar sobras"
                              icone={IconeCaixa}
                              cor="#FF9800"
                              onClick={() => abrirAcao('sobras', registro)}
                            />
                          )}

                          {registro.status === 'fechado' && podeReabrirRegistro(registro) && (
                            <BotaoIconeAcao
                              rotulo="Reabrir lançamento"
                              icone={IconeReabrir}
                              onClick={() => abrirAcao('reabrir', registro)}
                            />
                          )}

                          {podeExcluir && (
                            <BotaoIconeAcao
                              rotulo="Excluir lançamento"
                              icone={IconeLixeira}
                              destrutivo
                              onClick={() => abrirAcao('excluir', registro)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            <p style={{ color: '#666', fontSize: '13px', textAlign: 'center', margin: '15px 0 0' }}>
              Mostrando {(pagina - 1) * TAMANHO_PAGINA + 1}–{(pagina - 1) * TAMANHO_PAGINA + registros.length} de{' '}
              {totalRegistros} {totalRegistros === 1 ? 'registro' : 'registros'}
              {totalPaginas > 1 ? ` — página ${pagina} de ${totalPaginas}` : ''}
            </p>
            <Paginacao
              paginaAtual={pagina}
              totalPaginas={totalPaginas}
              onMudarPagina={setPagina}
              desabilitado={carregandoRegistros}
              corPrimaria={aparencia.corPrimaria}
            />
          </div>
        )}
      </div>

      {registroVisualizado && (
        <VisualizarRegistroModal
          registro={registroVisualizado}
          receitaNome={receitaNomePorId[registroVisualizado.receita_id] || registroVisualizado.receita_id}
          turnoLabel={TURNO_LABEL[registroVisualizado.turno] || registroVisualizado.turno}
          corPrimaria={aparencia.corPrimaria}
          onFechar={fecharVisualizar}
        />
      )}

      {acaoRegistro?.tipo === 'reabrir' && (
        <ReaberturaModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onReaberto={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'fechar' && (
        <FechamentoTurnoForm
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onFechado={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'sobras' && (
        <GerenciarSobrasModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onAtualizado={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'completar_retroativo' && (
        <CompletarProducaoRetroativaModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onCompletado={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'editar_producao' && (
        <EditarProducaoModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onEditado={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'excluir' && (
        <ExcluirRegistroModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          onExcluido={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {mostrarLancarRetroativo && (
        <LancarProducaoRetroativaModal
          produtosAtivos={produtosAtivos}
          corPrimaria={aparencia.corPrimaria}
          onLancado={aoLancarRetroativo}
          onCancelar={fecharLancarRetroativo}
        />
      )}
    </div>
  );
}

export default function Historico() {
  return (
    <RequireAuth permissao={PERMISSOES.HISTORICO_VISUALIZAR}>
      <HistoricoConteudo />
    </RequireAuth>
  );
}
