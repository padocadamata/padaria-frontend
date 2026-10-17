// Altura da grade da Cobertura (desktop) -- a grade é o
// ÚNICO container com rolagem vertical (e horizontal) da visão; em vez da
// fração fixa antiga (70vh, que sobrava em telas altas e causava rolagem
// dupla em notebooks), ela ocupa o que sobra da janela abaixo do seu topo,
// descontando o espaço reservado para o que vem depois (legenda + respiro
// inferior da página). `minimo`: abaixo disso a grade não encolhe -- em
// janelas muito baixas a página volta a rolar, mas a grade continua usável.
export const ALTURA_MINIMA_GRADE = 320;
export const RESERVA_INFERIOR_GRADE = 96;

export function calcularAlturaGrade({ alturaJanela, topoGrade, reservaInferior = RESERVA_INFERIOR_GRADE, minimo = ALTURA_MINIMA_GRADE }) {
  if (!Number.isFinite(alturaJanela) || !Number.isFinite(topoGrade)) return null;
  return Math.max(minimo, Math.floor(alturaJanela - topoGrade - reservaInferior));
}
