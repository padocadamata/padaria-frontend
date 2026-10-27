// Modelos de documento (migration 0077) -- validação completa do que o
// editor envia para folha_documento_modelo_salvar. Funções PURAS.
// Mesma ordem de verificação de folha_documentos_modelo_validar no banco.

import { normalizarCampos, validarCampos } from './campos.js';
import { erro } from './erros.js';
import { analisarPlaceholders, automaticaSomenteIndividual, ehAutomatica } from './placeholders.js';
import { aparar, normalizarQuebras, tamanho } from './texto.js';

export const ABRANGENCIAS = ['individual', 'geral'];

export const ROTULO_ABRANGENCIA = { individual: 'Individual', geral: 'Geral' };

export const LIMITES_MODELO = { nome: 80, titulo: 120, descricao: 300, corpo: 20000, testemunhas: 2 };

const texto = (v) => (typeof v === 'string' ? v : '');

// Chave de UNICIDADE do nome do modelo: "Advertência", " ADVERTENCIA " e
// "advertencia" são o mesmo nome. Aparado, em NFC (acento de texto
// decomposto conta igual), sem acento e minúsculo por uma tabela FIXA de
// caracteres -- a mesma de folha_documentos_nome_chave no banco (índice
// único), que usa translate() em vez de lower()/unaccent para não
// depender de locale nem de extensão. Letras fora da tabela ficam como
// estão (nos dois lados).
const COM_ACENTO = 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SEM_ACENTO = 'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccnnyyyabcdefghijklmnopqrstuvwxyz';
const TABELA_NOME = new Map([...COM_ACENTO].map((c, i) => [c, SEM_ACENTO[i]]));

export function chaveNomeModelo(nome) {
  return [...aparar(texto(nome)).normalize('NFC')].map((c) => TABELA_NOME.get(c) ?? c).join('');
}

// Forma canônica dos textos do modelo (o banco grava exatamente isto).
export function normalizarTextosModelo(modelo) {
  const descricao = aparar(texto(modelo.descricao));
  return {
    nome: aparar(texto(modelo.nome)),
    titulo_impresso: aparar(texto(modelo.titulo_impresso)),
    descricao: descricao === '' ? null : descricao,
    corpo: aparar(normalizarQuebras(texto(modelo.corpo))),
  };
}

// modelo: { nome, titulo_impresso, descricao, abrangencia, corpo, campos,
//   assinatura_empresa, assinatura_funcionario, testemunhas, local_data }.
// Devolve a lista de erros (vazia = pode salvar).
export function validarModelo(modelo) {
  const erros = [];
  const { nome, titulo_impresso: titulo, descricao, corpo } = normalizarTextosModelo(modelo);
  const abrangencia = modelo.abrangencia;

  if (!ABRANGENCIAS.includes(abrangencia)) erros.push(erro('modelo_abrangencia_invalida', 'Escolha se o documento é individual ou geral.'));
  if (nome === '' || tamanho(nome) > LIMITES_MODELO.nome) erros.push(erro('modelo_nome_invalido', `Informe o nome do modelo (até ${LIMITES_MODELO.nome} caracteres).`));
  if (titulo === '' || tamanho(titulo) > LIMITES_MODELO.titulo) erros.push(erro('modelo_titulo_invalido', `Informe o título impresso (até ${LIMITES_MODELO.titulo} caracteres).`));
  if (descricao !== null && tamanho(descricao) > LIMITES_MODELO.descricao) erros.push(erro('modelo_descricao_invalida', `A descrição pode ter até ${LIMITES_MODELO.descricao} caracteres.`));
  if (corpo === '') erros.push(erro('modelo_corpo_vazio', 'Escreva o texto do documento.'));
  else if (tamanho(corpo) > LIMITES_MODELO.corpo) erros.push(erro('modelo_corpo_longo', `O texto pode ter até ${LIMITES_MODELO.corpo} caracteres.`));

  const t = modelo.testemunhas;
  if (!Number.isInteger(t) || t < 0 || t > LIMITES_MODELO.testemunhas) erros.push(erro('modelo_testemunhas_invalidas', 'Testemunhas: 0, 1 ou 2.'));
  if (modelo.assinatura_funcionario === true && abrangencia === 'geral') {
    erros.push(erro('modelo_assinatura_funcionario_geral', 'Documento geral não tem assinatura de funcionário.'));
  }

  const errosCampos = validarCampos(modelo.campos);
  erros.push(...errosCampos);
  const campos = Array.isArray(modelo.campos) ? modelo.campos : [];
  const chavesCampos = new Set(campos.filter((c) => c && typeof c.chave === 'string').map((c) => c.chave));

  const { nomes, malformado } = analisarPlaceholders(corpo);
  if (malformado) {
    erros.push(erro('placeholder_malformado', 'O texto tem uma variável mal escrita: use {{nome}} sem espaços, só letras minúsculas, números e "_".'));
  }
  for (const nomeVar of nomes) {
    if (ehAutomatica(nomeVar)) {
      if (abrangencia === 'geral' && automaticaSomenteIndividual(nomeVar)) {
        erros.push(erro('placeholder_funcionario_em_geral', `{{${nomeVar}}} só pode ser usada em documento individual.`, { variavel: nomeVar }));
      }
    } else if (!chavesCampos.has(nomeVar)) {
      erros.push(erro('placeholder_desconhecido', `{{${nomeVar}}} não é uma variável automática nem um campo deste modelo.`, { variavel: nomeVar }));
    }
  }

  // Campo sem papel que não aparece no texto não serve para nada (o de
  // papel alimenta o histórico mesmo fora do texto).
  if (errosCampos.length === 0) {
    for (const campo of campos) {
      if (campo.papel == null && !nomes.includes(campo.chave)) {
        erros.push(erro('campo_nao_utilizado', `O campo "${aparar(campo.rotulo)}" não aparece no texto.`, { chave: campo.chave }));
      }
    }
  }
  return erros;
}

// Payload pronto para a RPC (pressupõe validarModelo sem erros).
export function normalizarModelo(modelo) {
  return {
    ...normalizarTextosModelo(modelo),
    abrangencia: modelo.abrangencia,
    campos: normalizarCampos(modelo.campos),
    assinatura_empresa: modelo.assinatura_empresa === true,
    assinatura_funcionario: modelo.assinatura_funcionario === true,
    testemunhas: modelo.testemunhas,
    local_data: modelo.local_data === true,
  };
}
