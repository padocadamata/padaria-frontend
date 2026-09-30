import SubNav from '../ui/SubNav';

// Abas internas de Folha de Pagamento > Tarefas (migration 0061). As duas
// exigem só tarefas.visualizar; o que cada uma permite editar é decidido
// dentro da própria tela (tarefas.editar / tarefas.concluir).
const ABAS = [
  { chave: 'calendario', rotulo: 'Calendário', href: '/funcionarios/tarefas' },
  { chave: 'cadastro', rotulo: 'Cadastro de tarefas', href: '/funcionarios/tarefas/cadastro' },
];

export default function TarefasAbas({ ativo }) {
  return <SubNav itens={ABAS} ativo={ativo} rotulo="Seções de Tarefas" />;
}
