import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';

// Cria um lançamento manual em public.produtos_historico_compras, ou
// corrige um já existente -- SOMENTE origem='manual' (a página que
// renderiza este form já garante isso: nunca passa um `lancamento` com
// origem='recebimento_pedido' para edição). produto_id/fornecedor_id/
// origem nunca vão no payload de UPDATE -- a trigger
// produtos_historico_compras_protecao (migration 0023) bloqueia os três.
function estadoInicial(lancamento) {
  return {
    fornecedor_id: lancamento?.fornecedor_id || '',
    unidade_comercial: lancamento?.unidade_comercial || '',
    quantidade_comercial: lancamento?.quantidade_comercial != null ? String(lancamento.quantidade_comercial) : '',
    preco_unitario_comercial: lancamento?.preco_unitario_comercial != null ? String(lancamento.preco_unitario_comercial) : '',
    fator_conversao_base: lancamento?.fator_conversao_base != null ? String(lancamento.fator_conversao_base) : '',
    data_compra: lancamento?.data_compra || dataLocalHoje(),
    observacao: lancamento?.observacao || '',
  };
}

function validar(dados, estaEditando) {
  if (!estaEditando && !dados.fornecedor_id) {
    return 'Selecione o fornecedor.';
  }
  if (!dados.unidade_comercial.trim()) {
    return 'Informe a unidade comercial.';
  }
  const quantidade = Number(dados.quantidade_comercial);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return 'Quantidade deve ser maior que zero.';
  }
  const preco = Number(dados.preco_unitario_comercial);
  if (!Number.isFinite(preco) || preco < 0) {
    return 'Informe um preço unitário válido.';
  }
  if (dados.fator_conversao_base !== '') {
    const fator = Number(dados.fator_conversao_base);
    if (!Number.isFinite(fator) || fator <= 0) {
      return 'Fator de conversão deve ser maior que zero.';
    }
  }
  if (!dados.data_compra) {
    return 'Informe a data da compra.';
  }
  return null;
}

// fornecedor_id/produto_id/origem só entram no payload na criação -- ver
// comentário de cabeçalho acima.
function montarPayload(dados, produtoId, estaEditando) {
  const payload = {
    unidade_comercial: dados.unidade_comercial.trim(),
    quantidade_comercial: Number(dados.quantidade_comercial),
    preco_unitario_comercial: Number(dados.preco_unitario_comercial),
    fator_conversao_base: dados.fator_conversao_base === '' ? null : Number(dados.fator_conversao_base),
    data_compra: dados.data_compra,
    observacao: dados.observacao.trim() || null,
  };

  if (!estaEditando) {
    payload.produto_id = produtoId;
    payload.fornecedor_id = dados.fornecedor_id;
    payload.origem = 'manual';
  }

  return payload;
}

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('nao pode ser editado pelo Catalogo')) {
    return 'Este lançamento não pode mais ser editado por aqui (deixou de ser um lançamento manual).';
  }
  if (msg.includes('e imutavel')) {
    return 'Não é possível alterar este campo depois que o lançamento foi criado.';
  }
  if (error.code === '23514') {
    if (msg.includes('quantidade_comercial')) return 'Quantidade deve ser maior que zero.';
    if (msg.includes('preco_comercial')) return 'Preço unitário não pode ser negativo.';
    if (msg.includes('fator_conversao')) return 'Fator de conversão deve ser maior que zero.';
    if (msg.includes('unidade_comercial')) return 'Informe a unidade comercial.';
    return 'Um dos valores não passou na validação do banco.';
  }

  console.error('Erro ao salvar lançamento de compra:', error);
  return 'Não foi possível salvar este lançamento. Tente novamente ou avise um administrador.';
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
  maxWidth: '520px',
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

export default function LancarCompraForm({ produtoId, fornecedoresAtivos, configuracoesComerciais, lancamento, corPrimaria = '#8B4513', onFechar, onSalvo }) {
  const estaEditando = lancamento != null;
  const [dados, setDados] = useState(() => estadoInicial(lancamento));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  // Preenchimento OPCIONAL a partir de uma configuração já cadastrada em
  // produto_fornecedores -- só copia valores para os campos deste
  // formulário, sem criar nenhum vínculo/FK entre o lançamento e a
  // configuração escolhida (produtos_historico_compras não tem essa
  // coluna, de propósito -- ver comentário da migration 0023).
  function preencherDeConfiguracao(configId) {
    if (!configId) return;
    const config = configuracoesComerciais.find((c) => c.id === configId);
    if (!config) return;

    setDados((atual) => ({
      ...atual,
      fornecedor_id: config.fornecedor_id,
      unidade_comercial: config.unidade_comercial,
      fator_conversao_base: config.quantidade_embalagem != null ? String(config.quantidade_embalagem) : atual.fator_conversao_base,
    }));
  }

  async function salvar() {
    const mensagemValidacao = validar(dados, estaEditando);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();
    const payload = montarPayload(dados, produtoId, estaEditando);

    const resultado = estaEditando
      ? await supabase.from('produtos_historico_compras').update(payload).eq('id', lancamento.id)
      : await supabase.from('produtos_historico_compras').insert(payload);

    setSalvando(false);

    if (resultado.error) {
      setErro(mensagemErro(resultado.error));
      return;
    }

    onSalvo();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ marginTop: 0 }}>{estaEditando ? 'Editar lançamento de compra' : 'Lançar compra'}</h3>

        {!estaEditando && configuracoesComerciais.length > 0 && (
          <div style={{ marginBottom: '15px' }}>
            <label style={rotuloEstilo}>Usar configuração cadastrada (opcional)</label>
            <select
              defaultValue=""
              onChange={(e) => preencherDeConfiguracao(e.target.value)}
              style={campoEstilo}
            >
              <option value="">Preencher manualmente</option>
              {configuracoesComerciais.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fornecedorNome} — {c.unidade_comercial}
                  {c.apresentacao ? ` (${c.apresentacao})` : ''}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '12px', color: '#999', marginTop: '4px', marginBottom: 0 }}>
              Só preenche os campos abaixo — não cria nenhum vínculo entre este lançamento e a configuração.
            </p>
          </div>
        )}

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Fornecedor {!estaEditando && '*'}</label>
          {estaEditando ? (
            <p style={{ margin: 0, fontSize: '14px' }}>{lancamento.fornecedorNome}</p>
          ) : (
            <select
              value={dados.fornecedor_id}
              onChange={(e) => atualizarCampo('fornecedor_id', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Selecione</option>
              {fornecedoresAtivos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '15px' }}>
          <div>
            <label style={rotuloEstilo}>Data da compra *</label>
            <input
              type="date"
              value={dados.data_compra}
              onChange={(e) => atualizarCampo('data_compra', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Unidade comercial *</label>
            <input
              type="text"
              value={dados.unidade_comercial}
              onChange={(e) => atualizarCampo('unidade_comercial', e.target.value)}
              placeholder="kg, pacote, caixa..."
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Quantidade *</label>
            <input
              type="number"
              min="0"
              step="any"
              value={dados.quantidade_comercial}
              onChange={(e) => atualizarCampo('quantidade_comercial', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Preço unitário comercial *</label>
            <input
              type="number"
              min="0"
              step="any"
              value={dados.preco_unitario_comercial}
              onChange={(e) => atualizarCampo('preco_unitario_comercial', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Fator de conversão p/ unidade-base</label>
            <input
              type="number"
              min="0"
              step="any"
              value={dados.fator_conversao_base}
              onChange={(e) => atualizarCampo('fator_conversao_base', e.target.value)}
              placeholder="Ex.: caixa com 12 unidades → 12"
              style={campoEstilo}
            />
          </div>
        </div>
        <p style={{ fontSize: '12px', color: '#999', marginTop: '-8px', marginBottom: '15px' }}>
          Quantas unidades-base do produto equivalem a 1 unidade comercial <strong>desta compra específica</strong>.
          Exemplo: unidade-base "UN", comprou uma caixa com 12 unidades por R$ 60,00 → fator = 12 (o preço-base sai
          R$ 5,00/UN). Sem esse valor, a compra continua registrada, mas não entra na comparação de preço-base —
          não existe caminho para "inventar" esse número.
        </p>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Observação</label>
          <textarea
            value={dados.observacao}
            onChange={(e) => atualizarCampo('observacao', e.target.value)}
            style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial' }}
          />
        </div>

        {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onFechar}
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
            disabled={salvando}
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
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
