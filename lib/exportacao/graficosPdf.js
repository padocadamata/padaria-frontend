// Gráficos VETORIAIS para os relatórios PDF (jsPDF puro, sem dependência
// nova e sem captura de tela). Só desenham: os valores chegam prontos dos
// mesmos modelos que alimentam os gráficos da tela (nenhum cálculo de
// negócio aqui). Ausência de valor (null) nunca vira zero:
//  - linhas: o traço é interrompido (lacuna) e o ponto isolado vira um ponto;
//  - colunas: sem barra;
//  - mapa de calor: hachura ("sem dados") ou contorno tracejado ("não se
//    aplica"), fora da escala de cores.
//
// Coordenadas em mm. `area` = { x, y, largura, altura }.

const COR_TEXTO = [60, 66, 65];
const COR_SUAVE = [120, 128, 126];
const COR_GRADE = [226, 232, 225];
const COR_EIXO = [190, 200, 196];

export function hexParaRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Aceita [r,g,b], '#rrggbb' ou 'rgb(r,g,b)' (a rampa do mapa de calor da tela).
export function corParaRgb(c) {
  if (Array.isArray(c)) return c;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(c || ''));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return hexParaRgb(c);
}
const rgb = corParaRgb;

// Passo "redondo" (1, 2, 2,5 ou 5 × 10^n) para ~4 divisões do eixo.
export function escalaEixo(minimo, maximo, divisoes = 4) {
  let min = Number.isFinite(minimo) ? Math.min(0, minimo) : 0;
  let max = Number.isFinite(maximo) ? maximo : 0;
  if (max <= min) max = min + 1;
  const bruto = (max - min) / divisoes;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) || bruto;
  min = Math.floor(min / passo) * passo;
  max = Math.ceil(max / passo) * passo;
  const marcas = [];
  for (let v = min; v <= max + passo / 1000; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
  return { minimo: min, maximo: max, marcas };
}

function texto(doc, conteudo, x, y, { tamanho = 6.5, cor = COR_TEXTO, alinhar = 'left', negrito = false, maxLargura } = {}) {
  doc.setFont('helvetica', negrito ? 'bold' : 'normal');
  doc.setFontSize(tamanho);
  doc.setTextColor(...rgb(cor));
  const opcoes = { align: alinhar };
  if (maxLargura) opcoes.maxWidth = maxLargura;
  doc.text(String(conteudo), x, y, opcoes);
}

// Legenda numa linha (quebra se não couber). itens: [{ nome, cor, tracejado?, tipo: 'linha'|'barra'|'faixa' }]
export function desenharLegenda(doc, x, y, larguraMax, itens) {
  let cx = x;
  let cy = y;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  for (const item of itens) {
    const w = doc.getTextWidth(String(item.nome)) + 9;
    if (cx + w > x + larguraMax && cx > x) {
      cx = x;
      cy += 4;
    }
    const cor = rgb(item.cor);
    if (item.tipo === 'barra' || item.tipo === 'faixa') {
      doc.setFillColor(...cor);
      doc.rect(cx, cy - 2.2, 4, 2.6, 'F');
    } else {
      doc.setDrawColor(...cor);
      doc.setLineWidth(0.6);
      if (item.tracejado) doc.setLineDashPattern([0.9, 0.6], 0);
      doc.line(cx, cy - 1, cx + 4, cy - 1);
      doc.setLineDashPattern([], 0);
    }
    texto(doc, item.nome, cx + 5.2, cy, { tamanho: 6.8 });
    cx += w + 3;
  }
  return cy - y + 4;
}

// Área de plotagem com grade, eixo Y formatado e rótulos do eixo X.
function moldura(doc, area, escala, rotulos, formatoEixo, larguraEixoY = 17) {
  const plot = { x: area.x + larguraEixoY, y: area.y + 1, largura: area.largura - larguraEixoY - 2, altura: area.altura - 7 };
  const yDe = (v) => plot.y + plot.altura - ((v - escala.minimo) / (escala.maximo - escala.minimo)) * plot.altura;
  doc.setLineWidth(0.15);
  for (const m of escala.marcas) {
    const y = yDe(m);
    doc.setDrawColor(...COR_GRADE);
    doc.line(plot.x, y, plot.x + plot.largura, y);
    texto(doc, formatoEixo(m), plot.x - 1.5, y + 1, { tamanho: 6, cor: COR_SUAVE, alinhar: 'right' });
  }
  doc.setDrawColor(...COR_EIXO);
  doc.line(plot.x, plot.y + plot.altura, plot.x + plot.largura, plot.y + plot.altura);
  const n = rotulos.length;
  const passoX = n ? plot.largura / n : plot.largura;
  const cabem = Math.max(2, Math.floor(plot.largura / 13));
  const salto = Math.max(1, Math.ceil(n / cabem));
  rotulos.forEach((r, i) => {
    // O último rótulo só entra se não encostar no anterior.
    const ultimoLonge = i === n - 1 && (n - 1) % salto >= Math.ceil(salto / 2);
    if (i % salto !== 0 && !ultimoLonge) return;
    texto(doc, r, plot.x + passoX * (i + 0.5), plot.y + plot.altura + 4, { tamanho: 6, cor: COR_SUAVE, alinhar: 'center' });
  });
  return { plot, yDe, passoX };
}

function extremos(series) {
  const vals = series.flatMap((s) => s.valores).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 0 };
}

// rotulos: [texto]; series: [{ nome, cor, tracejado?, valores: [n|null] }];
// faixas: [{ indice, cor }] (dias fora das médias, atrás das linhas).
export function desenharGraficoLinhas(doc, area, { rotulos, series, faixas = [], formatoEixo, legenda = [] }) {
  const alturaLegenda = desenharLegenda(doc, area.x, area.y + 3, area.largura, [...series.map((s) => ({ nome: s.nome, cor: s.cor, tracejado: s.tracejado })), ...legenda]);
  const corpo = { x: area.x, y: area.y + alturaLegenda + 2, largura: area.largura, altura: area.altura - alturaLegenda - 2 };
  const { min, max } = extremos(series);
  const escala = escalaEixo(min, max);
  const { plot, yDe, passoX } = moldura(doc, corpo, escala, rotulos, formatoEixo);
  for (const f of faixas) {
    doc.setFillColor(...rgb(f.cor));
    doc.rect(plot.x + passoX * f.indice, plot.y, passoX, plot.altura, 'F');
  }
  const xDe = (i) => plot.x + passoX * (i + 0.5);
  for (const s of series) {
    const cor = rgb(s.cor);
    doc.setDrawColor(...cor);
    doc.setFillColor(...cor);
    doc.setLineWidth(0.55);
    if (s.tracejado) doc.setLineDashPattern([1.2, 0.8], 0);
    const v = s.valores;
    for (let i = 0; i < v.length; i += 1) {
      const ok = v[i] !== null && v[i] !== undefined;
      if (!ok) continue;
      const proximoOk = i + 1 < v.length && v[i + 1] !== null && v[i + 1] !== undefined;
      if (proximoOk) doc.line(xDe(i), yDe(v[i]), xDe(i + 1), yDe(v[i + 1]));
      const anteriorOk = i > 0 && v[i - 1] !== null && v[i - 1] !== undefined;
      if (!s.tracejado && (v.length <= 40 || (!anteriorOk && !proximoOk))) doc.circle(xDe(i), yDe(v[i]), 0.55, 'F');
    }
    doc.setLineDashPattern([], 0);
  }
}

// rotulos: [texto]; series: [{ nome, cor, valores: [n|null] }] (barras agrupadas).
export function desenharGraficoColunas(doc, area, { rotulos, series, formatoEixo, legenda = [] }) {
  const alturaLegenda = desenharLegenda(doc, area.x, area.y + 3, area.largura, [...series.map((s) => ({ nome: s.nome, cor: s.cor, tipo: 'barra' })), ...legenda]);
  const corpo = { x: area.x, y: area.y + alturaLegenda + 2, largura: area.largura, altura: area.altura - alturaLegenda - 2 };
  const { min, max } = extremos(series);
  const escala = escalaEixo(min, max);
  const { plot, yDe, passoX } = moldura(doc, corpo, escala, rotulos, formatoEixo);
  const larguraBarra = Math.min(4.5, (passoX * 0.74) / Math.max(1, series.length));
  const base = yDe(Math.max(0, escala.minimo));
  series.forEach((s, k) => {
    doc.setFillColor(...rgb(s.cor));
    s.valores.forEach((v, i) => {
      if (v === null || v === undefined || !Number.isFinite(v)) return;
      const x = plot.x + passoX * (i + 0.5) - (larguraBarra * series.length) / 2 + k * larguraBarra;
      const y = yDe(v);
      doc.rect(x + 0.15, Math.min(y, base), larguraBarra - 0.3, Math.abs(base - y), 'F');
    });
  });
}

// Rosca: itens [{ valor (>0), cor }]; centro: [linhas de texto].
export function desenharRosca(doc, area, { itens, centro = [] }) {
  const raio = Math.min(area.largura, area.altura) / 2;
  const cx = area.x + area.largura / 2;
  const cy = area.y + area.altura / 2;
  const interno = raio * 0.62;
  const validos = itens.filter((i) => i.valor !== null && i.valor !== undefined && i.valor > 0);
  const total = validos.reduce((a, i) => a + i.valor, 0);
  if (!total) return;
  let angulo = -Math.PI / 2;
  for (const item of validos) {
    const fatia = (item.valor / total) * Math.PI * 2;
    const passos = Math.max(2, Math.ceil(fatia / (Math.PI / 90)));
    const pontos = [];
    for (let k = 0; k <= passos; k += 1) {
      const a = angulo + (fatia * k) / passos;
      pontos.push([cx + raio * Math.cos(a), cy + raio * Math.sin(a)]);
    }
    for (let k = passos; k >= 0; k -= 1) {
      const a = angulo + (fatia * k) / passos;
      pontos.push([cx + interno * Math.cos(a), cy + interno * Math.sin(a)]);
    }
    const rel = pontos.slice(1).map((p, k) => [p[0] - pontos[k][0], p[1] - pontos[k][1]]);
    doc.setFillColor(...rgb(item.cor));
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.25);
    doc.lines(rel, pontos[0][0], pontos[0][1], [1, 1], 'FD', true);
    angulo += fatia;
  }
  centro.forEach((linha, i) => {
    const y = cy + (i - (centro.length - 1) / 2) * 3.6 + 1;
    texto(doc, linha.texto ?? linha, cx, y, { tamanho: linha.tamanho || 6.5, negrito: !!linha.negrito, cor: linha.negrito ? [14, 61, 58] : COR_SUAVE, alinhar: 'center' });
  });
}

function hachurar(doc, x, y, w, h, passo = 1.1) {
  doc.setDrawColor(200, 210, 206);
  doc.setLineWidth(0.18);
  // Segmentos de y = -x + c dentro do retângulo.
  for (let c = passo; c < w + h; c += passo) {
    const x1 = Math.max(0, c - h);
    const x2 = Math.min(w, c);
    doc.line(x + x1, y + (c - x1), x + x2, y + (c - x2));
  }
}

// Mapa de calor. linhas: [{ rotulo, celulas: [{ tipo: 'valor'|'sem_dados'|'nao_se_aplica', cor? }] }],
// colunas: [rótulo]; rampa: { cores: [hex], minimo: texto, maximo: texto, rotulo }.
export function desenharMapaCalor(doc, area, { linhas, colunas, rampa, notas = [] }) {
  const larguraRotulo = 10;
  const alturaCabecalho = 4;
  const alturaLegenda = 9;
  const cw = Math.min(9, (area.largura - larguraRotulo) / Math.max(1, colunas.length));
  const ch = Math.min(6.5, (area.altura - alturaCabecalho - alturaLegenda) / Math.max(1, linhas.length));
  const x0 = area.x + larguraRotulo;
  const y0 = area.y + alturaCabecalho;
  colunas.forEach((c, j) => texto(doc, c, x0 + j * cw + cw / 2, area.y + 2.8, { tamanho: 5.8, cor: COR_SUAVE, alinhar: 'center' }));
  linhas.forEach((linha, i) => {
    texto(doc, linha.rotulo, x0 - 1.5, y0 + i * ch + ch / 2 + 1, { tamanho: 6, cor: COR_SUAVE, alinhar: 'right' });
    linha.celulas.forEach((cel, j) => {
      const x = x0 + j * cw + 0.25;
      const y = y0 + i * ch + 0.25;
      const w = cw - 0.5;
      const h = ch - 0.5;
      if (cel.tipo === 'valor') {
        doc.setFillColor(...rgb(cel.cor));
        doc.rect(x, y, w, h, 'F');
      } else if (cel.tipo === 'sem_dados') {
        doc.setFillColor(244, 246, 245);
        doc.rect(x, y, w, h, 'F');
        hachurar(doc, x, y, w, h);
      } else {
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, w, h, 'F');
        doc.setDrawColor(170, 182, 178);
        doc.setLineWidth(0.2);
        doc.setLineDashPattern([0.6, 0.45], 0);
        doc.rect(x, y, w, h, 'S');
        doc.setLineDashPattern([], 0);
      }
    });
  });
  // Legenda: rampa + amostras de "sem dados" / "não se aplica".
  let ly = y0 + linhas.length * ch + 5;
  let lx = area.x;
  if (rampa && rampa.cores && rampa.cores.length) {
    texto(doc, rampa.minimo, lx, ly, { tamanho: 6.2 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    lx += doc.getTextWidth(String(rampa.minimo)) + 1.5;
    rampa.cores.forEach((c) => {
      doc.setFillColor(...rgb(c));
      doc.rect(lx, ly - 2.3, 4.2, 2.6, 'F');
      lx += 4.6;
    });
    texto(doc, `${rampa.maximo}${rampa.rotulo ? ` (${rampa.rotulo})` : ''}`, lx + 1, ly, { tamanho: 6.2 });
    lx += doc.getTextWidth(`${rampa.maximo}${rampa.rotulo ? ` (${rampa.rotulo})` : ''}`) + 7;
  }
  for (const nota of notas) {
    const w = doc.getTextWidth(nota.texto) + 7;
    if (lx + w > area.x + area.largura) {
      lx = area.x;
      ly += 4;
    }
    if (nota.tipo === 'sem_dados') {
      doc.setFillColor(244, 246, 245);
      doc.rect(lx, ly - 2.3, 4.2, 2.6, 'F');
      hachurar(doc, lx, ly - 2.3, 4.2, 2.6, 0.9);
    } else {
      doc.setDrawColor(170, 182, 178);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([0.6, 0.45], 0);
      doc.rect(lx, ly - 2.3, 4.2, 2.6, 'S');
      doc.setLineDashPattern([], 0);
    }
    texto(doc, nota.texto, lx + 5.4, ly, { tamanho: 6.2 });
    lx += w + 3;
  }
}

// Cartões de indicadores (KPIs) em grade. cartoes: [{ titulo, valor, linhas: [texto], selo? }]
export function desenharCartoes(doc, area, { cartoes, porLinha = 6 }) {
  const gap = 3;
  const w = (area.largura - gap * (porLinha - 1)) / porLinha;
  const linhas = Math.ceil(cartoes.length / porLinha);
  const h = (area.altura - gap * (linhas - 1)) / linhas;
  cartoes.forEach((c, i) => {
    const x = area.x + (i % porLinha) * (w + gap);
    const y = area.y + Math.floor(i / porLinha) * (h + gap);
    doc.setDrawColor(214, 222, 219);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, w, h, 1.6, 1.6, 'FD');
    texto(doc, c.titulo, x + 2.5, y + 4.5, { tamanho: 6.8, cor: COR_SUAVE, maxLargura: w - 5 });
    if (c.selo) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.6);
      const ws = doc.getTextWidth(c.selo) + 2.4;
      doc.setFillColor(254, 243, 216);
      doc.roundedRect(x + w - ws - 2, y + 1.8, ws, 3.4, 1, 1, 'F');
      texto(doc, c.selo, x + w - ws / 2 - 2, y + 4.2, { tamanho: 5.6, negrito: true, cor: [146, 98, 0], alinhar: 'center' });
    }
    texto(doc, c.valor, x + 2.5, y + 11, { tamanho: 11.5, negrito: true, cor: [14, 61, 58], maxLargura: w - 5 });
    // Linhas de apoio: quebra respeitada (cada linha avança o y), sem sobrepor
    // e sem passar da borda do cartão.
    let ly = y + 15.6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    for (const l of c.linhas || []) {
      const item = typeof l === 'object' ? l : { texto: l };
      for (const parte of doc.splitTextToSize(String(item.texto), w - 5)) {
        if (ly > y + h - 1.2) break;
        texto(doc, parte, x + 2.5, ly, { tamanho: 6.2, cor: item.cor || COR_SUAVE });
        ly += 3.1;
      }
    }
  });
}
