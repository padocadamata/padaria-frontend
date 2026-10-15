// Personalização do Dashboard por usuário (migration 0075) -- funções PURAS.
//
// O banco guarda só a ORDEM e o TAMANHO de cada widget, por id estável
// ([{ id, tamanho }], ver public.dashboard_layout_valido). Quais widgets
// existem, seus tamanhos permitidos e quem pode ver cada um continuam
// definidos aqui e em pages/dashboard.js -- nunca no banco.
//
// Tamanhos são RESPONSIVOS (classes da grade, não pixels):
//   P = 1/3 da largura (>= 1024px), M = 1/2, G = largura toda;
//   entre 769 e 1023px P e M ocupam meia largura; até 768px, tudo empilha.

export const TAMANHOS = ['P', 'M', 'G'];
export const ROTULO_TAMANHO = { P: 'Pequeno', M: 'Médio', G: 'Grande' };

// Mesmo formato do CHECK no banco.
export const PADRAO_ID_WIDGET = /^[a-z0-9_]{1,40}$/;
export const MAXIMO_WIDGETS = 40;

// Catálogo dos widgets atuais, na ORDEM PADRÃO (a mesma de antes desta
// frente). tamanhos = tamanhos permitidos; padrao = tamanho sem
// personalização. A Agenda de pedidos e entregas é uma faixa de 7 dias: só
// fica legível na largura toda (G).
export const WIDGETS_DASHBOARD = [
  { id: 'agenda_hoje', titulo: 'Agenda de hoje', tamanhos: ['P', 'M', 'G'], padrao: 'P' },
  { id: 'atencao_producao', titulo: 'Atenção (produção)', tamanhos: ['P', 'M', 'G'], padrao: 'P' },
  { id: 'recebimentos_previstos', titulo: 'Recebimentos previstos', tamanhos: ['P', 'M', 'G'], padrao: 'P' },
  { id: 'lembretes', titulo: 'Lembretes rápidos', tamanhos: ['P', 'M', 'G'], padrao: 'P' },
  { id: 'aniversariantes', titulo: 'Aniversariantes', tamanhos: ['P', 'M', 'G'], padrao: 'P' },
  { id: 'agenda_pedidos', titulo: 'Agenda de pedidos e entregas', tamanhos: ['G'], padrao: 'G' },
];

export function layoutPadrao(catalogo = WIDGETS_DASHBOARD) {
  return catalogo.map((w) => ({ id: w.id, tamanho: w.padrao }));
}

function tamanhoValido(widget, tamanho) {
  return widget.tamanhos.includes(tamanho) ? tamanho : widget.padrao;
}

// Junta a preferência salva com o catálogo ATUAL:
//  - ids salvos que não existem mais são ignorados (Dashboard nunca quebra);
//  - ids repetidos: vale a 1ª ocorrência;
//  - tamanho fora dos permitidos (ou inválido) volta ao padrão do widget;
//  - widget NOVO (não está na preferência) nunca some: entra logo depois do
//    vizinho que o precede na ordem padrão (ou no início, se for o 1º),
//    com o tamanho padrão.
export function mesclarLayout(salvo, catalogo = WIDGETS_DASHBOARD) {
  const porId = new Map(catalogo.map((w) => [w.id, w]));
  const resultado = [];
  const usados = new Set();
  if (Array.isArray(salvo)) {
    for (const item of salvo) {
      const widget = item && porId.get(item.id);
      if (!widget || usados.has(widget.id)) continue;
      usados.add(widget.id);
      resultado.push({ id: widget.id, tamanho: tamanhoValido(widget, item.tamanho) });
    }
  }
  catalogo.forEach((widget, indice) => {
    if (usados.has(widget.id)) return;
    let posicao = 0;
    for (let i = indice - 1; i >= 0; i--) {
      const anterior = resultado.findIndex((r) => r.id === catalogo[i].id);
      if (anterior >= 0) {
        posicao = anterior + 1;
        break;
      }
    }
    resultado.splice(posicao, 0, { id: widget.id, tamanho: widget.padrao });
    usados.add(widget.id);
  });
  return resultado;
}

// Move um widget uma posição entre os VISÍVEIS (os que o usuário pode ver):
// troca de lugar com o vizinho visível, mantendo os invisíveis onde estão.
export function moverWidget(layout, id, direcao, visiveis) {
  const ehVisivel = (item) => !visiveis || visiveis.has(item.id);
  const indice = layout.findIndex((w) => w.id === id);
  if (indice < 0) return layout;
  let alvo = indice + (direcao < 0 ? -1 : 1);
  while (alvo >= 0 && alvo < layout.length && !ehVisivel(layout[alvo])) alvo += direcao < 0 ? -1 : 1;
  if (alvo < 0 || alvo >= layout.length) return layout;
  const novo = [...layout];
  [novo[indice], novo[alvo]] = [novo[alvo], novo[indice]];
  return novo;
}

export function definirTamanho(layout, id, tamanho, catalogo = WIDGETS_DASHBOARD) {
  const widget = catalogo.find((w) => w.id === id);
  if (!widget || !widget.tamanhos.includes(tamanho)) return layout;
  return layout.map((w) => (w.id === id ? { ...w, tamanho } : w));
}

export function ehLayoutPadrao(layout, catalogo = WIDGETS_DASHBOARD) {
  const padrao = layoutPadrao(catalogo);
  return layout.length === padrao.length && layout.every((w, i) => w.id === padrao[i].id && w.tamanho === padrao[i].tamanho);
}

// Espelho JS de public.dashboard_layout_valido (0075) -- o que é enviado ao
// banco sempre passa por aqui antes.
export function layoutValidoParaBanco(layout) {
  if (!Array.isArray(layout) || layout.length > MAXIMO_WIDGETS) return false;
  const ids = new Set();
  for (const item of layout) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const chaves = Object.keys(item);
    if (chaves.some((c) => c !== 'id' && c !== 'tamanho')) return false;
    if (typeof item.id !== 'string' || !PADRAO_ID_WIDGET.test(item.id) || ids.has(item.id)) return false;
    if (!TAMANHOS.includes(item.tamanho)) return false;
    ids.add(item.id);
  }
  return true;
}
