import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';

function normalizar(texto) {
  return (texto || '').trim().toLowerCase();
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Estado inicial por item -- pré-preenchimento é SÓ conveniência (ver
// cabeçalho da migration 0026, seção 4/8): unidade/quantidade/preço
// vêm do que foi ESTIMADO no pedido, o operador corrige para refletir a
// compra real antes de confirmar. Fator só é pré-preenchido com "1"
// quando a unidade do pedido já é igual à unidade-base do produto --
// nos demais casos fica em branco (nunca inventa conversão UN↔KG).
function estadoInicialItem(item, unidadeBasePorProduto) {
  const unidadeBase = item.produto_id ? unidadeBasePorProduto[item.produto_id] : null;
  const fatorInicial =
    unidadeBase && normalizar(item.unidade) === normalizar(unidadeBase) ? '1' : '';

  return {
    pedidoItemId: item.id,
    produtoId: item.produto_id,
    descricao: item.descricao,
    unidadeRecebida: item.unidade || '',
    quantidadeRecebida: item.quantidade_pedida != null ? String(item.quantidade_pedida) : '',
    valorUnitarioRecebido: item.valor_unitario != null ? String(item.valor_unitario) : '',
    fatorConversaoBase: fatorInicial,
    // Só usado quando há ambiguidade real e Sacos Fechados está em jogo
    // (ver precisaEscolhaExplicita/resolverConfig, migration 0051).
    produtoFornecedorIdEscolhido: null,
    // Quantidade FÍSICA de sacos recebidos -- SEMPRE explícita, nunca
    // calculada a partir de quantidadeRecebida (que continua sendo a
    // quantidade na unidade comercial do item, ex.: KG -- os dois
    // números são validados como coerentes entre si, nunca um derivando
    // o outro). Só relevante quando a config resolvida controla Sacos
    // Fechados (ver JSX abaixo). Migration 0051 (revisão 2).
    quantidadeSacosRecebidos: '',
  };
}

// Configuração comercial aplicável (produto_fornecedores), quando
// determinável -- mesma regra implementada em receber_pedido() (0026,
// seção 4): só resolve automaticamente quando existe EXATAMENTE UMA
// configuração ativa para produto+fornecedor com a MESMA unidade
// comercial da unidade informada agora. Ambíguo (>1) ou inexistente (0)
// = "sem configuração determinável" -- exceto quando o operador já
// escolheu explicitamente (item.produtoFornecedorIdEscolhido, ver
// seletor de ambiguidade abaixo, necessário desde a migration 0051
// porque um item cuja config correta controla Sacos Fechados não pode
// ficar sem vínculo determinável).
function resolverConfig(item, configsPorProduto) {
  const candidatas = (configsPorProduto[item.produtoId] || []).filter(
    (c) => normalizar(c.unidade_comercial) === normalizar(item.unidadeRecebida)
  );

  if (item.produtoFornecedorIdEscolhido) {
    const escolhida = candidatas.find((c) => c.id === item.produtoFornecedorIdEscolhido);
    if (escolhida) {
      return {
        produtoFornecedorId: escolhida.id,
        fatorConfig: escolhida.quantidade_embalagem,
        controlaSacosFechados: !!escolhida.controla_sacos_fechados,
        pesoPorSacoKg: escolhida.peso_por_saco_kg,
        candidatas,
      };
    }
  }

  if (candidatas.length === 1) {
    return {
      produtoFornecedorId: candidatas[0].id,
      fatorConfig: candidatas[0].quantidade_embalagem,
      controlaSacosFechados: !!candidatas[0].controla_sacos_fechados,
      pesoPorSacoKg: candidatas[0].peso_por_saco_kg,
      candidatas,
    };
  }
  return { produtoFornecedorId: null, fatorConfig: null, controlaSacosFechados: false, pesoPorSacoKg: null, candidatas };
}

// Só quando genuinamente ambíguo (>1 candidata para a mesma unidade) E
// pelo menos uma delas controla Sacos Fechados -- sem isso, o backend
// (0051) bloqueia o recebimento inteiro sem nenhuma forma de o operador
// resolver pela UI. Fora desse caso raro, nenhum seletor extra aparece.
function precisaEscolhaExplicita(candidatas) {
  return candidatas.length > 1 && candidatas.some((c) => c.controla_sacos_fechados);
}

function validar(dataRecebimento, dataPedido, hoje, itensEstado, configsPorProduto) {
  if (!dataRecebimento) {
    return 'Informe a data do recebimento.';
  }
  if (dataRecebimento < dataPedido) {
    return 'A data do recebimento não pode ser anterior à data do pedido.';
  }
  if (dataRecebimento > hoje) {
    return 'A data do recebimento não pode ser uma data futura.';
  }
  for (const item of itensEstado) {
    if (!item.unidadeRecebida.trim()) {
      return 'Informe a unidade recebida de todos os itens.';
    }
    const quantidade = Number(item.quantidadeRecebida);
    if (item.quantidadeRecebida === '' || !Number.isFinite(quantidade) || quantidade <= 0) {
      return 'A quantidade recebida de cada item deve ser maior que zero.';
    }
    const valor = Number(item.valorUnitarioRecebido);
    if (item.valorUnitarioRecebido === '' || !Number.isFinite(valor) || valor < 0) {
      return 'Informe o valor unitário efetivamente pago de cada item (pode ser 0, mas não pode ficar em branco nem ser negativo).';
    }
    if (item.fatorConversaoBase.trim() !== '') {
      const fator = Number(item.fatorConversaoBase);
      if (!Number.isFinite(fator) || fator <= 0) {
        return 'O fator de conversão, quando informado, deve ser maior que zero.';
      }
    }

    // Checagens client-side de Sacos Fechados (migration 0051, revisão
    // 2) -- só UX, a regra real (e a única que efetivamente impede
    // inconsistência) é sempre a da RPC receber_pedido no backend.
    if (item.produtoId) {
      const config = resolverConfig(item, configsPorProduto);
      if (precisaEscolhaExplicita(config.candidatas) && !item.produtoFornecedorIdEscolhido) {
        return 'Este item tem mais de uma configuração comercial cadastrada para esta unidade, e uma delas controla Sacos Fechados -- escolha explicitamente qual configuração usar.';
      }
      if (config.controlaSacosFechados) {
        const sacos = Number(item.quantidadeSacosRecebidos);
        if (item.quantidadeSacosRecebidos === '' || !Number.isFinite(sacos) || sacos <= 0 || sacos !== Math.trunc(sacos)) {
          return 'Este item controla Sacos Fechados -- informe a quantidade de sacos recebidos (número inteiro maior que zero).';
        }
        if (config.pesoPorSacoKg != null && !coerenteComPeso(quantidade, sacos, config.pesoPorSacoKg)) {
          return `A quantidade recebida (${quantidade}) não corresponde a ${sacos} saco(s) de ${config.pesoPorSacoKg}kg cada (esperado ${(sacos * config.pesoPorSacoKg).toLocaleString('pt-BR')}).`;
        }
      } else if (item.quantidadeSacosRecebidos.trim() !== '') {
        return 'Este item não controla Sacos Fechados -- não deve informar quantidade de sacos recebidos.';
      }
    }
  }
  return null;
}

// Coerência EXATA entre quantidade recebida (kg) e sacos x peso -- só
// UX (o backend usa aritmética numeric exata, autoridade real). JS usa
// ponto flutuante, então comparamos arredondando a 3 casas decimais
// (mesma precisão de numeric(12,3) usada no banco) em vez de igualdade
// direta, para não bloquear por ruído de ponto flutuante um valor que o
// backend aceitaria. SEM tolerância além disso -- nenhuma margem de
// erro real é permitida, só a normalização de precisão decimal.
function coerenteComPeso(quantidadeRecebida, sacos, pesoPorSacoKg) {
  const esperado = Math.round(sacos * pesoPorSacoKg * 1000);
  const informado = Math.round(quantidadeRecebida * 1000);
  return esperado === informado;
}

// Payload exato esperado por receber_pedido(uuid,date,jsonb) -- montado
// lendo a implementação real da RPC (migration 0026): pedido_item_id,
// unidade_recebida, quantidade_recebida, valor_unitario_recebido
// obrigatórios em todo item; fator_conversao_base e produto_fornecedor_id
// OPCIONAIS, só incluídos quando fazem sentido (nunca enviados vazios).
function montarPayload(pedidoId, dataRecebimento, itensEstado, configsPorProduto) {
  return {
    p_pedido_id: pedidoId,
    p_data_recebimento: dataRecebimento,
    p_itens: itensEstado.map((item) => {
      const payloadItem = {
        pedido_item_id: item.pedidoItemId,
        unidade_recebida: item.unidadeRecebida.trim(),
        quantidade_recebida: Number(item.quantidadeRecebida),
        valor_unitario_recebido: Number(item.valorUnitarioRecebido),
      };

      if (item.produtoId) {
        const config = resolverConfig(item, configsPorProduto);
        if (config.produtoFornecedorId) {
          payloadItem.produto_fornecedor_id = config.produtoFornecedorId;
        }
        // Só envia quantidade_sacos_recebidos quando a config resolvida
        // controla Sacos Fechados -- o backend nunca confia no frontend
        // para decidir isso (revalida tudo de novo), mas evitamos enviar
        // um valor sem sentido para um item que não controla sacos.
        if (config.controlaSacosFechados && item.quantidadeSacosRecebidos.trim() !== '') {
          payloadItem.quantidade_sacos_recebidos = Number(item.quantidadeSacosRecebidos);
        }
      }

      const fatorTexto = item.fatorConversaoBase.trim();
      if (fatorTexto !== '') {
        payloadItem.fator_conversao_base = Number(fatorTexto);
      }

      return payloadItem;
    }),
  };
}

function mensagemErroRecebimento(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('requer a permissao pedidos.receber')) {
    return 'Você não tem permissão para receber pedidos.';
  }
  if (msg.includes('data do recebimento e obrigatoria')) {
    return 'Informe a data do recebimento.';
  }
  if (msg.includes('nao pode ser no futuro')) {
    return 'A data do recebimento não pode ser uma data futura.';
  }
  if (msg.includes('nao pode ser anterior a data do pedido')) {
    return 'A data do recebimento não pode ser anterior à data do pedido.';
  }
  if (msg.includes('nao encontrado')) {
    return 'Pedido não encontrado. Recarregue a página.';
  }
  if (msg.includes('somente pedidos aguardando_entrega podem ser recebidos')) {
    return 'Este pedido não está mais aguardando entrega. Recarregue a página.';
  }
  if (msg.includes('sem unidade_recebida valida')) {
    return 'Informe a unidade recebida de todos os itens.';
  }
  if (msg.includes('quantidade_recebida')) {
    return 'Quantidade inválida em algum item — deve ser um número maior que zero.';
  }
  if (msg.includes('valor_unitario_recebido')) {
    return 'Valor unitário inválido em algum item.';
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
  if (msg.includes('informe quantidade_sacos_recebidos')) {
    return 'Este item controla Sacos Fechados -- informe a quantidade de sacos recebidos.';
  }
  if (msg.includes('nao corresponde a') && msg.includes('saco(s) de')) {
    return 'A quantidade recebida não corresponde à quantidade de sacos informada multiplicada pelo peso por saco. Confira os dois valores.';
  }
  if (msg.includes('quantidade_sacos_recebidos') && msg.includes('nao controla Sacos Fechados')) {
    return 'Este item não controla Sacos Fechados -- não deve informar quantidade de sacos recebidos.';
  }
  if (msg.includes('quantidade_sacos_recebidos invalida')) {
    return 'Quantidade de sacos recebidos inválida -- deve ser um número inteiro.';
  }
  if (msg.includes('quantidade_sacos_recebidos deve ser maior que zero')) {
    return 'A quantidade de sacos recebidos deve ser maior que zero.';
  }
  if (msg.includes('controlada por Sacos Fechados') && msg.includes('informe produto_fornecedor_id explicitamente')) {
    return 'Este item tem uma configuração comercial de Sacos Fechados que não pôde ser identificada automaticamente. Recarregue a página e escolha a configuração explicitamente.';
  }
  if (msg.includes('Sacos Fechados so opera sobre produtos cuja unidade-base seja KG')) {
    return 'Este produto não tem unidade-base KG -- Sacos Fechados só funciona para produtos cuja unidade-base seja KG.';
  }
  if (msg.includes('numero de itens informados')) {
    return 'Todos os itens do pedido precisam estar preenchidos antes de confirmar.';
  }
  if (msg.includes('item duplicado')) {
    return 'Erro interno ao montar os itens do recebimento. Recarregue a página.';
  }
  if (msg.includes('nao pertence a este pedido')) {
    return 'Erro interno ao montar os itens do recebimento. Recarregue a página.';
  }
  return 'Não foi possível confirmar o recebimento. Tente novamente ou avise um administrador.';
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

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '12px' };

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '13px',
};

// Modal de recebimento detalhado -- vive dentro do fluxo de Pedidos
// (nunca um módulo/tela própria, ver cabeçalho da migration 0026).
// Único caminho de escrita: a RPC receber_pedido (migration 0026,
// SECURITY DEFINER) -- nenhum UPDATE direto em pedido_itens/pedidos e
// nenhum INSERT em produtos_historico_compras a partir daqui. A RPC já
// tem lock (FOR UPDATE) e atomicidade próprios; este componente nunca
// replica lógica de persistência em múltiplos passos.
export default function ReceberPedidoModal({ pedido, itens, fornecedorNome, produtoNomePorId, corPrimaria = '#8B4513', onConfirmado, onCancelar }) {
  const [carregandoConfig, setCarregandoConfig] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [configsPorProduto, setConfigsPorProduto] = useState({});
  const [unidadeBasePorProduto, setUnidadeBasePorProduto] = useState({});

  const [dataRecebimento, setDataRecebimento] = useState(() => dataLocalHoje());
  const [itensEstado, setItensEstado] = useState([]);

  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');

  const hoje = dataLocalHoje();

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregandoConfig(true);
      setErroCarregamento('');

      const produtoIds = Array.from(new Set(itens.map((i) => i.produto_id).filter(Boolean)));

      if (produtoIds.length === 0) {
        if (!efeitoAtivo) return;
        setConfigsPorProduto({});
        setUnidadeBasePorProduto({});
        setItensEstado(itens.map((item) => estadoInicialItem(item, {})));
        setCarregandoConfig(false);
        return;
      }

      const supabase = createClient();
      const [produtosResp, configsResp] = await Promise.all([
        supabase.from('produtos').select('id, unidade_medida').in('id', produtoIds),
        supabase
          .from('produto_fornecedores')
          .select('id, produto_id, unidade_comercial, quantidade_embalagem, controla_sacos_fechados, peso_por_saco_kg')
          .eq('fornecedor_id', pedido.fornecedor_id)
          .eq('ativo', true)
          .in('produto_id', produtoIds),
      ]);

      if (!efeitoAtivo) return;

      if (produtosResp.error || configsResp.error) {
        console.error('Erro ao carregar dados para recebimento:', produtosResp.error || configsResp.error);
        setErroCarregamento('Não foi possível carregar os dados do recebimento. Tente novamente.');
        setCarregandoConfig(false);
        return;
      }

      const unidadeBaseMapa = {};
      for (const p of produtosResp.data || []) {
        unidadeBaseMapa[p.id] = p.unidade_medida;
      }

      const configsMapa = {};
      for (const c of configsResp.data || []) {
        if (!configsMapa[c.produto_id]) configsMapa[c.produto_id] = [];
        configsMapa[c.produto_id].push(c);
      }

      setUnidadeBasePorProduto(unidadeBaseMapa);
      setConfigsPorProduto(configsMapa);
      setItensEstado(itens.map((item) => estadoInicialItem(item, unidadeBaseMapa)));
      setCarregandoConfig(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function atualizarItem(pedidoItemId, alteracoes) {
    setItensEstado((atual) =>
      atual.map((item) => (item.pedidoItemId === pedidoItemId ? { ...item, ...alteracoes } : item))
    );
  }

  async function confirmar() {
    const mensagemValidacao = validar(dataRecebimento, pedido.data_pedido, hoje, itensEstado, configsPorProduto);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setConfirmando(true);

    const supabase = createClient();
    const payload = montarPayload(pedido.id, dataRecebimento, itensEstado, configsPorProduto);
    const { error } = await supabase.rpc('receber_pedido', payload);

    setConfirmando(false);

    if (error) {
      console.error('Erro ao confirmar recebimento:', error);
      setErro(mensagemErroRecebimento(error));
      return;
    }

    onConfirmado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Receber pedido</h3>
        <p style={{ fontSize: '13px', color: '#666', marginTop: '-8px', marginBottom: '15px' }}>
          {fornecedorNome} — pedido de {formatarDataExibicao(pedido.data_pedido)}
        </p>

        {carregandoConfig ? (
          <p>Carregando dados do recebimento...</p>
        ) : erroCarregamento ? (
          <p style={{ color: '#f44336' }}>{erroCarregamento}</p>
        ) : (
          <>
            <div style={{ marginBottom: '18px', maxWidth: '260px' }}>
              <label style={rotuloEstilo}>Data do recebimento *</label>
              <input
                type="date"
                min={pedido.data_pedido}
                max={hoje}
                value={dataRecebimento}
                onChange={(e) => setDataRecebimento(e.target.value)}
                style={campoEstilo}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {itensEstado.map((item) => {
                const nomeProduto = item.produtoId
                  ? produtoNomePorId[item.produtoId] || item.descricao
                  : item.descricao;
                const rotuloQuantidade = normalizar(item.unidadeRecebida) === 'kg' ? 'Peso (kg)' : 'Quantidade';
                const configResolvida = item.produtoId
                  ? resolverConfig(item, configsPorProduto)
                  : { produtoFornecedorId: null, fatorConfig: null, controlaSacosFechados: false, pesoPorSacoKg: null, candidatas: [] };
                const precisaEscolha = precisaEscolhaExplicita(configResolvida.candidatas);
                const sacosRecebidosNum = Number(item.quantidadeSacosRecebidos);
                const pesoTeoricoSacos =
                  configResolvida.controlaSacosFechados && Number.isFinite(sacosRecebidosNum) && configResolvida.pesoPorSacoKg != null
                    ? sacosRecebidosNum * configResolvida.pesoPorSacoKg
                    : null;
                const quantidadeRecebidaNum = Number(item.quantidadeRecebida);
                const sacosCoerente =
                  pesoTeoricoSacos == null ||
                  !Number.isFinite(quantidadeRecebidaNum) ||
                  coerenteComPeso(quantidadeRecebidaNum, sacosRecebidosNum, configResolvida.pesoPorSacoKg);
                const fatorForcado = configResolvida.fatorConfig != null;
                const unidadeBase = item.produtoId ? unidadeBasePorProduto[item.produtoId] : null;

                const quantidade = Number(item.quantidadeRecebida);
                const valorUnitario = Number(item.valorUnitarioRecebido);
                const valorTotal =
                  item.quantidadeRecebida !== '' &&
                  item.valorUnitarioRecebido !== '' &&
                  Number.isFinite(quantidade) &&
                  Number.isFinite(valorUnitario)
                    ? quantidade * valorUnitario
                    : null;

                return (
                  <div key={item.pedidoItemId} style={{ backgroundColor: '#f9f9f9', padding: '12px', borderRadius: '5px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                      {nomeProduto}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                      <div>
                        <label style={rotuloEstilo}>Unidade *</label>
                        <input
                          type="text"
                          value={item.unidadeRecebida}
                          onChange={(e) => atualizarItem(item.pedidoItemId, { unidadeRecebida: e.target.value })}
                          placeholder="UN, KG, CX..."
                          style={campoEstilo}
                        />
                      </div>

                      <div>
                        <label style={rotuloEstilo}>{rotuloQuantidade} *</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.quantidadeRecebida}
                          onChange={(e) => atualizarItem(item.pedidoItemId, { quantidadeRecebida: e.target.value })}
                          style={campoEstilo}
                        />
                      </div>

                      <div>
                        <label style={rotuloEstilo}>Valor unitário *</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.valorUnitarioRecebido}
                          onChange={(e) => atualizarItem(item.pedidoItemId, { valorUnitarioRecebido: e.target.value })}
                          style={campoEstilo}
                        />
                      </div>

                      <div>
                        <label style={rotuloEstilo}>Valor total</label>
                        <p style={{ margin: 0, padding: '8px 0', fontSize: '13px', fontWeight: 'bold' }}>
                          {valorTotal != null ? formatarMoeda(valorTotal) : '—'}
                        </p>
                      </div>
                    </div>

                    {item.produtoId && (
                      <div style={{ marginTop: '8px' }}>
                        <label style={rotuloEstilo}>Fator de conversão{fatorForcado ? '' : ' (opcional)'}</label>
                        {fatorForcado ? (
                          <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                            {configResolvida.fatorConfig} — definido pela configuração comercial cadastrada para este
                            fornecedor.
                          </p>
                        ) : (
                          <>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.fatorConversaoBase}
                              onChange={(e) => atualizarItem(item.pedidoItemId, { fatorConversaoBase: e.target.value })}
                              style={{ ...campoEstilo, maxWidth: '160px' }}
                            />
                            <p style={{ fontSize: '11px', color: '#999', marginTop: '4px', marginBottom: 0 }}>
                              Quantas unidades-base{unidadeBase ? ` (${unidadeBase})` : ''} correspondem a 1 unidade
                              informada acima. Exemplo: produto base UN, compra CX com 12 unidades → fator 12. Deixe
                              em branco se não souber — o recebimento continua permitido.
                            </p>
                          </>
                        )}
                      </div>
                    )}

                    {precisaEscolha && (
                      <div style={{ marginTop: '8px' }}>
                        <label style={rotuloEstilo}>Configuração comercial (obrigatório escolher) *</label>
                        <select
                          value={item.produtoFornecedorIdEscolhido || ''}
                          onChange={(e) => atualizarItem(item.pedidoItemId, { produtoFornecedorIdEscolhido: e.target.value || null })}
                          style={campoEstilo}
                        >
                          <option value="">Selecione...</option>
                          {configResolvida.candidatas.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.unidade_comercial}
                              {c.controla_sacos_fechados ? ` — controla Sacos Fechados (${c.peso_por_saco_kg} kg/saco)` : ''}
                            </option>
                          ))}
                        </select>
                        <p style={{ fontSize: '11px', color: '#e65100', marginTop: '4px', marginBottom: 0 }}>
                          Existe mais de uma configuração comercial cadastrada para esta unidade, e uma delas controla
                          Sacos Fechados -- escolha qual foi efetivamente recebida.
                        </p>
                      </div>
                    )}

                    {configResolvida.controlaSacosFechados && (
                      <div style={{ marginTop: '8px', backgroundColor: '#efe6da', padding: '10px', borderRadius: '5px' }}>
                        <label style={rotuloEstilo}>Quantidade de sacos recebidos *</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantidadeSacosRecebidos}
                          onChange={(e) => atualizarItem(item.pedidoItemId, { quantidadeSacosRecebidos: e.target.value })}
                          style={{ ...campoEstilo, maxWidth: '160px', marginBottom: '8px' }}
                        />
                        <p style={{ margin: 0, fontSize: '12px', color: '#5a3e1b' }}>
                          Peso por saco: {configResolvida.pesoPorSacoKg} kg &nbsp;·&nbsp; Quantidade recebida: {item.quantidadeRecebida || '—'} kg
                          &nbsp;·&nbsp; Sacos recebidos: {item.quantidadeSacosRecebidos || '—'} &nbsp;·&nbsp; Peso teórico dos sacos:{' '}
                          {pesoTeoricoSacos != null ? pesoTeoricoSacos.toLocaleString('pt-BR') : '—'} kg
                        </p>
                        {!sacosCoerente && (
                          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#c62828', fontWeight: 'bold' }}>
                            A quantidade recebida não corresponde aos sacos informados x peso por saco -- confira os
                            valores antes de confirmar.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginTop: '15px' }}>{erro}</p>}
          </>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onCancelar}
            disabled={confirmando}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: confirmando ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={confirmando || carregandoConfig || !!erroCarregamento}
            style={{
              padding: '10px 20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: confirmando ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {confirmando ? 'Confirmando...' : 'Confirmar recebimento'}
          </button>
        </div>
      </div>
    </div>
  );
}
