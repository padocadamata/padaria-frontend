import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ mensagem: 'Método não permitido' });
  }

  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ mensagem: 'Email e senha são obrigatórios' });
  }

  try {
    // Buscar usuário no banco
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      return res.status(401).json({ mensagem: 'Email ou senha inválidos' });
    }

    // Verificar senha (NOTA: Em produção, use hash bcrypt!)
    if (data.senha !== senha) {
      return res.status(401).json({ mensagem: 'Email ou senha inválidos' });
    }

    // Retornar usuário e token fake
    const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');

    res.status(200).json({
      sucesso: true,
      usuario: {
        id: data.id,
        email: data.email,
        nome: data.nome,
        perfil: data.perfil,
      },
      token,
    });
  } catch (error) {
    console.error('Erro de login:', error);
    res.status(500).json({ mensagem: 'Erro ao fazer login' });
  }
}
