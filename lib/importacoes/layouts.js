// Layouts dos relatórios do G3 aceitos pela Central de Importações
// (migration 0081) e o MASCARAMENTO de dados de clientes, feito no navegador
// ANTES de qualquer envio. As regras de aceitação valem no servidor
// (g3_analisar); aqui ficam só o reconhecimento para a tela, um resumo
// prévio e o mascaramento -- nome/CPF/CNPJ de cliente nunca saem daqui.

export const LAYOUTS = {
  vendas_produto_cliente: {
    chave: 'vendas_produto_cliente',
    titulo: 'VENDAS DE PRODUTOS POR CLIENTE',
    nome: 'Vendas por produto (Vendas_ProdCliente)',
    nomeCurto: 'Itens das vendas',
    descricao: 'Itens de cada venda: produto, código G3, nº do pedido, quantidade e valor.',
  },
  faturamento_geral: {
    chave: 'faturamento_geral',
    titulo: 'RELATORIO DE FATURAMENTO GERAL',
    nome: 'Faturamento geral (FaturamGeral)',
    nomeCurto: 'Faturamento',
    descricao: 'Uma linha por venda: bruto, descontos, acréscimos, taxa e líquido.',
  },
  vendas_periodo: {
    chave: 'vendas_periodo',
    titulo: 'RELATORIO DE VENDAS POR DIA/MES/ANO',
    nome: 'Vendas por dia (Vendas_Periodo)',
    nomeCurto: 'Totais diários',
    descricao: 'Totais por dia (agrupado por DIÁRIO), usados na conferência.',
  },
};

// Empresa: o CNPJ é dado público e aparece no cabeçalho do Vendas_ProdCliente
// (não é dado de cliente). O banco confere contra g3_configuracao.
export const CNPJ_EMPRESA = '65214016000142';

export const CLIENTE_MASCARADO = '[cliente identificado]';
const GRUPO_ANONIMO = 'CLIENTE: CONSUMIDOR NAO IDENTIFICADO - CPF/CNPJ: NAO INFORMADO';
const CONSUMIDOR_ANONIMO = 'CONSUMIDOR NAO IDENTIFICADO';

// Mesma normalização do servidor (g3_norm): sem acento, maiúsculas,
// espaços simples; º/ª viram O/A.
export function normalizar(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/º/g, 'o')
    .replace(/ª/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ /g, ' ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const naoVazia = (linha) => linha.some((v) => v !== null && v !== '' && v !== undefined);

export function detectarLayout(linhas) {
  const primeira = (linhas || []).find((l) => Array.isArray(l) && naoVazia(l));
  if (!primeira) return null;
  const titulo = normalizar(primeira[0]);
  return Object.values(LAYOUTS).find((l) => l.titulo === titulo)?.chave || null;
}

const CPF = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
const CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;

// Uma célula com cara de documento pessoal (CPF/CNPJ formatado, 11 dígitos
// "soltos", CNPJ de 14 dígitos que não é o da empresa, rótulo CPF fora da
// forma anônima do G3).
function celulaSuspeita(valor, { linhaCnpjEmpresa = false } = {}) {
  if (typeof valor === 'number') {
    if (!Number.isInteger(valor)) return false;
    const a = Math.abs(valor);
    if (a >= 1e9 && a < 1e11) return true;
    if (a >= 1e12 && a < 1e14) return !(linhaCnpjEmpresa && String(valor) === CNPJ_EMPRESA);
    return false;
  }
  if (typeof valor !== 'string') return false;
  const v = valor.trim();
  if (CPF.test(v) || CNPJ.test(v)) return true;
  if (/^\d{11}$/.test(v)) return true;
  if (/^\d{14}$/.test(v)) return !(linhaCnpjEmpresa && v === CNPJ_EMPRESA);
  const n = normalizar(v);
  if (n.includes('CPF') && n !== GRUPO_ANONIMO) return true;
  return false;
}

// Devolve CÓPIAS das linhas com os dados de cliente substituídos e quantas
// células foram mascaradas. Nunca altera o array original.
export function mascararClientes(layout, linhas) {
  let mascarados = 0;
  const saida = (linhas || []).map((linha, indice) => {
    if (!Array.isArray(linha)) return [];
    const nova = [...linha];
    const primeira = typeof nova[0] === 'string' ? normalizar(nova[0]) : '';

    // Vendas_ProdCliente: linha de grupo "Cliente: NOME - CPF/CNPJ: ..."
    if (primeira.startsWith('CLIENTE:')) {
      if (primeira !== GRUPO_ANONIMO) {
        mascarados += 1;
        return [`Cliente: ${CLIENTE_MASCARADO}`];
      }
      return nova;
    }

    // FaturamGeral: coluna Cliente (2a) das linhas de venda
    if (layout === 'faturamento_geral' && typeof nova[0] === 'number' && nova.length >= 2) {
      const cliente = normalizar(nova[1]);
      if (cliente !== CONSUMIDOR_ANONIMO && nova[1] !== CLIENTE_MASCARADO) {
        nova[1] = CLIENTE_MASCARADO;
        mascarados += 1;
      }
    }

    // Rede de segurança: qualquer célula com cara de documento pessoal.
    const linhaCnpjEmpresa = layout === 'vendas_produto_cliente' && indice === 2 && nova.length === 1;
    for (let c = 0; c < nova.length; c += 1) {
      if (celulaSuspeita(nova[c], { linhaCnpjEmpresa })) {
        nova[c] = '[documento omitido]';
        mascarados += 1;
      }
    }
    return nova;
  });
  return { linhas: saida, mascarados };
}

function textoDaCelula(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// Resumo para a tela ANTES do envio (o servidor revalida tudo).
export function resumirRelatorio(layout, linhas) {
  const def = LAYOUTS[layout];
  const resumo = { layout, nome: def?.nome || layout, geradoEm: null, periodo: null, filtros: [], linhasPreenchidas: 0, avisos: [] };
  if (!def) return resumo;
  const filtrosPermitidos = {
    vendas_produto_cliente: ['PERIODO', 'SITUACOES'],
    faturamento_geral: ['PERIODO', 'EMPRESAS'],
    vendas_periodo: ['PERIODO', 'EMPRESAS', 'AGRUPADO POR'],
  }[layout];
  let noBlocoFiltros = false;
  for (const linha of linhas) {
    if (!naoVazia(linha)) {
      noBlocoFiltros = false;
      continue;
    }
    resumo.linhasPreenchidas += 1;
    const c0 = normalizar(linha[0]);
    if (c0.startsWith('GERADO EM:')) resumo.geradoEm = textoDaCelula(linha[0]).replace(/^[^:]*:\s*/, '');
    if (c0 === 'FILTROS UTILIZADOS:') {
      noBlocoFiltros = true;
      continue;
    }
    if (noBlocoFiltros) {
      const rotulo = textoDaCelula(linha[0]);
      const valor = textoDaCelula(linha[1]);
      resumo.filtros.push({ rotulo, valor });
      if (c0 === 'PERIODO') resumo.periodo = valor;
      if (!filtrosPermitidos.includes(c0)) {
        resumo.avisos.push(`Filtro "${rotulo}" não é permitido: exporte o relatório sem filtros de seção, categoria, produto ou cliente.`);
      }
    }
  }
  if (!resumo.periodo) resumo.avisos.push('Período do relatório não encontrado.');
  return resumo;
}
