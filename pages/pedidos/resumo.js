import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import PaginaPedidos from '../../components/pedidos/PaginaPedidos';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import SectionHeader from '../../components/ui/SectionHeader';
import { cx } from '../../lib/design/cx';
import estilos from '../../components/pedidos/pedidos.module.css';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { JANELA_RECEBIDOS_DIAS } from '../../lib/pedidos/resumoConfig';

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

// Indicador clicável: leva para /pedidos com o filtro correspondente já
// aplicado (mesmo `filtroStatus` de pages/pedidos.js) ou para as
// Solicitações. É um <button> de verdade (teclado e leitor de tela); a cor
// lateral acompanha o significado (atenção / alerta / ok).
function Indicador({ titulo, valor, tom = 'neutro', aoClicar, rodape }) {
  const tons = { neutro: estilos.tomNeutro, danger: estilos.tomDanger, warning: estilos.tomWarning, success: estilos.tomSuccess, info: estilos.tomInfo };
  return (
    <button type="button" className={cx(estilos.indicador, tons[tom])} onClick={aoClicar}>
      <span className={estilos.indicadorRotulo}>{titulo}</span>
      <strong className={estilos.indicadorValor}>{valor}</strong>
      {rodape && <span className={estilos.indicadorLink}>{rodape}</span>}
    </button>
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

  const colunas = [
    { chave: 'fornecedor', rotulo: 'Fornecedor', mobile: 'titulo', cartaoOrdem: 0, render: (p) => fornecedorNomePorId[p.fornecedor_id] || p.fornecedor_id },
    { chave: 'data', rotulo: 'Pedido/Data', semQuebra: true, render: (p) => formatarDataExibicao(p.data_pedido) },
    { chave: 'modalidade', rotulo: 'Modalidade', render: (p) => MODALIDADE_LABEL[p.modalidade_compra] || p.modalidade_compra },
    { chave: 'previsao', rotulo: 'Previsão', semQuebra: true, render: (p) => formatarDataExibicao(p.previsao_entrega) },
    {
      chave: 'status',
      rotulo: 'Status',
      mobile: 'titulo',
      cartaoOrdem: 1,
      render: (p) => {
        const atrasado = idsAtrasados.has(p.id);
        const previstoHoje = idsPrevistos.has(p.id);
        const rotuloStatus = atrasado ? 'Atrasado' : previstoHoje ? 'Previsto hoje' : 'Aguardando';
        const tom = atrasado ? 'danger' : previstoHoje ? 'warning' : 'neutral';
        return <Badge tom={tom}>{rotuloStatus}</Badge>;
      },
    },
  ];

  return (
    <PaginaPedidos ativo="resumo" titulo="Resumo">
      {podeVerPedidos && (
        <>
          {erroPedidos && <Alert tom="danger" className={estilos.mensagem}>{erroPedidos}</Alert>}

          {carregandoPedidos ? (
            <p role="status">Carregando resumo de pedidos...</p>
          ) : (
            <>
              <div className={estilos.indicadores}>
                <Indicador
                  titulo="Aguardando entrega"
                  valor={aguardando.length}
                  aoClicar={() => router.push('/pedidos?filtro=aguardando')}
                />
                <Indicador
                  titulo="Atrasados"
                  valor={atrasados.length}
                  tom={atrasados.length > 0 ? 'danger' : 'neutro'}
                  aoClicar={() => router.push('/pedidos?filtro=atrasados')}
                />
                <Indicador
                  titulo="Previstos para hoje"
                  valor={previstosHoje.length}
                  tom={previstosHoje.length > 0 ? 'warning' : 'neutro'}
                  aoClicar={() => router.push('/pedidos?filtro=previstos_hoje')}
                />
                <Indicador
                  titulo={`Recebidos (últimos ${JANELA_RECEBIDOS_DIAS} dias)`}
                  valor={recebidosRecentes.length}
                  tom="success"
                  aoClicar={() => router.push('/pedidos?filtro=recebidos_recentemente')}
                />
                {podeVerSolicitacoes && (
                  <Indicador
                    titulo="Solicitações pendentes"
                    valor={carregandoSolicitacoes ? '…' : totalSolicitacoesPendentes ?? '—'}
                    tom="info"
                    aoClicar={() => router.push('/pedidos/solicitacoes')}
                  />
                )}
              </div>

              <section className={estilos.secao} aria-label="Pedidos que precisam de atenção">
                <SectionHeader titulo="Pedidos que precisam de atenção" />

                {tabelaOperacional.length === 0 ? (
                  <EmptyState>Nenhum pedido aguardando entrega no momento.</EmptyState>
                ) : (
                  <div className={estilos.superficie}>
                    <DataTable
                      rotulo="Pedidos que precisam de atenção"
                      colunas={colunas}
                      linhas={tabelaOperacional}
                      chaveLinha={(p) => p.id}
                      tituloAcoes="Ação"
                      destaque={(p) => (idsAtrasados.has(p.id) ? 'aviso' : null)}
                      renderAcoes={(p) => (
                        <Button variante="secondary" tamanho="sm" icone="eye" onClick={() => abrirPedido(p.id)}>
                          Ver pedido
                        </Button>
                      )}
                    />
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {!podeVerPedidos && podeVerSolicitacoes && (
        <div className={estilos.unico}>
          <Indicador
            titulo="Solicitações pendentes"
            valor={carregandoSolicitacoes ? '…' : totalSolicitacoesPendentes ?? '—'}
            tom="info"
            rodape="Ver solicitações →"
            aoClicar={() => router.push('/pedidos/solicitacoes')}
          />
        </div>
      )}
    </PaginaPedidos>
  );
}

export default function ResumoPedidos() {
  return (
    <RequireAuth>
      <ResumoConteudo />
    </RequireAuth>
  );
}
