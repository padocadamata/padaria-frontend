// Comunicação / Documentos de RH -- regras de APRESENTAÇÃO das telas
// (Etapa 2). Funções PURAS: permissões da UI, rótulos, mensagens de erro
// das RPCs, montagem do formulário do modelo e do valor do formulário de
// emissão. Nenhuma regra de negócio nova: validação, resolução e emissão
// continuam nos módulos da Etapa 1 (modelo.js, campos.js, emissao.js) e,
// de forma autoritativa, no banco (migration 0077).

import { PERMISSOES, hasPermissao } from '../auth/permissoes.js';
import { LIMITES_CAMPOS, validarValores } from './campos.js';
import { codigoDoErro } from './erros.js';
import { formatarData } from './formatacao.js';
import { CHAVES_RESERVADAS } from './placeholders.js';
import { aparar } from './texto.js';

// --- Permissões (só UX; quem decide é a RPC/RLS) ---------------------------

export function permissoesComunicacao(permissoes) {
  const p = {
    visualizar: hasPermissao(permissoes, PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR),
    emitir: hasPermissao(permissoes, PERMISSOES.FOLHA_DOCUMENTOS_EMITIR),
    cancelar: hasPermissao(permissoes, PERMISSOES.FOLHA_DOCUMENTOS_CANCELAR),
    modelos: hasPermissao(permissoes, PERMISSOES.FOLHA_DOCUMENTOS_MODELOS),
  };
  // Entrar na área Comunicação: quem vê documentos, emite ou administra
  // modelos (mesma regra da policy de leitura dos modelos).
  p.area = p.visualizar || p.emitir || p.modelos;
  // Cancelar exige também ver o documento (a tela de cancelamento é a do
  // documento, que a RLS só mostra com visualizar).
  p.cancelarVisivel = p.cancelar && p.visualizar;
  return p;
}

// --- Rótulos ---------------------------------------------------------------

export const ROTULO_STATUS = { emitido: 'Emitido', cancelado: 'Cancelado' };
export const TOM_STATUS = { emitido: 'success', cancelado: 'danger' };

export const ROTULO_PAPEL = { assunto: 'Assunto do documento', data_ocorrencia: 'Data da ocorrência' };
// Opções de "Usar também como" no editor de modelo (mesmos papéis).
export const ROTULO_PAPEL_EDITOR = { assunto: 'Assunto / motivo do documento', data_ocorrencia: 'Data da ocorrência' };

// Aplicação do modelo (abrangencia individual|geral) explicada no editor.
export const AJUDA_ABRANGENCIA = { individual: 'para uma funcionária', geral: 'para toda a equipe ou comunicado geral' };

// Nome HUMANO das variáveis automáticas nos chips do editor (a chave
// técnica {{...}} fica como informação secundária). Chave fora do mapa
// (catálogo futuro) cai na descrição do núcleo.
export const ROTULO_VARIAVEL = {
  'funcionario.nome': 'Nome do funcionário',
  'funcionario.cpf': 'CPF do funcionário',
  'funcionario.rg': 'RG do funcionário',
  'funcionario.cargo': 'Cargo do funcionário',
  'funcionario.admissao': 'Data de admissão',
  'empresa.nome': 'Nome da empresa',
  'empresa.razao_social': 'Razão social',
  'empresa.cnpj': 'CNPJ da empresa',
  'empresa.endereco': 'Endereço da empresa',
  'empresa.cidade_uf': 'Cidade/UF',
  'empresa.responsavel': 'Responsável pela empresa',
  'empresa.responsavel_cargo': 'Cargo do responsável',
  data_emissao: 'Data de emissão',
  data_emissao_extenso: 'Data de emissão por extenso',
  'documento.numero': 'Número do documento',
};

export function rotuloVariavel(variavel) {
  return ROTULO_VARIAVEL[variavel.chave] || variavel.descricao || variavel.chave;
}

// Linha do histórico: documento geral NUNCA ganha um funcionário inventado.
export function rotuloDestinatario(documento) {
  if (documento.abrangencia === 'geral') return 'Documento geral';
  return documento.funcionario_nome || documento.snapshot?.funcionario?.nome || '—';
}

export function resumoAssinaturas(modelo) {
  const partes = [];
  if (modelo.assinatura_empresa) partes.push('Empresa');
  if (modelo.assinatura_funcionario) partes.push('Funcionário');
  if (modelo.testemunhas > 0) partes.push(modelo.testemunhas === 1 ? '1 testemunha' : `${modelo.testemunhas} testemunhas`);
  if (modelo.local_data) partes.push('Local e data');
  return partes.length > 0 ? partes.join(' · ') : 'Sem assinaturas';
}

export function formatarDataOuTraco(iso) {
  return iso ? formatarData(String(iso).slice(0, 10)) : '—';
}

// "2026-10-26T13:05:00+00:00" -> "26/10/2026 10:05" (America/Sao_Paulo).
export function formatarMomento(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '');
}

// Nome de arquivo do documento: "2026-0001-advertencia-disciplinar".
export function nomeArquivoDocumento(documento) {
  const titulo = String(documento.titulo || documento.snapshot?.modelo?.titulo || 'documento')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'documento';
  const numero = String(documento.numero_formatado || documento.snapshot?.documento?.numero_formatado || 'previa').replace('/', '-');
  return `${numero}-${titulo}`;
}

// --- Mensagens de erro das RPCs ---------------------------------------------
//
// O banco levanta "folha_documentos: [codigo] mensagem" (sem acentos). A
// tela mostra o texto daqui pelo código; o que o banco detalha ({{x}},
// rótulo do campo) é acrescentado quando existe.

export const MENSAGENS_ERRO = {
  modelo_nome_duplicado: 'Já existe um modelo com este nome (maiúsculas, espaços nas pontas e acentos não diferenciam).',
  modelo_alterado: 'Este modelo foi alterado por outra pessoa depois que você abriu. Recarregue a página e refaça a alteração.',
  modelo_inexistente: 'Este modelo não existe mais. Atualize a lista.',
  modelo_nome_invalido: 'Informe o nome do modelo (até 80 caracteres).',
  modelo_titulo_invalido: 'Informe o título do documento (até 120 caracteres).',
  modelo_descricao_invalida: 'A descrição pode ter até 300 caracteres.',
  modelo_abrangencia_invalida: 'Escolha se o documento é individual ou geral.',
  modelo_corpo_vazio: 'Escreva o texto do documento.',
  modelo_corpo_longo: 'O texto pode ter até 20.000 caracteres.',
  modelo_testemunhas_invalidas: 'Testemunhas: 0, 1 ou 2.',
  modelo_assinatura_funcionario_geral: 'Documento geral não tem assinatura de funcionário.',
  placeholder_malformado: 'O texto tem uma variável mal escrita: use {{nome}} sem espaços, só letras minúsculas, números e "_".',
  placeholder_desconhecido: 'O texto usa uma variável que não é automática nem um campo deste modelo.',
  placeholder_funcionario_em_geral: 'Variáveis do funcionário só podem ser usadas em documento individual.',
  campo_nao_utilizado: 'Há um campo que não aparece no texto (só os campos de assunto e de data da ocorrência podem ficar fora).',
  config_cnpj_invalido: 'CNPJ inválido — confira os números.',
  config_texto_invalido: 'Algum dado da empresa passou do tamanho máximo.',
  config_razao_social_ausente: 'Cadastre a razão social da empresa (Comunicação › Modelos › Dados da empresa) antes de emitir.',
  config_cidade_uf_ausente: 'Cadastre a cidade/UF da empresa — este modelo imprime local e data.',
  config_responsavel_ausente: 'Cadastre o responsável da empresa — este modelo tem assinatura da empresa.',
  dado_automatico_ausente: 'Falta um dado cadastrado que o texto usa.',
  emissao_modelo_inexistente: 'Este modelo não existe mais.',
  emissao_modelo_inativo: 'Este modelo está inativo. Reative-o em Modelos para emitir.',
  emissao_modelo_alterado: 'O modelo foi alterado depois da prévia. Recarregue o modelo e confira a prévia antes de emitir.',
  emissao_funcionario_obrigatorio: 'Escolha o funcionário deste documento.',
  emissao_funcionario_indevido: 'Documento geral não tem funcionário.',
  emissao_funcionario_inexistente: 'Funcionário não encontrado.',
  valor_obrigatorio: 'Preencha os campos obrigatórios.',
  valor_data_futura: 'A data da ocorrência não pode ser no futuro.',
  valor_data_invalida: 'Há uma data inválida.',
  valor_opcao_invalida: 'Escolha uma das opções da lista.',
  valor_numero_invalido: 'Há um número inválido (até 12 dígitos e 4 casas decimais).',
  valor_longo: 'Um dos textos passou do tamanho máximo.',
  valor_texto_quebra_linha: 'Um campo de texto curto deve ter uma única linha.',
  cancelamento_motivo_obrigatorio: 'Informe o motivo do cancelamento.',
  cancelamento_motivo_longo: 'O motivo pode ter até 500 caracteres.',
  documento_inexistente: 'Documento não encontrado.',
  documento_ja_cancelado: 'Este documento já está cancelado.',
};

export function mensagemErroDocumento(erro) {
  if (!erro) return '';
  if (erro.code === '42501') return 'Você não tem permissão para esta ação.';
  const texto = String(erro.message || erro);
  const codigo = codigoDoErro(texto);
  if (codigo) {
    const base = MENSAGENS_ERRO[codigo] || 'Não foi possível concluir a operação.';
    const variavel = /\{\{[a-z0-9_.]+\}\}/.exec(texto);
    if (variavel && !base.includes('{{nome}}')) return `${base} (${variavel[0]})`;
    // Valores: o banco começa a mensagem pelo rótulo do campo ("Motivo: ...").
    const rotulo = codigo.startsWith('valor_') ? /\]\s*([^:]+):/.exec(texto) : null;
    return rotulo ? `${rotulo[1].trim()}: ${base}` : base;
  }
  if (/failed to fetch|network/i.test(texto)) return 'Sem conexão com o servidor. Tente novamente.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}

// --- Editor de modelo -------------------------------------------------------

export const MODELO_VAZIO = {
  nome: '',
  descricao: '',
  titulo_impresso: '',
  abrangencia: 'individual',
  corpo: '',
  campos: [],
  assinatura_empresa: true,
  assinatura_funcionario: true,
  testemunhas: 0,
  local_data: true,
  ativo: true,
};

// Campo no FORMULÁRIO: opções editadas como texto (uma por linha);
// `chaveManual` = chave FIXA (campo já salvo no modelo); num campo novo
// (false) a chave acompanha o rótulo -- ver atualizarCampoFormulario.
let sequenciaCampo = 0;
export function novoCampoFormulario(tipo = 'texto') {
  sequenciaCampo += 1;
  return { idLocal: `c${Date.now()}-${sequenciaCampo}`, chave: '', rotulo: '', tipo, obrigatorio: true, opcoesTexto: '', dica: '', papel: '', chaveManual: false };
}

export function campoParaFormulario(campo, indice = 0) {
  return {
    idLocal: `c${indice}-${campo.chave}`,
    chave: campo.chave,
    rotulo: campo.rotulo,
    tipo: campo.tipo,
    obrigatorio: campo.obrigatorio === true,
    opcoesTexto: Array.isArray(campo.opcoes) ? campo.opcoes.join('\n') : '',
    dica: campo.dica || '',
    papel: campo.papel || '',
    chaveManual: true,
  };
}

// Formulário -> definição de campo do núcleo (mesmo formato do JSONB):
// opcoes só na seleção; dica/papel só quando preenchidos.
export function campoDoFormulario(f) {
  const campo = { chave: f.chave, rotulo: f.rotulo, tipo: f.tipo, obrigatorio: f.obrigatorio === true };
  if (f.tipo === 'selecao') campo.opcoes = String(f.opcoesTexto || '').split('\n').map(aparar).filter((o) => o !== '');
  if (aparar(f.dica || '') !== '') campo.dica = f.dica;
  if (f.papel) campo.papel = f.papel;
  return campo;
}

export function modeloDoFormulario(form) {
  return {
    nome: form.nome,
    descricao: form.descricao,
    titulo_impresso: form.titulo_impresso,
    abrangencia: form.abrangencia,
    corpo: form.corpo,
    campos: form.campos.map(campoDoFormulario),
    assinatura_empresa: form.assinatura_empresa === true,
    // Geral nunca tem assinatura de funcionário (regra do banco).
    assinatura_funcionario: form.abrangencia === 'individual' && form.assinatura_funcionario === true,
    testemunhas: Number(form.testemunhas),
    local_data: form.local_data === true,
  };
}

export function formularioDoModelo(modelo) {
  return {
    nome: modelo.nome,
    descricao: modelo.descricao || '',
    titulo_impresso: modelo.titulo_impresso,
    abrangencia: modelo.abrangencia,
    corpo: modelo.corpo,
    campos: (modelo.campos || []).map(campoParaFormulario),
    assinatura_empresa: modelo.assinatura_empresa,
    assinatura_funcionario: modelo.assinatura_funcionario,
    testemunhas: modelo.testemunhas,
    local_data: modelo.local_data,
    ativo: modelo.ativo,
  };
}

// Chave sugerida a partir do rótulo ("Data da ocorrência" ->
// "data_da_ocorrencia"), já no formato aceito pelo banco
// (^[a-z][a-z0-9_]{0,39}$) e sem colidir com reservadas/outras chaves.
export function chaveDoRotulo(rotulo, ocupadas = [], reservadas = []) {
  let base = String(rotulo || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  base = base.replace(/^[0-9_]+/, '');
  if (base === '') base = 'campo';
  base = base.slice(0, 40).replace(/_+$/, '');
  const proibidas = new Set([...ocupadas, ...reservadas]);
  if (!proibidas.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const sufixo = `_${n}`;
    const candidata = `${base.slice(0, 40 - sufixo.length).replace(/_+$/, '')}${sufixo}`;
    if (!proibidas.has(candidata)) return candidata;
  }
}

// Aplica `mudanca` ao campo `indice` do formulário. A chave técnica não é
// digitada: acompanha o rótulo SÓ num campo novo (chaveManual false) cuja
// variável ainda não está no texto (`usadas`); campo já salvo ou já usado
// no texto mantém a chave -- renomear a pergunta nunca quebra o texto.
// Mudar o tipo descarta um papel que o novo tipo não aceita.
export function atualizarCampoFormulario(campos, indice, mudanca, usadas = new Set()) {
  return campos.map((c, i) => {
    if (i !== indice) return c;
    const novo = { ...c, ...mudanca };
    if ('rotulo' in mudanca && !c.chaveManual && !usadas.has(c.chave)) {
      const ocupadas = campos.filter((_, j) => j !== indice).map((x) => x.chave);
      novo.chave = chaveDoRotulo(mudanca.rotulo, ocupadas, CHAVES_RESERVADAS);
    }
    if ('tipo' in mudanca && novo.papel && !papeisDoTipo(novo.tipo).includes(novo.papel)) novo.papel = '';
    return novo;
  });
}

// Insere `trecho` no lugar da seleção [inicio, fim) -> { texto, cursor }.
export function inserirTrecho(texto, inicio, fim, trecho) {
  const t = String(texto ?? '');
  const i = Number.isInteger(inicio) ? Math.max(0, Math.min(inicio, t.length)) : t.length;
  const f = Number.isInteger(fim) ? Math.max(i, Math.min(fim, t.length)) : i;
  return { texto: t.slice(0, i) + trecho + t.slice(f), cursor: i + trecho.length };
}

// Papéis que um campo do tipo pode ter (mesma regra de campos.js).
export function papeisDoTipo(tipo) {
  if (tipo === 'texto' || tipo === 'selecao') return ['assunto'];
  if (tipo === 'data') return ['data_ocorrencia'];
  return [];
}

// Erros do validarModelo com o vocabulário do EDITOR: o campo se chama
// "Pergunta na emissão" e a chave técnica não é digitada (sai do rótulo),
// então "chave inválida" de um campo sem rótulo é redundante com "informe
// a pergunta" e some. Só a mensagem muda -- nenhum erro deixa de bloquear
// (quem decide se salva é validarModelo inteiro).
export function errosParaEditor(erros) {
  const semRotulo = new Set(erros.filter((e) => e.codigo === 'campo_rotulo_invalido').map((e) => e.indice));
  return erros
    .filter((e) => !(e.codigo === 'campo_chave_invalida' && semRotulo.has(e.indice)))
    .map((e) => {
      if (e.codigo === 'campo_rotulo_invalido') return { ...e, mensagem: `Campo ${e.indice + 1}: informe a pergunta na emissão (até ${LIMITES_CAMPOS.rotulo} caracteres).` };
      if (e.codigo === 'modelo_titulo_invalido') return { ...e, mensagem: MENSAGENS_ERRO.modelo_titulo_invalido };
      return e;
    });
}

// Erros do validarModelo agrupados para a tela: por campo (índice), por
// variável e gerais.
export function agruparErrosModelo(erros) {
  const porCampo = new Map();
  const gerais = [];
  for (const e of erros) {
    if (Number.isInteger(e.indice)) {
      if (!porCampo.has(e.indice)) porCampo.set(e.indice, []);
      porCampo.get(e.indice).push(e);
    } else {
      gerais.push(e);
    }
  }
  return { porCampo, gerais };
}

// --- Formulário de emissão --------------------------------------------------

// Valores iniciais: '' por campo (o banco recebe exatamente as chaves do
// modelo -- chave a mais é recusada).
export function valoresIniciais(campos) {
  return Object.fromEntries((campos || []).map((c) => [c.chave, '']));
}

export const LIMITE_CARACTERES_VALOR = { texto: LIMITES_CAMPOS.texto, texto_longo: LIMITES_CAMPOS.textoLongo };

// Prévia ENQUANTO o formulário é preenchido: campo com problema
// (obrigatório vazio, data/número/opção inválidos) aparece no texto como
// "[Rótulo]" (vira um campo de texto só na prévia), para a pessoa ver onde
// a resposta entra; opcional vazio fica vazio, como na emissão. Sem erros,
// devolve os MESMOS campos e valores -- a prévia é exatamente o que será
// emitido. erros: os da validação real (validarValores).
export function prepararPrevia(campos, valores, { hoje }) {
  const { erros } = validarValores(campos, valores, { hoje });
  if (erros.length === 0) return { erros, campos, valores };
  const comErro = new Set(erros.map((e) => e.chave));
  const camposPrevia = campos.map((c) => (comErro.has(c.chave) ? { chave: c.chave, rotulo: c.rotulo, tipo: 'texto', obrigatorio: false } : c));
  const valoresPrevia = Object.fromEntries(campos.map((c) => [c.chave, comErro.has(c.chave) ? `[${aparar(c.rotulo)}]` : valores[c.chave] ?? '']));
  return { erros, campos: camposPrevia, valores: valoresPrevia };
}

// --- Filtros do histórico ---------------------------------------------------

// Filtros da tela -> condições da consulta (aplicadas no Supabase por
// consultas.js). Pura para ser testada.
export function condicoesConsultaDocumentos(f) {
  const c = [];
  if (f.dataInicio) c.push(['gte', 'data_emissao', f.dataInicio]);
  if (f.dataFim) c.push(['lte', 'data_emissao', f.dataFim]);
  if (f.funcionarioId) c.push(['eq', 'funcionario_id', f.funcionarioId]);
  if (f.modeloId) c.push(['eq', 'modelo_id', f.modeloId]);
  if (f.abrangencia) c.push(['eq', 'abrangencia', f.abrangencia]);
  if (f.status) c.push(['eq', 'status', f.status]);
  return c;
}

export function quantidadeFiltrosAtivos(valores, padrao) {
  return Object.keys(padrao).filter((k) => valores[k] !== padrao[k]).length;
}
