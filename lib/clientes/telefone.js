// Telefone de cliente (migration 0069) -- espelho da regra do banco
// (public.clientes_normalizar_telefone): o banco é quem decide; aqui é só
// para a tela avisar antes de salvar e para exibir/pesquisar.
//
// ARMAZENAMENTO: somente dígitos, formato nacional = DDD (2 dígitos, sem
// zero) + número -- celular com 9 dígitos começando por 9 (11 no total) ou
// fixo com 8 dígitos começando de 2 a 8 (10 no total). Internacional
// (E.164) para uma integração futura: '+55' + telefone.
// EXIBIÇÃO: (11) 98765-4321 / (31) 3456-7890.
// PESQUISA: pelos dígitos digitados, em qualquer parte do número.

const PADRAO = /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/;

export function somenteDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}

// Texto digitado -> dígitos nacionais, ou null se não for um telefone
// brasileiro válido. Aceita máscara, +55/0055 e 0 de operadora antes de
// celular (0 + DDD + 9 dígitos).
export function normalizarTelefone(texto) {
  let v = somenteDigitos(texto);
  if (v.startsWith('0055')) v = v.slice(4);
  if ((v.length === 12 || v.length === 13) && v.startsWith('55')) v = v.slice(2);
  if (v.length === 12 && v.startsWith('0')) v = v.slice(1);
  return PADRAO.test(v) ? v : null;
}

export function telefoneValido(texto) {
  return normalizarTelefone(texto) !== null;
}

// Dígitos já normalizados -> exibição. Qualquer outra coisa volta como veio.
export function formatarTelefone(digitos) {
  const d = somenteDigitos(digitos);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos || '';
}

// Máscara enquanto digita: (DD) NNNNN-NNNN ou (DD) NNNN-NNNN, até 11
// dígitos. Se o texto tiver +55/0055, devolve como está (o banco normaliza).
export function mascararTelefoneDigitando(texto) {
  const bruto = String(texto ?? '');
  if (/^\s*(\+|00)/.test(bruto)) return bruto;
  const d = somenteDigitos(bruto).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  const corte = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

export function telefoneE164(digitos) {
  return normalizarTelefone(digitos) ? `+55${normalizarTelefone(digitos)}` : null;
}
