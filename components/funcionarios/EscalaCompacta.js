import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { cx } from '../../lib/design/cx';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { rotuloDiaSemana } from '../../lib/funcionarios/escala';
import estilos from './escala.module.css';

// Peças da apresentação COMPACTA da Escala (celular / tablet pequeno) --
// só layout. Quem navega, filtra e abre modais continua sendo a visão
// (Semanal, Mensal, Cobertura), com os mesmos handlers do desktop.

// ‹ período › + Hoje numa linha só, sem os textos longos dos botões do
// desktop ("← Semana anterior"...). Os nomes acessíveis continuam por extenso.
export function NavegacaoCompacta({ titulo, rotuloAnterior, rotuloProximo, onAnterior, onHoje, onProximo }) {
  return (
    <div className={estilos.navegacaoCompacta}>
      <IconButton icone="chevronLeft" rotulo={rotuloAnterior} onClick={onAnterior} />
      <h3 className={cx(estilos.tituloSemana, estilos.tituloCompacto)}>{titulo}</h3>
      <IconButton icone="chevronRight" rotulo={rotuloProximo} onClick={onProximo} />
      <Button variante="secondary" tamanho="sm" onClick={onHoje}>Hoje</Button>
    </div>
  );
}

// Seletor de dia: até 7 dias numa grade de colunas iguais (sem rolagem
// horizontal). Cada botão mostra dia da semana + número; hoje ganha um
// sublinhado discreto; o escolhido fica preenchido.
export function SeletorDia({ dias, valor, onEscolher, rotulo = 'Dia exibido' }) {
  const hoje = dataLocalHoje();
  return (
    <div className={estilos.seletorDia} role="group" aria-label={rotulo} style={{ gridTemplateColumns: `repeat(${Math.max(dias.length, 1)}, minmax(0, 1fr))` }}>
      {dias.map((data) => {
        const [, mes, dia] = data.split('-');
        const ativo = data === valor;
        return (
          <button
            key={data}
            type="button"
            className={cx(estilos.botaoDiaCompacto, ativo && estilos.botaoDiaCompactoAtivo, data === hoje && estilos.botaoDiaCompactoHoje)}
            aria-pressed={ativo}
            aria-label={`${rotuloDiaSemana(data)} ${dia}/${mes}${data === hoje ? ' (hoje)' : ''}`}
            onClick={() => onEscolher(data)}
          >
            <span className={estilos.botaoDiaCompactoSemana}>{rotuloDiaSemana(data)}</span>
            <span className={estilos.botaoDiaCompactoNumero}>{dia}</span>
          </button>
        );
      })}
    </div>
  );
}
