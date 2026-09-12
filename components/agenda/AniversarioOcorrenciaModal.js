import { calcularIdade } from '../../lib/funcionarios/aniversarios';

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

const overlayEstilo = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000, padding: '20px',
};
const caixaEstilo = {
  backgroundColor: 'white', padding: '25px', borderRadius: '10px',
  maxWidth: '380px', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

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
    <div style={overlayEstilo} onClick={onFechar}>
      <div style={caixaEstilo} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>🎂 Aniversário</h3>
        <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 6px' }}>{item.funcionarioNome}</p>
        <p style={{ fontSize: '14px', color: '#444', margin: 0 }}>
          {formatarDataExibicao(dataExibicao)} · completa {idadeCompleta} anos
        </p>
        <p style={{ fontSize: '12px', color: '#999', marginTop: '14px' }}>
          Gerado automaticamente a partir do cadastro de funcionários (data de nascimento) — não é um evento da
          Agenda e não pode ser editado ou excluído por aqui. Some automaticamente se o funcionário for inativado.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button
            onClick={onFechar}
            style={{ padding: '8px 14px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
