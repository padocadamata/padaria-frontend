// Filtro de ANÁLISE da Escala (Cargo + Funcionária) -- compartilhado pelas
// três visões (Semanal, Mensal, Cobertura) e pelas exportações PDF/Excel,
// para tela e arquivo nunca divergirem. Só restringe QUAIS LINHAS de
// funcionário aparecem; nunca é escopo de escrita (ações em lote/cópia da
// Semanal continuam operando sobre a equipe toda) nem regra nova da escala.
//
// Fonte: a MESMA lista `funcionarios` já carregada por
// pages/funcionarios/escala.js (ativos, com cargo_id/funcionarios_cargos) --
// nenhum cadastro paralelo de cargos/funcionárias.

export const FILTRO_ESCALA_VAZIO = { cargoId: '', funcionarioId: '' };

// Base de CÁLCULO da cobertura: só o cargo restringe (semântica já
// publicada -- resolverEstadosDoDia filtra a origem por cargoId). A
// funcionária NUNCA entra aqui: filtrar uma pessoa não pode fazer a
// cobertura da equipe "virar 1".
export function funcionariosDoCargo(funcionarios, cargoId) {
  const lista = funcionarios || [];
  return cargoId ? lista.filter((f) => f.cargo_id === cargoId) : lista;
}

// Linhas EXIBIDAS/EXPORTADAS: cargo E funcionária (combinação livre; uma
// combinação incompatível devolve lista vazia -- a tela mostra o estado
// vazio, nunca "corrige" o filtro sozinha).
export function filtrarFuncionariosEscala(funcionarios, filtro = FILTRO_ESCALA_VAZIO) {
  const { cargoId, funcionarioId } = filtro || FILTRO_ESCALA_VAZIO;
  const doCargo = funcionariosDoCargo(funcionarios, cargoId);
  return funcionarioId ? doCargo.filter((f) => f.id === funcionarioId) : doCargo;
}

// Opções do select de Funcionária: só as compatíveis com o cargo
// selecionado (sem cargo = todas). Mesma regra de funcionariosDoCargo.
export function funcionariasDisponiveisNoFiltro(funcionarios, cargoId) {
  return funcionariosDoCargo(funcionarios, cargoId);
}

// Aplica uma mudança de filtro mantendo-o coerente: se a funcionária
// selecionada não pertence ao (novo) cargo, funcionarioId é limpo -- nunca
// fica uma seleção "invisível" no select. Vale para as três visões (estado
// compartilhado da página).
export function normalizarFiltroEscala(filtro, funcionarios) {
  const { cargoId = '', funcionarioId = '' } = filtro || FILTRO_ESCALA_VAZIO;
  if (!funcionarioId) return { cargoId, funcionarioId: '' };
  const compativel = funcionariasDisponiveisNoFiltro(funcionarios, cargoId).some((f) => f.id === funcionarioId);
  return { cargoId, funcionarioId: compativel ? funcionarioId : '' };
}

// Nomes legíveis do filtro ativo (cabeçalho do PDF / aba "Filtros" do
// Excel). `null` = critério não aplicado ("Todos").
export function descreverFiltroEscala(filtro, { cargos, funcionarios }) {
  const { cargoId, funcionarioId } = filtro || FILTRO_ESCALA_VAZIO;
  const cargo = cargoId ? (cargos || []).find((c) => c.id === cargoId) : null;
  const funcionario = funcionarioId ? (funcionarios || []).find((f) => f.id === funcionarioId) : null;
  return {
    cargo: cargoId ? cargo?.nome || 'Cargo não encontrado' : null,
    funcionario: funcionarioId ? funcionario?.nome || 'Funcionária não encontrada' : null,
  };
}
