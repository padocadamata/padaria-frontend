// Corte manhã/tarde do dimensionamento da Escala (migration 0055) -- SÓ um
// critério visual/operacional de resumo, NUNCA uma classificação persistida
// no banco (nenhuma coluna "turno", nenhuma tabela de turnos). Um período
// que atravesse este horário conta em AMBAS as faixas (disponibilidade, não
// atribuição exclusiva) -- ver calcularResumoMensalDia em escalaCobertura.js.
// Ajustável aqui, num único ponto óbvio, se a operação da Padoca mudar --
// mesmo espírito de JANELA_RECEBIDOS_DIAS em lib/pedidos/resumoConfig.js.
export const LIMITE_MANHA_TARDE = '12:00';
