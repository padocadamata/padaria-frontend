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

// ------------------------------------------------------------
// Chave PIX (migration 0056, Folha de Pagamento > Cadastro e
// Parametrizações, Etapa A) -- validação de FORMATO por tipo, inteiramente
// no frontend (o banco só garante coerência tipo+chave, nunca formato).
// ------------------------------------------------------------

export const TIPOS_CHAVE_PIX = [
  { valor: 'cpf', rotulo: 'CPF' },
  { valor: 'cnpj', rotulo: 'CNPJ' },
  { valor: 'celular', rotulo: 'Celular' },
  { valor: 'email', rotulo: 'E-mail' },
  { valor: 'aleatoria', rotulo: 'Chave aleatória' },
];

// CNPJ: normaliza para somente dígitos. String vazia (ou só não-dígitos)
// vira null -- mesmo contrato de normalizarCpf.
export function normalizarCnpj(texto) {
  const digitos = (texto || '').replace(/\D/g, '');
  return digitos || null;
}

// Formata 14 dígitos para exibição (00.000.000/0000-00). Só para mostrar
// um CNPJ já salvo -- nunca para validar.
export function formatarCnpj(digitos) {
  if (!digitos || digitos.length !== 14) return digitos || '';
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`;
}

// Validação completa de CNPJ (2 dígitos verificadores, algoritmo padrão da
// Receita Federal) -- mesmo espírito de cpfValido: suficiente para pegar
// erro de digitação, sem virar um cadastro fiscal complexo. Espera string
// já normalizada (só dígitos).
export function cnpjValido(digitos) {
  if (!digitos) return true;
  if (digitos.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digitos)) return false; // 14 dígitos repetidos

  function digitoVerificador(base, pesos) {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * pesos[i];
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  const doze = digitos.slice(0, 12);
  const pesosD1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = digitoVerificador(doze, pesosD1);
  const pesosD2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d2 = digitoVerificador(doze + String(d1), pesosD2);
  return digitos === doze + String(d1) + String(d2);
}

// Celular: validação LEVE (nunca excessiva) -- só confere que, tirando
// tudo que não é dígito, sobra uma quantidade plausível de dígitos para um
// telefone brasileiro (10-11 sem código do país, até 13 com +55). Não
// valida DDD específico nem exige o 9º dígito -- números antigos/fixos
// também podem ser chave PIX.
export function celularValido(texto) {
  const digitos = (texto || '').replace(/\D/g, '');
  if (!digitos) return true;
  return digitos.length >= 10 && digitos.length <= 13;
}

// E-mail: validação básica (formato usuario@dominio.algo), mesmo padrão
// leve já usado no projeto para não-CPF -- não tenta cobrir todo o RFC.
export function emailValido(texto) {
  const limpo = (texto || '').trim();
  if (!limpo) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);
}

// Chave aleatória: formato UUID (RFC 4122), sem consultar nenhum serviço
// externo -- só a forma 8-4-4-4-12 em hexadecimal, case-insensitive (é
// exatamente o que o Bacen gera para esse tipo de chave).
export function chaveAleatoriaValida(texto) {
  const limpo = (texto || '').trim();
  if (!limpo) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpo);
}

// Normaliza a chave conforme o tipo, antes de persistir -- mesmo contrato
// de normalizarCpf/normalizarCnpj (dígitos para cpf/cnpj/celular; trim
// simples para email/aleatória, sem forçar maiúsculas/minúsculas).
export function normalizarChavePix(tipo, valor) {
  const limpo = (valor || '').trim();
  if (!limpo) return null;
  if (tipo === 'cpf' || tipo === 'cnpj' || tipo === 'celular') {
    return limpo.replace(/\D/g, '') || null;
  }
  return limpo;
}

// Valida a chave conforme o tipo -- despachante único usado pelo
// formulário, para nunca duplicar a regra de cada tipo em mais de um
// lugar. Chave vazia é sempre válida aqui (opcional é decisão da tela via
// funcionarios_chave_pix_coerente, não desta função).
export function chavePixValida(tipo, valor) {
  const normalizado = normalizarChavePix(tipo, valor);
  if (!normalizado) return true;
  if (tipo === 'cpf') return cpfValido(normalizado);
  if (tipo === 'cnpj') return cnpjValido(normalizado);
  if (tipo === 'celular') return celularValido(valor);
  if (tipo === 'email') return emailValido(valor);
  if (tipo === 'aleatoria') return chaveAleatoriaValida(valor);
  return true;
}
