import {
  BotaoIconeAcao,
  IconeLapis,
  IconeLixeira,
  IconeCaixa,
  IconeCheck,
  IconeOlho,
  IconeReabrir,
} from '../producao/IconesAcoes';

// Tabela de solicitações internas de compra. Ordenação já vem pronta de
// quem chama (pages/pedidos/solicitacoes.js: data_solicitacao ASC, depois
// criado_em ASC -- mais antigas pendentes primeiro, seção 17 da auditoria
// aprovada) -- este componente só renderiza, não decide ordem/filtro.
//
// Ações em botões de ícone (BotaoIconeAcao, components/producao/
// IconesAcoes.js) -- mesmo componente já usado em pages/pedidos.js, sem
// nenhuma biblioteca de ícones nova. Cada botão já vem com aria-label e
// tooltip próprios (via `rotulo`); confirmação de ações destrutivas
// acontece em quem chama (ConfirmarAcaoModal), nunca aqui.
//
// Reabrir/Excluir pedido só aparecem para uma solicitação realizada COM
// pedido_id, são gated pelas permissões de PEDIDOS (podeReabrirPedido/
// podeExcluirPedido -- nunca pedidos_solicitacoes.*, ver lib/auth/
// permissoes.js) e só quando o status/modalidade atuais do pedido
// vinculado permitem a ação:
//   Reabrir exige status='recebido' E modalidade_compra<>'compra_presencial'
//   -- reabrir_recebimento_pedido (migration 0037) rejeita explicitamente
//   compra presencial (nunca passa por aguardando_entrega; sua correção é
//   via editar_compra_presencial(), fora desta frente). Sem checar
//   modalidade aqui, o ícone aparecia para uma Retirada recebida e a RPC
//   sempre falhava -- bug de frontend corrigido nesta rodada (confirmado
//   por diagnóstico real: Assaí_34/compra_presencial).
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

export default function SolicitacoesLista({
  solicitacoes,
  nomePorId,
  corPrimaria,
  podeEditar,
  podeExcluir,
  podeRealizar,
  podeCriarPedido,
  podeReabrirPedido,
  podeExcluirPedido,
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
    return <p style={{ color: '#999' }}>Nenhuma solicitação encontrada.</p>;
  }

  return (
    <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd' }}>
            {['Solicitado em', 'Produto/Descrição', 'Quantidade', 'Solicitante', 'Observação', 'Status', 'Ações'].map((coluna) => (
              <th key={coluna} style={{ padding: '12px', textAlign: 'left', color: corPrimaria, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {solicitacoes.map((s) => {
            const pendente = s.status === 'pendente';
            const infoPedidoVinculado = s.pedido_id ? infoPedidoPorId[s.pedido_id] : null;
            const statusPedidoVinculado = infoPedidoVinculado?.status;
            const modalidadePedidoVinculado = infoPedidoVinculado?.modalidade_compra;
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatarDataExibicao(s.data_solicitacao)}</td>
                <td style={{ padding: '12px' }}>
                  {s.descricao}
                  {s.unidade && <span style={{ color: '#999', fontSize: '12px' }}> ({s.unidade})</span>}
                  {!s.produto_id && (
                    <span style={{ marginLeft: '6px', fontSize: '11px', color: '#FF9800', fontWeight: 'bold' }}>não cadastrado</span>
                  )}
                </td>
                <td style={{ padding: '12px' }}>{s.quantidade}</td>
                <td style={{ padding: '12px' }}>{nomePorId[s.criado_por] || '—'}</td>
                <td style={{ padding: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.observacao || ''}>
                  {s.observacao || '—'}
                </td>
                <td style={{ padding: '12px' }}>
                  <span
                    style={{
                      padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', color: 'white',
                      backgroundColor: pendente ? '#FF9800' : '#4CAF50', whiteSpace: 'nowrap',
                    }}
                  >
                    {pendente ? 'Pendente' : 'Realizada'}
                  </span>
                </td>
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {pendente && podeEditar && (
                      <BotaoIconeAcao rotulo="Editar solicitação" icone={IconeLapis} cor="#607D8B" onClick={() => onEditar(s)} />
                    )}
                    {pendente && podeExcluir && (
                      <BotaoIconeAcao rotulo="Excluir solicitação" icone={IconeLixeira} destrutivo onClick={() => onExcluir(s)} />
                    )}
                    {pendente && podeCriarPedido && (
                      <BotaoIconeAcao
                        rotulo={s.produto_id ? 'Criar pedido' : 'Criar pedido (produto não cadastrado no Catálogo)'}
                        icone={IconeCaixa}
                        cor={corPrimaria}
                        onClick={() => onCriarPedido(s)}
                      />
                    )}
                    {pendente && podeRealizar && (
                      <BotaoIconeAcao rotulo="Marcar como realizada" icone={IconeCheck} cor="#4CAF50" onClick={() => onMarcarRealizada(s)} />
                    )}
                    {!pendente && s.pedido_id && (
                      <>
                        <BotaoIconeAcao rotulo="Abrir pedido" icone={IconeOlho} cor={corPrimaria} onClick={() => onAbrirPedido(s.pedido_id)} />
                        {podeReabrirPedido && statusPedidoVinculado === 'recebido' && modalidadePedidoVinculado !== 'compra_presencial' && (
                          <BotaoIconeAcao
                            rotulo="Reabrir pedido"
                            icone={IconeReabrir}
                            cor="#FF9800"
                            onClick={() => onReabrirPedido(s.pedido_id)}
                          />
                        )}
                        {podeExcluirPedido && statusPedidoVinculado === 'aguardando_entrega' && (
                          <BotaoIconeAcao
                            rotulo="Excluir pedido"
                            icone={IconeLixeira}
                            destrutivo
                            onClick={() => onExcluirPedido(s.pedido_id)}
                          />
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
