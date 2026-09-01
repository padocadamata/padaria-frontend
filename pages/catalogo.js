import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../components/MenuOpcoes';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import { validar as validarProduto, montarPayload as montarPayloadProduto, mensagemErro as mensagemErroProduto } from '../components/catalogo/DadosProdutoForm';
import GerenciarClassificacoesModal from '../components/catalogo/GerenciarClassificacoesModal';
import ConfirmarAcaoModal from '../components/admin/ConfirmarAcaoModal';
import { BotaoIconeAcao, IconeOlho, IconeLapis, IconeCheck, IconeCancelar, IconeLixeira } from '../components/producao/IconesAcoes';
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
// .range(), em vez de uma única consulta (hoje 396 produtos passam numa
// única página de 500, mas o catálogo não pode voltar a depender disso
// silenciosamente se crescer). Ordena por nome + id (desempate estável):
// há nomes duplicados reais no catálogo hoje (ex. "OVO BRANCO" x2), e sem
// um desempate determinístico a paginação por .range() poderia pular ou
// repetir uma linha entre dois lotes quando o Postgres ordenasse o
// empate de forma diferente a cada consulta. A ordenação de EXIBIÇÃO
// (cabeçalho clicável) é uma etapa client-side separada, aplicada depois
// que o conjunto completo já foi carregado — nunca sobre um lote isolado.
//
// secao_id/categoria_id (migration 0028) -- NUNCA mais secao/categoria
// (texto legado): esta página só lê/exibe/filtra/ordena pelas
// classificações estruturadas. O nome exibido vem do estado
// secoes/categorias carregado à parte (catalogo_secoes/catalogo_categorias),
// resolvido via Map -- não via join no Supabase -- assim um rename feito
// no modal "Gerenciar classificações" atualiza a tabela inteira
// automaticamente (o Map é recalculado a cada render), sem precisar
// re-buscar produtos.
async function buscarTodosProdutos(supabase, filtroStatus) {
  const registros = [];
  let inicio = 0;

  for (let lote = 0; lote < MAX_LOTES; lote++) {
    let consulta = supabase
      .from('produtos')
      .select('id, nome, codigo_g3, codigo_barras, secao_id, categoria_id, unidade_medida, ativo')
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

// Comparação de texto para ordenação: vazio/nulo sempre por último,
// independente da direção escolhida (evita que "crescente" jogue todos
// os produtos sem Seção/Categoria pro topo, o que seria confuso). pt-BR
// + sensitivity 'base' trata acentuação/caixa como equivalentes para fins
// de ordenação (Café ~ cafe ~ CAFÉ ficam juntos).
function compararTexto(a, b) {
  const x = (a || '').trim();
  const y = (b || '').trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, 'pt-BR', { sensitivity: 'base' });
}

// 'secaoNome'/'categoriaNome' são campos DERIVADOS (calculados a partir
// de secao_id/categoria_id + o cadastro estruturado), nunca as colunas
// de texto legado -- ver produtosComNomes dentro do componente.
const CAMPOS_TEXTO_ORDENAVEIS = new Set(['nome', 'codigo_g3', 'codigo_barras', 'secaoNome', 'categoriaNome', 'unidade_medida']);

// Ordem coerente para Status: Ativo antes de Inativo no sentido
// crescente -- não há uma ordem "alfabética" natural para um booleano,
// então esta é a convenção explícita adotada (produto habilitado para
// uso é tratado como "menor"/primeiro).
function compararProdutos(a, b, ordenacao) {
  let resultado;

  if (ordenacao.campo === 'ativo') {
    resultado = a.ativo === b.ativo ? 0 : a.ativo ? -1 : 1;
  } else if (CAMPOS_TEXTO_ORDENAVEIS.has(ordenacao.campo)) {
    resultado = compararTexto(a[ordenacao.campo], b[ordenacao.campo]);
  } else {
    resultado = 0;
  }

  return ordenacao.direcao === 'asc' ? resultado : -resultado;
}

function IndicadorOrdenacao({ ativo, direcao }) {
  if (!ativo) return null;
  return <span style={{ marginLeft: '4px' }}>{direcao === 'asc' ? '▲' : '▼'}</span>;
}

function ThOrdenavel({ campo, label, ordenacao, aoClicar, aparencia }) {
  const ativo = ordenacao.campo === campo;
  return (
    <th
      onClick={() => aoClicar(campo)}
      style={{
        padding: '12px',
        textAlign: 'left',
        color: aparencia.corPrimaria,
        fontWeight: 'bold',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title="Clique para ordenar"
    >
      {label}
      <IndicadorOrdenacao ativo={ativo} direcao={ordenacao.direcao} />
    </th>
  );
}

const campoInlineEstilo = {
  width: '100%',
  minWidth: '90px',
  padding: '6px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  boxSizing: 'border-box',
  fontSize: '13px',
};

// Mesmo princípio já usado em mensagemErroReaberturaRecebimento (pages/
// pedidos.js) e mensagemErroExclusaoClassificacao (GerenciarClassificacoesModal.js):
// NUNCA mostrar error.message bruto na UI -- só reconhecer os textos
// EXATOS que a própria RPC excluir_produto_catalogo (migration 0029)
// levanta, e devolver uma mensagem pré-escrita, sem nome de tabela/SQL/
// detalhe interno. Qualquer coisa não reconhecida cai no fallback
// genérico.
function mensagemErroExclusaoProduto(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('ja possui utilizacao no sistema')) {
    return 'Este produto já possui utilização no sistema e não pode ser excluído. Se ele não for mais utilizado, deixe-o como Inativo.';
  }
  if (msg.includes('requer a permissao catalogo_produtos.excluir')) {
    return 'Você não tem permissão para excluir produtos do Catálogo.';
  }
  if (msg.includes('requer sessao autenticada')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (msg.includes('nao encontrado')) {
    return 'Produto não encontrado. Recarregue a página.';
  }
  console.error('Erro ao excluir produto:', error);
  return 'Não foi possível excluir este produto. Tente novamente ou avise um administrador.';
}

async function carregarClassificacoes(supabase) {
  const [{ data: secoesData }, { data: categoriasData }] = await Promise.all([
    supabase.from('catalogo_secoes').select('id, nome').order('nome'),
    supabase.from('catalogo_categorias').select('id, nome').order('nome'),
  ]);
  return { secoes: secoesData || [], categorias: categoriasData || [] };
}

// Listagem do Catálogo de Produtos (public.produtos). Deliberadamente SEM
// nenhuma coluna de preço -- "Não transformar essa página em uma tabela
// de preços" (preço/comparação de preço vive em /catalogo/[id], card
// "Resumo de preços"). Permite ordenar por cabeçalho (client-side, sobre
// o conjunto completo já carregado pelos lotes de buscarTodosProdutos) e
// editar os campos principais direto na linha (nome/código G3/código de
// barras/seção/categoria/unidade/status) sem abrir /catalogo/[id] --
// reaproveita EXATAMENTE validar/montarPayload/mensagemErro de
// DadosProdutoForm, nunca uma segunda implementação da mesma regra.
//
// Seção/Categoria (migration 0028) são classificações ESTRUTURADAS --
// secao_id/categoria_id em produtos, nomes em catalogo_secoes/
// catalogo_categorias. Esta página nunca lê nem escreve mais
// produtos.secao/produtos.categoria (texto legado) -- essas colunas
// continuam existindo no banco só por compatibilidade transitória.
function CatalogoConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();

  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [secoes, setSecoes] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [modalClassificacoesAberto, setModalClassificacoesAberto] = useState(false);

  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [filtroSecaoId, setFiltroSecaoId] = useState('todas');
  const [filtroCategoriaId, setFiltroCategoriaId] = useState('todas');
  const [busca, setBusca] = useState('');

  const [ordenacao, setOrdenacao] = useState({ campo: 'nome', direcao: 'asc' });

  // Edição inline: uma linha por produto.id em edicoes[] entra em modo
  // edição. Múltiplas linhas podem estar em edição ao mesmo tempo -- cada
  // uma com seu próprio estado e seu próprio botão Salvar (sem "Salvar
  // tudo" global).
  const [edicoes, setEdicoes] = useState({});
  const [salvandoId, setSalvandoId] = useState(null);
  const [erroPorId, setErroPorId] = useState({});

  // Exclusão definitiva (SOMENTE via RPC excluir_produto_catalogo,
  // migration 0029) -- nunca .from('produtos').delete(). A RPC bloqueia
  // sozinha quando há qualquer utilização (cotações, pedido_itens,
  // produto_fornecedores, produtos_historico_compras,
  // receita_ingredientes); o frontend nunca decide isso, só chama e
  // traduz o erro se houver.
  const [produtoParaExcluir, setProdutoParaExcluir] = useState(null);
  const [excluindoProduto, setExcluindoProduto] = useState(false);
  const [erroExclusaoProduto, setErroExclusaoProduto] = useState('');

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

  // Classificações carregadas UMA vez, independente do filtro de status
  // dos produtos -- alimentam filtros, selects de edição rápida e o
  // modal "Gerenciar classificações". Recarregadas por completo (não
  // patch local) depois de qualquer criação/renomeação/exclusão no
  // modal, garantindo que a lista nunca fique dessincronizada do banco.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      const supabase = createClient();
      const resultado = await carregarClassificacoes(supabase);
      if (!efeitoAtivo) return;
      setSecoes(resultado.secoes);
      setCategorias(resultado.categorias);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
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

  const secoesPorId = useMemo(() => new Map(secoes.map((s) => [s.id, s])), [secoes]);
  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  // secaoNome/categoriaNome são resolvidos aqui, a cada render -- se uma
  // classificação for renomeada no modal (atualizando secoes/categorias),
  // toda a tabela reflete o novo nome imediatamente, sem re-buscar
  // produtos e sem F5.
  const produtosComNomes = useMemo(
    () =>
      produtos.map((p) => ({
        ...p,
        secaoNome: p.secao_id ? secoesPorId.get(p.secao_id)?.nome || null : null,
        categoriaNome: p.categoria_id ? categoriasPorId.get(p.categoria_id)?.nome || null : null,
      })),
    [produtos, secoesPorId, categoriasPorId]
  );

  const buscaNormalizada = busca.trim().toLowerCase();

  const produtosFiltrados = produtosComNomes.filter((produto) => {
    if (filtroSecaoId !== 'todas' && produto.secao_id !== filtroSecaoId) return false;
    if (filtroCategoriaId !== 'todas' && produto.categoria_id !== filtroCategoriaId) return false;

    if (!buscaNormalizada) return true;

    const nome = (produto.nome || '').toLowerCase();
    const codigoG3 = (produto.codigo_g3 || '').toLowerCase();
    const codigoBarras = (produto.codigo_barras || '').toLowerCase();

    return nome.includes(buscaNormalizada) || codigoG3.includes(buscaNormalizada) || codigoBarras.includes(buscaNormalizada);
  });

  // Ordenação aplicada sobre o resultado JÁ filtrado (não sobre o
  // conjunto bruto) -- funciona em conjunto com os filtros, como pedido.
  const produtosOrdenados = [...produtosFiltrados].sort((a, b) => compararProdutos(a, b, ordenacao));

  const podeEditar = hasPermissao(permissoes, PERMISSOES.CATALOGO_PRODUTOS_EDITAR);
  // Gate SÓ pela permissão -- nunca pelo status ativo/inativo do produto.
  // Produto ativo sem utilização também pode ser excluído; produto
  // inativo com utilização não pode. Quem decide de fato é sempre a RPC
  // (excluir_produto_catalogo), o botão só controla se a AÇÃO aparece.
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.CATALOGO_PRODUTOS_EXCLUIR);

  function alternarOrdenacao(campo) {
    setOrdenacao((atual) => {
      if (atual.campo === campo) {
        return { campo, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' };
      }
      return { campo, direcao: 'asc' };
    });
  }

  function abrirEdicao(produto) {
    setEdicoes((atual) => ({
      ...atual,
      [produto.id]: {
        nome: produto.nome || '',
        codigo_g3: produto.codigo_g3 || '',
        codigo_barras: produto.codigo_barras || '',
        secao_id: produto.secao_id || '',
        categoria_id: produto.categoria_id || '',
        unidade_medida: produto.unidade_medida || '',
        ativo: !!produto.ativo,
      },
    }));
    setErroPorId((atual) => {
      const { [produto.id]: _removido, ...resto } = atual;
      return resto;
    });
  }

  function cancelarEdicao(id) {
    setEdicoes((atual) => {
      const { [id]: _removido, ...resto } = atual;
      return resto;
    });
    setErroPorId((atual) => {
      const { [id]: _removido, ...resto } = atual;
      return resto;
    });
  }

  function atualizarCampoEdicao(id, campo, valor) {
    setEdicoes((atual) => ({ ...atual, [id]: { ...atual[id], [campo]: valor } }));
  }

  // Reaproveita EXATAMENTE validar()/montarPayload()/mensagemErro() de
  // DadosProdutoForm -- a edição inline nunca aceita algo que o
  // formulário individual recusaria, porque é literalmente o mesmo
  // código, não uma reimplementação paralela. montarPayload já envia
  // secao_id/categoria_id (nunca secao/categoria texto) desde a migration
  // 0028 -- ver components/catalogo/DadosProdutoForm.js.
  async function salvarEdicao(id) {
    const dados = edicoes[id];
    const mensagemValidacao = validarProduto(dados);
    if (mensagemValidacao) {
      setErroPorId((atual) => ({ ...atual, [id]: mensagemValidacao }));
      return;
    }

    setSalvandoId(id);
    setErroPorId((atual) => {
      const { [id]: _removido, ...resto } = atual;
      return resto;
    });

    const supabase = createClient();
    const payload = montarPayloadProduto(dados);
    const { error } = await supabase.from('produtos').update(payload).eq('id', id);

    setSalvandoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [id]: mensagemErroProduto(error) }));
      return;
    }

    // Atualiza a linha localmente (mesmo valor que acabou de ser
    // gravado) -- sem F5, sem nova consulta. secaoNome/categoriaNome são
    // recalculados automaticamente no próximo render (produtosComNomes),
    // a partir do novo secao_id/categoria_id. /catalogo/[id] lê a mesma
    // tabela normalmente na próxima vez que for aberto, então mostra
    // exatamente isto.
    setProdutos((atual) => atual.map((p) => (p.id === id ? { ...p, ...payload } : p)));
    cancelarEdicao(id);
  }

  function pedirExclusao(produto) {
    setErroExclusaoProduto('');
    setProdutoParaExcluir(produto);
  }

  function fecharConfirmarExclusao() {
    setProdutoParaExcluir(null);
    setErroExclusaoProduto('');
  }

  // Único caminho de exclusão definitiva: RPC excluir_produto_catalogo
  // (migration 0029) -- SECURITY DEFINER, RPC-only por desenho (nenhuma
  // policy de DELETE existe em produtos). Uma única chamada -- nunca
  // .from('produtos').delete(), nunca apaga dependência, nunca faz
  // ativo=false como contorno de bloqueio.
  async function confirmarExclusaoProduto() {
    setExcluindoProduto(true);
    setErroExclusaoProduto('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_produto_catalogo', { p_produto_id: produtoParaExcluir.id });

    setExcluindoProduto(false);

    if (error) {
      setErroExclusaoProduto(mensagemErroExclusaoProduto(error));
      return;
    }

    // Remove a linha localmente -- sem F5, sem nova consulta. Filtros/
    // ordenação/edições em andamento em outras linhas continuam intactos,
    // mesmo padrão de BlocoClassificacao (GerenciarClassificacoesModal.js).
    setProdutos((atual) => atual.filter((p) => p.id !== produtoParaExcluir.id));
    setProdutoParaExcluir(null);
  }

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

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setModalClassificacoesAberto(true)}
              style={{
                padding: '10px 20px',
                backgroundColor: 'white',
                color: aparencia.corPrimaria,
                border: `1px solid ${aparencia.corPrimaria}`,
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
              }}
            >
              Gerenciar classificações
            </button>

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
                value={filtroSecaoId}
                onChange={(e) => setFiltroSecaoId(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
              >
                <option value="todas">Todas</option>
                {secoes.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Categoria</label>
              <select
                value={filtroCategoriaId}
                onChange={(e) => setFiltroCategoriaId(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
              >
                <option value="todas">Todas</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
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
          ) : produtosOrdenados.length === 0 ? (
            <p style={{ color: '#666' }}>Nenhum produto encontrado.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <ThOrdenavel campo="nome" label="Produto" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <ThOrdenavel campo="codigo_g3" label="Código G3" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <ThOrdenavel campo="codigo_barras" label="Cód. barras" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <ThOrdenavel campo="secaoNome" label="Seção" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <ThOrdenavel campo="categoriaNome" label="Categoria" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <ThOrdenavel campo="unidade_medida" label="Unidade" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <ThOrdenavel campo="ativo" label="Status" ordenacao={ordenacao} aoClicar={alternarOrdenacao} aparencia={aparencia} />
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {produtosOrdenados.map((produto) => {
                  const emEdicao = !!edicoes[produto.id];
                  const dados = edicoes[produto.id];
                  const erroLinha = erroPorId[produto.id];
                  const salvandoEstaLinha = salvandoId === produto.id;

                  return (
                    <Fragment key={produto.id}>
                      <tr
                        style={{ borderBottom: erroLinha ? 'none' : '1px solid #ddd', backgroundColor: emEdicao ? '#fff8e1' : 'transparent' }}
                      >
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <input
                              type="text"
                              value={dados.nome}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'nome', e.target.value)}
                              style={campoInlineEstilo}
                            />
                          ) : (
                            produto.nome
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <input
                              type="text"
                              value={dados.codigo_g3}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'codigo_g3', e.target.value)}
                              placeholder="Opcional"
                              style={campoInlineEstilo}
                            />
                          ) : (
                            produto.codigo_g3 || '—'
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <input
                              type="text"
                              value={dados.codigo_barras}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'codigo_barras', e.target.value)}
                              placeholder="Opcional"
                              style={campoInlineEstilo}
                            />
                          ) : (
                            produto.codigo_barras || '—'
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <select
                              value={dados.secao_id}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'secao_id', e.target.value)}
                              style={campoInlineEstilo}
                            >
                              <option value="">— Nenhuma —</option>
                              {secoes.map((s) => (
                                <option key={s.id} value={s.id}>{s.nome}</option>
                              ))}
                            </select>
                          ) : (
                            produto.secaoNome || '—'
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <select
                              value={dados.categoria_id}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'categoria_id', e.target.value)}
                              style={campoInlineEstilo}
                            >
                              <option value="">— Nenhuma —</option>
                              {categorias.map((c) => (
                                <option key={c.id} value={c.id}>{c.nome}</option>
                              ))}
                            </select>
                          ) : (
                            produto.categoriaNome || '—'
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <input
                              type="text"
                              value={dados.unidade_medida}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'unidade_medida', e.target.value)}
                              placeholder="kg, un, pacote..."
                              style={campoInlineEstilo}
                            />
                          ) : (
                            produto.unidade_medida || '—'
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {emEdicao ? (
                            <select
                              value={dados.ativo ? 'ativo' : 'inativo'}
                              onChange={(e) => atualizarCampoEdicao(produto.id, 'ativo', e.target.value === 'ativo')}
                              style={campoInlineEstilo}
                            >
                              <option value="ativo">Ativo</option>
                              <option value="inativo">Inativo</option>
                            </select>
                          ) : (
                            <BadgeStatus ativo={produto.ativo} />
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {emEdicao ? (
                              <>
                                <BotaoIconeAcao
                                  rotulo="Salvar"
                                  icone={IconeCheck}
                                  cor="#4CAF50"
                                  disabled={salvandoEstaLinha}
                                  onClick={() => salvarEdicao(produto.id)}
                                />
                                <BotaoIconeAcao
                                  rotulo="Cancelar"
                                  icone={IconeCancelar}
                                  disabled={salvandoEstaLinha}
                                  onClick={() => cancelarEdicao(produto.id)}
                                />
                              </>
                            ) : (
                              <>
                                <BotaoIconeAcao
                                  rotulo="Visualizar"
                                  icone={IconeOlho}
                                  onClick={() => router.push(`/catalogo/${produto.id}`)}
                                />
                                {podeEditar && (
                                  <BotaoIconeAcao
                                    rotulo="Editar"
                                    icone={IconeLapis}
                                    cor={aparencia.corPrimaria}
                                    onClick={() => abrirEdicao(produto)}
                                  />
                                )}
                                {podeExcluir && (
                                  <BotaoIconeAcao
                                    rotulo="Excluir"
                                    icone={IconeLixeira}
                                    destrutivo
                                    onClick={() => pedirExclusao(produto)}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {erroLinha && (
                        <tr style={{ borderBottom: '1px solid #ddd' }}>
                          <td colSpan={8} style={{ padding: '0 12px 10px 12px', backgroundColor: '#fff8e1' }}>
                            <span style={{ color: '#f44336', fontSize: '13px' }}>{erroLinha}</span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <GerenciarClassificacoesModal
        aberto={modalClassificacoesAberto}
        onFechar={() => setModalClassificacoesAberto(false)}
        secoes={secoes}
        categorias={categorias}
        podeEditar={podeEditar}
        corPrimaria={aparencia.corPrimaria}
        aoAtualizarSecoes={setSecoes}
        aoAtualizarCategorias={setCategorias}
      />

      {produtoParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir produto"
          corPrimaria={aparencia.corPrimaria}
          perigo
          confirmando={excluindoProduto}
          erro={erroExclusaoProduto}
          textoConfirmar="Excluir"
          mensagem={
            <>
              Deseja excluir definitivamente o produto <strong>{produtoParaExcluir.nome}</strong>? Esta ação deve ser
              usada somente para cadastros realizados por engano e não poderá ser desfeita. Produtos que já possuem
              utilização no sistema não podem ser excluídos.
            </>
          }
          onConfirmar={confirmarExclusaoProduto}
          onCancelar={fecharConfirmarExclusao}
        />
      )}
    </div>
  );
}

export default function Catalogo() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR}>
      <CatalogoConteudo />
    </RequireAuth>
  );
}
