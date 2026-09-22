import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import estilos from './agenda.module.css';

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
      <Modal titulo={`Cancelar ocorrência — ${formatarDataExibicao(dataOcorrencia)}`} onFechar={processando ? undefined : () => setAcao(null)} largura="sm">
        <Field label="Motivo *">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus />
        </Field>
        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={() => setAcao(null)} disabled={processando}>Voltar</Button>
          <Button variante="danger" onClick={confirmarCancelar} disabled={processando}>
            {processando ? 'Cancelando...' : 'Confirmar cancelamento'}
          </Button>
        </div>
      </Modal>
    );
  }

  if (acao === 'excluir') {
    return (
      <Modal titulo={recorrente ? 'Excluir toda a série' : 'Excluir definitivamente'} onFechar={processando ? undefined : () => setAcao(null)} largura="sm">
        <p className={estilos.detalheMeta}>
          {recorrente
            ? 'Isso remove a série inteira e todas as exceções já registradas. Não pode ser desfeito.'
            : 'Esta ação não pode ser desfeita.'}
        </p>
        <Field label="Motivo *">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus />
        </Field>
        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={() => setAcao(null)} disabled={processando}>Voltar</Button>
          <Button variante="danger" onClick={confirmarExcluir} disabled={processando}>
            {processando ? 'Excluindo...' : 'Excluir definitivamente'}
          </Button>
        </div>
      </Modal>
    );
  }

  if (acao === 'alterar') {
    return (
      <Modal titulo="Alterar esta ocorrência" onFechar={processando ? undefined : () => setAcao(null)} largura="sm">
        <Field label="Título">
          <Input type="text" value={tituloAlt} onChange={(e) => setTituloAlt(e.target.value)} autoFocus />
        </Field>
        <Field label="Data">
          <Input type="date" value={dataAlt} onChange={(e) => setDataAlt(e.target.value)} />
        </Field>
        {!diaInteiro && (
          <div className={estilos.grade}>
            <Field label="Hora início">
              <Input type="time" value={horaInicioAlt} onChange={(e) => setHoraInicioAlt(e.target.value)} />
            </Field>
            <Field label="Hora fim">
              <Input type="time" value={horaFimAlt} onChange={(e) => setHoraFimAlt(e.target.value)} />
            </Field>
          </div>
        )}
        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={() => setAcao(null)} disabled={processando}>Voltar</Button>
          <Button onClick={confirmarAlterar} disabled={processando}>
            {processando ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={titulo} onFechar={onFechar} largura="sm">
      <p className={estilos.detalheMeta}>
        {item.tipo === 'evento' ? 'Evento' : 'Tarefa'} · {item.categoria}
        {!categoriaAtiva && ' (inativa)'}
        {recorrente && ' · série recorrente'}
      </p>
      <p className={estilos.detalheData}>
        {formatarDataExibicao(ocorrencia.dataExibicao)}
        {!diaInteiro && horaInicio && ` às ${horaInicio}${horaFim ? `–${horaFim}` : ''}`}
        {diaInteiro && ' (dia inteiro)'}
      </p>
      {descricao && <p className={estilos.detalheDescricao}>{descricao}</p>}

      {cancelada && <Badge tom="neutral">Cancelada</Badge>}
      {concluida && (
        <div className={estilos.mensagem}>
          <Badge tom="success">Concluída</Badge>
          {ocorrencia.observacaoConclusao && (
            <p className={estilos.detalheConcluidoPor}>
              <strong>Concluída por:</strong> {ocorrencia.observacaoConclusao}
            </p>
          )}
        </div>
      )}

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <div className={estilos.detalheAcoes}>
        {podeEditar && item.tipo === 'tarefa' && !cancelada && !concluida && (
          <Button tamanho="sm" onClick={() => onAbrirConclusao(ocorrencia)}>Concluir</Button>
        )}
        {podeEditar && item.tipo === 'tarefa' && !cancelada && concluida && (
          <Button tamanho="sm" variante="secondary" onClick={() => onAbrirReabertura(ocorrencia)}>Reabrir</Button>
        )}
        {podeEditar && recorrente && !cancelada && (
          <Button tamanho="sm" variante="secondary" onClick={() => setAcao('alterar')}>Alterar esta ocorrência</Button>
        )}
        {podeEditar && recorrente && !cancelada && !concluida && (
          <Button tamanho="sm" variante="dangerOutline" onClick={() => setAcao('cancelar')}>Cancelar esta ocorrência</Button>
        )}
        {podeEditar && (
          <Button tamanho="sm" variante="secondary" onClick={() => onEditarSerie(item)}>
            Editar {recorrente ? 'toda a série' : 'item'}
          </Button>
        )}
        {podeEditar && recorrente && (
          <Button tamanho="sm" variante="secondary" onClick={() => onEditarEstaEProximas(item, dataOcorrencia)}>
            Editar esta e as próximas
          </Button>
        )}
        {podeExcluir && (
          <Button tamanho="sm" variante="danger" onClick={() => setAcao('excluir')}>
            Excluir {recorrente ? 'série' : 'definitivamente'}
          </Button>
        )}
      </div>

      <div className={estilos.detalheFechar}>
        <Button variante="secondary" onClick={onFechar}>Fechar</Button>
      </div>
    </Modal>
  );
}
