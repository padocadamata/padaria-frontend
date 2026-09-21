import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import PaginaProducao from '../../components/producao/PaginaProducao';
import EditarLoteExpositorModal from '../../components/producao/EditarLoteExpositorModal';
import CorrigirLoteExpositorConcluidoModal from '../../components/producao/CorrigirLoteExpositorConcluidoModal';
import ExcluirLoteExpositorModal from '../../components/producao/ExcluirLoteExpositorModal';
import { IndicadorObservacao } from '../../components/producao/IconesAcoes';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import FilterBar from '../../components/ui/FilterBar';
import IconButton from '../../components/ui/IconButton';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import SectionHeader from '../../components/ui/SectionHeader';
import Textarea from '../../components/ui/Textarea';
import AcoesLinha from '../../components/ui/AcoesLinha';
import estilos from '../../components/producao/producao.module.css';
import estilosExp from '../../components/producao/expositores.module.css';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { mensagemErroLoteExpositor } from '../../lib/producao/mensagensExpositor';
import { APARENCIA_FIXA } from '../../lib/branding/tema';
import Paginacao, { paginarLista } from '../../components/Paginacao';

// Controle de Expositores (migration 0030). "Situação" NUNCA é lida do
// banco (não existe coluna para isso) -- é sempre derivada aqui,
// comparando producao_expositor_lotes.data_prevista_retirada (date puro)
// com dataLocalHoje()/somarDias() (America/Sao_Paulo) -- mesmo princípio
// já usado por estaAtrasado() em pages/pedidos.js. Nunca current_date/
// now() do Postgres, nunca new Date().toISOString() (UTC).
function situacaoLote(lote, hoje, amanha) {
  if (lote.concluido_em) return 'concluido';
  if (lote.data_prevista_retirada < hoje) return 'atrasado';
  if (lote.data_prevista_retirada === hoje) return 'retirar_hoje';
  if (lote.data_prevista_retirada === amanha) return 'retirar_amanha';
  return 'no_expositor';
}

const SITUACAO_LABEL = {
  atrasado: 'Atrasado',
  retirar_hoje: 'Retirar hoje',
  retirar_amanha: 'Retirar amanhã',
  no_expositor: 'No expositor',
  concluido: 'Concluído',
};

const SITUACAO_TOM = {
  atrasado: 'danger',
  retirar_hoje: 'warning',
  retirar_amanha: 'info',
  no_expositor: 'neutral',
  concluido: 'success',
};

function BadgeSituacao({ situacao }) {
  return <Badge tom={SITUACAO_TOM[situacao] || 'neutral'}>{SITUACAO_LABEL[situacao] || situacao}</Badge>;
}

function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Indicador numérico (só apresentação). O tom acompanha o da Situação.
function CardIndicador({ label, valor, tom }) {
  return (
    <div className={`${estilosExp.indicador} ${estilosExp[tom]}`}>
      <span className={estilosExp.indicadorRotulo}>{label}</span>
      <strong className={estilosExp.indicadorValor}>{valor}</strong>
    </div>
  );
}

function ExpositoresConteudo() {
  const { permissoes } = useAuth();
  const podeOperar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EXPOSITORES_OPERAR);
  const podeEditarConcluido = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EXPOSITORES_EDITAR);
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EXPOSITORES_EXCLUIR);

  const aparencia = APARENCIA_FIXA;

  const hoje = dataLocalHoje();
  const amanha = somarDias(hoje, 1);

  const [lotes, setLotes] = useState([]);
  const [produtosControlados, setProdutosControlados] = useState([]);
  const [registrosElegiveis, setRegistrosElegiveis] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  // Carrega tudo: lotes (view producao_expositor_detalhado, sem filtro de
  // período -- os filtros de período/produto/situação são aplicados no
  // cliente, sobre este mesmo conjunto, tanto para o painel operacional
  // quanto para a lista histórica e o relatório) + produtos com
  // controlar_expositor=true + lançamentos elegíveis para um lote novo
  // (últimos 60 dias, status aberto OU fechado -- produção em andamento
  // já pode ir ao expositor, não precisa esperar o fechamento do turno;
  // 'reaberto' fica de fora de propósito -- migration 0032 também
  // bloqueia isso no banco, em criar_lote_expositor).
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();
      const dataMinima = somarDias(hoje, -60);

      const [{ data: lotesData, error: erroLotes }, { data: produtosData, error: erroProdutos }, { data: registrosData, error: erroRegistros }] =
        await Promise.all([
          supabase
            .from('producao_expositor_detalhado')
            .select(
              'lote_id, producao_registro_id, data_producao, turno, receita_id, produto_nome, quantidade_produzida, quantidade_enviada, data_entrada, prazo_dias_snapshot, data_prevista_retirada, quantidade_retirada, concluido_em, concluido_por, venda_estimada, observacao'
            )
            .order('data_entrada', { ascending: false })
            .limit(1000),
          // Lista de itens ATUALMENTE ativos com controle de expositor --
          // contexto operacional atual (não histórico), por isso exige
          // defesa em profundidade (produtos.ativo=true E receitas.ativo=
          // true) e nome vindo do produto mestre.
          supabase
            .from('receitas')
            .select('id, prazo_expositor_dias, produtos!inner(nome)')
            .eq('controlar_expositor', true)
            .eq('ativo', true)
            .eq('produtos.ativo', true),
          // registrosElegiveis (para criar um lote novo): mantido com a
          // MESMA consulta/relacionamento de antes da unificação, de
          // propósito -- é um lançamento recente (60 dias) já existente,
          // não uma criação de identidade nova, e um embed aninhado
          // adicional (receitas -> produtos, 2 níveis) não tem nenhum
          // precedente testado neste projeto. O nome exibido é resolvido
          // depois (registrosComDisponivel) preferindo produtos.nome já
          // carregado acima (produtosControlados), com fallback para
          // receitas.nome só se o produto não estiver nessa lista --
          // evita introduzir uma consulta de risco maior sem necessidade.
          supabase
            .from('producao_registros')
            .select('id, data, turno, receita_id, quantidade_produzida, receitas!inner(nome, controlar_expositor)')
            .in('status', ['aberto', 'fechado'])
            .eq('receitas.controlar_expositor', true)
            .gte('data', dataMinima)
            .order('data', { ascending: false })
            .limit(300),
        ]);

      if (!efeitoAtivo) return;

      if (erroLotes || erroProdutos || erroRegistros) {
        console.error('Erro ao carregar Expositores:', erroLotes || erroProdutos || erroRegistros);
        setErro('Não foi possível carregar os dados de Expositores.');
        setCarregando(false);
        return;
      }

      // Achata para {id, nome, prazo_expositor_dias} -- mesma forma usada
      // pelo restante do arquivo antes da unificação. Ordenado no cliente.
      const produtosAchatados = (produtosData || [])
        .map((p) => ({ id: p.id, nome: p.produtos?.nome || '', prazo_expositor_dias: p.prazo_expositor_dias }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

      setLotes(lotesData || []);
      setProdutosControlados(produtosAchatados);
      setRegistrosElegiveis(registrosData || []);
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recarregarTick]);

  function recarregar(msg) {
    if (msg) setMensagemSucesso(msg);
    setRecarregarTick((t) => t + 1);
  }

  // Soma de quantidade_enviada já lançada por lançamento -- usada para
  // calcular "disponível" na criação de um novo lote. Vem do MESMO
  // conjunto `lotes` (não filtrado por período), para nunca subestimar a
  // soma real já enviada -- ver arquitetura da migration 0030.
  const somaEnviadaPorRegistro = useMemo(() => {
    const mapa = new Map();
    for (const lote of lotes) {
      mapa.set(lote.producao_registro_id, (mapa.get(lote.producao_registro_id) || 0) + lote.quantidade_enviada);
    }
    return mapa;
  }, [lotes]);

  // produtosControlados já é a autoridade correta de elegibilidade ATUAL
  // (receitas.controlar_expositor=true AND receitas.ativo=true AND
  // produtos.ativo=true, ver consulta acima) -- reaproveitado aqui para
  // (1) resolver o nome do produto mestre e (2) filtrar quais lançamentos
  // recentes podem virar um lote NOVO. Nenhuma query aninhada adicional
  // precisou ser criada. Isto NÃO afeta lotes/histórico já existentes
  // (lotesComSituacao/lotesListaHistorico/relatorio vêm de outro estado,
  // `lotes`, carregado à parte da view producao_expositor_detalhado, sem
  // nenhum filtro novo) -- só a lista de lançamentos elegíveis para uma
  // AÇÃO NOVA (criar lote) é restringida.
  const nomeAtualPorReceitaId = useMemo(() => {
    const mapa = new Map();
    for (const p of produtosControlados) {
      mapa.set(p.id, p.nome);
    }
    return mapa;
  }, [produtosControlados]);

  const registrosComDisponivel = useMemo(
    () =>
      registrosElegiveis
        // Elegibilidade ATUAL para criar um lote novo: a receita precisa
        // estar no conjunto de produtosControlados agora, não só ter
        // estado elegível no momento do lançamento (ex.: produto mestre
        // desativado depois não pode receber um lote novo, mesmo que o
        // lançamento em si continue com disponível > 0).
        .filter((r) => nomeAtualPorReceitaId.has(r.receita_id))
        .map((r) => ({
          id: r.id,
          data: r.data,
          turno: r.turno,
          produtoNome: nomeAtualPorReceitaId.get(r.receita_id) || r.receitas?.nome || '—',
          quantidadeProduzida: r.quantidade_produzida,
          disponivel: r.quantidade_produzida - (somaEnviadaPorRegistro.get(r.id) || 0),
        }))
        .filter((r) => r.disponivel > 0),
    [registrosElegiveis, somaEnviadaPorRegistro, nomeAtualPorReceitaId]
  );

  const lotesComSituacao = useMemo(
    () => lotes.map((l) => ({ ...l, situacao: situacaoLote(l, hoje, amanha) })),
    [lotes, hoje, amanha]
  );

  const indicadores = useMemo(() => {
    const contagem = { atrasado: 0, retirar_hoje: 0, retirar_amanha: 0, no_expositor: 0 };
    for (const l of lotesComSituacao) {
      if (contagem[l.situacao] !== undefined) contagem[l.situacao] += 1;
    }
    return contagem;
  }, [lotesComSituacao]);

  // Painel operacional: atrasados + retirar hoje em destaque, retirar
  // amanhã como aviso secundário -- nunca lotes já concluídos nem "no
  // expositor" distante.
  const lotesUrgentes = useMemo(
    () =>
      lotesComSituacao
        .filter((l) => l.situacao === 'atrasado' || l.situacao === 'retirar_hoje')
        .sort((a, b) => a.data_prevista_retirada.localeCompare(b.data_prevista_retirada)),
    [lotesComSituacao]
  );
  const lotesAmanha = useMemo(
    () => lotesComSituacao.filter((l) => l.situacao === 'retirar_amanha'),
    [lotesComSituacao]
  );

  // Filtros da seção "Produtos nos Expositores" + relatório.
  const [filtroInicio, setFiltroInicio] = useState('');
  const [filtroFim, setFiltroFim] = useState('');
  const [filtroProdutoId, setFiltroProdutoId] = useState('todos');
  const [filtroSituacao, setFiltroSituacao] = useState('todos');

  const lotesNoPeriodoEProduto = useMemo(
    () =>
      lotesComSituacao.filter((l) => {
        if (filtroInicio && l.data_entrada < filtroInicio) return false;
        if (filtroFim && l.data_entrada > filtroFim) return false;
        if (filtroProdutoId !== 'todos' && l.receita_id !== filtroProdutoId) return false;
        return true;
      }),
    [lotesComSituacao, filtroInicio, filtroFim, filtroProdutoId]
  );

  const lotesListaHistorico = useMemo(
    () =>
      lotesNoPeriodoEProduto
        .filter((l) => filtroSituacao === 'todos' || l.situacao === filtroSituacao)
        .sort((a, b) => b.data_entrada.localeCompare(a.data_entrada)),
    [lotesNoPeriodoEProduto, filtroSituacao]
  );

  // Paginação VISUAL (client-side, 20 lotes por página) SÓ da lista
  // "Produtos nos Expositores". O conjunto completo de lotes precisa
  // continuar em memória: alimenta painel "Retirar hoje", indicadores,
  // "disponível" para novo lote (soma enviada) e o relatório; e a Situação
  // é calculada no cliente (não é coluna do banco). Estados de edição
  // inline (quantidadeRetiradaPorLote etc.) ficam por lote_id, fora da
  // linha renderizada -- trocar de página não os perde.
  const [pagina, setPagina] = useState(1);
  const paginacao = paginarLista(lotesListaHistorico, pagina);
  const paginaAtual = paginacao.paginaAtual;

  const quantidadeFiltrosAtivos = [
    filtroInicio !== '',
    filtroFim !== '',
    filtroProdutoId !== 'todos',
    filtroSituacao !== 'todos',
  ].filter(Boolean).length;

  function limparFiltros() {
    setFiltroInicio('');
    setFiltroFim('');
    setFiltroProdutoId('todos');
    setFiltroSituacao('todos');
    setPagina(1);
  }

  // Qualquer mudança de filtro volta para a página 1.
  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  // Total encolheu (filtro, lote concluído/excluído, recarga): corrige a
  // página guardada.
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  // Relatório de desempenho -- SOMENTE lotes concluídos (venda estimada só
  // existe para eles): agrupado por produto, tudo derivado do mesmo
  // conjunto já carregado (nenhuma tabela agregada). quantidade_produzida
  // deduplicada por producao_registro_id (um lançamento pode ter vários
  // lotes -- não pode ser somado por lote, senão duplicaria).
  const relatorio = useMemo(() => {
    const porProduto = new Map();
    for (const lote of lotesNoPeriodoEProduto) {
      if (!lote.concluido_em) continue;
      const atual = porProduto.get(lote.receita_id) || {
        produtoNome: lote.produto_nome,
        registrosVistos: new Set(),
        quantidadeProduzida: 0,
        quantidadeEnviada: 0,
        quantidadeRetirada: 0,
      };
      if (!atual.registrosVistos.has(lote.producao_registro_id)) {
        atual.registrosVistos.add(lote.producao_registro_id);
        atual.quantidadeProduzida += lote.quantidade_produzida;
      }
      atual.quantidadeEnviada += lote.quantidade_enviada;
      atual.quantidadeRetirada += lote.quantidade_retirada;
      porProduto.set(lote.receita_id, atual);
    }
    return Array.from(porProduto.values())
      .map((p) => {
        const vendaEstimada = p.quantidadeEnviada - p.quantidadeRetirada;
        const aproveitamento = p.quantidadeEnviada > 0 ? (vendaEstimada / p.quantidadeEnviada) * 100 : null;
        return { ...p, vendaEstimada, aproveitamento };
      })
      .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, 'pt-BR'));
  }, [lotesNoPeriodoEProduto]);

  // --- Criação de novo lote -----------------------------------------
  const [registroSelecionadoId, setRegistroSelecionadoId] = useState('');
  const [novoDataEntrada, setNovoDataEntrada] = useState(hoje);
  const [novaQuantidade, setNovaQuantidade] = useState('');
  const [novaObservacao, setNovaObservacao] = useState('');
  const [criandoLote, setCriandoLote] = useState(false);
  const [erroNovoLote, setErroNovoLote] = useState('');

  const registroSelecionado = registrosComDisponivel.find((r) => r.id === registroSelecionadoId);

  async function criarLote() {
    if (!registroSelecionadoId || !novoDataEntrada) {
      setErroNovoLote('Selecione o lançamento e a data de entrada.');
      return;
    }
    const quantidade = novaQuantidade !== '' ? parseInt(novaQuantidade, 10) : null;
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      setErroNovoLote('Informe uma quantidade enviada maior que zero.');
      return;
    }

    setCriandoLote(true);
    setErroNovoLote('');

    const supabase = createClient();
    const { error } = await supabase.rpc('criar_lote_expositor', {
      p_registro_id: registroSelecionadoId,
      p_data_entrada: novoDataEntrada,
      p_quantidade_enviada: quantidade,
      p_observacao: novaObservacao.trim() || null,
    });

    setCriandoLote(false);

    if (error) {
      setErroNovoLote(mensagemErroLoteExpositor(error));
      return;
    }

    setRegistroSelecionadoId('');
    setNovaQuantidade('');
    setNovaObservacao('');
    setNovoDataEntrada(hoje);
    recarregar('Lote criado com sucesso.');
  }

  // --- Retirada inline (painel operacional) --------------------------
  const [quantidadeRetiradaPorLote, setQuantidadeRetiradaPorLote] = useState({});
  const [concluindoLoteId, setConcluindoLoteId] = useState(null);
  const [erroRetiradaPorLote, setErroRetiradaPorLote] = useState({});

  async function confirmarRetirada(lote) {
    const valor = quantidadeRetiradaPorLote[lote.lote_id];
    const quantidade = valor !== undefined && valor !== '' ? parseInt(valor, 10) : null;

    if (!Number.isInteger(quantidade) || quantidade < 0) {
      setErroRetiradaPorLote((atual) => ({ ...atual, [lote.lote_id]: 'Informe a quantidade retirada.' }));
      return;
    }

    setConcluindoLoteId(lote.lote_id);
    setErroRetiradaPorLote((atual) => {
      const { [lote.lote_id]: _removido, ...resto } = atual;
      return resto;
    });

    const supabase = createClient();
    const { error } = await supabase.rpc('concluir_retirada_expositor', {
      p_lote_id: lote.lote_id,
      p_quantidade_retirada: quantidade,
    });

    setConcluindoLoteId(null);

    if (error) {
      setErroRetiradaPorLote((atual) => ({ ...atual, [lote.lote_id]: mensagemErroLoteExpositor(error) }));
      return;
    }

    recarregar('Retirada registrada.');
  }

  // --- Edição / correção / exclusão ----------------------------------
  const [loteParaEditar, setLoteParaEditar] = useState(null);
  const [loteParaCorrigir, setLoteParaCorrigir] = useState(null);
  const [loteParaExcluir, setLoteParaExcluir] = useState(null);

  // --- Definições de colunas (UMA para tabela e cartão) ---------------

  function campoRetirada(lote, rotulo) {
    return (
      <Input
        type="number"
        min="0"
        max={lote.quantidade_enviada}
        className={estilosExp.campoRetirada}
        aria-label={rotulo}
        value={quantidadeRetiradaPorLote[lote.lote_id] ?? ''}
        onChange={(e) => setQuantidadeRetiradaPorLote((atual) => ({ ...atual, [lote.lote_id]: e.target.value }))}
      />
    );
  }

  const colunasUrgentes = [
    { chave: 'produto', rotulo: 'Produto', mobile: 'titulo', cartaoOrdem: 0, render: (l) => l.produto_nome },
    { chave: 'entrada', rotulo: 'Entrada', render: (l) => formatarData(l.data_entrada) },
    { chave: 'retiradaPrevista', rotulo: 'Retirada prevista', render: (l) => formatarData(l.data_prevista_retirada) },
    { chave: 'enviado', rotulo: 'Enviado', alinhar: 'direita', render: (l) => l.quantidade_enviada },
    {
      chave: 'qtdRetirada',
      rotulo: 'Qtd. retirada',
      render: (l) => (podeOperar ? campoRetirada(l, `Quantidade retirada — ${l.produto_nome}`) : '—'),
    },
    { chave: 'situacao', rotulo: 'Situação', mobile: 'titulo', cartaoOrdem: 1, render: (l) => <BadgeSituacao situacao={l.situacao} /> },
  ];

  const colunasLotes = [
    {
      chave: 'produto',
      rotulo: 'Produto',
      mobile: 'titulo',
      cartaoOrdem: 0,
      render: (l) => (
        <>
          {l.produto_nome}
          <IndicadorObservacao texto={l.observacao} />
        </>
      ),
    },
    { chave: 'dataProducao', rotulo: 'Data produção', render: (l) => formatarData(l.data_producao) },
    { chave: 'dataEntrada', rotulo: 'Data entrada', render: (l) => formatarData(l.data_entrada) },
    { chave: 'retiradaPrevista', rotulo: 'Retirada prevista', render: (l) => formatarData(l.data_prevista_retirada) },
    { chave: 'produzido', rotulo: 'Produzido', alinhar: 'direita', render: (l) => l.quantidade_produzida },
    { chave: 'enviado', rotulo: 'Enviado', alinhar: 'direita', render: (l) => l.quantidade_enviada },
    { chave: 'retirado', rotulo: 'Retirado', alinhar: 'direita', render: (l) => l.quantidade_retirada ?? '—' },
    {
      chave: 'vendaEstimada',
      rotulo: 'Venda estimada',
      alinhar: 'direita',
      /* venda_estimada só existe (não-null) para lote concluído -- a view
         producao_expositor_detalhado já garante isso (CASE WHEN concluido_em
         IS NOT NULL). "Pendente" aqui reforça visualmente que a quantidade
         enviada de um lote ainda no expositor NUNCA deve ser lida como venda
         estimada -- a retirada final ainda não é conhecida. */
      render: (l) => (l.concluido_em ? l.venda_estimada : <span className={estilosExp.pendente}>Pendente</span>),
    },
    { chave: 'situacao', rotulo: 'Situação', mobile: 'titulo', cartaoOrdem: 1, render: (l) => <BadgeSituacao situacao={l.situacao} /> },
  ];

  const colunasRelatorio = [
    { chave: 'produto', rotulo: 'Produto', mobile: 'titulo', render: (r) => r.produtoNome },
    { chave: 'produzido', rotulo: 'Produzido', alinhar: 'direita', render: (r) => r.quantidadeProduzida },
    { chave: 'enviado', rotulo: 'Enviado', alinhar: 'direita', render: (r) => r.quantidadeEnviada },
    { chave: 'retirado', rotulo: 'Retirado', alinhar: 'direita', render: (r) => r.quantidadeRetirada },
    { chave: 'venda', rotulo: 'Venda estimada', alinhar: 'direita', render: (r) => r.vendaEstimada },
    { chave: 'aproveitamento', rotulo: 'Aproveitamento', alinhar: 'direita', render: (r) => (r.aproveitamento == null ? '—' : `${r.aproveitamento.toFixed(0)}%`) },
  ];

  // Erro da retirada, logo abaixo da linha do lote (mesmo texto/estado de antes).
  const erroDaRetirada = (lote) =>
    erroRetiradaPorLote[lote.lote_id] ? <p className={estilosExp.erroLinha} role="alert">{erroRetiradaPorLote[lote.lote_id]}</p> : null;

  // Painel "Retirar hoje": a única ação é "Retirado".
  function acoesUrgentes(lote, { cartao }) {
    if (!podeOperar) return null;
    return (
      <AcoesLinha
        cartao={cartao}
        acoes={[
          {
            chave: 'retirado',
            rotulo: 'Retirado',
            icone: 'check',
            primaria: true,
            desabilitado: concluindoLoteId === lote.lote_id,
            onClick: () => confirmarRetirada(lote),
          },
        ]}
      />
    );
  }

  // Lista "Produtos nos Expositores": retirada rápida (mesmo handler e mesmo
  // estado do painel acima) + editar/corrigir + excluir.
  /* Retirada rápida também aqui, não só no painel "Retirar hoje" -- um produto
     pode esgotar no expositor ANTES da data prevista (ex.: pão do dia vende
     tudo de manhã, mas o prazo só vence à noite), e o operador precisa
     conseguir concluir o lote na hora, sem esperar a situação virar
     "Atrasado"/"Retirar hoje". Mesmo handler (confirmarRetirada) e mesmo
     estado (quantidadeRetiradaPorLote) do painel urgente -- nenhuma lógica
     nova. */
  function acoesLote(lote, { cartao }) {
    const rotuloRetirado = 'Retirado (esgotou ou encerrou antes do prazo previsto)';
    const outras = [
      !lote.concluido_em && podeOperar && { chave: 'editar', rotulo: 'Editar', icone: 'pencil', onClick: () => setLoteParaEditar(lote) },
      !!lote.concluido_em && podeEditarConcluido && { chave: 'corrigir', rotulo: 'Corrigir', icone: 'pencil', onClick: () => setLoteParaCorrigir(lote) },
      podeExcluir && { chave: 'excluir', rotulo: 'Excluir', icone: 'trash', destrutivo: true, onClick: () => setLoteParaExcluir(lote) },
    ].filter(Boolean);

    return (
      <div className={estilosExp.acoesLote}>
        {!lote.concluido_em && podeOperar && (
          <div className={estilosExp.retiradaRapida}>
            {campoRetirada(lote, `Qtd. retirada — ${lote.produto_nome}`)}
            {cartao ? (
              <Button
                tamanho="sm"
                icone="check"
                title="Quantidade retirada -- use também se o produto esgotou antes do prazo previsto."
                disabled={concluindoLoteId === lote.lote_id}
                onClick={() => confirmarRetirada(lote)}
              >
                Retirado
              </Button>
            ) : (
              <IconButton
                icone="check"
                rotulo={rotuloRetirado}
                tom="success"
                tamanho="sm"
                disabled={concluindoLoteId === lote.lote_id}
                onClick={() => confirmarRetirada(lote)}
              />
            )}
          </div>
        )}
        <AcoesLinha acoes={outras} cartao={cartao} />
      </div>
    );
  }

  return (
    <PaginaProducao ativo="expositores" titulo="Expositores">
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      {carregando ? (
        <p role="status">Carregando...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : (
        <>
          {/* Indicadores */}
          <div className={estilosExp.indicadores}>
            <CardIndicador label="Atrasados" valor={indicadores.atrasado} tom="danger" />
            <CardIndicador label="Retirar hoje" valor={indicadores.retirar_hoje} tom="warning" />
            <CardIndicador label="Retirar amanhã" valor={indicadores.retirar_amanha} tom="info" />
            <CardIndicador label="No expositor" valor={indicadores.no_expositor} tom="neutral" />
          </div>

          {/* Controle de Qualidade -- Retirar hoje */}
          <section className={estilos.secao} aria-label="Retirar hoje">
            <SectionHeader titulo="Controle de Qualidade — Retirar hoje" />
            <div className={`${estilos.superficie} ${estilosExp.urgente}`}>
              {lotesUrgentes.length === 0 ? (
                <EmptyState>Nenhum lote atrasado ou previsto para hoje.</EmptyState>
              ) : (
                <DataTable
                  rotulo="Lotes para retirar hoje"
                  colunas={colunasUrgentes}
                  linhas={lotesUrgentes}
                  chaveLinha={(l) => l.lote_id}
                  tituloAcoes="Ação"
                  linhaExtra={erroDaRetirada}
                  renderAcoes={podeOperar ? acoesUrgentes : undefined}
                />
              )}

              {lotesAmanha.length > 0 && (
                <Alert tom="info" className={estilosExp.avisoAmanha}>
                  Aviso: {lotesAmanha.length} lote(s) com retirada prevista para amanhã ({lotesAmanha.map((l) => l.produto_nome).join(', ')}).
                </Alert>
              )}
            </div>
          </section>

          {/* Criar novo lote */}
          {podeOperar && (
            <section className={estilos.secao} aria-label="Enviar produção ao expositor">
              <Card titulo="Enviar produção ao expositor">
                <div className={estilosExp.formGrade}>
                  <Field label="Lançamento">
                    <Select value={registroSelecionadoId} onChange={(e) => setRegistroSelecionadoId(e.target.value)}>
                      <option value="">Selecione</option>
                      {registrosComDisponivel.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatarData(r.data)} — {r.produtoNome} (disponível: {r.disponivel})
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Data de entrada">
                    <Input type="date" value={novoDataEntrada} onChange={(e) => setNovoDataEntrada(e.target.value)} />
                  </Field>

                  <Field label="Quantidade enviada">
                    <Input
                      type="number"
                      min="1"
                      max={registroSelecionado?.disponivel}
                      value={novaQuantidade}
                      onChange={(e) => setNovaQuantidade(e.target.value)}
                    />
                  </Field>
                </div>

                {registroSelecionado && (
                  <p className={estilosExp.resumoLancamento}>
                    Produzido: {registroSelecionado.quantidadeProduzida} · Já enviado:{' '}
                    {registroSelecionado.quantidadeProduzida - registroSelecionado.disponivel} · Disponível para envio:{' '}
                    <strong>{registroSelecionado.disponivel}</strong>
                  </p>
                )}

                <Field label="Observação" className={estilosExp.campoObservacao}>
                  <Textarea
                    value={novaObservacao}
                    onChange={(e) => setNovaObservacao(e.target.value)}
                    placeholder="Opcional -- anotação operacional sobre este lote."
                    rows={2}
                  />
                </Field>

                {erroNovoLote && <Alert tom="danger" className={estilos.mensagem}>{erroNovoLote}</Alert>}

                <Button onClick={criarLote} disabled={criandoLote}>
                  {criandoLote ? 'Criando...' : 'Criar lote'}
                </Button>

                {registrosComDisponivel.length === 0 && (
                  <EmptyState>
                    Nenhum lançamento elegível nos últimos 60 dias (produto sem Controle de Expositores habilitado, ou
                    tudo já enviado).
                  </EmptyState>
                )}
              </Card>
            </section>
          )}

          {/* Produtos nos Expositores */}
          <section className={estilos.secao} aria-label="Produtos nos Expositores">
            <SectionHeader titulo="Produtos nos Expositores" />

            <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
              <Field label="Entrada -- de">
                <Input type="date" value={filtroInicio} onChange={(e) => alterarFiltro(setFiltroInicio)(e.target.value)} />
              </Field>
              <Field label="Entrada -- até">
                <Input type="date" value={filtroFim} onChange={(e) => alterarFiltro(setFiltroFim)(e.target.value)} />
              </Field>
              <Field label="Produto">
                <Select value={filtroProdutoId} onChange={(e) => alterarFiltro(setFiltroProdutoId)(e.target.value)}>
                  <option value="todos">Todos</option>
                  {produtosControlados.map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.nome}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Situação">
                <Select value={filtroSituacao} onChange={(e) => alterarFiltro(setFiltroSituacao)(e.target.value)}>
                  <option value="todos">Todas</option>
                  <option value="atrasado">Atrasado</option>
                  <option value="retirar_hoje">Retirar hoje</option>
                  <option value="retirar_amanha">Retirar amanhã</option>
                  <option value="no_expositor">No expositor</option>
                  <option value="concluido">Concluído</option>
                </Select>
              </Field>
            </FilterBar>

            {lotesListaHistorico.length === 0 ? (
              <EmptyState>Nenhum lote encontrado para os filtros selecionados.</EmptyState>
            ) : (
              <div className={estilos.superficie}>
                <DataTable
                  rotulo="Produtos nos Expositores"
                  colunas={colunasLotes}
                  linhas={paginacao.itens}
                  chaveLinha={(l) => l.lote_id}
                  cartoesAte={1330}
                  linhaExtra={erroDaRetirada}
                  renderAcoes={acoesLote}
                />

                <p className={estilos.resumo}>
                  Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}{' '}
                  {paginacao.total === 1 ? 'lote' : 'lotes'}
                  {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
                </p>
                <Paginacao
                  paginaAtual={paginaAtual}
                  totalPaginas={paginacao.totalPaginas}
                  onMudarPagina={setPagina}
                  corPrimaria={aparencia.corPrimaria}
                />
              </div>
            )}
          </section>

          {/* Relatório de desempenho */}
          <section className={estilos.secao} aria-label="Desempenho por produto">
            <SectionHeader titulo="Desempenho por produto" />
            <p className={estilosExp.notaRelatorio}>
              Somente lotes já concluídos (retirados), dentro do período/produto filtrados acima. Venda estimada nunca é
              venda real -- não alimenta o histórico de vendas nem a sugestão de produção.
            </p>

            {relatorio.length === 0 ? (
              <EmptyState>Nenhum lote concluído para os filtros selecionados.</EmptyState>
            ) : (
              <div className={estilos.superficie}>
                <DataTable
                  rotulo="Desempenho por produto"
                  colunas={colunasRelatorio}
                  linhas={relatorio}
                  chaveLinha={(r) => r.produtoNome}
                />
              </div>
            )}
          </section>
        </>
      )}

      {loteParaEditar && (
        <EditarLoteExpositorModal
          lote={loteParaEditar}
          produtoNome={loteParaEditar.produto_nome}
          corPrimaria={aparencia.corPrimaria}
          onEditado={() => {
            setLoteParaEditar(null);
            recarregar('Lote atualizado.');
          }}
          onCancelar={() => setLoteParaEditar(null)}
        />
      )}

      {loteParaCorrigir && (
        <CorrigirLoteExpositorConcluidoModal
          lote={loteParaCorrigir}
          produtoNome={loteParaCorrigir.produto_nome}
          corPrimaria={aparencia.corPrimaria}
          onCorrigido={() => {
            setLoteParaCorrigir(null);
            recarregar('Correção salva.');
          }}
          onCancelar={() => setLoteParaCorrigir(null)}
        />
      )}

      {loteParaExcluir && (
        <ExcluirLoteExpositorModal
          lote={loteParaExcluir}
          produtoNome={loteParaExcluir.produto_nome}
          onExcluido={() => {
            setLoteParaExcluir(null);
            recarregar('Lote excluído.');
          }}
          onCancelar={() => setLoteParaExcluir(null)}
        />
      )}
    </PaginaProducao>
  );
}

export default function Expositores() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_EXPOSITORES_VISUALIZAR}>
      <ExpositoresConteudo />
    </RequireAuth>
  );
}
