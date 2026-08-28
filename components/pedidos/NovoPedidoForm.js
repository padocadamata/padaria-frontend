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

function estadoInicialItem() {
  return {
    descricao: '',
    unidade: '',
    quantidade: '',
    valorUnitario: '',
    produtoId: null,
    produtoNome: '',
    buscaProduto: '',
    observacao: '',
  };
}

function validar(dados) {
  if (!dados.fornecedorId) {
    return 'Selecione o fornecedor.';
  }
  if (!dados.dataPedido) {
    return 'Informe a data do pedido.';
  }
  if (dados.previsaoEntrega && dados.previsaoEntrega < dados.dataPedido) {
    return 'A previsão de entrega não pode ser anterior à data do pedido.';
  }
  if (dados.itens.length === 0) {
    return 'Adicione ao menos um item.';
  }
  for (const item of dados.itens) {
    if (!item.descricao.trim()) {
      return 'Todos os itens precisam de uma descrição.';
    }
    if (!item.unidade.trim()) {
      return 'Todos os itens precisam de uma unidade.';
    }
    const quantidade = Number(item.quantidade);
    if (item.quantidade === '' || !Number.isFinite(quantidade) || quantidade <= 0) {
      return 'A quantidade de cada item deve ser maior que zero.';
    }
    if (item.valorUnitario !== '') {
      const valor = Number(item.valorUnitario);
      if (!Number.isFinite(valor) || valor < 0) {
        return 'O valor unitário não pode ser negativo.';
      }
    }
  }
  return null;
}

function montarPayload(dados) {
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
      produto_id: item.produtoId || null,
      observacao: item.observacao.trim() || null,
    })),
  };
}

function mensagemErro(error) {
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

// Não existe autocomplete de produto em nenhum outro lugar do projeto
// (public.produtos não tem tela própria hoje) — solução simples e local a
// este arquivo: busca por texto sobre a lista carregada uma vez, sem
// nenhuma abstração genérica nova. produto_id é sempre opcional; limpar a
// seleção devolve o item a um item "livre" (só descrição/unidade/qtd).
function BuscaProduto({ item, produtos, corPrimaria, onAlterarItem }) {
  const [aberto, setAberto] = useState(false);

  if (item.produtoId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '13px', color: '#333' }}>{item.produtoNome}</span>
        <button
          type="button"
          onClick={() => onAlterarItem({ produtoId: null, produtoNome: '', buscaProduto: '' })}
          title="Remover vínculo com produto do catálogo"
          style={{
            border: 'none',
            background: 'transparent',
            color: '#f44336',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '13px',
          }}
        >
          ×
        </button>
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
        placeholder="Buscar produto do catálogo (opcional)..."
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
                  onAlterarItem({ produtoId: produto.id, produtoNome: produto.nome, buscaProduto: '' })
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

// Modal de criação — Fase A: único caminho de escrita é a RPC
// criar_pedido() (nunca INSERT direto em public.pedidos/pedido_itens, ver
// justificativa completa no cabeçalho da migration 0022). Sem
// recebimento/cancelamento/edição aqui — isso é de fases futuras.
export default function NovoPedidoForm({ corPrimaria = '#8B4513', onCriado, onCancelar }) {
  const [carregandoDados, setCarregandoDados] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [fornecedores, setFornecedores] = useState([]);
  const [regras, setRegras] = useState([]);
  const [produtos, setProdutos] = useState([]);

  const [fornecedorId, setFornecedorId] = useState('');
  const [dataPedido, setDataPedido] = useState(() => dataLocalHoje());
  const [previsaoEntrega, setPrevisaoEntrega] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [itens, setItens] = useState([estadoInicialItem()]);
  const [regraEscolhidaId, setRegraEscolhidaId] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const proximaChaveItem = useRef(1);
  const chavesItens = useRef([0]);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregandoDados(true);
      setErroCarregamento('');

      const supabase = createClient();

      const [fornecedoresResp, regrasResp, produtosResp] = await Promise.all([
        supabase
          .from('fornecedores')
          .select('id, nome, nome_fantasia, razao_social')
          .eq('ativo', true)
          .eq('modalidade_compra', 'pedido_com_entrega')
          .order('nome_fantasia', { ascending: true }),
        supabase
          .from('fornecedor_regras_pedido')
          .select('id, fornecedor_id, dia_pedido, horario_limite, tipo_entrega, dias_prazo, dia_entrega')
          .eq('ativo', true),
        supabase.from('produtos').select('id, nome').eq('ativo', true).order('nome', { ascending: true }),
      ]);

      if (!efeitoAtivo) return;

      const primeiroErro = fornecedoresResp.error || regrasResp.error || produtosResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar dados para novo pedido:', primeiroErro);
        setErroCarregamento('Não foi possível carregar fornecedores/produtos. Tente novamente.');
        setCarregandoDados(false);
        return;
      }

      setFornecedores(fornecedoresResp.data || []);
      setRegras(regrasResp.data || []);
      setProdutos(produtosResp.data || []);
      setCarregandoDados(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  // Regras do fornecedor escolhido que se aplicam à data do pedido
  // escolhida: regra semanal cujo dia_pedido bate com o dia da semana da
  // data, OU regra diária (dia_pedido=null, "pode pedir qualquer dia") —
  // ambas contam como aplicáveis a uma data específica já escolhida pelo
  // usuário (diferente da grade do Dashboard, que nunca fixa a regra
  // diária numa célula por falta de uma data real de referência; aqui já
  // existe uma data real).
  const regrasAplicaveis =
    fornecedorId && dataPedido
      ? regras.filter(
          (r) =>
            r.fornecedor_id === fornecedorId &&
            (r.dia_pedido === null || r.dia_pedido === diaSemanaISO(dataPedido))
        )
      : [];

  useEffect(() => {
    setRegraEscolhidaId('');
    // Sempre zera primeiro: qualquer sugestão calculada para o
    // fornecedor/data ANTERIOR nunca deve sobreviver a uma troca de
    // fornecedor ou de data — mesmo quando a nova combinação tem 0 ou
    // mais de 1 regra aplicável (nesses dois casos não há recálculo
    // automático abaixo, então sem este reset o valor antigo ficaria
    // exibido como se ainda fosse válido para o novo contexto).
    setPrevisaoEntrega('');

    if (regrasAplicaveis.length === 1) {
      setPrevisaoEntrega(calcularDataEntrega(dataPedido, regrasAplicaveis[0]));
    }
    // 0 regras: nada para sugerir, o campo fica em branco para
    // preenchimento manual. >1 regras: aguarda escolha explícita abaixo
    // (ver escolherRegra), o campo também fica em branco até lá.
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
    chavesItens.current.splice(indice, 1);
    setItens((atual) => atual.filter((_, i) => i !== indice));
  }

  const totalDerivado = itens.reduce((soma, item) => {
    const quantidade = Number(item.quantidade);
    const valor = Number(item.valorUnitario);
    if (!Number.isFinite(quantidade) || !Number.isFinite(valor)) return soma;
    return soma + quantidade * valor;
  }, 0);
  const algumItemComValor = itens.some((item) => item.valorUnitario !== '' && Number.isFinite(Number(item.quantidade)));

  async function salvar() {
    const dados = { fornecedorId, dataPedido, previsaoEntrega, observacoes, itens };
    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();
    const { error } = await supabase.rpc('criar_pedido', montarPayload(dados));

    setSalvando(false);

    if (error) {
      console.error('Erro ao criar pedido:', error);
      setErro(mensagemErro(error));
      return;
    }

    onCriado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Novo pedido a fornecedor</h3>

        {carregandoDados ? (
          <p>Carregando fornecedores e produtos...</p>
        ) : erroCarregamento ? (
          <p style={{ color: '#f44336' }}>{erroCarregamento}</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '15px' }}>
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
                {fornecedores.length === 0 && (
                  <p style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                    Nenhum fornecedor ativo com modalidade "pedido com entrega".
                  </p>
                )}
              </div>

              <div>
                <label style={rotuloEstilo}>Data do pedido *</label>
                <input
                  type="date"
                  value={dataPedido}
                  onChange={(e) => setDataPedido(e.target.value)}
                  style={campoEstilo}
                />
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

            {fornecedorId && regrasAplicaveis.length === 0 && (
              <p style={{ fontSize: '13px', color: '#999', marginBottom: '15px' }}>
                Nenhuma regra de pedido cadastrada para este fornecedor neste dia da semana — informe a previsão
                manualmente.
              </p>
            )}

            {fornecedorId && regrasAplicaveis.length === 1 && (
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
                Previsão sugerida por regra cadastrada: {descreverRegra(regrasAplicaveis[0])}. Você pode ajustar a
                data acima manualmente.
              </p>
            )}

            {fornecedorId && regrasAplicaveis.length > 1 && (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {itens.map((item, indice) => {
                  const chave = chavesItens.current[indice];
                  return (
                    <div
                      key={chave}
                      style={{ backgroundColor: '#f9f9f9', padding: '12px', borderRadius: '5px' }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '8px' }}>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Descrição *</label>
                          <input
                            type="text"
                            value={item.descricao}
                            onChange={(e) => atualizarItem(chave, { descricao: e.target.value })}
                            placeholder="Ex.: Farinha de trigo tipo 1"
                            style={{ ...campoEstilo, fontSize: '13px' }}
                          />
                        </div>

                        <div>
                          <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Unidade *</label>
                          <input
                            type="text"
                            value={item.unidade}
                            onChange={(e) => atualizarItem(chave, { unidade: e.target.value })}
                            placeholder="kg, pacote, un..."
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
                          <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Valor unitário</label>
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

                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ ...rotuloEstilo, fontSize: '12px' }}>Produto do catálogo (opcional)</label>
                        <BuscaProduto item={item} produtos={produtos} corPrimaria={corPrimaria} onAlterarItem={(alt) => atualizarItem(chave, alt)} />
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
                Total (derivado dos itens):{' '}
                <strong>{algumItemComValor ? formatarMoeda(totalDerivado) : '—'}</strong>
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
            {salvando ? 'Salvando...' : 'Criar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
