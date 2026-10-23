import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import ClientesSubNav from '../../components/clientes/ClientesSubNav';
import EncomendaModal from '../../components/encomendas/EncomendaModal';
import ConfirmarAcaoModal from '../../components/admin/ConfirmarAcaoModal';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import AcoesLinha from '../../components/ui/AcoesLinha';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import FilterBar from '../../components/ui/FilterBar';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Paginacao, { paginarLista } from '../../components/Paginacao';
import estilosClientes from '../../components/clientes/clientes.module.css';
import estilos from '../../components/encomendas/encomendas.module.css';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, diaDaSemanaExibicao } from '../../lib/data/dataLocal';
import { formatarTelefone } from '../../lib/clientes/telefone';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';
import { useFiltrosPersistidos } from '../../lib/filtros/useFiltrosPersistidos';
import { FILTROS_ENCOMENDAS } from '../../lib/filtros/telas';
import { carregarEncomendas, definirStatusEncomenda, LIMITE_ENCOMENDAS } from '../../lib/encomendas/encomendas';
import {
  encomendaPassaFiltro,
  formatarData,
  formatarHora,
  formatarQuantidade,
  janelaDoPeriodo,
  PERIODOS,
  produtosDasEncomendas,
  STATUS_ENCOMENDA,
} from '../../lib/encomendas/regras';

const MAX_ITENS_NA_LINHA = 3;

function ItensDaEncomenda({ itens }) {
  const visiveis = itens.slice(0, MAX_ITENS_NA_LINHA);
  const resto = itens.length - visiveis.length;
  return (
    <span className={estilos.itensCelula}>
      {visiveis.map((i, indice) => (
        <span key={`${i.produto_id}-${indice}`}>
          {formatarQuantidade(i.quantidade)}× {i.produto_nome}
          {i.comentario && <span className={estilos.comentarioCelula}> — {i.comentario}</span>}
        </span>
      ))}
      {resto > 0 && <span className={estilos.comentarioCelula}>+{resto} {resto === 1 ? 'item' : 'itens'}</span>}
    </span>
  );
}

// CLIENTES > ENCOMENDAS (migration 0071). Lista por período de RETIRADA
// (consulta listar_encomendas da janela escolhida -- a mesma RPC da Agenda e
// do Dashboard), filtra no navegador por busca/status/produto e pagina (20
// por página). Ações: editar (só pendente), concluir, cancelar (lógico) e
// reabrir. Sem preço, pagamento, entrega ou WhatsApp.
function EncomendasConteudo() {
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.ENCOMENDAS_EDITAR);
  const podeCadastrarCliente = hasPermissao(permissoes, PERMISSOES.CLIENTES_EDITAR);
  const hoje = dataLocalHoje();

  // Período/Busca/Status/Produto persistidos durante a sessão de login
  // (lib/filtros). Os presets ("Próximos 30 dias"...) continuam relativos a
  // hoje; De/Até do Personalizado ficam null até o usuário escolher (null =
  // hoje, como antes) e, escolhidos, ficam como ele deixou até novo login.
  const filtros = useFiltrosPersistidos('encomendas', FILTROS_ENCOMENDAS);
  const periodo = filtros.valores.periodo;
  const periodoInicio = filtros.valores.periodoInicio ?? hoje;
  const periodoFim = filtros.valores.periodoFim ?? hoje;
  const { busca, status: filtroStatus, produto: filtroProduto } = filtros.valores;
  const [pagina, setPagina] = useState(1);
  // Ordenação do cabeçalho, guardada durante a sessão de login; mudar volta para a página 1.
  const ordenacao = useOrdenacao({ aoMudar: () => setPagina(1), persistirEm: 'encomendas' });

  const [encomendas, setEncomendas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [limiteAtingido, setLimiteAtingido] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [recarregar, setRecarregar] = useState(0);
  const [modal, setModal] = useState(null); // { encomenda } | { encomenda: null }
  const [cancelamento, setCancelamento] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [erroAcao, setErroAcao] = useState('');

  const janela = useMemo(
    () => janelaDoPeriodo(periodo, hoje, { inicio: periodoInicio, fim: periodoFim }),
    [periodo, hoje, periodoInicio, periodoFim]
  );

  useEffect(() => {
    if (janela.erro) return undefined;
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      const r = await carregarEncomendas(janela.inicio, janela.fim);
      if (!ativo) return;
      setEncomendas(r.encomendas);
      setErro(r.erro);
      setLimiteAtingido(r.limiteAtingido);
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [janela.inicio, janela.fim, janela.erro, recarregar]);

  useEffect(() => {
    if (!mensagem) return undefined;
    const timer = setTimeout(() => setMensagem(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagem]);

  const opcoesProduto = useMemo(() => produtosDasEncomendas(encomendas), [encomendas]);
  const listaFiltrada = useMemo(
    () => encomendas.filter((e) => encomendaPassaFiltro(e, { termo: busca, status: filtroStatus, produto: filtroProduto })),
    [encomendas, busca, filtroStatus, filtroProduto]
  );
  function alterarFiltro(campo) {
    return (valor) => {
      filtros.definir(campo, valor);
      setPagina(1);
    };
  }

  const quantidadeFiltrosAtivos = [periodo !== 'proximos', busca !== '', filtroStatus !== 'pendente', filtroProduto !== ''].filter(Boolean).length;

  function limparFiltros() {
    // Como antes: De/Até não são limpos (só deixam de valer fora do Personalizado).
    filtros.definir({ periodo: 'proximos', busca: '', status: 'pendente', produto: '' });
    setPagina(1);
  }

  async function mudarStatus(encomenda, status, texto) {
    setErro('');
    setProcessando(true);
    const { erro: erroRpc } = await definirStatusEncomenda(encomenda.id, status);
    setProcessando(false);
    if (erroRpc) {
      if (status === 'cancelada') setErroAcao(erroRpc);
      else setErro(erroRpc);
      return;
    }
    setCancelamento(null);
    setMensagem(texto);
    setRecarregar((n) => n + 1);
  }

  function aoSalvar(texto) {
    setModal(null);
    setMensagem(texto);
    setRecarregar((n) => n + 1);
  }

  // Ações por ícone (padrão AcoesLinha: tooltip + aria-label no desktop,
  // botões com texto no cartão mobile). Mesmas regras de antes: editar só
  // pendente (as demais abrem para leitura), concluir/cancelar só pendente,
  // reabrir só concluída/cancelada; cancelar continua pedindo confirmação.
  function acoesDaLinha(e) {
    const pendente = e.status === 'pendente';
    const editavel = podeEditar && pendente;
    return [
      { chave: 'abrir', rotulo: editavel ? 'Editar' : 'Ver', icone: editavel ? 'pencil' : 'eye', onClick: () => setModal({ encomenda: e }), primaria: true },
      podeEditar && pendente && {
        chave: 'concluir',
        rotulo: 'Concluir',
        icone: 'check',
        desabilitado: processando,
        onClick: () => mudarStatus(e, 'concluida', `Encomenda de ${e.cliente_nome} concluída.`),
      },
      podeEditar && pendente && {
        chave: 'cancelar',
        rotulo: 'Cancelar encomenda',
        icone: 'close',
        destrutivo: true,
        desabilitado: processando,
        onClick: () => {
          setErroAcao('');
          setCancelamento(e);
        },
      },
      podeEditar && !pendente && {
        chave: 'reabrir',
        rotulo: 'Reabrir',
        icone: 'undo',
        desabilitado: processando,
        onClick: () => mudarStatus(e, 'pendente', `Encomenda de ${e.cliente_nome} reaberta.`),
      },
    ].filter(Boolean);
  }

  const colunas = [
    {
      chave: 'retirada',
      rotulo: 'Retirada',
      mobile: 'titulo',
      cartaoOrdem: 0,
      ordenavel: { tipo: 'data', valor: (e) => (e.data_retirada ? `${e.data_retirada}T${e.hora_retirada || '00:00'}` : null) },
      render: (e) => (
        <span className={estilos.dataCelula} title={diaDaSemanaExibicao(e.data_retirada)}>
          {formatarData(e.data_retirada)} · {formatarHora(e.hora_retirada)}
          {e.data_retirada === hoje && ' (hoje)'}
        </span>
      ),
    },
    { chave: 'cliente', rotulo: 'Cliente', mobile: 'titulo', cartaoOrdem: 1, ordenavel: { valor: (e) => e.cliente_nome }, render: (e) => e.cliente_nome },
    { chave: 'telefone', rotulo: 'Telefone', render: (e) => <span className={estilosClientes.telefone}>{formatarTelefone(e.cliente_telefone)}</span> },
    { chave: 'itens', rotulo: 'Itens', render: (e) => <ItensDaEncomenda itens={e.itens} /> },
    { chave: 'pedido', rotulo: 'Pedido em', ordenavel: { tipo: 'data', valor: (e) => e.data_pedido }, render: (e) => formatarData(e.data_pedido) },
    { chave: 'status', rotulo: 'Status', ordenavel: { valor: (e) => e.status, ordem: Object.keys(STATUS_ENCOMENDA) }, render: (e) => <Badge tom={STATUS_ENCOMENDA[e.status].tom}>{STATUS_ENCOMENDA[e.status].rotulo}</Badge> },
  ];

  // Ordem padrão da tela, ou a coluna escolhida no cabeçalho -- aplicada ao
  // conjunto filtrado INTEIRO, antes de fatiar a página.
  const paginacao = paginarLista(ordenacao.ordenar(listaFiltrada, colunas), pagina);
  const paginaAtual = paginacao.paginaAtual;

  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  return (
    <PageShell titulo="Clientes">
      <ClientesSubNav ativo="encomendas" />
      <PageHeader
        titulo="Encomendas"
        acoes={
          podeEditar && (
            <Button icone="plus" onClick={() => setModal({ encomenda: null })}>
              Nova encomenda
            </Button>
          )
        }
      />

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Retirada">
          <Select value={periodo} onChange={(e) => alterarFiltro('periodo')(e.target.value)}>
            {Object.entries(PERIODOS).map(([chave, p]) => (
              <option key={chave} value={chave}>
                {p.rotulo}
              </option>
            ))}
          </Select>
        </Field>
        {periodo === 'personalizado' && (
          <>
            <Field label="De">
              <Input type="date" value={periodoInicio} onChange={(e) => alterarFiltro('periodoInicio')(e.target.value)} />
            </Field>
            <Field label="Até">
              <Input type="date" value={periodoFim} onChange={(e) => alterarFiltro('periodoFim')(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Buscar">
          <Input type="search" value={busca} onChange={(e) => alterarFiltro('busca')(e.target.value)} placeholder="Cliente, telefone ou produto" />
        </Field>
        <Field label="Status">
          <Select value={filtroStatus} onChange={(e) => alterarFiltro('status')(e.target.value)}>
            <option value="pendente">Pendentes</option>
            <option value="concluida">Concluídas</option>
            <option value="cancelada">Canceladas</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
        <Field label="Produto">
          <Select value={filtroProduto} onChange={(e) => alterarFiltro('produto')(e.target.value)}>
            <option value="">Todos os produtos</option>
            {opcoesProduto.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} ({p.quantidade})
              </option>
            ))}
            {/* Produto escolhido (filtro guardado) sem encomendas no período:
                não é saneado -- continua selecionado e visível. */}
            {filtroProduto && !opcoesProduto.some((p) => p.id === filtroProduto) && (
              <option value={filtroProduto}>Produto selecionado (sem encomendas no período)</option>
            )}
          </Select>
        </Field>
      </FilterBar>

      {mensagem && <Alert tom="success">{mensagem}</Alert>}
      {janela.erro && <Alert tom="warning">{janela.erro}</Alert>}
      {limiteAtingido && <Alert tom="warning">Mostrando as primeiras {LIMITE_ENCOMENDAS.toLocaleString('pt-BR')} encomendas do período. Escolha um período menor.</Alert>}

      {janela.erro ? null : carregando ? (
        <p role="status">Carregando encomendas...</p>
      ) : erro && encomendas.length === 0 ? (
        <Alert tom="danger">{erro}</Alert>
      ) : encomendas.length === 0 ? (
        <EmptyState>Nenhuma encomenda com retirada neste período.</EmptyState>
      ) : listaFiltrada.length === 0 ? (
        <EmptyState>Nenhuma encomenda para esta busca/filtro.</EmptyState>
      ) : (
        <div className={estilosClientes.superficie}>
          {erro && <Alert tom="danger">{erro}</Alert>}
          <DataTable
            rotulo="Encomendas"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(e) => e.id}
            destaque={(e) => (e.status === 'cancelada' ? 'inativo' : e.status === 'pendente' && e.data_retirada < hoje ? 'aviso' : null)}
            cartoesAte={900}
            ordenacao={ordenacao.props}
            renderAcoes={(e, { cartao }) => <AcoesLinha acoes={acoesDaLinha(e)} cartao={cartao} />}
          />
          <p className={estilosClientes.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total} {paginacao.total === 1 ? 'encomenda' : 'encomendas'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </div>
      )}

      {modal && (
        <EncomendaModal
          encomenda={modal.encomenda}
          podeEditar={podeEditar}
          podeCadastrarCliente={podeCadastrarCliente}
          onFechar={() => setModal(null)}
          onSalvo={aoSalvar}
        />
      )}

      {cancelamento && (
        <ConfirmarAcaoModal
          modalDS
          perigo
          titulo="Cancelar encomenda"
          mensagem={
            <>
              Cancelar a encomenda de <strong>{cancelamento.cliente_nome}</strong> para {formatarData(cancelamento.data_retirada)} às{' '}
              {formatarHora(cancelamento.hora_retirada)}? Ela sai da Agenda e não gera lembrete. Você pode reabri-la depois.
            </>
          }
          textoConfirmar="Cancelar encomenda"
          textoCancelar="Voltar"
          confirmando={processando}
          erro={erroAcao}
          onConfirmar={() => mudarStatus(cancelamento, 'cancelada', `Encomenda de ${cancelamento.cliente_nome} cancelada.`)}
          onCancelar={() => setCancelamento(null)}
        />
      )}
    </PageShell>
  );
}

export default function EncomendasPage() {
  return (
    <RequireAuth permissao={PERMISSOES.ENCOMENDAS_VISUALIZAR}>
      <EncomendasConteudo />
    </RequireAuth>
  );
}
