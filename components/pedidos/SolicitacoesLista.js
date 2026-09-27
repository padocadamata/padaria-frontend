import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import AcoesLinha from '../ui/AcoesLinha';
import Icon from '../ui/Icon';
import { formatarPrecoBase, formatarDataHistorico } from '../../lib/pedidos/historicoCompras';
import estilos from './pedidos.module.css';

// Lista de solicitações internas de compra. Ordenação já vem pronta de
// quem chama (pages/pedidos/solicitacoes.js: data_solicitacao ASC, depois
// criado_em ASC -- mais antigas pendentes primeiro, seção 17 da auditoria
// aprovada) -- este componente só renderiza, não decide ordem/filtro.
//
// UMA definição de colunas e UMA lista de ações por solicitação alimentam a
// tabela (desktop) e os cartões (mobile) -- os handlers são exatamente os
// recebidos de quem chama; confirmação de ações destrutivas acontece lá
// (ConfirmarAcaoModal), nunca aqui.
//   Desktop: ações em ícones com rótulo acessível (como antes).
//   Mobile: as ações de uso frequente (Criar pedido / Marcar como realizada /
//   Abrir pedido) ficam VISÍVEIS com texto; as secundárias (Editar, Excluir,
//   Reabrir/Excluir pedido) ficam agrupadas em "Mais ações".
//
// Reabrir/Excluir pedido só aparecem para uma solicitação realizada COM
// pedido_id, são gated pelas permissões de PEDIDOS (podeReabrirPedido/
// podeExcluirPedido -- nunca pedidos_solicitacoes.*, ver lib/auth/
// permissoes.js) e só quando o status/modalidade atuais do pedido
// vinculado permitem a ação:
//   Reabrir exige status='recebido' E modalidade_compra<>'compra_presencial'
//   -- reabrir_recebimento_pedido (migration 0037) rejeita explicitamente
//   compra presencial (nunca passa por aguardando_entrega; sua correção é
//   via editar_compra_presencial(), fora desta frente).
//   Excluir exige status='aguardando_entrega' (mesma exigência de
//   excluir_pedido, migration 0025, reaproveitada por
//   excluir_pedido_com_solicitacoes, migration 0045) -- uma Retirada
//   nunca atinge esse status, então nunca mostra Excluir, por desenho.
// `infoPedidoPorId` (pedido_id -> { status, modalidade_compra }) vem de
// quem chama.
function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Célula/coluna "Histórico de compras" -- UM bloco compacto com os dois
// indicadores (menor preço 3 meses / última compra), nunca 6-7 colunas
// separadas (decisão explícita da auditoria aprovada, seção 6). Ajuste
// visual (rodada seguinte à aprovação): rótulos textuais "Menor preço — 3
// meses"/"Última compra" substituídos por ícones do próprio Design System
// (tag = preço; calendar = última compra -- não existe ícone de
// relógio/histórico dedicado no catálogo de Icon.js, calendar é o mais
// próximo semanticamente disponível, decisão desta rodada), com
// title/aria-label explicando o significado. Cada linha só aparece quando
// aquela informação específica existe (histórico parcial mostra só a
// disponível, nunca um texto de preenchimento tipo "Sem compras no
// período"); quando NENHUMA das duas existe, um único "— Sem histórico"
// substitui as duas linhas repetidas de antes. Nenhuma mudança de cálculo/
// consulta -- só apresentação. Estados sem ícone, inalterados: sem
// produto_id, sem permissão de Catálogo, carregando, erro de consulta.
// `historicoPorProdutoId` vem pronto (Map já agregado em lote por
// lib/pedidos/historicoCompras.js) de quem chama -- este componente nunca
// dispara nenhuma consulta sozinho.
function CelulaHistorico({ solicitacao, podeVerHistorico, carregandoHistorico, erroHistorico, historicoPorProdutoId }) {
  if (!solicitacao.produto_id) {
    return <span className={estilos.historicoIndisponivel}>Sem produto vinculado ao Catálogo</span>;
  }
  if (!podeVerHistorico) {
    return <span className={estilos.historicoIndisponivel}>Histórico não disponível para este acesso</span>;
  }
  if (carregandoHistorico) {
    return <span className={estilos.historicoIndisponivel}>Carregando histórico...</span>;
  }
  // Erro na consulta em lote -- nunca impede visualizar/editar/excluir/
  // realizar a solicitação em si (seção 9 da auditoria aprovada), só
  // avisa que o histórico auxiliar não pôde ser carregado desta vez.
  if (erroHistorico) {
    return <span className={estilos.historicoIndisponivel}>Não foi possível carregar o histórico agora.</span>;
  }

  const item = historicoPorProdutoId.get(solicitacao.produto_id);

  // Nenhuma linha em produtos_historico_compras para este produto --
  // "última compra" só vem null quando não existe NENHUMA compra
  // conhecida (ver comentário de buscarHistoricoComprasEmLote). Nenhuma das
  // duas informações disponíveis -> um único estado compacto (nunca duas
  // linhas repetindo a mesma mensagem, ajuste visual desta rodada).
  if (!item || !item.ultimaCompra) {
    return <span className={estilos.historicoIndisponivel}>— Sem histórico</span>;
  }

  const unidadeBase = solicitacao.unidade || null;

  return (
    <div className={estilos.historicoBloco}>
      {item.menorPreco3Meses && (
        <div className={estilos.historicoLinha}>
          <span className={estilos.historicoIcone} title="Menor preço comparável dos últimos 3 meses" aria-label="Menor preço dos últimos 3 meses">
            <Icon nome="tag" tamanho={14} />
          </span>
          {formatarPrecoBase(item.menorPreco3Meses.precoBase, unidadeBase)} · {item.menorPreco3Meses.fornecedor || '—'}
        </div>
      )}
      <div className={estilos.historicoLinha}>
        <span className={estilos.historicoIcone} title="Última compra registrada" aria-label="Última compra registrada">
          <Icon nome="calendar" tamanho={14} />
        </span>
        {formatarDataHistorico(item.ultimaCompra.data)} · {item.ultimaCompra.fornecedor || '—'}
      </div>
    </div>
  );
}

export default function SolicitacoesLista({
  solicitacoes,
  nomePorId,
  podeEditar,
  podeExcluir,
  podeRealizar,
  podeCriarPedido,
  podeReabrirPedido,
  podeExcluirPedido,
  podeVerHistorico,
  carregandoHistorico,
  erroHistorico,
  historicoPorProdutoId,
  infoPedidoPorId,
  onEditar,
  onExcluir,
  onCriarPedido,
  onMarcarRealizada,
  onAbrirPedido,
  onReabrirPedido,
  onExcluirPedido,
}) {
  if (solicitacoes.length === 0) {
    return <EmptyState>Nenhuma solicitação encontrada.</EmptyState>;
  }

  // Ações de uma solicitação (mesmas condições de antes). `frequente`:
  // usada no dia a dia -> fica visível no cartão mobile.
  function acoesDe(s) {
    const pendente = s.status === 'pendente';
    const infoPedidoVinculado = s.pedido_id ? infoPedidoPorId[s.pedido_id] : null;
    const statusPedidoVinculado = infoPedidoVinculado?.status;
    const modalidadePedidoVinculado = infoPedidoVinculado?.modalidade_compra;

    return [
      pendente && podeEditar && { chave: 'editar', rotulo: 'Editar solicitação', icone: 'pencil', onClick: () => onEditar(s) },
      pendente && podeExcluir && { chave: 'excluir', rotulo: 'Excluir solicitação', icone: 'trash', destrutivo: true, onClick: () => onExcluir(s) },
      pendente && podeCriarPedido && {
        chave: 'criar-pedido',
        rotulo: s.produto_id ? 'Criar pedido' : 'Criar pedido (produto não cadastrado no Catálogo)',
        rotuloCurto: 'Criar pedido',
        icone: 'package',
        frequente: true,
        primaria: true,
        onClick: () => onCriarPedido(s),
      },
      pendente && podeRealizar && { chave: 'realizada', rotulo: 'Marcar como realizada', icone: 'check', frequente: true, onClick: () => onMarcarRealizada(s) },
      !pendente && s.pedido_id && { chave: 'abrir-pedido', rotulo: 'Abrir pedido', icone: 'eye', frequente: true, primaria: true, onClick: () => onAbrirPedido(s.pedido_id) },
      !pendente && s.pedido_id && podeReabrirPedido && statusPedidoVinculado === 'recebido' && modalidadePedidoVinculado !== 'compra_presencial' && {
        chave: 'reabrir-pedido',
        rotulo: 'Reabrir pedido',
        icone: 'undo',
        onClick: () => onReabrirPedido(s.pedido_id),
      },
      !pendente && s.pedido_id && podeExcluirPedido && statusPedidoVinculado === 'aguardando_entrega' && {
        chave: 'excluir-pedido',
        rotulo: 'Excluir pedido',
        icone: 'trash',
        destrutivo: true,
        onClick: () => onExcluirPedido(s.pedido_id),
      },
    ].filter(Boolean);
  }

  const colunas = [
    {
      chave: 'descricao',
      rotulo: 'Produto/Descrição',
      mobile: 'titulo',
      cartaoOrdem: 0,
      render: (s) => (
        <>
          {s.descricao}
          {s.unidade && <span className={estilos.nota}> ({s.unidade})</span>}
          {!s.produto_id && (
            <span className={estilos.marcaNaoCadastrado}>
              <Badge tom="warning">não cadastrado</Badge>
            </span>
          )}
        </>
      ),
    },
    { chave: 'data', rotulo: 'Solicitado em', semQuebra: true, mobile: 'titulo', cartaoOrdem: 2, render: (s) => formatarDataExibicao(s.data_solicitacao) },
    {
      chave: 'historico',
      rotulo: 'Histórico de compras',
      minLargura: '220px',
      render: (s) => (
        <CelulaHistorico
          solicitacao={s}
          podeVerHistorico={podeVerHistorico}
          carregandoHistorico={carregandoHistorico}
          erroHistorico={erroHistorico}
          historicoPorProdutoId={historicoPorProdutoId}
        />
      ),
    },
    { chave: 'quantidade', rotulo: 'Quantidade', alinhar: 'direita', render: (s) => s.quantidade },
    { chave: 'solicitante', rotulo: 'Solicitante', render: (s) => nomePorId[s.criado_por] || '—' },
    {
      chave: 'observacao',
      rotulo: 'Observação',
      render: (s) => (
        <span className={estilos.observacaoCelula} title={s.observacao || ''}>
          {s.observacao || '—'}
        </span>
      ),
    },
    {
      chave: 'status',
      rotulo: 'Status',
      mobile: 'titulo',
      cartaoOrdem: 1,
      render: (s) => <Badge tom={s.status === 'pendente' ? 'warning' : 'success'}>{s.status === 'pendente' ? 'Pendente' : 'Realizada'}</Badge>,
    },
  ];

  // Ordem das colunas na tabela (como antes, mais "Histórico de compras"
  // logo após Produto/Descrição): Solicitado em, Produto/Descrição,
  // Histórico, Quantidade, Solicitante, Observação, Status.
  const colunasTabela = [colunas[1], colunas[0], colunas[2], colunas[3], colunas[4], colunas[5], colunas[6]];

  return (
    <div className={estilos.superficie}>
      <DataTable
        rotulo="Solicitações de compra"
        colunas={colunasTabela}
        linhas={solicitacoes}
        chaveLinha={(s) => s.id}
        cartoesAte={1270}
        renderAcoes={(s, { cartao }) => {
          const acoes = acoesDe(s);
          if (!cartao) return <AcoesLinha acoes={acoes} />;
          const visiveis = acoes.filter((a) => a.frequente);
          const demais = acoes.filter((a) => !a.frequente);
          return (
            <div className={estilos.acoesLinha}>
              {visiveis.map((a) => (
                <Button key={a.chave} tamanho="sm" variante={a.primaria ? 'primary' : 'secondary'} icone={a.icone} onClick={a.onClick}>
                  {a.rotuloCurto || a.rotulo}
                </Button>
              ))}
              <AcoesLinha acoes={demais} cartao menuUnico />
            </div>
          );
        }}
      />
    </div>
  );
}
