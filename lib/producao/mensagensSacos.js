// Mensagens de erro do Controle de Sacos Fechados (migration 0042) --
// reaproveitado por pages/producao/sacos.js e pelos modais de
// abertura/edição. Mesmo princípio já usado em todo o projeto (ver
// mensagemErroLoteExpositor em lib/producao/mensagensExpositor.js): NUNCA
// mostrar error.message bruto -- só reconhecer os textos EXATOS que as
// RPCs de sacos (registrar_abertura_saco, editar_movimentacao_saco)
// levantam, e devolver uma mensagem pré-escrita. Qualquer coisa não
// reconhecida cai no fallback genérico.
export function mensagemErroSacos(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('requer sessao autenticada')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (msg.includes('requer a permissao producao_sacos.operar')) {
    return 'Você não tem permissão para registrar abertura de sacos.';
  }
  if (msg.includes('requer a permissao producao_sacos.editar')) {
    return 'Você não tem permissão para corrigir esta movimentação.';
  }
  if (msg.includes('requer a permissao producao_sacos.excluir')) {
    return 'Você não tem permissão para excluir esta movimentação.';
  }
  if (msg.includes('produto_fornecedor_id e obrigatorio')) {
    return 'Selecione a configuração (produto/fornecedor).';
  }
  if (msg.includes('quantidade_sacos deve ser um inteiro maior que zero')) {
    return 'Informe uma quantidade de sacos inteira e maior que zero.';
  }
  if (msg.includes('operacao_id e obrigatorio')) {
    return 'Erro interno ao preparar a operação. Recarregue a página e tente novamente.';
  }
  if (msg.includes('nao encontrada') && msg.includes('configuracao comercial')) {
    return 'Esta configuração comercial não foi encontrada. Recarregue a página.';
  }
  if (msg.includes('configuracao comercial') && msg.includes('esta inativa')) {
    return 'Esta configuração comercial está inativa.';
  }
  if (msg.includes('nao esta marcada para controle de sacos fechados')) {
    return 'Esta configuração comercial não está marcada para controle de sacos fechados.';
  }
  if (msg.includes('nao tem peso_por_saco_kg valido cadastrado')) {
    return 'Esta configuração comercial não tem um peso por saco válido cadastrado. Corrija em Catálogo > Fornecedores.';
  }
  if (msg.includes('Sacos Fechados so opera sobre produtos cuja unidade-base seja KG')) {
    return 'Este produto não tem unidade-base KG. Sacos Fechados só funciona para produtos cuja unidade-base seja KG.';
  }
  if (msg.includes('saldo insuficiente')) {
    return 'Saldo de sacos fechados insuficiente para esta abertura.';
  }
  if (msg.includes('movimentacao_id e obrigatorio')) {
    return 'Erro interno ao identificar a movimentação. Recarregue a página.';
  }
  if (msg.includes('nova quantidade nao pode ser zero')) {
    return 'Informe uma quantidade diferente de zero.';
  }
  if (msg.includes('movimentacao') && msg.includes('nao encontrada')) {
    return 'Esta movimentação não foi encontrada. Recarregue a página.';
  }
  if (msg.includes('somente aberturas, ajustes manuais e saldos iniciais podem ser corrigidos')) {
    return 'Somente aberturas, ajustes manuais e saldos iniciais podem ser corrigidos -- entradas automáticas de pedido não são editáveis aqui.';
  }
  if (msg.includes('precisa continuar negativa')) {
    return 'Uma abertura de saco precisa continuar sendo uma saída (quantidade negativa).';
  }
  if (msg.includes('precisa continuar positiva')) {
    return 'Um saldo inicial precisa continuar sendo uma entrada (quantidade positiva).';
  }
  if (msg.includes('esta correcao deixaria o saldo negativo')) {
    return 'Esta correção deixaria o saldo de sacos fechados negativo.';
  }
  if (msg.includes('esperada exatamente 1 movimentacao de estoque vinculada')) {
    return 'Não foi possível corrigir esta movimentação com segurança (vínculo de estoque inesperado). Avise um administrador.';
  }
  if (msg.includes('ja existe um saldo inicial registrado para esta configuracao comercial')) {
    return 'Já existe um saldo inicial lançado para esta configuração. Para corrigir, use "Editar" na movimentação existente.';
  }
  if (msg.includes('motivo e obrigatorio')) {
    return 'Informe o motivo da exclusão.';
  }
  if (msg.includes('somente aberturas, ajustes manuais e saldos iniciais podem ser excluidos')) {
    return 'Somente aberturas, ajustes manuais e saldos iniciais podem ser excluídos -- entradas automáticas de pedido não são excluíveis aqui.';
  }
  if (msg.includes('deixaria o saldo de sacos fechados negativo')) {
    return 'Excluir esta movimentação deixaria o saldo de sacos fechados negativo. Exclua primeiro as outras movimentações na ordem correta (ex.: a abertura antes do saldo inicial).';
  }
  if (msg.toLowerCase().includes('row-level security') || msg.toLowerCase().includes('violates row-level')) {
    return 'Você não tem permissão para esta ação.';
  }

  console.error('Erro no Controle de Sacos Fechados:', error);
  return 'Não foi possível concluir a operação. Tente novamente ou avise um administrador.';
}

// Rótulos de exibição -- mesmos domínios fechados da migration 0042
// (sacos_fechados_movimentacoes_tipo_check/origem_check).
export const TIPO_MOVIMENTO_LABEL = {
  entrada: 'Entrada',
  abertura: 'Abertura',
  ajuste_manual: 'Ajuste manual',
  saldo_inicial: 'Saldo inicial',
};

export const ORIGEM_MOVIMENTO_LABEL = {
  recebimento_pedido: 'Recebimento de pedido',
  retirada: 'Retirada',
  abertura_manual: 'Abertura manual',
  ajuste_manual: 'Ajuste manual',
  carga_inicial: 'Carga inicial',
};
