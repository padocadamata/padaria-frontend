// Alternador de visão da Agenda (Mês/Semana/Dia) — botões externos ao
// FullCalendar, no mesmo estilo visual das abas já usadas em
// NavegacaoProducao.js, em vez de depender só da barra de ferramentas
// nativa da lib. `visao` usa os nomes de view do próprio FullCalendar
// (dayGridMonth/timeGridWeek/timeGridDay) para repassar direto à
// referência do calendário, sem tradução.
const OPCOES = [
  { chave: 'dayGridMonth', label: 'Mês' },
  { chave: 'timeGridWeek', label: 'Semana' },
  { chave: 'timeGridDay', label: 'Dia' },
];

export default function NavegacaoAgenda({ visao, onMudarVisao, corPrimaria }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
      {OPCOES.map((opcao) => {
        const ativa = opcao.chave === visao;
        return (
          <button
            key={opcao.chave}
            type="button"
            onClick={() => onMudarVisao(opcao.chave)}
            style={{
              padding: '8px 16px',
              backgroundColor: ativa ? corPrimaria : 'white',
              color: ativa ? 'white' : corPrimaria,
              border: `1px solid ${corPrimaria}`,
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: ativa ? 'bold' : 'normal',
              fontSize: '14px',
            }}
          >
            {opcao.label}
          </button>
        );
      })}
    </div>
  );
}
