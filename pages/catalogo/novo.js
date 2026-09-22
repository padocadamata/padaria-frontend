import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import DadosProdutoForm from '../../components/catalogo/DadosProdutoForm';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { PERMISSOES } from '../../lib/auth/permissoes';

// Cria SOMENTE o produto (public.produtos) -- fornecedores e histórico de
// compras só podem ser cadastrados depois que produto.id existe, então
// esta página não tenta montá-los antes da hora. Ao salvar, redireciona
// para /catalogo/{id}, onde os outros cards já aparecem prontos para
// receber a primeira configuração/lançamento.
function NovoProdutoConteudo() {
  const router = useRouter();

  function aoCriar(novoId) {
    router.push(`/catalogo/${novoId}`);
  }

  return (
    <PageShell titulo="Novo produto">
      <PageHeader
        titulo="Novo produto"
        acoes={
          <Button variante="secondary" onClick={() => router.push('/catalogo')}>
            ← Voltar para o catálogo
          </Button>
        }
      />

      <Card>
        <DadosProdutoForm produto={null} podeEditar onCriado={aoCriar} />
      </Card>
    </PageShell>
  );
}

export default function NovoProduto() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_EDITAR}>
      <NovoProdutoConteudo />
    </RequireAuth>
  );
}
