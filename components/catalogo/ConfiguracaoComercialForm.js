import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

// Cria/edita uma linha de public.produto_fornecedores. Deliberadamente
// SEM nenhuma checagem de unicidade produto+fornecedor no frontend --
// o banco (migration 0023) não tem essa constraint de propósito: um
// fornecedor pode ter mais de uma configuração comercial para o mesmo
// produto (ex. "pacote 500g" e "caixa com 12 pacotes").
function estadoInicial(config) {
  return {
    fornecedor_id: config?.fornecedor_id || '',
    unidade_comercial: config?.unidade_comercial || '',
    apresentacao: config?.apresentacao || '',
    quantidade_embalagem: config?.quantidade_embalagem != null ? String(config.quantidade_embalagem) : '',
    codigo_produto_fornecedor: config?.codigo_produto_fornecedor || '',
    observacao: config?.observacao || '',
    ativo: config ? !!config.ativo : true,
    controla_sacos_fechados: config ? !!config.controla_sacos_fechados : false,
    peso_por_saco_kg: config?.peso_por_saco_kg != null ? String(config.peso_por_saco_kg) : '',
  };
}

function validar(dados, estaEditando) {
  if (!estaEditando && !dados.fornecedor_id) {
    return 'Selecione o fornecedor.';
  }
  if (!dados.unidade_comercial.trim()) {
    return 'Informe a unidade comercial.';
  }
  if (dados.quantidade_embalagem !== '') {
    const quantidade = Number(dados.quantidade_embalagem);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return 'Quantidade por embalagem deve ser maior que zero.';
    }
  }
  if (dados.controla_sacos_fechados) {
    const peso = Number(dados.peso_por_saco_kg);
    if (dados.peso_por_saco_kg === '' || !Number.isFinite(peso) || peso <= 0) {
      return 'Informe o peso por saco (kg), maior que zero.';
    }
  }
  return null;
}

// fornecedor_id/produto_id só entram no payload na criação -- a trigger
// produto_fornecedores_protecao (migration 0023) bloqueia alterá-los
// depois, então nem tentamos enviar no UPDATE.
function montarPayload(dados, produtoId, estaEditando) {
  const payload = {
    unidade_comercial: dados.unidade_comercial.trim(),
    apresentacao: dados.apresentacao.trim() || null,
    quantidade_embalagem: dados.quantidade_embalagem === '' ? null : Number(dados.quantidade_embalagem),
    codigo_produto_fornecedor: dados.codigo_produto_fornecedor.trim() || null,
    observacao: dados.observacao.trim() || null,
    controla_sacos_fechados: dados.controla_sacos_fechados,
    // Nulo quando desmarcado -- evita deixar um peso "fantasma" preenchido
    // atrás de uma configuração que não controla mais sacos fechados.
    peso_por_saco_kg: dados.controla_sacos_fechados ? Number(dados.peso_por_saco_kg) : null,
  };

  if (estaEditando) {
    payload.ativo = dados.ativo;
  } else {
    payload.produto_id = produtoId;
    payload.fornecedor_id = dados.fornecedor_id;
  }

  return payload;
}

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('produto_id e imutavel') || msg.includes('fornecedor_id e imutavel')) {
    return 'Não é possível trocar o fornecedor de uma configuração já existente — crie uma nova configuração em vez de editar esta.';
  }
  if (msg.includes('unidade_comercial')) {
    return 'Informe uma unidade comercial válida (não pode ficar em branco).';
  }
  if (msg.includes('quantidade_embalagem')) {
    return 'Quantidade por embalagem deve ser maior que zero.';
  }
  if (msg.includes('peso_por_saco_kg nao pode ser alterado')) {
    return 'Não é possível alterar o peso por saco: já existem movimentações de Sacos Fechados registradas para esta configuração. Cadastre uma nova configuração comercial se o peso do saco mudou.';
  }
  if (msg.includes('peso_saco_coerente') || msg.includes('controla_sacos_fechados')) {
    return 'Para controlar sacos fechados, informe o peso por saco (kg), maior que zero.';
  }

  console.error('Erro ao salvar configuração comercial:', error);
  return 'Não foi possível salvar esta configuração. Tente novamente ou avise um administrador.';
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
  maxWidth: '500px',
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

export default function ConfiguracaoComercialForm({ produtoId, produtoUnidadeMedida, fornecedoresAtivos, configuracao, corPrimaria = '#8B4513', onFechar, onSalvo }) {
  const estaEditando = configuracao != null;
  const [dados, setDados] = useState(() => estadoInicial(configuracao));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  // Sacos Fechados só opera sobre produtos cuja unidade-base seja KG
  // (validado de verdade no banco, em registrar_abertura_saco) -- aqui é
  // só um aviso informativo, não um bloqueio de formulário, para não
  // duplicar a validação real do lado do cliente.
  const unidadeNaoEhKg =
    !!produtoUnidadeMedida && produtoUnidadeMedida.trim().toUpperCase() !== 'KG';

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
      ? await supabase.from('produto_fornecedores').update(payload).eq('id', configuracao.id)
      : await supabase.from('produto_fornecedores').insert(payload);

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
        <h3 style={{ marginTop: 0 }}>
          {estaEditando ? 'Editar configuração comercial' : 'Nova configuração comercial'}
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Fornecedor {!estaEditando && '*'}</label>
          {estaEditando ? (
            <p style={{ margin: 0, fontSize: '14px' }}>{configuracao.fornecedorNome}</p>
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

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Unidade comercial *</label>
          <input
            type="text"
            value={dados.unidade_comercial}
            onChange={(e) => atualizarCampo('unidade_comercial', e.target.value)}
            placeholder="kg, pacote, caixa, fardo, peça..."
            style={campoEstilo}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Apresentação</label>
          <input
            type="text"
            value={dados.apresentacao}
            onChange={(e) => atualizarCampo('apresentacao', e.target.value)}
            placeholder='Opcional — ex.: "Caixa com 12 unidades"'
            style={campoEstilo}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Quantidade por embalagem</label>
          <input
            type="number"
            min="0"
            step="any"
            value={dados.quantidade_embalagem}
            onChange={(e) => atualizarCampo('quantidade_embalagem', e.target.value)}
            placeholder="Opcional — quantas unidades-base equivalem a 1 unidade comercial"
            style={campoEstilo}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Código do produto no fornecedor</label>
          <input
            type="text"
            value={dados.codigo_produto_fornecedor}
            onChange={(e) => atualizarCampo('codigo_produto_fornecedor', e.target.value)}
            placeholder="Opcional"
            style={campoEstilo}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Observação</label>
          <textarea
            value={dados.observacao}
            onChange={(e) => atualizarCampo('observacao', e.target.value)}
            style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial' }}
          />
        </div>

        <div style={{ marginBottom: '15px', backgroundColor: '#f9f9f9', padding: '12px', borderRadius: '5px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
            <input
              type="checkbox"
              checked={dados.controla_sacos_fechados}
              onChange={(e) => atualizarCampo('controla_sacos_fechados', e.target.checked)}
            />
            Controlar sacos fechados
          </label>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '6px', marginBottom: dados.controla_sacos_fechados ? '10px' : 0 }}>
            Sacos Fechados (Produção) só funciona para produtos cuja unidade-base seja KG.
            {unidadeNaoEhKg && (
              <strong style={{ color: '#e65100' }}>
                {' '}
                Este produto está cadastrado com unidade-base "{produtoUnidadeMedida}" — abrir sacos desta
                configuração será rejeitado pelo sistema até a unidade do produto ser KG.
              </strong>
            )}
          </p>

          {dados.controla_sacos_fechados && (
            <div>
              <label style={rotuloEstilo}>Peso por saco (kg) *</label>
              <input
                type="number"
                min="0"
                step="any"
                value={dados.peso_por_saco_kg}
                onChange={(e) => atualizarCampo('peso_por_saco_kg', e.target.value)}
                placeholder="Ex.: 8"
                style={campoEstilo}
              />
              {estaEditando && configuracao?.controla_sacos_fechados && (
                <p style={{ fontSize: '11px', color: '#999', marginTop: '4px', marginBottom: 0 }}>
                  Se já existir alguma movimentação de sacos fechados para esta configuração, o banco impede
                  alterar este peso — cadastre uma nova configuração comercial nesse caso.
                </p>
              )}
            </div>
          )}
        </div>

        {estaEditando && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={dados.ativo}
                onChange={(e) => atualizarCampo('ativo', e.target.checked)}
              />
              Configuração ativa
            </label>
          </div>
        )}

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
