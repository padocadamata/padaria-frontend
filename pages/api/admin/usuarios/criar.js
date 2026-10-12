import { createServerPropsClient } from '../../../../lib/supabase/serverProps';
import { createAdminClient, servidorAdminConfigurado } from '../../../../lib/supabase/admin';
import { criarUsuarioCompleto, validarNovoUsuario } from '../../../../lib/admin/criarUsuario';

// POST /api/admin/usuarios/criar -- cria um usuário completo (login no
// Authentication + linha em public.usuarios) a partir da tela Admin >
// Usuários. Ver lib/admin/criarUsuario.js (fluxo e compensação) e a
// migration 0072 (vínculo).
//
// Camadas de proteção, nesta ordem, ANTES de qualquer escrita:
//   1. só POST com JSON vindo da própria origem (barra CSRF por formulário);
//   2. sessão válida (getUser revalida o JWT no Supabase);
//   3. is_admin() verdadeiro no BANCO, com a sessão de quem chama;
//   4. dados válidos e perfil existente/ativo.
// A service_role só é usada para a Auth Admin API; o vínculo é feito com a
// sessão do administrador (o banco checa is_admin() de novo e audita).

function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true; // navegadores sempre mandam Origin em POST cross-site
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}

function responder(res, status, corpo) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(corpo);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return responder(res, 405, { codigo: 'metodo', mensagem: 'Use POST.' });
  }

  if (!String(req.headers['content-type'] || '').startsWith('application/json') || !mesmaOrigem(req)) {
    return responder(res, 403, { codigo: 'origem', mensagem: 'Requisição recusada.' });
  }

  if (!servidorAdminConfigurado()) {
    return responder(res, 503, {
      codigo: 'nao_configurado',
      mensagem: 'Criação de usuários pelo sistema ainda não configurada no servidor (SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

  const supabaseSessao = createServerPropsClient({ req, res });

  const { data: { user } = {} } = await supabaseSessao.auth.getUser();
  if (!user) {
    return responder(res, 401, { codigo: 'sem_sessao', mensagem: 'Sessão expirada. Entre novamente.' });
  }

  const { data: ehAdmin, error: erroAdmin } = await supabaseSessao.rpc('is_admin');
  if (erroAdmin || ehAdmin !== true) {
    return responder(res, 403, { codigo: 'sem_permissao', mensagem: 'Apenas administradores podem criar usuários.' });
  }

  const validacao = validarNovoUsuario(req.body || {});
  if (!validacao.ok) {
    return responder(res, 400, { codigo: 'dados_invalidos', mensagem: 'Revise os campos.', erros: validacao.erros });
  }
  const { dados } = validacao;

  const { data: perfil } = await supabaseSessao
    .from('perfis')
    .select('nome')
    .eq('nome', dados.perfil)
    .eq('ativo', true)
    .maybeSingle();
  if (!perfil) {
    return responder(res, 400, {
      codigo: 'dados_invalidos',
      mensagem: 'Revise os campos.',
      erros: { perfil: 'Perfil inválido ou inativo.' },
    });
  }

  const supabaseAdmin = createAdminClient();

  const resultado = await criarUsuarioCompleto({
    dados,
    criarLoginAuth: async ({ email, senha, nome }) => {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        // Conta criada por um administrador: já nasce confirmada (sem
        // depender de SMTP). nome vai só como metadado informativo -- o
        // sistema nunca lê perfil/permissão de user_metadata.
        email_confirm: true,
        user_metadata: { nome },
      });
      if (error) return { error };
      return { id: data?.user?.id };
    },
    vincular: ({ usuarioId, nome, perfil: perfilEscolhido }) =>
      supabaseSessao.rpc('admin_vincular_usuario_auth', {
        p_usuario_id: usuarioId,
        p_nome: nome,
        p_perfil: perfilEscolhido,
      }),
    excluirLoginAuth: (usuarioId) => supabaseAdmin.auth.admin.deleteUser(usuarioId),
  });

  if (resultado.status >= 500) {
    // Sem dados pessoais/senha no log -- só o código e o id técnico.
    console.error('[admin/usuarios/criar]', resultado.corpo.codigo, resultado.corpo.usuario_id || '');
  }

  return responder(res, resultado.status, resultado.corpo);
}
