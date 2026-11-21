// Leitura do relatório .xlsx do G3 NO NAVEGADOR (migration 0081).
//
// O arquivo nunca sai do computador como arquivo: aqui ele é aberto em
// memória, conferido (estrutura do zip, aba única, sem fórmulas/macros) e
// transformado em linhas de células (texto/número/null). Só as linhas -- já
// mascaradas (lib/importacoes/layouts.js) -- vão para o banco.
//
// Biblioteca: SheetJS Community Edition 0.20.3, vendorizada em
// vendor/xlsx-0.20.3.tgz (ver vendor/README.md). Carregada sob demanda, só
// na tela de importação.

export const TAMANHO_MAXIMO = 30 * 1024 * 1024; // 30 MB (o arquivo anual de itens tem ~10 MB)
const DESCOMPACTADO_MAXIMO = 250 * 1024 * 1024;
const ENTRADAS_MAXIMAS = 200;
const LINHAS_MAXIMAS = 120000;
const COLUNAS_MAXIMAS = 40;

export class ErroLeitura extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroLeitura';
  }
}

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// Lê o diretório central do zip (sem descompactar nada): lista as partes e
// os tamanhos declarados -- protege contra "zip bomb" antes de abrir.
export function inspecionarZip(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) {
    throw new ErroLeitura('O arquivo não é um .xlsx válido (formato zip não reconhecido).');
  }
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ErroLeitura('O arquivo .xlsx está corrompido (fim do zip não encontrado).');
  const total = u16(bytes, fim + 10);
  const inicio = u32(bytes, fim + 16);
  if (total === 0xffff || inicio === 0xffffffff) throw new ErroLeitura('Arquivo .xlsx em formato zip64 não é aceito.');
  if (total > ENTRADAS_MAXIMAS) throw new ErroLeitura('O arquivo tem partes internas demais para um relatório do G3.');

  const entradas = [];
  let p = inicio;
  let descompactado = 0;
  for (let k = 0; k < total; k += 1) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) {
      throw new ErroLeitura('O arquivo .xlsx está corrompido (diretório do zip inválido).');
    }
    const comprimido = u32(bytes, p + 20);
    const tamanho = u32(bytes, p + 24);
    const nLen = u16(bytes, p + 28);
    const extra = u16(bytes, p + 30);
    const coment = u16(bytes, p + 32);
    const nome = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nLen));
    entradas.push({ nome, tamanho, comprimido, metodo: u16(bytes, p + 10) });
    descompactado += tamanho;
    p += 46 + nLen + extra + coment;
  }
  if (descompactado > DESCOMPACTADO_MAXIMO) {
    throw new ErroLeitura('O conteúdo descompactado do arquivo é grande demais para um relatório do G3.');
  }
  return { entradas, descompactado };
}

function valorDaCelula(celula) {
  if (!celula) return null;
  switch (celula.t) {
    case 'n':
      return Number.isFinite(celula.v) ? celula.v : null;
    case 's':
    case 'str':
      return celula.v === '' ? null : String(celula.v);
    case 'b':
      return celula.v ? 'VERDADEIRO' : 'FALSO'; // nunca existe no G3: o servidor recusa como célula ilegível
    case 'e':
      return '#ERRO';
    case 'd':
      return celula.v instanceof Date ? celula.v.toISOString() : String(celula.v);
    default:
      return celula.v === undefined || celula.v === null || celula.v === '' ? null : String(celula.v);
  }
}

// Linhas da planilha: o índice do array = número da linha no Excel - 1.
// Vazios finais de cada linha são removidos.
function extrairLinhas(XLSX, aba) {
  const ref = aba['!ref'];
  if (!ref) return { linhas: [], formulas: 0 };
  const faixa = XLSX.utils.decode_range(ref);
  if (faixa.e.r + 1 > LINHAS_MAXIMAS) throw new ErroLeitura('O arquivo tem linhas demais para um relatório do G3.');
  if (faixa.e.c + 1 > COLUNAS_MAXIMAS) throw new ErroLeitura('O arquivo tem colunas demais para um relatório do G3.');
  const dados = aba['!data'] || [];
  const linhas = [];
  let formulas = 0;
  for (let r = 0; r <= faixa.e.r; r += 1) {
    const origem = dados[r] || [];
    const linha = [];
    for (let c = 0; c <= faixa.e.c; c += 1) {
      const celula = origem[c];
      if (celula && celula.f) formulas += 1;
      linha.push(valorDaCelula(celula));
    }
    while (linha.length && linha[linha.length - 1] === null) linha.pop();
    linhas.push(linha);
  }
  while (linhas.length && linhas[linhas.length - 1].length === 0) linhas.pop();
  return { linhas, formulas };
}

let sheetjs;
async function carregarSheetJS() {
  if (!sheetjs) {
    const m = await import('xlsx');
    sheetjs = m.read ? m : m.default;
  }
  return sheetjs;
}

// bytes: ArrayBuffer | Uint8Array do arquivo escolhido.
// Devolve { linhas, metadados } ou lança ErroLeitura com mensagem para a tela.
export async function lerPlanilha(bytes) {
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (dados.length === 0) throw new ErroLeitura('O arquivo está vazio.');
  if (dados.length > TAMANHO_MAXIMO) throw new ErroLeitura('O arquivo é maior que 30 MB.');

  const { entradas } = inspecionarZip(dados);
  const nomes = new Set(entradas.map((e) => e.nome));
  const macros = [...nomes].some((n) => /vbaProject\.bin$/i.test(n));
  if (macros) throw new ErroLeitura('O arquivo contém macros. Use o relatório exportado do G3, sem edição.');
  if (!nomes.has('xl/workbook.xml')) throw new ErroLeitura('O arquivo não é uma planilha .xlsx (pasta de trabalho não encontrada).');
  const textosCompartilhados = nomes.has('xl/sharedStrings.xml');

  const XLSX = await carregarSheetJS();
  let livro;
  try {
    livro = XLSX.read(dados, {
      type: 'array',
      dense: true,
      cellFormula: true, // só para DETECTAR fórmulas (nada é calculado)
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: false,
      cellDates: false,
      bookVBA: false,
      bookDeps: false,
      sheetStubs: false,
      WTF: false,
    });
  } catch {
    throw new ErroLeitura('Não foi possível ler a planilha. Confirme que é o .xlsx exportado do G3.');
  }
  if (livro.bookType && livro.bookType !== 'xlsx') {
    throw new ErroLeitura('Somente arquivos .xlsx são aceitos.');
  }
  const abas = livro.SheetNames || [];
  if (abas.length !== 1) {
    throw new ErroLeitura(`O arquivo tem ${abas.length} abas; o relatório do G3 tem exatamente uma.`);
  }
  const { linhas, formulas } = extrairLinhas(XLSX, livro.Sheets[abas[0]]);
  if (formulas > 0) {
    throw new ErroLeitura('O arquivo contém fórmulas: o relatório do G3 nunca tem fórmulas, então ele foi editado.');
  }
  const produtor = String(livro.Props?.Application || '').slice(0, 60) || null;
  return {
    linhas,
    metadados: {
      abas: abas.length,
      aba: abas[0],
      formulas,
      macros: false,
      textosCompartilhados,
      produtor,
      // "original" = gerado pelo próprio G3 (SheetJS, textos na célula). Só
      // informativo: arquivo regravado é aceito se passar nas validações.
      original: produtor === 'SheetJS' && !textosCompartilhados,
    },
  };
}
