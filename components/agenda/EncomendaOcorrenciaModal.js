import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { formatarTelefone } from '../../lib/clientes/telefone';
import { formatarData, formatarHora, formatarQuantidade, STATUS_ENCOMENDA } from '../../lib/encomendas/regras';
import estilos from './agenda.module.css';

// Contraparte de AniversarioOcorrenciaModal.js para ocorrências projetadas
// de encomenda (item.tipo === 'encomenda', lib/encomendas/agenda.js).
// Deliberadamente SEM ações de Agenda: este "item" não existe em
// agenda_itens -- editar/concluir/cancelar acontece em Clientes >
// Encomendas, a única fonte de verdade. Só renderizado para quem já tem
// encomendas.visualizar (pages/agenda.js só carrega as encomendas nesse caso).
export default function EncomendaOcorrenciaModal({ ocorrencia, onFechar }) {
  const { encomenda } = ocorrencia.item;
  const status = STATUS_ENCOMENDA[encomenda.status];

  return (
    <Modal titulo="Encomenda" onFechar={onFechar} largura="sm" fecharAoClicarFora>
      <p style={{ fontSize: 'var(--ds-fs-card)', fontWeight: 'var(--ds-fw-semibold)', margin: '0 0 6px' }}>
        {encomenda.cliente_nome} <Badge tom={status.tom}>{status.rotulo}</Badge>
      </p>
      <p className={estilos.detalheMeta}>
        Retirada {formatarData(encomenda.data_retirada)} às {formatarHora(encomenda.hora_retirada)} · {formatarTelefone(encomenda.cliente_telefone)}
      </p>
      <ul style={{ margin: '8px 0', paddingLeft: '18px' }}>
        {encomenda.itens.map((i, indice) => (
          <li key={`${i.produto_id}-${indice}`}>
            {formatarQuantidade(i.quantidade)}× {i.produto_nome}
            {i.comentario && <span className={estilos.detalheMeta}> — {i.comentario}</span>}
          </li>
        ))}
      </ul>
      <p className={estilos.detalheConcluidoPor}>
        Pedido em {formatarData(encomenda.data_pedido)}. Para editar ou alterar o status, abra a encomenda.
      </p>
      <div className={estilos.detalheFechar}>
        <Button href="/clientes/encomendas" variante="secondary">
          Abrir Encomendas
        </Button>
        <Button variante="secondary" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </Modal>
  );
}
