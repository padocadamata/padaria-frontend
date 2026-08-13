export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ mensagem: 'Método não permitido' });
  }

  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ mensagem: 'Email e senha são obrigatórios' });
  }

  try {
    // Fazer requisição HTTP direto ao Supabase
    const response = await fetch(
      'https://eyqfqsltavikhnxhanbf.supabase.co/rest/v1/usuarios?email=eq.' + encodeURIComponent(email),
      {
        method: 'GET',
        headers: {
          'apikey': 'sb_publishable_uKSNMYA2r2KmGN3B95-7tw_VHrCv2Z9',
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    if (!data || data.length === 0) {
      return res.status(401).json({ mensagem: 'Email ou senha inválidos' });
    }

    const usuario = data[0];

    // Verificar senha
    if (usuario.senha !== senha) {
      return res.status(401).json({ mensagem: 'Email ou senha inválidos' });
    }

    // Sucesso!
    const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');

    res.status(200).json({
      sucesso: true,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nome: usuario.nome,
        perfil: usuario.perfil,
      },
      token,
    });
  } catch (error) {
    console.error('Erro de login:', error);
    res.status(500).json({ mensagem: 'Erro ao fazer login' });
  }
}
