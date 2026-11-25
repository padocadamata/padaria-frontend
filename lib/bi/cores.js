// BI Gerencial -- cores dos gráficos.
//
// Paleta categórica validada no mockup aprovado (contraste, separação para
// daltonismo e piso de croma: todas as checagens PASS sobre branco). A cor
// SEGUE O PRODUTO, nunca a posição: um código mantém a mesma cor em todos os
// gráficos enquanto continuar selecionado, e remover um produto não repinta
// os demais.

export const PALETA_PRODUTOS = ['#00897a', '#c8622f', '#3d6fc0', '#b08800', '#8f55b5'];
export const COR_SERIE_A = '#00897a';
export const COR_SERIE_B = '#8b9795';
export const COR_DEMAIS = '#c9d2cf';
export const COR_GRADE = '#e6ece5';
export const COR_TEXTO_EIXO = '#4d5957';
// Faixas de fundo dos gráficos por situação do dia (nunca confundidas com
// valores: são áreas atrás das linhas, com legenda própria).
export const COR_PARCIAL = '#f3dfb0'; // parcial / com pendências: fora das médias
export const COR_NAO_CONFIRMADA = '#e4dcf0'; // cobertura não confirmada
export const COR_LACUNA = '#e3e9ee'; // sem importação: lacuna, não zero
export const COR_SEM_OPERACAO = '#efefef'; // sem operação
export const CORES_MARCA = { parcial: COR_PARCIAL, nc: COR_NAO_CONFIRMADA, lacuna: COR_LACUNA, semop: COR_SEM_OPERACAO };
export const ROTULO_MARCA = {
  parcial: 'parcial / com pendências (fora das médias)',
  nc: 'cobertura não confirmada (fora das médias)',
  lacuna: 'sem importação (lacuna, não zero)',
  semop: 'sem operação',
};

// Produtos do gráfico de participação que NÃO estão selecionados: tons
// dessaturados, distintos entre si e da paleta dos selecionados (a cor
// forte continua exclusiva do produto selecionado em todos os gráficos).
export const PALETA_SECUNDARIA = ['#6f9e98', '#c09a83', '#8c9dbd', '#b3a878', '#a593b3'];

// Mapa de calor: célula sem dados (dia da semana fora do filtro ou sem dia
// completo) usa hachura própria, fora da escala de intensidade.
export const COR_CALOR_SEM_DADOS = '#f4f6f5';

// mapaAnterior: { codigo: cor } já atribuído. Devolve o novo mapa só com os
// selecionados, preservando as cores de quem continua.
export function atribuirCores(selecionados, mapaAnterior = {}) {
  const mapa = {};
  const usadas = new Set();
  for (const c of selecionados) {
    const cor = mapaAnterior[c];
    if (cor && !usadas.has(cor)) {
      mapa[c] = cor;
      usadas.add(cor);
    }
  }
  for (const c of selecionados) {
    if (mapa[c]) continue;
    const livre = PALETA_PRODUTOS.find((x) => !usadas.has(x)) || PALETA_PRODUTOS[PALETA_PRODUTOS.length - 1];
    mapa[c] = livre;
    usadas.add(livre);
  }
  return mapa;
}

// Cores dos produtos no gráfico de participação: selecionado = a cor dele
// (a mesma dos demais gráficos); não selecionado = tom secundário pela
// posição no ranking.
export function coresParticipacao(codigos, coresSelecionados = {}) {
  const out = {};
  codigos.forEach((c, i) => {
    out[c] = coresSelecionados[c] || PALETA_SECUNDARIA[i % PALETA_SECUNDARIA.length];
  });
  return out;
}

// Mapa de calor: rampa sequencial de um matiz (claro -> escuro). minimo
// (opcional) estica a escala para indicadores que não partem de zero
// (ex.: ticket médio).
export function corCalor(valor, maximo, minimo = 0) {
  if (valor === null || valor === undefined) return COR_CALOR_SEM_DADOS;
  const amplitude = maximo - minimo;
  const t = amplitude > 0 ? Math.max(0, Math.min(1, (valor - minimo) / amplitude)) : maximo > 0 ? 1 : 0;
  const a = [233, 245, 242];
  const b = [0, 92, 82];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * Math.pow(t, 0.9))).join(',')})`;
}
