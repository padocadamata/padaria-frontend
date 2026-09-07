import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { mensagemErroSacos, TIPO_MOVIMENTO_LABEL } from '../../lib/producao/mensagensSacos';

// Exclusão FÍSICA de uma movimentação manual (abertura/ajuste_manual/
// saldo_inicial -- entradas automáticas de pedido nunca chegam aqui, a
// própria RPC rejeita). Único caminho é a RPC excluir_movimentacao_saco
// (SECURITY DEFINER, migration 0050) -- nunca DELETE direto (sem policy
// de DELETE de propósito). Motivo obrigatório: a RPC rejeita string
// vazia/só espaço. A RPC já valida que a exclusão não deixa o saldo
// negativo e sincroniza a movimentação de estoque vinculada (quando
// houver) na mesma transação -- este modal só coleta o motivo e mostra o
// erro amigável que a RPC devolver.
export default function ExcluirMovimentacaoSacoModal({ movimentacao, corPrimaria = '#8B4513', onExcluido, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');

  const motivoValido = motivo.trim() !== '';

  async function confirmar() {
    if (!motivoValido) {
      setErro('Informe o motivo da exclusão.');
      return;
    }

    setExcluindo(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_movimentacao_saco', {
      p_movimentacao_id: movimentacao.id,
      p_motivo: motivo.trim(),
    });

    setExcluindo(false);

    if (error) {
      setErro(mensagemErroSacos(error));
      return;
    }

    onExcluido();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: '#c62828', marginTop: 0 }}>
          Excluir movimentação -- {TIPO_MOVIMENTO_LABEL[movimentacao.tipo] || movimentacao.tipo}
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <div style={rotuloEstilo}>Produto / fornecedor</div>
          <p style={{ margin: 0 }}>
            {movimentacao.produtoNome} — {movimentacao.fornecedorNome}
          </p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <div style={rotuloEstilo}>Quantidade</div>
          <p style={{ margin: 0 }}>
            {Math.abs(movimentacao.quantidade_sacos)} saco(s) — {movimentacao.kg?.toLocaleString('pt-BR')} kg
          </p>
        </div>

        <p style={{ backgroundColor: '#fff3e0', color: '#e65100', padding: '10px', borderRadius: '5px', fontSize: '13px', marginBottom: '15px' }}>
          Esta ação remove a movimentação definitivamente (e a movimentação de estoque vinculada, se houver). Não pode ser desfeita — uma trilha de auditoria fica registrada.
        </p>

        <label style={rotuloEstilo}>Motivo da exclusão *</label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Explique por que esta movimentação está sendo excluída"
          autoFocus
          style={{ ...campoEstilo, minHeight: '70px', fontFamily: 'Arial', marginBottom: '15px' }}
        />

        {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancelar}
            disabled={excluindo}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: excluindo ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={excluindo || !motivoValido}
            style={{
              padding: '10px 20px',
              backgroundColor: '#c62828',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: excluindo || !motivoValido ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              opacity: excluindo || !motivoValido ? 0.6 : 1,
            }}
          >
            {excluindo ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
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
  maxWidth: '420px',
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' };

const campoEstilo = {
  width: '100%',
  padding: '10px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '16px',
};
