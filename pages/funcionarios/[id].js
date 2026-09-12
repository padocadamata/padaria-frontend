import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../../components/MenuOpcoes';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import DadosFuncionarioForm from '../../components/funcionarios/DadosFuncionarioForm';
import DependentesTab from '../../components/funcionarios/DependentesTab';
import BeneficiosTab from '../../components/funcionarios/BeneficiosTab';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';

const ABAS = [
  { chave: 'dados', label: 'Dados pessoais e profissionais' },
  { chave: 'dependentes', label: 'Dependentes' },
  { chave: 'beneficios', label: 'Benefícios' },
];

// Diffs mínimos que valem auditoria dedicada, além do "editou" genérico
// -- ativação/inativação e vínculo/desvínculo de usuário são as ações
// explicitamente exigidas pela Fase 1 (ver relatório desta rodada).
function registrarAuditoriaDiff(anterior, atualizado) {
  registrarAuditoria({ entidade: 'funcionario', registroId: atualizado.id, acao: 'editou' });

  if (anterior.ativo !== atualizado.ativo) {
    registrarAuditoria({
      entidade: 'funcionario',
      registroId: atualizado.id,
      acao: atualizado.ativo ? 'reativou' : 'inativou',
      campo: 'ativo',
      valorAnterior: anterior.ativo,
      valorNovo: atualizado.ativo,
    });
  }

  if (anterior.usuario_id !== atualizado.usuario_id) {
    registrarAuditoria({
      entidade: 'funcionario',
      registroId: atualizado.id,
      acao: atualizado.usuario_id ? 'vinculou_usuario' : 'desvinculou_usuario',
      campo: 'usuario_id',
      valorAnterior: anterior.usuario_id,
      valorNovo: atualizado.usuario_id,
    });
  }
}

function FuncionarioDetalheConteudo() {
  const router = useRouter();
  const { id } = router.query;
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_EDITAR);

  const [aparencia, setAparencia] = useState({ corPrimaria: '#8B4513', corFundo: '#f5f5f5', nomeEmpresa: 'Padaria Sistema' });
  const [funcionario, setFuncionario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('dados');

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

  async function carregar() {
    if (!id) return;
    setCarregando(true);
    setErro('');
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      setErro('Funcionário não encontrado ou você não tem permissão para vê-lo.');
    } else {
      setFuncionario(data);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function aoSalvar(atualizado) {
    if (funcionario) {
      registrarAuditoriaDiff(funcionario, atualizado);
    }
    setFuncionario(atualizado);
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

        {carregando ? (
          <p>Carregando...</p>
        ) : erro ? (
          <p style={{ color: '#f44336' }}>{erro}</p>
        ) : (
          <>
            <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>
              {funcionario.nome} {!funcionario.ativo && <span style={{ fontSize: '14px', color: '#999' }}>(inativo)</span>}
            </h2>

            <div style={{ display: 'flex', gap: '4px', borderBottom: `2px solid ${aparencia.corPrimaria}`, marginBottom: '20px', flexWrap: 'wrap' }}>
              {ABAS.map((a) => (
                <button
                  key={a.chave}
                  onClick={() => setAba(a.chave)}
                  style={{
                    padding: '10px 16px',
                    border: 'none',
                    borderBottom: aba === a.chave ? `3px solid ${aparencia.corPrimaria}` : '3px solid transparent',
                    backgroundColor: 'transparent',
                    color: aba === a.chave ? aparencia.corPrimaria : '#666',
                    fontWeight: aba === a.chave ? 'bold' : 'normal',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
              {aba === 'dados' && (
                <DadosFuncionarioForm funcionario={funcionario} corPrimaria={aparencia.corPrimaria} podeEditar={podeEditar} onSalvo={aoSalvar} />
              )}
              {aba === 'dependentes' && (
                <DependentesTab funcionarioId={funcionario.id} corPrimaria={aparencia.corPrimaria} podeEditar={podeEditar} />
              )}
              {aba === 'beneficios' && (
                <BeneficiosTab funcionarioId={funcionario.id} corPrimaria={aparencia.corPrimaria} podeEditar={podeEditar} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function FuncionarioDetalhe() {
  return (
    <RequireAuth permissao={PERMISSOES.FUNCIONARIOS_VISUALIZAR}>
      <FuncionarioDetalheConteudo />
    </RequireAuth>
  );
}
