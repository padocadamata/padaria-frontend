import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import DataTable from '../ui/DataTable';
import Modal from '../ui/Modal';
import AcoesLinha from '../ui/AcoesLinha';
import { MQ_MOBILE } from '../../lib/design/breakpoints';
import { useMediaQuery } from '../../lib/design/useMediaQuery';
import styles from './DetalhePedidoModal.module.css';

// Só o texto mudou nesta frente -- valor interno (pedidos.modalidade_compra)
// preservado exatamente como já estava (migration 0037), nunca alterado
// aqui: 'pedido_com_entrega' -> "Entrega", 'compra_presencial' -> "Retirada".
const MODALIDADE_LABEL = {
  pedido_com_entrega: 'Entrega',
  compra_presencial: 'Retirada',
};

const STATUS_LABEL = {
  aguardando_entrega: 'Aguardando entrega',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

const STATUS_TOM = { aguardando_entrega: 'warning', recebido: 'success', cancelado: 'neutral' };

// Ordem dos ícones no desktop (a mesma de antes da migração visual).
const ORDEM_DESKTOP = ['editar', 'editar-retirada', 'receber', 'cancelar', 'excluir', 'reabrir'];

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// pedido.recebido_em é timestamptz (forçado por pedidos_protecao, sempre
// now() no instante da transição) -- distinto da data efetiva informada
// pelo operador em ReceberPedidoModal (produtos_historico_compras.data_compra
// por item, não exposta aqui para não exigir uma consulta extra por
// pedido; ver seção 10 do cabeçalho da migration 0026). Mesmo fuso usado
// em todo o projeto.
function formatarDataHoraExibicao(timestamptz) {
  if (!timestamptz) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamptz));
}

// "Atrasado" recalculado aqui do mesmo jeito que na listagem (pages/pedidos.js)
// -- não é importado de lá porque pages/*.js não deve ser importado por
// componentes (só o caminho contrário); é a mesma fórmula de poucas linhas,
// duplicação deliberada, mesmo raciocínio já documentado em outros
// pontos do projeto (ex. FornecedorRegraForm.js).
function estaAtrasado(pedido, hoje) {
  return pedido.status === 'aguardando_entrega' && !!pedido.previsao_entrega && pedido.previsao_entrega < hoje;
}

// Sem nenhuma escrita própria: as ações Editar/Receber/Cancelar/Excluir/
// Reabrir recebimento aqui só disparam os callbacks recebidos (onEditar/
// onReceber/onCancelarPedido/onExcluir/onReabrirRecebimento) -- quem
// decide o que acontece (abrir a edição/confirmação, chamar as RPCs,
// recarregar a listagem) continua sendo pages/pedidos.js, único lugar
// com as RPCs. Todos os valores financeiros exibidos (subtotal por
// item, total) são calculados na hora da renderização, nunca lidos de
// uma coluna persistida. Editar/Receber/Cancelar/Excluir só para
// status=aguardando_entrega; Reabrir recebimento é a única ação
// oferecida para status=recebido (migration 0027) -- pedido cancelado
// nunca oferece nenhuma ação de escrita aqui.
export default function DetalhePedidoModal({
  pedido,
  itens,
  fornecedorNome,
  produtoNomePorId,
  corPrimaria = '#8B4513', // mantido por compatibilidade de API (a cor vem do tema)
  hoje,
  podeEditar,
  podeReceber,
  podeCancelar,
  podeExcluir,
  podeReabrirRecebimento,
  onEditar,
  onReceber,
  onCancelarPedido,
  onExcluir,
  onReabrirRecebimento,
  onFechar,
}) {
  const mobile = useMediaQuery(MQ_MOBILE);
  const atrasado = estaAtrasado(pedido, hoje);
  const tomStatus = atrasado ? 'danger' : STATUS_TOM[pedido.status] || 'neutral';
  const rotuloStatus = atrasado ? 'Atrasado' : STATUS_LABEL[pedido.status] || pedido.status;
  const ehCompraPresencial = pedido.modalidade_compra === 'compra_presencial';

  // Só existe um total quando TODOS os itens têm preço -- somar só os
  // precificados e apresentar como "total do pedido" seria enganoso
  // (mesma regra aplicada na listagem e em PedidoForm).
  const algumItemComValor = itens.some((item) => item.valor_unitario != null);
  const todosItensComValor = itens.length > 0 && itens.every((item) => item.valor_unitario != null);
  const total = todosItensComValor
    ? itens.reduce((soma, item) => soma + item.quantidade_pedida * item.valor_unitario, 0)
    : null;

  // Ações do pedido: UMA lista (mesmas condições e mesmos callbacks de
  // antes). Desktop: ícones com rótulo acessível; mobile: a principal fica
  // visível e as demais vão para "Mais ações".
  const acoes = [
    pedido.status === 'aguardando_entrega' && podeReceber && { chave: 'receber', rotulo: 'Receber pedido', icone: 'check', primaria: true, onClick: onReceber },
    pedido.status === 'aguardando_entrega' && podeEditar && { chave: 'editar', rotulo: 'Editar pedido', icone: 'pencil', primaria: !podeReceber, onClick: onEditar },
    pedido.status === 'aguardando_entrega' && podeCancelar && { chave: 'cancelar', rotulo: 'Cancelar pedido', icone: 'close', destrutivo: true, onClick: onCancelarPedido },
    pedido.status === 'aguardando_entrega' && podeExcluir && { chave: 'excluir', rotulo: 'Excluir pedido definitivamente', icone: 'trash', destrutivo: true, onClick: onExcluir },
    // Compra presencial nunca sai de recebido -- correção passa por
    // editar_compra_presencial(), nunca por reabrir_recebimento_pedido()
    // (migration 0037 bloqueia essa RPC para esta modalidade).
    pedido.status === 'recebido' && ehCompraPresencial && podeEditar && { chave: 'editar-retirada', rotulo: 'Editar retirada', icone: 'pencil', primaria: true, onClick: onEditar },
    pedido.status === 'recebido' && !ehCompraPresencial && podeReabrirRecebimento && { chave: 'reabrir', rotulo: 'Reabrir recebimento', icone: 'undo', destrutivo: true, onClick: onReabrirRecebimento },
  ].filter(Boolean);
  const acoesDesktop = [...acoes].sort((a, b) => ORDEM_DESKTOP.indexOf(a.chave) - ORDEM_DESKTOP.indexOf(b.chave));

  const colunasItens = [
    { chave: 'descricao', rotulo: 'Descrição', mobile: 'titulo', render: (item) => item.descricao },
    { chave: 'produto', rotulo: 'Produto', render: (item) => (item.produto_id ? produtoNomePorId[item.produto_id] || item.produto_id : '—') },
    { chave: 'unidade', rotulo: 'Unidade', render: (item) => item.unidade },
    { chave: 'quantidade', rotulo: 'Quantidade pedida', alinhar: 'direita', render: (item) => item.quantidade_pedida },
    { chave: 'valor', rotulo: 'Preço unitário estimado', alinhar: 'direita', render: (item) => (item.valor_unitario != null ? formatarMoeda(item.valor_unitario) : '—') },
    {
      chave: 'subtotal',
      rotulo: 'Subtotal estimado',
      alinhar: 'direita',
      render: (item) => (item.valor_unitario != null ? formatarMoeda(item.quantidade_pedida * item.valor_unitario) : '—'),
    },
  ];

  // Coerentes juntos por CHECK (pedido_itens_recebimento_coerente_check,
  // migration 0026) -- ou os 3 estão preenchidos, ou os 3 estão NULL (pedido
  // recebido antes da 0026, pelo antigo marcar_pedido_recebido). Nunca
  // inventa valor.
  const anterior = (item) => item.unidade_recebida == null;
  const colunasRecebimento = [
    { chave: 'produto', rotulo: 'Produto', mobile: 'titulo', render: (item) => (item.produto_id ? produtoNomePorId[item.produto_id] || item.produto_id : item.descricao) },
    {
      chave: 'unidade',
      rotulo: 'Unidade',
      render: (item) => (anterior(item) ? <span className={styles.legado}>Recebimento anterior ao controle detalhado.</span> : item.unidade_recebida),
    },
    { chave: 'quantidade', rotulo: 'Quantidade', alinhar: 'direita', render: (item) => (anterior(item) ? '' : item.quantidade_recebida) },
    { chave: 'valorUnitario', rotulo: 'Valor unitário', alinhar: 'direita', render: (item) => (anterior(item) ? '' : formatarMoeda(item.valor_unitario_recebido)) },
    { chave: 'valorTotal', rotulo: 'Valor total', alinhar: 'direita', render: (item) => (anterior(item) ? '' : formatarMoeda(item.valor_total_recebido)) },
  ];

  return (
    <Modal titulo={`Pedido — ${fornecedorNome}`} onFechar={onFechar} largura="xl">
      <dl className={styles.grade}>
        <div>
          <dt>Modalidade</dt>
          <dd>{MODALIDADE_LABEL[pedido.modalidade_compra] || pedido.modalidade_compra}</dd>
        </div>
        <div>
          <dt>Fornecedor</dt>
          <dd>{fornecedorNome}</dd>
        </div>
        <div>
          <dt>{ehCompraPresencial ? 'Data da compra' : 'Data do pedido'}</dt>
          <dd>{formatarDataExibicao(pedido.data_pedido)}</dd>
        </div>
        {!ehCompraPresencial && (
          <div>
            <dt>Previsão de entrega</dt>
            <dd>{formatarDataExibicao(pedido.previsao_entrega)}</dd>
          </div>
        )}
        {ehCompraPresencial && pedido.numero_nota_fiscal && (
          <div>
            <dt>Número da nota fiscal</dt>
            <dd>{pedido.numero_nota_fiscal}</dd>
          </div>
        )}
        {ehCompraPresencial && pedido.data_documento_fiscal && (
          <div>
            <dt>Data do documento fiscal</dt>
            <dd>{formatarDataExibicao(pedido.data_documento_fiscal)}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>
            <Badge tom={tomStatus}>{rotuloStatus}</Badge>
          </dd>
        </div>
      </dl>

      {pedido.status === 'cancelado' && pedido.motivo_cancelamento && (
        <Alert tom="danger" className={styles.bloco}>
          <strong>Motivo do cancelamento</strong>
          <div>{pedido.motivo_cancelamento}</div>
        </Alert>
      )}

      {pedido.observacoes && (
        <div className={styles.bloco}>
          <span className={styles.rotuloBloco}>Observações</span>
          <p className={styles.observacoes}>{pedido.observacoes}</p>
        </div>
      )}

      <div className={styles.secao}>
        <h3 className={styles.tituloSecao}>Itens do pedido</h3>

        {itens.length === 0 ? (
          <p className={styles.subtituloSecao}>Nenhum item encontrado.</p>
        ) : (
          <DataTable rotulo="Itens do pedido" colunas={colunasItens} linhas={itens} chaveLinha={(item) => item.id} />
        )}

        <p className={styles.total}>
          Total estimado do pedido: <strong>{todosItensComValor ? formatarMoeda(total) : '—'}</strong>
        </p>
        {todosItensComValor ? (
          <p className={styles.notaTotal}>Estimado a partir do preço informado — não é necessariamente o preço final da compra.</p>
        ) : (
          algumItemComValor && (
            <p className={styles.notaAviso}>Total estimado incompleto — nem todos os itens têm preço informado.</p>
          )
        )}
      </div>

      {pedido.status === 'recebido' && (
        <div className={styles.secao}>
          <h3 className={styles.tituloSecao}>Dados do recebimento</h3>
          <p className={styles.subtituloSecao}>Recebido em {formatarDataHoraExibicao(pedido.recebido_em)}</p>

          <DataTable rotulo="Dados do recebimento" colunas={colunasRecebimento} linhas={itens} chaveLinha={(item) => item.id} />
        </div>
      )}

      {acoes.length > 0 && (
        <div className={styles.acoes}>
          <AcoesLinha acoes={mobile ? acoes : acoesDesktop} cartao={mobile} />
        </div>
      )}
    </Modal>
  );
}
