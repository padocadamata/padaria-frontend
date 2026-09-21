// Breakpoints do Design System. CSS não aceita var() em @media, então os
// mesmos números estão repetidos (por convenção) em styles/tokens.css e nos
// .module.css -- este arquivo é a versão para JS (matchMedia).
export const BREAKPOINT_MOBILE_MAX = 768; // <= 768px: header compacto + bottom navigation
export const BREAKPOINT_DESKTOP_MIN = 1024; // < 1024px (e > 768px): sidebar nasce recolhida

export const MQ_MOBILE = `(max-width: ${BREAKPOINT_MOBILE_MAX}px)`;
export const MQ_ABAIXO_DESKTOP = `(max-width: ${BREAKPOINT_DESKTOP_MIN - 1}px)`;
