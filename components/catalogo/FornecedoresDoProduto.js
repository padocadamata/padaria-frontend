import { useState } from 'react';
import ConfiguracaoComercialForm from './ConfiguracaoComercialForm';
import { BotaoIconeAcao, IconeLapis, IconeLixeira } from '../producao/IconesAcoes';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import { createClient } from '../../lib/supabase/client';

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

  const [configParaExcluir, setConfigParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

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

  function pedirExclusao(config) {
    setErroExclusao('');
    setConfigParaExcluir(config);
  }

  function cancelarExclusao() {
    setConfigParaExcluir(null);
    setErroExclusao('');
  }

  // Única forma permitida de excluir: a RPC excluir_produto_fornecedor
  // (migration 0025) -- SECURITY DEFINER, RPC-only por desenho (a tabela
  // não tem nenhuma policy de DELETE). Nunca .from('produto_fornecedores').delete().
  async function confirmarExclusao() {
    setExcluindo(true);
    setErroExclusao('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_produto_fornecedor', {
      p_produto_fornecedor_id: configParaExcluir.id,
    });

    setExcluindo(false);

    if (error) {
      console.error('Erro ao excluir configuração comercial:', error);
      setErroExclusao('Não foi possível excluir esta configuração. Tente novamente ou avise um administrador.');
      return;
    }

    setConfigParaExcluir(null);
    setMensagemSucesso('Configuração excluída com sucesso.');
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
                <div style={{ display: 'flex', gap: '4px' }}>
                  <BotaoIconeAcao
                    rotulo="Editar configuração"
                    icone={IconeLapis}
                    cor={corPrimaria}
                    onClick={() => abrirEdicaoConfiguracao(config)}
                  />
                  <BotaoIconeAcao
                    rotulo="Excluir configuração"
                    icone={IconeLixeira}
                    destrutivo
                    onClick={() => pedirExclusao(config)}
                  />
                </div>
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

      {configParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir configuração comercial"
          mensagem={
            <>
              Tem certeza que deseja excluir a configuração <strong>{configParaExcluir.fornecedorNome} — {configParaExcluir.unidade_comercial}
              {configParaExcluir.apresentacao ? ` (${configParaExcluir.apresentacao})` : ''}</strong>?
              <br />
              Esta ação é definitiva e não pode ser desfeita.
            </>
          }
          corPrimaria={corPrimaria}
          perigo
          textoConfirmar="Excluir"
          confirmando={excluindo}
          erro={erroExclusao}
          onConfirmar={confirmarExclusao}
          onCancelar={cancelarExclusao}
        />
      )}
    </div>
  );
}
