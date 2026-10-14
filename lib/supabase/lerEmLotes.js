// Leitura COMPLETA de uma consulta em lotes. O PostgREST corta cada
// resposta em 1000 linhas (max_rows do Supabase) sem erro nenhum -- uma
// tela que lê "tudo" com um único select passaria a ver só parte dos dados
// assim que a tabela crescer, e qualquer ordenação/filtro/total no cliente
// ficaria silenciosamente errado. Mesmo conceito já usado em
// pages/catalogo.js e pages/producao/historico.js, centralizado aqui.
//
// `montarConsulta()` devolve uma consulta NOVA a cada chamada (com select,
// filtros e uma ordem DETERMINÍSTICA, terminando em uma coluna única como
// id -- sem isso, linhas podem ser puladas ou repetidas entre lotes). Este
// helper só acrescenta .range(). Para quando um lote vem com menos linhas
// que o tamanho pedido; `maxLotes` é a rede de segurança contra loop
// infinito (nunca deveria ser atingida: ao bater, devolve erro em vez de
// dados possivelmente incompletos).
//
// Devolve { data, error } -- mesmo formato do supabase-js, para que as
// telas troquem a chamada sem mudar o tratamento de erro.
export const TAMANHO_LOTE_PADRAO = 1000;
export const MAX_LOTES_PADRAO = 200;

export async function lerEmLotes(montarConsulta, { tamanho = TAMANHO_LOTE_PADRAO, maxLotes = MAX_LOTES_PADRAO } = {}) {
  const linhas = [];
  for (let lote = 0; lote < maxLotes; lote += 1) {
    const inicio = lote * tamanho;
    const { data, error } = await montarConsulta().range(inicio, inicio + tamanho - 1);
    if (error) return { data: null, error };
    const recebidas = data || [];
    linhas.push(...recebidas);
    if (recebidas.length < tamanho) return { data: linhas, error: null };
  }
  return {
    data: null,
    error: { message: `lerEmLotes: limite de ${maxLotes} lotes atingido (${maxLotes * tamanho} linhas) -- leitura interrompida.` },
  };
}
