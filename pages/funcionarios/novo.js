import { useRouter } from 'next/router';
import CabecalhoPrincipal from '../../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import DadosFuncionarioForm from '../../components/funcionarios/DadosFuncionarioForm';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';
import { APARENCIA_FIXA } from '../../lib/branding/tema';

// Cria SOMENTE o funcionario (public.funcionarios) -- dependentes e
// beneficios só podem ser cadastrados depois que funcionario.id existe,
// mesmo raciocínio de pages/catalogo/novo.js (fornecedores/histórico só
// depois de produto.id existir). Ao salvar, redireciona para
// /funcionarios/{id}, onde as abas de Dependentes/Benefícios já aparecem
// prontas.
function NovoFuncionarioConteudo() {
  const router = useRouter();
  const aparencia = APARENCIA_FIXA;

  function aoCriar(novoId) {
    registrarAuditoria({ entidade: 'funcionario', registroId: novoId, acao: 'criou' });
    router.push(`/funcionarios/${novoId}`);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Folha de Pagamento" />

      <div style={{ maxWidth: '900px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <button
          onClick={() => router.push('/funcionarios')}
          style={{ padding: '8px 16px', backgroundColor: 'white', color: aparencia.corPrimaria, border: `1px solid ${aparencia.corPrimaria}`, borderRadius: '5px', cursor: 'pointer', marginBottom: '20px' }}
        >
          ← Voltar para funcionários
        </button>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Novo funcionário</h2>
          <DadosFuncionarioForm funcionario={null} corPrimaria={aparencia.corPrimaria} podeEditar onCriado={aoCriar} />
        </div>
      </div>
    </div>
  );
}

export default function NovoFuncionario() {
  return (
    <RequireAuth permissao={PERMISSOES.FUNCIONARIOS_INSERIR}>
      <NovoFuncionarioConteudo />
    </RequireAuth>
  );
}
