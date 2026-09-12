import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../../components/MenuOpcoes';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import DadosFuncionarioForm from '../../components/funcionarios/DadosFuncionarioForm';
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
  const [aparencia, setAparencia] = useState({ corPrimaria: '#8B4513', corFundo: '#f5f5f5', nomeEmpresa: 'Padaria Sistema' });

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');
    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }
  }, []);

  function aoCriar(novoId) {
    registrarAuditoria({ entidade: 'funcionario', registroId: novoId, acao: 'criou' });
    router.push(`/funcionarios/${novoId}`);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Folha de Pagamento</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

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
