import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

function mensagemErro(error) {
  if (!error) return '';
  if (error.code === '23505') {
    return 'Este turno já tem produção lançada. Atualize a página.';
  }
  return 'Não foi possível iniciar a produção. Tente novamente ou avise um administrador.';
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
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '360px',
  width: '90%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const campoEstilo = {
  width: '100%',
  padding: '10px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '16px',
};

// Modal de "Iniciar produção": pede só a quantidade produzida e cria o
// registro do turno (origem='manual', status='aberto'). Os campos de
// fechamento ficam NULL por default do schema — não são tocados aqui.
export default function IniciarProducaoForm({ data, turno, receitaId, receitaNome, turnoLabel, corPrimaria, onCriado, onCancelar }) {
  const [quantidade, setQuantidade] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    const valor = parseInt(quantidade, 10);
    if (!Number.isInteger(valor) || valor <= 0) {
      setErro('Informe uma quantidade maior que zero.');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.from('producao_registros').insert({
      data,
      turno,
      receita_id: receitaId,
      origem: 'manual',
      status: 'aberto',
      quantidade_produzida: valor,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    onCriado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          Iniciar produção — {receitaNome} ({turnoLabel})
        </h3>

        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          Quantidade produzida
        </label>
        <input
          type="number"
          min="1"
          autoFocus
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          placeholder="Ex.: 150"
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
            {salvando ? 'Salvando...' : 'Iniciar produção'}
          </button>
        </div>
      </div>
    </div>
  );
}
