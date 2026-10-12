// Regras puras da criação de usuários pela tela Admin > Usuários (sem
// Supabase, sem React) -- usadas pela rota server-side
// pages/api/admin/usuarios/criar.js e pelo formulário NovoUsuarioModal.
//
// Fluxo completo (migration 0072):
//   1. criar o login no Authentication (Auth Admin API, server-side);
//   2. vincular em public.usuarios via RPC admin_vincular_usuario_auth,
//      com a sessão do próprio administrador;
//   3. se o passo 2 falhar, desfazer o passo 1 (excluir o login recém-
//      criado). Se até a compensação falhar, o login fica listado em
//      "Logins sem vínculo" na tela e pode ser vinculado depois.
//
// A senha nunca entra em nenhum retorno/mensagem daqui.

export const LIMITES = { nomeMax: 120, emailMax: 254, senhaMin: 8, senhaMax: 72 };

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_PERFIL = /^[a-z][a-z0-9_]*$/;

export function normalizarEmail(valor) {
  return String(valor ?? '').trim().toLowerCase();
}

function validarNomePerfil({ nome, perfil }, erros) {
  const nomeLimpo = String(nome ?? '').trim();
  if (!nomeLimpo) {
    erros.nome = 'Informe o nome.';
  } else if (nomeLimpo.length > LIMITES.nomeMax) {
    erros.nome = `Nome com no máximo ${LIMITES.nomeMax} caracteres.`;
  }

  const perfilLimpo = String(perfil ?? '').trim();
  if (!perfilLimpo || !REGEX_PERFIL.test(perfilLimpo)) {
    erros.perfil = 'Selecione um perfil.';
  }

  return { nome: nomeLimpo, perfil: perfilLimpo };
}

// Criação completa (login novo + vínculo).
export function validarNovoUsuario({ nome, email, perfil, senha } = {}) {
  const erros = {};
  const base = validarNomePerfil({ nome, perfil }, erros);

  const emailLimpo = normalizarEmail(email);
  if (!emailLimpo) {
    erros.email = 'Informe o e-mail.';
  } else if (emailLimpo.length > LIMITES.emailMax || !REGEX_EMAIL.test(emailLimpo)) {
    erros.email = 'E-mail inválido.';
  }

  // Senha não é aparada: espaços fazem parte do que a pessoa digitou.
  const senhaTexto = typeof senha === 'string' ? senha : '';
  if (senhaTexto.length < LIMITES.senhaMin) {
    erros.senha = `A senha inicial precisa ter pelo menos ${LIMITES.senhaMin} caracteres.`;
  } else if (senhaTexto.length > LIMITES.senhaMax) {
    erros.senha = `A senha inicial pode ter no máximo ${LIMITES.senhaMax} caracteres.`;
  } else if (!senhaTexto.trim()) {
    erros.senha = 'A senha inicial não pode ser só espaços.';
  }

  const ok = Object.keys(erros).length === 0;
  return { ok, erros, dados: ok ? { ...base, email: emailLimpo, senha: senhaTexto } : null };
}

// Vínculo de um login que já existe no Authentication (e-mail vem do Auth).
export function validarVinculo({ nome, perfil } = {}) {
  const erros = {};
  const base = validarNomePerfil({ nome, perfil }, erros);
  const ok = Object.keys(erros).length === 0;
  return { ok, erros, dados: ok ? base : null };
}

// Erros conhecidos de admin_vincular_usuario_auth (0072) -> texto amigável.
export function mensagemErroVinculo(error) {
  const msg = error?.message || '';
  const codigo = error?.code || '';

  if (codigo === 'PGRST202' || msg.includes('Could not find the function') || msg.includes('does not exist')) {
    return 'A função de vínculo ainda não existe no banco (migration 0072 pendente).';
  }
  if (codigo === '42501' || msg.includes('requer administrador')) {
    return 'Você não tem permissão de administrador para esta ação.';
  }
  if (msg.includes('ja usado por outro usuario')) {
    return 'Este e-mail já pertence a outro usuário do sistema.';
  }
  if (msg.includes('ja esta vinculado')) {
    return 'Este login já está vinculado a um usuário do sistema.';
  }
  if (msg.includes('nao existe ou nao esta ativo')) {
    return 'Perfil inválido ou inativo.';
  }
  if (msg.includes('nao encontrado no Authentication')) {
    return 'Login não encontrado no Authentication — recarregue a página.';
  }
  if (msg.includes('nome obrigatorio') || msg.includes('120 caracteres')) {
    return 'Nome inválido.';
  }
  return 'Não foi possível vincular o usuário.';
}

function emailJaExiste(error) {
  const msg = (error?.message || '').toLowerCase();
  return error?.code === 'email_exists'
    || error?.code === 'user_already_exists'
    || msg.includes('already been registered')
    || msg.includes('already registered')
    || msg.includes('already exists');
}

function senhaRecusada(error) {
  const msg = (error?.message || '').toLowerCase();
  return error?.code === 'weak_password' || msg.includes('password');
}

// Orquestra o fluxo com dependências injetadas (testável sem rede):
//   criarLoginAuth({ email, senha, nome }) -> { id } | lança/retorna { error }
//   vincular({ usuarioId, nome, perfil })  -> { data, error }
//   excluirLoginAuth(usuarioId)            -> { error }
// Retorna { status, corpo } pronto para a resposta HTTP.
export async function criarUsuarioCompleto({ dados, criarLoginAuth, vincular, excluirLoginAuth }) {
  let usuarioId;

  try {
    const resultado = await criarLoginAuth({ email: dados.email, senha: dados.senha, nome: dados.nome });
    if (resultado?.error) throw resultado.error;
    usuarioId = resultado?.id;
  } catch (erro) {
    if (emailJaExiste(erro)) {
      return {
        status: 409,
        corpo: {
          codigo: 'email_ja_existe',
          mensagem: 'Já existe um login com este e-mail. Se ele aparece em "Logins sem vínculo", use Vincular.',
        },
      };
    }
    if (senhaRecusada(erro)) {
      return {
        status: 400,
        corpo: { codigo: 'senha_recusada', mensagem: 'O Authentication recusou a senha inicial. Use uma senha mais forte.' },
      };
    }
    return {
      status: 502,
      corpo: { codigo: 'falha_auth', mensagem: 'Não foi possível criar o login no Authentication. Nada foi criado.' },
    };
  }

  if (!usuarioId) {
    return {
      status: 502,
      corpo: { codigo: 'falha_auth', mensagem: 'O Authentication não devolveu o identificador do login.' },
    };
  }

  let erroVinculo = null;
  let usuario = null;
  try {
    const { data, error } = await vincular({ usuarioId, nome: dados.nome, perfil: dados.perfil });
    erroVinculo = error || null;
    usuario = data || null;
  } catch (erro) {
    erroVinculo = erro;
  }

  if (!erroVinculo) {
    return { status: 201, corpo: { codigo: 'criado', usuario } };
  }

  // Compensação: o login foi criado mas o vínculo falhou -- desfaz o login
  // para não deixar um "usuário fantasma" sem acesso.
  let compensou = false;
  try {
    const { error } = (await excluirLoginAuth(usuarioId)) || {};
    compensou = !error;
  } catch {
    compensou = false;
  }

  const motivo = mensagemErroVinculo(erroVinculo);

  if (compensou) {
    return {
      status: 400,
      corpo: { codigo: 'vinculo_falhou_revertido', mensagem: `${motivo} O login foi desfeito; nada foi criado.` },
    };
  }

  return {
    status: 500,
    corpo: {
      codigo: 'vinculo_pendente',
      mensagem: `${motivo} O login foi criado mas não pôde ser desfeito: ele aparece em "Logins sem vínculo" para ser vinculado ou removido.`,
      usuario_id: usuarioId,
      email: dados.email,
    },
  };
}
