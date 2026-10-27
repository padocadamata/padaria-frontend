// Representação INTERMEDIÁRIA de um documento (migration 0077): a mesma
// estrutura alimenta a prévia HTML, a impressão, o PDF e o Word -- nenhum
// deles relê o modelo atual nem o cadastro, só o snapshot gravado na
// emissão. Função PURA, sem React e sem biblioteca de PDF/DOCX.
//
// Cada layout_versao tem o seu montador: documento antigo continua saindo
// como foi emitido mesmo depois que o layout evoluir.

import { formatarCnpj, formatarData, formatarDataExtenso } from './formatacao.js';
import { NUMERO_PREVIA } from './emissao.js';

// Parágrafos: linhas em branco separam parágrafos; quebra simples continua
// dentro do mesmo parágrafo (cada linha é uma linha do papel).
export function dividirParagrafos(conteudo) {
  const paragrafos = [];
  let atual = [];
  for (const linha of String(conteudo).split('\n')) {
    if (linha.trim() === '') {
      if (atual.length > 0) paragrafos.push(atual);
      atual = [];
    } else {
      atual.push(linha.replace(/[ \t]+$/, ''));
    }
  }
  if (atual.length > 0) paragrafos.push(atual);
  return paragrafos;
}

function assinaturasV1(snapshot) {
  const { assinaturas } = snapshot.modelo;
  const lista = [];
  if (assinaturas.empresa) {
    const e = snapshot.empresa;
    lista.push({
      papel: 'empresa',
      nome: e.razao_social,
      linhas: [e.responsavel, e.responsavel_cargo].filter(Boolean),
    });
  }
  if (assinaturas.funcionario && snapshot.funcionario) {
    // Linha + nome. Sem CPF automático: o snapshot não guarda CPF de quem
    // assina (só o que o corpo usou).
    lista.push({ papel: 'funcionario', nome: snapshot.funcionario.nome, linhas: [] });
  }
  for (let i = 1; i <= assinaturas.testemunhas; i++) {
    // Testemunha é preenchida à mão no papel.
    lista.push({ papel: 'testemunha', nome: `Testemunha ${i}`, linhas: ['Nome:', 'CPF:'] });
  }
  return lista;
}

function montarV1(snapshot, conteudo, cancelamento) {
  const { documento, empresa } = snapshot;
  return {
    layoutVersao: 1,
    empresa: {
      nome: empresa.nome,
      razaoSocial: empresa.razao_social,
      cnpj: empresa.cnpj ? formatarCnpj(empresa.cnpj) : null,
      endereco: empresa.endereco,
      cidadeUf: empresa.cidade_uf,
    },
    numero: documento.numero_formatado ?? NUMERO_PREVIA,
    dataEmissao: formatarData(documento.data_emissao),
    titulo: snapshot.modelo.titulo,
    paragrafos: dividirParagrafos(conteudo),
    localData: snapshot.modelo.assinaturas.local_data
      ? `${empresa.cidade_uf ?? '[empresa.cidade_uf]'}, ${formatarDataExtenso(documento.data_emissao)}.`
      : null,
    assinaturas: assinaturasV1(snapshot),
    cancelamento: cancelamento
      ? { em: cancelamento.em, por: cancelamento.por ?? null, motivo: cancelamento.motivo }
      : null,
  };
}

const MONTADORES = { 1: montarV1 };

// documento: linha de folha_documentos ({ conteudo, snapshot, status,
// cancelado_em, cancelado_por_nome, motivo_cancelamento }) ou o resultado
// de montarEmissao (prévia, sem status).
export function montarDocumento(documento) {
  const montador = MONTADORES[documento.snapshot?.layout_versao];
  if (!montador) throw new Error(`Layout de documento desconhecido: ${documento.snapshot?.layout_versao}`);
  const cancelamento = documento.status === 'cancelado'
    ? { em: documento.cancelado_em, por: documento.cancelado_por_nome, motivo: documento.motivo_cancelamento }
    : null;
  return montador(documento.snapshot, documento.conteudo, cancelamento);
}
