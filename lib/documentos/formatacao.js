// Formatação DETERMINÍSTICA dos valores que entram no texto do documento
// (migration 0077). Mesma definição das funções folha_documentos_* da
// migration -- nada aqui depende do fuso ou do idioma do navegador
// (sem toLocaleString/Intl): datas são aritmética de calendário sobre
// 'AAAA-MM-DD'.

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const DATA_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function partesData(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return { ano, mes, dia };
}

// Data real no calendário, entre 1900 e 2100 (fora disso é quase sempre
// erro de digitação).
export function dataValida(iso) {
  if (typeof iso !== 'string' || !DATA_ISO.test(iso)) return false;
  const { ano, mes, dia } = partesData(iso);
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12) return false;
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia >= 1 && dia <= diasNoMes;
}

// 'AAAA-MM-DD' -> 'DD/MM/AAAA'. Vazio continua vazio.
export function formatarData(iso) {
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// '2026-10-26' -> '26 de outubro de 2026'; dia 1 -> '1º de ...'.
export function formatarDataExtenso(iso) {
  const { ano, mes, dia } = partesData(iso);
  return `${dia === 1 ? '1º' : dia} de ${MESES[mes - 1]} de ${ano}`;
}

function somenteDigitos(valor) {
  return String(valor).replace(/[^0-9]/g, '');
}

// 11 dígitos -> 000.000.000-00; qualquer outra coisa sai como está (o
// cadastro já guarda só dígitos -- nunca inventamos máscara em dado
// incompleto).
export function formatarCpf(valor) {
  const d = somenteDigitos(valor);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : valor;
}

export function formatarCnpj(valor) {
  const d = somenteDigitos(valor);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : valor;
}

// Número do campo, guardado canônico ('1234.5') -> '1234,5'. Sem separador
// de milhar: o texto mostra exatamente os dígitos informados.
export function formatarNumero(canonico) {
  return String(canonico).replace('.', ',');
}

// Número do documento: '2026/0007' (4 dígitos; acima de 9999, sem cortar).
export function formatarNumeroDocumento(ano, numero) {
  const n = String(numero);
  return `${ano}/${n.length < 4 ? n.padStart(4, '0') : n}`;
}
