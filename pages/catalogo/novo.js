import { useRouter } from 'next/router';
import CabecalhoPrincipal from '../../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import DadosProdutoForm from '../../components/catalogo/DadosProdutoForm';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { APARENCIA_FIXA } from '../../lib/branding/tema';

// Cria SOMENTE o produto (public.produtos) -- fornecedores e histórico de
// compras só podem ser cadastrados depois que produto.id existe, então
// esta página não tenta montá-los antes da hora. Ao salvar, redireciona
// para /catalogo/{id}, onde os outros cards já aparecem prontos para
// receber a primeira configuração/lançamento.
function NovoProdutoConteudo() {
  const router = useRouter();
  const aparencia = APARENCIA_FIXA;

  function aoCriar(novoId) {
    router.push(`/catalogo/${novoId}`);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Catálogo" />

      <div style={{ maxWidth: '800px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <button
          onClick={() => router.push('/catalogo')}
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: aparencia.corPrimaria,
            border: `1px solid ${aparencia.corPrimaria}`,
            borderRadius: '5px',
            cursor: 'pointer',
            marginBottom: '20px',
          }}
        >
          ← Voltar para o catálogo
        </button>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Novo produto</h2>
          <DadosProdutoForm produto={null} corPrimaria={aparencia.corPrimaria} podeEditar onCriado={aoCriar} />
        </div>
      </div>
    </div>
  );
}

export default function NovoProduto() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_EDITAR}>
      <NovoProdutoConteudo />
    </RequireAuth>
  );
}
