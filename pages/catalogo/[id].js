import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../../components/MenuOpcoes';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import DadosProdutoForm from '../../components/catalogo/DadosProdutoForm';
import FornecedoresDoProduto from '../../components/catalogo/FornecedoresDoProduto';
import HistoricoComprasDoProduto from '../../components/catalogo/HistoricoComprasDoProduto';
import ResumoPrecos from '../../components/catalogo/ResumoPrecos';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';

// Mesmo critério de nome de exibição já usado em pages/fornecedores.js
// (nome_fantasia como principal, nome legado como fallback).
function nomeExibicaoFornecedor(fornecedor) {
  return fornecedor.nome_fantasia || fornecedor.nome || '(sem nome)';
}

// Página dedicada de detalhe/edição -- não modal, não abas -- em cards
// empilhados: Dados do produto, Resumo de preços, Fornecedores, Histórico
// de compras. Busca tudo aqui (produto + fornecedores + as duas tabelas
// filhas + a view de resumo) numa única leva porque
// HistoricoComprasDoProduto precisa da mesma lista de configurações
// comerciais que FornecedoresDoProduto usa (para o preenchimento opcional
// em LancarCompraForm) -- centralizar evita duas queries independentes
// que poderiam ficar dessincronizadas.
function ProdutoDetalheConteudo() {
  const router = useRouter();
  const { id } = router.query;
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.CATALOGO_PRODUTOS_EDITAR);

  const [produto, setProduto] = useState(null);
  const [configuracoes, setConfiguracoes] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [fornecedores, setFornecedores] = useState([]);

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

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
    if (!id) return undefined;

    let efeitoAtivo = true;

    async function carregarTudo() {
      setCarregando(true);
      setErroCarga('');

      const supabase = createClient();

      const { data: produtoRow, error: erroProduto } = await supabase
        .from('produtos')
        .select('id, nome, codigo_g3, codigo_barras, secao_id, categoria_id, unidade_medida, ativo')
        .eq('id', id)
        .single();

      if (!efeitoAtivo) return;

      if (erroProduto || !produtoRow) {
        setErroCarga('Produto não encontrado.');
        setCarregando(false);
        return;
      }

      const [
        { data: fornecedoresRows },
        { data: configuracoesRows },
        { data: lancamentosRows },
        { data: resumoRow },
      ] = await Promise.all([
        supabase.from('fornecedores').select('id, nome, nome_fantasia, ativo').order('nome_fantasia', { ascending: true, nullsFirst: false }),
        supabase
          .from('produto_fornecedores')
          .select('id, fornecedor_id, unidade_comercial, apresentacao, quantidade_embalagem, codigo_produto_fornecedor, observacao, ativo')
          .eq('produto_id', id),
        supabase
          .from('produtos_historico_compras')
          .select('id, fornecedor_id, unidade_comercial, quantidade_comercial, preco_unitario_comercial, fator_conversao_base, preco_unitario_base, data_compra, origem, observacao')
          .eq('produto_id', id)
          .order('data_compra', { ascending: false }),
        supabase.from('produtos_resumo_compras').select('*').eq('produto_id', id).maybeSingle(),
      ]);

      if (!efeitoAtivo) return;

      const fornecedoresList = fornecedoresRows || [];
      const nomesPorId = new Map(fornecedoresList.map((f) => [f.id, nomeExibicaoFornecedor(f)]));

      setProduto(produtoRow);
      setFornecedores(fornecedoresList);
      setConfiguracoes((configuracoesRows || []).map((c) => ({ ...c, fornecedorNome: nomesPorId.get(c.fornecedor_id) || '—' })));
      setLancamentos((lancamentosRows || []).map((l) => ({ ...l, fornecedorNome: nomesPorId.get(l.fornecedor_id) || '—' })));
      setResumo(resumoRow || null);
      setCarregando(false);
    }

    carregarTudo();
    return () => {
      efeitoAtivo = false;
    };
  }, [id, recarregarTick]);

  function recarregar() {
    setRecarregarTick((tick) => tick + 1);
  }

  if (carregando) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Carregando…</div>;
  }

  if (erroCarga || !produto) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#f44336' }}>{erroCarga || 'Produto não encontrado.'}</p>
        <button
          onClick={() => router.push('/catalogo')}
          style={{ padding: '10px 20px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
          Voltar
        </button>
      </div>
    );
  }

  const fornecedoresAtivos = fornecedores.filter((f) => f.ativo).map((f) => ({ id: f.id, nome: nomeExibicaoFornecedor(f) }));
  const fornecedoresPorId = Object.fromEntries(fornecedores.map((f) => [f.id, nomeExibicaoFornecedor(f)]));
  const configuracoesAtivas = configuracoes.filter((c) => c.ativo);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Catálogo de Produtos</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1000px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <button
          onClick={() => router.push('/catalogo')}
          style={{ padding: '8px 16px', backgroundColor: 'white', color: aparencia.corPrimaria, border: `1px solid ${aparencia.corPrimaria}`, borderRadius: '5px', cursor: 'pointer', marginBottom: '20px' }}
        >
          ← Voltar para o catálogo
        </button>

        {/* Card: Dados do produto */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>{produto.nome}</h2>
          <DadosProdutoForm produto={produto} corPrimaria={aparencia.corPrimaria} podeEditar={podeEditar} onSalvo={recarregar} />
        </div>

        {/* Card: Resumo de preços */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <ResumoPrecos resumo={resumo} fornecedoresPorId={fornecedoresPorId} unidadeBase={produto.unidade_medida} />
        </div>

        {/* Card: Fornecedores */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <FornecedoresDoProduto
            produtoId={produto.id}
            configuracoes={configuracoes}
            fornecedoresAtivos={fornecedoresAtivos}
            podeEditar={podeEditar}
            corPrimaria={aparencia.corPrimaria}
            onRecarregar={recarregar}
          />
        </div>

        {/* Card: Histórico de compras */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <HistoricoComprasDoProduto
            produtoId={produto.id}
            lancamentos={lancamentos}
            configuracoesComerciais={configuracoesAtivas}
            fornecedoresAtivos={fornecedoresAtivos}
            podeEditar={podeEditar}
            corPrimaria={aparencia.corPrimaria}
            onRecarregar={recarregar}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProdutoDetalhe() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR}>
      <ProdutoDetalheConteudo />
    </RequireAuth>
  );
}
