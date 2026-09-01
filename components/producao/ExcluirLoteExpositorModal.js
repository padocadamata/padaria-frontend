import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { mensagemErroLoteExpositor } from '../../lib/producao/mensagensExpositor';

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
  maxWidth: '440px',
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', color: '#666', fontSize: '12px' };
const valorEstilo = { fontSize: '15px', marginBottom: '10px' };

const campoEstilo = {
  width: '100%',
  padding: '10px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '16px',
  minHeight: '80px',
  fontFamily: 'Arial',
};

// Exclusão definitiva de um lote de expositor -- SOMENTE via RPC
// excluir_lote_expositor (migration 0030, exige producao_expositores.
// excluir + motivo obrigatorio + auditoria atomica antes do DELETE).
// Nunca .delete() direto. Permitida independente de status (mesmo lote
// já concluído) -- fluxo completamente separado da retirada operacional
// (concluir_retirada_expositor): "Retirado" nunca é simulado excluindo.
export default function ExcluirLoteExpositorModal({ lote, produtoNome, onExcluido, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    if (!motivo.trim()) {
      setErro('Informe o motivo da exclusão.');
      return;
    }

    setExcluindo(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_lote_expositor', {
      p_lote_id: lote.lote_id,
      p_motivo: motivo.trim(),
    });

    setExcluindo(false);

    if (error) {
      setErro(mensagemErroLoteExpositor(error));
      return;
    }

    onExcluido();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: '#f44336', marginTop: 0 }}>Excluir lote de expositor</h3>

        <div style={{ backgroundColor: '#f9f9f9', padding: '12px 15px', borderRadius: '5px', marginBottom: '15px' }}>
          <div style={rotuloEstilo}>Produto</div>
          <div style={valorEstilo}>{produtoNome}</div>

          <div style={rotuloEstilo}>Data de entrada</div>
          <div style={valorEstilo}>{lote.data_entrada}</div>

          <div style={rotuloEstilo}>Quantidade enviada</div>
          <div style={valorEstilo}>{lote.quantidade_enviada}</div>

          <div style={rotuloEstilo}>Situação</div>
          <div style={{ ...valorEstilo, marginBottom: 0 }}>
            {lote.concluido_em ? `Concluído (retirado: ${lote.quantidade_retirada})` : 'Ainda no expositor'}
          </div>
        </div>

        <p
          style={{
            backgroundColor: '#ffebee',
            color: '#c62828',
            padding: '10px 12px',
            borderRadius: '5px',
            fontSize: '13px',
            fontWeight: 'bold',
            marginBottom: '15px',
          }}
        >
          Esta ação remove definitivamente o lote e não pode ser desfeita. Use somente para lote cadastrado por
          engano -- para registrar que a mercadoria foi retirada, use o botão "Retirado", nunca a exclusão.
        </p>

        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Motivo da exclusão *</label>
        <textarea
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: lote criado para o produto errado."
          style={campoEstilo}
        />

        {erro && <p style={{ color: '#f44336', marginTop: '10px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onCancelar}
            disabled={excluindo}
            style={{ padding: '10px 20px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={excluindo || !motivo.trim()}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
              opacity: excluindo || !motivo.trim() ? 0.6 : 1,
            }}
          >
            {excluindo ? 'Excluindo...' : 'Excluir definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}
