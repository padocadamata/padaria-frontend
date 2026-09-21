import { useState } from 'react';
import Button from '../ui/Button';
import Select from '../ui/Select';
import EmptyState from '../ui/EmptyState';
import styles from './SeletorOutroProduto.module.css';

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
      <div className={styles.raiz}>
        <Button variante="secondary" onClick={() => setAberto(true)} disabled={semOpcoes}>
          + Outro produto
        </Button>
        {semOpcoes && (
          <EmptyState>Nenhum outro produto habilitado para controle de produção.</EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className={styles.raiz}>
      <Select
        autoFocus
        aria-label="Outro produto"
        defaultValue=""
        onChange={(e) => {
          const receita = receitasDisponiveis.find((r) => r.id === e.target.value);
          setAberto(false);
          if (receita) {
            onSelecionar(receita);
          }
        }}
        onBlur={() => setAberto(false)}
      >
        <option value="" disabled>
          Selecione uma receita...
        </option>
        {receitasDisponiveis.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nome}
          </option>
        ))}
      </Select>
    </div>
  );
}
