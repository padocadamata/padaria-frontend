import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';
  if (msg.includes('ja esta concluida')) {
    return 'Esta ocorrência já está concluída — reabra antes de cancelar.';
  }
  if (msg.includes('ja e uma ocorrencia normal desta serie')) {
    return 'Essa data já é uma ocorrência normal desta série — escolha outra data.';
  }
  if (msg.includes('ja e a data de exibicao de outra excecao') || msg.includes('agenda_ocorrencias_data_override_unica')) {
    return 'Essa data já está ocupada por outra ocorrência desta série — escolha outra data.';
  }
  if (msg.includes('motivo e obrigatorio')) {
    return 'Informe o motivo.';
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
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
  maxWidth: '440px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};
const botaoEstilo = (cor) => ({
  padding: '8px 14px', backgroundColor: cor, color: 'white', border: 'none',
  borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
});
const campoEstilo = {
  width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px',
  boxSizing: 'border-box', fontSize: '14px', marginBottom: '12px',
};

// Detalhe de uma ocorrência (já expandida por lib/agenda/expandirRecorrencia.js)
// com as ações disponíveis conforme o tipo/recorrência do item pai.
// onEditarSerie/onEditarEstaEProximas abrem AgendaItemForm no modo
// correspondente (controlado pelo componente pai, pages/agenda.js).
export default function AgendaItemDetalheModal({
  ocorrencia,
  categorias,
  podeEditar,
  podeExcluir,
  onFechar,
  onAtualizado,
  onEditarSerie,
  onEditarEstaEProximas,
  onAbrirConclusao,
  onAbrirReabertura,
}) {
  const { item, dataOcorrencia, titulo, descricao, horaInicio, horaFim, diaInteiro, cancelada, concluida } = ocorrencia;
  const recorrente = item.tipo_recorrencia !== 'nenhuma';
  // Categoria inativa continua aparecendo no item existente (ela só
  // deixa de ser OFERECIDA para itens novos, ver AgendaItemForm.js) --
  // sinalizada aqui para deixar isso visível a quem está olhando o item.
  const categoriaAtiva = categorias.find((c) => c.valor === item.categoria)?.ativo ?? true;

  const [acao, setAcao] = useState(null); // null | 'alterar' | 'cancelar' | 'excluir'
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');

  const [tituloAlt, setTituloAlt] = useState(ocorrencia.titulo);
  const [dataAlt, setDataAlt] = useState(ocorrencia.dataExibicao);
  const [horaInicioAlt, setHoraInicioAlt] = useState(horaInicio || '');
  const [horaFimAlt, setHoraFimAlt] = useState(horaFim || '');
  const [motivo, setMotivo] = useState('');

  async function confirmarCancelar() {
    if (!motivo.trim()) {
      setErro('Informe o motivo do cancelamento.');
      return;
    }
    setProcessando(true);
    setErro('');
    const supabase = createClient();
    const { error } = await supabase.rpc('cancelar_ocorrencia_agenda', {
      p_agenda_item_id: item.id,
      p_data_ocorrencia: dataOcorrencia,
      p_motivo: motivo.trim(),
    });
    setProcessando(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }
    onAtualizado();
  }

  async function confirmarAlterar() {
    setProcessando(true);
    setErro('');
    const supabase = createClient();
    const { error } = await supabase.rpc('alterar_ocorrencia_agenda', {
      p_agenda_item_id: item.id,
      p_data_ocorrencia: dataOcorrencia,
      p_titulo_override: tituloAlt !== item.titulo ? tituloAlt : null,
      p_descricao_override: null,
      p_data_override: dataAlt !== dataOcorrencia ? dataAlt : null,
      p_hora_inicio_override: !diaInteiro && horaInicioAlt !== item.hora_inicio ? horaInicioAlt : null,
      p_hora_fim_override: !diaInteiro && horaFimAlt !== item.hora_fim ? horaFimAlt : null,
    });
    setProcessando(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }
    onAtualizado();
  }

  async function confirmarExcluir() {
    if (!motivo.trim()) {
      setErro('Informe o motivo da exclusão.');
      return;
    }
    setProcessando(true);
    setErro('');
    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_serie_agenda', {
      p_agenda_item_id: item.id,
      p_motivo: motivo.trim(),
    });
    setProcessando(false);
    if (error) {
      setErro('Não foi possível excluir. Tente novamente.');
      return;
    }
    onAtualizado();
  }

  if (acao === 'cancelar') {
    return (
      <div style={overlayEstilo}>
        <div style={caixaEstilo}>
          <h3 style={{ marginTop: 0 }}>Cancelar ocorrência — {formatarDataExibicao(dataOcorrencia)}</h3>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Motivo *</label>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...campoEstilo, minHeight: '60px' }} autoFocus />
          {erro && <p style={{ color: '#f44336' }}>{erro}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => setAcao(null)} style={botaoEstilo('#999')}>Voltar</button>
            <button onClick={confirmarCancelar} disabled={processando} style={botaoEstilo('#f44336')}>
              {processando ? 'Cancelando...' : 'Confirmar cancelamento'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (acao === 'excluir') {
    return (
      <div style={overlayEstilo}>
        <div style={caixaEstilo}>
          <h3 style={{ color: '#f44336', marginTop: 0 }}>
            Excluir {recorrente ? 'toda a série' : 'definitivamente'}
          </h3>
          <p style={{ fontSize: '13px', color: '#666' }}>
            {recorrente
              ? 'Isso remove a série inteira e todas as exceções já registradas. Não pode ser desfeito.'
              : 'Esta ação não pode ser desfeita.'}
          </p>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Motivo *</label>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...campoEstilo, minHeight: '60px' }} autoFocus />
          {erro && <p style={{ color: '#f44336' }}>{erro}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => setAcao(null)} style={botaoEstilo('#999')}>Voltar</button>
            <button onClick={confirmarExcluir} disabled={processando} style={botaoEstilo('#f44336')}>
              {processando ? 'Excluindo...' : 'Excluir definitivamente'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (acao === 'alterar') {
    return (
      <div style={overlayEstilo}>
        <div style={caixaEstilo}>
          <h3 style={{ marginTop: 0 }}>Alterar esta ocorrência</h3>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Título</label>
          <input type="text" value={tituloAlt} onChange={(e) => setTituloAlt(e.target.value)} style={campoEstilo} autoFocus />
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Data</label>
          <input type="date" value={dataAlt} onChange={(e) => setDataAlt(e.target.value)} style={campoEstilo} />
          {!diaInteiro && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Hora início</label>
                <input type="time" value={horaInicioAlt} onChange={(e) => setHoraInicioAlt(e.target.value)} style={campoEstilo} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Hora fim</label>
                <input type="time" value={horaFimAlt} onChange={(e) => setHoraFimAlt(e.target.value)} style={campoEstilo} />
              </div>
            </div>
          )}
          {erro && <p style={{ color: '#f44336' }}>{erro}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => setAcao(null)} style={botaoEstilo('#999')}>Voltar</button>
            <button onClick={confirmarAlterar} disabled={processando} style={botaoEstilo('#2196F3')}>
              {processando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ marginTop: 0 }}>{titulo}</h3>
        <p style={{ fontSize: '13px', color: '#666' }}>
          {item.tipo === 'evento' ? 'Evento' : 'Tarefa'} · {item.categoria}
          {!categoriaAtiva && ' (inativa)'}
          {recorrente && ' · série recorrente'}
        </p>
        <p style={{ fontSize: '14px' }}>
          {formatarDataExibicao(ocorrencia.dataExibicao)}
          {!diaInteiro && horaInicio && ` às ${horaInicio}${horaFim ? `–${horaFim}` : ''}`}
          {diaInteiro && ' (dia inteiro)'}
        </p>
        {descricao && <p style={{ fontSize: '13px', color: '#444', whiteSpace: 'pre-wrap' }}>{descricao}</p>}
        {cancelada && <p style={{ color: '#999', fontWeight: 'bold' }}>Cancelada</p>}
        {concluida && (
          <div style={{ marginTop: '4px' }}>
            <p style={{ color: '#4CAF50', fontWeight: 'bold', margin: 0 }}>Concluída</p>
            {ocorrencia.observacaoConclusao && (
              <p style={{ fontSize: '13px', color: '#444', margin: '2px 0 0' }}>
                <strong>Concluída por:</strong> {ocorrencia.observacaoConclusao}
              </p>
            )}
          </div>
        )}

        {erro && <p style={{ color: '#f44336' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '15px' }}>
          {podeEditar && item.tipo === 'tarefa' && !cancelada && !concluida && (
            <button onClick={() => onAbrirConclusao(ocorrencia)} style={botaoEstilo('#4CAF50')}>
              Concluir
            </button>
          )}
          {podeEditar && item.tipo === 'tarefa' && !cancelada && concluida && (
            <button onClick={() => onAbrirReabertura(ocorrencia)} style={botaoEstilo('#9e9e9e')}>
              Reabrir
            </button>
          )}
          {podeEditar && recorrente && !cancelada && (
            <button onClick={() => setAcao('alterar')} style={botaoEstilo('#2196F3')}>
              Alterar esta ocorrência
            </button>
          )}
          {podeEditar && recorrente && !cancelada && !concluida && (
            <button onClick={() => setAcao('cancelar')} style={botaoEstilo('#FF9800')}>
              Cancelar esta ocorrência
            </button>
          )}
          {podeEditar && (
            <button onClick={() => onEditarSerie(item)} style={botaoEstilo('#607D8B')}>
              Editar {recorrente ? 'toda a série' : 'item'}
            </button>
          )}
          {podeEditar && recorrente && (
            <button onClick={() => onEditarEstaEProximas(item, dataOcorrencia)} style={botaoEstilo('#607D8B')}>
              Editar esta e as próximas
            </button>
          )}
          {podeExcluir && (
            <button onClick={() => setAcao('excluir')} style={botaoEstilo('#f44336')}>
              Excluir {recorrente ? 'série' : 'definitivamente'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={onFechar} style={botaoEstilo('#999')}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
