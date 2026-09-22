import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../components/RequireAuth';
import { validar as validarProduto, montarPayload as montarPayloadProduto, mensagemErro as mensagemErroProduto, mensagemErroProducao } from '../components/catalogo/DadosProdutoForm';
import GerenciarClassificacoesModal from '../components/catalogo/GerenciarClassificacoesModal';
import ConfirmarAcaoModal from '../components/admin/ConfirmarAcaoModal';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import AcoesLinha from '../components/ui/AcoesLinha';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';
import Field from '../components/ui/Field';
import FilterBar from '../components/ui/FilterBar';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Paginacao, { paginarLista } from '../components/Paginacao';
import estilos from '../components/catalogo/catalogo.module.css';
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
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

// Só indicador -- nunca um toggle. Ativação/desativação de Produto de
// Produção acontece exclusivamente em DadosProdutoForm (dentro de
// /catalogo/[id]), nunca aqui -- ver decisão da rodada de unificação
// Catálogo x Produção (não criar uma terceira rota de escrita).
function BadgeProducao({ ativo }) {
  return <Badge tom={ativo ? 'info' : 'neutral'}>{ativo ? 'Em Produção' : 'Fora de Produção'}</Badge>;
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

function CabecalhoOrdenavel({ campo, label, ordenacao, aoClicar }) {
  const ativo = ordenacao.campo === campo;
  return (
    <button type="button" className={estilos.cabecalhoOrdenavel} onClick={() => aoClicar(campo)} title="Clique para ordenar">
      {label}
      {ativo && <span aria-hidden="true">{ordenacao.direcao === 'asc' ? ' ▲' : ' ▼'}</span>}
    </button>
  );
}

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

  // Estado REAL de "Produto de Produção" por produto, para o badge da
  // listagem -- Map(catalogo_produto_id -> {id, ativo}). Carregado uma
  // vez (mesmo padrão de secoes/categorias abaixo), não por linha.
  const [producaoPorProdutoId, setProducaoPorProdutoId] = useState(new Map());

  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [filtroSecaoId, setFiltroSecaoId] = useState('todas');
  const [filtroCategoriaId, setFiltroCategoriaId] = useState('todas');
  const [busca, setBusca] = useState('');
  // Página da lista (paginação VISUAL, 20 por página, aplicada DEPOIS de
  // filtros/busca/ordenação -- mesmo padrão de pages/fornecedores.js).
  const [pagina, setPagina] = useState(1);

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

  // Idem -- carregado uma vez, independente do filtro de status dos
  // produtos (precisamos saber o estado de Produção mesmo para produtos
  // fora da página filtrada atual, e o volume de receitas é pequeno).
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarProducao() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('receitas')
        .select('id, catalogo_produto_id, ativo')
        .not('catalogo_produto_id', 'is', null);

      if (!efeitoAtivo) return;

      if (error) {
        console.error('Erro ao carregar estado de Produto de Produção:', error);
        return;
      }

      setProducaoPorProdutoId(
        new Map((data || []).map((r) => [r.catalogo_produto_id, { id: r.id, ativo: r.ativo }]))
      );
    }

    carregarProducao();
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
      produtos.map((p) => {
        const receita = producaoPorProdutoId.get(p.id);
        return {
          ...p,
          secaoNome: p.secao_id ? secoesPorId.get(p.secao_id)?.nome || null : null,
          categoriaNome: p.categoria_id ? categoriasPorId.get(p.categoria_id)?.nome || null : null,
          // Defesa em profundidade: só conta como "em Produção" com o
          // produto mestre ativo E a extensão ativa, nunca só a extensão.
          producaoAtiva: !!p.ativo && !!receita?.ativo,
        };
      }),
    [produtos, secoesPorId, categoriasPorId, producaoPorProdutoId]
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

  // Paginação VISUAL (client-side, 20 por página): a lista já vem inteira
  // do banco (filtro de Status na consulta; Seção/Categoria/Buscar no
  // navegador) e aqui só se fatia o resultado já filtrado e ordenado.
  // Tabela (desktop) e cartões (mobile) recebem exatamente este mesmo
  // subconjunto -- mesmo padrão de pages/fornecedores.js.
  const paginacao = paginarLista(produtosOrdenados, pagina);
  const paginaAtual = paginacao.paginaAtual;

  // Qualquer mudança de filtro/busca volta para a página 1.
  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  // Resultado encolheu (filtro, exclusão, recarga): corrige a página guardada.
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  const quantidadeFiltrosAtivos = [
    filtroStatus !== 'ativos',
    filtroSecaoId !== 'todas',
    filtroCategoriaId !== 'todas',
    busca !== '',
  ].filter(Boolean).length;

  // Volta aos valores iniciais da tela (Status = Ativos, demais em "todas"/vazio).
  function limparFiltros() {
    setFiltroStatus('ativos');
    setFiltroSecaoId('todas');
    setFiltroCategoriaId('todas');
    setBusca('');
    setPagina(1);
  }

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

    // Transição ativo -> inativo com extensão de Produção ativa: DESMARCA
    // primeiro (nunca o inverso). Essa ordem garante que o estado proibido
    // (produto inativo + extensão ativa) nunca é alcançável, mesmo sob
    // falha parcial -- se desmarcar falhar, aborta aqui, sem tocar em
    // produtos; se desmarcar funcionar e o UPDATE abaixo falhar, o estado
    // resultante (produto ainda ativo + Produção já desmarcada) é válido,
    // não precisa de nenhuma reversão.
    const produtoOriginal = produtos.find((p) => p.id === id);
    const estaInativando = produtoOriginal?.ativo === true && payload.ativo === false;
    const receitaVinculada = producaoPorProdutoId.get(id);

    if (estaInativando && receitaVinculada?.ativo) {
      const { error: erroDesmarcar } = await supabase
        .rpc('desmarcar_produto_producao', { p_produto_id: id })
        .single();

      if (erroDesmarcar) {
        setSalvandoId(null);
        setErroPorId((atual) => ({
          ...atual,
          [id]: `Não foi possível inativar: falha ao desmarcar Produto de Produção primeiro. ${mensagemErroProducao(erroDesmarcar)}`,
        }));
        return;
      }

      setProducaoPorProdutoId((atual) => {
        const novo = new Map(atual);
        novo.set(id, { ...receitaVinculada, ativo: false });
        return novo;
      });
    }

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

  // UMA definição de colunas para a tabela (desktop) e os cartões
  // (mobile) -- mesmo padrão de pages/fornecedores.js. Cada `render` olha
  // `edicoes[produto.id]` para decidir entre texto e campo editável: a
  // MESMA função atende os dois modos, nunca duas implementações
  // divergentes.
  const colunas = [
    {
      chave: 'nome',
      rotulo: <CabecalhoOrdenavel campo="nome" label="Produto" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      mobile: 'titulo',
      cartaoOrdem: 0,
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return produto.nome;
        return (
          <Input
            type="text"
            value={dados.nome}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'nome', e.target.value)}
            className={estilos.campoInline}
            aria-label="Nome do produto"
          />
        );
      },
    },
    {
      chave: 'ativo',
      rotulo: <CabecalhoOrdenavel campo="ativo" label="Status" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      mobile: 'titulo',
      cartaoOrdem: 1,
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return <BadgeStatus ativo={produto.ativo} />;
        return (
          <Select
            value={dados.ativo ? 'ativo' : 'inativo'}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'ativo', e.target.value === 'ativo')}
            className={estilos.campoInline}
            aria-label="Status do produto"
          >
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </Select>
        );
      },
    },
    {
      chave: 'codigo_g3',
      rotulo: <CabecalhoOrdenavel campo="codigo_g3" label="Código G3" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      soCartao: true, // some da tabela desktop (simplificação pedida); continua nos cartões mobile, na busca, no cadastro e no detalhe
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return produto.codigo_g3 || '—';
        return (
          <Input
            type="text"
            value={dados.codigo_g3}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'codigo_g3', e.target.value)}
            placeholder="Opcional"
            className={estilos.campoInline}
            aria-label="Código G3"
          />
        );
      },
    },
    {
      chave: 'codigo_barras',
      rotulo: <CabecalhoOrdenavel campo="codigo_barras" label="Cód. barras" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      soCartao: true, // some da tabela desktop (simplificação pedida); continua nos cartões mobile, na busca, no cadastro e no detalhe
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return produto.codigo_barras || '—';
        return (
          <Input
            type="text"
            value={dados.codigo_barras}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'codigo_barras', e.target.value)}
            placeholder="Opcional"
            className={estilos.campoInline}
            aria-label="Código de barras"
          />
        );
      },
    },
    {
      chave: 'secaoNome',
      rotulo: <CabecalhoOrdenavel campo="secaoNome" label="Seção" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return produto.secaoNome || '—';
        return (
          <Select
            value={dados.secao_id}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'secao_id', e.target.value)}
            className={estilos.campoInline}
            aria-label="Seção"
          >
            <option value="">— Nenhuma —</option>
            {secoes.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </Select>
        );
      },
    },
    {
      chave: 'categoriaNome',
      rotulo: <CabecalhoOrdenavel campo="categoriaNome" label="Categoria" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return produto.categoriaNome || '—';
        return (
          <Select
            value={dados.categoria_id}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'categoria_id', e.target.value)}
            className={estilos.campoInline}
            aria-label="Categoria"
          >
            <option value="">— Nenhuma —</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        );
      },
    },
    {
      chave: 'unidade_medida',
      rotulo: <CabecalhoOrdenavel campo="unidade_medida" label="Unidade" ordenacao={ordenacao} aoClicar={alternarOrdenacao} />,
      render: (produto) => {
        const dados = edicoes[produto.id];
        if (!dados) return produto.unidade_medida || '—';
        return (
          <Input
            type="text"
            value={dados.unidade_medida}
            onChange={(e) => atualizarCampoEdicao(produto.id, 'unidade_medida', e.target.value)}
            placeholder="kg, un, pacote..."
            className={estilos.campoInline}
            aria-label="Unidade"
          />
        );
      },
    },
    {
      chave: 'producao',
      rotulo: 'Produção',
      render: (produto) => <BadgeProducao ativo={produto.producaoAtiva} />,
    },
  ];

  function acoesDaLinha(produto) {
    const emEdicao = !!edicoes[produto.id];
    const salvandoEstaLinha = salvandoId === produto.id;

    if (emEdicao) {
      return [
        { chave: 'salvar', rotulo: 'Salvar', icone: 'check', desabilitado: salvandoEstaLinha, onClick: () => salvarEdicao(produto.id), primaria: true },
        { chave: 'cancelar', rotulo: 'Cancelar', icone: 'undo', desabilitado: salvandoEstaLinha, onClick: () => cancelarEdicao(produto.id) },
      ];
    }

    return [
      { chave: 'visualizar', rotulo: 'Visualizar', icone: 'eye', onClick: () => router.push(`/catalogo/${produto.id}`), primaria: true },
      podeEditar && { chave: 'editar', rotulo: 'Editar', icone: 'pencil', onClick: () => abrirEdicao(produto) },
      podeExcluir && { chave: 'excluir', rotulo: 'Excluir', icone: 'trash', destrutivo: true, onClick: () => pedirExclusao(produto) },
    ];
  }

  return (
    <PageShell titulo="Catálogo">
      <PageHeader
        titulo="Catálogo"
        subtitulo="Cadastro mestre de produtos comprados — nome, códigos, seção/categoria e unidade-base. Fornecedores e histórico de compras ficam na página de cada produto."
        acoes={
          <>
            <Button variante="secondary" onClick={() => setModalClassificacoesAberto(true)}>
              Gerenciar classificações
            </Button>
            {podeEditar && (
              <Button icone="plus" onClick={() => router.push('/catalogo/novo')}>
                Novo produto
              </Button>
            )}
          </>
        }
      />

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Buscar">
          <Input
            type="text"
            value={busca}
            onChange={(e) => alterarFiltro(setBusca)(e.target.value)}
            placeholder="Nome, código G3 ou código de barras"
          />
        </Field>
        <Field label="Status">
          <Select value={filtroStatus} onChange={(e) => alterarFiltro(setFiltroStatus)(e.target.value)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
        <Field label="Seção">
          <Select value={filtroSecaoId} onChange={(e) => alterarFiltro(setFiltroSecaoId)(e.target.value)}>
            <option value="todas">Todas</option>
            {secoes.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </Select>
        </Field>
        <Field label="Categoria">
          <Select value={filtroCategoriaId} onChange={(e) => alterarFiltro(setFiltroCategoriaId)(e.target.value)}>
            <option value="todas">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      {carregando ? (
        <p role="status">Carregando produtos...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : produtos.length === 0 ? (
        <EmptyState>Nenhum produto encontrado.</EmptyState>
      ) : produtosOrdenados.length === 0 ? (
        <EmptyState>Nenhum resultado para esta busca/filtro.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Catálogo de produtos"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(produto) => produto.id}
            destaque={(produto) => (produto.ativo ? null : 'inativo')}
            cartoesAte={1180}
            linhaExtra={(produto) => (erroPorId[produto.id] ? <p className={estilos.linhaErro}>{erroPorId[produto.id]}</p> : null)}
            renderAcoes={(produto, { cartao }) => <AcoesLinha acoes={acoesDaLinha(produto)} cartao={cartao} />}
          />

          <p className={estilos.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}{' '}
            {paginacao.total === 1 ? 'produto' : 'produtos'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </div>
      )}

      <GerenciarClassificacoesModal
        aberto={modalClassificacoesAberto}
        onFechar={() => setModalClassificacoesAberto(false)}
        secoes={secoes}
        categorias={categorias}
        podeEditar={podeEditar}
        aoAtualizarSecoes={setSecoes}
        aoAtualizarCategorias={setCategorias}
      />

      {produtoParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir produto"
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
          modalDS
        />
      )}
    </PageShell>
  );
}

export default function Catalogo() {
  return (
    <RequireAuth permissao={PERMISSOES.CATALOGO_PRODUTOS_VISUALIZAR}>
      <CatalogoConteudo />
    </RequireAuth>
  );
}
