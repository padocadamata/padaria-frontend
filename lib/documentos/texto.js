// Comunicação / Documentos de RH (migration 0077) -- regras de TEXTO
// compartilhadas com o banco. Funções PURAS.
//
// O banco (folha_documento_emitir) é quem emite de verdade; o navegador só
// monta a prévia. Para os dois nunca divergirem, toda regra aqui tem a
// MESMA definição na migration (testado em lib/documentos/__tests__):
//   * aparar  = btrim(x, E' \t\n\r')  -- só espaço, tab e quebras de linha
//     (o trim() do JS também removeria espaços Unicode; o btrim() do
//     Postgres, só espaço -- por isso nenhum dos dois é usado direto);
//   * tamanho = char_length (conta caracteres, não unidades UTF-16).

const BORDAS = /^[ \t\n\r]+|[ \t\n\r]+$/g;

export function aparar(texto) {
  return String(texto).replace(BORDAS, '');
}

export function tamanho(texto) {
  return [...String(texto)].length;
}

// \r\n e \r viram \n (texto colado do Windows/Word).
export function normalizarQuebras(texto) {
  return String(texto).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Texto opcional: aparado; vazio vira null (mesma regra dos dados
// automáticos de funcionário/empresa no banco).
export function textoOuNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const t = aparar(valor);
  return t === '' ? null : t;
}

export function ehObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}
