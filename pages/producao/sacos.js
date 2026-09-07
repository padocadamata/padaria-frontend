import { useEffect, useMemo, useState } from 'react';
import MenuOpcoes from '../../components/MenuOpcoes';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoProducao from '../../components/producao/NavegacaoProducao';
import AbrirSacoModal from '../../components/producao/AbrirSacoModal';
import LancarSaldoInicialModal from '../../components/producao/LancarSaldoInicialModal';
import EditarMovimentacaoSacoModal from '../../components/producao/EditarMovimentacaoSacoModal';
import { BotaoIconeAcao, IconeCaixa, IconeLapis } from '../../components/producao/IconesAcoes';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { mensagemErroSacos, TIPO_MOVIMENTO_LABEL, ORIGEM_MOVIMENTO_LABEL } from '../../lib/producao/mensagensSacos';

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

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

function SacosConteudo() {
  const { permissoes, usuarioAuth } = useAuth();
  const podeVisualizar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_VISUALIZAR);
  const podeOperar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_OPERAR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_SACOS_EDITAR);

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

  const [configsRaw, setConfigsRaw] = useState([]);
  const [movimentacoesRaw, setMovimentacoesRaw] = useState([]);
  const [usuariosPorId, setUsuariosPorId] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

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
      const [{ data: configsData, error: erroConfigs }, { data: movsData, error: erroMovs }, { data: usuariosData }] =
        await Promise.all([
          supabase.rpc('listar_sacos_fechados_configuracoes'),
          supabase
            .from('sacos_fechados_movimentacoes')
            .select('id, produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot, tipo, origem, observacao, criado_por, criado_em')
            .order('criado_em', { ascending: false })
            .limit(500),
          // Best-effort: RLS de usuarios (0005b) só libera a própria linha
          // ou admin -- um operador comum não vê nome de outros usuários
          // aqui, e a coluna "Responsável" cai no fallback (id truncado)
          // para os que não resolverem. Não é um erro, é o esperado.
          supabase.from('usuarios').select('id, nome'),
        ]);

      if (!efeitoAtivo) return;

      if (erroConfigs || erroMovs) {
        const erroReal = erroConfigs || erroMovs;
        if (process.env.NODE_ENV !== 'production') {
          console.error('Erro ao carregar Sacos Fechados:', erroReal);
        }
        setErro(mensagemErroSacos(erroReal));
        setCarregando(false);
        return;
      }

      setConfigsRaw(configsData || []);
      setMovimentacoesRaw(movsData || []);

      const mapaUsuarios = {};
      for (const u of usuariosData || []) {
        mapaUsuarios[u.id] = u.nome;
      }
      setUsuariosPorId(mapaUsuarios);

      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recarregarTick]);

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
    const idsComSaldoInicial = new Set(
      movimentacoesRaw.filter((m) => m.tipo === 'saldo_inicial').map((m) => m.produto_fornecedor_id)
    );
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
  }, [configsRaw, movimentacoesRaw]);

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

  // Filtro simples por produto (client-side, sobre o mesmo conjunto já
  // carregado) -- não precisa de nova query.
  const [filtroConfigId, setFiltroConfigId] = useState('todos');
  const movimentacoesFiltradas = useMemo(
    () => (filtroConfigId === 'todos' ? movimentacoes : movimentacoes.filter((m) => m.produto_fornecedor_id === filtroConfigId)),
    [movimentacoes, filtroConfigId]
  );

  const [configuracaoParaAbrir, setConfiguracaoParaAbrir] = useState(null);
  const [configuracaoParaSaldoInicial, setConfiguracaoParaSaldoInicial] = useState(null);
  const [movimentacaoParaEditar, setMovimentacaoParaEditar] = useState(null);

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
                      {configuracoesControladas.map((c) => (
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
            </div>

            {/* Movimentações */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
                <h2 style={{ color: aparencia.corPrimaria, margin: 0 }}>Movimentações</h2>

                <div style={{ minWidth: '220px' }}>
                  <select value={filtroConfigId} onChange={(e) => setFiltroConfigId(e.target.value)} style={campoEstilo}>
                    <option value="todos">Todos os produtos</option>
                    {configuracoesControladas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.produtoNome} — {c.fornecedorNome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {movimentacoesFiltradas.length === 0 ? (
                <p style={{ color: '#666' }}>Nenhuma movimentação registrada ainda.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
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
                      {movimentacoesFiltradas.map((m) => {
                        const positivo = m.quantidade_sacos > 0;
                        const editavel = podeEditar && (m.tipo === 'abertura' || m.tipo === 'ajuste_manual' || m.tipo === 'saldo_inicial');
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
                            <td style={{ padding: '10px' }}>
                              {editavel && (
                                <BotaoIconeAcao
                                  rotulo="Editar"
                                  icone={IconeLapis}
                                  cor={aparencia.corPrimaria}
                                  onClick={() => setMovimentacaoParaEditar(m)}
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
