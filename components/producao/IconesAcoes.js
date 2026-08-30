import { useState } from 'react';

// Ícones/tooltip reutilizáveis para colunas de ações compactas (hoje só
// Histórico, mas qualquer tela pode reaproveitar). SVG inline desenhado à
// mão — sem nenhuma biblioteca de ícones (nenhuma está instalada no
// projeto; decisão explícita de não adicionar dependência nova só para
// isso). Tooltip próprio (não usa o `title` nativo do navegador) via
// pequeno estado local de hover/foco — sem CSS-in-JS nem `:hover`, porque
// nada no projeto usa isso hoje; segue o mesmo padrão já usado em todo
// lugar (cor condicional calculada em JS a partir de estado do
// componente), só que aqui o estado é "está em hover/foco" em vez de
// "está desabilitado".

const TAMANHO_ICONE = 16;

const propsIconeBase = {
  width: TAMANHO_ICONE,
  height: TAMANHO_ICONE,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconeOlho() {
  return (
    <svg {...propsIconeBase}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconeLapis() {
  return (
    <svg {...propsIconeBase}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function IconeCaixa() {
  return (
    <svg {...propsIconeBase}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

export function IconeCheck() {
  return (
    <svg {...propsIconeBase}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconeReabrir() {
  return (
    <svg {...propsIconeBase}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

// Usado por Pedidos (ação "Cancelar pedido") -- nenhum ícone existente
// aqui tinha semântica de cancelamento; adicionado como export puramente
// aditivo, sem tocar em nenhum ícone/uso já existente em Produção.
export function IconeCancelar() {
  return (
    <svg {...propsIconeBase}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  );
}

export function IconeLixeira() {
  return (
    <svg {...propsIconeBase}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

// Botão compacto de ação com ícone + tooltip próprio + aria-label. Aparece
// imediatamente no hover/foco (sem delay), some ao tirar o mouse/foco.
// `disabled=false` (padrão) usa `cor`/`corHover`; passar `destrutivo` deixa
// o botão neutro em repouso e vermelho no hover/foco (ex.: Excluir), sem
// deixar a linha toda "carregada de vermelho" — só o botão reage.
export function BotaoIconeAcao({ rotulo, onClick, icone: Icone, destrutivo = false, cor = '#9e9e9e' }) {
  const [emDestaque, setEmDestaque] = useState(false);

  const corHover = destrutivo ? '#f44336' : '#616161';
  const corAtual = emDestaque ? corHover : cor;

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={rotulo}
        onMouseEnter={() => setEmDestaque(true)}
        onMouseLeave={() => setEmDestaque(false)}
        onFocus={() => setEmDestaque(true)}
        onBlur={() => setEmDestaque(false)}
        style={{
          width: '32px',
          height: '32px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: corAtual,
          color: 'white',
          cursor: 'pointer',
          transition: 'background-color 0.12s ease',
          padding: 0,
        }}
      >
        <Icone />
      </button>

      {emDestaque && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#333',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {rotulo}
        </span>
      )}
    </span>
  );
}
