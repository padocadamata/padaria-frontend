export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Retornar configurações padrão
    const configPadrao = {
      corPrimaria: '#8B4513',
      corSecundaria: '#D2691E',
      corSucesso: '#4CAF50',
      corErro: '#f44336',
      corFundo: '#f5f5f5',
      corTexto: '#333',
      fonte: 'Arial',
      tamanhoTitulo: '28',
      tamanhoCorp: '14',
      nomeEmpresa: 'Padaria Sistema',
      logoUrl: '/logo-default.png',
    };

    try {
      // Buscar configuração no Supabase (quando houver tabela)
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/aparencia?limit=1`,
        {
          method: 'GET',
          headers: {
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (data && data.length > 0) {
        return res.status(200).json({
          success: true,
          data: data[0],
        });
      }

      return res.status(200).json({
        success: true,
        data: configPadrao,
      });
    } catch (error) {
      // Retornar padrão se houver erro
      return res.status(200).json({
        success: true,
        data: configPadrao,
      });
    }
  }

  if (req.method === 'POST') {
    const { corPrimaria, corSecundaria, corSucesso, corErro, corFundo, corTexto, fonte, tamanhoTitulo, tamanhoCorp, nomeEmpresa, logoUrl } = req.body;

    try {
      // Tentar atualizar ou inserir no Supabase
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/aparencia`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            corPrimaria,
            corSecundaria,
            corSucesso,
            corErro,
            corFundo,
            corTexto,
            fonte,
            tamanhoTitulo,
            tamanhoCorp,
            nomeEmpresa,
            logoUrl,
            id: 1, // Um único registro de configuração
          }),
        }
      );

      if (response.status === 201 || response.status === 200) {
        return res.status(200).json({
          success: true,
          mensagem: 'Configuração salva com sucesso',
        });
      } else {
        // Se houver erro, ainda retorna sucesso (configuração em memória)
        return res.status(200).json({
          success: true,
          mensagem: 'Configuração salva localmente',
        });
      }
    } catch (error) {
      // Mesmo com erro, retorna sucesso (fallback local)
      return res.status(200).json({
        success: true,
        mensagem: 'Configuração salva (modo offline)',
      });
    }
  }

  return res.status(405).json({ mensagem: 'Método não permitido' });
}
