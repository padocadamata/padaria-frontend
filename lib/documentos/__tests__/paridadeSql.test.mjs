// PARIDADE núcleo JS x SQL da migration 0077, num Postgres LOCAL em
// memória (PGlite) -- nunca o Supabase. Opcional: o projeto não depende do
// PGlite; rode com o caminho de uma instalação avulsa (fora do repositório):
//
//   PGLITE_MODULE=<pasta>/node_modules/@electric-sql/pglite/dist/index.js \
//     node --test lib/documentos/__tests__/paridadeSql.test.mjs
//
// Sem PGLITE_MODULE os testes são PULADOS. Cobre: mesmos casos de
// casos.mjs (modelo, valores, formatação, resolução) com o mesmo 1º código
// de erro; chave do nome do modelo; CNPJ; emissão completa (conteúdo +
// snapshot mínimo idênticos ao montarEmissao);
// numeração anual; imutabilidade; cancelamento; RLS/grants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { codigoDoErro } from '../erros.js';
import { normalizarCampos, validarValores } from '../campos.js';
import { chaveNomeModelo, normalizarModelo, normalizarTextosModelo, validarModelo } from '../modelo.js';
import { normalizarCnpjConfig } from '../config.js';
import { montarEmissao } from '../emissao.js';
import { analisarPlaceholders, resolverTemplate } from '../placeholders.js';
import { formatarCnpj, formatarCpf, formatarData, formatarDataExtenso, formatarNumeroDocumento } from '../formatacao.js';
import { CASOS_CNPJ, CASOS_FORMATACAO, CASOS_MODELO, CASOS_RESOLVER, MODELO_ADVERTENCIA, MODELO_COMUNICADO, NOMES_DISTINTOS, NOMES_EQUIVALENTES, casosValores } from './casos.mjs';

const modulo = process.env.PGLITE_MODULE;
const pular = modulo ? false : 'defina PGLITE_MODULE para rodar a paridade com o SQL (PGlite local)';

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const GESTAO = '00000000-0000-0000-0000-00000000000b';

let db;
async function banco() {
  if (db) return db;
  const { PGlite } = await import(pathToFileURL(modulo).href);
  db = new PGlite();
  await db.exec(readFileSync(new URL('./sql/ambiente.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/0077_folha_documentos.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into auth.users values ('${ADMIN}'), ('${GESTAO}');
    insert into public.usuarios values ('${ADMIN}', 'Admin Teste', 'proprietario_admin', true), ('${GESTAO}', 'Gestão Teste', 'gestao', true);
  `);
  return db;
}

// Executa como superusuário (funções internas) ou como um usuário logado
// (RPCs, RLS). Devolve { linhas } ou { codigo, mensagem, sqlstate }.
async function rodar(sql, params = [], usuario = null) {
  const d = await banco();
  try {
    await d.exec(usuario
      ? `set role authenticated; select set_config('request.jwt.claim.sub', '${usuario}', false);`
      : `reset role; select set_config('request.jwt.claim.sub', '', false);`);
    const r = await d.query(sql, params);
    return { linhas: r.rows };
  } catch (e) {
    return { codigo: codigoDoErro(e.message), mensagem: e.message, sqlstate: e.code };
  } finally {
    await d.exec('reset role;');
  }
}

async function hojeSql() {
  return (await rodar(`select to_char(public.folha_hoje(), 'YYYY-MM-DD') as h`)).linhas[0].h;
}

function somarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const ARGS_SALVAR = `$1::uuid, $2::int, $3, $4, $5, $6, $7, $8::jsonb, $9::boolean, $10::boolean, $11::int, $12::boolean, $13::boolean`;
function paramsSalvar(modelo, { id = null, versao = null, ativo = true } = {}) {
  return [id, versao, modelo.nome, modelo.descricao ?? null, modelo.titulo_impresso, modelo.abrangencia, modelo.corpo,
    JSON.stringify(modelo.campos), modelo.assinatura_empresa, modelo.assinatura_funcionario, modelo.testemunhas, modelo.local_data, ativo];
}

// --- Validação do modelo: mesmo 1º código de erro ----------------------------

test('paridade: validação de modelo (todos os casos de casos.mjs)', { skip: pular }, async () => {
  for (const [descricao, modelo, esperado] of CASOS_MODELO) {
    const t = normalizarTextosModelo(modelo);
    const r = await rodar(
      'select public.folha_documentos_modelo_validar($1, $2, $3, $4, $5, $6::jsonb, $7::boolean, $8::int)',
      [t.nome, t.titulo_impresso, t.descricao, modelo.abrangencia ?? null, t.corpo, JSON.stringify(modelo.campos),
        modelo.assinatura_funcionario === true, modelo.testemunhas],
    );
    const js = validarModelo(modelo)[0]?.codigo ?? null;
    assert.equal(js, esperado, `JS: ${descricao}`);
    assert.equal(r.codigo ?? null, esperado, `SQL: ${descricao} -> ${r.mensagem ?? 'ok'}`);
  }
});

test('paridade: forma canônica dos campos', { skip: pular }, async () => {
  for (const modelo of [MODELO_ADVERTENCIA, MODELO_COMUNICADO]) {
    const r = await rodar('select public.folha_documentos_campos_normalizar($1::jsonb) as c', [JSON.stringify(modelo.campos)]);
    assert.deepEqual(r.linhas[0].c, normalizarCampos(modelo.campos));
  }
});

// --- Valores --------------------------------------------------------------

test('paridade: validação/normalização de valores', { skip: pular }, async () => {
  const hoje = '2026-10-26';
  const campos = normalizarCampos(MODELO_ADVERTENCIA.campos);
  for (const [descricao, valores, esperado] of casosValores(hoje, '2026-10-27')) {
    const js = validarValores(campos, valores, { hoje });
    const r = await rodar('select public.folha_documentos_valores_normalizar($1::jsonb, $2::jsonb, $3::date) as v',
      [JSON.stringify(campos), JSON.stringify(valores), hoje]);
    if (typeof esperado === 'string') {
      assert.equal(js.erros[0]?.codigo, esperado, `JS: ${descricao}`);
      assert.equal(r.codigo, esperado, `SQL: ${descricao} -> ${r.mensagem ?? 'ok'}`);
    } else {
      assert.deepEqual(js.valores, esperado, `JS: ${descricao}`);
      assert.deepEqual(r.linhas?.[0].v, esperado, `SQL: ${descricao} -> ${r.mensagem ?? ''}`);
    }
  }
});

// --- Formatação e resolução -------------------------------------------------

test('paridade: datas, extenso, CPF, CNPJ, número e resolução do texto', { skip: pular }, async () => {
  for (const data of CASOS_FORMATACAO.datas) {
    const r = await rodar('select public.folha_documentos_formatar_data($1::date) as d, public.folha_documentos_formatar_data_extenso($1::date) as e', [data]);
    assert.deepEqual(r.linhas[0], { d: formatarData(data), e: formatarDataExtenso(data) }, data);
  }
  for (const cpf of CASOS_FORMATACAO.cpfs) {
    assert.equal((await rodar('select public.folha_documentos_formatar_cpf($1) as v', [cpf])).linhas[0].v, formatarCpf(cpf), cpf);
  }
  for (const cnpj of CASOS_FORMATACAO.cnpjs) {
    assert.equal((await rodar('select public.folha_documentos_formatar_cnpj($1) as v', [cnpj])).linhas[0].v, formatarCnpj(cnpj), cnpj);
  }
  for (const [ano, numero] of CASOS_FORMATACAO.numeros) {
    assert.equal((await rodar('select public.folha_documentos_formatar_numero($1, $2) as v', [ano, numero])).linhas[0].v, formatarNumeroDocumento(ano, numero));
  }
  for (const [descricao, corpo, variaveis] of CASOS_RESOLVER) {
    const r = await rodar('select public.folha_documentos_resolver($1, $2::jsonb) as t', [corpo, JSON.stringify(variaveis)]);
    assert.equal(r.linhas[0].t, resolverTemplate(corpo, variaveis), descricao);
  }
});

test('paridade: chave de unicidade do nome e validação do CNPJ', { skip: pular }, async () => {
  for (const nome of [...NOMES_EQUIVALENTES, ...NOMES_DISTINTOS]) {
    const r = await rodar('select public.folha_documentos_nome_chave($1) as k', [nome]);
    assert.equal(r.linhas[0].k, chaveNomeModelo(nome), JSON.stringify(nome));
  }
  for (const [entrada] of CASOS_CNPJ) {
    const digitos = entrada === null ? null : entrada.trim().replace(/[./ -]/g, '');
    const r = await rodar('select public.folha_documentos_cnpj_valido($1) as v', [digitos]);
    const js = normalizarCnpjConfig(entrada);
    assert.equal(r.linhas[0].v, js.cnpj !== null, JSON.stringify(entrada));
  }
});

// --- Fluxo real das RPCs ----------------------------------------------------

const EMPRESA = ['Padoca Exemplo', 'Exemplo Panificadora Ltda', '12.345.678/0001-95', 'Rua A, 1', 'Cidade Exemplo/MG', 'Responsável Exemplo', 'Sócia'];
const CONFIG_JS = { nome_fantasia: EMPRESA[0], razao_social: EMPRESA[1], cnpj: '12345678000195', endereco: EMPRESA[3], cidade_uf: EMPRESA[4], responsavel_nome: EMPRESA[5], responsavel_cargo: EMPRESA[6] };

test('RPCs: emissão autoritativa igual à prévia JS, numeração, versão, cancelamento e guardas', { skip: pular }, async () => {
  const hoje = await hojeSql();
  const ano = Number(hoje.slice(0, 4));

  // Sem permissão (gestao não recebeu nenhum código) -> 42501.
  assert.equal((await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar(MODELO_ADVERTENCIA), GESTAO)).sqlstate, '42501');

  // Modelos.
  const criado = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR}) as r`, paramsSalvar(MODELO_ADVERTENCIA), ADMIN);
  assert.equal(criado.linhas[0].r.versao, 1, criado.mensagem);
  const modeloId = criado.linhas[0].r.id;
  const duplicado = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar({ ...MODELO_ADVERTENCIA, nome: 'ADVERTÊNCIA ' }), ADMIN);
  assert.equal(duplicado.codigo, 'modelo_nome_duplicado');
  for (const nome of NOMES_EQUIVALENTES) {
    const r = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar({ ...MODELO_ADVERTENCIA, nome }), ADMIN);
    assert.equal(r.codigo, 'modelo_nome_duplicado', JSON.stringify(nome));
  }
  const plural = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR}) as r`, paramsSalvar({ ...MODELO_ADVERTENCIA, nome: 'Advertências' }), ADMIN);
  assert.equal(plural.linhas?.[0].r.versao, 1, plural.mensagem);
  const invalido = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar({ ...MODELO_ADVERTENCIA, nome: 'Outro', corpo: '{{xyz}}' }), ADMIN);
  assert.equal(invalido.codigo, validarModelo({ ...MODELO_ADVERTENCIA, nome: 'Outro', corpo: '{{xyz}}' })[0].codigo);

  // Mesmo conteúdo -> mesma versão; conteúdo novo -> +1; versão velha -> recusa.
  const igual = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR}) as r`, paramsSalvar(MODELO_ADVERTENCIA, { id: modeloId, versao: 1 }), ADMIN);
  assert.equal(igual.linhas[0].r.versao, 1);
  const alterado = { ...MODELO_ADVERTENCIA, titulo_impresso: 'ADVERTÊNCIA' };
  assert.equal((await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR}) as r`, paramsSalvar(alterado, { id: modeloId, versao: 1 }), ADMIN)).linhas[0].r.versao, 2);
  assert.equal((await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar(MODELO_ADVERTENCIA, { id: modeloId, versao: 1 }), ADMIN)).codigo, 'modelo_alterado');
  // Inativar/reativar não muda a versão.
  await rodar('select public.folha_documento_modelo_definir_ativo($1, false)', [modeloId], ADMIN);
  await rodar('select public.folha_documento_modelo_definir_ativo($1, true)', [modeloId], ADMIN);
  const modeloBanco = (await rodar('select * from public.folha_documentos_modelos where id = $1', [modeloId], ADMIN)).linhas[0];
  assert.equal(modeloBanco.versao, 2);
  assert.deepEqual(modeloBanco.campos, normalizarCampos(MODELO_ADVERTENCIA.campos));
  assert.equal(modeloBanco.corpo, normalizarModelo(MODELO_ADVERTENCIA).corpo);

  const comunicado = await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR}) as r`, paramsSalvar(MODELO_COMUNICADO), ADMIN);
  const comunicadoId = comunicado.linhas[0].r.id;
  // Renomear outro modelo para o mesmo nome (sem acento) também colide.
  assert.equal((await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar({ ...MODELO_COMUNICADO, nome: 'ADVERTENCIA' }, { id: comunicadoId, versao: 1 }), ADMIN)).codigo, 'modelo_nome_duplicado');

  // Funcionária.
  const func = (await rodar(`
    with c as (insert into public.funcionarios_cargos (nome) values (' Atendente ') returning id)
    insert into public.funcionarios (nome, cpf, rg, cargo_id, data_admissao) select 'Maria da Silva', '12345678901', null, id, '2025-03-01' from c returning id`)).linhas[0].id;
  const funcJs = { id: func, nome: 'Maria da Silva', cpf: '12345678901', rg: null, cargo: ' Atendente ', data_admissao: '2025-03-01' };
  const valores = { motivo: ' atrasos ', data_ocorrencia: somarDias(hoje, -3), descricao: 'Linha 1\r\n\r\nLinha 2', gravidade: 'Grave', dias: '03,5' };
  const emitir = (id, versao, funcionario, v, usuario = ADMIN) =>
    rodar('select public.folha_documento_emitir($1, $2, $3, $4::jsonb) as id', [id, versao, funcionario, JSON.stringify(v)], usuario);

  // Config vazia -> erro claro, sem consumir número.
  assert.equal((await emitir(modeloId, 2, func, valores)).codigo, 'config_razao_social_ausente');
  const cfg = await rodar('select public.folha_documentos_config_salvar($1, $2, $3, $4, $5, $6, $7)', EMPRESA, ADMIN);
  assert.equal(cfg.mensagem, undefined, cfg.mensagem);
  // CNPJ: NULL/vazio permitido; com ou sem máscara gravado em 14 dígitos;
  // inválido recusado -- mesmo resultado de normalizarCnpjConfig.
  for (const [entrada, esperado] of CASOS_CNPJ) {
    const r = await rodar('select public.folha_documentos_config_salvar($1, $2, $3, $4, $5, $6, $7)', [EMPRESA[0], EMPRESA[1], entrada, null, null, null, null], ADMIN);
    const js = normalizarCnpjConfig(entrada);
    if (esperado === 'invalido') {
      assert.equal(r.codigo, 'config_cnpj_invalido', JSON.stringify(entrada));
      assert.equal(js.erros[0].codigo, 'config_cnpj_invalido');
    } else {
      assert.equal(r.mensagem, undefined, r.mensagem);
      const gravado = (await rodar('select cnpj from public.folha_documentos_config', [], ADMIN)).linhas[0].cnpj;
      assert.equal(gravado, esperado, JSON.stringify(entrada));
      assert.equal(js.cnpj, esperado);
    }
  }
  assert.equal((await rodar('select public.folha_documentos_config_salvar($1, $2, $3, $4, $5, $6, $7)', EMPRESA, ADMIN)).mensagem, undefined);

  // Erros da emissão.
  assert.equal((await emitir(modeloId, 1, func, valores)).codigo, 'emissao_modelo_alterado');
  assert.equal((await emitir(modeloId, 2, null, valores)).codigo, 'emissao_funcionario_obrigatorio');
  assert.equal((await emitir(comunicadoId, 1, func, { assunto: 'a', texto: 'b' })).codigo, 'emissao_funcionario_indevido');
  assert.equal((await emitir(modeloId, 2, func, { ...valores, data_ocorrencia: somarDias(hoje, 1) })).codigo, 'valor_data_futura');
  assert.equal((await emitir(modeloId, 2, func, valores, GESTAO)).sqlstate, '42501');

  // Emissão individual = prévia JS (conteúdo, colunas e snapshot inteiros).
  const r1 = await emitir(modeloId, 2, func, valores);
  assert.ok(r1.linhas, r1.mensagem);
  const doc1 = (await rodar('select *, data_ocorrencia::text as ocorrencia from public.folha_documentos where id = $1', [r1.linhas[0].id], ADMIN)).linhas[0];
  const js1 = montarEmissao({ modelo: modeloBanco, funcionario: funcJs, empresa: CONFIG_JS, valores, dataEmissao: hoje, numero: { ano, numero: 1 } });
  assert.deepEqual(js1.erros, []);
  assert.equal(doc1.conteudo, js1.conteudo);
  assert.deepEqual(doc1.snapshot, js1.snapshot);
  assert.equal(doc1.titulo, js1.titulo);
  assert.equal(doc1.assunto, js1.assunto);
  assert.equal(doc1.ocorrencia, js1.data_ocorrencia);
  assert.equal(doc1.numero_formatado, `${ano}/0001`);
  assert.equal(doc1.criado_por_nome, 'Admin Teste');
  assert.equal(doc1.modelo_versao, 2);
  // Snapshot mínimo: funcionário só id + nome; CPF entra porque o corpo usa.
  assert.deepEqual(doc1.snapshot.funcionario, { id: func, nome: 'Maria da Silva' });
  assert.deepEqual(Object.keys(doc1.snapshot.variaveis).sort(), [...analisarPlaceholders(modeloBanco.corpo).nomes].sort());
  assert.equal(doc1.snapshot.variaveis['funcionario.cpf'], '123.456.789-01');
  assert.equal(resolverTemplate(doc1.snapshot.modelo.corpo, doc1.snapshot.variaveis), doc1.conteudo);

  // Emissão geral + numeração sequencial.
  const r2 = await emitir(comunicadoId, 1, null, { assunto: 'Uniforme', texto: 'Usar touca.' });
  const doc2 = (await rodar('select * from public.folha_documentos where id = $1', [r2.linhas[0].id], ADMIN)).linhas[0];
  const modeloCom = (await rodar('select * from public.folha_documentos_modelos where id = $1', [comunicadoId], ADMIN)).linhas[0];
  const js2 = montarEmissao({ modelo: modeloCom, funcionario: null, empresa: CONFIG_JS, valores: { assunto: 'Uniforme', texto: 'Usar touca.' }, dataEmissao: hoje, numero: { ano, numero: 2 } });
  assert.equal(doc2.conteudo, js2.conteudo);
  assert.deepEqual(doc2.snapshot, js2.snapshot);
  assert.equal(doc2.funcionario_id, null);
  assert.equal(doc2.numero, 2);

  // Dado automático usado e ausente (CPF) -> recusa.
  await rodar(`update public.funcionarios set cpf = null where id = $1`, [func]);
  assert.equal((await emitir(modeloId, 2, func, valores)).codigo, 'dado_automatico_ausente');
  await rodar(`update public.funcionarios set cpf = '12345678901' where id = $1`, [func]);

  // Editar o modelo depois da emissão não muda o documento.
  await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar({ ...MODELO_ADVERTENCIA, corpo: 'Novo {{motivo}} {{data_ocorrencia}} {{descricao}} {{gravidade}} {{dias}}' }, { id: modeloId, versao: 2 }), ADMIN);
  const doc1Depois = (await rodar('select conteudo, snapshot from public.folha_documentos where id = $1', [doc1.id], ADMIN)).linhas[0];
  assert.equal(doc1Depois.conteudo, doc1.conteudo);
  assert.deepEqual(doc1Depois.snapshot, doc1.snapshot);

  // Cancelamento.
  const cancelar = (id, motivo, usuario = ADMIN) => rodar('select public.folha_documento_cancelar($1, $2)', [id, motivo], usuario);
  assert.equal((await cancelar(doc1.id, '   ')).codigo, 'cancelamento_motivo_obrigatorio');
  assert.equal((await cancelar(doc1.id, 'x', GESTAO)).sqlstate, '42501');
  assert.equal((await cancelar(doc1.id, ' Emitido por engano ')).mensagem, undefined);
  assert.equal((await cancelar(doc1.id, 'de novo')).codigo, 'documento_ja_cancelado');
  const cancelado = (await rodar('select * from public.folha_documentos where id = $1', [doc1.id], ADMIN)).linhas[0];
  assert.equal(cancelado.status, 'cancelado');
  assert.equal(cancelado.motivo_cancelamento, 'Emitido por engano');
  assert.equal(cancelado.cancelado_por_nome, 'Admin Teste');
  assert.equal(cancelado.conteudo, doc1.conteudo);

  // Número de cancelado nunca é reutilizado.
  const r3 = await emitir(modeloId, 3, func, valores);
  assert.equal((await rodar('select numero from public.folha_documentos where id = $1', [r3.linhas[0].id], ADMIN)).linhas[0].numero, 3);

  // Documento individual que NÃO usa CPF/RG: nada disso no snapshot.
  await rodar(`update public.funcionarios set rg = 'MG-12.345.678' where id = $1`, [func]);
  const funcRg = { ...funcJs, rg: 'MG-12.345.678' };
  const termo = {
    nome: 'Termo de ciência', titulo_impresso: 'TERMO DE CIÊNCIA', abrangencia: 'individual',
    corpo: 'Eu, {{funcionario.nome}}, declaro ciência de {{assunto}}.',
    campos: [{ chave: 'assunto', rotulo: 'Assunto', tipo: 'texto', obrigatorio: true, papel: 'assunto' }],
    assinatura_empresa: false, assinatura_funcionario: true, testemunhas: 0, local_data: false,
  };
  const termoId = (await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR}) as r`, paramsSalvar(termo), ADMIN)).linhas[0].r.id;
  const termoBanco = (await rodar('select * from public.folha_documentos_modelos where id = $1', [termoId], ADMIN)).linhas[0];
  const r4 = await emitir(termoId, 1, func, { assunto: 'o regulamento' });
  const doc4 = (await rodar('select * from public.folha_documentos where id = $1', [r4.linhas[0].id], ADMIN)).linhas[0];
  const js4 = montarEmissao({ modelo: termoBanco, funcionario: funcRg, empresa: CONFIG_JS, valores: { assunto: 'o regulamento' }, dataEmissao: hoje, numero: { ano, numero: 4 } });
  assert.deepEqual(doc4.snapshot, js4.snapshot);
  assert.equal(doc4.conteudo, js4.conteudo);
  assert.deepEqual(doc4.snapshot.funcionario, { id: func, nome: 'Maria da Silva' });
  // Sem assinatura da empresa: sem responsável/cargo; com assinatura (doc1): congelados.
  assert.deepEqual(Object.keys(doc4.snapshot.empresa).sort(), ['cidade_uf', 'cnpj', 'endereco', 'nome', 'razao_social']);
  assert.equal(doc1.snapshot.empresa.responsavel, 'Responsável Exemplo');
  assert.equal(doc1.snapshot.empresa.responsavel_cargo, 'Sócia');
  assert.deepEqual(doc4.snapshot.variaveis, { 'funcionario.nome': 'Maria da Silva', assunto: 'o regulamento' });
  const linha4 = JSON.stringify(doc4);
  for (const dado of ['12345678901', '123.456.789-01', 'MG-12.345.678', '2025-03-01']) assert.ok(!linha4.includes(dado), dado);

  // Modelo que USA CPF e RG, emitido para funcionária INATIVA (permitido):
  // valores congelados no snapshot e texto reconstruível só com ele.
  await rodar('update public.funcionarios set ativo = false where id = $1', [func]);
  const termoDoc = { ...termo, corpo: 'Eu, {{funcionario.nome}}, CPF {{funcionario.cpf}}, RG {{funcionario.rg}}, declaro ciência de {{assunto}}.' };
  await rodar(`select public.folha_documento_modelo_salvar(${ARGS_SALVAR})`, paramsSalvar(termoDoc, { id: termoId, versao: 1 }), ADMIN);
  const termoBanco2 = (await rodar('select * from public.folha_documentos_modelos where id = $1', [termoId], ADMIN)).linhas[0];
  const r5 = await emitir(termoId, 2, func, { assunto: 'o desligamento' });
  assert.ok(r5.linhas, r5.mensagem);
  const doc5 = (await rodar('select * from public.folha_documentos where id = $1', [r5.linhas[0].id], ADMIN)).linhas[0];
  const js5 = montarEmissao({ modelo: termoBanco2, funcionario: { ...funcRg, ativo: false }, empresa: CONFIG_JS, valores: { assunto: 'o desligamento' }, dataEmissao: hoje, numero: { ano, numero: 5 } });
  assert.deepEqual(doc5.snapshot, js5.snapshot);
  assert.equal(doc5.conteudo, js5.conteudo);
  assert.equal(doc5.snapshot.variaveis['funcionario.cpf'], '123.456.789-01');
  assert.equal(doc5.snapshot.variaveis['funcionario.rg'], 'MG-12.345.678');
  assert.equal(resolverTemplate(doc5.snapshot.modelo.corpo, doc5.snapshot.variaveis), doc5.conteudo);
  // Cadastro muda depois: o documento continua igual.
  await rodar(`update public.funcionarios set cpf = '98765432100', rg = null where id = $1`, [func]);
  assert.deepEqual((await rodar('select snapshot from public.folha_documentos where id = $1', [doc5.id], ADMIN)).linhas[0].snapshot, doc5.snapshot);
  await rodar(`update public.funcionarios set cpf = '12345678901', ativo = true where id = $1`, [func]);

  // Guardas -- nem o dono do banco altera/apaga.
  for (const [descricao, sql, motivo] of [
    ['UPDATE conteúdo', `update public.folha_documentos set conteudo = 'x' where id = '${doc2.id}'`],
    ['UPDATE snapshot', `update public.folha_documentos set snapshot = snapshot || '{"x":1}' where id = '${doc2.id}'`],
    ['UPDATE funcionário', `update public.folha_documentos set funcionario_id = null, abrangencia = 'geral' where id = '${r3.linhas[0].id}'`],
    ['UPDATE número', `update public.folha_documentos set numero = 99 where id = '${doc2.id}'`],
    ['UPDATE modelo', `update public.folha_documentos set modelo_versao = 1 where id = '${r3.linhas[0].id}'`],
    ['UPDATE autoria', `update public.folha_documentos set criado_por_nome = 'Outro' where id = '${doc2.id}'`],
    ['reabrir cancelado', `update public.folha_documentos set status = 'emitido', cancelado_em = null, cancelado_por = null, cancelado_por_nome = null, motivo_cancelamento = null where id = '${doc1.id}'`],
    ['cancelar sem motivo', `update public.folha_documentos set status = 'cancelado', cancelado_em = now() where id = '${doc2.id}'`],
    ['DELETE documento', `delete from public.folha_documentos where id = '${doc2.id}'`],
    ['TRUNCATE documentos', 'truncate public.folha_documentos'],
    ['DELETE modelo', `delete from public.folha_documentos_modelos where id = '${modeloId}'`],
    ['versão sem mudança de conteúdo', `update public.folha_documentos_modelos set versao = versao + 1 where id = '${modeloId}'`],
    ['conteúdo sem versão nova', `update public.folha_documentos_modelos set corpo = corpo || ' ' where id = '${modeloId}'`],
    ['contador para trás', `update public.folha_documentos_numeracao set ultimo = 1 where ano = ${ano}`],
    ['DELETE contador', 'delete from public.folha_documentos_numeracao'],
    ['DELETE config', 'delete from public.folha_documentos_config'],
    ['INSERT modelo com nome sem acento já existente', `insert into public.folha_documentos_modelos (nome, titulo_impresso, abrangencia, corpo) values (' ADVERTENCIA ', 'x', 'geral', 'x')`, /folha_documentos_modelos_nome_idx/],
    ['UPDATE CNPJ inválido direto', `update public.folha_documentos_config set cnpj = '12345678000199'`, /folha_documentos_config_cnpj_valido/],
    ['UPDATE CNPJ com máscara direto', `update public.folha_documentos_config set cnpj = '12.345.678/0001-95'`, /folha_documentos_config_cnpj_valido/],
    ['INSERT com data passada', `insert into public.folha_documentos (ano, numero, modelo_id, modelo_versao, abrangencia, titulo, data_emissao, conteudo, snapshot) select ano, 500, modelo_id, modelo_versao, abrangencia, titulo, data_emissao - 1, conteudo, snapshot from public.folha_documentos where id = '${doc2.id}'`],
  ]) {
    const r = await rodar(sql);
    assert.ok(r.mensagem, `${descricao} deveria falhar`);
    if (motivo) assert.match(r.mensagem, motivo, descricao);
  }

  // Escrita direta como usuário logado: sem privilégio.
  for (const sql of [
    `insert into public.folha_documentos_modelos (nome, titulo_impresso, abrangencia, corpo) values ('x', 'x', 'geral', 'x')`,
    `update public.folha_documentos set assunto = 'x'`,
    `delete from public.folha_documentos`,
    `update public.folha_documentos_config set razao_social = 'x'`,
    `select * from public.folha_documentos_numeracao`,
    `select public.folha_documentos_resolver('x', '{}')`,
  ]) {
    assert.equal((await rodar(sql, [], ADMIN)).sqlstate, '42501', sql);
  }

  // RLS: sem permissão não enxerga nada; override individual libera só a leitura.
  assert.equal((await rodar('select count(*)::int as n from public.folha_documentos', [], GESTAO)).linhas[0].n, 0);
  assert.equal((await rodar('select count(*)::int as n from public.folha_documentos_modelos', [], GESTAO)).linhas[0].n, 0);
  assert.equal((await rodar('select count(*)::int as n from public.folha_documentos', [], ADMIN)).linhas[0].n, 5);
  await rodar(`insert into public.usuario_permissoes values ('${GESTAO}', 'folha_documentos.visualizar', 'concede', null)`);
  assert.equal((await rodar('select count(*)::int as n from public.folha_documentos', [], GESTAO)).linhas[0].n, 5);
  assert.equal((await emitir(modeloId, 3, func, valores, GESTAO)).sqlstate, '42501');

  // Permissões semeadas só para proprietario_admin.
  const perm = (await rodar(`select perfil, permissao from public.perfil_permissoes where permissao like 'folha_documentos.%' order by permissao`)).linhas;
  assert.deepEqual(perm.map((p) => p.perfil), ['proprietario_admin', 'proprietario_admin', 'proprietario_admin', 'proprietario_admin']);
});
