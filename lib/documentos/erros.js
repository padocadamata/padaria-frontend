// Erros de validação dos documentos (migration 0077): sempre um CÓDIGO
// estável + mensagem para a tela. O banco levanta as mesmas regras como
// "folha_documentos: [codigo] mensagem" -- codigoDoErro() recupera o código
// da mensagem de erro da RPC, para a tela mostrar o texto daqui.

export function erro(codigo, mensagem, extra = {}) {
  return { codigo, mensagem, ...extra };
}

export function codigoDoErro(mensagem) {
  const m = /\[([a-z_]+)\]/.exec(String(mensagem ?? ''));
  return m ? m[1] : null;
}
