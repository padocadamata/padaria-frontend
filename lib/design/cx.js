// Junta nomes de classe ignorando valores falsos (sem dependência externa).
export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}
