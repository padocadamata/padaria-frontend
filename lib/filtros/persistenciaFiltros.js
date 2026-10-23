// Persistência de FILTROS/VISÃO das telas durante UMA sessão de login.
//
// Regra de negócio (frente "Persistência de filtros", etapa 1):
//  - durante a MESMA sessão de login, cada tela reabre com os filtros/visão
//    que o usuário deixou -- navegação, troca de módulo/aba, F5, fechar e
//    reabrir o navegador e renovação automática do token NÃO limpam nada;
//  - só uma NOVA sessão de login (logout + login, sessão expirada que exige
//    autenticar de novo, outro usuário) começa limpa.
//
// "Sessão de login" = claim `session_id` do access token do Supabase Auth
// (id da linha em auth.sessions). Confirmado no código do servidor de Auth:
// o refresh token herda o session_id da sessão (TOKEN_REFRESHED e a
// recuperação automática mantêm o mesmo id) e toda autenticação nova cria
// uma sessão nova (id novo). O token NUNCA é guardado nem logado -- só o id.
//
// Armazenamento: uma chave por TELA, dentro do namespace usuário + sessão:
//   padoca.filtros.v1:{userId}:{sessionId}:{tela}
//   valor = JSON { v: <versão da tela>, valores: { ... } }
// Chave por tela (e não um objeto único com todas) para que duas abas da
// mesma sessão nunca sobrescrevam a tela uma da outra, e para que mudar a
// versão de uma tela invalide só ela.
//
// Este módulo é PURO (sem React): as telas usam os hooks de
// ./useFiltrosPersistidos.js; o AuthProvider (hooks/useAuth.js) informa a
// sessão. Nenhuma página acessa localStorage diretamente.

export const PREFIXO_FILTROS = 'padoca.filtros.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function namespaceFiltros(userId, sessaoId) {
  if (!userId || !sessaoId) return null;
  return `${PREFIXO_FILTROS}:${userId}:${sessaoId}:`;
}

export function chaveTelaFiltros(namespace, tela) {
  return `${namespace}${tela}`;
}

function decodificarBase64Url(trecho) {
  const base64 = trecho.replace(/-/g, '+').replace(/_/g, '/');
  const completo = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binario = atob(completo);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Lê SÓ a claim session_id do payload do access token (sem verificar a
// assinatura: o id serve apenas para separar o armazenamento local, nunca
// para autorizar nada -- quem autoriza é o RLS). Qualquer formato
// inesperado devolve null (= sem persistência), nunca lança.
export function extrairSessaoId(accessToken) {
  if (typeof accessToken !== 'string') return null;
  const partes = accessToken.split('.');
  if (partes.length !== 3 || !partes[1]) return null;
  try {
    const claims = JSON.parse(decodificarBase64Url(partes[1]));
    const id = claims && claims.session_id;
    return typeof id === 'string' && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// --- Validadores reutilizáveis (schema de cada tela) ---------------------

export function umDe(opcoes) {
  return (valor) => opcoes.includes(valor);
}

export function textoQualquer(valor) {
  return typeof valor === 'string';
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// '' (sem data) ou uma data YYYY-MM-DD real.
export function dataIsoOuVazio(valor) {
  if (valor === '') return true;
  return dataIso(valor);
}

export function dataIso(valor) {
  if (typeof valor !== 'string' || !DATA_ISO.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

// Estado de ordenação de lib/ordenacao: null ou { chave, direcao }.
export function ordenacaoValida(valor) {
  if (valor === null) return true;
  return (
    !!valor &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    typeof valor.chave === 'string' &&
    valor.chave !== '' &&
    (valor.direcao === 'asc' || valor.direcao === 'desc')
  );
}

function tipoCompativel(valor, padrao) {
  if (padrao === null || typeof padrao === 'object') return false; // exige validador explícito
  if (typeof valor !== typeof padrao) return false;
  return typeof valor !== 'number' || Number.isFinite(valor);
}

// Mantém SÓ os campos do padrão (campos desconhecidos/de versões antigas
// são descartados); cada valor salvo passa pelo validador do campo (ou, sem
// validador, precisa ter o mesmo tipo do padrão) -- inválido volta ao
// padrão daquele campo, sem afetar os demais.
export function sanearValores(salvos, padrao, validadores = {}) {
  const origem = salvos && typeof salvos === 'object' && !Array.isArray(salvos) ? salvos : {};
  const resultado = {};
  for (const campo of Object.keys(padrao)) {
    if (!Object.prototype.hasOwnProperty.call(origem, campo)) {
      resultado[campo] = padrao[campo];
      continue;
    }
    const valor = origem[campo];
    const validar = validadores[campo];
    const valido = validar ? validar(valor) : tipoCompativel(valor, padrao[campo]);
    resultado[campo] = valido ? valor : padrao[campo];
  }
  return resultado;
}

// Saneamento contra OPÇÕES carregadas (seção que deixou de existir,
// funcionária de outro cargo...). regras = { campo: { pronto, valido } }:
//  - pronto=false (opções ainda carregando ou falharam) -> o campo NUNCA é
//    tocado, o valor salvo espera;
//  - pronto=true e valido(valor, valoresJaSaneados)=false -> só aquele
//    campo volta ao padrão.
// Avaliado na ordem das regras, com os campos anteriores já saneados
// (funcionária é validada contra o cargo final). Devolve o patch, ou null.
export function camposParaSanear(valores, regras, padrao) {
  let patch = null;
  const atual = { ...valores };
  for (const [campo, regra] of Object.entries(regras || {})) {
    if (!regra || !regra.pronto) continue;
    if (!Object.prototype.hasOwnProperty.call(padrao, campo)) continue;
    if (Object.is(atual[campo], padrao[campo])) continue;
    if (regra.valido(atual[campo], atual)) continue;
    atual[campo] = padrao[campo];
    patch = { ...(patch || {}), [campo]: padrao[campo] };
  }
  return patch;
}

// Transição do `definir` dos hooks: definir('campo', valor | fn(anterior))
// ou definir({ parcial }). Campos fora do padrão são ignorados (nunca entram
// no estado nem no storage). Sem mudança real devolve o MESMO objeto.
export function aplicarDefinicao(valores, padrao, campoOuParcial, valor) {
  let parcial;
  if (typeof campoOuParcial === 'string') {
    parcial = { [campoOuParcial]: typeof valor === 'function' ? valor(valores[campoOuParcial]) : valor };
  } else {
    parcial = campoOuParcial || {};
  }
  const efetivo = {};
  for (const campo of Object.keys(parcial)) {
    if (Object.prototype.hasOwnProperty.call(padrao, campo)) efetivo[campo] = parcial[campo];
  }
  const mudou = Object.keys(efetivo).some((campo) => !Object.is(valores[campo], efetivo[campo]));
  return mudou ? { ...valores, ...efetivo } : valores;
}

function mesmoConteudo(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Acesso ao Storage que NUNCA lança: localStorage indisponível (modo
// privado, bloqueado, cota cheia, SSR) cai para memória -- a persistência
// continua valendo na navegação atual, só não sobrevive ao F5.
function criarAcessoStorage(obterStorage) {
  const memoria = new Map();

  function storage() {
    try {
      return obterStorage() || null;
    } catch {
      return null;
    }
  }

  return {
    ler(chave) {
      if (memoria.has(chave)) return memoria.get(chave);
      const s = storage();
      if (!s) return null;
      try {
        return s.getItem(chave);
      } catch {
        return null;
      }
    },
    gravar(chave, texto) {
      const s = storage();
      if (s) {
        try {
          s.setItem(chave, texto);
          memoria.delete(chave);
          return;
        } catch {
          // cai para memória
        }
      }
      memoria.set(chave, texto);
    },
    remover(chave) {
      memoria.delete(chave);
      const s = storage();
      if (!s) return;
      try {
        s.removeItem(chave);
      } catch {
        // nada a fazer
      }
    },
    chaves() {
      const todas = new Set(memoria.keys());
      const s = storage();
      if (s) {
        try {
          for (let i = 0; i < s.length; i++) {
            const chave = s.key(i);
            if (chave != null) todas.add(chave);
          }
        } catch {
          // só as da memória
        }
      }
      return Array.from(todas);
    },
  };
}

export function criarPersistenciaFiltros({ obterStorage }) {
  const acesso = criarAcessoStorage(obterStorage);
  let namespace = null;
  const ouvintes = new Set();

  function notificar() {
    for (const ouvinte of Array.from(ouvintes)) ouvinte();
  }

  // Remove as chaves de filtros que NÃO são do namespace informado (todas,
  // quando null). Só toca o prefixo desta infraestrutura -- Favoritos,
  // Dashboard, sidebar e qualquer outra preferência ficam intactos.
  function removerChaves(manterNamespace) {
    for (const chave of acesso.chaves()) {
      if (!chave.startsWith(`${PREFIXO_FILTROS}:`)) continue;
      if (manterNamespace && chave.startsWith(manterNamespace)) continue;
      acesso.remover(chave);
    }
  }

  return {
    obterNamespace() {
      return namespace;
    },

    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },

    // Chamado pelo AuthProvider na carga inicial e a cada evento de auth.
    // Mesma sessão (refresh, TOKEN_REFRESHED, SIGNED_IN repetido ao voltar
    // à aba) -> nada muda. Sessão nova -> namespace novo e os resíduos de
    // sessões/usuários anteriores são apagados. Sem usuário ou sem
    // session_id -> sem persistência e nada antigo fica para trás.
    definirSessao(userId, sessaoId) {
      const novo = namespaceFiltros(userId, sessaoId);
      if (novo === namespace) return;
      namespace = novo;
      removerChaves(novo);
      notificar();
    },

    // Logout / SIGNED_OUT: apaga TODOS os filtros persistidos.
    encerrarSessao() {
      namespace = null;
      removerChaves(null);
      notificar();
    },

    // Estado de uma tela no namespace informado. Sem namespace, registro
    // ausente/corrompido ou de outra versão -> padrão. `precisaGravar` diz
    // se o que está no storage difere do resultado (primeira visita,
    // versão nova, campos saneados) -- o hook regrava.
    lerTela(ns, tela, { versao, padrao, validadores, normalizar }) {
      const padraoCopia = { ...padrao };
      if (!ns || !tela) return { valores: padraoCopia, precisaGravar: false };

      let registro = null;
      const texto = acesso.ler(chaveTelaFiltros(ns, tela));
      if (texto) {
        try {
          registro = JSON.parse(texto);
        } catch {
          registro = null;
        }
      }
      const valido =
        registro &&
        typeof registro === 'object' &&
        registro.v === versao &&
        registro.valores &&
        typeof registro.valores === 'object' &&
        !Array.isArray(registro.valores);
      if (!valido) {
        const valores = normalizar ? normalizar(padraoCopia, padrao) : padraoCopia;
        return { valores, precisaGravar: true };
      }

      let valores = sanearValores(registro.valores, padrao, validadores);
      if (normalizar) valores = normalizar(valores, padrao);
      return { valores, precisaGravar: !mesmoConteudo(valores, registro.valores) };
    },

    // Só grava se `ns` ainda é o namespace ATUAL: uma tela montada antes de
    // um logout/troca de usuário nunca escreve o estado antigo na sessão
    // nova. Devolve se gravou.
    gravarTela(ns, tela, versao, valores) {
      if (!ns || !tela || ns !== namespace) return false;
      try {
        acesso.gravar(chaveTelaFiltros(ns, tela), JSON.stringify({ v: versao, valores }));
        return true;
      } catch {
        return false;
      }
    },

    removerTela(ns, tela) {
      if (!ns || !tela) return;
      acesso.remover(chaveTelaFiltros(ns, tela));
    },
  };
}

function obterLocalStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

// Instância única do app (navegador). No servidor, sem storage e sem
// namespace: tudo cai no padrão.
export const persistenciaFiltros = criarPersistenciaFiltros({ obterStorage: obterLocalStorage });
