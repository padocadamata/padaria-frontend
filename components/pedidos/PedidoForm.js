import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { diaSemanaISO, calcularDataEntrega } from '../../lib/fornecedores/regrasPedido';

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

// `id`: id real de pedido_itens quando o item já existe (edição) -- null
// para item novo, adicionado nesta sessão de edição/criação. É o que
// distingue INSERT de UPDATE na hora de salvar uma edição.
function estadoInicialItem(itemExistente) {
  return {
    id: itemExistente?.id || null,
    produtoId: itemExistente?.produto_id || null,
    produtoNome: itemExistente?.produtoNome || '',
    descricao: itemExistente?.descricao || '',
    unidade: itemExistente?.unidade || '',
    quantidade: itemExistente?.quantidade_pedida != null ? String(itemExistente.quantidade_pedida) : '',
    valorUnitario: itemExistente?.valor_unitario != null ? String(itemExistente.valor_unitario) : '',
    buscaProduto: '',
  };
}

function validar(dados) {
  if (!dados.estaEditando) {
    if (!dados.fornecedorId) {
      return 'Selecione o fornecedor.';
    }
    if (!dados.dataPedido) {
      return 'Informe a data do pedido.';
    }
  }
  if (dados.previsaoEntrega && dados.dataPedido && dados.previsaoEntrega < dados.dataPedido) {
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
      return 'O produto selecionado não tem unidade-base cadastrada no Catálogo — cadastre a unidade lá antes de usá-lo num pedido.';
    }
    const quantidade = Number(item.quantidade);
    if (item.quantidade === '' || !Number.isFinite(quantidade) || quantidade <= 0) {
      return 'A quantidade pedida de cada item deve ser maior que zero.';
    }
    if (item.valorUnitario !== '') {
      const valor = Number(item.valorUnitario);
      if (!Number.isFinite(valor) || valor < 0) {
        return 'O preço unitário estimado não pode ser negativo.';
      }
    }
  }
  return null;
}

function montarPayloadCriacao(dados) {
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

function montarPayloadItem(item, pedidoId) {
  return {
    pedido_id: pedidoId,
    produto_id: item.produtoId,
    descricao: item.descricao.trim(),
    quantidade_pedida: Number(item.quantidade),
    unidade: item.unidade.trim(),
    valor_unitario: item.valorUnitario === '' ? null : Number(item.valorUnitario),
  };
}

function mensagemErroCriacao(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('requer a permissao pedidos.inserir')) {
    return 'Você não tem permissão para criar pedidos.';
  }
  if (msg.includes('fornecedor') && msg.includes('nao encontrado, inativo, ou nao usa modalidade')) {
    return 'Fornecedor inválido, inativo, ou não configurado para pedido com entrega.';
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
  maxWidth: '760px',
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
// ativos) -- não existe "item livre" digitado à mão. Ao selecionar,
// descricao/unidade são preenchidos a partir do cadastro ATUAL do
// produto (nome + unidade_medida) -- vira o snapshot gravado em
// pedido_itens.descricao/unidade. Unidade fica só-leitura por design
// nesta fase (sem produto_fornecedores ainda, não há como o usuário
// escolher CX/PCT/apresentação com segurança -- fica para uma fase
// futura). Descrição também não é mais editável livremente: só muda
// via "Trocar" (nova seleção de produto), nunca por digitação direta.
// Para item já existente (edição), o valor exibido é o SNAPSHOT já
// gravado no banco (item.produtoNome/item.unidade vindos de
// itensIniciais) -- nunca recalculado a partir do cadastro atual do
// produto a menos que o usuário explicitamente clique "Trocar".
function SeletorProduto({ item, produtos, corPrimaria, onAlterarItem }) {
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
        <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
          Unidade: {item.unidade || '—'}
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

// Formulário único de criação E edição -- mesmo componente, mesmas
// regras, para nunca duplicar validação/layout entre as duas telas
// (mesmo padrão já usado em DadosProdutoForm.js do Catálogo). `pedido`
// null = criação (via RPC criar_pedido, único caminho de INSERT --
// nenhuma policy de INSERT existe em public.pedidos, migration 0022).
// `pedido` preenchido = edição de um pedido aguardando_entrega, via
// UPDATE direto em pedidos/pedido_itens -- RLS já permite isso para
// quem tem pedidos.editar (pedidos_update e pedido_itens_insert/update/
// delete, migration 0022); nenhuma RPC nova foi criada para isso.
//
// Campos do cabeçalho deliberadamente SOMENTE LEITURA na edição:
// fornecedor_id e data_pedido. A trigger pedidos_protecao permite
// alterá-los via UPDATE comum (só bloqueia recebido_em/cancelado_em/
// motivo_cancelamento fora de uma transição formal) -- mas criar_pedido()
// valida fornecedor ativo + modalidade_compra='pedido_com_entrega' no
// momento da criação, e NENHUM gatilho revalida isso num UPDATE comum.
// Permitir trocar o fornecedor por edição contornaria essa validação
// silenciosamente. Não é uma limitação de RLS/trigger -- é uma decisão
// de segurança de negócio, documentada aqui explicitamente.
export default function PedidoForm({ pedido, itensIniciais, corPrimaria = '#8B4513', onSalvo, onCancelar }) {
  const estaEditando = pedido != null;

  const [carregandoDados, setCarregandoDados] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [fornecedores, setFornecedores] = useState([]);
  const [regras, setRegras] = useState([]);
  const [produtos, setProdutos] = useState([]);

  const [fornecedorId, setFornecedorId] = useState('');
  const [dataPedido, setDataPedido] = useState(() => (estaEditando ? pedido.data_pedido : dataLocalHoje()));
  const [previsaoEntrega, setPrevisaoEntrega] = useState(() => (estaEditando ? pedido.previsao_entrega || '' : ''));
  const [observacoes, setObservacoes] = useState(() => (estaEditando ? pedido.observacoes || '' : ''));
  const [itens, setItens] = useState(() =>
    estaEditando && itensIniciais?.length ? itensIniciais.map(estadoInicialItem) : [estadoInicialItem()]
  );
  const [regraEscolhidaId, setRegraEscolhidaId] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const proximaChaveItem = useRef(itens.length);
  const chavesItens = useRef(itens.map((_, i) => i));
  // Ids reais de pedido_itens removidos nesta sessão de edição -- usados
  // no DELETE final ao salvar (item já pode ter sumido do array `itens`
  // por aqui, mas ainda precisa ser apagado no banco).
  const idsRemovidosRef = useRef([]);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregandoDados(true);
      setErroCarregamento('');

      const supabase = createClient();

      // Fornecedores/regras só importam na criação (escolha de
      // fornecedor + sugestão de previsão) -- na edição, fornecedor é
      // somente leitura, então nem são buscados.
      const promessas = [supabase.from('produtos').select('id, nome, unidade_medida').eq('ativo', true).order('nome', { ascending: true })];

      if (!estaEditando) {
        promessas.push(
          supabase
            .from('fornecedores')
            .select('id, nome, nome_fantasia, razao_social')
            .eq('ativo', true)
            .eq('modalidade_compra', 'pedido_com_entrega')
            .order('nome_fantasia', { ascending: true }),
          supabase
            .from('fornecedor_regras_pedido')
            .select('id, fornecedor_id, dia_pedido, horario_limite, tipo_entrega, dias_prazo, dia_entrega')
            .eq('ativo', true)
        );
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

  // Regras aplicáveis + sugestão automática de previsão -- só faz
  // sentido na criação (fornecedor/data mutáveis); na edição isso não
  // roda (fornecedorId nunca é setado, regras vem vazio).
  const regrasAplicaveis =
    !estaEditando && fornecedorId && dataPedido
      ? regras.filter(
          (r) =>
            r.fornecedor_id === fornecedorId &&
            (r.dia_pedido === null || r.dia_pedido === diaSemanaISO(dataPedido))
        )
      : [];

  useEffect(() => {
    if (estaEditando) return;
    setRegraEscolhidaId('');
    setPrevisaoEntrega('');
    if (regrasAplicaveis.length === 1) {
      setPrevisaoEntrega(calcularDataEntrega(dataPedido, regrasAplicaveis[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornecedorId, dataPedido]);

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

  function adicionarItem() {
    chavesItens.current.push(proximaChaveItem.current++);
    setItens((atual) => [...atual, estadoInicialItem()]);
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

  // Um pedido pode legitimamente ter itens sem preço -- somar só os que
  // têm e chamar isso de "total do pedido" seria enganoso (pareceria o
  // total real quando na verdade está faltando parte). Só existe um
  // total quando TODOS os itens têm preço informado; caso contrário
  // mostra "—", com uma nota específica se for uma mistura (alguns com
  // preço, outros sem) para não parecer um bug.
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

  // Salva as alterações de um pedido existente -- SEM RPC dedicada.
  // Ordem deliberada: cabeçalho, depois itens NOVOS (insert), depois
  // itens EXISTENTES (update), depois itens REMOVIDOS (delete, em UM
  // único comando batelado por último) -- garante que a invariante
  // "pedido nunca fica sem item" (trigger pedido_itens_impedir_pedido_vazio,
  // migration 0022) só é avaliada contra o estado FINAL pretendido,
  // nunca um estado intermediário artificial de remover-antes-de-inserir.
  // LIMITAÇÃO CONHECIDA: sem RPC, estes passos não são atômicos entre si
  // -- uma falha no meio deixa o que já foi salvo salvo. Mitigado com
  // mensagens de erro específicas por etapa, orientando a recarregar e
  // conferir antes de tentar de novo.
  async function salvarEdicao() {
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
        .insert(itensNovos.map((item) => montarPayloadItem(item, pedido.id)));

      if (erroInsert) {
        console.error('Erro ao adicionar itens do pedido:', erroInsert);
        setErro('Cabeçalho salvo, mas não foi possível adicionar os novos itens. Recarregue e confira o pedido antes de tentar de novo.');
        return false;
      }
    }

    for (const item of itensExistentes) {
      // .eq('pedido_id', pedido.id) além de .eq('id', item.id): reforço
      // deliberado, mesmo o id já sendo uma PK globalmente única (não
      // deveria colidir com item de outro pedido por natureza) -- fecha
      // por completo qualquer cenário de um id vindo do estado do
      // frontend estar errado/desatualizado, fazendo a query afetar 0
      // linhas em vez de arriscar tocar em outro pedido.
      const { error: erroUpdate } = await supabase
        .from('pedido_itens')
        .update(montarPayloadItem(item, pedido.id))
        .eq('id', item.id)
        .eq('pedido_id', pedido.id);

      if (erroUpdate) {
        console.error('Erro ao atualizar item do pedido:', erroUpdate);
        setErro('Algumas alterações já foram salvas, mas um dos itens existentes não pôde ser atualizado. Recarregue e confira o pedido antes de tentar de novo.');
        return false;
      }
    }

    if (idsRemovidosRef.current.length > 0) {
      // Mesmo reforço do UPDATE acima: .eq('pedido_id', pedido.id) além
      // de .in('id', ...) -- ids em idsRemovidosRef só podem vir de itens
      // que já pertenciam a este pedido (carregados via itensIniciais),
      // mas o filtro extra garante isso também no nível da própria
      // query, não só na lógica que populou a lista.
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
    const dados = { estaEditando, fornecedorId, dataPedido, previsaoEntrega, observacoes, itens };
    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    if (estaEditando) {
      const sucesso = await salvarEdicao();
      setSalvando(false);
      if (sucesso) onSalvo();
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.rpc('criar_pedido', montarPayloadCriacao(dados));

    setSalvando(false);

    if (error) {
      console.error('Erro ao criar pedido:', error);
      setErro(mensagemErroCriacao(error));
      return;
    }

    onSalvo();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>{estaEditando ? 'Editar pedido' : 'Novo pedido'}</h3>

        {carregandoDados ? (
          <p>Carregando fornecedores e produtos...</p>
        ) : erroCarregamento ? (
          <p style={{ color: '#f44336' }}>{erroCarregamento}</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '15px' }}>
              <div>
                <label style={rotuloEstilo}>Fornecedor {!estaEditando && '*'}</label>
                {estaEditando ? (
                  <p style={{ margin: 0, padding: '8px 0' }}>{pedido.fornecedorNome}</p>
                ) : (
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
                      <p style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                        Nenhum fornecedor ativo com modalidade "pedido com entrega".
                      </p>
                    )}
                  </>
                )}
              </div>

              <div>
                <label style={rotuloEstilo}>Data do pedido {!estaEditando && '*'}</label>
                {estaEditando ? (
                  <p style={{ margin: 0, padding: '8px 0' }}>{dataPedido}</p>
                ) : (
                  <input type="date" value={dataPedido} onChange={(e) => setDataPedido(e.target.value)} style={campoEstilo} />
                )}
              </div>

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
            </div>

            {estaEditando && (
              <p style={{ fontSize: '12px', color: '#999', marginTop: '-8px', marginBottom: '15px' }}>
                Fornecedor e data do pedido não podem ser alterados após a criação.
              </p>
            )}

            {!estaEditando && fornecedorId && regrasAplicaveis.length === 0 && (
              <p style={{ fontSize: '13px', color: '#999', marginBottom: '15px' }}>
                Nenhuma regra de pedido cadastrada para este fornecedor neste dia da semana — informe a previsão
                manualmente.
              </p>
            )}

            {!estaEditando && fornecedorId && regrasAplicaveis.length === 1 && (
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
                Previsão sugerida por regra cadastrada: {descreverRegra(regrasAplicaveis[0])}. Você pode ajustar a
                data acima manualmente.
              </p>
            )}

            {!estaEditando && fornecedorId && regrasAplicaveis.length > 1 && (
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
                <h4 style={{ margin: 0 }}>Itens do pedido</h4>
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
                Quantidade pedida e preço estimado desta fase — a quantidade e o preço efetivamente recebidos serão
                registrados futuramente, na etapa de Recebimento.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {itens.map((item, indice) => {
                  const chave = chavesItens.current[indice];
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

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '8px' }}>
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
            {salvando ? 'Salvando...' : estaEditando ? 'Salvar alterações' : 'Criar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
