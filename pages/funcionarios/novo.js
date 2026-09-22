import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import DadosFuncionarioForm from '../../components/funcionarios/DadosFuncionarioForm';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';

// Cria SOMENTE o funcionario (public.funcionarios) -- dependentes e
// beneficios só podem ser cadastrados depois que funcionario.id existe,
// mesmo raciocínio de pages/catalogo/novo.js (fornecedores/histórico só
// depois de produto.id existir). Ao salvar, redireciona para
// /funcionarios/{id}, onde as abas de Dependentes/Benefícios já aparecem
// prontas.
function NovoFuncionarioConteudo() {
  const router = useRouter();

  function aoCriar(novoId) {
    registrarAuditoria({ entidade: 'funcionario', registroId: novoId, acao: 'criou' });
    router.push(`/funcionarios/${novoId}`);
  }

  return (
    <PageShell titulo="Folha de Pagamento">
      <PageHeader
        titulo="Novo funcionário"
        acoes={
          <Button variante="secondary" onClick={() => router.push('/funcionarios')}>
            ← Voltar para funcionários
          </Button>
        }
      />

      <Card>
        <DadosFuncionarioForm funcionario={null} podeEditar onCriado={aoCriar} />
      </Card>
    </PageShell>
  );
}

export default function NovoFuncionario() {
  return (
    <RequireAuth permissao={PERMISSOES.FUNCIONARIOS_INSERIR}>
      <NovoFuncionarioConteudo />
    </RequireAuth>
  );
}
