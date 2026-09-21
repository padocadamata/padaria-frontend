import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import PaginaProducao from '../../components/producao/PaginaProducao';
import AbrirSacoModal from '../../components/producao/AbrirSacoModal';
import LancarSaldoInicialModal from '../../components/producao/LancarSaldoInicialModal';
import EditarMovimentacaoSacoModal from '../../components/producao/EditarMovimentacaoSacoModal';
import ExcluirMovimentacaoSacoModal from '../../components/producao/ExcluirMovimentacaoSacoModal';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import FilterBar from '../../components/ui/FilterBar';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import SectionHeader from '../../components/ui/SectionHeader';
import AcoesLinha from '../../components/ui/AcoesLinha';
import { cx } from '../../lib/design/cx';
import estilos from '../../components/producao/producao.module.css';
import estilosSacos from '../../components/producao/sacos.module.css';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { mensagemErroSacos, TIPO_MOVIMENTO_LABEL, ORIGEM_MOVIMENTO_LABEL } from '../../lib/producao/mensagensSacos';
import { APARENCIA_FIXA } from '../../lib/branding/tema';
import { somarDias } from '../../lib/data/dataLocal';
import Paginacao from '../../components/Paginacao';

// Controle de Sacos Fechados (migrations 0041/0042 + complementar de
// operação inicial). Leitura via RPC listar_sacos_fechados_configuracoes
// (READ-ONLY, SECURITY DEFINER) para produto/fornecedor/peso -- essa RPC
// existe justamente porque a RLS normal de produto_fornecedores exige
// catalogo_produtos.visualizar (migration 0023), não producao_sacos.* --
// sem ela, um usuário com só producao_sacos.visualizar veria esta tela
// vazia. A leitura de sacos_fechados_movimentacoes (tabela de
// Movimentações) continua sendo um SELECT direto -- a RLS dessa tabela já
// exige só producao_sacos.visualizar desde a 0042, sem essa dependência.
// Escrita SOMENTE via RPC (registrar_abertura_saco/editar_movimentacao_saco/
// registrar_saldo_inicial_sacos) -- nunca INSERT/UPDATE direto nas
// tabelas de sacos/estoque. "Lançar saldo inicial" só é oferecido quando
// a configuração ainda não tem nenhuma movimentação tipo=saldo_inicial
// (protegido também no banco desde a 0047, no máximo 1 por configuração
// comercial) -- corrigir um saldo inicial já lançado é sempre "Editar".
//
// Saldo de sacos por configuração já vem calculado pela RPC
// (SUM(quantidade_sacos) do lado do banco) -- NUNCA armazenado em coluna
// nenhuma. Kg total = saldo × peso_por_saco_kg ATUAL da configuração (não
// o snapshot -- o snapshot é só o valor histórico usado em cada
// movimentação passada).
//
// Movimentações: filtros e paginação são aplicados NA CONSULTA (Supabase
// .range() + count exact), não no navegador -- o histórico só cresce
// (recebimentos automáticos geram linhas continuamente), então carregar
// tudo (ou um .limit() fixo, que escondia o que passasse dele) não escala.
// A busca por produto/fornecedor é resolvida sobre as configurações já
// carregadas (nome vive na RPC, não na tabela de movimentações) e vira um
// filtro .in('produto_fornecedor_id', ids) -- sem migration nem RPC nova.
const TAMANHO_PAGINA = 20;
const ATRASO_BUSCA_MS = 300;

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Fuso fixo -03:00 (America/Sao_Paulo sem horário de verão desde 2019,
// mesmo fuso usado para exibir a data na tabela): "de" começa 00:00 do
// dia, "até" é inclusivo -- vira "< 00:00 do dia seguinte".
function limiteInicioDia(dataYYYYMMDD) {
  return `${dataYYYYMMDD}T00:00:00-03:00`;
}
function limiteFimDia(dataYYYYMMDD) {
  return `${somarDias(dataYYYYMMDD, 1)}T00:00:00-03:00`;
}

function formatarDataHora(timestamptz) {
  if (!timestamptz) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamptz));
}

function formatarKg(valor) {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

const TOM_MOVIMENTO = {
  entrada: 'success',
  abertura: 'warning',
  ajuste_manual: 'info',
  saldo_inicial: 'primary',
};

function SacosConteudo() {
  const { permissoes, usuarioAuth } = useAuth();
  const podeVisualizar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_VISUALIZAR);
  const podeOperar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_OPERAR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_EDITAR);
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_EXCLUIR);

  const aparencia = APARENCIA_FIXA;

  const [configsRaw, setConfigsRaw] = useState([]);
  const [idsComSaldoInicial, setIdsComSaldoInicial] = useState(() => new Set());
  const [movimentacoesRaw, setMovimentacoesRaw] = useState([]);
  const [totalMovimentacoes, setTotalMovimentacoes] = useState(0);
  const [usuariosPorId, setUsuariosPorId] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [baseCarregada, setBaseCarregada] = useState(false);
  const [carregandoMovs, setCarregandoMovs] = useState(true);
  const [erro, setErro] = useState('');
  const [erroMovs, setErroMovs] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  // Filtros da lista de Movimentações + página atual. "busca" é o que a
  // pessoa digita; "buscaAplicada" é o valor com debounce que realmente
  // dispara a consulta.
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroDe, setFiltroDe] = useState('');
  const [filtroAte, setFiltroAte] = useState('');
  const [pagina, setPagina] = useState(1);

  // Carga "base": configurações (RPC), nomes de usuários e quais
  // configurações já têm saldo inicial. Não depende de filtro/página.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      // listar_sacos_fechados_configuracoes (RPC) já devolve, sem
      // depender de catalogo_produtos.visualizar: configurações ativas +
      // controladas (para a tabela de Saldo) e qualquer configuração
      // histórica com movimentação existente (para as movimentações
      // resolverem produto/fornecedor mesmo que a config tenha sido
      // desativada/desmarcada depois) -- já com saldo_sacos somado.
      const [{ data: configsData, error: erroConfigs }, { data: saldosData, error: erroSaldos }, { data: usuariosData }] =
        await Promise.all([
          supabase.rpc('listar_sacos_fechados_configuracoes'),
          // No máximo 1 saldo inicial por configuração (migration 0047) --
          // consulta própria, independente da página de movimentações
          // exibida (antes derivava da lista carregada, limitada a 500).
          supabase.from('sacos_fechados_movimentacoes').select('produto_fornecedor_id').eq('tipo', 'saldo_inicial'),
          // Best-effort: RLS de usuarios (0005b) só libera a própria linha
          // ou admin -- um operador comum não vê nome de outros usuários
          // aqui, e a coluna "Responsável" cai no fallback (id truncado)
          // para os que não resolverem. Não é um erro, é o esperado.
          supabase.from('usuarios').select('id, nome'),
        ]);

      if (!efeitoAtivo) return;

      if (erroConfigs || erroSaldos) {
        const erroReal = erroConfigs || erroSaldos;
        if (process.env.NODE_ENV !== 'production') {
          console.error('Erro ao carregar Sacos Fechados:', erroReal);
        }
        setErro(mensagemErroSacos(erroReal));
        setCarregando(false);
        return;
      }

      setConfigsRaw(configsData || []);
      setIdsComSaldoInicial(new Set((saldosData || []).map((m) => m.produto_fornecedor_id)));

      const mapaUsuarios = {};
      for (const u of usuariosData || []) {
        mapaUsuarios[u.id] = u.nome;
      }
      setUsuariosPorId(mapaUsuarios);

      setBaseCarregada(true);
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recarregarTick]);

  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(busca), ATRASO_BUSCA_MS);
    return () => clearTimeout(timer);
  }, [busca]);

  // Busca por produto/fornecedor -> ids de configuração (produto_fornecedor_id).
  // null = sem busca; [] = busca sem nenhuma correspondência (lista vazia,
  // sem ir ao banco). A chave em string evita que a consulta rode de novo
  // só porque configsRaw foi recarregado com o mesmo conteúdo.
  const idsBusca = useMemo(() => {
    const termo = normalizarTexto(buscaAplicada);
    if (!termo) return null;
    return configsRaw
      .filter((c) => normalizarTexto(`${c.produto_nome} ${c.fornecedor_nome}`).includes(termo))
      .map((c) => c.produto_fornecedor_id);
  }, [buscaAplicada, configsRaw]);
  const idsBuscaChave = idsBusca ? idsBusca.join(',') : null;

  const periodoInvertido = Boolean(filtroDe && filtroAte && filtroDe > filtroAte);

  // Consulta paginada de Movimentações (filtros + página). Ordem: mais
  // recentes primeiro, com id como desempate para a paginação ficar
  // estável quando duas linhas têm o mesmo criado_em (ex.: recebimento
  // com vários itens na mesma transação).
  useEffect(() => {
    if (!baseCarregada) return undefined;
    let efeitoAtivo = true;

    async function carregarMovimentacoes() {
      setCarregandoMovs(true);
      setErroMovs('');

      if ((idsBusca && idsBusca.length === 0) || periodoInvertido) {
        setMovimentacoesRaw([]);
        setTotalMovimentacoes(0);
        setCarregandoMovs(false);
        return;
      }

      let consulta = createClient()
        .from('sacos_fechados_movimentacoes')
        .select(
          'id, produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot, tipo, origem, observacao, criado_por, criado_em',
          { count: 'exact' }
        );

      if (idsBusca) consulta = consulta.in('produto_fornecedor_id', idsBusca);
      if (filtroTipo !== 'todos') consulta = consulta.eq('tipo', filtroTipo);
      if (filtroDe) consulta = consulta.gte('criado_em', limiteInicioDia(filtroDe));
      if (filtroAte) consulta = consulta.lt('criado_em', limiteFimDia(filtroAte));

      const inicio = (pagina - 1) * TAMANHO_PAGINA;
      const { data, count, error } = await consulta
        .order('criado_em', { ascending: false })
        .order('id', { ascending: false })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);

      if (!efeitoAtivo) return;

      if (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Erro ao carregar movimentações de Sacos Fechados:', error);
        }
        setErroMovs(mensagemErroSacos(error));
        setCarregandoMovs(false);
        return;
      }

      // Página fora do intervalo (ex.: excluiu o único item da última
      // página): volta para a última página válida -- o efeito roda de
      // novo com a página corrigida.
      const total = count ?? 0;
      if ((data || []).length === 0 && total > 0 && pagina > 1) {
        setPagina(Math.ceil(total / TAMANHO_PAGINA));
        return;
      }

      setMovimentacoesRaw(data || []);
      setTotalMovimentacoes(total);
      setCarregandoMovs(false);
    }

    carregarMovimentacoes();
    return () => {
      efeitoAtivo = false;
    };
    // idsBusca entra via idsBuscaChave (mesmo conteúdo = mesma consulta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCarregada, recarregarTick, pagina, filtroTipo, filtroDe, filtroAte, idsBuscaChave, periodoInvertido]);

  useEffect(() => {
    if (!mensagemSucesso) return undefined;
    const timer = setTimeout(() => setMensagemSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  function recarregar(msg) {
    if (msg) setMensagemSucesso(msg);
    setRecarregarTick((t) => t + 1);
  }

  // Mapa id -> {produtoNome, fornecedorNome} -- usado para resolver os
  // nomes nas movimentações históricas (a RPC já inclui configurações
  // desativadas/desmarcadas que tenham movimentação, então o mapa cobre
  // esses casos também).
  const infoPorConfigId = useMemo(() => {
    const mapa = new Map();
    for (const c of configsRaw) {
      mapa.set(c.produto_fornecedor_id, {
        produtoNome: c.produto_nome || '—',
        fornecedorNome: c.fornecedor_nome || '—',
      });
    }
    return mapa;
  }, [configsRaw]);

  // Tabela de saldo: só configurações ATIVAS e CONTROLADAS (mesmo saldo
  // = 0 continua aparecendo, conforme decidido) -- ordenado por produto,
  // depois fornecedor. saldo_sacos já vem somado pela RPC.
  const configuracoesControladas = useMemo(() => {
    return configsRaw
      .filter((c) => c.ativo && c.controla_sacos_fechados)
      .map((c) => ({
        id: c.produto_fornecedor_id,
        produtoNome: c.produto_nome || '—',
        fornecedorNome: c.fornecedor_nome || '—',
        pesoPorSacoKg: c.peso_por_saco_kg,
        saldoSacos: c.saldo_sacos,
        kgTotal: c.saldo_sacos * c.peso_por_saco_kg,
        temSaldoInicial: idsComSaldoInicial.has(c.produto_fornecedor_id),
      }))
      .sort(
        (a, b) =>
          a.produtoNome.localeCompare(b.produtoNome, 'pt-BR', { sensitivity: 'base' }) ||
          a.fornecedorNome.localeCompare(b.fornecedorNome, 'pt-BR', { sensitivity: 'base' })
      );
  }, [configsRaw, idsComSaldoInicial]);

  // Filtro do Saldo: independente dos filtros de Movimentações. Client-side
  // sobre as configurações que a RPC já entregou (poucas linhas, sem
  // consulta nova): texto parcial, sem diferenciar maiúsculas/acentos,
  // casando produto OU fornecedor.
  const [buscaSaldo, setBuscaSaldo] = useState('');
  const configuracoesSaldoFiltradas = useMemo(() => {
    const termo = normalizarTexto(buscaSaldo);
    if (!termo) return configuracoesControladas;
    return configuracoesControladas.filter((c) => normalizarTexto(`${c.produtoNome} ${c.fornecedorNome}`).includes(termo));
  }, [configuracoesControladas, buscaSaldo]);

  const movimentacoes = useMemo(
    () =>
      movimentacoesRaw.map((m) => {
        const info = infoPorConfigId.get(m.produto_fornecedor_id);
        return {
          ...m,
          produtoNome: info?.produtoNome || '—',
          fornecedorNome: info?.fornecedorNome || '—',
          kg: Math.abs(m.quantidade_sacos * m.peso_por_saco_kg_snapshot),
          responsavelNome: usuariosPorId[m.criado_por] || (m.criado_por === usuarioAuth?.id ? 'Você' : '—'),
        };
      }),
    [movimentacoesRaw, infoPorConfigId, usuariosPorId, usuarioAuth]
  );

  const totalPaginas = Math.max(1, Math.ceil(totalMovimentacoes / TAMANHO_PAGINA));
  const filtrosAtivos = Boolean(busca || filtroTipo !== 'todos' || filtroDe || filtroAte);

  // Qualquer mudança de filtro volta para a página 1.
  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  function limparFiltros() {
    setBusca('');
    setBuscaAplicada('');
    setFiltroTipo('todos');
    setFiltroDe('');
    setFiltroAte('');
    setPagina(1);
  }

  const [configuracaoParaAbrir, setConfiguracaoParaAbrir] = useState(null);
  const [configuracaoParaSaldoInicial, setConfiguracaoParaSaldoInicial] = useState(null);
  const [movimentacaoParaEditar, setMovimentacaoParaEditar] = useState(null);
  const [movimentacaoParaExcluir, setMovimentacaoParaExcluir] = useState(null);

  const quantidadeFiltrosMov = [busca !== '', filtroTipo !== 'todos', filtroDe !== '', filtroAte !== ''].filter(Boolean).length;

  // Saldo: UMA definição de colunas para tabela e cartão.
  const colunasSaldo = [
    { chave: 'produto', rotulo: 'Produto', mobile: 'titulo', cartaoOrdem: 0, render: (c) => c.produtoNome },
    { chave: 'fornecedor', rotulo: 'Fornecedor', mobile: 'titulo', cartaoOrdem: 1, render: (c) => c.fornecedorNome },
    { chave: 'saldo', rotulo: 'Sacos fechados', alinhar: 'direita', render: (c) => <strong>{c.saldoSacos}</strong> },
    { chave: 'peso', rotulo: 'Kg/saco', alinhar: 'direita', semQuebra: true, render: (c) => `${c.pesoPorSacoKg} kg` },
    { chave: 'kgTotal', rotulo: 'Kg total', alinhar: 'direita', semQuebra: true, render: (c) => `${formatarKg(c.kgTotal)} kg` },
  ];

  const colunasMov = [
    { chave: 'data', rotulo: 'Data', semQuebra: true, mobile: 'titulo', cartaoOrdem: 2, render: (m) => formatarDataHora(m.criado_em) },
    { chave: 'produto', rotulo: 'Produto', mobile: 'titulo', cartaoOrdem: 0, render: (m) => m.produtoNome },
    { chave: 'fornecedor', rotulo: 'Fornecedor', mobile: 'titulo', cartaoOrdem: 1, render: (m) => m.fornecedorNome },
    {
      chave: 'movimento',
      rotulo: 'Movimento',
      render: (m) => <Badge tom={TOM_MOVIMENTO[m.tipo] || 'neutral'}>{TIPO_MOVIMENTO_LABEL[m.tipo] || m.tipo}</Badge>,
    },
    {
      chave: 'quantidade',
      rotulo: 'Quantidade',
      alinhar: 'direita',
      render: (m) => (
        <strong className={m.quantidade_sacos > 0 ? estilosSacos.positivo : estilosSacos.negativo}>
          {Math.abs(m.quantidade_sacos)}
        </strong>
      ),
    },
    { chave: 'kg', rotulo: 'Kg', alinhar: 'direita', semQuebra: true, render: (m) => `${formatarKg(m.kg)} kg` },
    { chave: 'origem', rotulo: 'Origem', render: (m) => ORIGEM_MOVIMENTO_LABEL[m.origem] || m.origem },
    { chave: 'responsavel', rotulo: 'Responsável', render: (m) => m.responsavelNome },
  ];

  function acoesMovimentacao(m) {
    const ehManual = m.tipo === 'abertura' || m.tipo === 'ajuste_manual' || m.tipo === 'saldo_inicial';
    return [
      podeEditar && ehManual && { chave: 'editar', rotulo: 'Editar', icone: 'pencil', onClick: () => setMovimentacaoParaEditar(m) },
      podeExcluir && ehManual && { chave: 'excluir', rotulo: 'Excluir', icone: 'trash', destrutivo: true, onClick: () => setMovimentacaoParaExcluir(m) },
    ].filter(Boolean);
  }

  return (
    <PaginaProducao ativo="sacos" titulo="Sacos Fechados">
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      {carregando ? (
        <p role="status">Carregando dados de Sacos Fechados...</p>
      ) : erro ? (
        <div className={estilos.superficie}>
          <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>
          <Button onClick={() => recarregar()}>Tentar novamente</Button>
        </div>
      ) : !podeVisualizar ? (
        <Alert tom="danger">Você não tem permissão para ver esta tela.</Alert>
      ) : (
        <>
          {/* Saldo de Sacos Fechados */}
          <section className={estilos.secao} aria-label="Saldo de Sacos Fechados">
            <SectionHeader titulo="Saldo de Sacos Fechados" />

            {configuracoesControladas.length === 0 ? (
              <EmptyState>
                Nenhum produto configurado para controle de sacos fechados. Configure em Catálogo &gt; abrir o
                produto &gt; configuração comercial do fornecedor &gt; &quot;Controlar sacos fechados&quot;.
              </EmptyState>
            ) : (
              <>
                <FilterBar ativos={buscaSaldo ? 1 : 0} onLimpar={() => setBuscaSaldo('')}>
                  <Field label="Produto ou fornecedor" id="sacos-saldo-busca">
                    <Input
                      id="sacos-saldo-busca"
                      type="search"
                      value={buscaSaldo}
                      onChange={(e) => setBuscaSaldo(e.target.value)}
                      placeholder="Buscar..."
                    />
                  </Field>
                </FilterBar>

                {configuracoesSaldoFiltradas.length === 0 ? (
                  <EmptyState>Nenhum produto encontrado para a busca.</EmptyState>
                ) : (
                  <div className={estilos.superficie}>
                    <DataTable
                      rotulo="Saldo de sacos fechados"
                      colunas={colunasSaldo}
                      linhas={configuracoesSaldoFiltradas}
                      chaveLinha={(c) => c.id}
                      renderAcoes={
                        podeOperar
                          ? (c) => (
                              <div className={estilosSacos.acoesSaldo}>
                                {!c.temSaldoInicial && (
                                  <Button variante="secondary" tamanho="sm" onClick={() => setConfiguracaoParaSaldoInicial(c)}>
                                    Lançar saldo inicial
                                  </Button>
                                )}
                                <Button tamanho="sm" icone="package" onClick={() => setConfiguracaoParaAbrir(c)}>
                                  Abrir saco
                                </Button>
                              </div>
                            )
                          : undefined
                      }
                    />
                  </div>
                )}
              </>
            )}
          </section>

          {/* Movimentações */}
          <section className={estilos.secao} aria-label="Movimentações">
            <SectionHeader titulo="Movimentações" />

            <FilterBar ativos={quantidadeFiltrosMov} onLimpar={limparFiltros}>
              <Field label="Produto ou fornecedor" id="sacos-filtro-busca">
                <Input
                  id="sacos-filtro-busca"
                  type="search"
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setPagina(1);
                  }}
                  placeholder="Buscar..."
                />
              </Field>
              <Field label="Movimento" id="sacos-filtro-tipo">
                <Select id="sacos-filtro-tipo" value={filtroTipo} onChange={(e) => alterarFiltro(setFiltroTipo)(e.target.value)}>
                  <option value="todos">Todos</option>
                  {Object.entries(TIPO_MOVIMENTO_LABEL).map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>{rotulo}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Data -- de" id="sacos-filtro-de">
                <Input
                  id="sacos-filtro-de"
                  type="date"
                  value={filtroDe}
                  max={filtroAte || undefined}
                  onChange={(e) => alterarFiltro(setFiltroDe)(e.target.value)}
                />
              </Field>
              <Field label="Data -- até" id="sacos-filtro-ate">
                <Input
                  id="sacos-filtro-ate"
                  type="date"
                  value={filtroAte}
                  min={filtroDe || undefined}
                  onChange={(e) => alterarFiltro(setFiltroAte)(e.target.value)}
                />
              </Field>
            </FilterBar>

            {periodoInvertido && <Alert tom="danger" className={estilos.mensagem}>A data inicial é posterior à data final.</Alert>}

            {erroMovs ? (
              <div>
                <Alert tom="danger" className={estilos.mensagem}>{erroMovs}</Alert>
                <Button onClick={() => recarregar()}>Tentar novamente</Button>
              </div>
            ) : movimentacoes.length === 0 ? (
              <EmptyState>
                {carregandoMovs
                  ? 'Carregando movimentações...'
                  : filtrosAtivos
                    ? 'Nenhuma movimentação encontrada para os filtros selecionados.'
                    : 'Nenhuma movimentação registrada ainda.'}
              </EmptyState>
            ) : (
              <div className={estilos.superficie}>
                <div className={cx(carregandoMovs && estilos.carregandoConteudo)}>
                  <DataTable
                    rotulo="Movimentações de sacos fechados"
                    colunas={colunasMov}
                    linhas={movimentacoes}
                    chaveLinha={(m) => m.id}
                    cartoesAte={1200}
                    renderAcoes={(m, { cartao }) => <AcoesLinha acoes={acoesMovimentacao(m)} cartao={cartao} />}
                  />
                </div>

                {!erroMovs && totalMovimentacoes > 0 && (
                  <>
                    <p className={estilos.resumo}>
                      Mostrando {(pagina - 1) * TAMANHO_PAGINA + 1}–{(pagina - 1) * TAMANHO_PAGINA + movimentacoes.length} de{' '}
                      {totalMovimentacoes} {totalMovimentacoes === 1 ? 'movimentação' : 'movimentações'}
                      {totalPaginas > 1 ? ` — página ${pagina} de ${totalPaginas}` : ''}
                    </p>
                    <Paginacao
                      paginaAtual={pagina}
                      totalPaginas={totalPaginas}
                      onMudarPagina={setPagina}
                      desabilitado={carregandoMovs}
                      corPrimaria={aparencia.corPrimaria}
                    />
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {configuracaoParaAbrir && (
        <AbrirSacoModal
          configuracao={configuracaoParaAbrir}
          corPrimaria={aparencia.corPrimaria}
          onSalvo={() => {
            setConfiguracaoParaAbrir(null);
            recarregar('Saco aberto com sucesso.');
          }}
          onCancelar={() => setConfiguracaoParaAbrir(null)}
        />
      )}

      {configuracaoParaSaldoInicial && (
        <LancarSaldoInicialModal
          configuracao={configuracaoParaSaldoInicial}
          corPrimaria={aparencia.corPrimaria}
          onSalvo={() => {
            setConfiguracaoParaSaldoInicial(null);
            recarregar('Saldo inicial lançado com sucesso.');
          }}
          onCancelar={() => setConfiguracaoParaSaldoInicial(null)}
        />
      )}

      {movimentacaoParaEditar && (
        <EditarMovimentacaoSacoModal
          movimentacao={movimentacaoParaEditar}
          corPrimaria={aparencia.corPrimaria}
          onSalvo={() => {
            setMovimentacaoParaEditar(null);
            recarregar('Movimentação corrigida.');
          }}
          onCancelar={() => setMovimentacaoParaEditar(null)}
        />
      )}

      {movimentacaoParaExcluir && (
        <ExcluirMovimentacaoSacoModal
          movimentacao={movimentacaoParaExcluir}
          corPrimaria={aparencia.corPrimaria}
          onExcluido={() => {
            setMovimentacaoParaExcluir(null);
            recarregar('Movimentação excluída com sucesso.');
          }}
          onCancelar={() => setMovimentacaoParaExcluir(null)}
        />
      )}
    </PaginaProducao>
  );
}

export default function Sacos() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_SACOS_VISUALIZAR}>
      <SacosConteudo />
    </RequireAuth>
  );
}
