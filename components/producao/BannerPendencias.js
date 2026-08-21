import { useState } from 'react';
import FechamentoTurnoForm from './FechamentoTurnoForm';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';

const rotuloTurno = { manha: 'Manhã', tarde: 'Tarde' };

function formatarDataBR(data) {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Destaque de registros abertos/reabertos de dias anteriores — a única
// regra é status IN ('aberto','reaberto') AND data < hoje. Nunca usar
// data <> hoje, para não confundir "pendência antiga" com "ainda não
// mexi no turno de hoje".
export default function BannerPendencias({ pendencias, receitaNomePorId, corPrimaria, permissoes, onAtualizado }) {
  const [registroSelecionado, setRegistroSelecionado] = useState(null);

  if (!pendencias || pendencias.length === 0) {
    return null;
  }

  const podeEditar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EDITAR);

  return (
    <div
      style={{
        backgroundColor: '#fff3e0',
        border: '2px solid #FF9800',
        borderRadius: '8px',
        padding: '15px 20px',
        marginBottom: '25px',
      }}
    >
      <h3 style={{ margin: '0 0 10px 0', color: '#e65100' }}>
        ⚠️ {pendencias.length === 1 ? '1 pendência de fechamento' : `${pendencias.length} pendências de fechamento`}
      </h3>

      {pendencias.map((p) => (
        <div
          key={p.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderTop: '1px solid #ffe0b2',
          }}
        >
          <span>
            <strong>{formatarDataBR(p.data)}</strong> — {receitaNomePorId[p.receita_id] || p.receita_id} ({rotuloTurno[p.turno] || p.turno})
            {p.status === 'reaberto' && <em style={{ color: '#f44336', marginLeft: '8px' }}>em correção</em>}
          </span>
          {podeEditar && (
            <button
              onClick={() => setRegistroSelecionado(p)}
              style={{
                padding: '6px 14px',
                backgroundColor: '#FF9800',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 'bold',
              }}
            >
              {p.status === 'reaberto' ? 'Corrigir e fechar' : 'Fechar agora'}
            </button>
          )}
        </div>
      ))}

      {registroSelecionado && (
        <FechamentoTurnoForm
          registro={registroSelecionado}
          receitaNome={receitaNomePorId[registroSelecionado.receita_id] || registroSelecionado.receita_id}
          turnoLabel={rotuloTurno[registroSelecionado.turno] || registroSelecionado.turno}
          corPrimaria={corPrimaria}
          onFechado={() => {
            setRegistroSelecionado(null);
            onAtualizado();
          }}
          onCancelar={() => setRegistroSelecionado(null)}
        />
      )}
    </div>
  );
}
