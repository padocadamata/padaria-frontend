// Casos COMPARTILHADOS entre os testes do núcleo JS (documentos.test.mjs)
// e a paridade com o SQL da migration 0077 (paridadeSql.test.mjs): o mesmo
// caso tem de dar o mesmo resultado (ou o mesmo 1º código de erro) nos dois.

export const CAMPOS_ADVERTENCIA = [
  { chave: 'motivo', rotulo: 'Motivo', tipo: 'texto', obrigatorio: true, papel: 'assunto' },
  { chave: 'data_ocorrencia', rotulo: 'Data da ocorrência', tipo: 'data', obrigatorio: true, papel: 'data_ocorrencia' },
  { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto_longo', obrigatorio: false, dica: '  Detalhe o ocorrido  ' },
  { chave: 'gravidade', rotulo: 'Gravidade', tipo: 'selecao', obrigatorio: false, opcoes: [' Leve ', 'Média', 'Grave'] },
  { chave: 'dias', rotulo: 'Dias', tipo: 'numero', obrigatorio: false },
];

export const CORPO_ADVERTENCIA = [
  'Comunicamos à colaboradora {{funcionario.nome}}, CPF {{funcionario.cpf}}, cargo {{funcionario.cargo}},',
  'a aplicação de advertência em razão de {{motivo}}, referente à ocorrência do dia {{data_ocorrencia}}.',
  '',
  'Descrição: {{descricao}}',
  'Gravidade: {{gravidade}} -- dias: {{dias}}',
  '',
  '',
  'Documento {{documento.numero}}, emitido em {{data_emissao_extenso}} ({{data_emissao}}) por {{empresa.razao_social}}.',
  'Reiteramos: {{motivo}}.',
].join('\n');

export const MODELO_ADVERTENCIA = {
  nome: '  Advertência  ',
  titulo_impresso: 'ADVERTÊNCIA DISCIPLINAR',
  descricao: '',
  abrangencia: 'individual',
  corpo: `\r\n${CORPO_ADVERTENCIA.replace(/\n/g, '\r\n')}\r\n  `,
  campos: CAMPOS_ADVERTENCIA,
  assinatura_empresa: true,
  assinatura_funcionario: true,
  testemunhas: 2,
  local_data: true,
};

export const MODELO_COMUNICADO = {
  nome: 'Comunicado geral',
  titulo_impresso: 'COMUNICADO',
  descricao: 'Avisos para toda a equipe',
  abrangencia: 'geral',
  corpo: '{{empresa.nome}} comunica: {{assunto}}\n\n{{texto}}\n\n{{empresa.cidade_uf}}, {{data_emissao_extenso}}.',
  campos: [
    { chave: 'assunto', rotulo: 'Assunto', tipo: 'texto', obrigatorio: true, papel: 'assunto' },
    { chave: 'texto', rotulo: 'Texto', tipo: 'texto_longo', obrigatorio: true },
  ],
  assinatura_empresa: true,
  assinatura_funcionario: false,
  testemunhas: 0,
  local_data: false,
};

const com = (alteracoes) => ({ ...MODELO_ADVERTENCIA, ...alteracoes });
const comCampos = (campos, corpo) => com({ campos, corpo: corpo ?? campos.map((c) => `{{${c.chave}}}`).join(' ') });
const campo = (extra) => ({ chave: 'x', rotulo: 'X', tipo: 'texto', obrigatorio: false, ...extra });

// [descrição, modelo, 1º código de erro esperado | null]
export const CASOS_MODELO = [
  ['advertência completa válida', MODELO_ADVERTENCIA, null],
  ['comunicado geral válido', MODELO_COMUNICADO, null],
  ['variável repetida é permitida', comCampos([campo()], '{{x}} e {{x}} e {{x}}'), null],
  ['acentos e símbolos no texto', comCampos([campo()], 'Atenção: ção, ã, é, ü, “aspas” – {x} } { {{x}}'), null],
  ['campo com papel pode ficar fora do texto', comCampos([campo({ papel: 'assunto' }), campo({ chave: 'y' })], '{{y}}'), null],
  ['sem campos, só automáticas', comCampos([], '{{funcionario.nome}} em {{data_emissao}}'), null],
  ['abrangência inválida', com({ abrangencia: 'todos' }), 'modelo_abrangencia_invalida'],
  ['nome vazio', com({ nome: '   ' }), 'modelo_nome_invalido'],
  ['nome longo', com({ nome: 'n'.repeat(81) }), 'modelo_nome_invalido'],
  ['título vazio', com({ titulo_impresso: '' }), 'modelo_titulo_invalido'],
  ['descrição longa', com({ descricao: 'd'.repeat(301) }), 'modelo_descricao_invalida'],
  ['corpo vazio', com({ corpo: ' \n\t ' }), 'modelo_corpo_vazio'],
  ['corpo longo', comCampos([], 'a'.repeat(20001)), 'modelo_corpo_longo'],
  ['3 testemunhas', com({ testemunhas: 3 }), 'modelo_testemunhas_invalidas'],
  ['assinatura do funcionário em geral', { ...MODELO_COMUNICADO, assinatura_funcionario: true }, 'modelo_assinatura_funcionario_geral'],
  ['campos não é lista', com({ campos: { motivo: 'x' } }), 'campos_formato'],
  ['31 campos', comCampos(Array.from({ length: 31 }, (_, i) => campo({ chave: `c${i}` }))), 'campos_quantidade'],
  ['campo não é objeto', comCampos(['motivo'], 'x'), 'campo_formato'],
  ['propriedade desconhecida', comCampos([campo({ padrao: 'x' })]), 'campo_propriedade_desconhecida'],
  ['chave com maiúscula', comCampos([campo({ chave: 'Motivo' })], 'texto'), 'campo_chave_invalida'],
  ['chave começando com número', comCampos([campo({ chave: '1motivo' })], 'texto'), 'campo_chave_invalida'],
  ['chave com 41 caracteres', comCampos([campo({ chave: `a${'b'.repeat(40)}` })], 'texto'), 'campo_chave_invalida'],
  ['chave com ponto', comCampos([campo({ chave: 'a.b' })], 'texto'), 'campo_chave_invalida'],
  ['chave colide com automática', comCampos([campo({ chave: 'data_emissao' })]), 'campo_chave_reservada'],
  ['chave reservada de grupo', comCampos([campo({ chave: 'funcionario' })]), 'campo_chave_reservada'],
  ['chave duplicada', comCampos([campo(), campo({ rotulo: 'Outro' })], '{{x}}'), 'campo_chave_duplicada'],
  ['rótulo vazio', comCampos([campo({ rotulo: '  ' })]), 'campo_rotulo_invalido'],
  ['rótulo longo', comCampos([campo({ rotulo: 'r'.repeat(81) })]), 'campo_rotulo_invalido'],
  ['tipo inválido', comCampos([campo({ tipo: 'funcionario' })]), 'campo_tipo_invalido'],
  ['obrigatório ausente', comCampos([{ chave: 'x', rotulo: 'X', tipo: 'texto' }]), 'campo_obrigatorio_invalido'],
  ['obrigatório como texto', comCampos([campo({ obrigatorio: 'sim' })]), 'campo_obrigatorio_invalido'],
  ['dica longa', comCampos([campo({ dica: 'd'.repeat(201) })]), 'campo_dica_invalida'],
  ['seleção sem opções', comCampos([campo({ tipo: 'selecao' })]), 'campo_opcoes_invalidas'],
  ['seleção com lista vazia', comCampos([campo({ tipo: 'selecao', opcoes: [] })]), 'campo_opcoes_invalidas'],
  ['seleção com opção vazia', comCampos([campo({ tipo: 'selecao', opcoes: ['A', '  '] })]), 'campo_opcoes_invalidas'],
  ['seleção com opção repetida', comCampos([campo({ tipo: 'selecao', opcoes: ['A', ' A '] })]), 'campo_opcoes_invalidas'],
  ['seleção com opção não-texto', comCampos([campo({ tipo: 'selecao', opcoes: ['A', 2] })]), 'campo_opcoes_invalidas'],
  ['seleção válida', comCampos([campo({ tipo: 'selecao', opcoes: ['Sim', 'Não'] })]), null],
  ['opções em campo de texto', comCampos([campo({ opcoes: ['A'] })]), 'campo_opcoes_indevidas'],
  ['papel inválido', comCampos([campo({ papel: 'titulo' })]), 'campo_papel_invalido'],
  ['assunto em texto longo', comCampos([campo({ tipo: 'texto_longo', papel: 'assunto' })]), 'campo_papel_incompativel'],
  ['data de ocorrência em texto', comCampos([campo({ papel: 'data_ocorrencia' })]), 'campo_papel_incompativel'],
  ['dois assuntos', comCampos([campo({ papel: 'assunto' }), campo({ chave: 'y', papel: 'assunto' })]), 'campo_papel_repetido'],
  ['duas datas de ocorrência', comCampos([campo({ tipo: 'data', papel: 'data_ocorrencia' }), campo({ chave: 'y', tipo: 'data', papel: 'data_ocorrencia' })]), 'campo_papel_repetido'],
  ['variável com espaços', comCampos([campo()], '{{ x }}'), 'placeholder_malformado'],
  ['variável maiúscula', comCampos([campo({ papel: 'assunto' })], '{{X}}'), 'placeholder_malformado'],
  ['chave aberta solta', comCampos([campo()], '{{x}} e {{x'), 'placeholder_malformado'],
  ['chave fechada solta', comCampos([campo()], '{{x}} e x}}'), 'placeholder_malformado'],
  ['variável vazia', comCampos([campo()], '{{x}} {{}}'), 'placeholder_malformado'],
  ['variável com 2 pontos', comCampos([campo()], '{{x}} {{a.b.c}}'), 'placeholder_malformado'],
  ['variável desconhecida', comCampos([campo()], '{{x}} {{numero_pedido}}'), 'placeholder_desconhecido'],
  ['automática inexistente', comCampos([campo()], '{{x}} {{funcionario.salario}}'), 'placeholder_desconhecido'],
  ['funcionário em documento geral', { ...MODELO_COMUNICADO, corpo: `${MODELO_COMUNICADO.corpo} {{funcionario.nome}}` }, 'placeholder_funcionario_em_geral'],
  ['campo sem papel fora do texto', comCampos([campo(), campo({ chave: 'y' })], '{{x}}'), 'campo_nao_utilizado'],
];

// Valores digitados para MODELO_ADVERTENCIA. hoje = data de referência.
// [descrição, valores, esperado: { valores } | código]
export function casosValores(hoje, amanha) {
  const base = { motivo: '  atraso reiterado ', data_ocorrencia: '2026-10-20', descricao: '', gravidade: 'Média', dias: '' };
  const v = (alt) => ({ ...base, ...alt });
  return [
    ['completo e normalizado', v({ descricao: 'Linha 1\r\nLinha 2\r\n\r\n', dias: '007,50' }),
      { motivo: 'atraso reiterado', data_ocorrencia: '2026-10-20', descricao: 'Linha 1\nLinha 2', gravidade: 'Média', dias: '7.50' }],
    ['opcionais ausentes viram vazio', { motivo: 'x', data_ocorrencia: hoje },
      { motivo: 'x', data_ocorrencia: hoje, descricao: '', gravidade: '', dias: '' }],
    ['opcional null vira vazio', v({ gravidade: null }), { ...base, motivo: 'atraso reiterado', gravidade: '' }],
    ['número negativo e inteiro', v({ dias: '-0012' }), { ...base, motivo: 'atraso reiterado', dias: '-12' }],
    ['número zero', v({ dias: '000' }), { ...base, motivo: 'atraso reiterado', dias: '0' }],
    ['seleção com espaços na borda', v({ gravidade: ' Leve ' }), { ...base, motivo: 'atraso reiterado', gravidade: 'Leve' }],
    ['obrigatório ausente', v({ motivo: '   ' }), 'valor_obrigatorio'],
    ['data obrigatória ausente', v({ data_ocorrencia: '' }), 'valor_obrigatorio'],
    ['data inexistente', v({ data_ocorrencia: '2026-02-30' }), 'valor_data_invalida'],
    ['data em formato brasileiro', v({ data_ocorrencia: '20/10/2026' }), 'valor_data_invalida'],
    ['data fora da faixa', v({ data_ocorrencia: '1899-12-31' }), 'valor_data_invalida'],
    ['29 de fevereiro em ano bissexto', v({ data_ocorrencia: '2024-02-29' }), { ...base, motivo: 'atraso reiterado', data_ocorrencia: '2024-02-29' }],
    ['ocorrência futura', v({ data_ocorrencia: amanha }), 'valor_data_futura'],
    ['ocorrência hoje', v({ data_ocorrencia: hoje }), { ...base, motivo: 'atraso reiterado', data_ocorrencia: hoje }],
    ['opção inexistente', v({ gravidade: 'Gravíssima' }), 'valor_opcao_invalida'],
    ['opção com caixa diferente', v({ gravidade: 'média' }), 'valor_opcao_invalida'],
    ['número inválido', v({ dias: '1,2,3' }), 'valor_numero_invalido'],
    ['número com milhar', v({ dias: '1.000,50' }), 'valor_numero_invalido'],
    ['texto curto com quebra', v({ motivo: 'linha 1\nlinha 2' }), 'valor_texto_quebra_linha'],
    ['texto curto longo', v({ motivo: 'm'.repeat(201) }), 'valor_longo'],
    ['texto longo demais', v({ descricao: 'd'.repeat(4001) }), 'valor_longo'],
    ['campo desconhecido', v({ salario: '1000' }), 'valor_campo_desconhecido'],
    ['valor não-texto', v({ dias: 5 }), 'valor_tipo_invalido'],
    ['valores em lista', ['x'], 'valores_formato'],
  ];
}

export const CASOS_FORMATACAO = {
  datas: ['2026-10-01', '2026-10-26', '2024-02-29', '2026-01-09', '2026-12-31', '1999-03-15'],
  cpfs: ['12345678901', '123.456.789-01', '1234567890', 'abc'],
  cnpjs: ['12345678000199', '12.345.678/0001-99', '123'],
  numeros: [[2026, 1], [2026, 42], [2026, 9999], [2026, 10000], [2027, 123456]],
};

export const CASOS_RESOLVER = [
  ['simples', 'Olá {{a}}!', { a: 'Ana' }],
  ['repetida e acentos', '{{a}} — {{a}} çãé', { a: 'Joséé' }],
  ['valor com chaves não é resolvido de novo', '{{a}} {{b}}', { a: '{{b}}', b: 'B' }],
  ['valor vazio', 'x{{a}}y', { a: '' }],
  ['início, fim e quebras', '{{a}}\n\n{{b}}', { a: 'A', b: 'B' }],
  ['chaves simples ficam', '{x} {{a}} }', { a: 'A' }],
];

// Nome do modelo: todos estes são o MESMO nome (índice único).
export const NOMES_EQUIVALENTES = [
  'Advertência', 'advertência', ' ADVERTÊNCIA ', 'Advertencia', 'ADVERTENCIA',
  '\tAdvertência\n', // acento decomposto (NFD) colado de outro programa
];
// ...e estes são todos diferentes entre si (e do grupo acima).
export const NOMES_DISTINTOS = ['Advertências', 'Advertência 2', 'Adv ertência', 'Ação', 'Ação x', 'Ñandu Øre'];

// CNPJ da configuração: [entrada, gravado | null (vazio) | 'invalido'].
export const CASOS_CNPJ = [
  [null, null],
  ['', null],
  ['   ', null],
  ['12345678000195', '12345678000195'],
  ['12.345.678/0001-95', '12345678000195'],
  [' 11 222 333/0001-81 ', '11222333000181'],
  ['12345678000199', 'invalido'], // dígito verificador errado
  ['12.345.678/0001-59', 'invalido'], // verificadores trocados
  ['1234567800019', 'invalido'], // 13 dígitos
  ['123456780001950', 'invalido'], // 15 dígitos
  ['11111111111111', 'invalido'], // repetidos
  ['00000000000000', 'invalido'], // repetidos (passaria no cálculo)
  ['12A45678000195', 'invalido'], // letra
  ['12,345,678/0001-95', 'invalido'], // vírgula não é máscara
];
