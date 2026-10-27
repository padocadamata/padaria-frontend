// Emissão de documento (migration 0077) -- o MESMO cálculo que
// folha_documento_emitir faz no banco, para a prévia. Funções PURAS.
//
// Quem emite de verdade é o banco: ele relê modelo, funcionário e empresa,
// valida tudo de novo, gera o número e grava conteúdo + snapshot. Aqui o
// resultado é só a prévia -- mas com a mesma regra, então o que a pessoa vê
// é o que será emitido (paridade testada contra o SQL real em
// __tests__/paridadeSql.test.mjs).
//
// Entradas (linhas do banco, como o Supabase devolve):
//   modelo      -- folha_documentos_modelos
//   funcionario -- { id, nome, cpf, rg, cargo (nome do cargo), data_admissao } | null
//   empresa     -- folha_documentos_config
//   valores     -- { chave: string } digitados no formulário
//   dataEmissao -- 'AAAA-MM-DD'
//   numero      -- { ano, numero } na emissão; null na prévia

import { formatarValorCampo, validarValores } from './campos.js';
import { erro } from './erros.js';
import { formatarCnpj, formatarCpf, formatarData, formatarDataExtenso, formatarNumeroDocumento } from './formatacao.js';
import { analisarPlaceholders, resolverTemplate } from './placeholders.js';
import { textoOuNulo } from './texto.js';

// Versão do layout gravada no snapshot. Mudou o desenho do documento de um
// jeito que alteraria documentos antigos? Crie a versão 2 em documento.js
// e mantenha a 1 renderizando como sempre.
export const LAYOUT_VERSAO = 1;

// Texto do número na prévia (o número real só existe na emissão).
export const NUMERO_PREVIA = '(número gerado na emissão)';

// Dados automáticos crus do funcionário -- só o que as variáveis podem
// usar, nunca o cadastro inteiro. Servem para CALCULAR as variáveis; o
// snapshot guarda menos (ver snapshotFuncionario / variaveisUsadas).
export function dadosFuncionario(funcionario) {
  if (!funcionario) return null;
  return {
    id: funcionario.id,
    nome: textoOuNulo(funcionario.nome),
    cpf: textoOuNulo(funcionario.cpf),
    rg: textoOuNulo(funcionario.rg),
    cargo: textoOuNulo(funcionario.cargo),
    admissao: funcionario.data_admissao || null,
  };
}

export function dadosEmpresa(config) {
  const c = config || {};
  return {
    nome: textoOuNulo(c.nome_fantasia),
    razao_social: textoOuNulo(c.razao_social),
    cnpj: textoOuNulo(c.cnpj),
    endereco: textoOuNulo(c.endereco),
    cidade_uf: textoOuNulo(c.cidade_uf),
    responsavel: textoOuNulo(c.responsavel_nome),
    responsavel_cargo: textoOuNulo(c.responsavel_cargo),
  };
}

// Todas as variáveis do escopo, já formatadas (null = dado não cadastrado).
export function montarVariaveis({ abrangencia, funcionario, empresa, dataEmissao, numeroFormatado, campos, valores }) {
  const v = {};
  if (abrangencia === 'individual') {
    v['funcionario.nome'] = funcionario.nome;
    v['funcionario.cpf'] = funcionario.cpf === null ? null : formatarCpf(funcionario.cpf);
    v['funcionario.rg'] = funcionario.rg;
    v['funcionario.cargo'] = funcionario.cargo;
    v['funcionario.admissao'] = funcionario.admissao === null ? null : formatarData(funcionario.admissao);
  }
  v['empresa.nome'] = empresa.nome;
  v['empresa.razao_social'] = empresa.razao_social;
  v['empresa.cnpj'] = empresa.cnpj === null ? null : formatarCnpj(empresa.cnpj);
  v['empresa.endereco'] = empresa.endereco;
  v['empresa.cidade_uf'] = empresa.cidade_uf;
  v['empresa.responsavel'] = empresa.responsavel;
  v['empresa.responsavel_cargo'] = empresa.responsavel_cargo;
  v.data_emissao = formatarData(dataEmissao);
  v.data_emissao_extenso = formatarDataExtenso(dataEmissao);
  v['documento.numero'] = numeroFormatado;
  for (const campo of campos) v[campo.chave] = formatarValorCampo(campo, valores[campo.chave]);
  return v;
}

// Dados que a emissão exige e ainda não estão cadastrados. Mesma ordem de
// folha_documento_emitir: razão social sempre; cidade/UF se há local e
// data; responsável se há assinatura da empresa; depois cada variável
// usada no texto (na ordem em que aparece) sem valor.
export function pendenciasDeDados(modelo, empresa, variaveis) {
  const erros = [];
  if (empresa.razao_social === null) {
    erros.push(erro('config_razao_social_ausente', 'Cadastre a razão social da empresa (Comunicação > Modelos > Dados da empresa).'));
  }
  if (modelo.local_data && empresa.cidade_uf === null) {
    erros.push(erro('config_cidade_uf_ausente', 'Cadastre a cidade/UF da empresa para o local e data do documento.'));
  }
  if (modelo.assinatura_empresa && empresa.responsavel === null) {
    erros.push(erro('config_responsavel_ausente', 'Cadastre o responsável da empresa para a assinatura institucional.'));
  }
  for (const nome of analisarPlaceholders(modelo.corpo).nomes) {
    if (variaveis[nome] === null || variaveis[nome] === undefined) {
      erros.push(erro('dado_automatico_ausente', `{{${nome}}} não tem valor cadastrado.`, { variavel: nome }));
    }
  }
  return erros;
}

// SNAPSHOT MÍNIMO: guarda o necessário para reconstruir o documento, sem
// copiar dado pessoal que ele não usa.
//   * funcionario: só id + nome (identificação e bloco de assinatura);
//   * variaveis: só as que o corpo usa ({{funcionario.cpf}} só entra --
//     já formatado -- se o modelo usar o CPF; idem RG, cargo, admissão).
//   * empresa: dados institucionais; responsável e cargo só quando o
//     modelo tem assinatura da empresa (se o corpo usar
//     {{empresa.responsavel}}, o valor entra em variaveis).
// O resto (documento, modelo, valores) é dado do próprio documento.
export function snapshotFuncionario(funcionario) {
  return funcionario ? { id: funcionario.id, nome: funcionario.nome } : null;
}

export function snapshotEmpresa(empresa, assinaturaEmpresa) {
  if (assinaturaEmpresa) return empresa;
  const resto = { ...empresa };
  delete resto.responsavel;
  delete resto.responsavel_cargo;
  return resto;
}

export function variaveisUsadas(corpo, variaveis) {
  const usadas = {};
  for (const nome of analisarPlaceholders(corpo).nomes) usadas[nome] = variaveis[nome] ?? null;
  return usadas;
}

function snapshotModelo(modelo) {
  return {
    id: modelo.id,
    nome: modelo.nome,
    versao: modelo.versao,
    titulo: modelo.titulo_impresso,
    abrangencia: modelo.abrangencia,
    corpo: modelo.corpo,
    campos: modelo.campos,
    assinaturas: {
      empresa: modelo.assinatura_empresa,
      funcionario: modelo.assinatura_funcionario,
      testemunhas: modelo.testemunhas,
      local_data: modelo.local_data,
    },
  };
}

// -> { erros } (não emite) ou { erros: [], titulo, assunto,
// data_ocorrencia, conteudo, snapshot } -- exatamente as colunas que o
// banco grava. previa: true resolve dados ausentes como "[variável]" em
// vez de recusar (a lista de pendências continua em `erros`).
export function montarEmissao({ modelo, funcionario, empresa: config, valores, dataEmissao, numero = null }, { previa = false } = {}) {
  if (modelo.abrangencia === 'individual' && !funcionario) {
    return { erros: [erro('emissao_funcionario_obrigatorio', 'Escolha o funcionário deste documento.')] };
  }
  if (modelo.abrangencia === 'geral' && funcionario) {
    return { erros: [erro('emissao_funcionario_indevido', 'Documento geral não tem funcionário.')] };
  }

  const resultadoValores = validarValores(modelo.campos, valores, { hoje: dataEmissao });
  if (resultadoValores.erros.length > 0) return { erros: resultadoValores.erros };

  const dadosFunc = dadosFuncionario(funcionario);
  const empresa = dadosEmpresa(config);
  const numeroFormatado = numero ? formatarNumeroDocumento(numero.ano, numero.numero) : null;
  const variaveis = montarVariaveis({
    abrangencia: modelo.abrangencia,
    funcionario: dadosFunc,
    empresa,
    dataEmissao,
    numeroFormatado,
    campos: modelo.campos,
    valores: resultadoValores.valores,
  });

  const pendencias = pendenciasDeDados(modelo, empresa, { ...variaveis, 'documento.numero': numeroFormatado ?? NUMERO_PREVIA });
  if (pendencias.length > 0 && !previa) return { erros: pendencias };

  const paraTexto = numeroFormatado ? variaveis : { ...variaveis, 'documento.numero': NUMERO_PREVIA };
  const conteudo = resolverTemplate(modelo.corpo, paraTexto, { ausente: (nome) => `[${nome}]` });

  const campoAssunto = modelo.campos.find((c) => c.papel === 'assunto');
  const campoData = modelo.campos.find((c) => c.papel === 'data_ocorrencia');
  const assunto = campoAssunto ? resultadoValores.valores[campoAssunto.chave] || null : null;
  const dataOcorrencia = campoData ? resultadoValores.valores[campoData.chave] || null : null;

  return {
    erros: pendencias,
    titulo: modelo.titulo_impresso,
    assunto,
    data_ocorrencia: dataOcorrencia,
    conteudo,
    snapshot: {
      layout_versao: LAYOUT_VERSAO,
      documento: {
        ano: numero ? numero.ano : null,
        numero: numero ? numero.numero : null,
        numero_formatado: numeroFormatado,
        data_emissao: dataEmissao,
      },
      modelo: snapshotModelo(modelo),
      funcionario: snapshotFuncionario(dadosFunc),
      empresa: snapshotEmpresa(empresa, modelo.assinatura_empresa),
      valores: resultadoValores.valores,
      variaveis: variaveisUsadas(modelo.corpo, variaveis),
    },
  };
}
