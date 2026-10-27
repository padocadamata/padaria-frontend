// Etapa 2 (interface) da Comunicação / Documentos de RH: permissões,
// navegação, editor de modelo, emissão/prévia, documento histórico,
// assinaturas, filtros, impressão/PDF/Word.
// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/documentos/__tests__/telas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { PERMISSOES } from '../../auth/permissoes.js';
import { subitensDoModulo, telasNavegaveis } from '../../nav/navegacao.js';
import { moduloVisivel, MODULOS } from '../../auth/permissoes.js';
import {
  MENSAGENS_ERRO,
  MODELO_VAZIO,
  AJUDA_ABRANGENCIA,
  ROTULO_PAPEL_EDITOR,
  ROTULO_VARIAVEL,
  agruparErrosModelo,
  atualizarCampoFormulario,
  campoDoFormulario,
  chaveDoRotulo,
  condicoesConsultaDocumentos,
  errosParaEditor,
  formularioDoModelo,
  inserirTrecho,
  mensagemErroDocumento,
  modeloDoFormulario,
  nomeArquivoDocumento,
  novoCampoFormulario,
  papeisDoTipo,
  permissoesComunicacao,
  prepararPrevia,
  quantidadeFiltrosAtivos,
  resumoAssinaturas,
  rotuloDestinatario,
  rotuloVariavel,
  valoresIniciais,
} from '../apresentacao.js';
import { CHAVES_RESERVADAS, VARIAVEIS_AUTOMATICAS, resolverTemplate, variaveisDoEscopo } from '../placeholders.js';
import { normalizarCampos, validarCampos } from '../campos.js';
import { normalizarModelo, validarModelo } from '../modelo.js';
import { montarEmissao } from '../emissao.js';
import { montarDocumento } from '../documento.js';
import { ESPACOS, PAGINA_A4, TIPOGRAFIA, cabecalhoEmpresa, linhaIdentificacao, linhasAssinatura, textoCancelamento, variaveisCssA4 } from '../layout.js';
import { documentXml, escaparXml, gerarDocx } from '../docx.js';
import { gerarPdfDocumento } from '../pdf.js';
import { FILTROS_DOCUMENTOS, regrasSaneamentoDocumentos } from '../../filtros/telas.js';
import { camposParaSanear } from '../../filtros/persistenciaFiltros.js';
import { MODELO_ADVERTENCIA, MODELO_COMUNICADO } from './casos.mjs';

const RAIZ = new URL('../../../', import.meta.url);
const ler = (caminho) => readFileSync(new URL(caminho, RAIZ), 'utf8');
const MIGRATION = ler('supabase/migrations/0077_folha_documentos.sql');

const HOJE = '2026-10-27';
const salvo = (m, extra = {}) => ({ id: 'm-1', versao: 2, ativo: true, ...normalizarModelo(m), ...extra });
const FUNC = { id: 'f-1', nome: 'Maria da Silva', cpf: '12345678901', rg: 'MG-1', cargo: 'Atendente', data_admissao: '2025-03-01', ativo: true };
const EMPRESA = {
  nome_fantasia: 'Padoca Exemplo', razao_social: 'Exemplo Panificadora Ltda', cnpj: '12345678000195',
  endereco: 'Rua A, 1', cidade_uf: 'Cidade/MG', responsavel_nome: 'Responsável Exemplo', responsavel_cargo: 'Sócia',
};
const VALORES = { motivo: 'atrasos', data_ocorrencia: '2026-10-20', descricao: 'Chegou atrasada.', gravidade: 'Grave', dias: '3' };
const set = (...codigos) => new Set(codigos);

// --- Permissões e navegação --------------------------------------------------

test('permissões: cada ação pela sua permissão; área abre com visualizar, emitir ou modelos', () => {
  const nada = permissoesComunicacao(set());
  assert.deepEqual([nada.area, nada.visualizar, nada.emitir, nada.cancelar, nada.modelos], [false, false, false, false, false]);
  for (const codigo of [PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR, PERMISSOES.FOLHA_DOCUMENTOS_EMITIR, PERMISSOES.FOLHA_DOCUMENTOS_MODELOS]) {
    assert.equal(permissoesComunicacao(set(codigo)).area, true, codigo);
  }
  // Cancelar sozinho não abre a área nem o botão (precisa ver o documento).
  const soCancelar = permissoesComunicacao(set(PERMISSOES.FOLHA_DOCUMENTOS_CANCELAR));
  assert.deepEqual([soCancelar.area, soCancelar.cancelarVisivel], [false, false]);
  assert.equal(permissoesComunicacao(set(PERMISSOES.FOLHA_DOCUMENTOS_CANCELAR, PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR)).cancelarVisivel, true);
  // Nenhuma permissão genérica da Folha substitui as de documentos.
  const folhaToda = permissoesComunicacao(set(PERMISSOES.FUNCIONARIOS_VISUALIZAR, PERMISSOES.FUNCIONARIOS_EDITAR, PERMISSOES.FOLHA_PAGAMENTOS_VISUALIZAR, PERMISSOES.FOLHA_PAGAMENTOS_CANCELAR));
  assert.equal(folhaToda.area, false);
  assert.equal(folhaToda.cancelar, false);
});

test('navegação: aba Comunicação na Folha, depois de Pagamentos, pela permissão de documentos', () => {
  const todas = set(PERMISSOES.FUNCIONARIOS_VISUALIZAR, PERMISSOES.ESCALA_VISUALIZAR, PERMISSOES.TAREFAS_VISUALIZAR, PERMISSOES.FOLHA_PAGAMENTOS_VISUALIZAR, PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR);
  assert.deepEqual(subitensDoModulo('funcionarios', todas).map((s) => s.chave), ['funcionarios', 'escala', 'tarefas', 'pagamentos', 'comunicacao']);
  const aba = subitensDoModulo('funcionarios', todas).at(-1);
  assert.deepEqual([aba.rotulo, aba.rota], ['Comunicação', '/funcionarios/comunicacao']);
  for (const codigo of [PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR, PERMISSOES.FOLHA_DOCUMENTOS_EMITIR, PERMISSOES.FOLHA_DOCUMENTOS_MODELOS]) {
    assert.deepEqual(subitensDoModulo('funcionarios', set(codigo)).map((s) => s.chave), ['comunicacao'], codigo);
    assert.equal(moduloVisivel(set(codigo), MODULOS.funcionarios), true, codigo);
  }
  assert.deepEqual(subitensDoModulo('funcionarios', set(PERMISSOES.FOLHA_DOCUMENTOS_CANCELAR)), []);
  assert.equal(moduloVisivel(set(PERMISSOES.FOLHA_DOCUMENTOS_CANCELAR), MODULOS.funcionarios), false);
  assert.equal(moduloVisivel(set(PERMISSOES.FOLHA_PAGAMENTOS_VISUALIZAR), MODULOS.funcionarios), true, 'quem já via a Folha continua vendo');
  const tela = telasNavegaveis().find((t) => t.chave === 'funcionarios.comunicacao');
  assert.equal(tela.rotulo, 'Folha de Pagamento › Comunicação');
});

test('rotas: páginas criadas e protegidas pela permissão certa', () => {
  const paginas = {
    'pages/funcionarios/comunicacao/index.js': /<AreaComunicacao>/,
    'pages/funcionarios/comunicacao/modelos/index.js': /<AreaComunicacao>/,
    'pages/funcionarios/comunicacao/modelos/[id].js': /permissao=\{PERMISSOES\.FOLHA_DOCUMENTOS_MODELOS\}/,
    'pages/funcionarios/comunicacao/empresa.js': /permissao=\{PERMISSOES\.FOLHA_DOCUMENTOS_MODELOS\}/,
    'pages/funcionarios/comunicacao/gerar.js': /permissao=\{PERMISSOES\.FOLHA_DOCUMENTOS_EMITIR\}/,
    'pages/funcionarios/comunicacao/documentos/[id]/index.js': /permissao=\{PERMISSOES\.FOLHA_DOCUMENTOS_VISUALIZAR\}/,
    'pages/funcionarios/comunicacao/documentos/[id]/imprimir.js': /permissao=\{PERMISSOES\.FOLHA_DOCUMENTOS_VISUALIZAR\}/,
  };
  for (const [arquivo, padrao] of Object.entries(paginas)) assert.match(ler(arquivo), padrao, arquivo);
  // Botões por permissão.
  assert.match(ler('pages/funcionarios/comunicacao/index.js'), /p\.emitir && <Button icone="plus" href=\{ROTA_GERAR\}>Gerar documento/);
  assert.match(ler('pages/funcionarios/comunicacao/documentos/[id]/index.js'), /!cancelado && p\.cancelarVisivel &&/);
  assert.match(ler('pages/funcionarios/comunicacao/modelos/index.js'), /p\.modelos && \(\s*<Button tamanho="sm" variante="secondary" icone="pencil"/);
  // Ficha: aba Documentos só com visualizar.
  assert.match(ler('pages/funcionarios/[id].js'), /chave: 'documentos', label: 'Documentos', permissao: PERMISSOES\.FOLHA_DOCUMENTOS_VISUALIZAR/);
});

// --- Escrita só por RPC; documento nunca editado ---------------------------

function arquivosDe(pasta) {
  const url = new URL(pasta, RAIZ);
  return readdirSync(url).flatMap((nome) => {
    const caminho = `${pasta}/${nome}`;
    return statSync(new URL(caminho, RAIZ)).isDirectory() ? arquivosDe(caminho) : [caminho];
  });
}
const FONTES_UI = [...arquivosDe('pages/funcionarios/comunicacao'), ...arquivosDe('components/documentos')].filter((f) => f.endsWith('.js'));

test('escrita somente pelas 5 RPCs; nada de insert/update/delete direto, nem localStorage próprio', () => {
  const consultas = ler('lib/documentos/consultas.js');
  assert.doesNotMatch(consultas, /\.(insert|update|upsert|delete)\(/);
  assert.deepEqual([...consultas.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort(), [
    'folha_documento_cancelar', 'folha_documento_emitir', 'folha_documento_modelo_definir_ativo', 'folha_documento_modelo_salvar', 'folha_documentos_config_salvar',
  ]);
  for (const arquivo of FONTES_UI) {
    const fonte = ler(arquivo);
    assert.doesNotMatch(fonte, /createClient|\.from\(|\.rpc\(/, `${arquivo}: acesso ao banco só por lib/documentos/consultas.js`);
    assert.doesNotMatch(fonte, /localStorage|sessionStorage/, arquivo);
  }
});

test('documento emitido: reconstruído do snapshot (nunca do modelo atual), sem edição', () => {
  for (const arquivo of ['pages/funcionarios/comunicacao/documentos/[id]/index.js', 'pages/funcionarios/comunicacao/documentos/[id]/imprimir.js']) {
    const fonte = ler(arquivo);
    assert.match(fonte, /montarDocumento\(registro\)/, arquivo);
    assert.doesNotMatch(fonte, /carregarModelo|listarModelos|listarFuncionarios|carregarConfig/, `${arquivo} não relê modelo/cadastro`);
  }
  assert.doesNotMatch(ler('lib/documentos/consultas.js'), /from\('folha_documentos'\)[^;]*\.(update|delete)/);
});

// --- Editor de modelo ------------------------------------------------------

test('editor: formulário <-> modelo sem perda (ida e volta valida igual ao núcleo)', () => {
  const doBanco = salvo(MODELO_ADVERTENCIA);
  const form = formularioDoModelo(doBanco);
  const devolta = modeloDoFormulario(form);
  assert.deepEqual(validarModelo(devolta), []);
  assert.deepEqual(normalizarModelo(devolta), normalizarModelo(MODELO_ADVERTENCIA));
  // Opções da seleção editadas como texto, uma por linha.
  const gravidade = form.campos.find((c) => c.chave === 'gravidade');
  assert.equal(gravidade.opcoesTexto, 'Leve\nMédia\nGrave');
  assert.deepEqual(campoDoFormulario({ ...gravidade, opcoesTexto: ' A \n\nB\n' }).opcoes, ['A', 'B']);
  // Campos de outros tipos nunca levam opcoes; dica/papel vazios somem.
  assert.deepEqual(campoDoFormulario({ ...novoCampoFormulario('texto'), chave: 'x', rotulo: 'X', opcoesTexto: 'a' }), { chave: 'x', rotulo: 'X', tipo: 'texto', obrigatorio: true });
});

test('editor: documento geral nunca envia assinatura de funcionário', () => {
  const form = { ...MODELO_VAZIO, abrangencia: 'geral', assinatura_funcionario: true, nome: 'Aviso', titulo_impresso: 'AVISO', corpo: 'Texto.' };
  const m = modeloDoFormulario(form);
  assert.equal(m.assinatura_funcionario, false);
  assert.deepEqual(validarModelo(m), []);
});

test('editor: placeholder estrito -- {{ motivo }} é erro, {{motivo}} é válido', () => {
  const base = { ...MODELO_VAZIO, nome: 'T', titulo_impresso: 'T', campos: [{ ...novoCampoFormulario(), chave: 'motivo', rotulo: 'Motivo' }] };
  assert.deepEqual(validarModelo(modeloDoFormulario({ ...base, corpo: 'Por {{motivo}}.' })), []);
  assert.deepEqual(validarModelo(modeloDoFormulario({ ...base, corpo: 'Por {{ motivo }}.' })).map((e) => e.codigo), ['placeholder_malformado', 'campo_nao_utilizado']);
});

test('editor: campo fora do texto é erro, exceto com papel assunto ou data da ocorrência', () => {
  const campo = (extra) => ({ ...novoCampoFormulario(), rotulo: 'X', ...extra });
  const modelo = (campos) => modeloDoFormulario({ ...MODELO_VAZIO, nome: 'T', titulo_impresso: 'T', corpo: 'Texto fixo.', campos });
  assert.deepEqual(validarModelo(modelo([campo({ chave: 'motivo' })])).map((e) => e.codigo), ['campo_nao_utilizado']);
  assert.deepEqual(validarModelo(modelo([campo({ chave: 'motivo', papel: 'assunto' })])), []);
  assert.deepEqual(validarModelo(modelo([campo({ chave: 'quando', tipo: 'data', papel: 'data_ocorrencia' })])), []);
  // Erro de campo fica no cartão do campo (índice).
  const { porCampo, gerais } = agruparErrosModelo(validarModelo(modelo([campo({ chave: 'data_emissao' })])));
  assert.equal(porCampo.get(0)[0].codigo, 'campo_chave_reservada');
  assert.ok(gerais.every((e) => !Number.isInteger(e.indice)));
});

test('editor: chave sugerida pelo rótulo é sempre aceita pelo banco', () => {
  assert.equal(chaveDoRotulo('Data da ocorrência'), 'data_da_ocorrencia');
  assert.equal(chaveDoRotulo('  Motivo!! '), 'motivo');
  assert.equal(chaveDoRotulo('123 Valor'), 'valor');
  assert.equal(chaveDoRotulo('***'), 'campo');
  assert.equal(chaveDoRotulo('Motivo', ['motivo']), 'motivo_2');
  assert.equal(chaveDoRotulo('Motivo', ['motivo', 'motivo_2']), 'motivo_3');
  assert.equal(chaveDoRotulo('Empresa', [], CHAVES_RESERVADAS), 'empresa_2');
  const longa = chaveDoRotulo('a'.repeat(60), ['a'.repeat(40)]);
  assert.ok(longa.length <= 40 && longa.endsWith('_2'));
  for (const rotulo of ['Data da ocorrência', 'Ação tomada', '2ª via', 'Funcionário', 'documento', 'Ç', 'x'.repeat(80)]) {
    const chave = chaveDoRotulo(rotulo, [], CHAVES_RESERVADAS);
    assert.deepEqual(validarCampos([{ chave, rotulo: 'R', tipo: 'texto', obrigatorio: false }]), [], `${rotulo} -> ${chave}`);
  }
});

test('editor: chave acompanha a pergunta só em campo novo ainda fora do texto', () => {
  const novo = { ...novoCampoFormulario(), rotulo: '' };
  let campos = atualizarCampoFormulario([novo], 0, { rotulo: 'Motivo' });
  assert.equal(campos[0].chave, 'motivo');
  campos = atualizarCampoFormulario(campos, 0, { rotulo: 'Motivo da advertência' });
  assert.equal(campos[0].chave, 'motivo_da_advertencia', 'ainda fora do texto: acompanha');
  // Já inserida no texto: renomear a pergunta NÃO muda a chave.
  const noTexto = atualizarCampoFormulario(campos, 0, { rotulo: 'Motivo' }, new Set(['motivo_da_advertencia']));
  assert.equal(noTexto[0].chave, 'motivo_da_advertencia');
  assert.equal(noTexto[0].rotulo, 'Motivo');
  // Campo já salvo (formularioDoModelo): chave fixa mesmo fora do texto.
  const salvoForm = formularioDoModelo(salvo(MODELO_ADVERTENCIA));
  const renomeado = atualizarCampoFormulario(salvoForm.campos, 0, { rotulo: 'Outro nome qualquer' });
  assert.equal(renomeado[0].chave, salvoForm.campos[0].chave);
  assert.equal(renomeado[0].chaveManual, true);
  // Sem colidir com outra chave; papel incompatível cai ao mudar o tipo.
  const dois = atualizarCampoFormulario([{ ...novoCampoFormulario(), chave: 'motivo', chaveManual: true }, novoCampoFormulario()], 1, { rotulo: 'Motivo' });
  assert.equal(dois[1].chave, 'motivo_2');
  const comPapel = atualizarCampoFormulario([{ ...novoCampoFormulario('data'), papel: 'data_ocorrencia' }], 0, { tipo: 'texto' });
  assert.equal(comPapel[0].papel, '');
});

test('editor: erros com o vocabulário da tela, sem esconder nenhum bloqueio real', () => {
  const vazio = { ...MODELO_VAZIO, nome: 'X', titulo_impresso: '', corpo: 'Texto', campos: [novoCampoFormulario()] };
  const brutos = validarModelo(modeloDoFormulario(vazio));
  const tela = errosParaEditor(brutos);
  assert.ok(brutos.some((e) => e.codigo === 'campo_chave_invalida'));
  assert.ok(!tela.some((e) => e.codigo === 'campo_chave_invalida'), 'chave invisível: o erro mostrado é o da pergunta');
  assert.ok(tela.some((e) => e.mensagem === 'Campo 1: informe a pergunta na emissão (até 80 caracteres).'));
  assert.ok(tela.some((e) => e.mensagem.startsWith('Informe o título do documento')));
  // Chave inválida SEM problema de rótulo continua aparecendo (e bloqueando).
  const chaveRuim = errosParaEditor(validarModelo(modeloDoFormulario({ ...vazio, titulo_impresso: 'T', campos: [{ ...novoCampoFormulario(), rotulo: 'R', chave: 'Ruim' }] })));
  assert.ok(chaveRuim.some((e) => e.codigo === 'campo_chave_invalida'));
});

test('editor: nomes humanos nos chips para todas as variáveis automáticas; inserção técnica preservada', () => {
  for (const v of VARIAVEIS_AUTOMATICAS) {
    assert.ok(ROTULO_VARIAVEL[v.chave], v.chave);
    assert.ok(!rotuloVariavel(v).includes('{{'), v.chave);
  }
  assert.equal(rotuloVariavel({ chave: 'funcionario.nome' }), 'Nome do funcionário');
  assert.equal(rotuloVariavel({ chave: 'empresa.razao_social' }), 'Razão social');
  assert.equal(rotuloVariavel({ chave: 'futura.x', descricao: 'Algo novo' }), 'Algo novo');
  assert.ok(variaveisDoEscopo('geral').every((v) => !v.chave.startsWith('funcionario.')));
  const painel = ler('components/documentos/PainelVariaveis.js');
  assert.match(painel, /onClick=\{\(\) => onInserir\(chave\)\}/, 'clique insere a chave técnica');
  assert.match(painel, /rotuloVariavel\(v\)/);
  assert.match(painel, /usadas\.has\(v\.chave\)/, 'indicador de variável já no texto');
});

test('editor: rótulos da tela (labels apenas; nomes internos intactos)', () => {
  const editor = ler('components/documentos/EditorModelo.js');
  const campos = ler('components/documentos/EditorCampos.js');
  assert.match(editor, /label="Título do documento"/);
  assert.match(editor, /<legend className=\{estilos\.legenda\}>Aplicação<\/legend>/);
  assert.match(editor, /definir\('titulo_impresso'/, 'campo interno continua titulo_impresso');
  assert.match(editor, /name="abrangencia"/, 'campo interno continua abrangencia');
  assert.deepEqual(AJUDA_ABRANGENCIA, { individual: 'para uma funcionária', geral: 'para toda a equipe ou comunicado geral' });
  assert.match(campos, /label="Pergunta na emissão"/);
  assert.match(campos, /label="Tipo de resposta"/);
  assert.match(campos, /label="Dica \(opcional\)"/);
  assert.match(campos, /label="Usar também como \(opcional\)"/);
  assert.match(campos, /<option value="">Nenhuma função especial<\/option>/);
  assert.deepEqual(ROTULO_PAPEL_EDITOR, { assunto: 'Assunto / motivo do documento', data_ocorrencia: 'Data da ocorrência' });
  // Chave técnica não é input editável; aparece só como informação secundária.
  assert.doesNotMatch(campos, /Chave no texto/);
  assert.doesNotMatch(campos, /value=\{c\.chave\}/);
  assert.match(campos, /Variável: \{`\{\{\$\{c\.chave\}\}\}`\}/);
  assert.match(campos, /Inserir no texto/);
  for (const f of FONTES_UI) assert.doesNotMatch(ler(f), /Abrangência|Título impresso|Rótulo \(pergunta\)|Papel no histórico/, f);
});

test('editor: inserir variável no cursor, na seleção ou no fim', () => {
  assert.deepEqual(inserirTrecho('Olá !', 4, 4, '{{funcionario.nome}}'), { texto: 'Olá {{funcionario.nome}}!', cursor: 24 });
  assert.deepEqual(inserirTrecho('Olá XX!', 4, 6, '{{a}}'), { texto: 'Olá {{a}}!', cursor: 9 });
  assert.deepEqual(inserirTrecho('Fim', undefined, undefined, '{{a}}'), { texto: 'Fim{{a}}', cursor: 8 });
});

test('editor: papéis por tipo iguais aos do núcleo', () => {
  assert.deepEqual(papeisDoTipo('texto'), ['assunto']);
  assert.deepEqual(papeisDoTipo('selecao'), ['assunto']);
  assert.deepEqual(papeisDoTipo('data'), ['data_ocorrencia']);
  assert.deepEqual(papeisDoTipo('texto_longo'), []);
  assert.deepEqual(papeisDoTipo('numero'), []);
  for (const tipo of ['texto', 'texto_longo', 'data', 'selecao', 'numero']) {
    for (const papel of ['assunto', 'data_ocorrencia']) {
      const campo = { chave: 'x', rotulo: 'X', tipo, obrigatorio: false, papel, ...(tipo === 'selecao' ? { opcoes: ['A'] } : {}) };
      const aceito = validarCampos([campo]).length === 0;
      assert.equal(aceito, papeisDoTipo(tipo).includes(papel), `${tipo}/${papel}`);
    }
  }
});

test('lista de modelos: resumo das assinaturas', () => {
  assert.equal(resumoAssinaturas(salvo(MODELO_ADVERTENCIA)), 'Empresa · Funcionário · 2 testemunhas · Local e data');
  assert.equal(resumoAssinaturas({ assinatura_empresa: false, assinatura_funcionario: false, testemunhas: 1, local_data: false }), '1 testemunha');
  assert.equal(resumoAssinaturas({ assinatura_empresa: false, assinatura_funcionario: false, testemunhas: 0, local_data: false }), 'Sem assinaturas');
});

// --- Emissão: prévia x snapshot ---------------------------------------------

test('prévia completa = emissão: mesmos campos/valores, mesmo texto e snapshot (exceto número)', () => {
  const modelo = salvo(MODELO_ADVERTENCIA);
  const prep = prepararPrevia(modelo.campos, VALORES, { hoje: HOJE });
  assert.deepEqual(prep.erros, []);
  assert.equal(prep.campos, modelo.campos);
  assert.equal(prep.valores, VALORES);
  const previa = montarEmissao({ modelo, funcionario: FUNC, empresa: EMPRESA, valores: prep.valores, dataEmissao: HOJE }, { previa: true });
  const emitido = montarEmissao({ modelo, funcionario: FUNC, empresa: EMPRESA, valores: VALORES, dataEmissao: HOJE, numero: { ano: 2026, numero: 5 } });
  assert.deepEqual(previa.erros, []);
  assert.equal(previa.conteudo, emitido.conteudo.replace('2026/0005', '(número gerado na emissão)'));
  const semNumero = (s) => ({ ...s, documento: { ...s.documento, ano: null, numero: null, numero_formatado: null }, variaveis: { ...s.variaveis, 'documento.numero': null } });
  assert.deepEqual(semNumero(previa.snapshot), semNumero(emitido.snapshot));
});

test('prévia incompleta: campo obrigatório vazio/inválido aparece como [Rótulo]; opcional vazio fica vazio', () => {
  const modelo = salvo(MODELO_ADVERTENCIA);
  const valores = { ...valoresIniciais(modelo.campos), motivo: '', data_ocorrencia: '2099-01-01', dias: 'abc', descricao: '' };
  const prep = prepararPrevia(modelo.campos, valores, { hoje: HOJE });
  assert.deepEqual(prep.erros.map((e) => e.codigo).sort(), ['valor_data_futura', 'valor_numero_invalido', 'valor_obrigatorio']);
  const r = montarEmissao({ modelo: { ...modelo, campos: prep.campos }, funcionario: FUNC, empresa: EMPRESA, valores: prep.valores, dataEmissao: HOJE }, { previa: true });
  assert.ok(r.conteudo.includes('em razão de [Motivo]'));
  assert.ok(r.conteudo.includes('dia [Data da ocorrência]'));
  assert.ok(r.conteudo.includes('dias: [Dias]'));
  assert.ok(r.conteudo.includes('Descrição: \n') || r.conteudo.includes('Descrição: '), 'opcional vazio sai vazio');
  // A emissão real com esses valores é recusada (a prévia não libera nada).
  assert.ok(montarEmissao({ modelo, funcionario: FUNC, empresa: EMPRESA, valores, dataEmissao: HOJE }).erros.length > 0);
});

test('emissão: data da ocorrência futura recusada; funcionário inativo permitido; geral sem funcionário', () => {
  const modelo = salvo(MODELO_ADVERTENCIA);
  const futura = montarEmissao({ modelo, funcionario: FUNC, empresa: EMPRESA, valores: { ...VALORES, data_ocorrencia: '2026-10-28' }, dataEmissao: HOJE });
  assert.deepEqual(futura.erros.map((e) => e.codigo), ['valor_data_futura']);
  const inativo = montarEmissao({ modelo, funcionario: { ...FUNC, ativo: false }, empresa: EMPRESA, valores: VALORES, dataEmissao: HOJE, numero: { ano: 2026, numero: 1 } });
  assert.deepEqual(inativo.erros, []);
  const geral = montarEmissao({ modelo: salvo(MODELO_COMUNICADO), funcionario: null, empresa: EMPRESA, valores: { assunto: 'Uniforme', texto: 'Usar touca.' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 2 } });
  assert.deepEqual(geral.erros, []);
  assert.equal(geral.snapshot.funcionario, null);
  assert.equal(rotuloDestinatario({ abrangencia: 'geral', funcionario_nome: null }), 'Documento geral');
  assert.equal(rotuloDestinatario({ abrangencia: 'individual', funcionario_nome: 'Ana' }), 'Ana');
});

test('emissão: tela usa a RPC autoritativa com a versão vista na prévia; data não é escolhida', () => {
  const fonte = ler('pages/funcionarios/comunicacao/gerar.js');
  assert.match(fonte, /emitirDocumento\(\{ modeloId: modelo\.id, modeloVersao: modelo\.versao, funcionarioId: individual \? funcionario\.id : null, valores \}\)/);
  assert.match(fonte, /prepararPrevia\(modelo\.campos, valores, \{ hoje \}\)/);
  assert.doesNotMatch(fonte, /dataEmissao.*onChange|type="date"[^>]*emiss/i, 'data de emissão não é campo');
  assert.match(fonte, /emissao_modelo_alterado/);
  assert.match(fonte, /\(inativo\)/, 'inativos aparecem na escolha do funcionário');
  assert.match(fonte, /Data de emissão: \{formatarData\(hoje\)\} \(automática\)/);
});

// --- Documento histórico e assinaturas ---------------------------------------

function emitirAdvertencia(extra = {}) {
  return montarEmissao({ modelo: salvo(MODELO_ADVERTENCIA), funcionario: FUNC, empresa: EMPRESA, valores: VALORES, dataEmissao: HOJE, numero: { ano: 2026, numero: 7 }, ...extra });
}

test('documento histórico independe do modelo e do cadastro atuais', () => {
  const r = emitirAdvertencia();
  const registro = { ...r, numero_formatado: '2026/0007', status: 'emitido', snapshot: JSON.parse(JSON.stringify(r.snapshot)) };
  const antes = montarDocumento(registro);
  // "Hoje" o modelo e a empresa mudaram -- o documento é o do snapshot.
  const outroModelo = salvo({ ...MODELO_ADVERTENCIA, titulo_impresso: 'NOVO TÍTULO', corpo: `${MODELO_ADVERTENCIA.corpo} Alterado.` });
  assert.notEqual(outroModelo.titulo_impresso, antes.titulo);
  assert.deepEqual(montarDocumento(registro), antes);
  assert.equal(antes.titulo, 'ADVERTÊNCIA DISCIPLINAR');
  assert.equal(resolverTemplate(registro.snapshot.modelo.corpo, registro.snapshot.variaveis), registro.conteudo);
});

test('assinaturas: empresa (razão social, responsável, cargo), funcionário só com nome, testemunhas Nome/CPF', () => {
  const d = montarDocumento({ ...emitirAdvertencia(), status: 'emitido' });
  const [empresa, funcionario, t1, t2] = d.assinaturas.map(linhasAssinatura);
  assert.deepEqual(empresa.map((l) => l.texto), ['Exemplo Panificadora Ltda', 'Responsável Exemplo', 'Sócia']);
  assert.deepEqual(funcionario.map((l) => l.texto), ['Maria da Silva']);
  assert.deepEqual(t1.map((l) => l.texto), ['Testemunha 1', 'Nome:', 'CPF:']);
  assert.deepEqual(t2.map((l) => l.texto), ['Testemunha 2', 'Nome:', 'CPF:']);
  assert.ok(!JSON.stringify(d.assinaturas).includes('123.456.789'), 'sem CPF automático na assinatura');
  // Sem assinaturas configuradas: nenhum bloco.
  const sem = montarEmissao({ modelo: salvo({ ...MODELO_COMUNICADO, assinatura_empresa: false }), funcionario: null, empresa: EMPRESA, valores: { assunto: 'a', texto: 'b' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 3 } });
  assert.deepEqual(montarDocumento(sem).assinaturas, []);
});

test('layout: cabeçalho, identificação e aviso de cancelamento', () => {
  const d = montarDocumento({ ...emitirAdvertencia(), status: 'cancelado', cancelado_em: '2026-10-27T15:04:00Z', cancelado_por_nome: 'Admin', motivo_cancelamento: 'Emitido por engano' });
  assert.deepEqual(cabecalhoEmpresa(d.empresa), { principal: 'Padoca Exemplo', linhas: ['Exemplo Panificadora Ltda · CNPJ 12.345.678/0001-95', 'Rua A, 1 · Cidade/MG'] });
  assert.equal(linhaIdentificacao(d), 'Documento nº 2026/0007 · Emitido em 27/10/2026');
  assert.equal(textoCancelamento(d.cancelamento), 'DOCUMENTO CANCELADO em 27/10/2026 12:04 por Admin. Motivo: Emitido por engano');
  assert.equal(textoCancelamento(null), null);
  assert.deepEqual(cabecalhoEmpresa({ nome: null, razaoSocial: 'Só Razão', cnpj: null, endereco: null, cidadeUf: null }), { principal: 'Só Razão', linhas: [] });
});

// --- Mensagens de erro --------------------------------------------------------

test('erros das RPCs: todo código do banco tem mensagem em português', () => {
  const codigos = [...new Set([...MIGRATION.matchAll(/falhar\('([a-z_]+)'/g)].map((m) => m[1]))];
  const internos = new Set(['campo_formato', 'campos_formato', 'campos_quantidade', 'campo_propriedade_desconhecida', 'campo_chave_invalida', 'campo_chave_reservada',
    'campo_chave_duplicada', 'campo_rotulo_invalido', 'campo_tipo_invalido', 'campo_obrigatorio_invalido', 'campo_dica_invalida', 'campo_opcoes_invalidas',
    'campo_opcoes_indevidas', 'campo_papel_invalido', 'campo_papel_incompativel', 'campo_papel_repetido', 'valores_formato', 'valor_campo_desconhecido', 'valor_tipo_invalido']);
  // Erros de definição de campo/estrutura nunca chegam da tela (o editor
  // valida antes com as mesmas regras); os demais têm texto próprio.
  for (const codigo of codigos.filter((c) => !internos.has(c))) assert.ok(MENSAGENS_ERRO[codigo], codigo);
});

test('erros das RPCs: tradução pelo código, detalhes do banco preservados', () => {
  assert.equal(mensagemErroDocumento({ code: '42501', message: 'x' }), 'Você não tem permissão para esta ação.');
  assert.equal(mensagemErroDocumento({ message: 'folha_documentos: [documento_ja_cancelado] este documento ja esta cancelado.' }), 'Este documento já está cancelado.');
  assert.equal(mensagemErroDocumento({ message: 'folha_documentos: [dado_automatico_ausente] {{funcionario.cpf}} nao tem valor cadastrado.' }), 'Falta um dado cadastrado que o texto usa. ({{funcionario.cpf}})');
  assert.equal(mensagemErroDocumento({ message: 'folha_documentos: [valor_obrigatorio] Motivo: preenchimento obrigatorio.' }), 'Motivo: Preencha os campos obrigatórios.');
  assert.match(mensagemErroDocumento({ message: 'folha_documentos: [emissao_modelo_alterado] o modelo mudou' }), /Recarregue o modelo/);
  assert.equal(mensagemErroDocumento({ message: 'Failed to fetch' }), 'Sem conexão com o servidor. Tente novamente.');
  assert.equal(mensagemErroDocumento(null), '');
});

// --- Filtros (persistência por sessão) --------------------------------------

test('filtros de Documentos: padrão vazio, validadores e sem página persistida', () => {
  assert.deepEqual(FILTROS_DOCUMENTOS.padrao, { dataInicio: '', dataFim: '', funcionarioId: '', modeloId: '', abrangencia: '', status: '' });
  assert.ok(!('pagina' in FILTROS_DOCUMENTOS.padrao));
  const v = FILTROS_DOCUMENTOS.validadores;
  assert.equal(v.status('cancelado'), true);
  assert.equal(v.status('rascunho'), false);
  assert.equal(v.abrangencia('geral'), true);
  assert.equal(v.abrangencia('todos'), false);
  assert.equal(v.dataInicio('2026-10-01'), true);
  assert.equal(v.dataInicio('01/10/2026'), false);
  assert.equal(quantidadeFiltrosAtivos({ ...FILTROS_DOCUMENTOS.padrao, status: 'emitido', modeloId: 'm' }, FILTROS_DOCUMENTOS.padrao), 2);
  // A tela usa a arquitetura central (sessão), sem storage próprio, e a
  // paginação é estado local.
  const tela = ler('pages/funcionarios/comunicacao/index.js');
  assert.match(tela, /useFiltrosPersistidos\('comunicacao\.documentos', FILTROS_DOCUMENTOS\)/);
  assert.match(tela, /const \[pagina, setPagina\] = useState\(1\)/);
});

test('filtros de Documentos: saneamento só contra cadastros carregados', () => {
  const valores = { ...FILTROS_DOCUMENTOS.padrao, funcionarioId: 'f-x', modeloId: 'm-1' };
  const regras = (prontos) => regrasSaneamentoDocumentos({ funcionariosProntos: prontos, funcionarios: [{ id: 'f-1' }], modelosProntos: prontos, modelos: [{ id: 'm-1' }] });
  assert.equal(camposParaSanear(valores, regras(false), FILTROS_DOCUMENTOS.padrao), null, 'antes de carregar, nada muda');
  assert.deepEqual(camposParaSanear(valores, regras(true), FILTROS_DOCUMENTOS.padrao), { funcionarioId: '' });
});

test('filtros de Documentos: condições da consulta', () => {
  assert.deepEqual(condicoesConsultaDocumentos(FILTROS_DOCUMENTOS.padrao), []);
  assert.deepEqual(condicoesConsultaDocumentos({ dataInicio: '2026-10-01', dataFim: '2026-10-31', funcionarioId: 'f', modeloId: 'm', abrangencia: 'individual', status: 'cancelado' }), [
    ['gte', 'data_emissao', '2026-10-01'], ['lte', 'data_emissao', '2026-10-31'], ['eq', 'funcionario_id', 'f'],
    ['eq', 'modelo_id', 'm'], ['eq', 'abrangencia', 'individual'], ['eq', 'status', 'cancelado'],
  ]);
});

// --- Arquivos ---------------------------------------------------------------

test('nome de arquivo do documento', () => {
  assert.equal(nomeArquivoDocumento({ numero_formatado: '2026/0007', titulo: 'ADVERTÊNCIA DISCIPLINAR' }), '2026-0007-advertencia-disciplinar');
  assert.equal(nomeArquivoDocumento({ numero_formatado: '2026/0012', titulo: '***' }), '2026-0012-documento');
});

// ZIP STORE (o mesmo de lib/exportacao/zip.js) -> { caminho: texto }.
function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const arquivos = {};
  let pos = 0;
  while (dv.getUint32(pos, true) === 0x04034b50) {
    const metodo = dv.getUint16(pos + 8, true);
    const tamanho = dv.getUint32(pos + 18, true);
    const nomeLen = dv.getUint16(pos + 26, true);
    const extraLen = dv.getUint16(pos + 28, true);
    const nome = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nomeLen));
    const inicio = pos + 30 + nomeLen + extraLen;
    const dados = bytes.subarray(inicio, inicio + tamanho);
    arquivos[nome] = new TextDecoder().decode(metodo === 0 ? dados : inflateRawSync(dados));
    pos = inicio + tamanho;
  }
  return arquivos;
}

// XML bem formado o suficiente para o Word: tags abrem/fecham na ordem.
function tagsBalanceadas(xml) {
  const pilha = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, fecha, nome, , vazia] = m;
    if (vazia) continue;
    if (fecha) {
      if (pilha.pop() !== nome) return false;
    } else {
      pilha.push(nome);
    }
  }
  return pilha.length === 0;
}

test('Word: pacote OOXML mínimo, A4 retrato, XML escapado e ordem exigida pelo Word', () => {
  const r = emitirAdvertencia({ valores: { ...VALORES, descricao: 'Texto com <tag> & "aspas"\tcom tab\u0001.' } });
  const d = montarDocumento({ ...r, status: 'emitido' });
  const zip = lerZip(gerarDocx(d));
  assert.deepEqual(Object.keys(zip).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  for (const [nome, xml] of Object.entries(zip)) assert.ok(tagsBalanceadas(xml), nome);
  const doc = zip['word/document.xml'];
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/);
  assert.match(doc, /Texto com &lt;tag&gt; &amp; &quot;aspas&quot;<\/w:t><w:tab\/><w:t xml:space="preserve">com tab\.<\/w:t>/);
  assert.ok(!doc.includes('\u0001'));
  assert.ok(doc.includes('ADVERTÊNCIA DISCIPLINAR'));
  assert.ok(doc.includes('<w:cantSplit/>'), 'linha de assinaturas não se parte');
  // Ordem do esquema: b antes de color antes de sz; keepNext antes de pBdr/spacing/ind/jc.
  for (const rPr of doc.match(/<w:rPr>.*?<\/w:rPr>/g)) {
    const ordem = ['<w:b/>', '<w:color', '<w:sz'].map((t) => rPr.indexOf(t)).filter((i) => i >= 0);
    assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b), rPr);
  }
  for (const pPr of doc.match(/<w:pPr>.*?<\/w:pPr>/g)) {
    const ordem = ['<w:keepNext/>', '<w:pBdr>', '<w:spacing', '<w:ind', '<w:jc'].map((t) => pPr.indexOf(t)).filter((i) => i >= 0);
    assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b), pPr);
  }
  assert.equal(escaparXml('a\u0000b\u000bc'), 'abc');
  // Mesmo documento -> mesmo arquivo (determinístico).
  assert.deepEqual(gerarDocx(d), gerarDocx(d));
  assert.equal(documentXml(d), documentXml(montarDocumento({ ...r, status: 'emitido' })));
});

test('Word: cancelado traz o aviso; assinatura do funcionário sem CPF', () => {
  const r = emitirAdvertencia();
  const doc = documentXml(montarDocumento({ ...r, status: 'cancelado', cancelado_em: '2026-10-27T15:00:00Z', cancelado_por_nome: 'Admin', motivo_cancelamento: 'Engano' }));
  assert.ok(doc.includes('DOCUMENTO CANCELADO em 27/10/2026 12:00 por Admin. Motivo: Engano'));
  const assinaturas = doc.slice(doc.indexOf('<w:tbl>'));
  assert.ok(assinaturas.includes('Maria da Silva'));
  assert.ok(!assinaturas.includes('CPF 123') && !assinaturas.includes('123.456.789-01'));
});

let jsPDF = null;
try {
  ({ jsPDF } = await import('jspdf'));
} catch {
  jsPDF = null;
}

test('PDF: A4 retrato, texto, rodapé com paginação e quebra de página', { skip: jsPDF ? false : 'jspdf não instalado neste ambiente' }, () => {
  const d = montarDocumento({ ...emitirAdvertencia(), status: 'emitido' });
  const bytes = gerarPdfDocumento(d, { jsPDF });
  const texto = new TextDecoder('latin1').decode(bytes);
  assert.ok(texto.startsWith('%PDF-'));
  assert.match(texto, /\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
  assert.ok(texto.includes('Documento n') && texto.includes('2026/0007'));
  assert.ok(texto.includes('Testemunha 1'));
  // Documento longo quebra em várias páginas, com rodapé em todas.
  const longo = { ...d, paragrafos: Array.from({ length: 80 }, (_, i) => [`Parágrafo ${i + 1} com texto suficiente para ocupar uma linha inteira da folha A4.`]) };
  const bytesLongo = gerarPdfDocumento(longo, { jsPDF });
  const textoLongo = new TextDecoder('latin1').decode(bytesLongo);
  const paginas = (textoLongo.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(paginas >= 3, `${paginas} páginas`);
  assert.ok(textoLongo.includes(`página ${paginas} de ${paginas}`.replace('á', '\\341')) || textoLongo.includes(`de ${paginas})`));
});

// --- Diagramação compartilhada (folha HTML, PDF e Word) --------------------

test('layout: tipografia e espaços únicos para HTML, PDF e Word', () => {
  assert.ok(TIPOGRAFIA.corpo >= 12 && TIPOGRAFIA.entrelinhaCorpo >= 1.5, 'corpo legível');
  assert.ok(TIPOGRAFIA.titulo > TIPOGRAFIA.empresa && TIPOGRAFIA.empresa > TIPOGRAFIA.corpo, 'hierarquia: título > empresa > corpo');
  assert.ok(ESPACOS.assinatura >= 20, 'espaço confortável para assinar à mão');
  assert.equal(PAGINA_A4.margem, 20);
  const css = variaveisCssA4();
  assert.equal(css['--a4-corpo'], `${TIPOGRAFIA.corpo}pt`);
  assert.equal(css['--a4-assinatura'], `${ESPACOS.assinatura}mm`);
  assert.equal(css['--a4-assinatura-fonte'], `${TIPOGRAFIA.assinatura}pt`);
  // Nenhum nome de variável repetido no objeto (o último valor apagaria o primeiro).
  const fonteLayout = ler('lib/documentos/layout.js');
  const nomes = fonteLayout.slice(fonteLayout.indexOf('export function variaveisCssA4')).match(/'--a4-[a-z-]+'/g);
  assert.equal(new Set(nomes).size, nomes.length, 'variável CSS duplicada');
  assert.equal(css['--a4-lh-corpo'], String(TIPOGRAFIA.entrelinhaCorpo));
  const folha = ler('components/documentos/documentoA4.module.css');
  // Tamanho de fonte sempre em pt (nunca um espaço em mm por engano).
  for (const [, nome] of folha.matchAll(/font-size: var\((--a4-[a-z-]+)/g)) assert.match(css[nome], /pt$/, nome);
  // Toda variável usada pela folha HTML existe (nada fica sem valor).
  for (const usada of new Set(folha.match(/--a4-[a-z-]+/g))) assert.ok(usada in css, usada);
  assert.match(ler('components/documentos/DocumentoA4.js'), /style=\{VARIAVEIS_A4\}/);
  assert.match(folha, /\.fechamento \{[^}]*break-inside: avoid/);
});

test('Word: mesmos tamanhos e espaços da folha (corpo, título, lugar de assinar)', () => {
  const d = montarDocumento({ ...emitirAdvertencia(), status: 'emitido' });
  const zip = lerZip(gerarDocx(d));
  const doc = zip['word/document.xml'];
  const twips = (mm) => Math.round(mm * 56.6929);
  assert.ok(doc.includes(`<w:sz w:val="${TIPOGRAFIA.corpo * 2}"/>`), 'corpo');
  assert.ok(doc.includes(`<w:sz w:val="${TIPOGRAFIA.titulo * 2}"/>`), 'título');
  assert.ok(doc.includes(`w:line="${Math.round(TIPOGRAFIA.corpo * TIPOGRAFIA.entrelinhaCorpo * 20)}" w:lineRule="atLeast"`), 'entrelinha do corpo');
  assert.ok(doc.includes(`w:before="${twips(ESPACOS.tituloAntes)}" w:after="${twips(ESPACOS.tituloDepois)}"`), 'respiro do título');
  assert.ok(doc.includes(`<w:spacing w:before="${twips(ESPACOS.assinatura)}"`), 'espaço para assinar');
  assert.ok(zip['word/styles.xml'].includes(`<w:sz w:val="${TIPOGRAFIA.corpo * 2}"/>`));
  // Local/data fica com as assinaturas; linhas da tabela, exceto a última, ficam com a próxima.
  const localData = doc.slice(0, doc.indexOf('<w:tbl>')).split('<w:p>').pop();
  assert.ok(localData.includes('<w:keepNext/>') && localData.includes(d.localData));
  const linhas = doc.match(/<w:tr>.*?<\/w:tr>/g);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].match(/<w:p>/g).length, linhas[0].match(/<w:keepNext\/>/g).length, '1ª linha inteira com a próxima');
});

test('PDF: fechamento (local/data + assinaturas) não se separa quando cabe numa página', { skip: jsPDF ? false : 'jspdf não instalado neste ambiente' }, () => {
  const d = montarDocumento({ ...emitirAdvertencia(), status: 'emitido' });
  const ultimaLinha = linhasAssinatura(d.assinaturas[d.assinaturas.length - 1]).at(-1).texto;
  for (let n = 1; n <= 40; n += 1) {
    const registros = [];
    // Instância real do jsPDF com text() espionado (página de cada texto).
    function Espiao(...args) {
      const pdf = new jsPDF(...args);
      const original = pdf.text.bind(pdf);
      pdf.text = (texto, ...resto) => {
        registros.push([String(texto), pdf.getCurrentPageInfo().pageNumber]);
        return original(texto, ...resto);
      };
      return pdf;
    }
    const doc = { ...d, paragrafos: Array.from({ length: n }, (_, i) => [`Parágrafo ${i + 1} com texto suficiente para ocupar uma linha inteira da folha.`]) };
    gerarPdfDocumento(doc, { jsPDF: Espiao });
    const pagina = (t) => registros.find(([x]) => x === t)?.[1];
    assert.ok(pagina(d.localData), `n=${n}: local/data`);
    assert.equal(pagina(d.localData), pagina(ultimaLinha), `n=${n}: local/data e última assinatura na mesma página`);
  }
});
