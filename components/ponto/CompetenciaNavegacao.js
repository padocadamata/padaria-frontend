import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { rotuloCompetencia, somarMeses } from '../../lib/ponto/apresentacao';
import estilos from './ponto.module.css';

// ‹ Mês/Ano › + "Mês atual" -- navegação livre para trás (histórico sem
// limite); para a frente só até o mês atual (competência futura não abre).
export default function CompetenciaNavegacao({ mes, mesAtual, onMudar }) {
  const futuro = somarMeses(mes, 1) > mesAtual;
  return (
    <div className={estilos.navegacao}>
      <IconButton icone="chevronLeft" rotulo="Competência anterior" onClick={() => onMudar(somarMeses(mes, -1))} />
      <h2 className={estilos.tituloCompetencia} aria-live="polite">{rotuloCompetencia(mes)}</h2>
      <IconButton icone="chevronRight" rotulo="Próxima competência" onClick={() => onMudar(somarMeses(mes, 1))} disabled={futuro} />
      {mes !== mesAtual && (
        <Button variante="ghost" tamanho="sm" onClick={() => onMudar(mesAtual)}>Mês atual</Button>
      )}
    </div>
  );
}
