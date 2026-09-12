// Normalização de dados mestres de Funcionários (Fase 1, migration 0054).
// Regra global do projeto: dados mestres são persistidos em MAIÚSCULAS,
// preservando acentos, normalizados na PERSISTÊNCIA (antes do INSERT/
// UPDATE) -- nunca só na exibição via CSS. Mesmo padrão já usado em
// components/agenda/GerenciarCategoriasAgendaModal.js e
// components/catalogo/GerenciarClassificacoesModal.js. O banco não impõe
// isso via trigger (mesmo raciocínio dessas duas telas) -- é contrato do
// frontend.
export function normalizarMaiusculas(texto) {
  return (texto || '').trim().toUpperCase();
}

// E-mail nunca é uppercased (decisão explícita desta frente) -- só trim +
// string vazia vira null.
export function normalizarEmail(texto) {
  const limpo = (texto || '').trim();
  return limpo || null;
}

// CPF: normaliza para somente dígitos antes de persistir. String vazia
// (ou só não-dígitos) vira null -- CPF é opcional.
export function normalizarCpf(texto) {
  const digitos = (texto || '').replace(/\D/g, '');
  return digitos || null;
}

// Formata 11 dígitos para exibição (000.000.000-00). Usado só para
// mostrar um CPF já salvo -- nunca para validar.
export function formatarCpf(digitos) {
  if (!digitos || digitos.length !== 11) return digitos || '';
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9, 11)}`;
}

// Validação MÍNIMA de CPF (algoritmo padrão dos 2 dígitos verificadores),
// suficiente para pegar erro de digitação sem transformar isto num
// cadastro complexo de RH. Espera string já normalizada (só dígitos).
// CPF vazio/null é válido aqui -- é opcional; quem exige preenchimento é
// a tela, não esta função.
export function cpfValido(digitos) {
  if (!digitos) return true;
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false; // 11 dígitos repetidos (ex.: 00000000000)

  function digitoVerificador(base) {
    let soma = 0;
    let peso = base.length + 1;
    for (const c of base) {
      soma += Number(c) * peso;
      peso -= 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  const nove = digitos.slice(0, 9);
  const d1 = digitoVerificador(nove);
  const d2 = digitoVerificador(nove + String(d1));
  return digitos === nove + String(d1) + String(d2);
}

// Lista fechada de UF -- não é um cadastro no banco, só uma constante de
// UI (mesmo raciocínio de não criar uma tabela para algo que nunca muda).
export const UNIDADES_FEDERATIVAS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
];
