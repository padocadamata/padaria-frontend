import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../components/MenuOpcoes';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import GerenciarCargosModal from '../components/funcionarios/GerenciarCargosModal';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';

function FuncionariosConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const podeInserir = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_EDITAR);

  const [aparencia, setAparencia] = useState({ corPrimaria: '#8B4513', corFundo: '#f5f5f5', nomeEmpresa: 'Padaria Sistema' });
  const [funcionarios, setFuncionarios] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [busca, setBusca] = useState('');
  const [modalCargosAberto, setModalCargosAberto] = useState(false);

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
    setCarregando(true);
    setErro('');
    const supabase = createClient();
    const [{ data: funcionariosData, error: erroFuncionarios }, { data: cargosData }] = await Promise.all([
      supabase
        .from('funcionarios')
        .select('id, nome, telefone, ativo, data_admissao, cargo_id, funcionarios_cargos(nome)')
        .order('nome')
        .limit(1000),
      supabase.from('funcionarios_cargos').select('id, nome, ativo').order('nome'),
    ]);

    if (erroFuncionarios) {
      console.error('Erro ao carregar funcionários:', erroFuncionarios);
      setErro('Não foi possível carregar a lista de funcionários.');
    } else {
      setFuncionarios(funcionariosData || []);
    }
    setCargos(cargosData || []);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  const listaFiltrada = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return funcionarios.filter((f) => {
      if (filtroStatus === 'ativos' && !f.ativo) return false;
      if (filtroStatus === 'inativos' && f.ativo) return false;
      if (termo && !f.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [funcionarios, filtroStatus, busca]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Folha de Pagamento</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
          <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Cadastro de Funcionários</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            {podeEditar && (
              <button
                onClick={() => setModalCargosAberto(true)}
                style={{ padding: '8px 16px', backgroundColor: 'white', color: aparencia.corPrimaria, border: `1px solid ${aparencia.corPrimaria}`, borderRadius: '5px', cursor: 'pointer', fontSize: '13px' }}
              >
                Gerenciar cargos
              </button>
            )}
            {podeInserir && (
              <button
                onClick={() => router.push('/funcionarios/novo')}
                style={{ padding: '8px 16px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >
                + Novo funcionário
              </button>
            )}
          </div>
        </div>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ flex: 1, minWidth: '200px', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
            />
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </div>

          {carregando ? (
            <p>Carregando funcionários...</p>
          ) : erro ? (
            <p style={{ color: '#f44336' }}>{erro}</p>
          ) : listaFiltrada.length === 0 ? (
            <p>Nenhum funcionário encontrado com os filtros atuais.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={thStyle(aparencia)}>Nome</th>
                  <th style={thStyle(aparencia)}>Cargo</th>
                  <th style={thStyle(aparencia)}>Telefone</th>
                  <th style={thStyle(aparencia)}>Admissão</th>
                  <th style={thStyle(aparencia)}>Status</th>
                  <th style={thStyle(aparencia)}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {listaFiltrada.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '12px' }}>{f.nome}</td>
                    <td style={{ padding: '12px' }}>{f.funcionarios_cargos?.nome || '—'}</td>
                    <td style={{ padding: '12px' }}>{f.telefone || '—'}</td>
                    <td style={{ padding: '12px' }}>{f.data_admissao ? new Date(`${f.data_admissao}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style={{ padding: '12px' }}>{f.ativo ? 'Ativo' : 'Inativo'}</td>
                    <td style={{ padding: '12px' }}>
                      <button
                        onClick={() => router.push(`/funcionarios/${f.id}`)}
                        style={{ padding: '6px 12px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '13px' }}
                      >
                        {podeEditar ? 'Editar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <GerenciarCargosModal
        aberto={modalCargosAberto}
        onFechar={() => setModalCargosAberto(false)}
        cargos={cargos}
        podeGerenciar={podeEditar}
        corPrimaria={aparencia.corPrimaria}
        onAtualizar={setCargos}
      />
    </div>
  );
}

function thStyle(aparencia) {
  return { padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' };
}

export default function Funcionarios() {
  return (
    <RequireAuth permissao={PERMISSOES.FUNCIONARIOS_VISUALIZAR}>
      <FuncionariosConteudo />
    </RequireAuth>
  );
}
