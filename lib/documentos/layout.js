// Layout do documento IMPRESSO (A4 retrato) -- os mesmos blocos de texto
// para a prévia/visualização em HTML, a impressão, o PDF e o Word. Recebe
// a representação intermediária de montarDocumento (documento.js) -- nunca
// o modelo atual -- e decide só COMO os textos aparecem. Função PURA.
//
// Blocos, de cima para baixo:
//   cabeçalho da empresa | identificação (nº e data) | [aviso de
//   cancelamento] | título | parágrafos | fechamento: local e data +
//   assinaturas (2 por linha).

import { formatarMomento } from './apresentacao.js';

// Medidas comuns (mm) -- a folha HTML, o PDF e o Word usam as mesmas.
export const PAGINA_A4 = { largura: 210, altura: 297, margem: 20 };

// Tipografia (pt) e entrelinhas (múltiplo do tamanho da fonte) -- UMA
// fonte de verdade para a folha HTML (via variaveisCssA4), o PDF e o Word.
// Corpo em 12 pt com entrelinha confortável; título com hierarquia clara.
export const TIPOGRAFIA = {
  empresa: 15,
  empresaLinha: 9.5,
  identificacao: 9.5,
  cancelado: 10.5,
  titulo: 16,
  corpo: 12,
  assinatura: 10.5,
  rodape: 8,
  entrelinhaCorpo: 1.55,
  entrelinhaTitulo: 1.3,
  entrelinhaEmpresa: 1.35,
  entrelinhaAssinatura: 1.35,
};

// Espaços verticais (mm) entre os blocos. `assinatura` é o espaço LIVRE
// acima de cada linha de assinatura (lugar de assinar à mão); o fechamento
// (local/data + assinaturas) fica junto na mesma página sempre que cabe.
export const ESPACOS = {
  cabecalhoLinha: 3, // texto da empresa -> linha divisória
  identificacao: 3, // linha divisória -> "Documento nº ..."
  tituloAntes: 14,
  tituloDepois: 10,
  paragrafo: 4.5, // depois de cada parágrafo do corpo
  localDataAntes: 10,
  assinatura: 24,
  assinaturaDepois: 4,
  colunasAssinatura: 12, // distância entre as 2 assinaturas de um par
  recuoAssinatura: 4, // linha recuada das bordas da coluna
};

// Variáveis CSS da folha HTML (DocumentoA4) com os mesmos números.
export function variaveisCssA4() {
  const T = TIPOGRAFIA;
  const E = ESPACOS;
  return {
    '--a4-margem': `${PAGINA_A4.margem}mm`,
    '--a4-empresa': `${T.empresa}pt`,
    '--a4-empresa-linha': `${T.empresaLinha}pt`,
    '--a4-identificacao': `${T.identificacao}pt`,
    '--a4-cancelado': `${T.cancelado}pt`,
    '--a4-titulo': `${T.titulo}pt`,
    '--a4-corpo': `${T.corpo}pt`,
    '--a4-assinatura-fonte': `${T.assinatura}pt`,
    '--a4-lh-corpo': String(T.entrelinhaCorpo),
    '--a4-lh-titulo': String(T.entrelinhaTitulo),
    '--a4-lh-empresa': String(T.entrelinhaEmpresa),
    '--a4-lh-assinatura': String(T.entrelinhaAssinatura),
    '--a4-cabecalho-linha': `${E.cabecalhoLinha}mm`,
    '--a4-identificacao-antes': `${E.identificacao}mm`,
    '--a4-titulo-antes': `${E.tituloAntes}mm`,
    '--a4-titulo-depois': `${E.tituloDepois}mm`,
    '--a4-paragrafo': `${E.paragrafo}mm`,
    '--a4-local-data-antes': `${E.localDataAntes}mm`,
    '--a4-assinatura': `${E.assinatura}mm`,
    '--a4-assinatura-depois': `${E.assinaturaDepois}mm`,
    '--a4-colunas-assinatura': `${E.colunasAssinatura}mm`,
    '--a4-recuo-assinatura': `${E.recuoAssinatura}mm`,
  };
}

export function cabecalhoEmpresa(empresa) {
  const principal = empresa.nome || empresa.razaoSocial || '';
  const linha1 = [empresa.nome ? empresa.razaoSocial : null, empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null].filter(Boolean).join(' · ');
  const linha2 = [empresa.endereco, empresa.cidadeUf].filter(Boolean).join(' · ');
  return { principal, linhas: [linha1, linha2].filter((l) => l !== '') };
}

export function linhaIdentificacao(doc) {
  return `Documento nº ${doc.numero} · Emitido em ${doc.dataEmissao}`;
}

export function textoCancelamento(cancelamento) {
  if (!cancelamento) return null;
  const por = cancelamento.por ? ` por ${cancelamento.por}` : '';
  return `DOCUMENTO CANCELADO em ${formatarMomento(cancelamento.em)}${por}. Motivo: ${cancelamento.motivo}`;
}

// Linhas abaixo da linha de assinatura: a 1ª (nome) em negrito.
//   empresa     -> razão social, responsável, cargo
//   funcionário -> nome (sem CPF)
//   testemunha  -> "Testemunha n", "Nome:", "CPF:" (preenchidos à mão)
export function linhasAssinatura(assinatura) {
  return [{ texto: assinatura.nome || '', negrito: true }, ...assinatura.linhas.map((texto) => ({ texto, negrito: false }))];
}

export function assinaturasEmPares(assinaturas) {
  const pares = [];
  for (let i = 0; i < assinaturas.length; i += 2) pares.push(assinaturas.slice(i, i + 2));
  return pares;
}
