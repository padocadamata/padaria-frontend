import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import CabecalhoPrincipal from '../../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../../components/NavegacaoPrincipal';
import RequireAuth from '../../components/RequireAuth';
import NavegacaoPedidos from '../../components/pedidos/NavegacaoPedidos';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { JANELA_RECEBIDOS_DIAS } from '../../lib/pedidos/resumoConfig';
import { APARENCIA_FIXA } from '../../lib/branding/tema';

// Resumo operacional de Pedidos (auditoria aprovada, seções 3-6): "o que
// precisa de atenção", sem gráficos -- cards de contagem + 1 tabela
// priorizada. Construído SOMENTE com dados já existentes (nenhuma
// migration necessária para esta tela). Cada seção (Pedidos/
// Solicitações) só carrega/mostra dados se o usuário tiver a permissão
// correspondente -- NÃO é só esconder visualmente: a query de pedidos só
// roda se podeVerPedidos, a de solicitações só roda se
// podeVerSolicitacoes (seção 28 da auditoria aprovada).
//
// "Atrasado"/"previsto hoje" usam a MESMA definição já usada em
// pages/pedidos.js (status='aguardando_entrega' + previsao_entrega vs.
// hoje local). Retirada (compra_presencial) nunca aparece aqui por
// natureza -- confirmado no código real de registrar_compra_presencial
// (migration 0037): "compra presencial vive permanentemente em
// status='recebido'", nunca 'aguardando_entrega' -- não precisa de
// nenhum filtro extra para excluí-la das contagens/tabela de aguardando/
// atrasado/previsto hoje.
//
// Os 4 cards abaixo (Aguardando/Atrasados/Previstos hoje/Recebidos) são
// clicáveis e levam para /pedidos?filtro=<chave>, que pages/pedidos.js lê
// e aplica ao MESMO estado/lógica de filtro já existente (filtroStatus)
// -- nunca um segundo mecanismo de filtragem. JANELA_RECEBIDOS_DIAS vem
// de lib/pedidos/resumoConfig.js, compartilhada com pages/pedidos.js,
// para as duas telas nunca divergirem sobre o que é "recente".

const MODALIDADE_LABEL = {
  pedido_com_entrega: 'Entrega',
  compra_presencial: 'Retirada',
};

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

const caixaCardEstilo = {
  backgroundColor: 'white', borderRadius: '8px', padding: '16px 20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)', minWidth: '150px', flex: '1 1 150px',
};

// `aoClicar` é opcional -- quando presente, o card navega para /pedidos
// com o filtro correspondente já aplicado (mesmo `filtroStatus` de
// pages/pedidos.js). Acessível por teclado (role="button" + Enter/Espaço),
// igual a qualquer outro controle clicável novo do projeto.
function Card({ titulo, valor, cor, aoClicar }) {
  const clicavel = typeof aoClicar === 'function';
  return (
    <div
      style={{ ...caixaCardEstilo, ...(clicavel ? { cursor: 'pointer', border: '1px solid #eee' } : {}) }}
      onClick={aoClicar}
      role={clicavel ? 'button' : undefined}
      tabIndex={clicavel ? 0 : undefined}
      onKeyDown={
        clicavel
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                aoClicar();
              }
            }
          : undefined
      }
    >
      <p style={{ margin: 0, fontSize: '12px', color: '#999', fontWeight: 'bold', textTransform: 'uppercase' }}>{titulo}</p>
      <p style={{ margin: '6px 0 0', fontSize: '28px', fontWeight: 'bold', color: cor || '#333' }}>{valor}</p>
    </div>
  );
}

function AcessoNegado() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', textAlign: 'center', padding: '20px' }}>
      <h1 style={{ color: '#8B4513' }}>Acesso negado</h1>
      <p style={{ color: '#666', maxWidth: '420px' }}>Você não tem permissão para acessar esta página.</p>
    </div>
  );
}

function ResumoConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();

  const podeVerPedidos = hasPermissao(permissoes, PERMISSOES.PEDIDOS_VISUALIZAR);
  const podeVerSolicitacoes = hasPermissao(permissoes, PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR);

  const aparencia = APARENCIA_FIXA;

  const [pedidos, setPedidos] = useState([]);
  const [fornecedorNomePorId, setFornecedorNomePorId] = useState({});
  const [carregandoPedidos, setCarregandoPedidos] = useState(podeVerPedidos);
  const [erroPedidos, setErroPedidos] = useState('');

  const [totalSolicitacoesPendentes, setTotalSolicitacoesPendentes] = useState(null);
  const [carregandoSolicitacoes, setCarregandoSolicitacoes] = useState(podeVerSolicitacoes);

  // Query de PEDIDOS só roda se a permissão existir -- nunca busca dado
  // que o usuário não tem autorização para ver, mesmo que a RLS também
  // bloquearia (seção 28: "não usar apenas esconder visualmente").
  useEffect(() => {
    if (!podeVerPedidos) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregandoPedidos(true);
      setErroPedidos('');
      const supabase = createClient();

      const [pedidosResp, fornecedoresResp] = await Promise.all([
        supabase
          .from('pedidos')
          .select('id, fornecedor_id, data_pedido, previsao_entrega, status, modalidade_compra, recebido_em'),
        supabase.from('fornecedores').select('id, nome, nome_fantasia, razao_social'),
      ]);

      if (!ativo) return;

      if (pedidosResp.error || fornecedoresResp.error) {
        console.error('Erro ao carregar resumo de pedidos:', pedidosResp.error || fornecedoresResp.error);
        setErroPedidos('Não foi possível carregar o resumo de pedidos.');
        setCarregandoPedidos(false);
        return;
      }

      const nomePorId = {};
      for (const f of fornecedoresResp.data || []) {
        nomePorId[f.id] = f.nome_fantasia || f.razao_social || f.nome || f.id;
      }

      setPedidos(pedidosResp.data || []);
      setFornecedorNomePorId(nomePorId);
      setCarregandoPedidos(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [podeVerPedidos]);

  // Query de SOLICITAÇÕES só roda se a permissão existir -- e só busca a
  // CONTAGEM (head:true), nunca o conteúdo das solicitações em si (esta
  // tela não precisa da lista, só do indicador).
  useEffect(() => {
    if (!podeVerSolicitacoes) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregandoSolicitacoes(true);
      const supabase = createClient();
      const { count, error } = await supabase
        .from('pedidos_solicitacoes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente');

      if (!ativo) return;

      if (error) {
        console.error('Erro ao carregar contagem de solicitações pendentes:', error);
        setTotalSolicitacoesPendentes(null);
      } else {
        setTotalSolicitacoesPendentes(count ?? 0);
      }
      setCarregandoSolicitacoes(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [podeVerSolicitacoes]);

  if (!podeVerPedidos && !podeVerSolicitacoes) {
    return <AcessoNegado />;
  }

  const hoje = dataLocalHoje();
  const cutoffRecebidos = somarDias(hoje, -JANELA_RECEBIDOS_DIAS);

  const aguardando = pedidos.filter((p) => p.status === 'aguardando_entrega');
  const atrasados = aguardando.filter((p) => p.previsao_entrega && p.previsao_entrega < hoje);
  const previstosHoje = aguardando.filter((p) => p.previsao_entrega === hoje);
  const recebidosRecentes = pedidos.filter(
    (p) => p.status === 'recebido' && p.recebido_em && p.recebido_em.slice(0, 10) >= cutoffRecebidos
  );

  const idsAtrasados = new Set(atrasados.map((p) => p.id));
  const idsPrevistos = new Set(previstosHoje.map((p) => p.id));
  const demaisAguardando = aguardando.filter((p) => !idsAtrasados.has(p.id) && !idsPrevistos.has(p.id));
  const tabelaOperacional = [...atrasados, ...previstosHoje, ...demaisAguardando];

  function abrirPedido(pedidoId) {
    router.push(`/pedidos?id=${pedidoId}`);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Pedidos" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />
        <NavegacaoPedidos abaAtiva="resumo" corPrimaria={aparencia.corPrimaria} />

        <h2 style={{ color: aparencia.corPrimaria, margin: '0 0 15px' }}>Resumo</h2>

        {podeVerPedidos && (
          <>
            {erroPedidos && <p style={{ color: '#f44336' }}>{erroPedidos}</p>}

            {carregandoPedidos ? (
              <p>Carregando resumo de pedidos...</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '25px' }}>
                  <Card
                    titulo="Aguardando entrega"
                    valor={aguardando.length}
                    aoClicar={() => router.push('/pedidos?filtro=aguardando')}
                  />
                  <Card
                    titulo="Atrasados"
                    valor={atrasados.length}
                    cor={atrasados.length > 0 ? '#f44336' : '#333'}
                    aoClicar={() => router.push('/pedidos?filtro=atrasados')}
                  />
                  <Card
                    titulo="Previstos para hoje"
                    valor={previstosHoje.length}
                    cor={previstosHoje.length > 0 ? '#FF9800' : '#333'}
                    aoClicar={() => router.push('/pedidos?filtro=previstos_hoje')}
                  />
                  <Card
                    titulo={`Recebidos (últimos ${JANELA_RECEBIDOS_DIAS} dias)`}
                    valor={recebidosRecentes.length}
                    cor="#4CAF50"
                    aoClicar={() => router.push('/pedidos?filtro=recebidos_recentemente')}
                  />
                  {podeVerSolicitacoes && (
                    <div
                      onClick={() => router.push('/pedidos/solicitacoes')}
                      style={{ ...caixaCardEstilo, cursor: 'pointer', border: '1px solid #eee' }}
                    >
                      <p style={{ margin: 0, fontSize: '12px', color: '#999', fontWeight: 'bold', textTransform: 'uppercase' }}>
                        Solicitações pendentes
                      </p>
                      <p style={{ margin: '6px 0 0', fontSize: '28px', fontWeight: 'bold', color: '#2196F3' }}>
                        {carregandoSolicitacoes ? '…' : totalSolicitacoesPendentes ?? '—'}
                      </p>
                    </div>
                  )}
                </div>

                <h3 style={{ color: aparencia.corPrimaria, marginBottom: '10px' }}>
                  Pedidos que precisam de atenção
                </h3>

                {tabelaOperacional.length === 0 ? (
                  <p style={{ color: '#999' }}>Nenhum pedido aguardando entrega no momento.</p>
                ) : (
                  <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #ddd' }}>
                          {['Fornecedor', 'Pedido/Data', 'Modalidade', 'Previsão', 'Status', 'Ação'].map((coluna) => (
                            <th key={coluna} style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              {coluna}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tabelaOperacional.map((p) => {
                          const atrasado = idsAtrasados.has(p.id);
                          const previstoHoje = idsPrevistos.has(p.id);
                          const rotuloStatus = atrasado ? 'Atrasado' : previstoHoje ? 'Previsto hoje' : 'Aguardando';
                          const corStatus = atrasado ? '#f44336' : previstoHoje ? '#FF9800' : '#607D8B';
                          return (
                            <tr key={p.id} style={{ borderBottom: '1px solid #ddd' }}>
                              <td style={{ padding: '12px' }}>{fornecedorNomePorId[p.fornecedor_id] || p.fornecedor_id}</td>
                              <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(p.data_pedido)}</td>
                              <td style={{ padding: '12px' }}>{MODALIDADE_LABEL[p.modalidade_compra] || p.modalidade_compra}</td>
                              <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(p.previsao_entrega)}</td>
                              <td style={{ padding: '12px' }}>
                                <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', color: 'white', backgroundColor: corStatus, whiteSpace: 'nowrap' }}>
                                  {rotuloStatus}
                                </span>
                              </td>
                              <td style={{ padding: '12px' }}>
                                <button
                                  onClick={() => abrirPedido(p.id)}
                                  style={{ padding: '5px 10px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                                >
                                  Ver pedido
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {!podeVerPedidos && podeVerSolicitacoes && (
          <div
            onClick={() => router.push('/pedidos/solicitacoes')}
            style={{ ...caixaCardEstilo, cursor: 'pointer', maxWidth: '260px' }}
          >
            <p style={{ margin: 0, fontSize: '12px', color: '#999', fontWeight: 'bold', textTransform: 'uppercase' }}>
              Solicitações pendentes
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '28px', fontWeight: 'bold', color: '#2196F3' }}>
              {carregandoSolicitacoes ? '…' : totalSolicitacoesPendentes ?? '—'}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#2196F3' }}>Ver solicitações →</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResumoPedidos() {
  return (
    <RequireAuth>
      <ResumoConteudo />
    </RequireAuth>
  );
}
