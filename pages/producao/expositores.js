import { useEffect, useMemo, useState } from 'react';
import MenuOpcoes from '../../components/MenuOpcoes';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import EditarLoteExpositorModal from '../../components/producao/EditarLoteExpositorModal';
import CorrigirLoteExpositorConcluidoModal from '../../components/producao/CorrigirLoteExpositorConcluidoModal';
import ExcluirLoteExpositorModal from '../../components/producao/ExcluirLoteExpositorModal';
import { BotaoIconeAcao, IconeLapis, IconeLixeira, IconeCheck } from '../../components/producao/IconesAcoes';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { mensagemErroLoteExpositor } from '../../lib/producao/mensagensExpositor';

// Controle de Expositores (migration 0030). "Situação" NUNCA é lida do
// banco (não existe coluna para isso) -- é sempre derivada aqui,
// comparando producao_expositor_lotes.data_prevista_retirada (date puro)
// com dataLocalHoje()/somarDias() (America/Sao_Paulo) -- mesmo princípio
// já usado por estaAtrasado() em pages/pedidos.js. Nunca current_date/
// now() do Postgres, nunca new Date().toISOString() (UTC).
function situacaoLote(lote, hoje, amanha) {
  if (lote.concluido_em) return 'concluido';
  if (lote.data_prevista_retirada < hoje) return 'atrasado';
  if (lote.data_prevista_retirada === hoje) return 'retirar_hoje';
  if (lote.data_prevista_retirada === amanha) return 'retirar_amanha';
  return 'no_expositor';
}

const SITUACAO_LABEL = {
  atrasado: 'Atrasado',
  retirar_hoje: 'Retirar hoje',
  retirar_amanha: 'Retirar amanhã',
  no_expositor: 'No expositor',
  concluido: 'Concluído',
};

const SITUACAO_COR = {
  atrasado: '#f44336',
  retirar_hoje: '#FF9800',
  retirar_amanha: '#2196F3',
  no_expositor: '#9e9e9e',
  concluido: '#4CAF50',
};

function BadgeSituacao({ situacao }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: SITUACAO_COR[situacao] || '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {SITUACAO_LABEL[situacao] || situacao}
    </span>
  );
}

function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

const CARD_INDICADOR_ESTILO = {
  flex: '1 1 140px',
  minWidth: '140px',
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
  padding: '14px 16px',
};

function CardIndicador({ label, valor, cor }) {
  return (
    <div style={CARD_INDICADOR_ESTILO}>
      <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color: cor || '#333' }}>{valor}</div>
    </div>
  );
}

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '14px',
};

const campoInlineEstilo = {
  width: '80px',
  padding: '6px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  boxSizing: 'border-box',
  fontSize: '13px',
};

function ExpositoresConteudo() {
  const { permissoes } = useAuth();
  const podeOperar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EXPOSITORES_OPERAR);
  const podeEditarConcluido = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EXPOSITORES_EDITAR);
  const podeExcluir = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EXPOSITORES_EXCLUIR);

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

  const hoje = dataLocalHoje();
  const amanha = somarDias(hoje, 1);

  const [lotes, setLotes] = useState([]);
  const [produtosControlados, setProdutosControlados] = useState([]);
  const [registrosElegiveis, setRegistrosElegiveis] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  // Carrega tudo: lotes (view producao_expositor_detalhado, sem filtro de
  // período -- os filtros de período/produto/situação são aplicados no
  // cliente, sobre este mesmo conjunto, tanto para o painel operacional
  // quanto para a lista histórica e o relatório) + produtos com
  // controlar_expositor=true + lançamentos elegíveis para um lote novo
  // (últimos 60 dias, status=fechado, produto com controlar_expositor).
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();
      const dataMinima = somarDias(hoje, -60);

      const [{ data: lotesData, error: erroLotes }, { data: produtosData, error: erroProdutos }, { data: registrosData, error: erroRegistros }] =
        await Promise.all([
          supabase
            .from('producao_expositor_detalhado')
            .select(
              'lote_id, producao_registro_id, data_producao, turno, receita_id, produto_nome, quantidade_produzida, quantidade_enviada, data_entrada, prazo_dias_snapshot, data_prevista_retirada, quantidade_retirada, concluido_em, concluido_por, venda_estimada, observacao'
            )
            .order('data_entrada', { ascending: false })
            .limit(1000),
          supabase
            .from('receitas')
            .select('id, nome, prazo_expositor_dias')
            .eq('controlar_expositor', true)
            .eq('ativo', true)
            .order('nome', { ascending: true }),
          supabase
            .from('producao_registros')
            .select('id, data, turno, receita_id, quantidade_produzida, receitas!inner(nome, controlar_expositor)')
            .eq('status', 'fechado')
            .eq('receitas.controlar_expositor', true)
            .gte('data', dataMinima)
            .order('data', { ascending: false })
            .limit(300),
        ]);

      if (!efeitoAtivo) return;

      if (erroLotes || erroProdutos || erroRegistros) {
        console.error('Erro ao carregar Expositores:', erroLotes || erroProdutos || erroRegistros);
        setErro('Não foi possível carregar os dados de Expositores.');
        setCarregando(false);
        return;
      }

      setLotes(lotesData || []);
      setProdutosControlados(produtosData || []);
      setRegistrosElegiveis(registrosData || []);
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recarregarTick]);

  function recarregar(msg) {
    if (msg) setMensagemSucesso(msg);
    setRecarregarTick((t) => t + 1);
  }

  // Soma de quantidade_enviada já lançada por lançamento -- usada para
  // calcular "disponível" na criação de um novo lote. Vem do MESMO
  // conjunto `lotes` (não filtrado por período), para nunca subestimar a
  // soma real já enviada -- ver arquitetura da migration 0030.
  const somaEnviadaPorRegistro = useMemo(() => {
    const mapa = new Map();
    for (const lote of lotes) {
      mapa.set(lote.producao_registro_id, (mapa.get(lote.producao_registro_id) || 0) + lote.quantidade_enviada);
    }
    return mapa;
  }, [lotes]);

  const registrosComDisponivel = useMemo(
    () =>
      registrosElegiveis
        .map((r) => ({
          id: r.id,
          data: r.data,
          turno: r.turno,
          produtoNome: r.receitas?.nome || '—',
          quantidadeProduzida: r.quantidade_produzida,
          disponivel: r.quantidade_produzida - (somaEnviadaPorRegistro.get(r.id) || 0),
        }))
        .filter((r) => r.disponivel > 0),
    [registrosElegiveis, somaEnviadaPorRegistro]
  );

  const lotesComSituacao = useMemo(
    () => lotes.map((l) => ({ ...l, situacao: situacaoLote(l, hoje, amanha) })),
    [lotes, hoje, amanha]
  );

  const indicadores = useMemo(() => {
    const contagem = { atrasado: 0, retirar_hoje: 0, retirar_amanha: 0, no_expositor: 0 };
    for (const l of lotesComSituacao) {
      if (contagem[l.situacao] !== undefined) contagem[l.situacao] += 1;
    }
    return contagem;
  }, [lotesComSituacao]);

  // Painel operacional: atrasados + retirar hoje em destaque, retirar
  // amanhã como aviso secundário -- nunca lotes já concluídos nem "no
  // expositor" distante.
  const lotesUrgentes = useMemo(
    () =>
      lotesComSituacao
        .filter((l) => l.situacao === 'atrasado' || l.situacao === 'retirar_hoje')
        .sort((a, b) => a.data_prevista_retirada.localeCompare(b.data_prevista_retirada)),
    [lotesComSituacao]
  );
  const lotesAmanha = useMemo(
    () => lotesComSituacao.filter((l) => l.situacao === 'retirar_amanha'),
    [lotesComSituacao]
  );

  // Filtros da seção "Produtos nos Expositores" + relatório.
  const [filtroInicio, setFiltroInicio] = useState('');
  const [filtroFim, setFiltroFim] = useState('');
  const [filtroProdutoId, setFiltroProdutoId] = useState('todos');
  const [filtroSituacao, setFiltroSituacao] = useState('todos');

  const lotesNoPeriodoEProduto = useMemo(
    () =>
      lotesComSituacao.filter((l) => {
        if (filtroInicio && l.data_entrada < filtroInicio) return false;
        if (filtroFim && l.data_entrada > filtroFim) return false;
        if (filtroProdutoId !== 'todos' && l.receita_id !== filtroProdutoId) return false;
        return true;
      }),
    [lotesComSituacao, filtroInicio, filtroFim, filtroProdutoId]
  );

  const lotesListaHistorico = useMemo(
    () =>
      lotesNoPeriodoEProduto
        .filter((l) => filtroSituacao === 'todos' || l.situacao === filtroSituacao)
        .sort((a, b) => b.data_entrada.localeCompare(a.data_entrada)),
    [lotesNoPeriodoEProduto, filtroSituacao]
  );

  // Relatório de desempenho -- SOMENTE lotes concluídos (venda estimada só
  // existe para eles): agrupado por produto, tudo derivado do mesmo
  // conjunto já carregado (nenhuma tabela agregada). quantidade_produzida
  // deduplicada por producao_registro_id (um lançamento pode ter vários
  // lotes -- não pode ser somado por lote, senão duplicaria).
  const relatorio = useMemo(() => {
    const porProduto = new Map();
    for (const lote of lotesNoPeriodoEProduto) {
      if (!lote.concluido_em) continue;
      const atual = porProduto.get(lote.receita_id) || {
        produtoNome: lote.produto_nome,
        registrosVistos: new Set(),
        quantidadeProduzida: 0,
        quantidadeEnviada: 0,
        quantidadeRetirada: 0,
      };
      if (!atual.registrosVistos.has(lote.producao_registro_id)) {
        atual.registrosVistos.add(lote.producao_registro_id);
        atual.quantidadeProduzida += lote.quantidade_produzida;
      }
      atual.quantidadeEnviada += lote.quantidade_enviada;
      atual.quantidadeRetirada += lote.quantidade_retirada;
      porProduto.set(lote.receita_id, atual);
    }
    return Array.from(porProduto.values())
      .map((p) => {
        const vendaEstimada = p.quantidadeEnviada - p.quantidadeRetirada;
        const aproveitamento = p.quantidadeEnviada > 0 ? (vendaEstimada / p.quantidadeEnviada) * 100 : null;
        return { ...p, vendaEstimada, aproveitamento };
      })
      .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, 'pt-BR'));
  }, [lotesNoPeriodoEProduto]);

  // --- Criação de novo lote -----------------------------------------
  const [registroSelecionadoId, setRegistroSelecionadoId] = useState('');
  const [novoDataEntrada, setNovoDataEntrada] = useState(hoje);
  const [novaQuantidade, setNovaQuantidade] = useState('');
  const [criandoLote, setCriandoLote] = useState(false);
  const [erroNovoLote, setErroNovoLote] = useState('');

  const registroSelecionado = registrosComDisponivel.find((r) => r.id === registroSelecionadoId);

  async function criarLote() {
    if (!registroSelecionadoId || !novoDataEntrada) {
      setErroNovoLote('Selecione o lançamento e a data de entrada.');
      return;
    }
    const quantidade = novaQuantidade !== '' ? parseInt(novaQuantidade, 10) : null;
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      setErroNovoLote('Informe uma quantidade enviada maior que zero.');
      return;
    }

    setCriandoLote(true);
    setErroNovoLote('');

    const supabase = createClient();
    const { error } = await supabase.rpc('criar_lote_expositor', {
      p_registro_id: registroSelecionadoId,
      p_data_entrada: novoDataEntrada,
      p_quantidade_enviada: quantidade,
    });

    setCriandoLote(false);

    if (error) {
      setErroNovoLote(mensagemErroLoteExpositor(error));
      return;
    }

    setRegistroSelecionadoId('');
    setNovaQuantidade('');
    setNovoDataEntrada(hoje);
    recarregar('Lote criado com sucesso.');
  }

  // --- Retirada inline (painel operacional) --------------------------
  const [quantidadeRetiradaPorLote, setQuantidadeRetiradaPorLote] = useState({});
  const [concluindoLoteId, setConcluindoLoteId] = useState(null);
  const [erroRetiradaPorLote, setErroRetiradaPorLote] = useState({});

  async function confirmarRetirada(lote) {
    const valor = quantidadeRetiradaPorLote[lote.lote_id];
    const quantidade = valor !== undefined && valor !== '' ? parseInt(valor, 10) : null;

    if (!Number.isInteger(quantidade) || quantidade < 0) {
      setErroRetiradaPorLote((atual) => ({ ...atual, [lote.lote_id]: 'Informe a quantidade retirada.' }));
      return;
    }

    setConcluindoLoteId(lote.lote_id);
    setErroRetiradaPorLote((atual) => {
      const { [lote.lote_id]: _removido, ...resto } = atual;
      return resto;
    });

    const supabase = createClient();
    const { error } = await supabase.rpc('concluir_retirada_expositor', {
      p_lote_id: lote.lote_id,
      p_quantidade_retirada: quantidade,
    });

    setConcluindoLoteId(null);

    if (error) {
      setErroRetiradaPorLote((atual) => ({ ...atual, [lote.lote_id]: mensagemErroLoteExpositor(error) }));
      return;
    }

    recarregar('Retirada registrada.');
  }

  // --- Edição / correção / exclusão ----------------------------------
  const [loteParaEditar, setLoteParaEditar] = useState(null);
  const [loteParaCorrigir, setLoteParaCorrigir] = useState(null);
  const [loteParaExcluir, setLoteParaExcluir] = useState(null);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Produção</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />
        <NavegacaoProducao abaAtiva="expositores" corPrimaria={aparencia.corPrimaria} />

        {mensagemSucesso && (
          <p style={{ backgroundColor: '#e8f5e9', color: '#2e7d32', padding: '10px 15px', borderRadius: '5px', marginBottom: '15px' }}>
            {mensagemSucesso}
          </p>
        )}

        {carregando ? (
          <p>Carregando...</p>
        ) : erro ? (
          <p style={{ color: '#f44336' }}>{erro}</p>
        ) : (
          <>
            {/* Indicadores */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '25px' }}>
              <CardIndicador label="Atrasados" valor={indicadores.atrasado} cor={SITUACAO_COR.atrasado} />
              <CardIndicador label="Retirar hoje" valor={indicadores.retirar_hoje} cor={SITUACAO_COR.retirar_hoje} />
              <CardIndicador label="Retirar amanhã" valor={indicadores.retirar_amanha} cor={SITUACAO_COR.retirar_amanha} />
              <CardIndicador label="No expositor" valor={indicadores.no_expositor} cor={SITUACAO_COR.no_expositor} />
            </div>

            {/* Controle de Qualidade -- Retirar hoje */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '25px' }}>
              <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Controle de Qualidade — Retirar hoje</h2>

              {lotesUrgentes.length === 0 ? (
                <p style={{ color: '#666' }}>Nenhum lote atrasado ou previsto para hoje.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #eee' }}>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Produto</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Entrada</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Retirada prevista</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Enviado</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Qtd. retirada</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Situação</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotesUrgentes.map((lote) => (
                        <tr key={lote.lote_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px' }}>{lote.produto_nome}</td>
                          <td style={{ padding: '10px' }}>{formatarData(lote.data_entrada)}</td>
                          <td style={{ padding: '10px' }}>{formatarData(lote.data_prevista_retirada)}</td>
                          <td style={{ padding: '10px' }}>{lote.quantidade_enviada}</td>
                          <td style={{ padding: '10px' }}>
                            {podeOperar ? (
                              <input
                                type="number"
                                min="0"
                                max={lote.quantidade_enviada}
                                value={quantidadeRetiradaPorLote[lote.lote_id] ?? ''}
                                onChange={(e) =>
                                  setQuantidadeRetiradaPorLote((atual) => ({ ...atual, [lote.lote_id]: e.target.value }))
                                }
                                style={campoInlineEstilo}
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ padding: '10px' }}>
                            <BadgeSituacao situacao={lote.situacao} />
                          </td>
                          <td style={{ padding: '10px' }}>
                            {podeOperar && (
                              <BotaoIconeAcao
                                rotulo="Retirado"
                                icone={IconeCheck}
                                cor="#4CAF50"
                                disabled={concluindoLoteId === lote.lote_id}
                                onClick={() => confirmarRetirada(lote)}
                              />
                            )}
                          </td>
                          {erroRetiradaPorLote[lote.lote_id] && (
                            <td colSpan={7} style={{ padding: '0 10px 8px 10px' }}>
                              <span style={{ color: '#f44336', fontSize: '12px' }}>{erroRetiradaPorLote[lote.lote_id]}</span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {lotesAmanha.length > 0 && (
                <p style={{ marginTop: '15px', fontSize: '13px', color: '#666' }}>
                  Aviso: {lotesAmanha.length} lote(s) com retirada prevista para amanhã ({lotesAmanha.map((l) => l.produto_nome).join(', ')}).
                </p>
              )}
            </div>

            {/* Criar novo lote */}
            {podeOperar && (
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '25px' }}>
                <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Enviar produção ao expositor</h2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '15px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Lançamento</label>
                    <select
                      value={registroSelecionadoId}
                      onChange={(e) => setRegistroSelecionadoId(e.target.value)}
                      style={campoEstilo}
                    >
                      <option value="">Selecione</option>
                      {registrosComDisponivel.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatarData(r.data)} — {r.produtoNome} (disponível: {r.disponivel})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Data de entrada</label>
                    <input
                      type="date"
                      value={novoDataEntrada}
                      onChange={(e) => setNovoDataEntrada(e.target.value)}
                      style={campoEstilo}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Quantidade enviada</label>
                    <input
                      type="number"
                      min="1"
                      max={registroSelecionado?.disponivel}
                      value={novaQuantidade}
                      onChange={(e) => setNovaQuantidade(e.target.value)}
                      style={campoEstilo}
                    />
                  </div>
                </div>

                {registroSelecionado && (
                  <p style={{ fontSize: '13px', color: '#666', marginTop: '-5px', marginBottom: '15px' }}>
                    Produzido: {registroSelecionado.quantidadeProduzida} · Já enviado:{' '}
                    {registroSelecionado.quantidadeProduzida - registroSelecionado.disponivel} · Disponível para envio:{' '}
                    <strong>{registroSelecionado.disponivel}</strong>
                  </p>
                )}

                {erroNovoLote && <p style={{ color: '#f44336', marginBottom: '15px' }}>{erroNovoLote}</p>}

                <button
                  onClick={criarLote}
                  disabled={criandoLote}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: aparencia.corPrimaria,
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    opacity: criandoLote ? 0.6 : 1,
                  }}
                >
                  {criandoLote ? 'Criando...' : 'Criar lote'}
                </button>

                {registrosComDisponivel.length === 0 && (
                  <p style={{ fontSize: '13px', color: '#999', marginTop: '10px' }}>
                    Nenhum lançamento elegível nos últimos 60 dias (produto sem Controle de Expositores habilitado, ou
                    tudo já enviado).
                  </p>
                )}
              </div>
            )}

            {/* Produtos nos Expositores */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '25px' }}>
              <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Produtos nos Expositores</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Entrada -- de</label>
                  <input type="date" value={filtroInicio} onChange={(e) => setFiltroInicio(e.target.value)} style={campoEstilo} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Entrada -- até</label>
                  <input type="date" value={filtroFim} onChange={(e) => setFiltroFim(e.target.value)} style={campoEstilo} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Produto</label>
                  <select value={filtroProdutoId} onChange={(e) => setFiltroProdutoId(e.target.value)} style={campoEstilo}>
                    <option value="todos">Todos</option>
                    {produtosControlados.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Situação</label>
                  <select value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)} style={campoEstilo}>
                    <option value="todos">Todas</option>
                    <option value="atrasado">Atrasado</option>
                    <option value="retirar_hoje">Retirar hoje</option>
                    <option value="retirar_amanha">Retirar amanhã</option>
                    <option value="no_expositor">No expositor</option>
                    <option value="concluido">Concluído</option>
                  </select>
                </div>
              </div>

              {lotesListaHistorico.length === 0 ? (
                <p style={{ color: '#666' }}>Nenhum lote encontrado para os filtros selecionados.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ddd' }}>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Produto</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Data produção</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Data entrada</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Retirada prevista</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Produzido</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Enviado</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Retirado</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Venda estimada</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Situação</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotesListaHistorico.map((lote) => (
                        <tr key={lote.lote_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px' }}>{lote.produto_nome}</td>
                          <td style={{ padding: '10px' }}>{formatarData(lote.data_producao)}</td>
                          <td style={{ padding: '10px' }}>{formatarData(lote.data_entrada)}</td>
                          <td style={{ padding: '10px' }}>{formatarData(lote.data_prevista_retirada)}</td>
                          <td style={{ padding: '10px' }}>{lote.quantidade_produzida}</td>
                          <td style={{ padding: '10px' }}>{lote.quantidade_enviada}</td>
                          <td style={{ padding: '10px' }}>{lote.quantidade_retirada ?? '—'}</td>
                          <td style={{ padding: '10px' }}>{lote.venda_estimada ?? '—'}</td>
                          <td style={{ padding: '10px' }}><BadgeSituacao situacao={lote.situacao} /></td>
                          <td style={{ padding: '10px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {!lote.concluido_em && podeOperar && (
                                <BotaoIconeAcao
                                  rotulo="Editar"
                                  icone={IconeLapis}
                                  cor={aparencia.corPrimaria}
                                  onClick={() => setLoteParaEditar(lote)}
                                />
                              )}
                              {!!lote.concluido_em && podeEditarConcluido && (
                                <BotaoIconeAcao
                                  rotulo="Corrigir"
                                  icone={IconeLapis}
                                  cor={aparencia.corPrimaria}
                                  onClick={() => setLoteParaCorrigir(lote)}
                                />
                              )}
                              {podeExcluir && (
                                <BotaoIconeAcao
                                  rotulo="Excluir"
                                  icone={IconeLixeira}
                                  destrutivo
                                  onClick={() => setLoteParaExcluir(lote)}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Relatório de desempenho */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
              <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Desempenho por produto</h2>
              <p style={{ fontSize: '12px', color: '#666', marginTop: '-8px' }}>
                Somente lotes já concluídos (retirados), dentro do período/produto filtrados acima. Venda estimada nunca é
                venda real -- não alimenta o histórico de vendas nem a sugestão de produção.
              </p>

              {relatorio.length === 0 ? (
                <p style={{ color: '#666' }}>Nenhum lote concluído para os filtros selecionados.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ddd' }}>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Produto</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Produzido</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Enviado</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Retirado</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Venda estimada</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Aproveitamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatorio.map((p) => (
                        <tr key={p.produtoNome} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px' }}>{p.produtoNome}</td>
                          <td style={{ padding: '10px' }}>{p.quantidadeProduzida}</td>
                          <td style={{ padding: '10px' }}>{p.quantidadeEnviada}</td>
                          <td style={{ padding: '10px' }}>{p.quantidadeRetirada}</td>
                          <td style={{ padding: '10px' }}>{p.vendaEstimada}</td>
                          <td style={{ padding: '10px' }}>{p.aproveitamento == null ? '—' : `${p.aproveitamento.toFixed(0)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {loteParaEditar && (
        <EditarLoteExpositorModal
          lote={loteParaEditar}
          produtoNome={loteParaEditar.produto_nome}
          corPrimaria={aparencia.corPrimaria}
          onEditado={() => {
            setLoteParaEditar(null);
            recarregar('Lote atualizado.');
          }}
          onCancelar={() => setLoteParaEditar(null)}
        />
      )}

      {loteParaCorrigir && (
        <CorrigirLoteExpositorConcluidoModal
          lote={loteParaCorrigir}
          produtoNome={loteParaCorrigir.produto_nome}
          corPrimaria={aparencia.corPrimaria}
          onCorrigido={() => {
            setLoteParaCorrigir(null);
            recarregar('Correção salva.');
          }}
          onCancelar={() => setLoteParaCorrigir(null)}
        />
      )}

      {loteParaExcluir && (
        <ExcluirLoteExpositorModal
          lote={loteParaExcluir}
          produtoNome={loteParaExcluir.produto_nome}
          onExcluido={() => {
            setLoteParaExcluir(null);
            recarregar('Lote excluído.');
          }}
          onCancelar={() => setLoteParaExcluir(null)}
        />
      )}
    </div>
  );
}

export default function Expositores() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_EXPOSITORES_VISUALIZAR}>
      <ExpositoresConteudo />
    </RequireAuth>
  );
}
