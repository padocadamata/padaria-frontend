import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import AcoesLinha from '../ui/AcoesLinha';
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

export default function SolicitacoesLista({
  solicitacoes,
  nomePorId,
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

  // Ordem das colunas na tabela (como antes): Solicitado em primeiro.
  const colunasTabela = [colunas[1], colunas[0], colunas[2], colunas[3], colunas[4], colunas[5]];

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
