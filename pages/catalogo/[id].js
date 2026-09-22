import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import DadosProdutoForm from '../../components/catalogo/DadosProdutoForm';
import FornecedoresDoProduto from '../../components/catalogo/FornecedoresDoProduto';
import HistoricoComprasDoProduto from '../../components/catalogo/HistoricoComprasDoProduto';
import ResumoPrecos from '../../components/catalogo/ResumoPrecos';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import estilos from '../../components/catalogo/catalogo.module.css';

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
          .select('id, fornecedor_id, unidade_comercial, apresentacao, quantidade_embalagem, codigo_produto_fornecedor, observacao, ativo, controla_sacos_fechados, peso_por_saco_kg')
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
    return (
      <PageShell titulo="Catálogo">
        <p className={estilos.carregando} role="status">Carregando…</p>
      </PageShell>
    );
  }

  if (erroCarga || !produto) {
    return (
      <PageShell titulo="Catálogo">
        <Alert tom="danger" className={estilos.mensagem}>{erroCarga || 'Produto não encontrado.'}</Alert>
        <Button onClick={() => router.push('/catalogo')}>Voltar</Button>
      </PageShell>
    );
  }

  const fornecedoresAtivos = fornecedores.filter((f) => f.ativo).map((f) => ({ id: f.id, nome: nomeExibicaoFornecedor(f) }));
  const fornecedoresPorId = Object.fromEntries(fornecedores.map((f) => [f.id, nomeExibicaoFornecedor(f)]));
  const configuracoesAtivas = configuracoes.filter((c) => c.ativo);

  return (
    <PageShell titulo={produto.nome}>
      <PageHeader
        titulo={produto.nome}
        acoes={
          <Button variante="secondary" onClick={() => router.push('/catalogo')}>
            ← Voltar para o catálogo
          </Button>
        }
      />

      <div className={estilos.cards}>
        <Card titulo="Dados do produto">
          <DadosProdutoForm produto={produto} podeEditar={podeEditar} onSalvo={recarregar} />
        </Card>

        <Card>
          <ResumoPrecos resumo={resumo} fornecedoresPorId={fornecedoresPorId} unidadeBase={produto.unidade_medida} />
        </Card>

        <Card>
          <FornecedoresDoProduto
            produtoId={produto.id}
            produtoUnidadeMedida={produto.unidade_medida}
            configuracoes={configuracoes}
            fornecedoresAtivos={fornecedoresAtivos}
            podeEditar={podeEditar}
            onRecarregar={recarregar}
          />
        </Card>

        <Card>
          <HistoricoComprasDoProduto
            produtoId={produto.id}
            lancamentos={lancamentos}
            configuracoesComerciais={configuracoesAtivas}
            fornecedoresAtivos={fornecedoresAtivos}
            podeEditar={podeEditar}
            onRecarregar={recarregar}
          />
        </Card>
      </div>
    </PageShell>
  );
}

export default function ProdutoDetalhe() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR}>
      <ProdutoDetalheConteudo />
    </RequireAuth>
  );
}
