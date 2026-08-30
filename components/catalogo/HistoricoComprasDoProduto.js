import { useState } from 'react';
import LancarCompraForm from './LancarCompraForm';
import { BotaoIconeAcao, IconeLapis, IconeLixeira } from '../producao/IconesAcoes';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import { createClient } from '../../lib/supabase/client';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Card "Histórico de compras" de /catalogo/[id]. `lancamentos` já vem
// carregado pela página (ver comentário em FornecedoresDoProduto.js
// sobre a mesma decisão). "Editar" só aparece para origem='manual' --
// linhas origem='recebimento_pedido' (Fase C, nenhuma existe ainda) são
// somente leitura por desenho do banco (trigger
// produtos_historico_compras_protecao, migration 0023), então nem
// tentamos oferecer editar para elas aqui.
export default function HistoricoComprasDoProduto({ produtoId, lancamentos, configuracoesComerciais, fornecedoresAtivos, podeEditar, corPrimaria = '#8B4513', onRecarregar }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [lancamentoEmEdicao, setLancamentoEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  const [lancamentoParaExcluir, setLancamentoParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  function abrirNovoLancamento() {
    setLancamentoEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicaoLancamento(lancamento) {
    setLancamentoEmEdicao(lancamento);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setLancamentoEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = lancamentoEmEdicao != null;
    fecharModal();
    setMensagemSucesso(estaEditando ? 'Lançamento atualizado com sucesso.' : 'Compra lançada com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  function pedirExclusao(lancamento) {
    setErroExclusao('');
    setLancamentoParaExcluir(lancamento);
  }

  function cancelarExclusao() {
    setLancamentoParaExcluir(null);
    setErroExclusao('');
  }

  // Única forma permitida de excluir: a RPC excluir_historico_compra_manual
  // (migration 0025) -- SECURITY DEFINER, RPC-only, e a UNICA camada que
  // garante origem='manual' (a tabela não tem policy de DELETE nenhuma).
  // Nunca .from('produtos_historico_compras').delete(). onRecarregar()
  // recarrega tanto esta lista quanto o Resumo de preços (mesmo
  // recarregarTick da página) -- última compra/menor preço refletem a
  // exclusão sem F5.
  async function confirmarExclusao() {
    setExcluindo(true);
    setErroExclusao('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_historico_compra_manual', {
      p_historico_id: lancamentoParaExcluir.id,
    });

    setExcluindo(false);

    if (error) {
      console.error('Erro ao excluir lançamento de compra:', error);
      setErroExclusao('Não foi possível excluir este lançamento. Tente novamente ou avise um administrador.');
      return;
    }

    setLancamentoParaExcluir(null);
    setMensagemSucesso('Lançamento excluído com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>Histórico de compras</h3>

        {podeEditar && (
          <button
            type="button"
            onClick={abrirNovoLancamento}
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
            + Lançar compra
          </button>
        )}
      </div>

      {mensagemSucesso && <p style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>{mensagemSucesso}</p>}

      {lancamentos.length === 0 ? (
        <p style={{ color: '#666' }}>Nenhuma compra registrada para este produto.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Data</th>
                <th style={{ padding: '8px' }}>Fornecedor</th>
                <th style={{ padding: '8px' }}>Unidade</th>
                <th style={{ padding: '8px' }}>Quantidade</th>
                <th style={{ padding: '8px' }}>Preço unitário</th>
                <th style={{ padding: '8px' }}>Preço-base</th>
                <th style={{ padding: '8px' }}>Origem</th>
                <th style={{ padding: '8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {lancamentos.map((lancamento) => (
                <tr key={lancamento.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px' }}>{formatarData(lancamento.data_compra)}</td>
                  <td style={{ padding: '8px' }}>{lancamento.fornecedorNome}</td>
                  <td style={{ padding: '8px' }}>{lancamento.unidade_comercial}</td>
                  <td style={{ padding: '8px' }}>{lancamento.quantidade_comercial}</td>
                  <td style={{ padding: '8px' }}>{formatarMoeda(lancamento.preco_unitario_comercial)}</td>
                  <td style={{ padding: '8px' }}>
                    {lancamento.preco_unitario_base != null ? formatarMoeda(lancamento.preco_unitario_base) : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {lancamento.origem === 'manual' ? 'Manual' : 'Recebimento'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {podeEditar && lancamento.origem === 'manual' && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <BotaoIconeAcao
                          rotulo="Editar lançamento"
                          icone={IconeLapis}
                          cor={corPrimaria}
                          onClick={() => abrirEdicaoLancamento(lancamento)}
                        />
                        <BotaoIconeAcao
                          rotulo="Excluir lançamento"
                          icone={IconeLixeira}
                          destrutivo
                          onClick={() => pedirExclusao(lancamento)}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <LancarCompraForm
          produtoId={produtoId}
          fornecedoresAtivos={fornecedoresAtivos}
          configuracoesComerciais={configuracoesComerciais}
          lancamento={lancamentoEmEdicao}
          corPrimaria={corPrimaria}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
        />
      )}

      {lancamentoParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir lançamento de compra"
          mensagem={
            <>
              Tem certeza que deseja excluir a compra de <strong>{formatarData(lancamentoParaExcluir.data_compra)}</strong> —{' '}
              <strong>{lancamentoParaExcluir.fornecedorNome}</strong>, {formatarMoeda(lancamentoParaExcluir.preco_unitario_comercial)} /{' '}
              {lancamentoParaExcluir.unidade_comercial}?
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
