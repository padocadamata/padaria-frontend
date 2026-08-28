import { useEffect, useState } from 'react';
import MenuOpcoes from '../../components/MenuOpcoes';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, diaDaSemanaExibicao } from '../../lib/data/dataLocal';
import { calcularSugestaoProducao } from '../../lib/producao/sugestaoProducao';

const TURNOS = [
  { chave: 'manha', label: 'Manhã' },
  { chave: 'tarde', label: 'Tarde' },
];

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Mesma técnica segura de lib/data/dataLocal.js (meio-dia local, nunca
// UTC/toISOString) — evita que somar dias empurre para o dia
// anterior/seguinte por causa do fuso horário.
function adicionarDias(dataYYYYMMDD, dias) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  data.setDate(data.getDate() + dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Domingo da semana corrente, incluindo hoje se hoje já for domingo —
// padrão inicial do filtro (decisão 2026-08-24): "hoje até o domingo da
// semana corrente", nunca "amanhã em diante".
function domingoDaSemana(dataYYYYMMDD) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  const diaSemana = data.getDay(); // 0 = domingo
  const diasAteDomingo = diaSemana === 0 ? 0 : 7 - diaSemana;
  return adicionarDias(dataYYYYMMDD, diasAteDomingo);
}

function listaDatasEntre(dataInicial, dataFinal) {
  const datas = [];
  let atual = dataInicial;
  // Guarda de segurança contra período invertido/absurdo por engano de
  // digitação — não é um limite de produto, só evita loop infinito.
  let protecao = 0;
  while (atual <= dataFinal && protecao < 3660) {
    datas.push(atual);
    atual = adicionarDias(atual, 1);
    protecao += 1;
  }
  return datas;
}

function chaveSlot(data, turno, receitaId) {
  return `${data}|${turno}|${receitaId}`;
}

const CORES_CONFIANCA = {
  'Sem base': '#9e9e9e',
  Baixa: '#f44336',
  Média: '#FF9800',
  Boa: '#4CAF50',
};

function BadgeConfianca({ confianca }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: CORES_CONFIANCA[confianca] || '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {confianca}
    </span>
  );
}

// Resumo compacto de uma linha ("8 ocorrências · média vendida 209 ·
// tendência +11%") — só formatação de apresentação, a partir dos campos
// já calculados pelo motor (nenhum cálculo novo aqui).
function resumoCompacto(resultado) {
  if (resultado.quantidadeOcorrencias === 0) {
    return null;
  }

  const partes = [
    `${resultado.quantidadeOcorrencias} ${resultado.quantidadeOcorrencias === 1 ? 'ocorrência' : 'ocorrências'}`,
  ];

  if (resultado.mediaVendida != null) {
    partes.push(`média vendida ${resultado.mediaVendida}`);
  }
  if (resultado.tendenciaPct != null) {
    const sinal = resultado.tendenciaPct >= 0 ? '+' : '';
    partes.push(`tendência ${sinal}${Math.round(resultado.tendenciaPct * 100)}%`);
  }

  return partes.join(' · ');
}

function DetalhesSugestaoModal({ detalhe, corPrimaria, onFechar }) {
  const { slot, resultado } = detalhe;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '25px',
          borderRadius: '10px',
          maxWidth: '420px',
          width: '100%',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          Detalhes da sugestão — {slot.produtoNome} ({slot.turnoLabel})
        </h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '-8px' }}>
          {formatarDataExibicao(slot.data)} · {capitalizar(diaDaSemanaExibicao(slot.data))}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
          {resultado.quantidadeSugerida != null && <strong style={{ fontSize: '18px' }}>{resultado.quantidadeSugerida} un</strong>}
          <BadgeConfianca confianca={resultado.confianca} />
        </div>

        <p style={{ fontSize: '14px', lineHeight: '1.5' }}>{resultado.justificativa}</p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onFechar}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanejamentoConteudo() {
  const { permissoes } = useAuth();
  // planejamento_producao (migration 0016) é gated inteiramente por
  // planejamento.editar — não depende mais de producao.editar.
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PLANEJAMENTO_EDITAR);

  const hoje = dataLocalHoje();

  const [carregandoBase, setCarregandoBase] = useState(true);
  const [carregandoPeriodo, setCarregandoPeriodo] = useState(true);
  const [erro, setErro] = useState('');
  const [produtos, setProdutos] = useState([]);
  const [registrosHistorico, setRegistrosHistorico] = useState([]);
  const [diasFechados, setDiasFechados] = useState(new Set());
  const [feriados, setFeriados] = useState({});
  const [edicoes, setEdicoes] = useState({});
  const [erroLinha, setErroLinha] = useState({});
  const [salvandoChave, setSalvandoChave] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [detalheAberto, setDetalheAberto] = useState(null);

  const [filtroDataInicial, setFiltroDataInicial] = useState(hoje);
  const [filtroDataFinal, setFiltroDataFinal] = useState(() => domingoDaSemana(hoje));
  const [filtroGrupo, setFiltroGrupo] = useState('todos');
  const [filtroProduto, setFiltroProduto] = useState('todos');
  const [filtroTurno, setFiltroTurno] = useState('todos');

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
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

    const handleAparenciaAlterada = () => {
      const novaConfig = localStorage.getItem('aparenciaConfig');

      if (novaConfig) {
        try {
          setAparencia(JSON.parse(novaConfig));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  // Efeito 1 — produtos controlados + histórico fechado: independentes do
  // período visível, carregados uma única vez na montagem.
  useEffect(() => {
    async function carregarBase() {
      setCarregandoBase(true);

      const supabase = createClient();

      const produtosResp = await supabase
        .from('receitas')
        .select('id, nome, grupo')
        .eq('ativo', true)
        .eq('controlado_producao', true)
        .order('grupo', { ascending: true })
        .order('nome', { ascending: true });

      if (produtosResp.error) {
        console.error('Erro ao carregar produtos controlados:', produtosResp.error);
        setErro('Não foi possível carregar os produtos de produção.');
        setCarregandoBase(false);
        return;
      }

      const idsControlados = (produtosResp.data || []).map((p) => p.id);

      const historicoResp =
        idsControlados.length > 0
          ? await supabase
              .from('producao_registros')
              .select(
                'id, data, turno, receita_id, status, quantidade_produzida, quantidade_vendida, sobra_total, sobra_aproveitavel, perda_descarte'
              )
              .eq('status', 'fechado')
              .in('receita_id', idsControlados)
          : { data: [], error: null };

      if (historicoResp.error) {
        console.error('Erro ao carregar histórico de produção:', historicoResp.error);
        setErro('Não foi possível carregar o histórico de produção.');
        setCarregandoBase(false);
        return;
      }

      setProdutos(produtosResp.data || []);
      setRegistrosHistorico(historicoResp.data || []);
      setCarregandoBase(false);
    }

    carregarBase();
  }, []);

  const periodoValido =
    filtroDataInicial !== '' && filtroDataFinal !== '' && filtroDataFinal >= filtroDataInicial;

  let erroPeriodo = '';
  if (filtroDataInicial === '') {
    erroPeriodo = 'Data inicial é obrigatória.';
  } else if (filtroDataFinal === '') {
    erroPeriodo = 'Data final é obrigatória.';
  } else if (filtroDataFinal < filtroDataInicial) {
    erroPeriodo = 'Data final não pode ser anterior à data inicial.';
  }

  // Efeito 2 — dias fechados, feriados e planejamento já salvo: dependem
  // do período escolhido, recarregados sempre que ele muda.
  useEffect(() => {
    if (!periodoValido) {
      setCarregandoPeriodo(false);
      return;
    }

    let efeitoAtivo = true;

    async function carregarPeriodo() {
      setCarregandoPeriodo(true);

      const supabase = createClient();

      const [diasResp, feriadosResp, planejamentoResp] = await Promise.all([
        supabase
          .from('producao_dias')
          .select('data, fechado, motivo_fechamento')
          .gte('data', filtroDataInicial)
          .lte('data', filtroDataFinal)
          .eq('fechado', true),
        supabase
          .from('feriados_nacionais')
          .select('data, nome')
          .gte('data', filtroDataInicial)
          .lte('data', filtroDataFinal),
        supabase
          .from('planejamento_producao')
          .select('id, data, turno, receita_id, quantidade_planejada, observacao')
          .gte('data', filtroDataInicial)
          .lte('data', filtroDataFinal),
      ]);

      if (!efeitoAtivo) {
        return;
      }

      const primeiroErro = diasResp.error || feriadosResp.error || planejamentoResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar dados do período de planejamento:', primeiroErro);
        setErro('Não foi possível carregar os dados do período selecionado.');
        setCarregandoPeriodo(false);
        return;
      }

      const mapaFeriados = {};
      for (const f of feriadosResp.data || []) {
        mapaFeriados[f.data] = f.nome;
      }

      const diasFechadosSet = new Set((diasResp.data || []).map((d) => d.data));

      const mapaEdicoes = {};
      for (const p of planejamentoResp.data || []) {
        mapaEdicoes[chaveSlot(p.data, p.turno, p.receita_id)] = {
          id: p.id,
          quantidade: p.quantidade_planejada != null ? String(p.quantidade_planejada) : '',
          observacao: p.observacao || '',
        };
      }

      setDiasFechados(diasFechadosSet);
      setFeriados(mapaFeriados);
      setEdicoes(mapaEdicoes);
      setErroLinha({});
      setCarregandoPeriodo(false);
    }

    setErro('');
    carregarPeriodo();

    return () => {
      efeitoAtivo = false;
    };
  }, [filtroDataInicial, filtroDataFinal, periodoValido]);

  function atualizarEdicao(chave, campo, valor) {
    setEdicoes((atual) => ({
      ...atual,
      [chave]: { ...(atual[chave] || { id: null, quantidade: '', observacao: '' }), [campo]: valor },
    }));
    setErroLinha((atual) => {
      if (!atual[chave]) return atual;
      const { [chave]: _remover, ...resto } = atual;
      return resto;
    });
  }

  function aceitarSugestao(chave, quantidadeSugerida) {
    atualizarEdicao(chave, 'quantidade', String(quantidadeSugerida));
  }

  async function salvarSlot(slot) {
    const chave = chaveSlot(slot.data, slot.turno, slot.receitaId);
    const edicao = edicoes[chave] || { id: null, quantidade: '', observacao: '' };

    const quantidadeTexto = edicao.quantidade.trim();
    const observacaoTexto = edicao.observacao.trim();

    if (quantidadeTexto === '' && observacaoTexto === '') {
      setErroLinha((atual) => ({
        ...atual,
        [chave]: 'Informe uma quantidade planejada ou uma observação.',
      }));
      return;
    }

    let quantidadePlanejada = null;
    if (quantidadeTexto !== '') {
      const numero = parseInt(quantidadeTexto, 10);
      if (!Number.isInteger(numero) || numero < 0) {
        setErroLinha((atual) => ({
          ...atual,
          [chave]: 'Quantidade planejada deve ser um número inteiro maior ou igual a zero.',
        }));
        return;
      }
      quantidadePlanejada = numero;
    }

    setSalvandoChave(chave);
    setErroLinha((atual) => {
      if (!atual[chave]) return atual;
      const { [chave]: _remover, ...resto } = atual;
      return resto;
    });

    const supabase = createClient();
    const { data, error } = await supabase
      .from('planejamento_producao')
      .upsert(
        {
          data: slot.data,
          turno: slot.turno,
          receita_id: slot.receitaId,
          quantidade_planejada: quantidadePlanejada,
          observacao: observacaoTexto || null,
        },
        { onConflict: 'data,turno,receita_id' }
      )
      .select('id')
      .single();

    setSalvandoChave(null);

    if (error) {
      console.error('Erro ao salvar planejamento:', error);
      setErroLinha((atual) => ({
        ...atual,
        [chave]: 'Não foi possível salvar. Tente novamente ou avise um administrador.',
      }));
      return;
    }

    setEdicoes((atual) => ({
      ...atual,
      [chave]: { ...atual[chave], id: data?.id ?? atual[chave]?.id ?? null },
    }));
    setMensagemSucesso('Planejamento salvo.');
  }

  const gruposDisponiveis = Array.from(
    new Set(produtos.map((p) => p.grupo).filter((g) => g != null && g !== ''))
  ).sort();

  const produtosFiltrados = produtos.filter((p) => {
    if (filtroGrupo !== 'todos' && p.grupo !== filtroGrupo) return false;
    if (filtroProduto !== 'todos' && p.id !== filtroProduto) return false;
    return true;
  });

  const datasHorizonte = periodoValido ? listaDatasEntre(filtroDataInicial, filtroDataFinal) : [];

  const registrosPorReceita = {};
  for (const r of registrosHistorico) {
    if (!registrosPorReceita[r.receita_id]) {
      registrosPorReceita[r.receita_id] = [];
    }
    registrosPorReceita[r.receita_id].push(r);
  }

  const turnosFiltrados = filtroTurno === 'todos' ? TURNOS : TURNOS.filter((t) => t.chave === filtroTurno);

  const slots = [];
  for (const data of datasHorizonte) {
    for (const turno of turnosFiltrados) {
      for (const produto of produtosFiltrados) {
        slots.push({
          data,
          turno: turno.chave,
          turnoLabel: turno.label,
          receitaId: produto.id,
          produtoNome: produto.nome,
          grupo: produto.grupo,
        });
      }
    }
  }

  const carregando = carregandoBase || carregandoPeriodo;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img
                src={aparencia.logoBase64}
                style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }}
                alt="Logo"
              />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>

          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <NavegacaoProducao abaAtiva="planejamento" corPrimaria={aparencia.corPrimaria} />

        <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Planejamento</h2>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '5px' }}>
          Sugestão calculada a partir do histórico fechado — nunca gravada automaticamente. Só vira
          Planejamento de verdade quando você clicar em Salvar.
        </p>

        {mensagemSucesso && (
          <p style={{ color: '#4CAF50', fontWeight: 'bold', marginTop: '10px' }}>{mensagemSucesso}</p>
        )}
        {erro && <p style={{ color: '#f44336', marginTop: '10px' }}>{erro}</p>}

        <div
          style={{
            backgroundColor: '#f9f9f9',
            padding: '15px',
            borderRadius: '5px',
            marginBottom: '20px',
            marginTop: '15px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '15px',
            }}
          >
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Data inicial</label>
              <input
                type="date"
                value={filtroDataInicial}
                onChange={(e) => setFiltroDataInicial(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Data final</label>
              <input
                type="date"
                value={filtroDataFinal}
                onChange={(e) => setFiltroDataFinal(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Grupo</label>
              <select
                value={filtroGrupo}
                onChange={(e) => setFiltroGrupo(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              >
                <option value="todos">Todos</option>
                {gruposDisponiveis.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Produto</label>
              <select
                value={filtroProduto}
                onChange={(e) => setFiltroProduto(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              >
                <option value="todos">Todos</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Turno</label>
              <select
                value={filtroTurno}
                onChange={(e) => setFiltroTurno(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              >
                <option value="todos">Todos</option>
                <option value="manha">Manhã</option>
                <option value="tarde">Tarde</option>
              </select>
            </div>
          </div>

          {erroPeriodo && (
            <p style={{ color: '#f44336', fontSize: '13px', marginTop: '10px', marginBottom: 0 }}>{erroPeriodo}</p>
          )}
        </div>

        {!periodoValido ? (
          <p style={{ color: '#f44336' }}>Selecione um período válido para ver o planejamento.</p>
        ) : carregando ? (
          <p>Carregando planejamento...</p>
        ) : produtosFiltrados.length === 0 ? (
          <p>Nenhum produto ativo e marcado para exibir na Tela Hoje foi encontrado.</p>
        ) : (
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '5px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  {['Data', 'Dia da semana', 'Grupo', 'Produto', 'Turno', 'Sugestão', 'Quantidade planejada', 'Observação', 'Ações'].map(
                    (coluna) => (
                      <th
                        key={coluna}
                        style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold', whiteSpace: 'nowrap' }}
                      >
                        {coluna}
                      </th>
                    )
                  )}
                </tr>
              </thead>

              <tbody>
                {slots.map((slot) => {
                  const chave = chaveSlot(slot.data, slot.turno, slot.receitaId);
                  const edicao = edicoes[chave] || { id: null, quantidade: '', observacao: '' };
                  const fechado = diasFechados.has(slot.data);
                  const feriado = feriados[slot.data];

                  let resultado = null;
                  if (!fechado) {
                    resultado = calcularSugestaoProducao({
                      registros: registrosPorReceita[slot.receitaId] || [],
                      dataAlvo: slot.data,
                      turno: slot.turno,
                      diasFechados,
                    });
                  }

                  const desabilitado = fechado || !podeEditar;
                  const resumo = resultado ? resumoCompacto(resultado) : null;

                  return (
                    <tr key={chave} style={{ borderBottom: '1px solid #ddd', backgroundColor: fechado ? '#f5f5f5' : 'transparent' }}>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                        {formatarDataExibicao(slot.data)}
                        {feriado && (
                          <span title={`Feriado: ${feriado}`} style={{ marginLeft: '6px' }}>
                            🎉
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{capitalizar(diaDaSemanaExibicao(slot.data))}</td>
                      <td style={{ padding: '12px' }}>{slot.grupo || '—'}</td>
                      <td style={{ padding: '12px' }}>{slot.produtoNome}</td>
                      <td style={{ padding: '12px' }}>{slot.turnoLabel}</td>
                      <td style={{ padding: '12px', minWidth: '220px' }}>
                        {fechado ? (
                          <span style={{ color: '#999', fontStyle: 'italic', fontSize: '13px' }}>
                            Dia fechado — sem sugestão operacional.
                          </span>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', flexWrap: 'wrap' }}>
                              {resultado.quantidadeSugerida != null ? (
                                <strong>{resultado.quantidadeSugerida} un</strong>
                              ) : (
                                <span style={{ color: '#999', fontSize: '13px' }}>Sem sugestão</span>
                              )}
                              <BadgeConfianca confianca={resultado.confianca} />
                              <button
                                type="button"
                                onClick={() => setDetalheAberto({ slot, resultado })}
                                title="Ver justificativa completa"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: aparencia.corPrimaria,
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                  padding: 0,
                                  textDecoration: 'underline',
                                }}
                              >
                                ⓘ Detalhes
                              </button>
                            </div>
                            {resumo && <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{resumo}</p>}
                          </>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <input
                          type="number"
                          min="0"
                          value={edicao.quantidade}
                          disabled={desabilitado}
                          onChange={(e) => atualizarEdicao(chave, 'quantidade', e.target.value)}
                          style={{
                            width: '90px',
                            padding: '6px',
                            border: '1px solid #ddd',
                            borderRadius: '5px',
                            boxSizing: 'border-box',
                            backgroundColor: desabilitado ? '#f0f0f0' : 'white',
                          }}
                        />
                      </td>
                      <td style={{ padding: '12px' }}>
                        <input
                          type="text"
                          value={edicao.observacao}
                          disabled={desabilitado}
                          onChange={(e) => atualizarEdicao(chave, 'observacao', e.target.value)}
                          style={{
                            width: '140px',
                            padding: '6px',
                            border: '1px solid #ddd',
                            borderRadius: '5px',
                            boxSizing: 'border-box',
                            backgroundColor: desabilitado ? '#f0f0f0' : 'white',
                          }}
                        />
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {!fechado && podeEditar && resultado.quantidadeSugerida != null && (
                              <button
                                onClick={() => aceitarSugestao(chave, resultado.quantidadeSugerida)}
                                style={{
                                  padding: '6px 10px',
                                  backgroundColor: '#2196F3',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                }}
                              >
                                Aceitar sugestão
                              </button>
                            )}
                            {!fechado && podeEditar && (
                              <button
                                onClick={() => salvarSlot(slot)}
                                disabled={salvandoChave === chave}
                                style={{
                                  padding: '6px 10px',
                                  backgroundColor: aparencia.corPrimaria,
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: salvandoChave === chave ? 'not-allowed' : 'pointer',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                }}
                              >
                                {salvandoChave === chave ? 'Salvando...' : 'Salvar'}
                              </button>
                            )}
                          </div>
                          {erroLinha[chave] && (
                            <span style={{ color: '#f44336', fontSize: '11px' }}>{erroLinha[chave]}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detalheAberto && (
        <DetalhesSugestaoModal
          detalhe={detalheAberto}
          corPrimaria={aparencia.corPrimaria}
          onFechar={() => setDetalheAberto(null)}
        />
      )}
    </div>
  );
}

export default function Planejamento() {
  return (
    <RequireAuth permissao={PERMISSOES.PLANEJAMENTO_VISUALIZAR}>
      <PlanejamentoConteudo />
    </RequireAuth>
  );
}
