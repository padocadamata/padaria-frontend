// Nome de EXIBIÇÃO de um fornecedor -- critério único do sistema:
// nome fantasia; na falta dele, razão social; por último o nome legado.
// Listas de fornecedores devem ser ordenadas por ESTE nome (o que a pessoa
// vê), nunca pela coluna nome_fantasia do banco -- quem não tem fantasia
// ficava no fim da lista, fora da ordem alfabética.
export function nomeExibicaoFornecedor(fornecedor, alternativo = '') {
  if (!fornecedor) return alternativo;
  return fornecedor.nome_fantasia || fornecedor.razao_social || fornecedor.nome || alternativo;
}
