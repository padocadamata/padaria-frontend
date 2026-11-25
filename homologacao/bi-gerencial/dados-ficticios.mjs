// HOMOLOGAÇÃO LOCAL DO BI GERENCIAL -- gerador de vendas FICTÍCIAS
// (determinístico: mesma semente = mesmos dados). Nenhum dado real.
//
// Cenário (operação oficial desde 09/07/2026, "hoje" = 25/11/2026):
//  - 09/07 a 18/11 e 20/11 a 24/11: dias completos (3 relatórios);
//  - 19/11: SEM importação (nenhum lote cobre o dia) -> lacuna, não zero;
//  - 25/11: PARCIAL (relatórios gerados às 12:44);
//  - 24 e 25/07: "cobertura não confirmada" (exceção já semeada pela 0083);
//  - ~0,5% das vendas sem itens (não conciliadas: entram no faturamento,
//    ficam fora de produtos);
//  - descontos só por venda (rateados), nunca por item;
//  - 311 e 341 com a MESMA descrição (códigos distintos); 900 vendido por
//    quantidade decimal (o painel não infere "kg").

export const HOJE = '2026-11-25';
export const INICIO = '2026-07-09';
export const SEM_IMPORTACAO = '2026-11-19';
export const PARCIAL = { dia: '2026-11-25', hora: '12:44' };

// codigo, descricao, preço, peso, perfil horário, quantidade decimal?
export const PRODUTOS = [
  ['900', 'PAO FRANCES FICTICIO', 18.9, 30, 'manha_tarde', true],
  ['120', 'PAO DE QUEIJO FICTICIO', 4.5, 12, 'manha'],
  ['121', 'PAO DE QUEIJO RECHEADO FICTICIO', 6.9, 4, 'manha'],
  ['300', 'CAFE COADO FICTICIO', 5.5, 14, 'manha'],
  ['301', 'CAFE COM LEITE FICTICIO', 7.2, 10, 'manha'],
  ['302', 'CAPUCCINO FICTICIO', 9.9, 4, 'tarde'],
  ['410', 'CROISSANT FICTICIO', 9.9, 6, 'manha'],
  ['520', 'BOLO DE CENOURA FATIA FICTICIO', 8.5, 6, 'tarde'],
  ['521', 'BOLO DE CHOCOLATE FATIA FICTICIO', 9.5, 5, 'tarde'],
  ['530', 'SONHO FICTICIO', 6.0, 6, 'tarde'],
  ['540', 'TORTA DE FRANGO FATIA FICTICIO', 12.0, 4, 'almoco'],
  ['610', 'COXINHA FICTICIO', 7.5, 9, 'almoco'],
  ['620', 'ESFIHA FICTICIO', 6.8, 6, 'almoco'],
  ['630', 'PASTEL ASSADO FICTICIO', 7.9, 4, 'almoco'],
  ['700', 'SUCO DE LARANJA FICTICIO', 9.0, 7, 'dia'],
  ['701', 'REFRIGERANTE LATA FICTICIO', 6.5, 8, 'almoco'],
  ['702', 'AGUA MINERAL FICTICIO', 3.5, 6, 'dia'],
  ['800', 'LEITE LITRO FICTICIO', 6.2, 5, 'manha'],
  ['801', 'IOGURTE FICTICIO', 4.9, 3, 'manha'],
  ['205', 'PAO NA CHAPA FICTICIO', 6.5, 7, 'manha'],
  ['210', 'PAO DOCE FICTICIO', 1.6, 6, 'tarde'],
  ['211', 'ROSCA DOCE FICTICIO', 14.0, 2, 'tarde'],
  ['311', 'OVO FICTICIO', 1.0, 2, 'dia'],
  ['341', 'OVO FICTICIO', 1.1, 1, 'dia'],
  ['450', 'BAGUETE FICTICIO', 11.0, 3, 'tarde'],
  ['451', 'PAO INTEGRAL FICTICIO', 13.5, 2, 'tarde'],
  ['460', 'BISCOITO AMANTEIGADO FICTICIO', 15.9, 2, 'dia'],
  ['470', 'TORTA DOCE FATIA FICTICIO', 13.0, 3, 'tarde'],
  ['480', 'SANDUICHE NATURAL FICTICIO', 14.5, 4, 'almoco'],
  ['490', 'MISTO QUENTE FICTICIO', 10.5, 6, 'manha'],
];

const PERFIS = {
  manha: (h) => (h >= 6 && h <= 10 ? 3 : h <= 12 ? 1 : h >= 16 && h <= 18 ? 0.8 : 0.3),
  manha_tarde: (h) => (h >= 6 && h <= 9 ? 3 : h >= 16 && h <= 19 ? 2.6 : 0.6),
  almoco: (h) => (h >= 11 && h <= 14 ? 3 : h >= 15 && h <= 17 ? 1 : 0.3),
  tarde: (h) => (h >= 14 && h <= 18 ? 3 : h >= 10 && h <= 13 ? 1 : 0.4),
  dia: () => 1,
};

// Distribuição das vendas no dia (6h às 21h), com picos de manhã e fim de tarde.
const CURVA = [0, 0, 0, 0, 0, 0, 5, 9, 9, 7, 5, 5, 6, 5, 4, 5, 7, 9, 8, 5, 3, 2, 0, 0];
const FATOR_DIA = [1.25, 0.85, 0.9, 0.95, 1.0, 1.1, 1.3]; // dom..sáb

function mulberry32(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (x) => Math.round(x * 100) / 100;

function sortear(rnd, pesos) {
  const total = pesos.reduce((a, b) => a + b, 0);
  let x = rnd() * total;
  for (let i = 0; i < pesos.length; i += 1) {
    x -= pesos[i];
    if (x <= 0) return i;
  }
  return pesos.length - 1;
}

function diasEntre(de, ate) {
  const out = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function gerarVendas(semente = 20261125) {
  const rnd = mulberry32(semente);
  const vendas = [];
  const itens = [];
  let numero = 100000;
  const dias = diasEntre(INICIO, HOJE);
  dias.forEach((dia, i) => {
    if (dia === SEM_IMPORTACAO) return;
    const dow = new Date(`${dia}T00:00:00Z`).getUTCDay();
    const tendencia = 1 + i * 0.0011;
    let quantidadeVendas = Math.round(185 * FATOR_DIA[dow] * tendencia * (0.88 + rnd() * 0.24));
    for (let k = 0; k < quantidadeVendas; k += 1) {
      const hora = sortear(rnd, CURVA);
      const minuto = Math.floor(rnd() * 60);
      const hhmm = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
      if (dia === PARCIAL.dia && hhmm > PARCIAL.hora) continue;
      numero += 1;
      const nItens = 1 + sortear(rnd, [50, 30, 14, 6]);
      const pesos = PRODUTOS.map((p) => p[3] * PERFIS[p[4]](hora));
      const escolhidos = new Map();
      for (let j = 0; j < nItens; j += 1) {
        const idx = sortear(rnd, pesos);
        const p = PRODUTOS[idx];
        const qtd = p[5] ? Math.round((0.25 + rnd() * 0.9) * 1000) / 1000 : 1 + (rnd() < 0.18 ? 1 : 0) + (rnd() < 0.05 ? 2 : 0);
        const atual = escolhidos.get(p[0]) || { p, qtd: 0 };
        atual.qtd += qtd;
        escolhidos.set(p[0], atual);
      }
      let ordinal = 0;
      let prod = 0;
      const linhas = [];
      for (const { p, qtd } of escolhidos.values()) {
        ordinal += 1;
        const valor = r2(p[2] * qtd);
        prod = r2(prod + valor);
        linhas.push({ numero, codigo: p[0], ordinal, descricao: p[1], quantidade: Math.round(qtd * 1000) / 1000, valor });
      }
      const desconto = rnd() < 0.07 ? r2(Math.min(prod * 0.15, 0.5 + rnd() * 3)) : 0;
      const semItens = rnd() < 0.005;
      vendas.push({ numero, dia, hhmm, prod, desconto, liquido: r2(prod - desconto), semItens, itensTotal: prod, nLinhas: linhas.length, qtdTotal: linhas.reduce((a, l) => a + l.quantidade, 0) });
      if (!semItens) itens.push(...linhas);
    }
    quantidadeVendas = 0;
  });
  return { vendas, itens };
}
