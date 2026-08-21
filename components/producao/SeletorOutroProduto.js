import { useState } from 'react';

// Ação secundária "+ Outro produto": só aparece um link discreto até o
// usuário clicar, então vira um <select> com as receitas ativas que ainda
// não estão sendo mostradas na tela. Não escreve nada no banco — só
// adiciona o produto à lista exibida nesta sessão (a página decide, ao
// recarregar, se ele continua aparecendo, com base em existir ou não
// registro de hoje para ele).
export default function SeletorOutroProduto({ receitasDisponiveis, corPrimaria, onSelecionar }) {
  const [aberto, setAberto] = useState(false);

  if (!receitasDisponiveis || receitasDisponiveis.length === 0) {
    return null;
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        style={{
          background: 'none',
          border: 'none',
          color: corPrimaria,
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 'bold',
          padding: '8px 0',
        }}
      >
        + Outro produto
      </button>
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
