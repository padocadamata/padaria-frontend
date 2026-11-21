// Envio de um relatório já lido e mascarado para o banco (migration 0081):
// iniciar o lote -> blocos de linhas (direto ao Supabase, sem passar pela
// Vercel) -> prévia. Cada bloco é idempotente no servidor, então uma falha
// de rede é repetida com segurança.

export const TAMANHO_BLOCO = 2000;
const TENTATIVAS = 3;

export async function calcularSha256(bytes) {
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resumo = await globalThis.crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function dividirEmBlocos(linhas, tamanho = TAMANHO_BLOCO) {
  const blocos = [];
  for (let i = 0; i < linhas.length; i += tamanho) {
    blocos.push({ inicio: i + 1, linhas: linhas.slice(i, i + tamanho) });
  }
  return blocos;
}

// Privacidade: o nome original do arquivo NUNCA sai do navegador (alguém pode
// tê-lo renomeado com nome/CPF de cliente). Vai só a extensão, que o servidor
// confere; o banco grava um nome padrão pelo layout.
export function nomeParaEnvio(nomeOriginal) {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(String(nomeOriginal || ''));
  return ext ? `relatorio.${ext[1].toLowerCase()}` : 'relatorio';
}

// Produtor (propriedade "Application" do .xlsx, editável): só um rótulo de
// lista fechada; o servidor aplica a mesma lista.
export function produtorParaEnvio(produtor) {
  if (!produtor) return null;
  const p = String(produtor);
  if (p === 'SheetJS') return 'SheetJS';
  if (/^microsoft( macintosh)? excel/i.test(p)) return 'Microsoft Excel';
  if (/^libreoffice/i.test(p)) return 'LibreOffice';
  if (/^openpyxl/i.test(p)) return 'openpyxl';
  return 'outro';
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Erros que não adianta repetir (regra de negócio/permissão), x falha de rede.
function repetivel(error) {
  if (!error) return false;
  const codigo = String(error.code || '');
  if (['42501', '22023', '23505', 'P0002', 'P0001', '40001', 'PGRST202', '42883'].includes(codigo)) return false;
  return true;
}

export class ErroEnvio extends Error {
  constructor(mensagem, causa) {
    super(mensagem);
    this.name = 'ErroEnvio';
    this.causa = causa;
  }
}

async function rpc(supabase, nome, args, { tentativas = 1, espera = 800 } = {}) {
  let ultimo;
  for (let t = 1; t <= tentativas; t += 1) {
    const { data, error } = await supabase.rpc(nome, args);
    if (!error) return data;
    ultimo = error;
    if (!repetivel(error) || t === tentativas) break;
    await esperar(espera * t);
  }
  throw new ErroEnvio(ultimo?.message || 'erro desconhecido', ultimo);
}

// aoProgredir({ etapa: 'iniciando'|'enviando'|'previa', enviadas, total })
export async function enviarImportacao(supabase, { layout, arquivo, metadados, linhas, mascarados = 0, aoProgredir = () => {} }) {
  const total = linhas.length;
  aoProgredir({ etapa: 'iniciando', enviadas: 0, total });
  const id = await rpc(supabase, 'g3_iniciar_importacao', {
    p_layout: layout,
    p_arquivo_nome: nomeParaEnvio(arquivo.nome),
    p_arquivo_tamanho: arquivo.tamanho,
    p_arquivo_sha256: arquivo.sha256,
    p_metadados: {
      abas: metadados.abas,
      formulas: metadados.formulas,
      macros: metadados.macros,
      original: metadados.original,
      produtor: produtorParaEnvio(metadados.produtor),
      textos_compartilhados: metadados.textosCompartilhados,
      clientes_mascarados: mascarados,
    },
    p_linhas_total: total,
  });

  let enviadas = 0;
  for (const bloco of dividirEmBlocos(linhas)) {
    await rpc(supabase, 'g3_enviar_linhas', { p_lote: id, p_inicio: bloco.inicio, p_linhas: bloco.linhas }, { tentativas: TENTATIVAS });
    enviadas += bloco.linhas.length;
    aoProgredir({ etapa: 'enviando', enviadas, total });
  }

  aoProgredir({ etapa: 'previa', enviadas, total });
  const previa = await rpc(supabase, 'g3_gerar_previa', { p_lote: id }, { tentativas: 2, espera: 1500 });
  return { id, previa };
}
