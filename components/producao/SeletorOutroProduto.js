import { useState } from 'react';

// Ação secundária "+ Outro produto": só aparece um link discreto até o
// usuário clicar, então vira um <select> com as receitas ativas que ainda
// não estão sendo mostradas na tela. Não escreve nada no banco — só
// adiciona o produto à lista exibida nesta sessão (a página decide, ao
// recarregar, se ele continua aparecendo, com base em existir ou não
// registro de hoje para ele).
export default function SeletorOutroProduto({ receitasDisponiveis, corPrimaria, onSelecionar }) {
  const [aberto, setAberto] = useState(false);
  const semOpcoes = !receitasDisponiveis || receitasDisponiveis.length === 0;

  if (!aberto) {
    return (
      <div>
        <button
          onClick={() => setAberto(true)}
          disabled={semOpcoes}
          style={{
            background: 'none',
            border: 'none',
            color: semOpcoes ? '#999' : corPrimaria,
            cursor: semOpcoes ? 'default' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            padding: '8px 0',
          }}
        >
          + Outro produto
        </button>
        {semOpcoes && (
          <p style={{ color: '#999', fontSize: '12px', margin: '0 0 8px 0' }}>
            Nenhum outro produto habilitado para controle de produção.
          </p>
        )}
      </div>
    );
  }

  return (
    <select
      autoFocus
      defaultValue=""
      onChange={(e) => {
        const receita = receitasDisponiveis.find((r) => r.id === e.target.value);
        setAberto(false);
        if (receita) {
          onSelecionar(receita);
        }
      }}
      onBlur={() => setAberto(false)}
      style={{
        padding: '8px',
        border: `1px solid ${corPrimaria}`,
        borderRadius: '5px',
        fontSize: '14px',
      }}
    >
      <option value="" disabled>
        Selecione uma receita...
      </option>
      {receitasDisponiveis.map((r) => (
        <option key={r.id} value={r.id}>
          {r.nome}
        </option>
      ))}
    </select>
  );
}
