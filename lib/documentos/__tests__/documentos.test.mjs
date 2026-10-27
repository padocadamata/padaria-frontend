// node --test lib/documentos/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAVES_RESERVADAS, VARIAVEIS_AUTOMATICAS, analisarPlaceholders, resolverTemplate, variaveisDoEscopo } from '../placeholders.js';
import { TIPOS_CAMPO, normalizarCampos, validarCampos, validarValores } from '../campos.js';
import { chaveNomeModelo, normalizarModelo, validarModelo } from '../modelo.js';
import { normalizarCnpjConfig } from '../config.js';
import { LAYOUT_VERSAO, NUMERO_PREVIA, montarEmissao } from '../emissao.js';
import { dividirParagrafos, montarDocumento } from '../documento.js';
import { MESES, dataValida, formatarCnpj, formatarCpf, formatarData, formatarDataExtenso, formatarNumeroDocumento } from '../formatacao.js';
import { aparar, tamanho } from '../texto.js';
import { codigoDoErro } from '../erros.js';
import { CASOS_CNPJ, CASOS_MODELO, MODELO_ADVERTENCIA, MODELO_COMUNICADO, NOMES_DISTINTOS, NOMES_EQUIVALENTES, casosValores } from './casos.mjs';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0077_folha_documentos.sql', import.meta.url), 'utf8');

const HOJE = '2026-10-26';
const AMANHA = '2026-10-27';

// Modelo como sai do banco depois de salvo (forma canônica + versão).
function salvo(modelo, extra = {}) {
  return { id: 'm-1', versao: 3, ativo: true, ...normalizarModelo(modelo), ...extra };
}

const FUNCIONARIA = { id: 'f-1', nome: ' Maria da Silva ', cpf: '12345678901', rg: '', cargo: 'Atendente', data_admissao: '2025-03-01' };
const EMPRESA = {
  nome_fantasia: 'Padoca Exemplo', razao_social: 'Exemplo Panificadora Ltda', cnpj: '12345678000195',
  endereco: 'Rua A, 1', cidade_uf: 'Cidade Exemplo/MG', responsavel_nome: 'Responsável Exemplo', responsavel_cargo: 'Sócia',
};
const VALORES = { motivo: 'atrasos', data_ocorrencia: '2026-10-20', descricao: 'Chegou 40 min atrasada.\n\nReincidente.', gravidade: 'Grave', dias: '3,5' };

// --- Placeholders ----------------------------------------------------------

test('placeholders: automática, campo, repetida e ordem da 1ª aparição', () => {
  const r = analisarPlaceholders('{{motivo}} {{funcionario.nome}} {{motivo}} {{data_emissao}}');
  assert.deepEqual(r, { nomes: ['motivo', 'funcionario.nome', 'data_emissao'], malformado: false });
});

test('placeholders: espaços, maiúsculas, vazios e chaves soltas são malformados', () => {
  for (const corpo of ['{{ motivo }}', '{{Motivo}}', '{{}}', 'a {{motivo', 'a motivo}}', '{{a.b.c}}', '{{motivo-x}}']) {
    assert.equal(analisarPlaceholders(corpo).malformado, true, corpo);
  }
  assert.equal(analisarPlaceholders('{chave simples} e } solto { ok').malformado, false);
});

test('catálogo de automáticas: chaves únicas, reservadas cobrem as sem ponto, geral não vê funcionário', () => {
  const chaves = VARIAVEIS_AUTOMATICAS.map((v) => v.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  for (const c of chaves.filter((c) => !c.includes('.'))) assert.ok(CHAVES_RESERVADAS.includes(c), c);
  for (const c of chaves.filter((c) => c.includes('.'))) assert.ok(CHAVES_RESERVADAS.includes(c.split('.')[0]), c);
  assert.ok(variaveisDoEscopo('geral').every((v) => !v.chave.startsWith('funcionario.')));
  assert.equal(variaveisDoEscopo('individual').length, VARIAVEIS_AUTOMATICAS.length);
});

test('resolver: uma passada só (valor com {{...}} não é reprocessado) e ausente', () => {
  assert.equal(resolverTemplate('{{a}}-{{b}}', { a: '{{b}}', b: 'B' }), '{{b}}-B');
  assert.equal(resolverTemplate('ç {{a}} é', { a: 'ã' }), 'ç ã é');
  assert.equal(resolverTemplate('x{{a}}y', { a: '' }), 'xy');
  assert.throws(() => resolverTemplate('{{a}}', { a: null }));
  assert.equal(resolverTemplate('{{a}}', {}, { ausente: (n) => `[${n}]` }), '[a]');
});

// --- Modelo / campos -------------------------------------------------------

for (const [descricao, modelo, esperado] of CASOS_MODELO) {
  test(`modelo: ${descricao}`, () => {
    const erros = validarModelo(modelo);
    assert.equal(erros[0]?.codigo ?? null, esperado, JSON.stringify(erros));
  });
}

test('campos: os 5 tipos do MVP são aceitos', () => {
  assert.deepEqual(TIPOS_CAMPO, ['texto', 'texto_longo', 'data', 'selecao', 'numero']);
  const campos = TIPOS_CAMPO.map((tipo, i) => ({ chave: `c${i}`, rotulo: tipo, tipo, obrigatorio: i % 2 === 0, ...(tipo === 'selecao' ? { opcoes: ['A'] } : {}) }));
  assert.deepEqual(validarCampos(campos), []);
});

test('campos: forma canônica apara textos e omite o que não existe', () => {
  assert.deepEqual(normalizarCampos(MODELO_ADVERTENCIA.campos), [
    { chave: 'motivo', rotulo: 'Motivo', tipo: 'texto', obrigatorio: true, papel: 'assunto' },
    { chave: 'data_ocorrencia', rotulo: 'Data da ocorrência', tipo: 'data', obrigatorio: true, papel: 'data_ocorrencia' },
    { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto_longo', obrigatorio: false, dica: 'Detalhe o ocorrido' },
    { chave: 'gravidade', rotulo: 'Gravidade', tipo: 'selecao', obrigatorio: false, opcoes: ['Leve', 'Média', 'Grave'] },
    { chave: 'dias', rotulo: 'Dias', tipo: 'numero', obrigatorio: false },
  ]);
});

test('modelo: textos normalizados (\\r\\n, bordas) e descrição vazia vira null', () => {
  const n = normalizarModelo(MODELO_ADVERTENCIA);
  assert.equal(n.nome, 'Advertência');
  assert.equal(n.descricao, null);
  assert.ok(!n.corpo.includes('\r'));
  assert.ok(n.corpo.startsWith('Comunicamos') && n.corpo.endsWith('{{motivo}}.'));
});

test('erros acumulam vários problemas, na ordem do banco', () => {
  const erros = validarModelo({ ...MODELO_COMUNICADO, nome: '', corpo: '{{funcionario.nome}} {{xyz}}' });
  assert.deepEqual(erros.map((e) => e.codigo), ['modelo_nome_invalido', 'placeholder_funcionario_em_geral', 'placeholder_desconhecido', 'campo_nao_utilizado']);
});

// --- Valores ---------------------------------------------------------------

const CAMPOS_ADV = normalizarCampos(MODELO_ADVERTENCIA.campos);
for (const [descricao, valores, esperado] of casosValores(HOJE, AMANHA)) {
  test(`valores: ${descricao}`, () => {
    const r = validarValores(CAMPOS_ADV, valores, { hoje: HOJE });
    if (typeof esperado === 'string') assert.equal(r.erros[0]?.codigo, esperado);
    else {
      assert.deepEqual(r.erros, []);
      assert.deepEqual(r.valores, esperado);
    }
  });
}

// --- Formatação ------------------------------------------------------------

test('formatação: datas, extenso em português, CPF, CNPJ e número do documento', () => {
  assert.equal(formatarData('2026-10-05'), '05/10/2026');
  assert.equal(formatarDataExtenso('2026-10-26'), '26 de outubro de 2026');
  assert.equal(formatarDataExtenso('2026-03-01'), '1º de março de 2026');
  assert.equal(formatarDataExtenso('2026-12-09'), '9 de dezembro de 2026');
  assert.equal(formatarCpf('12345678901'), '123.456.789-01');
  assert.equal(formatarCpf('123'), '123');
  assert.equal(formatarCnpj('12345678000199'), '12.345.678/0001-99');
  assert.equal(formatarNumeroDocumento(2026, 7), '2026/0007');
  assert.equal(formatarNumeroDocumento(2026, 12345), '2026/12345');
  assert.equal(dataValida('2025-02-29'), false);
  assert.equal(dataValida('2024-02-29'), true);
  assert.equal(aparar(' x '), ' x '); // só espaço/tab/quebras, como no banco
  assert.equal(tamanho('😀a'), 2); // caracteres, como char_length
});

// --- Emissão / renderização --------------------------------------------------

test('emissão individual: texto resolvido, colunas do histórico e parágrafos', () => {
  const r = montarEmissao({ modelo: salvo(MODELO_ADVERTENCIA), funcionario: FUNCIONARIA, empresa: EMPRESA, valores: VALORES, dataEmissao: HOJE, numero: { ano: 2026, numero: 7 } });
  assert.deepEqual(r.erros, []);
  assert.equal(r.titulo, 'ADVERTÊNCIA DISCIPLINAR');
  assert.equal(r.assunto, 'atrasos');
  assert.equal(r.data_ocorrencia, '2026-10-20');
  assert.equal(r.conteudo, [
    'Comunicamos à colaboradora Maria da Silva, CPF 123.456.789-01, cargo Atendente,',
    'a aplicação de advertência em razão de atrasos, referente à ocorrência do dia 20/10/2026.',
    '',
    'Descrição: Chegou 40 min atrasada.',
    '',
    'Reincidente.',
    'Gravidade: Grave -- dias: 3,5',
    '',
    '',
    'Documento 2026/0007, emitido em 26 de outubro de 2026 (26/10/2026) por Exemplo Panificadora Ltda.',
    'Reiteramos: atrasos.',
  ].join('\n'));
  assert.deepEqual(dividirParagrafos(r.conteudo).map((p) => p.length), [2, 1, 2, 2]);
});

test('emissão geral: sem funcionário, sem variáveis de funcionário', () => {
  const r = montarEmissao({ modelo: salvo(MODELO_COMUNICADO), funcionario: null, empresa: EMPRESA, valores: { assunto: 'Uniforme', texto: 'Usar touca.' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 8 } });
  assert.deepEqual(r.erros, []);
  assert.equal(r.conteudo, 'Padoca Exemplo comunica: Uniforme\n\nUsar touca.\n\nCidade Exemplo/MG, 26 de outubro de 2026.');
  assert.equal(r.snapshot.funcionario, null);
  assert.ok(!Object.keys(r.snapshot.variaveis).some((k) => k.startsWith('funcionario.')));
  assert.equal(r.data_ocorrencia, null);
});

test('emissão: abrangência x funcionário', () => {
  const base = { empresa: EMPRESA, valores: VALORES, dataEmissao: HOJE };
  assert.equal(montarEmissao({ ...base, modelo: salvo(MODELO_ADVERTENCIA), funcionario: null }).erros[0].codigo, 'emissao_funcionario_obrigatorio');
  assert.equal(montarEmissao({ ...base, modelo: salvo(MODELO_COMUNICADO), funcionario: FUNCIONARIA, valores: { assunto: 'a', texto: 'b' } }).erros[0].codigo, 'emissao_funcionario_indevido');
});

test('emissão: dados obrigatórios da empresa/funcionário na ordem do banco', () => {
  const base = { modelo: salvo(MODELO_ADVERTENCIA), funcionario: FUNCIONARIA, valores: VALORES, dataEmissao: HOJE, numero: { ano: 2026, numero: 1 } };
  const codigos = (empresa, funcionario = FUNCIONARIA) => montarEmissao({ ...base, empresa, funcionario }).erros.map((e) => e.codigo);
  assert.deepEqual(codigos({}), ['config_razao_social_ausente', 'config_cidade_uf_ausente', 'config_responsavel_ausente', 'dado_automatico_ausente']);
  assert.deepEqual(codigos(EMPRESA, { ...FUNCIONARIA, cpf: null }), ['dado_automatico_ausente']);
  // Dado ausente que o texto não usa não bloqueia (RG vazio).
  assert.deepEqual(codigos(EMPRESA), []);
});

test('prévia: sem número, pendências listadas mas texto montado com marcadores', () => {
  const r = montarEmissao({ modelo: salvo(MODELO_ADVERTENCIA), funcionario: FUNCIONARIA, empresa: { ...EMPRESA, razao_social: '' }, valores: VALORES, dataEmissao: HOJE }, { previa: true });
  assert.deepEqual(r.erros.map((e) => e.codigo), ['config_razao_social_ausente', 'dado_automatico_ausente']);
  assert.ok(r.conteudo.includes(`Documento ${NUMERO_PREVIA}`));
  assert.ok(r.conteudo.includes('por [empresa.razao_social].'));
  assert.equal(r.snapshot.documento.numero_formatado, null);
});

// --- Snapshot ----------------------------------------------------------------

test('snapshot: determinístico, versão do modelo, dados congelados e layout_versao', () => {
  const entrada = () => ({ modelo: salvo(MODELO_ADVERTENCIA), funcionario: { ...FUNCIONARIA }, empresa: { ...EMPRESA }, valores: { ...VALORES }, dataEmissao: HOJE, numero: { ano: 2026, numero: 7 } });
  const a = montarEmissao(entrada());
  const b = montarEmissao(entrada());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a.snapshot), JSON.stringify(b.snapshot));
  assert.equal(a.snapshot.layout_versao, LAYOUT_VERSAO);
  assert.equal(a.snapshot.modelo.versao, 3);
  assert.deepEqual(a.snapshot.documento, { ano: 2026, numero: 7, numero_formatado: '2026/0007', data_emissao: HOJE });
  // Funcionário: só id + nome. Variáveis: só as usadas no corpo (o
  // modelo usa CPF e cargo -> entram formatados; RG/admissão não).
  assert.deepEqual(a.snapshot.funcionario, { id: 'f-1', nome: 'Maria da Silva' });
  assert.deepEqual(Object.keys(a.snapshot.variaveis), analisarPlaceholders(a.snapshot.modelo.corpo).nomes);
  assert.equal(a.snapshot.variaveis['funcionario.cpf'], '123.456.789-01');
  assert.equal(a.snapshot.variaveis['funcionario.cargo'], 'Atendente');
  assert.ok(!('funcionario.rg' in a.snapshot.variaveis) && !('funcionario.admissao' in a.snapshot.variaveis));
  assert.equal(a.snapshot.empresa.razao_social, 'Exemplo Panificadora Ltda');
  // Com assinatura da empresa: responsável e cargo congelados.
  assert.equal(a.snapshot.empresa.responsavel, 'Responsável Exemplo');
  assert.equal(a.snapshot.empresa.responsavel_cargo, 'Sócia');
  assert.equal(a.snapshot.valores.dias, '3.5');
  assert.equal(a.snapshot.variaveis.dias, '3,5');
  assert.deepEqual(a.snapshot.modelo.assinaturas, { empresa: true, funcionario: true, testemunhas: 2, local_data: true });
});

test('snapshot: documento independe do modelo/cadastro depois da emissão', () => {
  const modelo = salvo(MODELO_ADVERTENCIA);
  const funcionario = { ...FUNCIONARIA };
  const emitido = montarEmissao({ modelo, funcionario, empresa: { ...EMPRESA }, valores: VALORES, dataEmissao: HOJE, numero: { ano: 2026, numero: 7 } });
  const documento = { conteudo: emitido.conteudo, snapshot: JSON.parse(JSON.stringify(emitido.snapshot)), status: 'emitido' };
  const antes = montarDocumento(documento);
  // Modelo editado e funcionária com cargo novo depois da emissão:
  modelo.corpo = 'TEXTO NOVO {{motivo}}';
  modelo.titulo_impresso = 'OUTRO';
  modelo.campos.push({ chave: 'z', rotulo: 'Z', tipo: 'texto', obrigatorio: true });
  funcionario.nome = 'Outro Nome';
  assert.deepEqual(montarDocumento(documento), antes);
  assert.equal(antes.titulo, 'ADVERTÊNCIA DISCIPLINAR');
});

// --- Representação intermediária -------------------------------------------

test('documento: blocos comuns para HTML/PDF/DOCX/impressão', () => {
  const r = montarEmissao({ modelo: salvo(MODELO_ADVERTENCIA), funcionario: FUNCIONARIA, empresa: EMPRESA, valores: { ...VALORES, data_ocorrencia: '2026-09-20' }, dataEmissao: '2026-10-01', numero: { ano: 2026, numero: 7 } });
  const d = montarDocumento({ ...r, status: 'emitido' });
  assert.equal(d.layoutVersao, 1);
  assert.equal(d.numero, '2026/0007');
  assert.equal(d.dataEmissao, '01/10/2026');
  assert.equal(d.empresa.cnpj, '12.345.678/0001-95');
  assert.equal(d.localData, 'Cidade Exemplo/MG, 1º de outubro de 2026.');
  assert.deepEqual(d.assinaturas.map((a) => a.papel), ['empresa', 'funcionario', 'testemunha', 'testemunha']);
  // Assinatura da funcionária: linha + nome, sem CPF automático.
  assert.deepEqual(d.assinaturas[1], { papel: 'funcionario', nome: 'Maria da Silva', linhas: [] });
  assert.equal(d.cancelamento, null);

  const cancelado = montarDocumento({ ...r, status: 'cancelado', cancelado_em: '2026-10-02T10:00:00Z', cancelado_por_nome: 'Admin', motivo_cancelamento: 'Emitido por engano' });
  assert.deepEqual(cancelado.cancelamento, { em: '2026-10-02T10:00:00Z', por: 'Admin', motivo: 'Emitido por engano' });
  assert.deepEqual(cancelado.paragrafos, d.paragrafos);

  const geral = montarEmissao({ modelo: salvo(MODELO_COMUNICADO), funcionario: null, empresa: EMPRESA, valores: { assunto: 'a', texto: 'b' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 9 } });
  const dg = montarDocumento(geral);
  assert.equal(dg.localData, null);
  assert.deepEqual(dg.assinaturas.map((a) => a.papel), ['empresa']);
  assert.throws(() => montarDocumento({ ...geral, snapshot: { ...geral.snapshot, layout_versao: 99 } }));
});

// --- Snapshot mínimo: CPF/RG só quando o corpo usa --------------------------

const MODELO_TERMO = {
  nome: 'Termo de ciência', titulo_impresso: 'TERMO DE CIÊNCIA', abrangencia: 'individual',
  corpo: 'Eu, {{funcionario.nome}}, declaro ciência de {{assunto}}.',
  campos: [{ chave: 'assunto', rotulo: 'Assunto', tipo: 'texto', obrigatorio: true, papel: 'assunto' }],
  assinatura_empresa: false, assinatura_funcionario: true, testemunhas: 0, local_data: false,
};
const COM_RG = { ...FUNCIONARIA, rg: 'MG-12.345.678' };

test('snapshot: documento individual que não usa CPF/RG não guarda CPF/RG', () => {
  const r = montarEmissao({ modelo: salvo(MODELO_TERMO), funcionario: COM_RG, empresa: EMPRESA, valores: { assunto: 'o regulamento' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 3 } });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.snapshot.funcionario, { id: 'f-1', nome: 'Maria da Silva' });
  assert.deepEqual(r.snapshot.variaveis, { 'funcionario.nome': 'Maria da Silva', assunto: 'o regulamento' });
  // Sem assinatura da empresa: responsável e cargo não são copiados.
  assert.deepEqual(Object.keys(r.snapshot.empresa).sort(), ['cidade_uf', 'cnpj', 'endereco', 'nome', 'razao_social']);
  for (const dado of ['Responsável Exemplo', 'Sócia']) assert.ok(!JSON.stringify(r).includes(dado), dado);
  const tudo = JSON.stringify(r);
  for (const dado of ['12345678901', '123.456.789-01', 'MG-12.345.678', 'Atendente', '2025-03-01']) assert.ok(!tudo.includes(dado), dado);
  const d = montarDocumento(r);
  assert.deepEqual(d.assinaturas, [{ papel: 'funcionario', nome: 'Maria da Silva', linhas: [] }]);
});

test('snapshot: modelo que usa {{funcionario.cpf}} / {{funcionario.rg}} congela o valor e reconstrói o texto', () => {
  const modelo = salvo({ ...MODELO_TERMO, corpo: 'Eu, {{funcionario.nome}}, CPF {{funcionario.cpf}}, RG {{funcionario.rg}}, declaro ciência de {{assunto}}.' });
  const r = montarEmissao({ modelo, funcionario: COM_RG, empresa: EMPRESA, valores: { assunto: 'x' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 4 } });
  assert.deepEqual(r.erros, []);
  assert.equal(r.snapshot.variaveis['funcionario.cpf'], '123.456.789-01');
  assert.equal(r.snapshot.variaveis['funcionario.rg'], 'MG-12.345.678');
  assert.deepEqual(r.snapshot.funcionario, { id: 'f-1', nome: 'Maria da Silva' });
  // Reconstrução só com o snapshot: corpo do modelo + variáveis usadas.
  assert.equal(resolverTemplate(r.snapshot.modelo.corpo, r.snapshot.variaveis), r.conteudo);
  // RG usado e não cadastrado -> recusa (dado_automatico_ausente).
  const semRg = montarEmissao({ modelo, funcionario: FUNCIONARIA, empresa: EMPRESA, valores: { assunto: 'x' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 4 } });
  assert.deepEqual(semRg.erros.map((e) => e.codigo), ['dado_automatico_ausente']);
});

test('snapshot: o texto se reconstrói com o corpo e as variáveis guardadas', () => {
  for (const [modelo, funcionario, valores] of [[MODELO_ADVERTENCIA, FUNCIONARIA, VALORES], [MODELO_COMUNICADO, null, { assunto: 'a', texto: 'b' }]]) {
    const r = montarEmissao({ modelo: salvo(modelo), funcionario, empresa: EMPRESA, valores, dataEmissao: HOJE, numero: { ano: 2026, numero: 5 } });
    assert.equal(resolverTemplate(r.snapshot.modelo.corpo, r.snapshot.variaveis), r.conteudo);
  }
});

// --- Decisões mantidas -----------------------------------------------------

test('emissão: data da ocorrência futura é recusada; passada e hoje são aceitas', () => {
  const emitir = (data) => montarEmissao({ modelo: salvo(MODELO_ADVERTENCIA), funcionario: FUNCIONARIA, empresa: EMPRESA, valores: { ...VALORES, data_ocorrencia: data }, dataEmissao: HOJE, numero: { ano: 2026, numero: 1 } });
  assert.deepEqual(emitir(AMANHA).erros.map((e) => e.codigo), ['valor_data_futura']);
  assert.deepEqual(emitir(HOJE).erros, []);
  assert.deepEqual(emitir('2020-01-15').erros, []);
});

test('emissão: funcionário inativo pode receber documento (sem bloqueio por ativo)', () => {
  const r = montarEmissao({ modelo: salvo(MODELO_TERMO), funcionario: { ...FUNCIONARIA, ativo: false }, empresa: EMPRESA, valores: { assunto: 'o desligamento' }, dataEmissao: HOJE, numero: { ano: 2026, numero: 6 } });
  assert.deepEqual(r.erros, []);
});

// --- Nome do modelo: unicidade sem acento/caixa/bordas ---------------------

test('nome do modelo: Advertência = Advertencia = ADVERTÊNCIA (chave de unicidade)', () => {
  assert.deepEqual(new Set(NOMES_EQUIVALENTES.map(chaveNomeModelo)), new Set(['advertencia']));
  const distintas = [...NOMES_DISTINTOS, NOMES_EQUIVALENTES[0]].map(chaveNomeModelo);
  assert.equal(new Set(distintas).size, distintas.length);
  assert.equal(chaveNomeModelo('Ação'), 'acao');
  assert.equal(chaveNomeModelo('Ñandu Øre'), 'nandu Øre'); // fora da tabela: fica igual (como no banco)
});

// --- CNPJ da configuração --------------------------------------------------

for (const [entrada, esperado] of CASOS_CNPJ) {
  test(`CNPJ da configuração: ${JSON.stringify(entrada)}`, () => {
    const r = normalizarCnpjConfig(entrada);
    if (esperado === 'invalido') assert.deepEqual(r.erros.map((e) => e.codigo), ['config_cnpj_invalido']);
    else assert.deepEqual(r, { cnpj: esperado, erros: [] });
  });
}

test('codigoDoErro lê o código da mensagem da RPC', () => {
  assert.equal(codigoDoErro('folha_documentos: [emissao_modelo_alterado] o modelo mudou'), 'emissao_modelo_alterado');
  assert.equal(codigoDoErro('outro erro'), null);
});

// --- Paridade estática com a migration -------------------------------------

test('migration: mesmo catálogo de automáticas, reservadas, tipos, meses e layout', () => {
  for (const v of VARIAVEIS_AUTOMATICAS) {
    assert.ok(MIGRATION.includes(`('${v.chave}', ${v.somenteIndividual})`), v.chave);
  }
  assert.ok(MIGRATION.includes(`v_chave in (${CHAVES_RESERVADAS.map((c) => `'${c}'`).join(', ')})`));
  assert.ok(MIGRATION.includes(`v_tipo in (${TIPOS_CAMPO.map((t) => `'${t}'`).join(', ')})`));
  assert.ok(MIGRATION.includes(MESES.map((m) => `'${m}'`).slice(0, 6).join(', ')));
  assert.ok(MIGRATION.includes(MESES.map((m) => `'${m}'`).slice(6).join(', ')));
  assert.ok(MIGRATION.includes(`'layout_versao', ${LAYOUT_VERSAO}`));
  // Todo código de erro do JS existe no SQL (a tela traduz pelo código).
  const codigosJs = [...new Set([...readFileSync(new URL('../campos.js', import.meta.url), 'utf8').matchAll(/'((?:campo|campos|valor|valores)_[a-z_]+)'/g),
    ...readFileSync(new URL('../modelo.js', import.meta.url), 'utf8').matchAll(/'((?:modelo|placeholder|campo)_[a-z_]+)'/g),
    ...readFileSync(new URL('../emissao.js', import.meta.url), 'utf8').matchAll(/'((?:config|dado|emissao)_[a-z_]+)'/g),
    ...readFileSync(new URL('../config.js', import.meta.url), 'utf8').matchAll(/'(config_[a-z_]+)'/g)].map((m) => m[1]))];
  for (const codigo of codigosJs) assert.ok(MIGRATION.includes(`'${codigo}'`), codigo);
  assert.ok(codigosJs.includes('config_cnpj_invalido'));
});

test('migration: mesma tabela de acentos do nome do modelo', () => {
  const fonte = readFileSync(new URL('../modelo.js', import.meta.url), 'utf8');
  const com = fonte.match(/const COM_ACENTO = '([^']+)'/)[1];
  const sem = fonte.match(/const SEM_ACENTO = '([^']+)'/)[1];
  assert.equal([...com].length, [...sem].length);
  assert.equal(new Set(com).size, [...com].length);
  assert.ok(MIGRATION.includes(`'${com}',\n                   '${sem}'`));
});
