import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import PaginaProducao from '../../components/producao/PaginaProducao';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import FilterBar from '../../components/ui/FilterBar';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import estilos from '../../components/producao/producao.module.css';
import ReceitaProducaoForm from '../../components/producao/ReceitaProducaoForm';
import GerenciarClassificacoesProducaoModal from '../../components/producao/GerenciarClassificacoesProducaoModal';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { APARENCIA_FIXA } from '../../lib/branding/tema';
import Paginacao, { paginarLista } from '../../components/Paginacao';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';
import { useFiltrosPersistidos, useSanearFiltros } from '../../lib/filtros/useFiltrosPersistidos';
import { FILTROS_PRODUCAO_PRODUTOS, regrasSaneamentoProducaoProdutos } from '../../lib/filtros/telas';
import { ordenarOpcoes } from '../../lib/ordenacao/opcoes';

function formatarRendimento(quantidade, unidade) {
  if (quantidade == null || !unidade) {
    return '—';
  }

  return `${quantidade} ${unidade}`;
}

function BadgeAtivo({ ativo }) {
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

function BadgeTelaHoje({ naTelaHoje }) {
  return <Badge tom={naTelaHoje ? 'info' : 'neutral'}>{naTelaHoje ? 'Na Tela Hoje' : 'Fora da Tela Hoje'}</Badge>;
}

function ProdutosProducaoConteudo() {
  const router = useRouter();
  // Migration 0016: escrita em receitas/receita_ingredientes passou de
  // is_admin() puro para has_permissao('produtos_producao.editar') — a RLS
  // já protege isso; este gate é só a UX correspondente.
  const { permissoes } = useAuth();
  const podeEscrever = hasPermissao(permissoes, PERMISSOES.PRODUTOS_PRODUCAO_EDITAR);

  const [receitas, setReceitas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Busca/Status/Tela Hoje/Tipo/Grupo persistidos durante a sessão de
  // login (lib/filtros).
  const filtros = useFiltrosPersistidos('producao.produtos', FILTROS_PRODUCAO_PRODUTOS);
  const [pagina, setPagina] = useState(1);
  // Ordenação do cabeçalho, guardada durante a sessão de login; mudar volta para a página 1.
  const ordenacao = useOrdenacao({ aoMudar: () => setPagina(1), persistirEm: 'producao.produtos' });

  const [modalAberto, setModalAberto] = useState(false);
  const [receitaEmEdicao, setReceitaEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  // Gerenciar Classificações (migration 0036): cadastro estruturado de
  // Tipo/Grupo de Produção, separado da unificação Catálogo x Produção.
  const [tiposProducao, setTiposProducao] = useState([]);
  const [gruposProducao, setGruposProducao] = useState([]);
  // Só com tipos E grupos carregados SEM erro um Tipo/Grupo salvo pode ser
  // considerado inexistente (saneamento do filtro persistido).
  const [classificacoesProntas, setClassificacoesProntas] = useState(false);
  const [modalClassificacoesAberto, setModalClassificacoesAberto] = useState(false);
  const [classificacoesTick, setClassificacoesTick] = useState(0);

  const aparencia = APARENCIA_FIXA;

  // Unificação Catálogo x Produção (migration 0034/0035): esta tela não
  // é mais um cadastro independente -- lista SOMENTE extensões vinculadas
  // a um produto do Catálogo, via embed forward `produtos!inner(...)`
  // (mesma sintaxe de relacionamento já usada em pages/producao/
  // expositores.js: producao_registros.select('..., receitas!inner(...)')).
  // `!inner` também exclui, sozinho, qualquer receita sem
  // catalogo_produto_id (não deveria existir nenhuma após a 0034, mas é
  // defensivo). Nome/código exibidos vêm de produtos (identidade mestre),
  // nunca mais de receitas.nome/receitas.codigo_g3 (snapshot legado,
  // preservado no banco mas não lido por esta tela).
  //
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
          'id, catalogo_produto_id, tipo, grupo, descricao, temp_forno_celsius, tempo_coccao_minutos, tempo_fermentacao_natural_horas, tempo_fermentacao_climatica_horas, ativo, controlado_producao, rendimento_quantidade, unidade_medida_saida, controlar_expositor, prazo_expositor_dias, produtos!inner(id, nome, codigo_g3, ativo)'
        );

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error('Erro ao carregar receitas:', error);
        setErro('Não foi possível carregar a lista de produtos de Produção.');
        setReceitas([]);
      } else {
        // Ordenado no cliente por produtos.nome -- ordenar por coluna de
        // uma relação embutida via .order({foreignTable}) não tem nenhum
        // precedente no projeto; ordenar aqui é mais simples e seguro.
        const ordenado = [...(data || [])].sort((a, b) =>
          (a.produtos?.nome || '').localeCompare(b.produtos?.nome || '', 'pt-BR', { sensitivity: 'base' })
        );
        setReceitas(ordenado);
      }

      setCarregando(false);
    }

    carregarReceitas();

    return () => {
      efeitoAtivo = false;
    };
  }, [recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);

    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  // Carrega producao_tipos/producao_grupos (migration 0036) -- inclui
  // ativos e inativos: o modal de gerenciamento precisa listar os dois, e
  // ReceitaProducaoForm precisa enxergar um valor inativo já em uso pela
  // receita em edição (regra "(inativo)" -- nunca troca silenciosamente).
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarClassificacoes() {
      const supabase = createClient();

      const [{ data: tipos, error: erroTipos }, { data: grupos, error: erroGrupos }] = await Promise.all([
        supabase.from('producao_tipos').select('valor, ativo').order('valor'),
        supabase.from('producao_grupos').select('valor, ativo').order('valor'),
      ]);

      if (!efeitoAtivo) {
        return;
      }

      if (erroTipos) {
        console.error('Erro ao carregar tipos de produção:', erroTipos);
      } else {
        setTiposProducao(tipos || []);
      }

      if (erroGrupos) {
        console.error('Erro ao carregar grupos de produção:', erroGrupos);
      } else {
        setGruposProducao(grupos || []);
      }

      setClassificacoesProntas(!erroTipos && !erroGrupos);
    }

    carregarClassificacoes();

    return () => {
      efeitoAtivo = false;
    };
  }, [classificacoesTick]);

  // Renomear uma classificação propaga via ON UPDATE CASCADE no banco --
  // a lista de receitas já carregada em memória fica desatualizada para
  // quem usava o valor antigo, então uma alteração no modal recarrega as
  // duas listas (classificações e receitas).
  function aoAlterarClassificacoes() {
    setClassificacoesTick((tick) => tick + 1);
    setRecarregarTick((tick) => tick + 1);
  }

  function abrirEdicao(receita) {
    setReceitaEmEdicao(receita);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setReceitaEmEdicao(null);
  }

  function aoSalvar() {
    fecharModal();
    setMensagemSucesso('Produto de Produção atualizado com sucesso.');
    setRecarregarTick((tick) => tick + 1);
  }

  // Tipo/Grupo salvos que deixaram de existir no CADASTRO de classificações
  // (producao_tipos/producao_grupos, carregados sem erro) voltam a "Todos".
  // Classificação que existe mas não tem receita continua selecionada.
  const {
    busca,
    status: filtroStatus,
    telaHoje: filtroTelaHoje,
    tipo: filtroTipo,
    grupo: filtroGrupo,
  } = useSanearFiltros(
    filtros,
    regrasSaneamentoProducaoProdutos({ classificacoesProntas, tiposProducao, gruposProducao })
  );

  // Opções = valores usados pelas receitas + o valor escolhido (se nenhuma
  // receita o usa, ele continua visível no select e a lista fica vazia).
  const opcoesComEscolhido = (valores, escolhido) =>
    ordenarOpcoes(Array.from(new Set([...valores.filter((v) => v != null && v !== ''), ...(escolhido !== 'todos' ? [escolhido] : [])])));
  const tiposDisponiveis = opcoesComEscolhido(receitas.map((r) => r.tipo), filtroTipo);

  const gruposDisponiveis = opcoesComEscolhido(receitas.map((r) => r.grupo), filtroGrupo);

  const buscaNormalizada = busca.trim().toLowerCase();

  // Defesa em profundidade: "ativo em Produção" exige produtos.ativo=true
  // E receitas.ativo=true juntos -- nunca só o segundo. Um produto mestre
  // inativado nunca aparece como ativo aqui, mesmo que a extensão em si
  // ainda esteja com ativo=true (ver decisão "PRODUTO MESTRE INATIVO" da
  // auditoria de unificação).
  const receitasFiltradas = receitas.filter((receita) => {
    const ativoProducao = !!receita.ativo && !!receita.produtos?.ativo;

    if (filtroStatus === 'ativos' && !ativoProducao) return false;
    if (filtroStatus === 'inativos' && ativoProducao) return false;

    if (filtroTelaHoje === 'na_tela_hoje' && !receita.controlado_producao) return false;
    if (filtroTelaHoje === 'fora_tela_hoje' && receita.controlado_producao) return false;

    if (filtroTipo !== 'todos' && receita.tipo !== filtroTipo) return false;
    if (filtroGrupo !== 'todos' && receita.grupo !== filtroGrupo) return false;

    if (buscaNormalizada && !(receita.produtos?.nome || '').toLowerCase().includes(buscaNormalizada)) {
      return false;
    }

    return true;
  });

  const quantidadeFiltrosAtivos = [
    filtroStatus !== 'ativos',
    filtroTelaHoje !== 'todas',
    filtroTipo !== 'todos',
    filtroGrupo !== 'todos',
    busca !== '',
  ].filter(Boolean).length;

  // Volta aos valores iniciais da tela (Status = Ativas, demais em "todos").
  function limparFiltros() {
    filtros.redefinir();
    setPagina(1);
  }

  // Qualquer mudança de filtro/busca volta para a página 1.
  function alterarFiltro(campo) {
    return (valor) => {
      filtros.definir(campo, valor);
      setPagina(1);
    };
  }

  const colunas = [
    { chave: 'nome', rotulo: 'Nome', mobile: 'titulo', ordenavel: { valor: (r) => r.produtos?.nome }, render: (r) => r.produtos?.nome || '—' },
    { chave: 'codigo', rotulo: 'Código G3', ordenavel: { valor: (r) => r.produtos?.codigo_g3 }, render: (r) => r.produtos?.codigo_g3 || '—' },
    { chave: 'tipo', rotulo: 'Tipo', ordenavel: { valor: (r) => r.tipo }, render: (r) => r.tipo || '—' },
    { chave: 'grupo', rotulo: 'Grupo', ordenavel: { valor: (r) => r.grupo }, render: (r) => r.grupo || '—' },
    { chave: 'ativo', rotulo: 'Ativo', ordenavel: { tipo: 'booleano', valor: (r) => !!r.ativo && !!r.produtos?.ativo }, render: (r) => <BadgeAtivo ativo={!!r.ativo && !!r.produtos?.ativo} /> },
    { chave: 'telaHoje', rotulo: 'Tela Hoje', ordenavel: { tipo: 'booleano', valor: (r) => !!r.controlado_producao }, render: (r) => <BadgeTelaHoje naTelaHoje={r.controlado_producao} /> },
    { chave: 'rendimento', rotulo: 'Rendimento', ordenavel: { tipo: 'numero', valor: (r) => r.rendimento_quantidade }, render: (r) => formatarRendimento(r.rendimento_quantidade, r.unidade_medida_saida) },
  ];

  // Paginação VISUAL (client-side, 20 por página): a lista completa já
  // precisa estar em memória -- as opções de Tipo/Grupo saem de TODAS as
  // receitas (inclusive inativas) e o filtro de status usa produtos.ativo
  // (embed), então uma consulta paginada quebraria os filtros. O volume é
  // limitado ao subconjunto do Catálogo marcado como Produto de Produção.
  // A ordenação escolhida vale para o conjunto filtrado INTEIRO (antes de
  // fatiar); sem escolha, fica a ordem padrão (nome do produto).
  const paginacao = paginarLista(ordenacao.ordenar(receitasFiltradas, colunas), pagina);
  const paginaAtual = paginacao.paginaAtual;

  // Total encolheu (filtro, edição que inativa o produto, recarga):
  // corrige a página guardada.
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  return (
    <PaginaProducao
      ativo="produtos"
      titulo="Produtos"
      subtitulo={'Para adicionar um produto à Produção, cadastre ou edite o produto no Catálogo e marque "Produto de Produção".'}
      acoes={
        <>
          {podeEscrever && (
            <Button variante="secondary" onClick={() => setModalClassificacoesAberto(true)}>
              Gerenciar Classificações
            </Button>
          )}

          {/* Unificação Catálogo x Produção: não existe mais criação
              independente de receita -- todo produto de Produção nasce de
              um produto do Catálogo marcado como "Produto de Produção". */}
          <Button icone="plus" onClick={() => router.push('/catalogo')}>
            Adicionar produto de produção
          </Button>
        </>
      }
    >
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Buscar por nome">
          <Input type="text" value={busca} onChange={(e) => alterarFiltro('busca')(e.target.value)} placeholder="Nome do produto..." />
        </Field>
        <Field label="Status">
          <Select value={filtroStatus} onChange={(e) => alterarFiltro('status')(e.target.value)}>
            <option value="ativos">Ativas</option>
            <option value="inativos">Inativas</option>
            <option value="todos">Todas</option>
          </Select>
        </Field>
        <Field label="Exibição na Tela Hoje">
          <Select value={filtroTelaHoje} onChange={(e) => alterarFiltro('telaHoje')(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="na_tela_hoje">Na Tela Hoje</option>
            <option value="fora_tela_hoje">Fora da Tela Hoje</option>
          </Select>
        </Field>
        <Field label="Tipo">
          <Select value={filtroTipo} onChange={(e) => alterarFiltro('tipo')(e.target.value)}>
            <option value="todos">Todos</option>
            {tiposDisponiveis.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Grupo">
          <Select value={filtroGrupo} onChange={(e) => alterarFiltro('grupo')(e.target.value)}>
            <option value="todos">Todos</option>
            {gruposDisponiveis.map((grupo) => (
              <option key={grupo} value={grupo}>
                {grupo}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      {carregando ? (
        <p role="status">Carregando produtos...</p>
      ) : receitas.length === 0 ? (
        <EmptyState>Nenhum produto de Produção encontrado.</EmptyState>
      ) : receitasFiltradas.length === 0 ? (
        <EmptyState>Nenhum resultado para esta busca/filtro.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Produtos de Produção"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(r) => r.id}
            cartoesAte={1100}
            ordenacao={ordenacao.props}
            renderAcoes={
              podeEscrever
                ? (r) => (
                    <Button variante="secondary" tamanho="sm" icone="pencil" onClick={() => abrirEdicao(r)}>
                      Editar
                    </Button>
                  )
                : undefined
            }
          />

          <p className={estilos.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}{' '}
            {paginacao.total === 1 ? 'produto' : 'produtos'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao
            paginaAtual={paginaAtual}
            totalPaginas={paginacao.totalPaginas}
            onMudarPagina={setPagina}
            corPrimaria={aparencia.corPrimaria}
          />
        </div>
      )}

      {modalAberto && (
        <ReceitaProducaoForm
          receita={receitaEmEdicao}
          tiposProducao={tiposProducao}
          gruposProducao={gruposProducao}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
        />
      )}

      <GerenciarClassificacoesProducaoModal
        aberto={modalClassificacoesAberto}
        onFechar={() => setModalClassificacoesAberto(false)}
        tipos={tiposProducao}
        grupos={gruposProducao}
        podeGerenciar={podeEscrever}
        onAtualizar={aoAlterarClassificacoes}
      />
    </PaginaProducao>
  );
}

export default function ProdutosProducao() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUTOS_PRODUCAO_VISUALIZAR}>
      <ProdutosProducaoConteudo />
    </RequireAuth>
  );
}
