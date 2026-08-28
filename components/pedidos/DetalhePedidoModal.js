const STATUS_LABEL = {
  aguardando_entrega: 'Aguardando entrega',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "Atrasado" recalculado aqui do mesmo jeito que na listagem (pages/pedidos.js)
// -- não é importado de lá porque pages/*.js não deve ser importado por
// componentes (só o caminho contrário); é a mesma fórmula de poucas linhas,
// duplicação deliberada, mesmo raciocínio já documentado em outros
// pontos do projeto (ex. FornecedorRegraForm.js).
function estaAtrasado(pedido, hoje) {
  return pedido.status === 'aguardando_entrega' && !!pedido.previsao_entrega && pedido.previsao_entrega < hoje;
}

const overlayEstilo = {
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
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '760px',
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', fontSize: '12px', color: '#666', marginBottom: '2px' };

// Sem nenhuma escrita própria: os botões Receber/Cancelar aqui só
// disparam os callbacks recebidos (onReceber/onCancelarPedido) -- quem
// decide o que acontece (abrir a confirmação, chamar
// marcar_pedido_recebido/cancelar_pedido, recarregar a listagem) continua
// sendo pages/pedidos.js, único lugar com as RPCs. Todos os valores
// financeiros exibidos (subtotal por item, total) são calculados na hora
// da renderização, nunca lidos de uma coluna persistida.
export default function DetalhePedidoModal({
  pedido,
  itens,
  fornecedorNome,
  produtoNomePorId,
  corPrimaria = '#8B4513',
  hoje,
  podeReceber,
  podeCancelar,
  onReceber,
  onCancelarPedido,
  onFechar,
}) {
  const atrasado = estaAtrasado(pedido, hoje);
  const corStatus = atrasado
    ? '#f44336'
    : { aguardando_entrega: '#FF9800', recebido: '#4CAF50', cancelado: '#9e9e9e' }[pedido.status] || '#9e9e9e';
  const rotuloStatus = atrasado ? 'Atrasado' : STATUS_LABEL[pedido.status] || pedido.status;

  const algumItemComValor = itens.some((item) => item.valor_unitario != null);
  const total = itens.reduce((soma, item) => soma + item.quantidade_pedida * (item.valor_unitario || 0), 0);

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Pedido — {fornecedorNome}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '15px', marginBottom: '15px' }}>
          <div>
            <div style={rotuloEstilo}>Fornecedor</div>
            <div>{fornecedorNome}</div>
          </div>
          <div>
            <div style={rotuloEstilo}>Data do pedido</div>
            <div>{formatarDataExibicao(pedido.data_pedido)}</div>
          </div>
          <div>
            <div style={rotuloEstilo}>Previsão de entrega</div>
            <div>{formatarDataExibicao(pedido.previsao_entrega)}</div>
          </div>
          <div>
            <div style={rotuloEstilo}>Status</div>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 'bold',
                color: 'white',
                backgroundColor: corStatus,
                whiteSpace: 'nowrap',
              }}
            >
              {rotuloStatus}
            </span>
          </div>
        </div>

        {pedido.status === 'cancelado' && pedido.motivo_cancelamento && (
          <div style={{ backgroundColor: '#ffebee', padding: '10px 12px', borderRadius: '5px', marginBottom: '15px' }}>
            <div style={{ ...rotuloEstilo, color: '#c62828' }}>Motivo do cancelamento</div>
            <div style={{ fontSize: '14px' }}>{pedido.motivo_cancelamento}</div>
          </div>
        )}

        {pedido.observacoes && (
          <div style={{ marginBottom: '15px' }}>
            <div style={rotuloEstilo}>Observações</div>
            <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{pedido.observacoes}</div>
          </div>
        )}

        <div style={{ borderTop: '1px solid #eee', paddingTop: '15px' }}>
          <h4 style={{ margin: '0 0 10px 0' }}>Itens do pedido</h4>

          {itens.length === 0 ? (
            <p style={{ color: '#999', fontSize: '13px' }}>Nenhum item encontrado.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd' }}>
                    {['Descrição', 'Produto', 'Unidade', 'Quantidade', 'Valor unitário', 'Subtotal'].map((coluna) => (
                      <th key={coluna} style={{ padding: '8px', textAlign: 'left', fontSize: '13px', color: corPrimaria, whiteSpace: 'nowrap' }}>
                        {coluna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item) => {
                    const subtotal = item.valor_unitario != null ? item.quantidade_pedida * item.valor_unitario : null;
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px', fontSize: '13px' }}>{item.descricao}</td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>
                          {item.produto_id ? produtoNomePorId[item.produto_id] || item.produto_id : '—'}
                        </td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>{item.unidade}</td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>{item.quantidade_pedida}</td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>
                          {item.valor_unitario != null ? formatarMoeda(item.valor_unitario) : '—'}
                        </td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>{subtotal != null ? formatarMoeda(subtotal) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ marginTop: '12px', fontSize: '14px', textAlign: 'right' }}>
            Total (derivado dos itens): <strong>{algumItemComValor ? formatarMoeda(total) : '—'}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
          {pedido.status === 'aguardando_entrega' && podeReceber && (
            <button
              type="button"
              onClick={onReceber}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Marcar como recebido
            </button>
          )}

          {pedido.status === 'aguardando_entrega' && podeCancelar && (
            <button
              type="button"
              onClick={onCancelarPedido}
              style={{
                padding: '10px 20px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Cancelar pedido
            </button>
          )}

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
