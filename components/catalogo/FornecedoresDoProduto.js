import { useState } from 'react';
import ConfiguracaoComercialForm from './ConfiguracaoComercialForm';

// Card "Fornecedores" de /catalogo/[id]. Diferente de
// FornecedorRegras.js (que busca seus próprios dados por fornecedorId),
// este componente recebe `configuracoes` já carregado pela página --
// HistoricoComprasDoProduto precisa da mesma lista (para o preenchimento
// opcional em LancarCompraForm), então a busca fica centralizada em
// pages/catalogo/[id].js para não duplicar a query nem arriscar as duas
// listas ficarem dessincronizadas entre si.
export default function FornecedoresDoProduto({ produtoId, configuracoes, fornecedoresAtivos, podeEditar, corPrimaria = '#8B4513', onRecarregar }) {
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [configEmEdicao, setConfigEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  function abrirNovaConfiguracao() {
    setConfigEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicaoConfiguracao(config) {
    setConfigEmEdicao(config);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setConfigEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = configEmEdicao != null;
    fecharModal();
    setMensagemSucesso(estaEditando ? 'Configuração atualizada com sucesso.' : 'Configuração cadastrada com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  const configuracoesVisiveis = mostrarInativas ? configuracoes : configuracoes.filter((c) => c.ativo);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>Fornecedores</h3>

        {podeEditar && (
          <button
            type="button"
            onClick={abrirNovaConfiguracao}
            style={{
              padding: '8px 16px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
            }}
          >
            + Nova configuração
          </button>
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '14px' }}>
        <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} />
        Mostrar configurações inativas
      </label>

      {mensagemSucesso && <p style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>{mensagemSucesso}</p>}

      {configuracoesVisiveis.length === 0 ? (
        <p style={{ color: '#666' }}>Nenhum fornecedor cadastrado para este produto.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {configuracoesVisiveis.map((config) => (
            <div
              key={config.id}
              style={{
                backgroundColor: '#f9f9f9',
                padding: '10px 15px',
                borderRadius: '5px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold' }}>
                  {config.fornecedorNome} — {config.unidade_comercial}
                  {config.apresentacao ? ` (${config.apresentacao})` : ''}
                  {!config.ativo && (
                    <span
                      style={{
                        marginLeft: '8px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        color: 'white',
                        backgroundColor: '#9e9e9e',
                      }}
                    >
                      Inativa
                    </span>
                  )}
                </div>

                {config.quantidade_embalagem != null && (
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    1 {config.unidade_comercial} = {config.quantidade_embalagem} unidade(s)-base
                  </div>
                )}

                {config.codigo_produto_fornecedor && (
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    Código no fornecedor: {config.codigo_produto_fornecedor}
                  </div>
                )}

                {config.observacao && (
                  <div style={{ fontSize: '13px', color: '#666', fontStyle: 'italic' }}>{config.observacao}</div>
                )}
              </div>

              {podeEditar && (
                <button
                  type="button"
                  onClick={() => abrirEdicaoConfiguracao(config)}
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
                  Editar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modalAberto && (
        <ConfiguracaoComercialForm
          produtoId={produtoId}
          fornecedoresAtivos={fornecedoresAtivos}
          configuracao={configEmEdicao}
          corPrimaria={corPrimaria}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
        />
      )}
    </div>
  );
}
