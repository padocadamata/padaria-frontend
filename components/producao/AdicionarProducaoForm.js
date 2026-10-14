import { useState } from 'react';
import Modal from '../ui/Modal';
import { validarQuantidadePositiva, adicionarProducao } from '../../lib/producao/operacoesTurno';

const campoEstilo = {
  width: '100%',
  padding: '10px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '16px',
};

// Modal de "+ Adicionar produção" (segunda fornada). Usa exclusivamente a
// RPC public.adicionar_producao — nunca SELECT + soma no cliente + UPDATE,
// para não correr risco de duas fornadas concorrentes se sobrescreverem.
// Validação e gravação: lib/producao/operacoesTurno (as mesmas da tabela
// do desktop).
export default function AdicionarProducaoForm({ registro, receitaNome, turnoLabel, corPrimaria, onAdicionado, onCancelar }) {
  const [quantidade, setQuantidade] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    const { valor, erro: erroValidacao } = validarQuantidadePositiva(quantidade);
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }

    setSalvando(true);
    setErro('');

    const { erro: erroGravacao } = await adicionarProducao({ registroId: registro.id, quantidade: valor });

    setSalvando(false);

    if (erroGravacao) {
      setErro(erroGravacao);
      return;
    }

    onAdicionado();
  }

  return (
    <Modal onFechar={onCancelar} largura="sm" legado>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          Adicionar produção — {receitaNome} ({turnoLabel})
        </h3>

        <p style={{ color: '#666', fontSize: '14px' }}>
          Produzido até agora: <strong>{registro.quantidade_produzida}</strong>
        </p>

        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          Quantidade adicional assada
        </label>
        <input
          type="number"
          min="1"
          autoFocus
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          placeholder="Ex.: 50"
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
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
    </Modal>
  );
}
