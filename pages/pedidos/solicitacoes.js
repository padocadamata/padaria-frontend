import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import CabecalhoPrincipal from '../../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoPedidos from '../../components/pedidos/NavegacaoPedidos';
import SolicitacaoForm from '../../components/pedidos/SolicitacaoForm';
import SolicitacoesLista from '../../components/pedidos/SolicitacoesLista';
import PedidoForm from '../../components/pedidos/PedidoForm';
import ConfirmarAcaoModal from '../../components/admin/ConfirmarAcaoModal';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { APARENCIA_FIXA } from '../../lib/branding/tema';

// Extrai defensivamente o `id` do pedido recém-criado a partir do que
// supabase.rpc() devolve em `data` -- criar_pedido/registrar_compra_
// presencial declaram `returns public.pedidos` (linha única, não SETOF),
// e o comportamento documentado do PostgREST/supabase-js para isso é
// devolver um OBJETO único (não array). Não executei nenhuma das duas
// RPCs neste ambiente para confirmar isso em runtime (proibido nesta
// rodada) -- por isso esta função aceita também a forma em array como
// fallback defensivo, e NUNCA assume `data.id` cegamente: se nenhuma das
// duas formas produzir um id válido, devolve null, e quem chama trata
// isso como falha operacional (nunca tenta concluir a solicitação nem
// recria o pedido nesse caso).
function extrairPedidoIdCriado(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data[0]?.id || null;
  }
  if (typeof data === 'object' && data.id) {
    return data.id;
  }
  return null;
}

// Solicitações internas de compra -- "precisamos comprar isso", tratado
// pelo administrativo (auditoria aprovada da frente Pedidos ->
// Resumo/Pedidos/Solicitações). Depende da migration definitiva
// supabase/migrations/0043_pedidos_solicitacoes.sql -- nesta cópia de
// trabalho as chamadas de RPC/tabela abaixo só funcionarão depois que
// essa migration for aplicada no Supabase real.
function SolicitacoesConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();

  const podeInserir = hasPermissao(permissoes, PERMISSOES.PEDIDOS_SOLICITACOES_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PEDIDOS_SOLICITACOES_EDITAR);
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.PEDIDOS_SOLICITACOES_EXCLUIR);
  const podeRealizar = hasPermissao(permissoes, PERMISSOES.PEDIDOS_SOLICITACOES_REALIZAR);
  // "Criar pedido" a partir de uma solicitação exige as DUAS permissões:
  // pedidos_solicitacoes.realizar (concluir a solicitação) E
  // pedidos.inserir (criar o pedido em si -- famílias independentes, mas
  // esta AÇÃO específica cruza as duas por natureza).
  const podeInserirPedido = hasPermissao(permissoes, PERMISSOES.PEDIDOS_INSERIR);
  const podeReceberPedido = hasPermissao(permissoes, PERMISSOES.PEDIDOS_RECEBER);
  const podeCriarPedido = podeRealizar && podeInserirPedido;
  // Reabrir/Excluir pedido a partir de uma Solicitação realizada usam as
  // MESMAS permissões de PEDIDOS de sempre (nunca pedidos_solicitacoes.*)
  // -- poder ver Solicitações não autoriza reabrir/excluir um Pedido.
  const podeReabrirPedido = hasPermissao(permissoes, PERMISSOES.PEDIDOS_REABRIR_RECEBIMENTO);
  const podeExcluirPedido = hasPermissao(permissoes, PERMISSOES.PEDIDOS_EXCLUIR);

  const aparencia = APARENCIA_FIXA;

  const [solicitacoes, setSolicitacoes] = useState([]);
  const [nomePorId, setNomePorId] = useState({});
  // Status + modalidade ATUAIS de cada pedido vinculado (pedido_id ->
  // { status, modalidade_compra }) -- decide quando mostrar Reabrir/
  // Excluir pedido na lista. Reabrir exige status='recebido' E
  // modalidade_compra<>'compra_presencial' -- reabrir_recebimento_pedido
  // (migration 0037) rejeita explicitamente compra presencial (ela nunca
  // passa por aguardando_entrega; sua correção é via
  // editar_compra_presencial(), tela própria de Pedidos, fora desta
  // frente). Sem a modalidade aqui, o ícone aparecia para Retirada e a
  // RPC sempre falhava -- bug já corrigido nesta rodada. Recarregado
  // junto com as solicitações.
  const [infoPedidoPorId, setInfoPedidoPorId] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  const [mostrarRealizadas, setMostrarRealizadas] = useState(false);

  const [modalForm, setModalForm] = useState(null); // { modo: 'criar'|'editar', solicitacao }
  const [confirmarExclusao, setConfirmarExclusao] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  const [confirmarRealizacao, setConfirmarRealizacao] = useState(null);
  const [observacaoRealizacao, setObservacaoRealizacao] = useState('');
  const [realizando, setRealizando] = useState(false);
  const [erroRealizacao, setErroRealizacao] = useState('');

  // Reabrir recebimento de um pedido vinculado (mesma RPC/regra de
  // pages/pedidos.js, migration 0027) -- nunca mexe na Solicitação, que
  // continua realizada com o pedido_id preservado.
  const [pedidoParaReabrir, setPedidoParaReabrir] = useState(null); // pedido_id
  const [reabrindoPedido, setReabrindoPedido] = useState(false);
  const [erroReaberturaPedido, setErroReaberturaPedido] = useState('');

  // Excluir um pedido vinculado a partir da Solicitação -- MESMA operação
  // segura da aba Pedidos: excluir_pedido_com_solicitacoes (migration
  // 0045), que desvincula (volta a pendente, pedido_id=NULL) toda
  // Solicitação ligada antes de excluir o pedido, atomicamente.
  const [pedidoParaExcluirDaSolicitacao, setPedidoParaExcluirDaSolicitacao] = useState(null); // pedido_id
  const [excluindoPedidoDaSolicitacao, setExcluindoPedidoDaSolicitacao] = useState(false);
  const [erroExclusaoPedidoDaSolicitacao, setErroExclusaoPedidoDaSolicitacao] = useState('');

  // Fluxo "Criar pedido" (seções 19-23 da auditoria aprovada) --
  // `modalCriarPedido` guarda a solicitação sendo convertida (abre
  // PedidoForm pré-preenchido); `pedidoPendenteVinculo` só existe quando
  // o Pedido JÁ FOI CRIADO com sucesso mas a vinculação/conclusão da
  // solicitação falhou -- nesse estado a única ação oferecida é
  // "Tentar vincular novamente" (chama SOMENTE concluir_solicitacao_com_
  // pedido, nunca recria o pedido).
  const [modalCriarPedido, setModalCriarPedido] = useState(null);
  const [pedidoPendenteVinculo, setPedidoPendenteVinculo] = useState(null); // { solicitacaoId, pedidoId }
  const [vinculando, setVinculando] = useState(false);
  const [erroVinculo, setErroVinculo] = useState('');
  // Aviso prévio (decisão fechada): PedidoForm exige produto do Catálogo
  // em todo item -- não alteramos essa validação. Para uma solicitação
  // NÃO cadastrada, mostramos este aviso ANTES de abrir o PedidoForm
  // (que é um overlay fixo -- um banner atrás dele nunca apareceria).
  const [avisoProdutoNaoCadastrado, setAvisoProdutoNaoCadastrado] = useState(null); // solicitacao

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErro('');
      const supabase = createClient();

      const [solicitacoesResp, usuariosResp] = await Promise.all([
        supabase
          .from('pedidos_solicitacoes')
          .select(
            'id, produto_id, descricao, unidade, quantidade, data_solicitacao, observacao, status, pedido_id, realizado_em, realizado_por, observacao_realizacao, criado_por, criado_em'
          ),
        // Resolve nomes de solicitante/quem realizou -- mesmo padrão de
        // join manual via mapa já usado em pages/pedidos.js
        // (fornecedorNomePorId). Se a RLS de public.usuarios não liberar
        // outros usuários para este perfil, o mapa fica vazio e a lista
        // cai no fallback (mostra o UUID) -- degrada sem quebrar.
        supabase.from('usuarios').select('id, nome'),
      ]);

      if (!ativo) return;

      if (solicitacoesResp.error) {
        console.error('Erro ao carregar solicitações:', solicitacoesResp.error);
        setErro('Não foi possível carregar as solicitações.');
        setSolicitacoes([]);
        setCarregando(false);
        return;
      }

      if (usuariosResp.error) {
        console.error('Erro ao carregar usuários (nomes de solicitante):', usuariosResp.error);
      }

      const mapaNomes = {};
      for (const u of usuariosResp.data || []) {
        mapaNomes[u.id] = u.nome;
      }

      const ordenadas = [...(solicitacoesResp.data || [])].sort((a, b) => {
        if (a.data_solicitacao !== b.data_solicitacao) return a.data_solicitacao < b.data_solicitacao ? -1 : 1;
        return a.criado_em < b.criado_em ? -1 : 1;
      });

      // Busca status + modalidade ATUAIS de cada pedido vinculado -- decide
      // quando Reabrir/Excluir pedido aparecem na lista (mesma exigência
      // das próprias RPCs: reabrir só com status='recebido' e
      // modalidade_compra<>'compra_presencial'; excluir só com
      // status='aguardando_entrega'). Segunda query, depende do resultado
      // da primeira -- não dá para rodar em paralelo.
      const idsPedidosVinculados = Array.from(
        new Set((solicitacoesResp.data || []).filter((s) => s.pedido_id).map((s) => s.pedido_id))
      );
      const mapaInfoPedido = {};
      if (idsPedidosVinculados.length > 0) {
        const pedidosResp = await supabase
          .from('pedidos')
          .select('id, status, modalidade_compra')
          .in('id', idsPedidosVinculados);
        if (!ativo) return;
        if (pedidosResp.error) {
          console.error('Erro ao carregar status/modalidade dos pedidos vinculados:', pedidosResp.error);
        } else {
          for (const p of pedidosResp.data || []) {
            mapaInfoPedido[p.id] = { status: p.status, modalidade_compra: p.modalidade_compra };
          }
        }
      }

      setSolicitacoes(ordenadas);
      setNomePorId(mapaNomes);
      setInfoPedidoPorId(mapaInfoPedido);
      setCarregando(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) return undefined;
    const timer = setTimeout(() => setMensagemSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  const solicitacoesVisiveis = solicitacoes.filter((s) => (mostrarRealizadas ? true : s.status === 'pendente'));

  function fecharModalForm() {
    setModalForm(null);
  }

  function aoSalvarForm() {
    fecharModalForm();
    setMensagemSucesso(modalForm?.modo === 'editar' ? 'Solicitação atualizada com sucesso.' : 'Solicitação criada com sucesso.');
    setRecarregarTick((t) => t + 1);
  }

  function abrirConfirmarExclusao(s) {
    setErroExclusao('');
    setConfirmarExclusao(s);
  }

  function fecharConfirmarExclusao() {
    setConfirmarExclusao(null);
    setErroExclusao('');
  }

  async function confirmarExclusaoSolicitacao() {
    setExcluindo(true);
    setErroExclusao('');
    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_solicitacao_pendente', { p_id: confirmarExclusao.id });
    setExcluindo(false);
    if (error) {
      console.error('Erro ao excluir solicitação:', error);
      setErroExclusao('Não foi possível excluir esta solicitação. Tente novamente.');
      return;
    }
    setConfirmarExclusao(null);
    setMensagemSucesso('Solicitação excluída.');
    setRecarregarTick((t) => t + 1);
  }

  function abrirConfirmarRealizacao(s) {
    setObservacaoRealizacao('');
    setErroRealizacao('');
    setConfirmarRealizacao(s);
  }

  function fecharConfirmarRealizacao() {
    setConfirmarRealizacao(null);
    setObservacaoRealizacao('');
    setErroRealizacao('');
  }

  async function confirmarRealizacaoSemPedido() {
    setRealizando(true);
    setErroRealizacao('');
    const supabase = createClient();
    const { error } = await supabase.rpc('marcar_solicitacao_realizada', {
      p_id: confirmarRealizacao.id,
      p_observacao_realizacao: observacaoRealizacao.trim() || null,
    });
    setRealizando(false);
    if (error) {
      console.error('Erro ao marcar solicitação como realizada:', error);
      setErroRealizacao('Não foi possível marcar esta solicitação como realizada. Tente novamente.');
      return;
    }
    setConfirmarRealizacao(null);
    setMensagemSucesso('Solicitação marcada como realizada.');
    setRecarregarTick((t) => t + 1);
  }

  // Solicitação COM produto cadastrado -> abre PedidoForm direto.
  // Solicitação NÃO cadastrada -> mostra o aviso primeiro (decisão
  // fechada, seção 3): PedidoForm vai exigir a escolha de um produto do
  // Catálogo antes de salvar, e isso precisa ficar claro ANTES de abrir
  // o formulário, não como uma surpresa na hora de salvar.
  function abrirCriarPedido(s) {
    setErroVinculo('');
    if (!s.produto_id) {
      setAvisoProdutoNaoCadastrado(s);
    } else {
      setModalCriarPedido(s);
    }
  }

  function confirmarAvisoEContinuar() {
    const s = avisoProdutoNaoCadastrado;
    setAvisoProdutoNaoCadastrado(null);
    setModalCriarPedido(s);
  }

  function fecharCriarPedido() {
    setModalCriarPedido(null);
  }

  // Chamado pelo PedidoForm (onSalvo) só DEPOIS de criar_pedido/
  // registrar_compra_presencial já terem retornado sucesso REAL -- o
  // pedido já existe no banco neste ponto, ocorra o que ocorrer daqui
  // pra frente. NUNCA cria um segundo pedido em nenhuma circunstância
  // desta função.
  async function aoPedidoCriadoDaSolicitacao(pedidoCriado) {
    const solicitacaoId = modalCriarPedido?.id;
    fecharCriarPedido();

    const pedidoId = extrairPedidoIdCriado(pedidoCriado);
    if (!solicitacaoId || !pedidoId) {
      setErro('Pedido criado, mas não foi possível identificar o ID do pedido para concluir a solicitação automaticamente. Confira o pedido criado e trate a solicitação manualmente (ela continua pendente) — nenhum pedido duplicado foi criado.');
      setRecarregarTick((t) => t + 1);
      return;
    }

    await vincularSolicitacaoAoPedido(solicitacaoId, pedidoId);
  }

  async function vincularSolicitacaoAoPedido(solicitacaoId, pedidoId) {
    setVinculando(true);
    setErroVinculo('');
    const supabase = createClient();
    const { error } = await supabase.rpc('concluir_solicitacao_com_pedido', {
      p_id: solicitacaoId,
      p_pedido_id: pedidoId,
    });
    setVinculando(false);

    if (error) {
      console.error('Erro ao concluir solicitação com pedido:', error);
      setPedidoPendenteVinculo({ solicitacaoId, pedidoId });
      setErroVinculo('Pedido criado, mas não foi possível concluir a solicitação.');
      return;
    }

    setPedidoPendenteVinculo(null);
    setErroVinculo('');
    setMensagemSucesso('Pedido criado e solicitação concluída com sucesso.');
    setRecarregarTick((t) => t + 1);
  }

  function tentarVincularNovamente() {
    if (!pedidoPendenteVinculo) return;
    vincularSolicitacaoAoPedido(pedidoPendenteVinculo.solicitacaoId, pedidoPendenteVinculo.pedidoId);
  }

  function fecharAvisoVinculoPendente() {
    // A solicitação continua pendente e o pedido continua existindo
    // normalmente -- fechar aqui só descarta o atalho de retry desta
    // tela, nunca desfaz nada já persistido.
    setPedidoPendenteVinculo(null);
    setErroVinculo('');
  }

  function abrirPedido(pedidoId) {
    router.push(`/pedidos?id=${pedidoId}`);
  }

  function abrirConfirmarReabrirPedido(pedidoId) {
    setErroReaberturaPedido('');
    setPedidoParaReabrir(pedidoId);
  }

  function fecharConfirmarReabrirPedido() {
    setPedidoParaReabrir(null);
    setErroReaberturaPedido('');
  }

  // Mesma RPC/regra de pages/pedidos.js (reabrir_recebimento_pedido,
  // migration 0027) -- não sabe nada sobre pedidos_solicitacoes (a tabela
  // não existia quando ela foi escrita), então nunca mexe na Solicitação
  // vinculada: ela continua realizada, com o mesmo pedido_id.
  async function confirmarReabrirPedido() {
    setReabrindoPedido(true);
    setErroReaberturaPedido('');
    const supabase = createClient();
    const { error } = await supabase.rpc('reabrir_recebimento_pedido', { p_pedido_id: pedidoParaReabrir });
    setReabrindoPedido(false);
    if (error) {
      console.error('Erro ao reabrir recebimento do pedido:', error);
      setErroReaberturaPedido('Não foi possível reabrir o recebimento deste pedido. Tente novamente ou avise um administrador.');
      return;
    }
    setPedidoParaReabrir(null);
    setMensagemSucesso('Recebimento do pedido reaberto — a solicitação vinculada continua realizada.');
    setRecarregarTick((t) => t + 1);
  }

  function abrirConfirmarExcluirPedido(pedidoId) {
    setErroExclusaoPedidoDaSolicitacao('');
    setPedidoParaExcluirDaSolicitacao(pedidoId);
  }

  function fecharConfirmarExcluirPedido() {
    setPedidoParaExcluirDaSolicitacao(null);
    setErroExclusaoPedidoDaSolicitacao('');
  }

  // MESMA operação segura da aba Pedidos: excluir_pedido_com_solicitacoes
  // (migration 0045) -- desvincula atomicamente toda Solicitação ligada a
  // este pedido (volta a pendente, pedido_id=NULL) antes de excluir o
  // pedido em si. Depois de recarregar, a Solicitação reaparece sozinha
  // como pendente (nenhum tratamento extra necessário aqui).
  async function confirmarExcluirPedido() {
    setExcluindoPedidoDaSolicitacao(true);
    setErroExclusaoPedidoDaSolicitacao('');
    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_pedido_com_solicitacoes', { p_pedido_id: pedidoParaExcluirDaSolicitacao });
    setExcluindoPedidoDaSolicitacao(false);
    if (error) {
      console.error('Erro ao excluir pedido vinculado:', error);
      setErroExclusaoPedidoDaSolicitacao('Não foi possível excluir este pedido. Tente novamente ou avise um administrador.');
      return;
    }
    setPedidoParaExcluirDaSolicitacao(null);
    setMensagemSucesso('Pedido excluído. A solicitação vinculada voltou para pendente.');
    setRecarregarTick((t) => t + 1);
  }

  const quantidadeVinculadasAoExcluirPedido = pedidoParaExcluirDaSolicitacao
    ? solicitacoes.filter((s) => s.pedido_id === pedidoParaExcluirDaSolicitacao).length
    : 0;

  const solicitacaoParaItemPedido = modalCriarPedido
    ? [
        {
          produto_id: modalCriarPedido.produto_id,
          produtoNome: modalCriarPedido.produto_id ? modalCriarPedido.descricao : '',
          descricao: modalCriarPedido.descricao,
          unidade: modalCriarPedido.unidade || '',
          quantidade_pedida: modalCriarPedido.quantidade,
          valor_unitario: null,
        },
      ]
    : null;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Pedidos" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />
        <NavegacaoPedidos abaAtiva="solicitacoes" corPrimaria={aparencia.corPrimaria} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
          <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Solicitações internas de compra</h2>
          {podeInserir && (
            <button
              onClick={() => setModalForm({ modo: 'criar' })}
              style={{ padding: '10px 18px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              + Nova solicitação
            </button>
          )}
        </div>

        {mensagemSucesso && <p style={{ color: '#4CAF50', fontWeight: 'bold' }}>{mensagemSucesso}</p>}
        {erro && <p style={{ color: '#f44336' }}>{erro}</p>}

        {erroVinculo && (
          <div style={{ backgroundColor: '#fff3e0', border: '1px solid #FF9800', borderRadius: '5px', padding: '15px', marginBottom: '15px' }}>
            <p style={{ margin: '0 0 8px 0', color: '#e65100', fontWeight: 'bold' }}>{erroVinculo}</p>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#666' }}>
              O pedido já foi criado normalmente — nenhum pedido duplicado será gerado. Você pode tentar concluir a
              solicitação de novo, sem criar outro pedido.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={tentarVincularNovamente}
                disabled={vinculando}
                style={{ padding: '8px 14px', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {vinculando ? 'Tentando...' : 'Tentar vincular novamente'}
              </button>
              <button
                onClick={fecharAvisoVinculoPendente}
                disabled={vinculando}
                style={{ padding: '8px 14px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
              >
                Fechar (a solicitação continua pendente)
              </button>
            </div>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '15px' }}>
          <input type="checkbox" checked={mostrarRealizadas} onChange={(e) => setMostrarRealizadas(e.target.checked)} />
          Mostrar realizadas
        </label>

        {carregando ? (
          <p>Carregando solicitações...</p>
        ) : (
          <SolicitacoesLista
            solicitacoes={solicitacoesVisiveis}
            nomePorId={nomePorId}
            corPrimaria={aparencia.corPrimaria}
            podeEditar={podeEditar}
            podeExcluir={podeExcluir}
            podeRealizar={podeRealizar}
            podeCriarPedido={podeCriarPedido}
            podeReabrirPedido={podeReabrirPedido}
            podeExcluirPedido={podeExcluirPedido}
            infoPedidoPorId={infoPedidoPorId}
            onEditar={(s) => setModalForm({ modo: 'editar', solicitacao: s })}
            onExcluir={abrirConfirmarExclusao}
            onCriarPedido={abrirCriarPedido}
            onMarcarRealizada={abrirConfirmarRealizacao}
            onAbrirPedido={abrirPedido}
            onReabrirPedido={abrirConfirmarReabrirPedido}
            onExcluirPedido={abrirConfirmarExcluirPedido}
          />
        )}
      </div>

      {modalForm && (
        <SolicitacaoForm
          solicitacao={modalForm.modo === 'editar' ? modalForm.solicitacao : null}
          corPrimaria={aparencia.corPrimaria}
          onSalvo={aoSalvarForm}
          onCancelar={fecharModalForm}
        />
      )}

      {confirmarExclusao && (
        <ConfirmarAcaoModal
          titulo="Excluir solicitação"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={excluindo}
          erro={erroExclusao}
          textoConfirmar="Excluir"
          mensagem={
            <>
              Tem certeza que deseja excluir definitivamente a solicitação de <strong>{confirmarExclusao.descricao}</strong>?
              <br />
              Esta ação não pode ser desfeita.
            </>
          }
          onConfirmar={confirmarExclusaoSolicitacao}
          onCancelar={fecharConfirmarExclusao}
        />
      )}

      {confirmarRealizacao && (
        <ConfirmarAcaoModal
          titulo="Marcar como realizada"
          corPrimaria={aparencia.corPrimaria}
          confirmando={realizando}
          erro={erroRealizacao}
          textoConfirmar="Marcar como realizada"
          mensagem={
            <div>
              <p>
                Marcar a solicitação de <strong>{confirmarRealizacao.descricao}</strong> como realizada, SEM criar um
                pedido no sistema (ex.: item já comprado por outro meio)?
              </p>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                Observação (opcional)
              </label>
              <textarea
                value={observacaoRealizacao}
                onChange={(e) => setObservacaoRealizacao(e.target.value)}
                autoFocus
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box', minHeight: '60px', fontFamily: 'Arial' }}
              />
            </div>
          }
          onConfirmar={confirmarRealizacaoSemPedido}
          onCancelar={fecharConfirmarRealizacao}
        />
      )}

      {pedidoParaReabrir && (
        <ConfirmarAcaoModal
          titulo="Reabrir recebimento do pedido"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={reabrindoPedido}
          erro={erroReaberturaPedido}
          textoConfirmar="Reabrir recebimento"
          mensagem={
            <p>
              Este pedido voltará para <strong>Aguardando entrega</strong>. Os dados informados no recebimento e os
              históricos de compra gerados por esse recebimento serão removidos. A solicitação vinculada continuará
              realizada, com o pedido preservado.
            </p>
          }
          onConfirmar={confirmarReabrirPedido}
          onCancelar={fecharConfirmarReabrirPedido}
        />
      )}

      {pedidoParaExcluirDaSolicitacao && (
        <ConfirmarAcaoModal
          titulo="Excluir pedido definitivamente"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={excluindoPedidoDaSolicitacao}
          erro={erroExclusaoPedidoDaSolicitacao}
          textoConfirmar="Excluir"
          mensagem={
            <>
              Tem certeza que deseja excluir definitivamente este pedido?
              <br />
              Esta ação é definitiva e não pode ser desfeita.
              {quantidadeVinculadasAoExcluirPedido > 0 && (
                <>
                  <br />
                  {quantidadeVinculadasAoExcluirPedido === 1
                    ? 'A solicitação vinculada a ele voltará para pendente.'
                    : `As ${quantidadeVinculadasAoExcluirPedido} solicitações vinculadas a ele voltarão para pendente.`}
                </>
              )}
            </>
          }
          onConfirmar={confirmarExcluirPedido}
          onCancelar={fecharConfirmarExcluirPedido}
        />
      )}

      {avisoProdutoNaoCadastrado && (
        <ConfirmarAcaoModal
          titulo="Produto não cadastrado"
          corPrimaria={aparencia.corPrimaria}
          textoConfirmar="Continuar"
          mensagem={
            <p>
              A solicitação <strong>{avisoProdutoNaoCadastrado.descricao}</strong> não tem um produto do Catálogo
              vinculado. Para criar um Pedido, selecione um produto do Catálogo para este item. Se o produto não
              existir, cadastre-o primeiro no Catálogo e depois selecione-o. Se preferir não cadastrar, use
              "Marcar como realizada" sem pedido.
            </p>
          }
          onConfirmar={confirmarAvisoEContinuar}
          onCancelar={() => setAvisoProdutoNaoCadastrado(null)}
        />
      )}

      {modalCriarPedido && (
        <PedidoForm
          itensIniciais={solicitacaoParaItemPedido}
          corPrimaria={aparencia.corPrimaria}
          podeReceber={podeReceberPedido}
          onSalvo={aoPedidoCriadoDaSolicitacao}
          onCancelar={fecharCriarPedido}
        />
      )}
    </div>
  );
}

export default function SolicitacoesPedidos() {
  return (
    <RequireAuth permissao={PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR}>
      <SolicitacoesConteudo />
    </RequireAuth>
  );
}
