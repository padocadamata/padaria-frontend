import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { diaSemanaISO, calcularDataEntrega } from '../../lib/fornecedores/regrasPedido';
import { buscarProdutosPorRelevancia } from '../../lib/pedidos/buscaProduto';

// Formulário ÚNICO de pedido a fornecedor -- absorve o que antes era
// components/pedidos/CompraPresencialForm.js (removido nesta migração de
// frontend). O usuário escolhe explicitamente a MODALIDADE no topo
// (Entrega/Retirada) só na criação; na edição a modalidade vem do
// próprio pedido carregado e nunca muda. As DUAS RPCs de backend
// continuam INTEIRAS e DISTINTAS (criar_pedido/RPC nenhuma para editar
// entrega vs. registrar_compra_presencial/editar_compra_presencial,
// migration 0037/0040) -- este arquivo só decide QUAL delas chamar,
// nunca tenta unificar o contrato de banco. O usuário final não precisa
// saber que são RPCs diferentes por trás.
//
// Valor interno da modalidade -- NUNCA exibido cru na tela, só usado
// como valor de estado/payload:
//   'pedido_com_entrega' -> rótulo visual "Entrega"
//   'compra_presencial'  -> rótulo visual "Retirada"
// (mesmo valor de sempre, só o texto da interface mudou -- ver auditoria
// desta frente: preservar o valor interno existente).

// Mesma convenção de rótulo de dia usada em components/dashboard/ProximosPedidos.js
// e components/fornecedores/FornecedorRegras.js.
const DIA_SEMANA_LABEL = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};

function descreverRegra(regra) {
  const pedido = regra.dia_pedido != null ? DIA_SEMANA_LABEL[regra.dia_pedido] : 'Diário';
  const entrega =
    regra.tipo_entrega === 'prazo_dias'
      ? `entrega D+${regra.dias_prazo}`
      : `entrega ${DIA_SEMANA_LABEL[regra.dia_entrega]}`;
  const horario = regra.horario_limite ? ` · pedido até ${regra.horario_limite.slice(0, 5)}` : '';
  return `Pedido ${pedido} → ${entrega}${horario}`;
}

function normalizarUnidade(texto) {
  return (texto || '').trim().toLowerCase();
}

// `id`: id real de pedido_itens quando o item já existe (edição) -- null
// para item novo, adicionado nesta sessão de edição/criação. É o que
// distingue INSERT de UPDATE (entrega) / item novo x existente no
// payload (retirada). `fatorConversaoBase` só é usado/exibido em
// Retirada -- mantido no estado do item para as duas modalidades,
// simplesmente porque nenhuma tela de Entrega chega a lê-lo.
function estadoInicialItem(itemExistente) {
  // buscaProduto: pré-preenchido com a descrição SÓ quando o item não tem
  // produto_id (ex.: item vindo de uma Solicitação não cadastrada, ou um
  // item de pedido antigo cujo produto foi excluído do Catálogo depois --
  // on delete set null) -- dá um ponto de partida pra busca em vez de um
  // campo vazio. Não afeta a validação existente: produtoId continua
  // exigido antes de salvar (validar()), isto só ajuda a achar mais rápido.
  return {
    id: itemExistente?.id || null,
    produtoId: itemExistente?.produto_id || null,
    produtoNome: itemExistente?.produtoNome || '',
    descricao: itemExistente?.descricao || '',
    unidade: itemExistente?.unidade || '',
    quantidade: itemExistente?.quantidade_pedida != null ? String(itemExistente.quantidade_pedida) : '',
    valorUnitario: itemExistente?.valor_unitario != null ? String(itemExistente.valor_unitario) : '',
    fatorConversaoBase: '',
    buscaProduto: !itemExistente?.produto_id && itemExistente?.descricao ? itemExistente.descricao : '',
  };
}

// `dados.fornecedorDataEditavel`: true quando fornecedor_id/data_pedido
// ainda podem ser alterados nesta tela -- sempre true na criação, e
// também true editando uma Retirada já recebida (decisão herdada de
// CompraPresencialForm: corrigir fornecedor/data é parte do requisito de
// correção da 0037). Falso só editando uma Entrega (mesma decisão de
// segurança já documentada abaixo, no componente).
function validar(dados) {
  if (dados.fornecedorDataEditavel) {
    if (!dados.fornecedorId) {
      return 'Selecione o fornecedor.';
    }
    if (!dados.dataPedido) {
      return dados.ehRetirada ? 'Informe a data da compra.' : 'Informe a data do pedido.';
    }
  }

  if (dados.ehRetirada) {
    if (dados.dataPedido > dados.hoje) {
      return 'A data da compra não pode ser uma data futura.';
    }
    if (dados.dataDocumentoFiscal && dados.dataDocumentoFiscal > dados.hoje) {
      return 'A data do documento fiscal não pode ser uma data futura.';
    }
  } else if (dados.previsaoEntrega && dados.dataPedido && dados.previsaoEntrega < dados.dataPedido) {
    return 'A previsão de entrega não pode ser anterior à data do pedido.';
  }

  if (dados.itens.length === 0) {
    return 'Adicione ao menos um item.';
  }

  for (const item of dados.itens) {
    if (!item.produtoId) {
      return 'Selecione um produto do Catálogo para cada item.';
    }
    if (!item.unidade.trim()) {
      return dados.ehRetirada
        ? 'Informe a unidade de cada item.'
        : 'O produto selecionado não tem unidade-base cadastrada no Catálogo — cadastre a unidade lá antes de usá-lo num pedido.';
    }

    const quantidade = Number(item.quantidade);
    if (item.quantidade === '' || !Number.isFinite(quantidade) || quantidade <= 0) {
      return dados.ehRetirada
        ? 'A quantidade de cada item deve ser maior que zero.'
        : 'A quantidade pedida de cada item deve ser maior que zero.';
    }

    if (dados.ehRetirada) {
      const valor = Number(item.valorUnitario);
      if (item.valorUnitario === '' || !Number.isFinite(valor) || valor < 0) {
        return 'Informe o preço unitário efetivamente pago de cada item (pode ser 0, mas não pode ficar em branco nem ser negativo).';
      }
      if (item.fatorConversaoBase.trim() !== '') {
        const fator = Number(item.fatorConversaoBase);
        if (!Number.isFinite(fator) || fator <= 0) {
          return 'O fator de conversão, quando informado, deve ser maior que zero.';
        }
      }
    } else if (item.valorUnitario !== '') {
      const valor = Number(item.valorUnitario);
      if (!Number.isFinite(valor) || valor < 0) {
        return 'O preço unitário estimado não pode ser negativo.';
      }
    }
  }

  return null;
}

// ============================================================
// ENTREGA -- payloads/mensagens de criar_pedido() e da edição direta
// (UPDATE em pedidos/pedido_itens, sem RPC dedicada). Nada muda aqui em
// relação ao PedidoForm.js anterior.
// ============================================================
function montarPayloadCriacaoEntrega(dados) {
  return {
    p_fornecedor_id: dados.fornecedorId,
    p_data_pedido: dados.dataPedido,
    p_previsao_entrega: dados.previsaoEntrega || null,
    p_observacoes: dados.observacoes.trim() || null,
    p_itens: dados.itens.map((item) => ({
      descricao: item.descricao.trim(),
      unidade: item.unidade.trim(),
      quantidade_pedida: Number(item.quantidade),
      valor_unitario: item.valorUnitario === '' ? null : Number(item.valorUnitario),
      produto_id: item.produtoId,
      observacao: null,
    })),
  };
}

function montarPayloadItemEntrega(item, pedidoId) {
  return {
    pedido_id: pedidoId,
    produto_id: item.produtoId,
    descricao: item.descricao.trim(),
    quantidade_pedida: Number(item.quantidade),
    unidade: item.unidade.trim(),
    valor_unitario: item.valorUnitario === '' ? null : Number(item.valorUnitario),
  };
}

function mensagemErroCriacaoEntrega(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('requer a permissao pedidos.inserir')) {
    return 'Você não tem permissão para criar pedidos.';
  }
  if (msg.includes('fornecedor') && msg.includes('nao encontrado ou inativo')) {
    return 'Fornecedor inválido ou inativo.';
  }
  if (msg.includes('data_pedido e obrigatoria')) {
    return 'Informe a data do pedido.';
  }
  if (msg.includes('previsao_entrega nao pode ser anterior')) {
    return 'A previsão de entrega não pode ser anterior à data do pedido.';
  }
  if (msg.includes('obrigatorio informar ao menos 1 item')) {
    return 'Informe ao menos um item.';
  }
  if (msg.includes('item sem descricao valida')) {
    return 'Todos os itens precisam de uma descrição.';
  }
  if (msg.includes('item sem unidade valida')) {
    return 'Todos os itens precisam de uma unidade.';
  }
  if (msg.includes('quantidade_pedida invalida') || msg.includes('quantidade_pedida deve ser maior que zero')) {
    return 'Quantidade inválida em algum item — deve ser um número maior que zero.';
  }
  if (msg.includes('valor_unitario invalido') || msg.includes('valor_unitario nao pode ser negativo')) {
    return 'Valor unitário inválido em algum item — não pode ser negativo.';
  }
  if (msg.includes('produto_id invalido') || (msg.includes('produto_id') && msg.includes('nao existe'))) {
    return 'O produto selecionado em algum item é inválido ou não existe mais.';
  }
  return 'Não foi possível criar o pedido. Tente novamente ou avise um administrador.';
}

// ============================================================
// RETIRADA -- payloads/mensagens de registrar_compra_presencial() e
// editar_compra_presencial() (migration 0037). Nada muda aqui em
// relação a CompraPresencialForm.js anterior, só os nomes das funções
// (evitar colisão com as de Entrega no mesmo arquivo).
// ============================================================

// Configuração comercial aplicável (produto_fornecedores), quando
// determinável -- mesma regra usada em ReceberPedidoModal.js/
// _resolver_config_comercial_historico() (migration 0037): só resolve
// automaticamente quando existe EXATAMENTE UMA configuração ativa para
// produto+fornecedor com a MESMA unidade comercial informada agora.
function resolverConfigComercial(item, configsPorProduto) {
  const candidatas = (configsPorProduto[item.produtoId] || []).filter(
    (c) => normalizarUnidade(c.unidade_comercial) === normalizarUnidade(item.unidade)
  );
  if (candidatas.length === 1) {
    return { produtoFornecedorId: candidatas[0].id, fatorConfig: candidatas[0].quantidade_embalagem };
  }
  return { produtoFornecedorId: null, fatorConfig: null };
}

function montarPayloadItensRetirada(itens, configsPorProduto) {
  return itens.map((item) => {
    const payloadItem = {
      produto_id: item.produtoId,
      descricao: item.descricao.trim() || item.produtoNome,
      unidade: item.unidade.trim(),
      quantidade_pedida: Number(item.quantidade),
      valor_unitario: Number(item.valorUnitario),
    };

    if (item.id) {
      payloadItem.pedido_item_id = item.id;
    }

    const { produtoFornecedorId } = resolverConfigComercial(item, configsPorProduto);
    if (produtoFornecedorId) {
      payloadItem.produto_fornecedor_id = produtoFornecedorId;
    }

    const fatorTexto = item.fatorConversaoBase.trim();
    if (fatorTexto !== '') {
      payloadItem.fator_conversao_base = Number(fatorTexto);
    }

    return payloadItem;
  });
}

function mensagemErroRetirada(error, estaEditando) {
  if (!error) return '';
  const msg = error.message || '';
  const prefixo = estaEditando ? 'editar_compra_presencial' : 'registrar_compra_presencial';

  if (msg.includes('requer sessao autenticada')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (msg.includes('requer a permissao pedidos.inserir') || msg.includes('requer a permissao pedidos.receber')) {
    return 'Você não tem permissão para registrar retiradas (compras presenciais).';
  }
  if (msg.includes('requer a permissao pedidos.editar')) {
    return 'Você não tem permissão para editar esta retirada.';
  }
  if (msg.includes('fornecedor') && msg.includes('nao encontrado ou inativo')) {
    return 'Fornecedor inválido ou inativo.';
  }
  if (msg.includes('data da compra e obrigatoria')) {
    return 'Informe a data da compra.';
  }
  if (msg.includes('nao pode ser no futuro')) {
    return 'A data da compra não pode ser uma data futura.';
  }
  if (msg.includes('e obrigatorio informar ao menos 1 item')) {
    return 'Informe ao menos um item.';
  }
  if (msg.includes('item sem descricao valida')) {
    return 'Todos os itens precisam de uma descrição.';
  }
  if (msg.includes('item sem unidade valida')) {
    return 'Todos os itens precisam de uma unidade.';
  }
  if (msg.includes('quantidade_pedida')) {
    return 'Quantidade inválida em algum item — deve ser um número maior que zero.';
  }
  if (msg.includes('valor_unitario invalido')) {
    return 'Preço unitário inválido em algum item.';
  }
  if (msg.includes('produto_id') && (msg.includes('invalido') || msg.includes('nao existe'))) {
    return 'O produto selecionado em algum item é inválido ou não existe mais.';
  }
  if (msg.includes('fator_conversao_base') && msg.includes('nao bate com a configuracao')) {
    return 'O fator de conversão informado não corresponde à configuração comercial cadastrada para este produto/fornecedor.';
  }
  if (msg.includes('fator_conversao_base')) {
    return 'Fator de conversão inválido em algum item — deve ser maior que zero, quando informado.';
  }
  if (msg.includes('unidade informada') && msg.includes('nao bate com a configuracao')) {
    return 'A unidade informada não corresponde à configuração comercial cadastrada para este produto/fornecedor.';
  }
  if (msg.includes('produto_fornecedor_id') && msg.includes('nao corresponde')) {
    return 'Configuração comercial inválida para algum item. Recarregue a página e tente novamente.';
  }
  if (msg.includes('nao e uma compra presencial')) {
    return 'Este pedido não é uma retirada (compra presencial).';
  }
  if (msg.includes('esperado recebido')) {
    return 'Esta retirada não está mais com status Recebido. Recarregue a página.';
  }
  if (msg.includes('nao pertence a esta compra') || msg.includes('duplicado no payload')) {
    return 'Erro interno ao montar os itens da retirada. Recarregue a página.';
  }
  console.error(`Erro em ${prefixo}:`, error);
  return 'Não foi possível salvar esta retirada. Tente novamente ou avise um administrador.';
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const overlayEstilo = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '20px',
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '820px',
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' };

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

// Seleção OBRIGATÓRIA de um produto do Catálogo (public.produtos, só
// ativos) -- não existe "item livre" digitado à mão, nas duas
// modalidades. Ao selecionar, descricao/unidade são preenchidos a
// partir do cadastro ATUAL do produto -- vira o snapshot gravado em
// pedido_itens.descricao/unidade. Em Entrega, a unidade fica só-leitura
// (mostrada aqui mesmo, "Unidade: ..."); em Retirada, a unidade
// aparece num campo PRÓPRIO editável no corpo do item (compra pode ser
// numa apresentação comercial diferente da unidade-base), então esta
// linha "Unidade: ..." fica oculta para não duplicar a informação --
// `ocultarUnidadeInline` controla isso. Para item já existente (edição),
// o valor exibido é o SNAPSHOT já gravado no banco -- nunca recalculado
// a partir do cadastro atual do produto a menos que o usuário
// explicitamente clique "Trocar".
function SeletorProduto({ item, produtos, corPrimaria, onAlterarItem, ocultarUnidadeInline, registrarInputRef }) {
  const [aberto, setAberto] = useState(false);

  if (item.produtoId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#333', fontWeight: 'bold' }}>{item.produtoNome}</span>
          <button
            type="button"
            onClick={() => onAlterarItem({ produtoId: null, produtoNome: '', descricao: '', unidade: '', buscaProduto: '' })}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#2196F3',
              cursor: 'pointer',
              fontSize: '12px',
              textDecoration: 'underline',
            }}
          >
            Trocar
          </button>
        </div>
        {!ocultarUnidadeInline && (
          <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
            Unidade: {item.unidade || '—'}
          </div>
        )}
      </div>
    );
  }

  const termoBusca = item.buscaProduto.trim();
  const resultados = buscarProdutosPorRelevancia(produtos, item.buscaProduto);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={registrarInputRef}
        type="text"
        value={item.buscaProduto}
        onChange={(e) => {
          onAlterarItem({ buscaProduto: e.target.value });
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder="Buscar produto do Catálogo..."
        style={{ ...campoEstilo, fontSize: '13px' }}
      />
      {aberto && termoBusca && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'white',
            border: `1px solid ${corPrimaria}`,
            borderRadius: '5px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
            zIndex: 10,
            maxHeight: '160px',
            overflowY: 'auto',
          }}
        >
          {resultados.length === 0 ? (
            <div style={{ padding: '8px 10px', fontSize: '13px', color: '#999' }}>Nenhum produto encontrado.</div>
          ) : (
            resultados.map((produto) => (
              <div
                key={produto.id}
                onMouseDown={() =>
                  onAlterarItem({
                    produtoId: produto.id,
                    produtoNome: produto.nome,
                    descricao: produto.nome,
                    unidade: produto.unidade_medida || '',
                    buscaProduto: '',
                  })
                }
                style={{ padding: '8px 10px', fontSize: '13px', cursor: 'pointer' }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {produto.nome}
              </div>
            ))
          )}
        </div>
      )}
      <p style={{ fontSize: '11px', color: '#999', marginTop: '4px', marginBottom: 0 }}>
        Produto não encontrado? Cadastre-o primeiro no{' '}
        <a href="/catalogo/novo" target="_blank" rel="noopener noreferrer" style={{ color: corPrimaria }}>
          Catálogo de Produtos
        </a>
        .
      </p>
    </div>
  );
}

// Formulário único de criação E edição de pedido a fornecedor -- nas
// DUAS modalidades (Entrega/Retirada). `pedido` null = criação (usuário
// escolhe a modalidade no topo); `pedido` preenchido = edição (a
// modalidade vem de `pedido.modalidade_compra`, nunca muda depois).
//
// EDIÇÃO -- por que fornecedor/data ficam somente-leitura em Entrega mas
// EDITÁVEIS em Retirada (`fornecedorDataEditavel` abaixo):
//   * Entrega: a trigger pedidos_protecao permite alterar fornecedor_id/
//     data_pedido via UPDATE comum (só bloqueia recebido_em/
//     cancelado_em/motivo_cancelamento fora de uma transição formal) --
//     mas criar_pedido() valida fornecedor ativo no MOMENTO DA CRIAÇÃO, e
//     nenhum gatilho revalida isso num UPDATE comum. Permitir trocar o
//     fornecedor por edição contornaria essa validação silenciosamente --
//     decisão de segurança de negócio, não uma limitação técnica.
//   * Retirada: editar_compra_presencial() (migration 0037) É a própria
//     validação -- ela reconfirma fornecedor ativo a cada chamada, então
//     não existe o mesmo risco de contorno silencioso. Corrigir
//     fornecedor/data faz parte do requisito funcional da 0037.
export default function PedidoForm({ pedido, itensIniciais, corPrimaria = '#8B4513', podeReceber = true, onSalvo, onCancelar }) {
  const estaEditando = pedido != null;
  const hoje = dataLocalHoje();

  // Modalidade -- escolhida pelo usuário só na criação (radio no topo);
  // na edição vem fixa do próprio pedido carregado e nunca muda de
  // estado depois (nenhum controle de UI altera `modalidade` quando
  // estaEditando=true). Default de um pedido NOVO é Entrega -- não
  // depende de nenhuma característica do fornecedor (auditoria desta
  // frente: "não alterar automaticamente essa escolha com base na
  // modalidade principal cadastrada no fornecedor").
  const [modalidade, setModalidade] = useState(() =>
    estaEditando ? pedido.modalidade_compra : 'pedido_com_entrega'
  );
  const ehRetirada = modalidade === 'compra_presencial';
  const fornecedorDataEditavel = !estaEditando || ehRetirada;

  const [carregandoDados, setCarregandoDados] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [fornecedores, setFornecedores] = useState([]);
  const [regras, setRegras] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [configsPorProduto, setConfigsPorProduto] = useState({});

  const [fornecedorId, setFornecedorId] = useState(() => (estaEditando ? pedido.fornecedor_id : ''));
  const [dataPedido, setDataPedido] = useState(() => (estaEditando ? pedido.data_pedido : hoje));
  const [previsaoEntrega, setPrevisaoEntrega] = useState(() => (estaEditando ? pedido.previsao_entrega || '' : ''));
  const [numeroNotaFiscal, setNumeroNotaFiscal] = useState(() => (estaEditando ? pedido.numero_nota_fiscal || '' : ''));
  const [dataDocumentoFiscal, setDataDocumentoFiscal] = useState(() =>
    estaEditando ? pedido.data_documento_fiscal || '' : ''
  );
  const [observacoes, setObservacoes] = useState(() => (estaEditando ? pedido.observacoes || '' : ''));
  // itensIniciais agora também prefila a CRIAÇÃO (auditoria da frente de
  // Solicitações — fluxo "Criar pedido" a partir de uma solicitação
  // pendente): antes, só era usado quando estaEditando=true, então uma
  // criação nova sempre começava com uma linha vazia mesmo recebendo essa
  // prop. Criação SEM itensIniciais continua exatamente como sempre foi
  // (fallback [estadoInicialItem()]); edição continua exatamente como
  // sempre foi (só usa itensIniciais quando estaEditando).
  const [itens, setItens] = useState(() =>
    itensIniciais?.length ? itensIniciais.map(estadoInicialItem) : [estadoInicialItem()]
  );
  const [regraEscolhidaId, setRegraEscolhidaId] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const proximaChaveItem = useRef(itens.length);
  const chavesItens = useRef(itens.map((_, i) => i));
  // Ids reais de pedido_itens removidos nesta sessão de edição -- só
  // usado no caminho de edição de Entrega (DELETE final ao salvar, sem
  // RPC); a edição de Retirada (editar_compra_presencial) reconstrói a
  // diferença sozinha a partir do payload completo, não precisa disto.
  const idsRemovidosRef = useRef([]);

  // Foco automático no campo de busca do item recém-adicionado (ver
  // adicionarItem abaixo) -- só dispara quando `chaveRecemAdicionada`
  // muda de valor (ou seja, só depois de um clique real em "+ Item"),
  // nunca em re-renders comuns causados por digitação em outro campo.
  const inputsBuscaRef = useRef(new Map());
  const [chaveRecemAdicionada, setChaveRecemAdicionada] = useState(null);

  useEffect(() => {
    if (chaveRecemAdicionada == null) return;
    const input = inputsBuscaRef.current.get(chaveRecemAdicionada);
    if (input) {
      input.focus();
    }
    setChaveRecemAdicionada(null);
  }, [chaveRecemAdicionada]);

  // Fornecedores/regras/produtos. `ehRetirada`/`estaEditando` aqui são
  // avaliados só UMA VEZ, no mount (deps []) -- seguro porque, editando,
  // a modalidade nunca muda de valor depois do estado inicial (nenhum
  // controle altera `modalidade` quando estaEditando=true); criando,
  // `!estaEditando` já é suficiente por si só (verdadeiro
  // independentemente de qual modalidade o rádio começa marcado).
  //
  // Fornecedores: SEM filtro de modalidade_compra (auditoria desta
  // frente + migration 0040) -- qualquer fornecedor ATIVO serve para
  // Entrega ou Retirada. Buscados quando: criando (as duas modalidades
  // precisam) OU editando uma Retirada (fornecedor é editável nesse
  // caso). Nunca buscados editando uma Entrega (fornecedor é
  // somente-leitura, mesma decisão de sempre).
  useEffect(() => {
    let efeitoAtivo = true;
    const precisaFornecedores = !estaEditando || ehRetirada;
    const precisaRegras = !estaEditando;

    async function carregar() {
      setCarregandoDados(true);
      setErroCarregamento('');

      const supabase = createClient();

      const promessas = [
        supabase.from('produtos').select('id, nome, unidade_medida').eq('ativo', true).order('nome', { ascending: true }),
      ];

      if (precisaFornecedores) {
        promessas.push(
          supabase
            .from('fornecedores')
            .select('id, nome, nome_fantasia, razao_social')
            .eq('ativo', true)
            .order('nome_fantasia', { ascending: true })
        );
      } else {
        promessas.push(Promise.resolve({ data: [], error: null }));
      }

      if (precisaRegras) {
        promessas.push(
          supabase
            .from('fornecedor_regras_pedido')
            .select('id, fornecedor_id, dia_pedido, horario_limite, tipo_entrega, dias_prazo, dia_entrega')
            .eq('ativo', true)
        );
      } else {
        promessas.push(Promise.resolve({ data: [], error: null }));
      }

      const [produtosResp, fornecedoresResp, regrasResp] = await Promise.all(promessas);

      if (!efeitoAtivo) return;

      const primeiroErro = produtosResp.error || fornecedoresResp?.error || regrasResp?.error;
      if (primeiroErro) {
        console.error('Erro ao carregar dados do pedido:', primeiroErro);
        setErroCarregamento('Não foi possível carregar fornecedores/produtos. Tente novamente.');
        setCarregandoDados(false);
        return;
      }

      setProdutos(produtosResp.data || []);
      setFornecedores(fornecedoresResp?.data || []);
      setRegras(regrasResp?.data || []);
      setCarregandoDados(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Configurações comerciais (produto_fornecedores) -- só relevante para
  // Retirada (resolução de fator_conversao_base ao montar o payload de
  // registrar_compra_presencial/editar_compra_presencial). Em Entrega
  // fica sempre vazio, sem custo de rede.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarConfigs() {
      if (!ehRetirada) {
        if (efeitoAtivo) setConfigsPorProduto({});
        return;
      }

      const produtoIds = Array.from(new Set(itens.map((i) => i.produtoId).filter(Boolean)));

      if (!fornecedorId || produtoIds.length === 0) {
        if (efeitoAtivo) setConfigsPorProduto({});
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase
        .from('produto_fornecedores')
        .select('id, produto_id, unidade_comercial, quantidade_embalagem')
        .eq('fornecedor_id', fornecedorId)
        .eq('ativo', true)
        .in('produto_id', produtoIds);

      if (!efeitoAtivo) return;

      if (error) {
        console.error('Erro ao carregar configurações comerciais:', error);
        return;
      }

      const mapa = {};
      for (const c of data || []) {
        if (!mapa[c.produto_id]) mapa[c.produto_id] = [];
        mapa[c.produto_id].push(c);
      }
      setConfigsPorProduto(mapa);
    }

    carregarConfigs();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehRetirada, fornecedorId, itens.map((i) => i.produtoId).join(',')]);

  // Regras aplicáveis + sugestão automática de previsão -- só faz
  // sentido criando uma Entrega (fornecedor/data mutáveis e a UI de
  // regras só existe para essa combinação); em qualquer outro caso fica
  // vazio, sem alterar nada.
  const regrasAplicaveis =
    !estaEditando && !ehRetirada && fornecedorId && dataPedido
      ? regras.filter(
          (r) =>
            r.fornecedor_id === fornecedorId &&
            (r.dia_pedido === null || r.dia_pedido === diaSemanaISO(dataPedido))
        )
      : [];

  useEffect(() => {
    if (estaEditando || ehRetirada) return;
    setRegraEscolhidaId('');
    setPrevisaoEntrega('');
    if (regrasAplicaveis.length === 1) {
      setPrevisaoEntrega(calcularDataEntrega(dataPedido, regrasAplicaveis[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornecedorId, dataPedido, ehRetirada]);

  function escolherRegra(regraId) {
    setRegraEscolhidaId(regraId);
    const regra = regrasAplicaveis.find((r) => r.id === regraId);
    if (regra) {
      setPrevisaoEntrega(calcularDataEntrega(dataPedido, regra));
    }
  }

  function atualizarItem(chave, alteracoes) {
    setItens((atual) =>
      atual.map((item, indice) => (chavesItens.current[indice] === chave ? { ...item, ...alteracoes } : item))
    );
  }

  // Novo item entra no TOPO da lista (auditoria desta frente: pedidos
  // grandes ficavam ruins de usar com o item novo sempre no final).
  // `chavesItens.current` e `itens` são prependados JUNTOS, na mesma
  // operação, então continuam perfeitamente alinhados por índice --
  // nenhum campo de ordem é persistido em pedido_itens (não existe
  // coluna de sequência), então isso não altera nem a ordem salva nem a
  // de nenhum pedido já existente, só a UX desta sessão de edição.
  function adicionarItem() {
    const novaChave = proximaChaveItem.current++;
    chavesItens.current.unshift(novaChave);
    setItens((atual) => [estadoInicialItem(), ...atual]);
    setChaveRecemAdicionada(novaChave);
  }

  function removerItem(chave) {
    const indice = chavesItens.current.indexOf(chave);
    if (indice === -1) return;
    const itemRemovido = itens[indice];
    if (itemRemovido?.id) {
      idsRemovidosRef.current.push(itemRemovido.id);
    }
    chavesItens.current.splice(indice, 1);
    setItens((atual) => atual.filter((_, i) => i !== indice));
  }

  // Um pedido/retirada pode legitimamente ter itens sem preço (só em
  // Entrega -- Retirada exige preço em todos) -- somar só os que têm e
  // chamar isso de "total" seria enganoso. Só existe total quando TODOS
  // os itens têm preço informado.
  function itemTemPrecoValido(item) {
    return item.valorUnitario !== '' && Number.isFinite(Number(item.valorUnitario));
  }
  const todosItensComPreco = itens.length > 0 && itens.every(itemTemPrecoValido);
  const algumItemComPreco = itens.some(itemTemPrecoValido);
  const totalDerivado = todosItensComPreco
    ? itens.reduce((soma, item) => {
        const quantidade = Number(item.quantidade);
        return soma + (Number.isFinite(quantidade) ? quantidade : 0) * Number(item.valorUnitario);
      }, 0)
    : null;

  // ============================================================
  // ENTREGA -- edição existente, SEM RPC dedicada (idêntico ao
  // PedidoForm.js anterior). Ordem deliberada: cabeçalho, itens NOVOS
  // (insert), itens EXISTENTES (update), itens REMOVIDOS (delete, em UM
  // único comando batelado por último) -- garante que a invariante
  // "pedido nunca fica sem item" (trigger pedido_itens_impedir_pedido_vazio)
  // só é avaliada contra o estado FINAL pretendido. LIMITAÇÃO CONHECIDA:
  // sem RPC, estes passos não são atômicos entre si -- uma falha no meio
  // deixa o que já foi salvo salvo. Mitigado com mensagens de erro
  // específicas por etapa.
  async function salvarEdicaoEntrega() {
    const supabase = createClient();

    const { error: erroCabecalho } = await supabase
      .from('pedidos')
      .update({
        previsao_entrega: previsaoEntrega || null,
        observacoes: observacoes.trim() || null,
      })
      .eq('id', pedido.id);

    if (erroCabecalho) {
      console.error('Erro ao salvar cabeçalho do pedido:', erroCabecalho);
      setErro('Não foi possível salvar as alterações do pedido. Tente novamente.');
      return false;
    }

    const itensNovos = itens.filter((item) => !item.id);
    const itensExistentes = itens.filter((item) => item.id);

    if (itensNovos.length > 0) {
      const { error: erroInsert } = await supabase
        .from('pedido_itens')
        .insert(itensNovos.map((item) => montarPayloadItemEntrega(item, pedido.id)));

      if (erroInsert) {
        console.error('Erro ao adicionar itens do pedido:', erroInsert);
        setErro('Cabeçalho salvo, mas não foi possível adicionar os novos itens. Recarregue e confira o pedido antes de tentar de novo.');
        return false;
      }
    }

    for (const item of itensExistentes) {
      const { error: erroUpdate } = await supabase
        .from('pedido_itens')
        .update(montarPayloadItemEntrega(item, pedido.id))
        .eq('id', item.id)
        .eq('pedido_id', pedido.id);

      if (erroUpdate) {
        console.error('Erro ao atualizar item do pedido:', erroUpdate);
        setErro('Algumas alterações já foram salvas, mas um dos itens existentes não pôde ser atualizado. Recarregue e confira o pedido antes de tentar de novo.');
        return false;
      }
    }

    if (idsRemovidosRef.current.length > 0) {
      const { error: erroDelete } = await supabase
        .from('pedido_itens')
        .delete()
        .in('id', idsRemovidosRef.current)
        .eq('pedido_id', pedido.id);

      if (erroDelete) {
        console.error('Erro ao remover itens do pedido:', erroDelete);
        setErro('Algumas alterações já foram salvas, mas os itens removidos não puderam ser excluídos. Recarregue e confira o pedido antes de tentar de novo.');
        return false;
      }
    }

    return true;
  }

  async function salvar() {
    const dados = {
      fornecedorDataEditavel,
      ehRetirada,
      fornecedorId,
      dataPedido,
      previsaoEntrega,
      dataDocumentoFiscal,
      observacoes,
      itens,
      hoje,
    };
    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();

    // Edição de Entrega -- único caminho sem RPC, mantido intocado.
    if (estaEditando && !ehRetirada) {
      const sucesso = await salvarEdicaoEntrega();
      setSalvando(false);
      if (sucesso) onSalvo();
      return;
    }

    // Edição de Retirada -- RPC dedicada (migration 0037), nunca
    // reabrir_recebimento_pedido().
    if (estaEditando && ehRetirada) {
      const { error } = await supabase.rpc('editar_compra_presencial', {
        p_pedido_id: pedido.id,
        p_fornecedor_id: fornecedorId,
        p_data_compra: dataPedido,
        p_numero_nota_fiscal: numeroNotaFiscal.trim() || null,
        p_data_documento_fiscal: dataDocumentoFiscal || null,
        p_observacoes: observacoes.trim() || null,
        p_itens: montarPayloadItensRetirada(itens, configsPorProduto),
      });

      setSalvando(false);

      if (error) {
        setErro(mensagemErroRetirada(error, true));
        return;
      }

      onSalvo();
      return;
    }

    // Criação -- Entrega usa criar_pedido(); Retirada usa
    // registrar_compra_presencial(). O usuário não precisa saber que são
    // RPCs diferentes -- só escolheu "Entrega"/"Retirada" no topo.
    if (ehRetirada) {
      const { data, error } = await supabase.rpc('registrar_compra_presencial', {
        p_fornecedor_id: fornecedorId,
        p_data_compra: dataPedido,
        p_numero_nota_fiscal: numeroNotaFiscal.trim() || null,
        p_data_documento_fiscal: dataDocumentoFiscal || null,
        p_observacoes: observacoes.trim() || null,
        p_itens: montarPayloadItensRetirada(itens, configsPorProduto),
      });

      setSalvando(false);

      if (error) {
        setErro(mensagemErroRetirada(error, false));
        return;
      }

      // `data` é a linha de public.pedidos recém-criada (registrar_compra_
      // presencial retorna public.pedidos) -- repassada para quem criou
      // este formulário poder, por exemplo, vincular um pedido a uma
      // solicitação de origem (concluir_solicitacao_com_pedido). onSalvo
      // sem argumento continua funcionando normalmente (pages/pedidos.js
      // ignora o argumento extra).
      onSalvo(data);
      return;
    }

    const { data, error } = await supabase.rpc('criar_pedido', montarPayloadCriacaoEntrega(dados));

    setSalvando(false);

    if (error) {
      console.error('Erro ao criar pedido:', error);
      setErro(mensagemErroCriacaoEntrega(error));
      return;
    }

    // Mesmo raciocínio do bloco de Retirada acima -- criar_pedido também
    // retorna public.pedidos.
    onSalvo(data);
  }

  const tituloModal = estaEditando
    ? ehRetirada
      ? 'Editar retirada'
      : 'Editar pedido'
    : 'Novo pedido';

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>{tituloModal}</h3>

        {carregandoDados ? (
          <p>Carregando fornecedores e produtos...</p>
        ) : erroCarregamento ? (
          <p style={{ color: '#f44336' }}>{erroCarregamento}</p>
        ) : (
          <>
            {/* Retirada exige pedidos.inserir + pedidos.receber
                (registrar_compra_presencial(), migration 0037) -- quem
                só tem pedidos.inserir nem vê a opção, e Entrega continua
                funcionando normalmente com o rádio único restante. */}
            {!estaEditando && (
              <div style={{ marginBottom: '15px' }}>
                {podeReceber ? (
                  <>
                    <label style={rotuloEstilo}>Modalidade *</label>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                        <input
                          type="radio"
                          name="modalidade"
                          checked={!ehRetirada}
                          onChange={() => setModalidade('pedido_com_entrega')}
                        />
                        Entrega
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                        <input
                          type="radio"
                          name="modalidade"
                          checked={ehRetirada}
                          onChange={() => setModalidade('compra_presencial')}
                        />
                        Retirada
                      </label>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>Modalidade: <strong>Entrega</strong></p>
                )}
              </div>
            )}

            {estaEditando && (
              <p style={{ fontSize: '13px', color: '#666', marginTop: '-4px', marginBottom: '15px' }}>
                Modalidade: <strong>{ehRetirada ? 'Retirada' : 'Entrega'}</strong>
              </p>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '15px',
                marginBottom: '15px',
              }}
            >
              <div>
                <label style={rotuloEstilo}>Fornecedor {fornecedorDataEditavel && '*'}</label>
                {fornecedorDataEditavel ? (
                  <>
                    <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} style={campoEstilo}>
                      <option value="">Selecione</option>
                      {fornecedores.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome_fantasia || f.razao_social || f.nome}
                        </option>
                      ))}
                    </select>
                    {fornecedores.length === 0 && (
                      <p style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>Nenhum fornecedor ativo cadastrado.</p>
                    )}
                    <p style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                      Todos os fornecedores ativos aparecem aqui, independente da modalidade cadastrada.
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, padding: '8px 0' }}>{pedido.fornecedorNome}</p>
                )}
              </div>

              <div>
                <label style={rotuloEstilo}>{ehRetirada ? 'Data da compra' : 'Data do pedido'} {fornecedorDataEditavel && '*'}</label>
                {fornecedorDataEditavel ? (
                  <input
                    type="date"
                    max={ehRetirada ? hoje : undefined}
                    value={dataPedido}
                    onChange={(e) => setDataPedido(e.target.value)}
                    style={campoEstilo}
                  />
                ) : (
                  <p style={{ margin: 0, padding: '8px 0' }}>{dataPedido}</p>
                )}
              </div>

              {!ehRetirada && (
                <div>
                  <label style={rotuloEstilo}>Previsão de entrega</label>
                  <input
                    type="date"
                    min={dataPedido}
                    value={previsaoEntrega}
                    onChange={(e) => setPrevisaoEntrega(e.target.value)}
                    style={campoEstilo}
                  />
                </div>
              )}

              {ehRetirada && (
                <>
                  <div>
                    <label style={rotuloEstilo}>Número da nota fiscal</label>
                    <input
                      type="text"
                      value={numeroNotaFiscal}
                      onChange={(e) => setNumeroNotaFiscal(e.target.value)}
                      placeholder="Opcional"
                      style={campoEstilo}
                    />
                  </div>
                  <div>
                    <label style={rotuloEstilo}>Data do documento fiscal</label>
                    <input
                      type="date"
                      max={hoje}
                      value={dataDocumentoFiscal}
                      onChange={(e) => setDataDocumentoFiscal(e.target.value)}
                      style={campoEstilo}
                    />
                  </div>
                </>
              )}
            </div>

            {estaEditando && !ehRetirada && (
              <p style={{ fontSize: '12px', color: '#999', marginTop: '-8px', marginBottom: '15px' }}>
                Fornecedor e data do pedido não podem ser alterados após a criação.
              </p>
            )}

            {!estaEditando && !ehRetirada && fornecedorId && regrasAplicaveis.length === 0 && (
              <p style={{ fontSize: '13px', color: '#999', marginBottom: '15px' }}>
                Nenhuma regra de pedido cadastrada para este fornecedor neste dia da semana — informe a previsão
                manualmente.
              </p>
            )}

            {!estaEditando && !ehRetirada && fornecedorId && regrasAplicaveis.length === 1 && (
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
                Previsão sugerida por regra cadastrada: {descreverRegra(regrasAplicaveis[0])}. Você pode ajustar a
                data acima manualmente.
              </p>
            )}

            {!estaEditando && !ehRetirada && fornecedorId && regrasAplicaveis.length > 1 && (
              <div style={{ marginBottom: '15px', backgroundColor: '#fff8e1', padding: '10px 12px', borderRadius: '5px' }}>
                <p style={{ fontSize: '13px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#8a6d00' }}>
                  Mais de uma regra se aplica a este dia — escolha qual usar para sugerir a previsão:
                </p>
                {regrasAplicaveis.map((regra) => (
                  <label key={regra.id} style={{ display: 'block', fontSize: '13px', marginBottom: '4px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="regraEscolhida"
                      checked={regraEscolhidaId === regra.id}
                      onChange={() => escolherRegra(regra.id)}
                      style={{ marginRight: '6px' }}
                    />
                    {descreverRegra(regra)}
                  </label>
                ))}
              </div>
            )}

            <div style={{ marginBottom: '15px' }}>
              <label style={rotuloEstilo}>Observações</label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                style={{ ...campoEstilo, minHeight: '50px', fontFamily: 'Arial' }}
              />
            </div>

            <div style={{ borderTop: '1px solid #eee', paddingTop: '15px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <h4 style={{ margin: 0 }}>{ehRetirada ? 'Itens da compra' : 'Itens do pedido'}</h4>
                <button
                  type="button"
                  onClick={adicionarItem}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: corPrimaria,
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                  }}
                >
                  + Item
                </button>
              </div>
              <p style={{ fontSize: '12px', color: '#999', marginTop: 0, marginBottom: '12px' }}>
                {ehRetirada
                  ? 'Quantidade, unidade e preço são os EFETIVAMENTE praticados nesta compra — não há etapa de recebimento separada.'
                  : 'Quantidade pedida e preço estimado desta fase — a quantidade e o preço efetivamente recebidos serão registrados futuramente, na etapa de Recebimento.'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {itens.map((item, indice) => {
                  const chave = chavesItens.current[indice];
                  const quantidadeNum = Number(item.quantidade);
                  const valorNum = Number(item.valorUnitario);
                  const totalItem =
                    ehRetirada && item.quantidade !== '' && item.valorUnitario !== '' && Number.isFinite(quantidadeNum) && Number.isFinite(valorNum)
                      ? quantidadeNum * valorNum
                      : null;
                  const configResolvida =
                    ehRetirada && item.produtoId
                      ? resolverConfigComercial(item, configsPorProduto)
                      : { produtoFornecedorId: null, fatorConfig: null };
                  const fatorForcado = configResolvida.fatorConfig != null;

                  return (
                    <div key={chave} style={{ backgroundColor: '#f9f9f9', padding: '12px', borderRadius: '5px' }}>
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Produto do Catálogo *</label>
                        <SeletorProduto
                          item={item}
                          produtos={produtos}
                          corPrimaria={corPrimaria}
                          ocultarUnidadeInline={ehRetirada}
                          registrarInputRef={(el) => {
                            if (el) inputsBuscaRef.current.set(chave, el);
                            else inputsBuscaRef.current.delete(chave);
                          }}
                          onAlterarItem={(alt) => atualizarItem(chave, alt)}
                        />
                      </div>

                      {ehRetirada ? (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: '10px',
                            marginBottom: '8px',
                          }}
                        >
                          <div>
                            <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Unidade *</label>
                            <input
                              type="text"
                              value={item.unidade}
                              onChange={(e) => atualizarItem(chave, { unidade: e.target.value })}
                              placeholder="UN, KG, CX..."
                              style={{ ...campoEstilo, fontSize: '13px' }}
                            />
                          </div>

                          <div>
                            <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Quantidade *</label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.quantidade}
                              onChange={(e) => atualizarItem(chave, { quantidade: e.target.value })}
                              style={{ ...campoEstilo, fontSize: '13px' }}
                            />
                          </div>

                          <div>
                            <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Preço unitário pago *</label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.valorUnitario}
                              onChange={(e) => atualizarItem(chave, { valorUnitario: e.target.value })}
                              style={{ ...campoEstilo, fontSize: '13px' }}
                            />
                          </div>

                          <div>
                            <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Total do item</label>
                            <p style={{ margin: 0, padding: '8px 0', fontSize: '13px', fontWeight: 'bold' }}>
                              {totalItem != null ? formatarMoeda(totalItem) : '—'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: '10px',
                            marginBottom: '8px',
                          }}
                        >
                          <div>
                            <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Quantidade pedida *</label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.quantidade}
                              onChange={(e) => atualizarItem(chave, { quantidade: e.target.value })}
                              style={{ ...campoEstilo, fontSize: '13px' }}
                            />
                          </div>

                          <div>
                            <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Preço unitário estimado</label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.valorUnitario}
                              onChange={(e) => atualizarItem(chave, { valorUnitario: e.target.value })}
                              placeholder="Opcional"
                              style={{ ...campoEstilo, fontSize: '13px' }}
                            />
                          </div>
                        </div>
                      )}

                      {ehRetirada && item.produtoId && (
                        <div style={{ marginBottom: '8px' }}>
                          <label style={{ ...rotuloEstilo, fontSize: '12px' }}>
                            Fator de conversão{fatorForcado ? '' : ' (opcional)'}
                          </label>
                          {fatorForcado ? (
                            <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                              {configResolvida.fatorConfig} — definido pela configuração comercial cadastrada para
                              este fornecedor.
                            </p>
                          ) : (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.fatorConversaoBase}
                              onChange={(e) => atualizarItem(chave, { fatorConversaoBase: e.target.value })}
                              style={{ ...campoEstilo, fontSize: '13px', maxWidth: '160px' }}
                            />
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => removerItem(chave)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#f44336',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 'bold',
                          }}
                        >
                          Remover item
                        </button>
                      </div>
                    </div>
                  );
                })}

                {itens.length === 0 && (
                  <p style={{ color: '#999', fontSize: '13px' }}>Nenhum item adicionado ainda.</p>
                )}
              </div>

              {ehRetirada ? (
                <p style={{ marginTop: '12px', fontSize: '14px', textAlign: 'right' }}>
                  Total geral da compra:{' '}
                  <strong>
                    {todosItensComPreco ? formatarMoeda(totalDerivado) : '—'}
                  </strong>
                </p>
              ) : (
                <>
                  <p style={{ marginTop: '12px', fontSize: '14px', textAlign: 'right' }}>
                    Total estimado do pedido: <strong>{todosItensComPreco ? formatarMoeda(totalDerivado) : '—'}</strong>
                  </p>
                  {todosItensComPreco ? (
                    <p style={{ marginTop: '-8px', fontSize: '11px', color: '#999', textAlign: 'right' }}>
                      Estimado a partir do preço informado — não é necessariamente o preço final da compra.
                    </p>
                  ) : (
                    algumItemComPreco && (
                      <p style={{ marginTop: '-8px', fontSize: '11px', color: '#e65100', textAlign: 'right' }}>
                        Total estimado incompleto — nem todos os itens têm preço informado.
                      </p>
                    )
                  )}
                </>
              )}
            </div>

            {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>}
          </>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button
            type="button"
            onClick={onCancelar}
            disabled={salvando}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || carregandoDados || !!erroCarregamento}
            style={{
              padding: '10px 20px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {salvando ? 'Salvando...' : estaEditando ? 'Salvar alterações' : ehRetirada ? 'Registrar retirada' : 'Criar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
