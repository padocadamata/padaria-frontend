// Campos configuráveis dos modelos de documento (migration 0077) --
// definição (JSONB folha_documentos_modelos.campos) e valores digitados na
// emissão. Funções PURAS.
//
// A ORDEM das verificações é a mesma das funções do banco
// (folha_documentos_campos_validar / folha_documentos_valores_normalizar):
// o banco para no 1º erro, e esse 1º erro é sempre o 1º da lista daqui
// (testado contra o SQL real em __tests__/paridadeSql.test.mjs).

import { erro } from './erros.js';
import { dataValida, formatarData, formatarNumero } from './formatacao.js';
import { CHAVES_RESERVADAS } from './placeholders.js';
import { aparar, ehObjeto, normalizarQuebras, tamanho } from './texto.js';

export const TIPOS_CAMPO = ['texto', 'texto_longo', 'data', 'selecao', 'numero'];

export const ROTULO_TIPO_CAMPO = {
  texto: 'Texto curto',
  texto_longo: 'Texto longo',
  data: 'Data',
  selecao: 'Seleção',
  numero: 'Número',
};

// papel: promove o valor do campo para uma coluna do documento emitido
// (histórico filtrável/ordenável sem olhar dentro do JSON).
export const PAPEIS_CAMPO = ['assunto', 'data_ocorrencia'];
const TIPOS_DO_PAPEL = { assunto: ['texto', 'selecao'], data_ocorrencia: ['data'] };

export const LIMITES_CAMPOS = {
  campos: 30,
  rotulo: 80,
  dica: 200,
  opcoes: 50,
  opcao: 100,
  texto: 200,
  textoLongo: 4000,
};

const PROPRIEDADES = ['chave', 'rotulo', 'tipo', 'obrigatorio', 'opcoes', 'dica', 'papel'];
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{0,39}$/;
const NUMERO_VALIDO = /^-?[0-9]{1,12}([.,][0-9]{1,4})?$/;

const presente = (v) => v !== undefined && v !== null;

function opcoesValidas(opcoes) {
  if (!Array.isArray(opcoes) || opcoes.length < 1 || opcoes.length > LIMITES_CAMPOS.opcoes) return false;
  const vistas = new Set();
  for (const opcao of opcoes) {
    if (typeof opcao !== 'string') return false;
    const t = aparar(opcao);
    if (t === '' || tamanho(t) > LIMITES_CAMPOS.opcao || vistas.has(t)) return false;
    vistas.add(t);
  }
  return true;
}

// Lista de erros na ordem do banco (vazia = definição válida).
export function validarCampos(campos) {
  if (!Array.isArray(campos)) return [erro('campos_formato', 'A lista de campos do modelo é inválida.')];
  if (campos.length > LIMITES_CAMPOS.campos) {
    return [erro('campos_quantidade', `O modelo pode ter no máximo ${LIMITES_CAMPOS.campos} campos.`)];
  }

  const erros = [];
  const chaves = new Set();
  const papeis = new Set();
  campos.forEach((campo, indice) => {
    const n = indice + 1;
    const add = (codigo, mensagem) => erros.push(erro(codigo, mensagem, { indice }));
    if (!ehObjeto(campo)) {
      add('campo_formato', `Campo ${n}: definição inválida.`);
      return;
    }
    if (Object.keys(campo).some((p) => !PROPRIEDADES.includes(p))) {
      add('campo_propriedade_desconhecida', `Campo ${n}: possui uma propriedade desconhecida.`);
    }
    const chave = campo.chave;
    if (typeof chave !== 'string' || !CHAVE_VALIDA.test(chave)) {
      add('campo_chave_invalida', `Campo ${n}: a chave deve começar com letra minúscula e ter só letras minúsculas, números e "_" (até 40).`);
    } else if (CHAVES_RESERVADAS.includes(chave)) {
      add('campo_chave_reservada', `Campo ${n}: a chave "${chave}" é reservada para variáveis automáticas.`);
    } else if (chaves.has(chave)) {
      add('campo_chave_duplicada', `Campo ${n}: a chave "${chave}" já é usada por outro campo.`);
    }
    if (typeof chave === 'string') chaves.add(chave);

    if (typeof campo.rotulo !== 'string' || aparar(campo.rotulo) === '' || tamanho(aparar(campo.rotulo)) > LIMITES_CAMPOS.rotulo) {
      add('campo_rotulo_invalido', `Campo ${n}: informe o rótulo (até ${LIMITES_CAMPOS.rotulo} caracteres).`);
    }
    const tipoValido = TIPOS_CAMPO.includes(campo.tipo);
    if (!tipoValido) add('campo_tipo_invalido', `Campo ${n}: tipo de campo inválido.`);
    if (typeof campo.obrigatorio !== 'boolean') add('campo_obrigatorio_invalido', `Campo ${n}: indique se o campo é obrigatório.`);
    if (presente(campo.dica) && (typeof campo.dica !== 'string' || tamanho(aparar(campo.dica)) > LIMITES_CAMPOS.dica)) {
      add('campo_dica_invalida', `Campo ${n}: a dica pode ter até ${LIMITES_CAMPOS.dica} caracteres.`);
    }
    if (campo.tipo === 'selecao') {
      if (!opcoesValidas(campo.opcoes)) {
        add('campo_opcoes_invalidas', `Campo ${n}: a seleção precisa de 1 a ${LIMITES_CAMPOS.opcoes} opções, não vazias e sem repetição (até ${LIMITES_CAMPOS.opcao} caracteres cada).`);
      }
    } else if (presente(campo.opcoes)) {
      add('campo_opcoes_indevidas', `Campo ${n}: só campos de seleção têm opções.`);
    }
    if (presente(campo.papel)) {
      if (!PAPEIS_CAMPO.includes(campo.papel)) {
        add('campo_papel_invalido', `Campo ${n}: papel inválido.`);
      } else if (tipoValido && !TIPOS_DO_PAPEL[campo.papel].includes(campo.tipo)) {
        add('campo_papel_incompativel', campo.papel === 'assunto'
          ? `Campo ${n}: o assunto precisa ser texto curto ou seleção.`
          : `Campo ${n}: a data da ocorrência precisa ser um campo de data.`);
      } else if (papeis.has(campo.papel)) {
        add('campo_papel_repetido', campo.papel === 'assunto'
          ? `Campo ${n}: só um campo pode ser o assunto.`
          : `Campo ${n}: só um campo pode ser a data da ocorrência.`);
      }
      if (PAPEIS_CAMPO.includes(campo.papel)) papeis.add(campo.papel);
    }
  });
  return erros;
}

// Forma canônica gravada no banco (pressupõe validarCampos sem erros):
// textos aparados; opcoes só na seleção; dica/papel só quando existem.
export function normalizarCampos(campos) {
  return campos.map((c) => {
    const campo = { chave: c.chave, rotulo: aparar(c.rotulo), tipo: c.tipo, obrigatorio: c.obrigatorio };
    if (c.tipo === 'selecao') campo.opcoes = c.opcoes.map(aparar);
    if (presente(c.dica) && aparar(c.dica) !== '') campo.dica = aparar(c.dica);
    if (presente(c.papel)) campo.papel = c.papel;
    return campo;
  });
}

// Valores digitados na emissão -> { valores (canônicos, string por campo;
// '' = vazio), erros }. Datas 'AAAA-MM-DD'; número com ponto decimal e sem
// zeros à esquerda. hoje ('AAAA-MM-DD'): a data da ocorrência não pode ser
// futura.
export function validarValores(campos, valores, { hoje }) {
  if (!ehObjeto(valores)) return { valores: {}, erros: [erro('valores_formato', 'Os valores do formulário são inválidos.')] };
  const chaves = new Set(campos.map((c) => c.chave));
  if (Object.keys(valores).some((k) => !chaves.has(k))) {
    return { valores: {}, erros: [erro('valor_campo_desconhecido', 'O formulário enviou um campo que não existe neste modelo.')] };
  }

  const saida = {};
  const erros = [];
  for (const campo of campos) {
    const add = (codigo, mensagem) => erros.push(erro(codigo, mensagem, { chave: campo.chave }));
    const bruto = valores[campo.chave];
    if (presente(bruto) && typeof bruto !== 'string') {
      add('valor_tipo_invalido', `${campo.rotulo}: valor inválido.`);
      saida[campo.chave] = '';
      continue;
    }
    let v = presente(bruto) ? bruto : '';
    if (campo.tipo === 'texto_longo') v = normalizarQuebras(v);
    v = aparar(v);

    if (v !== '') {
      if (campo.tipo === 'texto') {
        if (/[\r\n]/.test(v)) add('valor_texto_quebra_linha', `${campo.rotulo}: use uma única linha.`);
        else if (tamanho(v) > LIMITES_CAMPOS.texto) add('valor_longo', `${campo.rotulo}: até ${LIMITES_CAMPOS.texto} caracteres.`);
      } else if (campo.tipo === 'texto_longo') {
        if (tamanho(v) > LIMITES_CAMPOS.textoLongo) add('valor_longo', `${campo.rotulo}: até ${LIMITES_CAMPOS.textoLongo} caracteres.`);
      } else if (campo.tipo === 'data') {
        if (!dataValida(v)) add('valor_data_invalida', `${campo.rotulo}: data inválida.`);
        else if (campo.papel === 'data_ocorrencia' && v > hoje) add('valor_data_futura', `${campo.rotulo}: a data da ocorrência não pode ser no futuro.`);
      } else if (campo.tipo === 'selecao') {
        if (!campo.opcoes.includes(v)) add('valor_opcao_invalida', `${campo.rotulo}: escolha uma das opções.`);
      } else if (campo.tipo === 'numero') {
        if (!NUMERO_VALIDO.test(v)) add('valor_numero_invalido', `${campo.rotulo}: número inválido (até 12 dígitos e 4 casas decimais).`);
        else v = v.replace(',', '.').replace(/^(-?)0+(?=[0-9])/, '$1');
      }
    }
    if (v === '' && campo.obrigatorio) add('valor_obrigatorio', `${campo.rotulo}: preenchimento obrigatório.`);
    saida[campo.chave] = v;
  }
  return { valores: saida, erros };
}

// Valor canônico -> texto que entra no documento.
export function formatarValorCampo(campo, valor) {
  if (valor === '') return '';
  if (campo.tipo === 'data') return formatarData(valor);
  if (campo.tipo === 'numero') return formatarNumero(valor);
  return valor;
}
