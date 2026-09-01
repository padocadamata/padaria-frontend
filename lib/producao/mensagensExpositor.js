// Mensagens de erro do Controle de Expositores (migration 0030) --
// reaproveitado por pages/producao/expositores.js e pelos modais de
// edição/correção/exclusão de lote. Mesmo princípio já usado em todo o
// projeto (ver mensagemErroReaberturaRecebimento em pages/pedidos.js):
// NUNCA mostrar error.message bruto -- só reconhecer os textos EXATOS
// que as RPCs de expositor (criar_lote_expositor, editar_lote_expositor,
// concluir_retirada_expositor, corrigir_lote_expositor_concluido,
// excluir_lote_expositor) levantam, e devolver uma mensagem pré-escrita.
// Qualquer coisa não reconhecida cai no fallback genérico.
export function mensagemErroLoteExpositor(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('nao tem o Controle de Expositores habilitado')) {
    return 'Este produto não tem o Controle de Expositores habilitado. Configure em Produção > Produtos.';
  }
  if (msg.includes('ultrapassaria a quantidade produzida')) {
    return 'A quantidade enviada, somada aos demais lotes deste lançamento, ultrapassaria a quantidade produzida.';
  }
  if (msg.includes('ja foi concluido')) {
    return 'Este lote já foi concluído (retirado). Use a correção administrativa para ajustar, se necessário.';
  }
  if (msg.includes('ainda nao foi concluido')) {
    return 'Este lote ainda não foi concluído -- use a edição normal, não a correção administrativa.';
  }
  if (msg.includes('nao pode ser maior que a quantidade enviada')) {
    return 'A quantidade retirada não pode ser maior que a quantidade enviada ao expositor.';
  }
  if (msg.includes('nao pode ser maior que quantidade_enviada')) {
    return 'A quantidade retirada não pode ser maior que a quantidade enviada.';
  }
  if (msg.includes('data_entrada e obrigatoria')) {
    return 'Informe a data de entrada no expositor.';
  }
  if (msg.includes('quantidade_enviada deve ser maior que zero')) {
    return 'Informe uma quantidade enviada maior que zero.';
  }
  if (msg.includes('quantidade_retirada deve ser zero ou maior')) {
    return 'Informe uma quantidade retirada válida (zero ou maior).';
  }
  if (msg.includes('motivo e obrigatorio')) {
    return 'Informe o motivo.';
  }
  if (msg.includes('requer a permissao producao_expositores.excluir')) {
    return 'Você não tem permissão para excluir lotes de expositor.';
  }
  if (msg.includes('nao encontrado')) {
    return 'Este lote não está mais disponível. Atualize a página.';
  }
  if (msg.toLowerCase().includes('row-level security') || msg.toLowerCase().includes('violates row-level')) {
    return 'Você não tem permissão para esta ação.';
  }

  console.error('Erro no Controle de Expositores:', error);
  return 'Não foi possível concluir a operação. Tente novamente ou avise um administrador.';
}
