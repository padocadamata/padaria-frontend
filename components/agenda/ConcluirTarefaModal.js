import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

// Mesmo limite validado no backend (trigger agenda_itens_protecao /
// agenda_ocorrencias_protecao, migration 0039) -- mantido em sincronia
// manualmente, mesmo padrão das demais constantes espelhadas entre
// frontend/backend na Agenda (ver expandirRecorrencia.js).
const LIMITE_OBSERVACAO = 200;

const overlayEstilo = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000, padding: '20px',
};
const caixaEstilo = {
  backgroundColor: 'white', padding: '25px', borderRadius: '10px',
  maxWidth: '420px', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};
const botaoEstilo = (cor) => ({
  padding: '8px 14px', backgroundColor: cor, color: 'white', border: 'none',
  borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
});
const campoEstilo = {
  width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px',
  boxSizing: 'border-box', fontSize: '14px',
};

// Modal reutilizável para concluir UMA tarefa -- avulsa (agenda_itens) ou
// UMA ocorrência de tarefa recorrente (agenda_ocorrencias, identidade
// agenda_item_id + data_ocorrencia ORIGINAL, nunca a série). Chamado
// tanto pelo checkbox do calendário (AgendaCalendario.js) quanto pelo
// botão "Concluir" de AgendaItemDetalheModal.js -- mesmo fluxo único,
// para nunca existir conclusão sem observação por outro caminho da UI.
export default function ConcluirTarefaModal({ ocorrencia, onFechar, onConcluido }) {
  const [observacao, setObservacao] = useState('');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');

  if (!ocorrencia) return null;

  const recorrente = ocorrencia.item.tipo_recorrencia !== 'nenhuma';

  async function confirmar() {
    const texto = observacao.trim();
    if (!texto) {
      setErro('Informe o nome/observação da conclusão.');
      return;
    }
    setProcessando(true);
    setErro('');
    const supabase = createClient();

    const { error } = recorrente
      ? await supabase.rpc('concluir_ocorrencia_agenda', {
          p_agenda_item_id: ocorrencia.item.id,
          p_data_ocorrencia: ocorrencia.dataOcorrencia,
          p_observacao_conclusao: texto,
        })
      : await supabase.rpc('concluir_tarefa_agenda', {
          p_item_id: ocorrencia.item.id,
          p_observacao_conclusao: texto,
        });

    setProcessando(false);
    if (error) {
      setErro('Não foi possível concluir. Tente novamente.');
      return;
    }
    onConcluido();
  }

  function aoTeclar(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!processando) confirmar();
    }
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ marginTop: 0 }}>Concluir tarefa</h3>
        <p style={{ fontSize: '13px', color: '#666' }}>{ocorrencia.titulo}</p>

        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          Nome / observação da conclusão *
        </label>
        <input
          type="text"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          onKeyDown={aoTeclar}
          maxLength={LIMITE_OBSERVACAO}
          placeholder="Ex.: Maria - concluído sem pendências"
          style={campoEstilo}
          autoFocus
        />
        <p style={{ fontSize: '11px', color: '#999', margin: '4px 0 12px' }}>
          {observacao.length}/{LIMITE_OBSERVACAO}
        </p>

        {erro && <p style={{ color: '#f44336' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onFechar} disabled={processando} style={botaoEstilo('#999')}>Cancelar</button>
          <button onClick={confirmar} disabled={processando} style={botaoEstilo('#4CAF50')}>
            {processando ? 'Concluindo...' : 'Concluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
