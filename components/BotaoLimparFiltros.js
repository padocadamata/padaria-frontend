// Padrão visual dos filtros (criado na frente de Sacos Fechados) e botão
// "Limpar filtros" compartilhados por Saldo de Sacos, Histórico e
// Planejamento. Campos com altura mínima de 42px (área de toque) e fonte
// de 16px (iOS dá zoom automático em inputs menores que 16px).
export const campoFiltroEstilo = {
  width: '100%',
  minWidth: 0,
  minHeight: '42px',
  padding: '8px',
  fontSize: '16px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

// Desabilitado enquanto nenhum filtro difere do valor padrão.
export default function BotaoLimparFiltros({ filtrosAtivos, onClick, corPrimaria = '#8B4513' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!filtrosAtivos}
      style={{
        ...campoFiltroEstilo,
        backgroundColor: 'white',
        color: filtrosAtivos ? corPrimaria : '#aaa',
        border: `1px solid ${filtrosAtivos ? corPrimaria : '#ddd'}`,
        cursor: filtrosAtivos ? 'pointer' : 'not-allowed',
        fontSize: '14px',
      }}
    >
      Limpar filtros
    </button>
  );
}
