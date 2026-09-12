// Fonte ÚNICA de verdade da identidade visual do sistema (Padoca da Mata).
//
// Decisão de negócio (2026-09-12): a aparência deixou de ser personalizável
// por usuário -- não existe mais tela de edição de cores/logo, nem leitura
// de localStorage/Supabase para "aparência". Existe UMA identidade oficial,
// fixa, igual para todo mundo. Nenhum componente/página novo deve declarar
// um hexadecimal de marca solto -- sempre importar TEMA daqui.
//
// A antiga infraestrutura (hooks/hooks_useAparencia.js, pages/admin-aparencia.js,
// pages/api/aparencia.js, localStorage 'aparenciaConfig', CSS vars setadas em
// pages/_app.js) foi removida nesta mesma rodada -- ver relatório da
// migração de branding. Preferências antigas que já existiam no
// localStorage de algum navegador ficam ORFÃS (nunca mais lidas) --
// não há nenhuma limpeza automática, e não precisa haver.
export const TEMA = {
  nomeEmpresa: 'Padoca da Mata',
  cores: {
    primaria: '#0e3d3a',
    secundaria: '#ab5d36',
    sucesso: '#066100',
    erro: '#C62828',
    fundo: '#eaf7e8',
    texto: '#000000',
  },
  logo: {
    // Logo compacto oficial (fundo offwhite), hoje chamado
    // "SECUNDÁRIO_OFFWHITE.png" na origem. Ver relatório da rodada de
    // branding para o caminho definitivo onde o arquivo físico deve ser
    // colocado, caso ainda não exista em public/branding/ no momento
    // desta leitura. Sem placeholder: se o arquivo não existir, o
    // navegador só mostra um ícone de imagem quebrada -- nunca inventamos
    // um logo substituto.
    src: '/branding/logo-padoca-offwhite.png',
    alt: 'Padoca da Mata',
  },
};

// Forma de COMPATIBILIDADE, com o mesmo formato exato do antigo objeto de
// estado "aparencia" que cada página lia de localStorage
// (corPrimaria/corFundo/nomeEmpresa/logoBase64 -- os 4 únicos campos que
// alguma página de fato consumia via `aparencia.X`, confirmado por
// auditoria). Existe só para minimizar o diff nas páginas que já
// desestruturavam esses nomes -- import direto no lugar do antigo
// `useState({...}) + useEffect(leitura de localStorage)`, sem precisar
// tocar no JSX de cada página. Todo código NOVO deve preferir TEMA.cores.*
// diretamente, não este objeto.
export const APARENCIA_FIXA = {
  corPrimaria: TEMA.cores.primaria,
  corSecundaria: TEMA.cores.secundaria,
  corSucesso: TEMA.cores.sucesso,
  corErro: TEMA.cores.erro,
  corFundo: TEMA.cores.fundo,
  corTexto: TEMA.cores.texto,
  nomeEmpresa: TEMA.nomeEmpresa,
  logoBase64: TEMA.logo.src,
};
