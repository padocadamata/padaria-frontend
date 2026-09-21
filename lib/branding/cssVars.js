import { TEMA } from './tema';

// Variáveis CSS da MARCA, geradas a partir de lib/branding/tema.js (fonte
// única de verdade da identidade). Nenhum hexadecimal institucional é
// repetido em CSS: styles/tokens.css só define tokens complementares e
// consome estas variáveis. Injetado em pages/_document.js.
export function cssVariaveisDeMarca() {
  const c = TEMA.cores;
  return `:root{--ds-primary:${c.primaria};--ds-secondary:${c.secundaria};--ds-success:${c.sucesso};--ds-danger:${c.erro};--ds-bg:${c.fundo};--ds-text:${c.texto};}`;
}
