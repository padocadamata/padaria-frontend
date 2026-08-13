export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ mensagem: 'Método não permitido' });
  }

  const { email, senha } = req.body;

  // LOGIN SIMPLES PARA TESTE
  if (email === 'gerente@padoca.com.br' && senha === 'senha123') {
    const token = 'token-gerente-padoca';
    
    return res.status(200).json({
      sucesso: true,
      usuario: {
        id: '1',
        email: 'gerente@padoca.com.br',
        nome: 'Gerente Padoca',
        perfil: 'gerente',
      },
      token,
    });
  }

  return res.status(401).json({ mensagem: 'Email ou senha inválidos' });
}
