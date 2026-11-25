// BI Gerencial -- acesso às RPCs (0083 + 0084).
//
// Tudo é SOMENTE LEITURA e passa por RPCs SECURITY DEFINER que exigem
// proprietario_admin ativo (erro 42501 para qualquer outro). Nenhum dado é
// inventado aqui: sem resposta válida, o bloco mostra erro/"sem dados" --
// nunca valores de exemplo.
//
// criarClienteBi(supabase) devolve um cliente com:
//  - cache por chave (RPC + parâmetros) durante a sessão da página;
//  - reaproveitamento da MESMA promessa para chamadas iguais em andamento
//    (dois blocos com os mesmos filtros = uma única chamada);
//  - fila com no máximo 3 chamadas simultâneas (MAX_SIMULTANEAS);
//  - invalidar(): descarta o cache e muda a "geração" das chaves (botão
//    "Atualizar dados"): todo bloco passa a ter chave nova e consulta de
//    novo; respostas de chamadas antigas ainda em andamento são ignoradas
//    pelos blocos. Não inicia importação do G3: só relê o que já existe;
//  - ocupado()/assinar(): se há chamadas ativas ou na fila (indicação de
//    carregamento da atualização).

export const MAX_SIMULTANEAS = 3;
export const TAMANHO_CACHE = 200;

const lista = (v) => (Array.isArray(v) && v.length ? v : null);
// Filtro de dias: todos os 7 marcados = null (mesma resposta, cache comum).
const diasParam = (dias) => (Array.isArray(dias) && dias.length && dias.length < 7 ? [...new Set(dias)].sort((a, b) => a - b) : null);

// Definição de cada RPC: nome no banco + montagem dos parâmetros nomeados.
export const RPCS = {
  status: { nome: 'bi_status', params: () => ({}) },
  calendario: { nome: 'bi_calendario', params: ({ de, ate }) => ({ p_de: de, p_ate: ate }) },
  resumo: { nome: 'bi_resumo_v2', params: ({ de, ate, dias }) => ({ p_de: de, p_ate: ate, p_dias_semana: diasParam(dias) }) },
  serie: {
    nome: 'bi_serie_v2',
    params: ({ de, ate, agrupamento, dias }) => ({ p_de: de, p_ate: ate, p_agrupamento: agrupamento, p_dias_semana: diasParam(dias) }),
  },
  produtos: {
    nome: 'bi_produtos_v2',
    params: ({ de, ate, codigos = null, busca = null, ordem = 'bruto', direcao = 'desc', limite = 50, deslocamento = 0, dias }) => ({
      p_de: de,
      p_ate: ate,
      p_codigos: lista(codigos),
      p_busca: busca && String(busca).trim().length >= 2 ? String(busca).trim() : null,
      p_ordem: ordem,
      p_direcao: direcao,
      p_limite: limite,
      p_deslocamento: deslocamento,
      p_dias_semana: diasParam(dias),
    }),
  },
  produtoSerie: {
    nome: 'bi_produto_serie_v2',
    params: ({ codigos, de, ate, agrupamento, dias }) => ({ p_codigos: codigos, p_de: de, p_ate: ate, p_agrupamento: agrupamento, p_dias_semana: diasParam(dias) }),
  },
  horarios: { nome: 'bi_horarios', params: ({ de, ate, dias }) => ({ p_de: de, p_ate: ate, p_dias_semana: diasParam(dias) }) },
  produtosHorario: {
    nome: 'bi_produtos_horario_v2',
    params: ({ de, ate, horaInicio = 0, horaFim = 23, ordem = 'bruto', limite = 3, dias }) => ({
      p_de: de,
      p_ate: ate,
      p_hora_inicio: horaInicio,
      p_hora_fim: horaFim,
      p_ordem: ordem,
      p_limite: limite,
      p_dias_semana: diasParam(dias),
    }),
  },
  produtoHorarios: {
    nome: 'bi_produto_horarios',
    params: ({ codigos, de, ate, dias }) => ({ p_codigos: codigos, p_de: de, p_ate: ate, p_dias_semana: diasParam(dias) }),
  },
  comparar: {
    nome: 'bi_comparar_periodos',
    params: ({ a, b, dias, codigos = null, criterio = 'auto' }) => ({
      p_a_de: a.de,
      p_a_ate: a.ate,
      p_b_de: b.de,
      p_b_ate: b.ate,
      p_dias_semana: diasParam(dias),
      p_codigos: lista(codigos),
      p_criterio: criterio,
    }),
  },
};

export function chaveConsulta(tipo, args) {
  const def = RPCS[tipo];
  if (!def) throw new Error(`Consulta desconhecida: ${tipo}`);
  return `${def.nome}:${JSON.stringify(def.params(args || {}))}`;
}

export class ErroBi extends Error {
  constructor(mensagem, { codigo = null, tipo = 'erro' } = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.tipo = tipo;
  }
}

// Erro do PostgREST/Postgres -> mensagem em linguagem simples.
export function mensagemDeErro(erro) {
  if (!erro) return 'Erro desconhecido.';
  const codigo = erro.code || erro.codigo || '';
  const texto = String(erro.message || erro.mensagem || '');
  if (codigo === '42501') return 'Acesso restrito ao perfil proprietário/administrador.';
  if (codigo === 'PGRST202' || codigo === '42883') {
    return 'Esta análise depende de uma atualização do banco de dados (migration 0084) que ainda não foi aplicada.';
  }
  if (codigo === '57014') return 'A consulta demorou demais. Tente um período menor.';
  if (codigo === '22023' && texto) return `Filtro inválido: ${texto}`;
  if (/fetch|network|Failed to fetch|NetworkError/i.test(texto)) return 'Não foi possível conectar ao servidor. Verifique a conexão e tente de novo.';
  return texto ? `Não foi possível carregar: ${texto}` : 'Não foi possível carregar os dados.';
}

export function criarClienteBi(supabase, { maxSimultaneas = MAX_SIMULTANEAS, tamanhoCache = TAMANHO_CACHE } = {}) {
  const cache = new Map(); // chave -> { promessa, valor?, ok? }
  const fila = [];
  let ativas = 0;
  let chamadasReais = 0;
  let geracao = 0;
  const ouvintes = new Set();
  const avisar = () => {
    for (const fn of ouvintes) fn();
  };

  const proximo = () => {
    while (ativas < maxSimultaneas && fila.length) {
      const tarefa = fila.shift();
      ativas += 1;
      tarefa().finally(() => {
        ativas -= 1;
        proximo();
        avisar();
      });
    }
  };

  const enfileirar = (executar) =>
    new Promise((resolve, reject) => {
      fila.push(() => executar().then(resolve, reject));
      proximo();
      avisar();
    });

  const lembrar = (chave, entrada) => {
    cache.delete(chave);
    cache.set(chave, entrada);
    while (cache.size > tamanhoCache) cache.delete(cache.keys().next().value);
  };

  // opcoes.ignorarCache: força nova chamada (o resultado substitui o cache).
  function consultar(tipo, args, opcoes = {}) {
    const def = RPCS[tipo];
    const params = def.params(args || {});
    const chave = `${geracao}|${def.nome}:${JSON.stringify(params)}`;
    const existente = cache.get(chave);
    if (existente && !opcoes.ignorarCache) return existente.promessa;
    const promessa = enfileirar(async () => {
      chamadasReais += 1;
      const { data, error } = await supabase.rpc(def.nome, params);
      if (error) throw new ErroBi(mensagemDeErro(error), { codigo: error.code || null });
      return data;
    });
    const entrada = { promessa };
    lembrar(chave, entrada);
    // Falha não fica em cache: "tentar de novo" refaz a chamada.
    promessa.catch(() => {
      if (cache.get(chave) === entrada) cache.delete(chave);
    });
    return promessa;
  }

  return {
    consultar,
    // Chave do bloco (useConsulta): inclui a geração, então invalidar() faz
    // cada bloco montado consultar de novo no próximo render.
    chave: (tipo, args) => `${geracao}|${chaveConsulta(tipo, args)}`,
    limpar: () => cache.clear(),
    invalidar: () => {
      geracao += 1;
      cache.clear();
      avisar();
    },
    geracao: () => geracao,
    ocupado: () => ativas > 0 || fila.length > 0,
    assinar: (fn) => {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
    estatisticas: () => ({ chamadasReais, emCache: cache.size, ativas, naFila: fila.length, geracao }),
  };
}
