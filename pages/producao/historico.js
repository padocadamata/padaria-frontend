import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MenuOpcoes from '../../components/MenuOpcoes';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import ReaberturaModal from '../../components/producao/ReaberturaModal';
import FechamentoTurnoForm from '../../components/producao/FechamentoTurnoForm';
import GerenciarSobrasModal from '../../components/producao/GerenciarSobrasModal';
import VisualizarRegistroModal from '../../components/producao/VisualizarRegistroModal';
import { PERMISSOES, hasPermissao, isAdmin } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';

const TURNO_LABEL = { manha: 'Manhã', tarde: 'Tarde' };

// Ordem explícita de exibição dentro do mesmo dia — não depende de
// 'manha' < 'tarde' ser alfabeticamente verdade, é uma regra própria.
const TURNO_ORDEM = { manha: 0, tarde: 1 };

const STATUS_LABEL = { aberto: 'Aberto', fechado: 'Fechado', reaberto: 'Reaberto' };
const ORIGEM_LABEL = { manual: 'Manual', historico: 'Histórico' };

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarPercentualVenda(quantidadeVendida, quantidadeProduzida) {
  if (quantidadeVendida == null || !quantidadeProduzida) {
    return '—';
  }

  const percentual = (quantidadeVendida / quantidadeProduzida) * 100;
  return `${percentual.toFixed(1)}%`;
}

function ordenarRegistros(registros) {
  return [...registros].sort((a, b) => {
    if (a.data !== b.data) {
      return a.data < b.data ? 1 : -1; // data decrescente
    }
    return TURNO_ORDEM[a.turno] - TURNO_ORDEM[b.turno]; // manhã antes de tarde
  });
}

function BadgeStatus({ status }) {
  const cores = { aberto: '#FF9800', fechado: '#4CAF50', reaberto: '#f44336' };

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: cores[status] || '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function BadgeOrigem({ origem }) {
  const historico = origem === 'historico';

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: historico ? '#795548' : '#2196F3',
        whiteSpace: 'nowrap',
      }}
    >
      {ORIGEM_LABEL[origem] || origem}
    </span>
  );
}

function HistoricoConteudo() {
  const router = useRouter();
  const { permissoes, perfilUsuario } = useAuth();

  const [registros, setRegistros] = useState([]);
  const [receitaNomePorId, setReceitaNomePorId] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [registroVisualizado, setRegistroVisualizado] = useState(null);
  const [acaoRegistro, setAcaoRegistro] = useState(null); // { tipo: 'reabrir' | 'fechar' | 'sobras', registro }
  const [recarregarTick, setRecarregarTick] = useState(0);

  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');
  const [filtroProduto, setFiltroProduto] = useState('todos');
  const [filtroTurno, setFiltroTurno] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroOrigem, setFiltroOrigem] = useState('todos');

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

  // Carga única (mesmo raciocínio de volume pequeno já usado em
  // pages/producao/produtos.js — hoje 107 registros). Se o volume crescer
  // muito com o tempo, isso deve migrar para filtro de período server-side.
  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarHistorico() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      const [registrosResp, receitasResp] = await Promise.all([
        supabase
          .from('producao_registros')
          .select(
            'id, data, turno, receita_id, origem, status, quantidade_produzida, quantidade_vendida, sobra_total, sobra_aproveitavel, perda_descarte, observacoes, criado_em, atualizado_em'
          ),
        supabase.from('receitas').select('id, nome'),
      ]);

      if (!efeitoAtivo) {
        return;
      }

      const primeiroErro = registrosResp.error || receitasResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar histórico de produção:', primeiroErro);
        setErro('Não foi possível carregar o histórico de produção.');
        setRegistros([]);
        setReceitaNomePorId({});
        setCarregando(false);
        return;
      }

      const mapa = {};
      for (const r of receitasResp.data || []) {
        mapa[r.id] = r.nome;
      }

      setRegistros(ordenarRegistros(registrosResp.data || []));
      setReceitaNomePorId(mapa);
      setCarregando(false);
    }

    carregarHistorico();

    return () => {
      efeitoAtivo = false;
    };
  }, [recarregarTick]);

  function abrirVisualizar(registro) {
    setRegistroVisualizado(registro);
  }

  function fecharVisualizar() {
    setRegistroVisualizado(null);
  }

  function abrirAcao(tipo, registro) {
    setAcaoRegistro({ tipo, registro });
  }

  function fecharAcao() {
    setAcaoRegistro(null);
  }

  function aoAtualizarRegistro() {
    fecharAcao();
    setRecarregarTick((tick) => tick + 1);
  }

  const produtosDisponiveis = Array.from(
    new Set(registros.map((r) => r.receita_id))
  )
    .map((id) => ({ id, nome: receitaNomePorId[id] || id }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // Rota A (decisão de 2026-08-24): historico.editar é o gate de TELA das
  // ações de edição do Histórico; a RLS real de producao_registros continua
  // exigindo producao.editar por baixo. Os dois têm que estar vigentes —
  // ter só um dos dois não é suficiente (evita mostrar um botão que a RLS
  // recusaria, ou destravar a tela sem a permissão operacional real).
  const podeEditar =
    hasPermissao(permissoes, PERMISSOES.HISTORICO_EDITAR) &&
    hasPermissao(permissoes, PERMISSOES.PRODUCAO_EDITAR);

  function podeReabrirRegistro(registro) {
    return registro.origem === 'historico'
      ? isAdmin(perfilUsuario)
      : hasPermissao(permissoes, PERMISSOES.PRODUCAO_CANCELAR);
  }

  // Gerenciar sobras: producao.editar (+ historico.editar, gate de tela)
  // para manual (ação operacional, não estrutural), admin para histórico —
  // mesma regra de CardTurno.js, mas com o gate de tela do Histórico
  // aplicado por cima.
  function podeGerenciarSobrasRegistro(registro) {
    return registro.origem === 'historico' ? isAdmin(perfilUsuario) : podeEditar;
  }

  const registrosFiltrados = registros.filter((registro) => {
    if (filtroPeriodoInicio && registro.data < filtroPeriodoInicio) return false;
    if (filtroPeriodoFim && registro.data > filtroPeriodoFim) return false;
    if (filtroProduto !== 'todos' && registro.receita_id !== filtroProduto) return false;
    if (filtroTurno !== 'todos' && registro.turno !== filtroTurno) return false;
    if (filtroStatus !== 'todos' && registro.status !== filtroStatus) return false;
    if (filtroOrigem !== 'todos' && registro.origem !== filtroOrigem) return false;
    return true;
  });

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
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: aparencia.corPrimaria,
              border: '1px solid ' + aparencia.corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Dashboard
          </button>

          <button
            onClick={() => router.push('/fornecedores')}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: aparencia.corPrimaria,
              border: '1px solid ' + aparencia.corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Fornecedores
          </button>

          <button
            onClick={() => router.push('/producao')}
            style={{
              padding: '10px 20px',
              backgroundColor: aparencia.corPrimaria,
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Produção
          </button>
        </div>

        <NavegacaoProducao abaAtiva="historico" corPrimaria={aparencia.corPrimaria} />

        <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Histórico</h2>

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
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Período inicial
              </label>
              <input
                type="date"
                value={filtroPeriodoInicio}
                onChange={(e) => setFiltroPeriodoInicio(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Período final
              </label>
              <input
                type="date"
                value={filtroPeriodoFim}
                onChange={(e) => setFiltroPeriodoFim(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Produto
              </label>
              <select
                value={filtroProduto}
                onChange={(e) => setFiltroProduto(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todos">Todos</option>
                {produtosDisponiveis.map((produto) => (
                  <option key={produto.id} value={produto.id}>
                    {produto.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Turno
              </label>
              <select
                value={filtroTurno}
                onChange={(e) => setFiltroTurno(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todos">Todos</option>
                <option value="manha">Manhã</option>
                <option value="tarde">Tarde</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Status
              </label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todos">Todos</option>
                <option value="aberto">Aberto</option>
                <option value="fechado">Fechado</option>
                <option value="reaberto">Reaberto</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                Origem
              </label>
              <select
                value={filtroOrigem}
                onChange={(e) => setFiltroOrigem(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todos">Todas</option>
                <option value="manual">Manual</option>
                <option value="historico">Histórico</option>
              </select>
            </div>
          </div>
        </div>

        {carregando ? (
          <p>Carregando histórico...</p>
        ) : registros.length === 0 ? (
          <p>Nenhum registro encontrado.</p>
        ) : registrosFiltrados.length === 0 ? (
          <p>Nenhum resultado para esta busca/filtro.</p>
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
                  {[
                    'Data',
                    'Produto',
                    'Turno',
                    'Produzido',
                    'Vendido',
                    '% Venda',
                    'Sobra total',
                    'Status/Origem',
                    'Obs.',
                    'Ações',
                  ].map((coluna) => (
                    <th
                      key={coluna}
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        color: aparencia.corPrimaria,
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {registrosFiltrados.map((registro) => {
                  const pendente = registro.status !== 'fechado';
                  const temObservacao = !!(registro.observacoes && registro.observacoes.trim());

                  return (
                    <tr
                      key={registro.id}
                      style={{
                        borderBottom: '1px solid #ddd',
                        backgroundColor: pendente ? '#fff8e1' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                        {formatarDataExibicao(registro.data)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {receitaNomePorId[registro.receita_id] || registro.receita_id}
                      </td>
                      <td style={{ padding: '12px' }}>{TURNO_LABEL[registro.turno] || registro.turno}</td>
                      <td style={{ padding: '12px' }}>{registro.quantidade_produzida}</td>
                      <td style={{ padding: '12px' }}>{registro.quantidade_vendida ?? '—'}</td>
                      <td style={{ padding: '12px' }}>
                        {formatarPercentualVenda(registro.quantidade_vendida, registro.quantidade_produzida)}
                      </td>
                      <td style={{ padding: '12px' }}>{registro.sobra_total ?? '—'}</td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          <BadgeStatus status={registro.status} />
                          <BadgeOrigem origem={registro.origem} />
                          {pendente && (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#8a6d00',
                                backgroundColor: '#ffe082',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Pendência
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        {temObservacao ? (
                          <span
                            title="Possui observação"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              backgroundColor: '#FF9800',
                              color: 'white',
                              fontWeight: 'bold',
                              fontSize: '12px',
                              cursor: 'default',
                            }}
                          >
                            !
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => abrirVisualizar(registro)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#9e9e9e',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            Visualizar
                          </button>

                          {registro.status === 'aberto' && podeEditar && (
                            <button
                              onClick={() => abrirAcao('fechar', registro)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#FF9800',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '13px',
                              }}
                            >
                              Fechar agora
                            </button>
                          )}

                          {registro.status === 'reaberto' && podeEditar && (
                            <button
                              onClick={() => abrirAcao('fechar', registro)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: aparencia.corPrimaria,
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '13px',
                              }}
                            >
                              Corrigir e fechar
                            </button>
                          )}

                          {registro.status === 'fechado' && podeGerenciarSobrasRegistro(registro) && (
                            <button
                              onClick={() => abrirAcao('sobras', registro)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#FF9800',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '13px',
                              }}
                            >
                              Gerenciar sobras
                            </button>
                          )}

                          {registro.status === 'fechado' && podeReabrirRegistro(registro) && (
                            <button
                              onClick={() => abrirAcao('reabrir', registro)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#9e9e9e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '13px',
                              }}
                            >
                              Reabrir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p style={{ marginTop: '15px', color: '#666', fontSize: '14px' }}>
              Total de registros: <strong>{registrosFiltrados.length}</strong>
            </p>
          </div>
        )}
      </div>

      {registroVisualizado && (
        <VisualizarRegistroModal
          registro={registroVisualizado}
          receitaNome={receitaNomePorId[registroVisualizado.receita_id] || registroVisualizado.receita_id}
          turnoLabel={TURNO_LABEL[registroVisualizado.turno] || registroVisualizado.turno}
          corPrimaria={aparencia.corPrimaria}
          onFechar={fecharVisualizar}
        />
      )}

      {acaoRegistro?.tipo === 'reabrir' && (
        <ReaberturaModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onReaberto={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'fechar' && (
        <FechamentoTurnoForm
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onFechado={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}

      {acaoRegistro?.tipo === 'sobras' && (
        <GerenciarSobrasModal
          registro={acaoRegistro.registro}
          receitaNome={receitaNomePorId[acaoRegistro.registro.receita_id] || acaoRegistro.registro.receita_id}
          turnoLabel={TURNO_LABEL[acaoRegistro.registro.turno] || acaoRegistro.registro.turno}
          corPrimaria={aparencia.corPrimaria}
          onAtualizado={aoAtualizarRegistro}
          onCancelar={fecharAcao}
        />
      )}
    </div>
  );
}

export default function Historico() {
  return (
    <RequireAuth permissao={PERMISSOES.HISTORICO_VISUALIZAR}>
      <HistoricoConteudo />
    </RequireAuth>
  );
}
