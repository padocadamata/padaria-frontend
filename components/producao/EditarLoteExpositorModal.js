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

// Correção de um lote AINDA NÃO concluído (data_entrada/quantidade_enviada)
// -- via RPC editar_lote_expositor (migration 0030), nunca UPDATE direto.
// Lote já concluído usa CorrigirLoteExpositorConcluidoModal, nunca este.
export default function EditarLoteExpositorModal({ lote, produtoNome, corPrimaria, onEditado, onCancelar }) {
  const [dataEntrada, setDataEntrada] = useState(lote.data_entrada);
  const [quantidadeEnviada, setQuantidadeEnviada] = useState(String(lote.quantidade_enviada));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const quantidadeNum = quantidadeEnviada !== '' ? parseInt(quantidadeEnviada, 10) : null;
  const valido = !!dataEntrada && Number.isInteger(quantidadeNum) && quantidadeNum > 0;

  async function confirmar() {
    if (!valido) {
      setErro('Informe a data de entrada e uma quantidade enviada maior que zero.');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.rpc('editar_lote_expositor', {
      p_lote_id: lote.lote_id,
      p_data_entrada: dataEntrada,
      p_quantidade_enviada: quantidadeNum,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErroLoteExpositor(error));
      return;
    }

    onEditado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Editar lote -- {produtoNome}</h3>

        <p style={{ color: '#666', fontSize: '13px' }}>
          A data prevista de retirada é recalculada automaticamente (data de entrada + prazo do produto).
        </p>

        <label style={rotuloEstilo}>Data de entrada no expositor *</label>
        <input
          type="date"
          autoFocus
          value={dataEntrada}
          onChange={(e) => setDataEntrada(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Quantidade enviada *</label>
        <input
          type="number"
          min="1"
          value={quantidadeEnviada}
          onChange={(e) => setQuantidadeEnviada(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '15px' }}
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
            disabled={salvando || !valido}
            style={{
              padding: '10px 20px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
              opacity: salvando || !valido ? 0.6 : 1,
            }}
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
