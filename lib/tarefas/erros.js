// Tradução das mensagens das RPCs de Tarefas (migration 0061) -- o banco
// escreve sem acentos e com o nome da função como prefixo (padrão do
// projeto); a tela mostra o texto em português corrente.

const TRADUCOES = [
  ['requer sessao autenticada', 'Sua sessão expirou. Entre novamente.'],
  ['ja terminou e nao pode ser programado', 'Este mês já terminou e não pode mais ser programado.'],
  ['a descricao e obrigatoria', 'Informe a descrição da tarefa.'],
  ['ja existe uma tarefa com esta descricao', 'Já existe uma tarefa com esta descrição (confira também as tarefas inativas).'],
  ['categoria invalida', 'Escolha uma categoria válida.'],
  ['escolha ao menos um dia da semana', 'Marque ao menos um dia da semana.'],
  ['escolha o dia da semana e ao menos uma semana do mes', 'Escolha o dia da semana e ao menos uma semana do mês.'],
  ['informe a partir de quando', 'Informe a partir de quando a nova programação vale.'],
  ['so pode mudar a partir de hoje', 'A programação só pode mudar a partir de hoje — o passado fica como está.'],
  ['ja existe uma alteracao de programacao agendada', 'Já existe uma alteração agendada para uma data posterior. Edite a partir daquela data.'],
  ['inativacao so pode valer a partir de hoje', 'A inativação só pode valer a partir de hoje.'],
  ['ja tem ocorrencias no calendario', 'Esta tarefa já tem ocorrências no calendário (histórico) e não pode ser excluída. Inativa, ela deixa de ser programada e sai do cadastro — o histórico é preservado.'],
  ['ja existe um grupo com este nome', 'Já existe um grupo com este nome.'],
  ['grupo ja foi usado', 'Este grupo já foi usado em alguma programação e não pode ser excluído.'],
  ['identificacao so pode valer a partir de hoje', 'A identificação só pode valer a partir de hoje.'],
  ['ocorrencia cancelada nao pode ser concluida', 'Uma ocorrência cancelada não pode ser concluída.'],
  ['informe o nome de quem executou', 'Informe o nome de quem executou.'],
  ['ja tem 2 execucoes','Esta tarefa já tem 2 execuções registradas (máximo).'],
  ['execucao nao encontrada', 'Esta execução não existe mais. Atualize a tela.'],
  ['nome pode ter no maximo 60', 'O nome pode ter no máximo 60 caracteres.'],
  ['desmarque a conclusao', 'Desmarque a conclusão antes.'],
  ['restaure-a antes', 'A ocorrência está cancelada — restaure-a antes.'],
  ['informe o motivo', 'Informe o motivo do cancelamento.'],
  ['ja tem ocorrencia em', 'Esta tarefa já tem ocorrência nesta data.'],
  ['ocorrencia nao encontrada', 'Esta ocorrência não existe mais. Atualize a tela.'],
  ['tarefa nao encontrada', 'Esta tarefa não existe mais. Atualize a tela.'],
];

export function mensagemErro(erro) {
  if (!erro) return '';
  if (erro.code === '42501') return 'Você não tem permissão para esta ação.';
  const texto = String(erro.message || erro);
  const minusculo = texto.toLowerCase();
  const traducao = TRADUCOES.find(([trecho]) => minusculo.includes(trecho));
  if (traducao) return traducao[1];
  return texto.replace(/^[a-z_]+:\s*/, '') || 'Não foi possível concluir a operação.';
}
