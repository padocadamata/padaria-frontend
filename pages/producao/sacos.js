import { useEffect, useMemo, useState } from 'react';
import CabecalhoPrincipal from '../../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import AbrirSacoModal from '../../components/producao/AbrirSacoModal';
import LancarSaldoInicialModal from '../../components/producao/LancarSaldoInicialModal';
import EditarMovimentacaoSacoModal from '../../components/producao/EditarMovimentacaoSacoModal';
import ExcluirMovimentacaoSacoModal from '../../components/producao/ExcluirMovimentacaoSacoModal';
import { BotaoIconeAcao, IconeCaixa, IconeLapis, IconeLixeira } from '../../components/producao/IconesAcoes';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { mensagemErroSacos, TIPO_MOVIMENTO_LABEL, ORIGEM_MOVIMENTO_LABEL } from '../../lib/producao/mensagensSacos';
import { APARENCIA_FIXA } from '../../lib/branding/tema';
import { somarDias } from '../../lib/data/dataLocal';
import Paginacao from '../../components/Paginacao';
import BotaoLimparFiltros from '../../components/BotaoLimparFiltros';

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

// Campos dos filtros: altura mínima de 42px (área de toque) e fonte 16px
// (iOS dá zoom automático em inputs menores que 16px).
const campoEstilo = {
  width: '100%',
  minWidth: 0,
  minHeight: '42px',
  padding: '8px',
  fontSize: '16px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

const rotuloEstilo = { display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' };

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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Produção" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />
        <NavegacaoProducao abaAtiva="sacos" corPrimaria={aparencia.corPrimaria} />

        {mensagemSucesso && (
          <p style={{ backgroundColor: '#e8f5e9', color: '#2e7d32', padding: '10px 15px', borderRadius: '5px', marginBottom: '15px' }}>
            {mensagemSucesso}
          </p>
        )}

        {carregando ? (
          <p>Carregando dados de Sacos Fechados...</p>
        ) : erro ? (
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
            <p style={{ color: '#f44336', marginTop: 0 }}>{erro}</p>
            <button
              type="button"
              onClick={() => recarregar()}
              style={{
                padding: '8px 16px',
                backgroundColor: aparencia.corPrimaria,
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
          </div>
        ) : !podeVisualizar ? (
          <p style={{ color: '#f44336' }}>Você não tem permissão para ver esta tela.</p>
        ) : (
          <>
            {/* Saldo de Sacos Fechados */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '25px' }}>
              <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Saldo de Sacos Fechados</h2>

              {configuracoesControladas.length === 0 ? (
                <p style={{ color: '#666' }}>
                  Nenhum produto configurado para controle de sacos fechados. Configure em Catálogo &gt; abrir o
                  produto &gt; configuração comercial do fornecedor &gt; &quot;Controlar sacos fechados&quot;.
                </p>
              ) : (
                <>
                  <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end' }}>
                      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <label htmlFor="sacos-saldo-busca" style={rotuloEstilo}>Produto ou fornecedor</label>
                        <input
                          id="sacos-saldo-busca"
                          type="search"
                          value={buscaSaldo}
                          onChange={(e) => setBuscaSaldo(e.target.value)}
                          placeholder="Buscar..."
                          style={campoEstilo}
                        />
                      </div>
                      <div style={{ flex: '1 1 160px', maxWidth: '220px' }}>
                        <BotaoLimparFiltros
                          filtrosAtivos={Boolean(buscaSaldo)}
                          onClick={() => setBuscaSaldo('')}
                          corPrimaria={aparencia.corPrimaria}
                        />
                      </div>
                    </div>
                  </div>

                  {configuracoesSaldoFiltradas.length === 0 ? (
                    <p style={{ color: '#666' }}>Nenhum produto encontrado para a busca.</p>
                    ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #ddd' }}>
                            <th style={{ padding: '10px', textAlign: 'left' }}>Produto</th>
                            <th style={{ padding: '10px', textAlign: 'left' }}>Fornecedor</th>
                            <th style={{ padding: '10px', textAlign: 'left' }}>Sacos fechados</th>
                            <th style={{ padding: '10px', textAlign: 'left' }}>Kg/saco</th>
                            <th style={{ padding: '10px', textAlign: 'left' }}>Kg total</th>
                            <th style={{ padding: '10px', textAlign: 'left' }}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {configuracoesSaldoFiltradas.map((c) => (
                            <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '10px' }}>{c.produtoNome}</td>
                              <td style={{ padding: '10px' }}>{c.fornecedorNome}</td>
                              <td style={{ padding: '10px', fontWeight: 'bold' }}>{c.saldoSacos}</td>
                              <td style={{ padding: '10px' }}>{c.pesoPorSacoKg} kg</td>
                              <td style={{ padding: '10px' }}>{formatarKg(c.kgTotal)} kg</td>
                              <td style={{ padding: '10px', display: 'flex', gap: '8px' }}>
                                {podeOperar && !c.temSaldoInicial && (
                                  <button
                                    type="button"
                                    onClick={() => setConfiguracaoParaSaldoInicial(c)}
                                    style={{
                                      padding: '6px 12px',
                                      backgroundColor: 'white',
                                      color: aparencia.corPrimaria,
                                      border: `1px solid ${aparencia.corPrimaria}`,
                                      borderRadius: '5px',
                                      cursor: 'pointer',
                                      fontSize: '13px',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    Lançar saldo inicial
                                  </button>
                                )}
                                {podeOperar && (
                                  <BotaoIconeAcao
                                    rotulo="Abrir saco"
                                    icone={IconeCaixa}
                                    cor={aparencia.corPrimaria}
                                    onClick={() => setConfiguracaoParaAbrir(c)}
                                  />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Movimentações */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
              <h2 style={{ color: aparencia.corPrimaria, marginTop: 0, marginBottom: '15px' }}>Movimentações</h2>

              <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '15px', alignItems: 'end' }}>
                  <div>
                    <label htmlFor="sacos-filtro-busca" style={rotuloEstilo}>Produto ou fornecedor</label>
                    <input
                      id="sacos-filtro-busca"
                      type="search"
                      value={busca}
                      onChange={(e) => {
                        setBusca(e.target.value);
                        setPagina(1);
                      }}
                      placeholder="Buscar..."
                      style={campoEstilo}
                    />
                  </div>
                  <div>
                    <label htmlFor="sacos-filtro-tipo" style={rotuloEstilo}>Movimento</label>
                    <select
                      id="sacos-filtro-tipo"
                      value={filtroTipo}
                      onChange={(e) => alterarFiltro(setFiltroTipo)(e.target.value)}
                      style={campoEstilo}
                    >
                      <option value="todos">Todos</option>
                      {Object.entries(TIPO_MOVIMENTO_LABEL).map(([valor, rotulo]) => (
                        <option key={valor} value={valor}>{rotulo}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sacos-filtro-de" style={rotuloEstilo}>Data -- de</label>
                    <input
                      id="sacos-filtro-de"
                      type="date"
                      value={filtroDe}
                      max={filtroAte || undefined}
                      onChange={(e) => alterarFiltro(setFiltroDe)(e.target.value)}
                      style={campoEstilo}
                    />
                  </div>
                  <div>
                    <label htmlFor="sacos-filtro-ate" style={rotuloEstilo}>Data -- até</label>
                    <input
                      id="sacos-filtro-ate"
                      type="date"
                      value={filtroAte}
                      min={filtroDe || undefined}
                      onChange={(e) => alterarFiltro(setFiltroAte)(e.target.value)}
                      style={campoEstilo}
                    />
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={limparFiltros}
                      disabled={!filtrosAtivos}
                      style={{
                        ...campoEstilo,
                        backgroundColor: 'white',
                        color: filtrosAtivos ? aparencia.corPrimaria : '#aaa',
                        border: `1px solid ${filtrosAtivos ? aparencia.corPrimaria : '#ddd'}`,
                        cursor: filtrosAtivos ? 'pointer' : 'not-allowed',
                        fontSize: '14px',
                      }}
                    >
                      Limpar filtros
                    </button>
                  </div>
                </div>
                {periodoInvertido && (
                  <p style={{ color: '#c62828', fontSize: '13px', margin: '10px 0 0' }}>
                    A data inicial é posterior à data final.
                  </p>
                )}
              </div>

              {erroMovs ? (
                <div>
                  <p style={{ color: '#f44336', marginTop: 0 }}>{erroMovs}</p>
                  <button
                    type="button"
                    onClick={() => recarregar()}
                    style={{ padding: '8px 16px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : movimentacoes.length === 0 ? (
                <p style={{ color: '#666' }}>
                  {carregandoMovs
                    ? 'Carregando movimentações...'
                    : filtrosAtivos
                      ? 'Nenhuma movimentação encontrada para os filtros selecionados.'
                      : 'Nenhuma movimentação registrada ainda.'}
                </p>
              ) : (
                <div style={{ overflowX: 'auto', opacity: carregandoMovs ? 0.55 : 1, transition: 'opacity 0.15s' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ddd' }}>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Data</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Produto</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Fornecedor</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Movimento</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Quantidade</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Kg</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Origem</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Responsável</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimentacoes.map((m) => {
                        const positivo = m.quantidade_sacos > 0;
                        const ehManual = m.tipo === 'abertura' || m.tipo === 'ajuste_manual' || m.tipo === 'saldo_inicial';
                        const editavel = podeEditar && ehManual;
                        const excluivel = podeExcluir && ehManual;
                        return (
                          <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{formatarDataHora(m.criado_em)}</td>
                            <td style={{ padding: '10px' }}>{m.produtoNome}</td>
                            <td style={{ padding: '10px' }}>{m.fornecedorNome}</td>
                            <td style={{ padding: '10px' }}>{TIPO_MOVIMENTO_LABEL[m.tipo] || m.tipo}</td>
                            <td style={{ padding: '10px', fontWeight: 'bold', color: positivo ? '#2e7d32' : '#c62828' }}>
                              {Math.abs(m.quantidade_sacos)}
                            </td>
                            <td style={{ padding: '10px' }}>{formatarKg(m.kg)} kg</td>
                            <td style={{ padding: '10px' }}>{ORIGEM_MOVIMENTO_LABEL[m.origem] || m.origem}</td>
                            <td style={{ padding: '10px' }}>{m.responsavelNome}</td>
                            <td style={{ padding: '10px', display: 'flex', gap: '4px' }}>
                              {editavel && (
                                <BotaoIconeAcao
                                  rotulo="Editar"
                                  icone={IconeLapis}
                                  cor={aparencia.corPrimaria}
                                  onClick={() => setMovimentacaoParaEditar(m)}
                                />
                              )}
                              {excluivel && (
                                <BotaoIconeAcao
                                  rotulo="Excluir"
                                  icone={IconeLixeira}
                                  destrutivo
                                  onClick={() => setMovimentacaoParaExcluir(m)}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!erroMovs && totalMovimentacoes > 0 && (
                <>
                  <p style={{ color: '#666', fontSize: '13px', textAlign: 'center', margin: '15px 0 0' }}>
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
          </>
        )}
      </div>

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
    </div>
  );
}

export default function Sacos() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_SACOS_VISUALIZAR}>
      <SacosConteudo />
    </RequireAuth>
  );
}
