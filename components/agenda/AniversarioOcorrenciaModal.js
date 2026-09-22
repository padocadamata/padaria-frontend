import { calcularIdade } from '../../lib/funcionarios/aniversarios';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import estilos from './agenda.module.css';

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Contraparte de AgendaItemDetalheModal.js só para ocorrências sintéticas
// de aniversário (item.tipo === 'aniversario', ver
// lib/funcionarios/aniversarios.js:itemAgendaAniversario). Deliberadamente
// SEM nenhuma ação (nada de editar/excluir/concluir/cancelar) -- este
// "item" não existe em agenda_itens, então nenhuma RPC de agenda pode ser
// chamada com o id dele. Mostra só o que já é seguro expor a quem já
// enxerga isto na grade (nome + data + idade), nada de CPF/telefone/
// endereço -- e só é renderizado quando o chamador (pages/agenda.js) já
// confirmou funcionarios.visualizar.
export default function AniversarioOcorrenciaModal({ ocorrencia, onFechar }) {
  const { item, dataExibicao } = ocorrencia;
  const idadeCompleta = calcularIdade(item.data_inicio, dataExibicao);

  return (
    <Modal titulo="🎂 Aniversário" onFechar={onFechar} largura="sm" fecharAoClicarFora>
      <p style={{ fontSize: 'var(--ds-fs-card)', fontWeight: 'var(--ds-fw-semibold)', margin: '0 0 6px' }}>
        {item.funcionarioNome}
      </p>
      <p className={estilos.detalheMeta}>
        {formatarDataExibicao(dataExibicao)} · completa {idadeCompleta} anos
      </p>
      <p className={estilos.detalheConcluidoPor}>
        Gerado automaticamente a partir do cadastro de funcionários (data de nascimento) — não é um evento da
        Agenda e não pode ser editado ou excluído por aqui. Some automaticamente se o funcionário for inativado.
      </p>
      <div className={estilos.detalheFechar}>
        <Button variante="secondary" onClick={onFechar}>Fechar</Button>
      </div>
    </Modal>
  );
}
