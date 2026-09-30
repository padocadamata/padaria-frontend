// Filtro puro da listagem de funcionários (pages/funcionarios.js) --
// extraído do useMemo para ser testável sem depender de React. Combina
// nome + status + vínculo -- cada critério é independente e opcional
// (vinculo='' ou status='todos' não restringem aquele critério).
export function funcionarioPassaFiltro(funcionario, { termo, status, vinculo }) {
  if (status === 'ativos' && !funcionario.ativo) return false;
  if (status === 'inativos' && funcionario.ativo) return false;
  if (vinculo && funcionario.tipo_vinculo !== vinculo) return false;

  const termoNormalizado = (termo || '').trim().toLowerCase();
  if (termoNormalizado && !funcionario.nome.toLowerCase().includes(termoNormalizado)) return false;

  return true;
}
