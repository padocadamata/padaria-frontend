import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import Modal from '../ui/Modal';

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';
  if (msg.includes('motivo e obrigatorio')) {
    return 'Informe o motivo da reabertura.';
  }
  if (msg.includes('nao encontrado') || msg.includes('nao esta status=fechado')) {
    return 'Este registro não está mais disponível para reabertura — atualize a página.';
  }
  if (msg.includes('producao.cancelar')) {
    return 'Você não tem permissão para reabrir este registro.';
  }
  if (msg.includes('administrador')) {
    return 'Reabrir um registro histórico exige um administrador.';
  }
  return 'Não foi possível reabrir o registro. Tente novamente ou avise um administrador.';
}

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

// Modal de reabertura. Usa exclusivamente a RPC
// public.reabrir_producao_registro — nunca um UPDATE direto de status no
// frontend, porque essa RPC muda status E grava a auditoria na mesma
// transação (se o log falhar, a reabertura inteira falha junto).
export default function ReaberturaModal({ registro, receitaNome, turnoLabel, corPrimaria, onReaberto, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    if (!motivo.trim()) {
      setErro('Informe o motivo da reabertura.');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.rpc('reabrir_producao_registro', {
      p_registro_id: registro.id,
      p_motivo: motivo.trim(),
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    onReaberto();
  }

  return (
    <Modal onFechar={onCancelar} largura="sm" legado>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          Reabrir registro — {receitaNome} ({turnoLabel})
        </h3>

        <p style={{ color: '#666', fontSize: '14px' }}>
          O registro volta para edição, preservando os valores atuais. Você vai poder corrigir e fechar de novo em seguida.
        </p>

        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          Motivo da reabertura *
        </label>
        <textarea
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: quantidade produzida lançada errada, corrigir de 150 para 175."
          style={campoEstilo}
        />

        {erro && <p style={{ color: '#f44336', marginTop: '10px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onCancelar}
            disabled={salvando}
            style={{ padding: '10px 20px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={salvando}
            style={{ padding: '10px 20px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {salvando ? 'Reabrindo...' : 'Reabrir'}
          </button>
        </div>
    </Modal>
  );
}
