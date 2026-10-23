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
import { useOrdenacao } from '../lib/ordenacao/useOrdenacao';
import { ordenarOpcoes } from '../lib/ordenacao/opcoes';
import { buscarMenorPrecoJanela, unidadeDoMenorPreco } from '../lib/pedidos/menorPreco';
import { formatarPrecoBase } from '../lib/pedidos/historicoCompras';
import { useAuth } from '../hooks/useAuth';

const AJUDA_MENOR_PRECO = 'Menor preço comparável dos últimos 3 meses';

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
// Compacto: o selo só aparece para quem ESTÁ em Produção; fora dela, um
// traço discreto (mesma regra producaoAtiva de antes, só a apresentação mudou).
function BadgeProducao({ ativo }) {
  if (ativo) return <Badge tom="info">Em produção</Badge>;
  return (
    <span className={estilos.discreto} title="Fora de Produção" aria-label="Fora de Produção">
      —
    </span>
  );
}

// Célula "Menor preço (3 meses)" -- somente leitura (inclusive em edição),
// três estados distintos: carregando (…), falha (Indisponível -- nunca "—",
// que significaria "sem histórico") e sem compra comparável na janela (—).
// A unidade é a da compra vencedora (snapshot unidade_base_no_momento),
// nunca convertida; divergência com o cadastro atual é avisada.
function CelulaMenorPreco({ produto, menorPreco }) {
  if (menorPreco.estado === 'carregando') {
    return (
      <span className={estilos.discreto} role="status" aria-label="Carregando menor preço">
        …
      </span>
    );
  }
  if (menorPreco.estado === 'erro') {
    return (
      <span className={estilos.discreto} title="Não foi possível carregar o histórico de preços.">
        Indisponível
      </span>
    );
  }

  const menor = menorPreco.mapa.get(produto.id);
  if (!menor) {
    return (
      <span className={estilos.discreto} title="Nenhuma compra comparável nos últimos 3 meses" aria-label="Sem histórico nos últimos 3 meses">
        —
      </span>
    );
  }

  const { unidade, unidadeAtual, divergente, unidadesMistas } = unidadeDoMenorPreco(menor, produto.unidade_medida);

  return (
    <div className={estilos.menorPreco}>
      <span className={estilos.menorPrecoValor}>{formatarPrecoBase(menor.precoBase, unidade)}</span>
      <span className={estilos.menorPrecoFornecedor}>
        {menor.fornecedor || 'Fornecedor não identificado'}
        {menor.fornecedorAtivo === false && <span className={estilos.discreto}> (inativo)</span>}
      </span>
      {divergente && (
        <span
          className={estilos.menorPrecoAviso}
          title={`O preço foi registrado por ${unidade}; o cadastro atual do produto usa ${unidadeAtual}. Nenhuma conversão é feita.`}
        >
          Unidade da compra: {unidade} (cadastro: {unidadeAtual})
        </span>
      )}
      {!divergente && unidadesMistas && (
        <span
          className={estilos.menorPrecoAviso}
          title={`Compras da janela em unidades diferentes: ${menor.unidadesNaJanela.join(', ')}. Nenhuma conversão é feita.`}
        >
          Compras em unidades diferentes
        </span>
      )}
    </div>
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

  // 23001/23503: o banco recusou por chave estrangeira (ex.: produto usado em
  // encomenda, migration 0071 -- encomendas_itens.produto_id ON DELETE
  // RESTRICT). Mesmo significado da checagem explícita da RPC.
  if (msg.includes('ja possui utilizacao no sistema') || error.code === '23001' || error.code === '23503') {
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

// Listagem do Catálogo de Produtos (public.produtos). Única informação de
// preço da listagem: "Menor preço (3 meses)" + fornecedor, pela MESMA regra
// de Pedidos > Solicitações (lib/pedidos/menorPreco.js, frente 2026-10-23,
// revendo a decisão anterior de não ter preço aqui). Comparação/histórico
// completo continuam em /catalogo/[id], card "Resumo de preços". Permite
// ordenar por cabeçalho (client-side, sobre
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

  // Menor preço (3 meses) de TODOS os produtos -- regra única de
  // lib/pedidos/menorPreco.js (a mesma de Pedidos > Solicitações). Uma
  // leitura em lotes da janela inteira, carregada UMA vez: filtros,
  // busca, ordenação e paginação são todos no navegador e não disparam
  // nova consulta. Falha aqui nunca bloqueia o resto do Catálogo.
  const [menorPreco, setMenorPreco] = useState({ estado: 'carregando', mapa: new Map() });

  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [filtroSecaoId, setFiltroSecaoId] = useState('todas');
  const [filtroCategoriaId, setFiltroCategoriaId] = useState('todas');
  const [busca, setBusca] = useState('');
  // Página da lista (paginação VISUAL, 20 por página, aplicada DEPOIS de
  // filtros/busca/ordenação -- mesmo padrão de pages/fornecedores.js).
  const [pagina, setPagina] = useState(1);

  // Ordenação do cabeçalho (lib/ordenacao): estado local, nunca salvo. O
  // Catálogo sempre abriu ordenado por Produto A → Z com a seta visível --
  // `inicial` preserva isso. Ativo antes de Inativo no crescente; Seção /
  // Categoria pelos nomes DERIVADOS (Seção, depois Categoria), sem Seção no fim.
  const ordenacao = useOrdenacao({ inicial: { chave: 'nome', direcao: 'asc' }, aoMudar: () => setPagina(1) });

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
      setSecoes(ordenarOpcoes(resultado.secoes));
      setCategorias(ordenarOpcoes(resultado.categorias));
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

  // Sem dependência de filtroStatus: a janela de preços vale para qualquer
  // recorte da lista (o Map é consultado por produto.id a cada render).
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarMenorPreco() {
      try {
        const { mapa, error } = await buscarMenorPrecoJanela(createClient());
        if (!efeitoAtivo) return;
        if (error) {
          console.error('Erro ao carregar menor preço (3 meses) do Catálogo:', error);
          setMenorPreco({ estado: 'erro', mapa: new Map() });
          return;
        }
        setMenorPreco({ estado: 'pronto', mapa });
      } catch (error) {
        if (!efeitoAtivo) return;
        console.error('Erro ao carregar menor preço (3 meses) do Catálogo:', error);
        setMenorPreco({ estado: 'erro', mapa: new Map() });
      }
    }

    carregarMenorPreco();
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

  // Qualquer mudança de filtro/busca volta para a página 1.
  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

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

  // Selects de Seção/Categoria da edição em linha -- os MESMOS na coluna
  // combinada da tabela e nos pares separados dos cartões.
  function renderSecao(produto) {
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
  }

  function renderCategoria(produto) {
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
  }

  // UMA definição de colunas para a tabela (desktop) e os cartões
  // (mobile) -- mesmo padrão de pages/fornecedores.js. Cada `render` olha
  // `edicoes[produto.id]` para decidir entre texto e campo editável: a
  // MESMA função atende os dois modos, nunca duas implementações
  // divergentes.
  const colunas = [
    {
      chave: 'nome',
      rotulo: 'Produto',
      ordenavel: true,
      mobile: 'titulo',
      cartaoOrdem: 0,
      // Nome nunca truncado: quebra em quantas linhas precisar.
      minLargura: 220,
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
      rotulo: 'Status',
      ordenavel: { tipo: 'booleano', valor: (produto) => produto.ativo },
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
      rotulo: 'Código G3',
      ordenavel: true,
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
      rotulo: 'Cód. barras',
      ordenavel: true,
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
    // Seção / Categoria: UMA coluna visual na tabela (Seção em cima,
    // Categoria embaixo; na edição, os dois selects empilhados). Ordenação
    // explícita: pela Seção (A → Z / Z → A); dentro da mesma Seção, pela
    // Categoria no mesmo sentido; produto sem Seção vai para o fim nos dois
    // sentidos (convenção de vazios do sistema). Nos cartões continuam
    // dois pares separados (secaoNome/categoriaNome, soCartao) -- sem
    // ordenação própria, para o "Ordenar por" não oferecer o mesmo critério
    // duas vezes.
    {
      chave: 'classificacao',
      rotulo: 'Seção / Categoria',
      ordenavel: {
        valor: (produto) => (produto.secaoNome ? `${produto.secaoNome} › ${produto.categoriaNome || ''}` : null),
      },
      mobile: 'oculta',
      minLargura: 150,
      render: (produto) => {
        if (edicoes[produto.id]) {
          return (
            <div className={estilos.empilhado}>
              {renderSecao(produto)}
              {renderCategoria(produto)}
            </div>
          );
        }
        return (
          <div className={estilos.empilhado}>
            <span>{produto.secaoNome || '—'}</span>
            <span className={estilos.secundario}>{produto.categoriaNome || '—'}</span>
          </div>
        );
      },
    },
    {
      chave: 'secaoNome',
      rotulo: 'Seção',
      soCartao: true,
      render: renderSecao,
    },
    {
      chave: 'categoriaNome',
      rotulo: 'Categoria',
      soCartao: true,
      render: renderCategoria,
    },
    {
      chave: 'unidade_medida',
      rotulo: 'Unidade',
      ordenavel: true,
      alinhar: 'centro',
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
      ordenavel: { tipo: 'booleano', valor: (produto) => produto.producaoAtiva },
      semQuebra: true,
      render: (produto) => <BadgeProducao ativo={produto.producaoAtiva} />,
    },
    // Somente leitura sempre (inclusive com a linha em edição). Ordena pelo
    // preço-base (vazios -- sem histórico/carregando/falha -- no fim).
    {
      chave: 'menorPreco',
      rotulo: 'Menor preço (3 meses)',
      ajuda: AJUDA_MENOR_PRECO,
      ordenavel: { tipo: 'moeda', valor: (produto) => menorPreco.mapa.get(produto.id)?.precoBase ?? null },
      minLargura: 150,
      cartaoLargo: true,
      render: (produto) => <CelulaMenorPreco produto={produto} menorPreco={menorPreco} />,
    },
  ];

  // Ordenação aplicada sobre o resultado JÁ filtrado (nunca sobre o conjunto
  // bruto) e ANTES da paginação VISUAL (client-side, 20 por página): a lista
  // já vem inteira do banco (em lotes; filtro de Status na consulta; Seção/
  // Categoria/Buscar no navegador). Tabela (desktop) e cartões (mobile)
  // recebem exatamente este mesmo subconjunto.
  const produtosOrdenados = ordenacao.ordenar(produtosFiltrados, colunas);
  const paginacao = paginarLista(produtosOrdenados, pagina);
  const paginaAtual = paginacao.paginaAtual;

  // Resultado encolheu (filtro, exclusão, recarga): corrige a página guardada.
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

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
        subtitulo="Cadastro mestre de produtos comprados — nome, códigos, seção/categoria e unidade-base. Menor preço dos últimos 3 meses na lista; fornecedores e histórico completo na página de cada produto."
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
          {menorPreco.estado === 'erro' && (
            <p className={estilos.avisoPrecos} role="status">
              Não foi possível carregar o menor preço (3 meses) agora. O restante do catálogo funciona normalmente.
            </p>
          )}
          <DataTable
            rotulo="Catálogo de produtos"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(produto) => produto.id}
            destaque={(produto) => (produto.ativo ? null : 'inativo')}
            cartoesAte={1180}
            ordenacao={ordenacao.props}
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
