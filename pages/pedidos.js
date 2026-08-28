import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../components/MenuOpcoes';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import NovoPedidoForm from '../components/pedidos/NovoPedidoForm';
import DetalhePedidoModal from '../components/pedidos/DetalhePedidoModal';
import ConfirmarAcaoModal from '../components/admin/ConfirmarAcaoModal';
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

  // Confirmação de "Marcar como recebido".
  const [pedidoParaReceber, setPedidoParaReceber] = useState(null);
  const [recebendo, setRecebendo] = useState(false);
  const [erroRecebimento, setErroRecebimento] = useState('');

  // Confirmação de cancelamento (com motivo obrigatório).
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelamento, setErroCancelamento] = useState('');

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  const podeInserir = hasPermissao(permissoes, PERMISSOES.PEDIDOS_INSERIR);
  const podeReceber = hasPermissao(permissoes, PERMISSOES.PEDIDOS_RECEBER);
  const podeCancelar = hasPermissao(permissoes, PERMISSOES.PEDIDOS_CANCELAR);
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
          .select('id, fornecedor_id, data_pedido, previsao_entrega, status, observacoes, motivo_cancelamento, criado_em'),
        supabase
          .from('pedido_itens')
          .select('id, pedido_id, produto_id, descricao, quantidade_pedida, unidade, valor_unitario'),
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

  function fecharDetalhe() {
    setPedidoDetalhe(null);
    // Limpa o ?id= da URL ao fechar manualmente, para não reabrir sozinho
    // numa próxima recarga de `pedidos` (ex.: depois de um Receber/Cancelar
    // feito na linha, com o parâmetro ainda na URL).
    if (router.query.id) {
      router.replace('/pedidos', undefined, { shallow: true });
    }
  }

  function abrirConfirmarRecebimento(pedido) {
    setErroRecebimento('');
    setPedidoParaReceber(pedido);
  }

  function fecharConfirmarRecebimento() {
    setPedidoParaReceber(null);
    setErroRecebimento('');
  }

  // Único caminho de escrita: RPC marcar_pedido_recebido -- nunca UPDATE
  // direto em public.pedidos (ver justificativa completa no cabeçalho da
  // migration 0022: a trigger pedidos_protecao é a fonte única de
  // autorização/timestamp/auditoria dessa transição).
  async function confirmarRecebimento() {
    setRecebendo(true);
    setErroRecebimento('');

    const supabase = createClient();
    const { error } = await supabase.rpc('marcar_pedido_recebido', { p_pedido_id: pedidoParaReceber.id });

    setRecebendo(false);

    if (error) {
      console.error('Erro ao marcar pedido como recebido:', error);
      setErroRecebimento('Não foi possível marcar este pedido como recebido. Tente novamente.');
      return;
    }

    setPedidoParaReceber(null);
    // Fecha também "Ver pedido", se estiver aberto para este mesmo pedido
    // (ação agora vive dentro do modal, ver DetalhePedidoModal.js) --
    // fecharDetalhe() é seguro chamar mesmo se já estiver fechado (no-op).
    fecharDetalhe();
    setMensagemSucesso('Pedido marcado como recebido.');
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
  // NovoPedidoForm.js para criar_pedido).
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
                  {['Fornecedor', 'Data do pedido', 'Previsão de entrega', 'Status', 'Itens', 'Total (derivado)', 'Ações'].map((coluna) => (
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
                  const algumComValor = itensDoPedido.some((item) => item.valor_unitario != null);
                  const total = itensDoPedido.reduce(
                    (soma, item) => soma + item.quantidade_pedida * (item.valor_unitario || 0),
                    0
                  );

                  return (
                    <tr key={pedido.id} style={{ borderBottom: '1px solid #ddd' }}>
                      <td style={{ padding: '12px' }}>{fornecedorNomePorId[pedido.fornecedor_id] || pedido.fornecedor_id}</td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(pedido.data_pedido)}</td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(pedido.previsao_entrega)}</td>
                      <td style={{ padding: '12px' }}>
                        <BadgeStatusPedido pedido={pedido} hoje={hoje} />
                      </td>
                      <td style={{ padding: '12px' }}>
                        {itensDoPedido.length} {itensDoPedido.length === 1 ? 'item' : 'itens'}
                      </td>
                      <td style={{ padding: '12px' }}>{algumComValor ? formatarMoeda(total) : '—'}</td>
                      <td style={{ padding: '12px' }}>
                        <button
                          type="button"
                          onClick={() => abrirDetalhe(pedido)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          Ver pedido
                        </button>
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
        <NovoPedidoForm corPrimaria={aparencia.corPrimaria} onCriado={aoCriarPedido} onCancelar={fecharNovoPedido} />
      )}

      {pedidoDetalhe && (
        <DetalhePedidoModal
          pedido={pedidoDetalhe}
          itens={itensPorPedido[pedidoDetalhe.id] || []}
          fornecedorNome={fornecedorNomePorId[pedidoDetalhe.fornecedor_id] || pedidoDetalhe.fornecedor_id}
          produtoNomePorId={produtoNomePorId}
          corPrimaria={aparencia.corPrimaria}
          hoje={hoje}
          podeReceber={podeReceber}
          podeCancelar={podeCancelar}
          onReceber={() => abrirConfirmarRecebimento(pedidoDetalhe)}
          onCancelarPedido={() => abrirConfirmarCancelamento(pedidoDetalhe)}
          onFechar={fecharDetalhe}
        />
      )}

      {pedidoParaReceber && (
        <ConfirmarAcaoModal
          titulo="Marcar pedido como recebido"
          corPrimaria={aparencia.corPrimaria}
          confirmando={recebendo}
          erro={erroRecebimento}
          textoConfirmar="Marcar como recebido"
          mensagem={
            <p>
              Confirma que o pedido de{' '}
              <strong>{fornecedorNomePorId[pedidoParaReceber.fornecedor_id] || pedidoParaReceber.fornecedor_id}</strong>{' '}
              (previsão {formatarDataExibicao(pedidoParaReceber.previsao_entrega)}) foi recebido?
            </p>
          }
          onConfirmar={confirmarRecebimento}
          onCancelar={fecharConfirmarRecebimento}
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
