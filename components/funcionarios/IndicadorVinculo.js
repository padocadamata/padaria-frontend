import { cx } from '../../lib/design/cx';
import { letraVinculo, tomVinculo, descricaoVinculo } from '../../lib/funcionarios/vinculo';
import estilos from './escala.module.css';

// Indicador COMPACTO de vínculo (CLT/Freelancer/PJ) -- reutilizado em
// Escala Semanal/Mensal/Cobertura, onde uma Badge de texto completo
// alargaria demais a grade. Nunca depende só de cor: a letra (C/F/PJ)
// está sempre visível, com title + aria-label descrevendo por extenso
// para acessibilidade (mesmo princípio de Badge -- cor nunca é a única
// forma de comunicar o estado).
export default function IndicadorVinculo({ tipoVinculo }) {
  if (!tipoVinculo) return null;
  const descricao = descricaoVinculo(tipoVinculo);
  return (
    <span
      className={cx(estilos.indicadorVinculo, estilos[`indicadorVinculo_${tomVinculo(tipoVinculo)}`])}
      title={descricao}
      aria-label={descricao}
    >
      {letraVinculo(tipoVinculo)}
    </span>
  );
}
