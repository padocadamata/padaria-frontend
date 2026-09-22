import Button from '../ui/Button';
import estilos from './agenda.module.css';

// Alternador de visão da Agenda (Mês/Semana/Dia) — botões externos ao
// FullCalendar, em vez de depender só da barra de ferramentas nativa da
// lib. `visao` usa os nomes de view do próprio FullCalendar
// (dayGridMonth/timeGridWeek/timeGridDay) para repassar direto à
// referência do calendário, sem tradução.
const OPCOES = [
  { chave: 'dayGridMonth', label: 'Mês' },
  { chave: 'timeGridWeek', label: 'Semana' },
  { chave: 'timeGridDay', label: 'Dia' },
];

export default function NavegacaoAgenda({ visao, onMudarVisao }) {
  return (
    <div className={estilos.visoes} role="tablist" aria-label="Visão da agenda">
      {OPCOES.map((opcao) => (
        <Button
          key={opcao.chave}
          tamanho="sm"
          variante={opcao.chave === visao ? 'primary' : 'secondary'}
          role="tab"
          aria-selected={opcao.chave === visao}
          onClick={() => onMudarVisao(opcao.chave)}
        >
          {opcao.label}
        </Button>
      ))}
    </div>
  );
}
