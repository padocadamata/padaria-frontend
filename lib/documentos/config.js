// Dados institucionais (folha_documentos_config, migration 0077) -- mesma
// regra de CNPJ de folha_documentos_config_salvar. O banco é a autoridade
// (CHECK + RPC); aqui é só para a tela avisar antes de salvar.
//
// CNPJ: vazio = NULL; aceita com ou sem máscara (00.000.000/0000-00 --
// só ponto, barra, hífen e espaço são descartados, letras não); grava os
// 14 dígitos; dígitos verificadores conferidos (cnpjValido, o mesmo do
// cadastro de Funcionários; no banco, folha_documentos_cnpj_valido).

import { cnpjValido } from '../funcionarios/normalizacao.js';
import { erro } from './erros.js';
import { aparar } from './texto.js';

// -> { cnpj: '14 dígitos' | null, erros }
export function normalizarCnpjConfig(texto) {
  const limpo = aparar(texto ?? '');
  if (limpo === '') return { cnpj: null, erros: [] };
  const digitos = limpo.replace(/[./ -]/g, '');
  if (!/^[0-9]{14}$/.test(digitos) || !cnpjValido(digitos)) {
    return { cnpj: null, erros: [erro('config_cnpj_invalido', 'CNPJ inválido -- confira os números.')] };
  }
  return { cnpj: digitos, erros: [] };
}
