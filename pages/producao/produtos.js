import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MenuOpcoes from '../../components/MenuOpcoes';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';

function formatarRendimento(quantidade, unidade) {
  if (quantidade == null || !unidade) {
    return '—';
  }

  return `${quantidade} ${unidade}`;
}

function BadgeAtivo({ ativo }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: ativo ? '#4CAF50' : '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function BadgeTelaHoje({ naTelaHoje }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: naTelaHoje ? '#2196F3' : '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {naTelaHoje ? 'Na Tela Hoje' : 'Fora da Tela Hoje'}
    </span>
  );
}

function ProdutosProducaoConteudo() {
  const router = useRouter();

  const [receitas, setReceitas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [filtroTelaHoje, setFiltroTelaHoje] = useState('todas');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroGrupo, setFiltroGrupo] = useState('todos');
  const [busca, setBusca] = useState('');

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');

    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const novaConfig = localStorage.getItem('aparenciaConfig');

      if (novaConfig) {
        try {
          setAparencia(JSON.parse(novaConfig));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  // Diferente de fornecedores.js: os filtros aqui são todos aplicados no
  // cliente, sobre uma única carga de todas as receitas. O volume desta
  // tabela é pequeno (dezenas de linhas), e Tipo/Grupo precisam enxergar os
  // valores de receitas inativas também para montar as opções do filtro —
  // um filtro server-side por status exigiria duas cargas ou perderia essas
  // opções.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarReceitas() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      const { data, error } = await supabase
        .from('receitas')
        .select(
          'id, nome, tipo, grupo, ativo, controlado_producao, rendimento_quantidade, unidade_medida_saida'
        )
        .order('nome', { ascending: true });

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error('Erro ao carregar receitas:', error);
        setErro('Não foi possível carregar a lista de receitas.');
        setReceitas([]);
      } else {
        setReceitas(data || []);
      }

      setCarregando(false);
    }

    carregarReceitas();

    return () => {
      efeitoAtivo = false;
    };
  }, []);

  const tiposDisponiveis = Array.from(
    new Set(receitas.map((r) => r.tipo).filter((v) => v != null && v !== ''))
  ).sort();

  const gruposDisponiveis = Array.from(
    new Set(receitas.map((r) => r.grupo).filter((v) => v != null && v !== ''))
  ).sort();

  const buscaNormalizada = busca.trim().toLowerCase();

  const receitasFiltradas = receitas.filter((receita) => {
    if (filtroStatus === 'ativos' && !receita.ativo) return false;
    if (filtroStatus === 'inativos' && receita.ativo) return false;

    if (filtroTelaHoje === 'na_tela_hoje' && !receita.controlado_producao) return false;
    if (filtroTelaHoje === 'fora_tela_hoje' && receita.controlado_producao) return false;

    if (filtroTipo !== 'todos' && receita.tipo !== filtroTipo) return false;
    if (filtroGrupo !== 'todos' && receita.grupo !== filtroGrupo) return false;

    if (buscaNormalizada && !(receita.nome || '').toLowerCase().includes(buscaNormalizada)) {
      return false;
    }

    return true;
  });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img
                src={aparencia.logoBase64}
                style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }}
                alt="Logo"
              />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>

          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: aparencia.corPrimaria,
              border: '1px solid ' + aparencia.corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Dashboard
          </button>

          <button
            onClick={() => router.push('/fornecedores')}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: aparencia.corPrimaria,
              border: '1px solid ' + aparencia.corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Fornecedores
          </button>

          <button
            onClick={() => router.push('/producao')}
            style={{
              padding: '10px 20px',
              backgroundColor: aparencia.corPrimaria,
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Produção
          </button>
        </div>

        <NavegacaoProducao abaAtiva="produtos" corPrimaria={aparencia.corPrimaria} />

        <h2 style={{ color: aparencia.corPrimaria, marginBottom: '20px' }}>Produtos de Produção</h2>

        {erro && <p style={{ color: '#f44336' }}>{erro}</p>}

        <div
          style={{
            backgroundColor: '#f9f9f9',
            padding: '15px',
            borderRadius: '5px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '15px',
            }}
          >
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Status
              </label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="ativos">Ativas</option>
                <option value="inativos">Inativas</option>
                <option value="todos">Todas</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Exibição na Tela Hoje
              </label>
              <select
                value={filtroTelaHoje}
                onChange={(e) => setFiltroTelaHoje(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todas">Todas</option>
                <option value="na_tela_hoje">Na Tela Hoje</option>
                <option value="fora_tela_hoje">Fora da Tela Hoje</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Tipo
              </label>
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todos">Todos</option>
                {tiposDisponiveis.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Grupo
              </label>
              <select
                value={filtroGrupo}
                onChange={(e) => setFiltroGrupo(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todos">Todos</option>
                {gruposDisponiveis.map((grupo) => (
                  <option key={grupo} value={grupo}>
                    {grupo}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Buscar por nome
              </label>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome da receita..."
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        {carregando ? (
          <p>Carregando receitas...</p>
        ) : receitas.length === 0 ? (
          <p>Nenhuma receita encontrada.</p>
        ) : receitasFiltradas.length === 0 ? (
          <p>Nenhum resultado para esta busca/filtro.</p>
        ) : (
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '5px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>
                    Nome
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>
                    Tipo
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>
                    Grupo
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>
                    Ativo
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>
                    Tela Hoje
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>
                    Rendimento
                  </th>
                </tr>
              </thead>

              <tbody>
                {receitasFiltradas.map((receita) => (
                  <tr key={receita.id} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '12px' }}>{receita.nome}</td>
                    <td style={{ padding: '12px' }}>{receita.tipo || '—'}</td>
                    <td style={{ padding: '12px' }}>{receita.grupo || '—'}</td>
                    <td style={{ padding: '12px' }}>
                      <BadgeAtivo ativo={receita.ativo} />
                    </td>
                    <td style={{ padding: '12px' }}>
                      <BadgeTelaHoje naTelaHoje={receita.controlado_producao} />
                    </td>
                    <td style={{ padding: '12px' }}>
                      {formatarRendimento(receita.rendimento_quantidade, receita.unidade_medida_saida)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ marginTop: '15px', color: '#666', fontSize: '14px' }}>
              Total de receitas: <strong>{receitasFiltradas.length}</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProdutosProducao() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_VISUALIZAR}>
      <ProdutosProducaoConteudo />
    </RequireAuth>
  );
}
