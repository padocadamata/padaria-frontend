import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';

function normalizar(texto) {
  return (texto || '').trim().toLowerCase();
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Item existente (edição): id = pedido_item_id real; item novo: id = null
// -- é o que distingue INSERT de UPDATE no payload de editar_compra_presencial.
// Numa compra presencial nao ha distincao pedida x recebida (e o mesmo
// ato) -- lemos sempre das colunas *_pedida/valor_unitario, que a RPC
// mantem identicas as colunas *_recebida.
function estadoInicialItem(itemExistente) {
  return {
    id: itemExistente?.id || null,
    produtoId: itemExistente?.produto_id || null,
    produtoNome: itemExistente?.produtoNome || '',
    descricao: itemExistente?.descricao || '',
    unidade: itemExistente?.unidade || '',
    quantidade: itemExistente?.quantidade_pedida != null ? String(itemExistente.quantidade_pedida) : '',
    valorUnitario: itemExistente?.valor_unitario != null ? String(itemExistente.valor_unitario) : '',
    fatorConversaoBase: '',
    buscaProduto: '',
  };
}

function validar(dados) {
  if (!dados.fornecedorId) {
    return 'Selecione o fornecedor.';
  }
  if (!dados.dataCompra) {
    return 'Informe a data da compra.';
  }
  if (dados.dataCompra > dados.hoje) {
    return 'A data da compra não pode ser uma data futura.';
  }
  if (dados.dataDocumentoFiscal && dados.dataDocumentoFiscal > dados.hoje) {
    return 'A data do documento fiscal não pode ser uma data futura.';
  }
  if (dados.itens.length === 0) {
    return 'Adicione ao menos um item.';
  }
  for (const item of dados.itens) {
    if (!item.produtoId) {
      return 'Selecione um produto do Catálogo para cada item.';
    }
    if (!item.unidade.trim()) {
      return 'Informe a unidade de cada item.';
    }
    const quantidade = Number(item.quantidade);
    if (item.quantidade === '' || !Number.isFinite(quantidade) || quantidade <= 0) {
      return 'A quantidade de cada item deve ser maior que zero.';
    }
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
  }
  return null;
}

// Configuração comercial aplicável (produto_fornecedores), quando
// determinável -- mesma regra usada em ReceberPedidoModal.js/
// _resolver_config_comercial_historico() (migration 0037): só resolve
// automaticamente quando existe EXATAMENTE UMA configuração ativa para
// produto+fornecedor com a MESMA unidade comercial informada agora.
function resolverConfig(item, configsPorProduto) {
  const candidatas = (configsPorProduto[item.produtoId] || []).filter(
    (c) => normalizar(c.unidade_comercial) === normalizar(item.unidade)
  );
  if (candidatas.length === 1) {
    return { produtoFornecedorId: candidatas[0].id, fatorConfig: candidatas[0].quantidade_embalagem };
  }
  return { produtoFornecedorId: null, fatorConfig: null };
}

function montarPayloadItens(itens, configsPorProduto) {
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

    const { produtoFornecedorId } = resolverConfig(item, configsPorProduto);
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

function mensagemErroCompraPresencial(error, estaEditando) {
  if (!error) return '';
  const msg = error.message || '';
  const prefixo = estaEditando ? 'editar_compra_presencial' : 'registrar_compra_presencial';

  if (msg.includes('requer sessao autenticada')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (msg.includes('requer a permissao pedidos.inserir') || msg.includes('requer a permissao pedidos.receber')) {
    return 'Você não tem permissão para registrar compras presenciais.';
  }
  if (msg.includes('requer a permissao pedidos.editar')) {
    return 'Você não tem permissão para editar esta compra presencial.';
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
    return 'Este pedido não é uma compra presencial.';
  }
  if (msg.includes('esperado recebido')) {
    return 'Esta compra não está mais com status Recebido. Recarregue a página.';
  }
  if (msg.includes('nao pertence a esta compra') || msg.includes('duplicado no payload')) {
    return 'Erro interno ao montar os itens da compra. Recarregue a página.';
  }
  console.error(`Erro em ${prefixo}:`, error);
  return 'Não foi possível salvar esta compra presencial. Tente novamente ou avise um administrador.';
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

// Mesmo padrão de SeletorProduto de PedidoForm.js -- duplicado
// deliberadamente aqui (mesmo raciocínio já documentado em outros
// pontos do projeto, ex. estaAtrasado em DetalhePedidoModal.js): é um
// componente pequeno e autocontido, e os dois formulários têm ciclos de
// vida independentes (entrega x presencial).
function SeletorProduto({ item, produtos, corPrimaria, onAlterarItem }) {
  const [aberto, setAberto] = useState(false);

  if (item.produtoId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#333', fontWeight: 'bold' }}>{item.produtoNome}</span>
          <button
            type="button"
            onClick={() =>
              onAlterarItem({ produtoId: null, produtoNome: '', descricao: '', unidade: '', buscaProduto: '' })
            }
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
      </div>
    );
  }

  const buscaNormalizada = item.buscaProduto.trim().toLowerCase();
  const resultados = buscaNormalizada
    ? produtos.filter((p) => p.nome.toLowerCase().includes(buscaNormalizada)).slice(0, 8)
    : [];

  return (
    <div style={{ position: 'relative' }}>
      <input
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
      {aberto && buscaNormalizada && (
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
    </div>
  );
}

// Formulário único de criação E edição de compra presencial -- mesmo
// componente, mesmas regras (mesmo padrão já usado em PedidoForm.js/
// DadosProdutoForm.js). `compra` null = criação (via RPC
// registrar_compra_presencial); `compra` preenchido = edição de uma
// compra presencial já recebida (via RPC editar_compra_presencial) --
// ao contrário de PedidoForm.js, aqui TODOS os campos do cabeçalho
// continuam editáveis mesmo na edição (decisão funcional: corrigir
// fornecedor/data é parte explícita do requisito de correção).
export default function CompraPresencialForm({ compra, itensIniciais, corPrimaria = '#8B4513', onSalvo, onCancelar }) {
  const estaEditando = compra != null;
  const hoje = dataLocalHoje();

  const [carregandoDados, setCarregandoDados] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [fornecedores, setFornecedores] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [configsPorProduto, setConfigsPorProduto] = useState({});

  const [fornecedorId, setFornecedorId] = useState(() => (estaEditando ? compra.fornecedor_id : ''));
  const [dataCompra, setDataCompra] = useState(() => (estaEditando ? compra.data_pedido : hoje));
  const [numeroNotaFiscal, setNumeroNotaFiscal] = useState(() => (estaEditando ? compra.numero_nota_fiscal || '' : ''));
  const [dataDocumentoFiscal, setDataDocumentoFiscal] = useState(() =>
    estaEditando ? compra.data_documento_fiscal || '' : ''
  );
  const [observacoes, setObservacoes] = useState(() => (estaEditando ? compra.observacoes || '' : ''));
  const [itens, setItens] = useState(() =>
    estaEditando && itensIniciais?.length ? itensIniciais.map(estadoInicialItem) : [estadoInicialItem()]
  );

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Mesmo padrão de PedidoForm.js: chaves de item mantidas em ref (nao
  // precisam disparar re-render por si so, so acompanhar `itens`).
  const proximaChaveItem = useRef(itens.length);
  const chavesItens = useRef(itens.map((_, i) => i));

  // Carrega TODOS os fornecedores ativos (SEM filtro de modalidade_compra
  // -- decisão funcional central desta frente: compra presencial aceita
  // qualquer fornecedor ativo, mesmo os cadastrados como
  // pedido_com_entrega) e produtos ativos do Catálogo.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregandoDados(true);
      setErroCarregamento('');

      const supabase = createClient();

      const [fornecedoresResp, produtosResp] = await Promise.all([
        supabase
          .from('fornecedores')
          .select('id, nome, nome_fantasia, razao_social')
          .eq('ativo', true)
          .order('nome_fantasia', { ascending: true }),
        supabase.from('produtos').select('id, nome, unidade_medida').eq('ativo', true).order('nome', { ascending: true }),
      ]);

      if (!efeitoAtivo) return;

      const primeiroErro = fornecedoresResp.error || produtosResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar dados da compra presencial:', primeiroErro);
        setErroCarregamento('Não foi possível carregar fornecedores/produtos. Tente novamente.');
        setCarregandoDados(false);
        return;
      }

      setFornecedores(fornecedoresResp.data || []);
      setProdutos(produtosResp.data || []);
      setCarregandoDados(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  // Configurações comerciais (produto_fornecedores) do fornecedor
  // selecionado, para os produtos já escolhidos nos itens -- mesma fonte
  // de dados de ReceberPedidoModal.js, recarregada sempre que o
  // fornecedor ou o conjunto de produtos dos itens muda.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarConfigs() {
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
  }, [fornecedorId, itens.map((i) => i.produtoId).join(',')]);

  function atualizarItem(chave, alteracoes) {
    setItens((atual) =>
      atual.map((item, indice) => (chavesItens.current[indice] === chave ? { ...item, ...alteracoes } : item))
    );
  }

  function adicionarItem() {
    chavesItens.current.push(proximaChaveItem.current++);
    setItens((atual) => [...atual, estadoInicialItem()]);
  }

  function removerItem(chave) {
    const indice = chavesItens.current.indexOf(chave);
    if (indice === -1) return;
    chavesItens.current.splice(indice, 1);
    setItens((atual) => atual.filter((_, i) => i !== indice));
  }

  const itensComTotal = itens.map((item) => {
    const quantidade = Number(item.quantidade);
    const valor = Number(item.valorUnitario);
    const total =
      item.quantidade !== '' && item.valorUnitario !== '' && Number.isFinite(quantidade) && Number.isFinite(valor)
        ? quantidade * valor
        : null;
    return { ...item, total };
  });
  const totalGeral = itensComTotal.every((i) => i.total != null)
    ? itensComTotal.reduce((soma, i) => soma + i.total, 0)
    : null;

  async function salvar() {
    const dados = { fornecedorId, dataCompra, dataDocumentoFiscal, itens, hoje };
    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();
    const payloadItens = montarPayloadItens(itens, configsPorProduto);

    const { error } = estaEditando
      ? await supabase.rpc('editar_compra_presencial', {
          p_pedido_id: compra.id,
          p_fornecedor_id: fornecedorId,
          p_data_compra: dataCompra,
          p_numero_nota_fiscal: numeroNotaFiscal.trim() || null,
          p_data_documento_fiscal: dataDocumentoFiscal || null,
          p_observacoes: observacoes.trim() || null,
          p_itens: payloadItens,
        })
      : await supabase.rpc('registrar_compra_presencial', {
          p_fornecedor_id: fornecedorId,
          p_data_compra: dataCompra,
          p_numero_nota_fiscal: numeroNotaFiscal.trim() || null,
          p_data_documento_fiscal: dataDocumentoFiscal || null,
          p_observacoes: observacoes.trim() || null,
          p_itens: payloadItens,
        });

    setSalvando(false);

    if (error) {
      setErro(mensagemErroCompraPresencial(error, estaEditando));
      return;
    }

    onSalvo();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          {estaEditando ? 'Editar compra presencial' : 'Nova compra presencial'}
        </h3>

        {carregandoDados ? (
          <p>Carregando fornecedores e produtos...</p>
        ) : erroCarregamento ? (
          <p style={{ color: '#f44336' }}>{erroCarregamento}</p>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '15px',
                marginBottom: '15px',
              }}
            >
              <div>
                <label style={rotuloEstilo}>Fornecedor *</label>
                <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} style={campoEstilo}>
                  <option value="">Selecione</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome_fantasia || f.razao_social || f.nome}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                  Todos os fornecedores ativos aparecem aqui, independente da modalidade cadastrada.
                </p>
              </div>

              <div>
                <label style={rotuloEstilo}>Data da compra *</label>
                <input
                  type="date"
                  max={hoje}
                  value={dataCompra}
                  onChange={(e) => setDataCompra(e.target.value)}
                  style={campoEstilo}
                />
              </div>

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
            </div>

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
                <h4 style={{ margin: 0 }}>Itens da compra</h4>
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
                Quantidade, unidade e preço são os EFETIVAMENTE praticados nesta compra — não há etapa de
                recebimento separada.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {itensComTotal.map((item, indice) => {
                  const chave = chavesItens.current[indice];
                  const configResolvida = item.produtoId
                    ? resolverConfig(item, configsPorProduto)
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
                          onAlterarItem={(alt) => atualizarItem(chave, alt)}
                        />
                      </div>

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
                            {item.total != null ? formatarMoeda(item.total) : '—'}
                          </p>
                        </div>
                      </div>

                      {item.produtoId && (
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

                {itens.length === 0 && <p style={{ color: '#999', fontSize: '13px' }}>Nenhum item adicionado ainda.</p>}
              </div>

              <p style={{ marginTop: '12px', fontSize: '14px', textAlign: 'right' }}>
                Total geral da compra: <strong>{totalGeral != null ? formatarMoeda(totalGeral) : '—'}</strong>
              </p>
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
            {salvando ? 'Salvando...' : estaEditando ? 'Salvar alterações' : 'Registrar compra'}
          </button>
        </div>
      </div>
    </div>
  );
}
