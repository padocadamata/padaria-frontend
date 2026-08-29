import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../components/MenuOpcoes';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';

// Lote pequeno e conservador de propósito: fica bem abaixo do db-max-rows
// padrão do PostgREST/Supabase (tipicamente 1000) mesmo em configurações
// mais restritivas do projeto, reduzindo o risco de um único lote já vir
// truncado. Isso não torna o frontend absolutamente independente do
// db-max-rows -- se o projeto algum dia configurar um limite abaixo de
// 100, o problema volta a existir -- só reduz bastante a chance de isso
// acontecer sem aviso, sem depender de conhecer o valor exato configurado.
const TAMANHO_LOTE = 100;
// Segurança contra loop infinito: 1000 lotes de 100 cobre até 100.000
// produtos, bem acima de qualquer crescimento razoável do catálogo. Se
// esse teto for atingido, para de buscar em vez de rodar para sempre.
const MAX_LOTES = 1000;

// Busca TODOS os produtos que atendem ao filtro, em lotes sucessivos via
// .range(), em vez de uma única consulta (hoje 390 produtos passam numa
// única página de 500, mas o catálogo não pode voltar a depender disso
// silenciosamente se crescer). Ordena por nome + id (desempate estável):
// há nomes duplicados reais no catálogo hoje (ex. "OVO BRANCO" x2), e sem
// um desempate determinístico a paginação por .range() poderia pular ou
// repetir uma linha entre dois lotes quando o Postgres ordenasse o
// empate de forma diferente a cada consulta.
async function buscarTodosProdutos(supabase, filtroStatus) {
  const registros = [];
  let inicio = 0;

  for (let lote = 0; lote < MAX_LOTES; lote++) {
    let consulta = supabase
      .from('produtos')
      .select('id, nome, codigo_g3, codigo_barras, secao, categoria, unidade_medida, ativo')
      .order('nome', { ascending: true })
      .order('id', { ascending: true })
      .range(inicio, inicio + TAMANHO_LOTE - 1);

    if (filtroStatus === 'ativos') {
      consulta = consulta.eq('ativo', true);
    } else if (filtroStatus === 'inativos') {
      consulta = consulta.eq('ativo', false);
    }

    const { data, error } = await consulta;

    if (error) {
      throw error;
    }

    const paginaAtual = data || [];
    registros.push(...paginaAtual);

    if (paginaAtual.length < TAMANHO_LOTE) {
      // Lote incompleto -- não há mais registros a buscar.
      break;
    }

    inicio += TAMANHO_LOTE;
  }

  return registros;
}

function BadgeStatus({ ativo }) {
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

// Listagem do Catálogo de Produtos (public.produtos). Deliberadamente SEM
// nenhuma coluna de preço -- "Não transformar essa página em uma tabela
// de preços" (preço/comparação de preço vive em /catalogo/[id], card
// "Resumo de preços"). Mesma estrutura de página que
// pages/admin/usuarios.js: tabela + botão de linha que navega para a
// rota de detalhe.
function CatalogoConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();

  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [filtroSecao, setFiltroSecao] = useState('todas');
  const [filtroCategoria, setFiltroCategoria] = useState('todas');
  const [busca, setBusca] = useState('');

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
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
  }, []);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarProdutos() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      try {
        const todosProdutos = await buscarTodosProdutos(supabase, filtroStatus);
        if (!efeitoAtivo) return;
        setProdutos(todosProdutos);
      } catch (error) {
        if (!efeitoAtivo) return;
        console.error('Erro ao carregar produtos:', error);
        setErro('Não foi possível carregar o catálogo de produtos.');
        setProdutos([]);
      }

      if (!efeitoAtivo) return;
      setCarregando(false);
    }

    carregarProdutos();
    return () => {
      efeitoAtivo = false;
    };
  }, [filtroStatus]);

  const secoesExistentes = Array.from(new Set(produtos.map((p) => p.secao).filter(Boolean))).sort();
  const categoriasExistentes = Array.from(new Set(produtos.map((p) => p.categoria).filter(Boolean))).sort();

  const buscaNormalizada = busca.trim().toLowerCase();

  const produtosFiltrados = produtos.filter((produto) => {
    if (filtroSecao !== 'todas' && produto.secao !== filtroSecao) return false;
    if (filtroCategoria !== 'todas' && produto.categoria !== filtroCategoria) return false;

    if (!buscaNormalizada) return true;

    const nome = (produto.nome || '').toLowerCase();
    const codigoG3 = (produto.codigo_g3 || '').toLowerCase();
    const codigoBarras = (produto.codigo_barras || '').toLowerCase();

    return nome.includes(buscaNormalizada) || codigoG3.includes(buscaNormalizada) || codigoBarras.includes(buscaNormalizada);
  });

  const podeEditar = hasPermissao(permissoes, PERMISSOES.CATALOGO_PRODUTOS_EDITAR);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Catálogo de Produtos</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
          <p style={{ color: '#666', margin: 0 }}>
            Cadastro mestre de produtos comprados — nome, códigos, seção/categoria e unidade-base. Fornecedores e
            histórico de compras ficam na página de cada produto.
          </p>

          {podeEditar && (
            <button
              onClick={() => router.push('/catalogo/novo')}
              style={{
                padding: '10px 20px',
                backgroundColor: aparencia.corPrimaria,
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
              }}
            >
              + Novo produto
            </button>
          )}
        </div>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Buscar</label>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, código G3 ou código de barras"
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Status</label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
              >
                <option value="ativos">Ativos</option>
                <option value="inativos">Inativos</option>
                <option value="todos">Todos</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Seção</label>
              <select
                value={filtroSecao}
                onChange={(e) => setFiltroSecao(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
              >
                <option value="todas">Todas</option>
                {secoesExistentes.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Categoria</label>
              <select
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
              >
                <option value="todas">Todas</option>
                {categoriasExistentes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
          {carregando ? (
            <p>Carregando produtos...</p>
          ) : erro ? (
            <p style={{ color: '#f44336' }}>{erro}</p>
          ) : produtosFiltrados.length === 0 ? (
            <p style={{ color: '#666' }}>Nenhum produto encontrado.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={thStyle(aparencia)}>Nome</th>
                  <th style={thStyle(aparencia)}>Código G3</th>
                  <th style={thStyle(aparencia)}>Seção / Categoria</th>
                  <th style={thStyle(aparencia)}>Unidade-base</th>
                  <th style={thStyle(aparencia)}>Status</th>
                  <th style={thStyle(aparencia)}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {produtosFiltrados.map((produto) => (
                  <tr key={produto.id} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '12px' }}>{produto.nome}</td>
                    <td style={{ padding: '12px' }}>{produto.codigo_g3 || '—'}</td>
                    <td style={{ padding: '12px' }}>
                      {produto.secao || '—'}{produto.categoria ? ` / ${produto.categoria}` : ''}
                    </td>
                    <td style={{ padding: '12px' }}>{produto.unidade_medida || '—'}</td>
                    <td style={{ padding: '12px' }}><BadgeStatus ativo={produto.ativo} /></td>
                    <td style={{ padding: '12px' }}>
                      <button
                        onClick={() => router.push(`/catalogo/${produto.id}`)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: aparencia.corPrimaria,
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        Ver produto
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function thStyle(aparencia) {
  return { padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' };
}

export default function Catalogo() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR}>
      <CatalogoConteudo />
    </RequireAuth>
  );
}
