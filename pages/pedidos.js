import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../components/MenuOpcoes';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import PedidoForm from '../components/pedidos/PedidoForm';
import DetalhePedidoModal from '../components/pedidos/DetalhePedidoModal';
import ReceberPedidoModal from '../components/pedidos/ReceberPedidoModal';
import ConfirmarAcaoModal from '../components/admin/ConfirmarAcaoModal';
import { BotaoIconeAcao, IconeOlho } from '../components/producao/IconesAcoes';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';
import { dataLocalHoje } from '../lib/data/dataLocal';

const STATUS_LABEL = {
  aguardando_entrega: 'Aguardando entrega',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

// "Atrasado" nunca é persistido (ver comentário da tabela public.pedidos,
// migration 0022) — é sempre derivado aqui, a partir do mesmo cálculo
// aprovado: status='aguardando_entrega' AND previsao_entrega < hoje, com
// "hoje" vindo de dataLocalHoje() (America/Sao_Paulo), nunca de
// new Date()/UTC.
function estaAtrasado(pedido, hoje) {
  return pedido.status === 'aguardando_entrega' && !!pedido.previsao_entrega && pedido.previsao_entrega < hoje;
}

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Mesmo padrão já usado em ReceberPedidoModal.js/PedidoForm.js: compara
// error.message contra os textos EXATOS das próprias mensagens de RAISE
// EXCEPTION de reabrir_recebimento_pedido (migration 0027) -- nunca
// exibe error.message diretamente na tela (sem SQL/stack/detalhe
// técnico), só decide qual mensagem pré-escrita mostrar. Sem esses
// textos batendo, cai na mensagem genérica -- sem parser mais esperto
// que isso.
function mensagemErroReaberturaRecebimento(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('requer a permissao pedidos.reabrir_recebimento')) {
    return 'Você não tem permissão para reabrir o recebimento deste pedido.';
  }
  if (msg.includes('requer sessao autenticada')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (msg.includes('nao encontrado')) {
    return 'Pedido não encontrado. Recarregue a página.';
  }
  if (msg.includes('somente pedidos recebidos podem ter o recebimento reaberto')) {
    return 'Este pedido não está mais com status Recebido. Recarregue a página.';
  }
  return 'Não foi possível reabrir o recebimento deste pedido. Tente novamente ou avise um administrador.';
}

function BadgeStatusPedido({ pedido, hoje }) {
  const atrasado = estaAtrasado(pedido, hoje);

  const cores = {
    aguardando_entrega: '#FF9800',
    recebido: '#4CAF50',
    cancelado: '#9e9e9e',
  };

  const cor = atrasado ? '#f44336' : cores[pedido.status] || '#9e9e9e';
  const rotulo = atrasado ? 'Atrasado' : STATUS_LABEL[pedido.status] || pedido.status;

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: cor,
        whiteSpace: 'nowrap',
      }}
    >
      {rotulo}
    </span>
  );
}

function PedidosConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();

  const [pedidos, setPedidos] = useState([]);
  const [itensPorPedido, setItensPorPedido] = useState({});
  const [fornecedorNomePorId, setFornecedorNomePorId] = useState({});
  const [produtoNomePorId, setProdutoNomePorId] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [mostrarNovoPedido, setMostrarNovoPedido] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  const [filtroFornecedor, setFiltroFornecedor] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');

  // "Ver pedido" (somente leitura).
  const [pedidoDetalhe, setPedidoDetalhe] = useState(null);

  // Edição de pedido (só aguardando_entrega + pedidos.editar) -- mesmo
  // componente PedidoForm da criação, com `pedido` preenchido.
  const [pedidoParaEditar, setPedidoParaEditar] = useState(null);

  // Exclusão definitiva (só aguardando_entrega + pedidos.excluir), via
  // RPC excluir_pedido (migration 0025) -- nunca DELETE direto.
  const [pedidoParaExcluir, setPedidoParaExcluir] = useState(null);
  const [excluindoPedido, setExcluindoPedido] = useState(false);
  const [erroExclusaoPedido, setErroExclusaoPedido] = useState('');

  // Recebimento detalhado (só aguardando_entrega + pedidos.receber), via
  // RPC receber_pedido (migration 0026) -- substitui o antigo
  // marcar_pedido_recebido (0022, ainda existe no banco, mas nenhum
  // caminho do frontend o chama mais; será removido/revogado por uma
  // migration 0027 futura, depois deste frontend estar validado em
  // produção).
  const [pedidoParaReceber, setPedidoParaReceber] = useState(null);

  // Confirmação de cancelamento (com motivo obrigatório).
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelamento, setErroCancelamento] = useState('');

  // Reabertura de recebimento (só recebido + pedidos.reabrir_recebimento),
  // via RPC reabrir_recebimento_pedido (migration 0027) -- desfaz
  // atomicamente o recebimento (limpa itens + exclui histórico do
  // Catálogo) e devolve o pedido para aguardando_entrega. Nunca UPDATE/
  // DELETE direto -- uma única chamada à RPC.
  const [pedidoParaReabrirRecebimento, setPedidoParaReabrirRecebimento] = useState(null);
  const [reabrindoRecebimento, setReabrindoRecebimento] = useState(false);
  const [erroReaberturaRecebimento, setErroReaberturaRecebimento] = useState('');

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  const podeInserir = hasPermissao(permissoes, PERMISSOES.PEDIDOS_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PEDIDOS_EDITAR);
  const podeReceber = hasPermissao(permissoes, PERMISSOES.PEDIDOS_RECEBER);
  const podeCancelar = hasPermissao(permissoes, PERMISSOES.PEDIDOS_CANCELAR);
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.PEDIDOS_EXCLUIR);
  const podeReabrirRecebimento = hasPermissao(permissoes, PERMISSOES.PEDIDOS_REABRIR_RECEBIMENTO);
  const hoje = dataLocalHoje();

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');
    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const novaConfig = localStorage.getItem('aparenciaConfig');
      if (novaConfig) {
        try {
          setAparencia(JSON.parse(novaConfig));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  // Carga única (mesmo raciocínio de volume pequeno já usado em
  // pages/producao/produtos.js e historico.js) — join manual via mapa em
  // vez de embed do PostgREST, seguindo a mesma convenção já usada em
  // components/dashboard/ProximosPedidos.js.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarPedidos() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      const [pedidosResp, itensResp, fornecedoresResp, produtosResp] = await Promise.all([
        supabase
          .from('pedidos')
          .select(
            'id, fornecedor_id, data_pedido, previsao_entrega, status, observacoes, motivo_cancelamento, recebido_em, criado_em'
          ),
        supabase
          .from('pedido_itens')
          .select(
            'id, pedido_id, produto_id, descricao, quantidade_pedida, unidade, valor_unitario, unidade_recebida, quantidade_recebida, valor_unitario_recebido, valor_total_recebido'
          ),
        supabase.from('fornecedores').select('id, nome, nome_fantasia, razao_social'),
        // Sem filtro de ativo: um item de pedido já lançado precisa continuar
        // mostrando o nome do produto mesmo que ele seja desativado depois
        // (mesmo raciocínio de receitaNomePorId em pages/producao/historico.js).
        supabase.from('produtos').select('id, nome'),
      ]);

      if (!efeitoAtivo) return;

      const primeiroErro = pedidosResp.error || itensResp.error || fornecedoresResp.error || produtosResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar pedidos:', primeiroErro);
        setErro('Não foi possível carregar os pedidos.');
        setPedidos([]);
        setItensPorPedido({});
        setFornecedorNomePorId({});
        setProdutoNomePorId({});
        setCarregando(false);
        return;
      }

      const nomePorId = {};
      for (const f of fornecedoresResp.data || []) {
        nomePorId[f.id] = f.nome_fantasia || f.razao_social || f.nome || f.id;
      }

      const produtoNomePorIdCarregado = {};
      for (const p of produtosResp.data || []) {
        produtoNomePorIdCarregado[p.id] = p.nome;
      }

      const itensPorPedidoId = {};
      for (const item of itensResp.data || []) {
        if (!itensPorPedidoId[item.pedido_id]) {
          itensPorPedidoId[item.pedido_id] = [];
        }
        itensPorPedidoId[item.pedido_id].push(item);
      }

      const ordenados = [...(pedidosResp.data || [])].sort((a, b) => {
        if (a.data_pedido !== b.data_pedido) return a.data_pedido < b.data_pedido ? 1 : -1;
        return a.criado_em < b.criado_em ? 1 : -1;
      });

      setPedidos(ordenados);
      setItensPorPedido(itensPorPedidoId);
      setFornecedorNomePorId(nomePorId);
      setProdutoNomePorId(produtoNomePorIdCarregado);
      setCarregando(false);
    }

    carregarPedidos();
    return () => {
      efeitoAtivo = false;
    };
  }, [recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) return undefined;
    const timer = setTimeout(() => setMensagemSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  // Abertura direta via /pedidos?id=<uuid> (usado pelo widget
  // RecebimentosPrevistos do Dashboard). A permissão para ver é a mesma
  // que já protege a página inteira (RequireAuth abaixo, pedidos.visualizar)
  // -- nenhuma checagem extra necessária aqui. Só abre depois que a
  // listagem já carregou (senão o pedido ainda não existe em `pedidos`).
  useEffect(() => {
    if (!router.isReady || carregando) return;
    const idParam = router.query.id;
    if (!idParam || typeof idParam !== 'string') return;

    const pedido = pedidos.find((p) => p.id === idParam);
    if (pedido) {
      setPedidoDetalhe(pedido);
    }
  }, [router.isReady, router.query.id, pedidos, carregando]);

  function abrirNovoPedido() {
    setMostrarNovoPedido(true);
  }

  function fecharNovoPedido() {
    setMostrarNovoPedido(false);
  }

  function aoCriarPedido() {
    fecharNovoPedido();
    setMensagemSucesso('Pedido criado com sucesso.');
    setRecarregarTick((tick) => tick + 1);
  }

  function abrirDetalhe(pedido) {
    setPedidoDetalhe(pedido);
  }

  // Edição reaproveita PedidoForm (mesmo componente da criação, `pedido`
  // preenchido) -- enriquece com fornecedorNome aqui, já resolvido pelo
  // mapa carregado para a listagem, sem query extra.
  function abrirEdicao(pedido) {
    fecharDetalhe();
    setPedidoParaEditar({ ...pedido, fornecedorNome: fornecedorNomePorId[pedido.fornecedor_id] || pedido.fornecedor_id });
  }

  // Recarrega SEMPRE ao fechar, mesmo em "Cancelar" -- cobre o caso de
  // uma edição ter falhado parcialmente (cabeçalho/alguns itens já
  // salvos antes do erro, ver comentário em PedidoForm.salvarEdicao):
  // fechar sem recarregar deixaria a listagem mostrando o estado
  // anterior à edição, mesmo que parte dela já tenha sido persistida.
  function fecharEdicao() {
    setPedidoParaEditar(null);
    setRecarregarTick((tick) => tick + 1);
  }

  function aoSalvarEdicao() {
    fecharEdicao();
    setMensagemSucesso('Pedido atualizado com sucesso.');
  }

  function abrirConfirmarExclusao(pedido) {
    setErroExclusaoPedido('');
    setPedidoParaExcluir(pedido);
  }

  function fecharConfirmarExclusao() {
    setPedidoParaExcluir(null);
    setErroExclusaoPedido('');
  }

  // Único caminho de exclusão definitiva: RPC excluir_pedido (migration
  // 0025) -- SECURITY DEFINER, RPC-only por desenho (nenhuma policy de
  // DELETE existe em pedidos/pedido_itens). Nunca
  // .from('pedidos').delete() nem .from('pedido_itens').delete() para
  // exclusão completa do pedido.
  async function confirmarExclusaoPedido() {
    setExcluindoPedido(true);
    setErroExclusaoPedido('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_pedido', { p_pedido_id: pedidoParaExcluir.id });

    setExcluindoPedido(false);

    if (error) {
      console.error('Erro ao excluir pedido:', error);
      setErroExclusaoPedido('Não foi possível excluir este pedido. Tente novamente ou avise um administrador.');
      return;
    }

    setPedidoParaExcluir(null);
    fecharDetalhe();
    setMensagemSucesso('Pedido excluído definitivamente.');
    setRecarregarTick((tick) => tick + 1);
  }

  function fecharDetalhe() {
    setPedidoDetalhe(null);
    // Limpa o ?id= da URL ao fechar manualmente, para não reabrir sozinho
    // numa próxima recarga de `pedidos` (ex.: depois de um Receber/Cancelar
    // feito na linha, com o parâmetro ainda na URL).
    if (router.query.id) {
      router.replace('/pedidos', undefined, { shallow: true });
    }
  }

  function abrirRecebimento(pedido) {
    fecharDetalhe();
    setPedidoParaReceber(pedido);
  }

  function fecharRecebimento() {
    setPedidoParaReceber(null);
  }

  // Chamado pelo ReceberPedidoModal após a RPC receber_pedido (migration
  // 0026) confirmar com sucesso -- toda a escrita (itens + histórico do
  // Catálogo + status do pedido) já aconteceu atomicamente dentro da RPC;
  // aqui só fecha o modal e recarrega a listagem.
  function aoConfirmarRecebimento() {
    fecharRecebimento();
    setMensagemSucesso('Pedido recebido com sucesso.');
    setRecarregarTick((tick) => tick + 1);
  }

  function abrirConfirmarCancelamento(pedido) {
    setMotivoCancelamento('');
    setErroCancelamento('');
    setPedidoParaCancelar(pedido);
  }

  function fecharConfirmarCancelamento() {
    setPedidoParaCancelar(null);
    setMotivoCancelamento('');
    setErroCancelamento('');
  }

  // Único caminho de escrita: RPC cancelar_pedido -- nunca UPDATE direto.
  // Motivo obrigatório e não-vazio, validado aqui E de novo pela própria
  // RPC/trigger no banco (dupla proteção, mesmo padrão já usado em
  // PedidoForm.js para criar_pedido).
  async function confirmarCancelamento() {
    if (!motivoCancelamento.trim()) {
      setErroCancelamento('Informe o motivo do cancelamento.');
      return;
    }

    setCancelando(true);
    setErroCancelamento('');

    const supabase = createClient();
    const { error } = await supabase.rpc('cancelar_pedido', {
      p_pedido_id: pedidoParaCancelar.id,
      p_motivo: motivoCancelamento.trim(),
    });

    setCancelando(false);

    if (error) {
      console.error('Erro ao cancelar pedido:', error);
      setErroCancelamento('Não foi possível cancelar este pedido. Tente novamente.');
      return;
    }

    setPedidoParaCancelar(null);
    fecharDetalhe();
    setMensagemSucesso('Pedido cancelado.');
    setRecarregarTick((tick) => tick + 1);
  }

  function abrirConfirmarReaberturaRecebimento(pedido) {
    setErroReaberturaRecebimento('');
    setPedidoParaReabrirRecebimento(pedido);
  }

  function fecharConfirmarReaberturaRecebimento() {
    setPedidoParaReabrirRecebimento(null);
    setErroReaberturaRecebimento('');
  }

  // Único caminho de escrita: RPC reabrir_recebimento_pedido (migration
  // 0027) -- SECURITY DEFINER, uma única chamada. A RPC já faz tudo
  // atomicamente (snapshot de auditoria, exclusão do histórico do
  // Catálogo, limpeza dos campos de recebimento em pedido_itens,
  // transição do pedido para aguardando_entrega) -- nunca UPDATE/DELETE
  // direto daqui, nunca lógica duplicada no frontend. Funciona igual
  // para pedido com recebimento detalhado (0026) ou legado (recebido
  // antes da 0026, sem histórico): a diferenciação já está inteira na
  // RPC.
  async function confirmarReaberturaRecebimento() {
    setReabrindoRecebimento(true);
    setErroReaberturaRecebimento('');

    const supabase = createClient();
    const { error } = await supabase.rpc('reabrir_recebimento_pedido', {
      p_pedido_id: pedidoParaReabrirRecebimento.id,
    });

    setReabrindoRecebimento(false);

    if (error) {
      console.error('Erro ao reabrir recebimento:', error);
      setErroReaberturaRecebimento(mensagemErroReaberturaRecebimento(error));
      return;
    }

    setPedidoParaReabrirRecebimento(null);
    fecharDetalhe();
    setMensagemSucesso('Recebimento reaberto — o pedido voltou para Aguardando entrega.');
    setRecarregarTick((tick) => tick + 1);
  }

  const fornecedoresDisponiveis = Array.from(new Set(pedidos.map((p) => p.fornecedor_id)))
    .map((id) => ({ id, nome: fornecedorNomePorId[id] || id }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const pedidosFiltrados = pedidos.filter((pedido) => {
    if (filtroFornecedor !== 'todos' && pedido.fornecedor_id !== filtroFornecedor) return false;
    if (filtroPeriodoInicio && pedido.data_pedido < filtroPeriodoInicio) return false;
    if (filtroPeriodoFim && pedido.data_pedido > filtroPeriodoFim) return false;

    if (filtroStatus === 'atrasado') {
      return estaAtrasado(pedido, hoje);
    }
    if (filtroStatus !== 'todos' && pedido.status !== filtroStatus) return false;
    return true;
  });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img
                src={aparencia.logoBase64}
                style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }}
                alt="Logo"
              />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>

          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Pedidos a Fornecedores</h2>

          {podeInserir && (
            <button
              onClick={abrirNovoPedido}
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
              + Novo pedido
            </button>
          )}
        </div>

        {mensagemSucesso && (
          <p style={{ color: '#4CAF50', fontWeight: 'bold', marginTop: '10px' }}>{mensagemSucesso}</p>
        )}

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '15px' }}>
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Fornecedor</label>
              <select
                value={filtroFornecedor}
                onChange={(e) => setFiltroFornecedor(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              >
                <option value="todos">Todos</option>
                {fornecedoresDisponiveis.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Status</label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              >
                <option value="todos">Todos</option>
                <option value="aguardando_entrega">Aguardando entrega</option>
                <option value="atrasado">Atrasado</option>
                <option value="recebido">Recebido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Período inicial</label>
              <input
                type="date"
                value={filtroPeriodoInicio}
                onChange={(e) => setFiltroPeriodoInicio(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Período final</label>
              <input
                type="date"
                value={filtroPeriodoFim}
                onChange={(e) => setFiltroPeriodoFim(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        </div>

        {carregando ? (
          <p>Carregando pedidos...</p>
        ) : pedidos.length === 0 ? (
          <p>Nenhum pedido cadastrado ainda.</p>
        ) : pedidosFiltrados.length === 0 ? (
          <p>Nenhum resultado para esta busca/filtro.</p>
        ) : (
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '5px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  {['Fornecedor', 'Data do pedido', 'Previsão de entrega', 'Status', 'Itens', 'Total estimado', 'Ações'].map((coluna) => (
                    <th
                      key={coluna}
                      style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold', whiteSpace: 'nowrap' }}
                    >
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {pedidosFiltrados.map((pedido) => {
                  const itensDoPedido = itensPorPedido[pedido.id] || [];
                  // Mesma regra de DetalhePedidoModal/PedidoForm: só existe
                  // um total quando TODOS os itens têm preço -- somar só
                  // os precificados e chamar isso de "total" seria
                  // enganoso (pareceria completo sem estar).
                  const todosComValor = itensDoPedido.length > 0 && itensDoPedido.every((item) => item.valor_unitario != null);
                  const algumComValor = itensDoPedido.some((item) => item.valor_unitario != null);
                  const total = todosComValor
                    ? itensDoPedido.reduce((soma, item) => soma + item.quantidade_pedida * item.valor_unitario, 0)
                    : null;

                  return (
                    <tr key={pedido.id} style={{ borderBottom: '1px solid #ddd' }}>
                      <td style={{ padding: '12px' }}>
                        {fornecedorNomePorId[pedido.fornecedor_id] || pedido.fornecedor_id}
                        {pedido.observacoes && (
                          <div
                            title={pedido.observacoes}
                            style={{
                              fontSize: '11px',
                              color: '#999',
                              fontStyle: 'italic',
                              marginTop: '2px',
                              maxWidth: '220px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pedido.observacoes}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(pedido.data_pedido)}</td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(pedido.previsao_entrega)}</td>
                      <td style={{ padding: '12px' }}>
                        <BadgeStatusPedido pedido={pedido} hoje={hoje} />
                      </td>
                      <td style={{ padding: '12px' }}>
                        {itensDoPedido.length} {itensDoPedido.length === 1 ? 'item' : 'itens'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {todosComValor ? (
                          formatarMoeda(total)
                        ) : (
                          <span title={algumComValor ? 'Nem todos os itens têm preço informado.' : undefined}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <BotaoIconeAcao
                          rotulo="Ver pedido"
                          icone={IconeOlho}
                          cor={aparencia.corPrimaria}
                          onClick={() => abrirDetalhe(pedido)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p style={{ marginTop: '15px', color: '#666', fontSize: '14px' }}>
              Total de pedidos: <strong>{pedidosFiltrados.length}</strong>
            </p>
          </div>
        )}
      </div>

      {mostrarNovoPedido && (
        <PedidoForm corPrimaria={aparencia.corPrimaria} onSalvo={aoCriarPedido} onCancelar={fecharNovoPedido} />
      )}

      {pedidoParaEditar && (
        <PedidoForm
          pedido={pedidoParaEditar}
          itensIniciais={(itensPorPedido[pedidoParaEditar.id] || []).map((item) => ({
            ...item,
            produtoNome: item.produto_id ? produtoNomePorId[item.produto_id] || item.descricao : item.descricao,
          }))}
          corPrimaria={aparencia.corPrimaria}
          onSalvo={aoSalvarEdicao}
          onCancelar={fecharEdicao}
        />
      )}

      {pedidoDetalhe && (
        <DetalhePedidoModal
          pedido={pedidoDetalhe}
          itens={itensPorPedido[pedidoDetalhe.id] || []}
          fornecedorNome={fornecedorNomePorId[pedidoDetalhe.fornecedor_id] || pedidoDetalhe.fornecedor_id}
          produtoNomePorId={produtoNomePorId}
          corPrimaria={aparencia.corPrimaria}
          hoje={hoje}
          podeEditar={podeEditar}
          podeReceber={podeReceber}
          podeCancelar={podeCancelar}
          podeExcluir={podeExcluir}
          podeReabrirRecebimento={podeReabrirRecebimento}
          onEditar={() => abrirEdicao(pedidoDetalhe)}
          onReceber={() => abrirRecebimento(pedidoDetalhe)}
          onCancelarPedido={() => abrirConfirmarCancelamento(pedidoDetalhe)}
          onExcluir={() => abrirConfirmarExclusao(pedidoDetalhe)}
          onReabrirRecebimento={() => abrirConfirmarReaberturaRecebimento(pedidoDetalhe)}
          onFechar={fecharDetalhe}
        />
      )}

      {pedidoParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir pedido definitivamente"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={excluindoPedido}
          erro={erroExclusaoPedido}
          textoConfirmar="Excluir"
          mensagem={
            <>
              Tem certeza que deseja excluir definitivamente o pedido de{' '}
              <strong>{fornecedorNomePorId[pedidoParaExcluir.fornecedor_id] || pedidoParaExcluir.fornecedor_id}</strong>{' '}
              feito em <strong>{formatarDataExibicao(pedidoParaExcluir.data_pedido)}</strong>?
              <br />
              Esta ação é definitiva e não pode ser desfeita.
            </>
          }
          onConfirmar={confirmarExclusaoPedido}
          onCancelar={fecharConfirmarExclusao}
        />
      )}

      {pedidoParaReceber && (
        <ReceberPedidoModal
          pedido={pedidoParaReceber}
          itens={itensPorPedido[pedidoParaReceber.id] || []}
          fornecedorNome={fornecedorNomePorId[pedidoParaReceber.fornecedor_id] || pedidoParaReceber.fornecedor_id}
          produtoNomePorId={produtoNomePorId}
          corPrimaria={aparencia.corPrimaria}
          onConfirmado={aoConfirmarRecebimento}
          onCancelar={fecharRecebimento}
        />
      )}

      {pedidoParaCancelar && (
        <ConfirmarAcaoModal
          titulo="Cancelar pedido"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={cancelando}
          erro={erroCancelamento}
          textoConfirmar="Cancelar pedido"
          textoCancelar="Voltar"
          mensagem={
            <div>
              <p>
                Esta ação é definitiva e não pode ser desfeita. Confirma o cancelamento do pedido de{' '}
                <strong>{fornecedorNomePorId[pedidoParaCancelar.fornecedor_id] || pedidoParaCancelar.fornecedor_id}</strong>?
              </p>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                Motivo do cancelamento *
              </label>
              <textarea
                value={motivoCancelamento}
                onChange={(e) => setMotivoCancelamento(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                  minHeight: '60px',
                  fontFamily: 'Arial',
                }}
              />
            </div>
          }
          onConfirmar={confirmarCancelamento}
          onCancelar={fecharConfirmarCancelamento}
        />
      )}

      {pedidoParaReabrirRecebimento && (
        <ConfirmarAcaoModal
          titulo="Reabrir recebimento"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={reabrindoRecebimento}
          erro={erroReaberturaRecebimento}
          textoConfirmar="Reabrir recebimento"
          mensagem={
            <p>
              Este pedido voltará para <strong>Aguardando entrega</strong>. Os dados informados no recebimento e os
              históricos de compra gerados por esse recebimento serão removidos. Depois, você poderá editar e receber
              o pedido novamente.
            </p>
          }
          onConfirmar={confirmarReaberturaRecebimento}
          onCancelar={fecharConfirmarReaberturaRecebimento}
        />
      )}
    </div>
  );
}

export default function Pedidos() {
  return (
    <RequireAuth permissao={PERMISSOES.PEDIDOS_VISUALIZAR}>
      <PedidosConteudo />
    </RequireAuth>
  );
}
