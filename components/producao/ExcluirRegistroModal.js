import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('exclusao definitiva de producao requer administrador')) {
    return 'Você não tem permissão para excluir este lançamento.';
  }
  if (msg.includes('motivo e obrigatorio')) {
    return 'Informe o motivo da exclusão.';
  }
  if (msg.includes('nao encontrado')) {
    return 'Este registro não está mais disponível — atualize a página.';
  }
  return 'Não foi possível excluir o lançamento. Tente novamente ou avise um administrador.';
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
  maxWidth: '460px',
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

// Exclusão definitiva de um registro de producao_registros — só
// proprietario_admin (gate feito no chamador, em historico.js). Nunca faz
// DELETE direto: chama exclusivamente a RPC excluir_producao_registro
// (migration 0020), que carrega o registro, grava o snapshot completo em
// logs_auditoria e só então exclui, tudo na mesma transação. Motivo
// obrigatório, aviso forte de irreversibilidade — não há desfazer.
export default function ExcluirRegistroModal({ registro, receitaNome, turnoLabel, onExcluido, onCancelar }) {
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
    const { error } = await supabase.rpc('excluir_producao_registro', {
      p_registro_id: registro.id,
      p_motivo: motivo.trim(),
    });

    setExcluindo(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    onExcluido();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: '#f44336', marginTop: 0 }}>Excluir lançamento definitivamente</h3>

        <div
          style={{
            backgroundColor: '#f9f9f9',
            padding: '12px 15px',
            borderRadius: '5px',
            marginBottom: '15px',
          }}
        >
          <div style={rotuloEstilo}>Data</div>
          <div style={valorEstilo}>{registro.data}</div>

          <div style={rotuloEstilo}>Produto</div>
          <div style={valorEstilo}>{receitaNome}</div>

          <div style={rotuloEstilo}>Turno</div>
          <div style={valorEstilo}>{turnoLabel}</div>

          <div style={rotuloEstilo}>Quantidade produzida</div>
          <div style={valorEstilo}>{registro.quantidade_produzida}</div>

          <div style={rotuloEstilo}>Quantidade vendida</div>
          <div style={valorEstilo}>{registro.quantidade_vendida ?? '—'}</div>

          <div style={rotuloEstilo}>Sobra total</div>
          <div style={valorEstilo}>{registro.sobra_total ?? '—'}</div>

          <div style={rotuloEstilo}>Status</div>
          <div style={valorEstilo}>{registro.status}</div>

          <div style={rotuloEstilo}>Origem</div>
          <div style={{ ...valorEstilo, marginBottom: 0 }}>{registro.origem}</div>
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
          Esta ação remove definitivamente o lançamento de produção e não pode ser desfeita.
        </p>

        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          Motivo da exclusão *
        </label>
        <textarea
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: lançamento feito por engano em data/turno errado, não houve produção nesse turno."
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
