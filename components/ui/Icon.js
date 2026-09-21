// Conjunto único e pequeno de ícones do Design System: SVG próprio, sem
// biblioteca. Todos: grade 24x24, traço de 1,75, pontas arredondadas,
// currentColor (a cor vem do texto do elemento pai) e aria-hidden -- quem
// usa o ícone sozinho num botão precisa dar aria-label ao botão.
//
// Uso: <Icon nome="home" /> ou <Icon nome="truck" tamanho={24} />

const CAMINHOS = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </>
  ),
  truck: (
    <>
      <path d="M2 6h12v10H2z" />
      <path d="M14 9h4l3 3v4h-7" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17.5" cy="18" r="1.8" />
    </>
  ),
  bread: (
    <>
      <path d="M5 9c0-2.2 3-4 7-4s7 1.8 7 4c0 1-.5 1.7-1.5 2.2V18a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6.8C5.5 10.7 5 10 5 9Z" />
      <path d="m9 9 1.2 2.4" />
      <path d="m13 9 1.2 2.4" />
    </>
  ),
  package: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
      <circle cx="7.5" cy="8.5" r="1.2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.6c2.8 0 5 1.7 5 4.4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="m16 8 4 4-4 4" />
      <path d="M20 12H9" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8h14v-8" />
      <path d="M12 8v12" />
      <path d="M12 8c-2.2 0-4-.9-4-2.4S9.8 3 12 8c2.2-5 4-3.9 4-2.4S14.2 8 12 8Z" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  trash: (
    <>
      <path d="M3.5 6h17" />
      <path d="M9 6V4h6v2" />
      <path d="m6 6 1 14h10l1-14" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9z" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </>
  ),
  note: (
    <>
      <path d="M5 4h14v11l-5 5H5V4Z" />
      <path d="M14 20v-5h5" />
    </>
  ),
};

export const NOMES_DE_ICONES = Object.keys(CAMINHOS);

export default function Icon({ nome, tamanho = 20, className }) {
  const conteudo = CAMINHOS[nome];
  if (!conteudo) return null;

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {conteudo}
    </svg>
  );
}
