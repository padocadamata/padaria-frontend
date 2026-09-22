import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import estilos from './agenda.module.css';

// Mesmo limite validado no backend (trigger agenda_itens_protecao /
// agenda_ocorrencias_protecao, migration 0039) -- mantido em sincronia
// manualmente, mesmo padrão das demais constantes espelhadas entre
// frontend/backend na Agenda (ver expandirRecorrencia.js).
const LIMITE_OBSERVACAO = 200;

// Modal reutilizável para concluir UMA tarefa -- avulsa (agenda_itens) ou
// UMA ocorrência de tarefa recorrente (agenda_ocorrencias, identidade
// agenda_item_id + data_ocorrencia ORIGINAL, nunca a série). Chamado
// tanto pelo checkbox do calendário (AgendaCalendario.js) quanto pelo
// botão "Concluir" de AgendaItemDetalheModal.js -- mesmo fluxo único,
// para nunca existir conclusão sem observação por outro caminho da UI.
export default function ConcluirTarefaModal({ ocorrencia, onFechar, onConcluido }) {
  const [observacao, setObservacao] = useState('');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');

  if (!ocorrencia) return null;

  const recorrente = ocorrencia.item.tipo_recorrencia !== 'nenhuma';

  async function confirmar() {
    const texto = observacao.trim();
    if (!texto) {
      setErro('Informe o nome/observação da conclusão.');
      return;
    }
    setProcessando(true);
    setErro('');
    const supabase = createClient();

    const { error } = recorrente
      ? await supabase.rpc('concluir_ocorrencia_agenda', {
          p_agenda_item_id: ocorrencia.item.id,
          p_data_ocorrencia: ocorrencia.dataOcorrencia,
          p_observacao_conclusao: texto,
        })
      : await supabase.rpc('concluir_tarefa_agenda', {
          p_item_id: ocorrencia.item.id,
          p_observacao_conclusao: texto,
        });

    setProcessando(false);
    if (error) {
      setErro('Não foi possível concluir. Tente novamente.');
      return;
    }
    onConcluido();
  }

  function aoTeclar(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!processando) confirmar();
    }
  }

  return (
    <Modal titulo="Concluir tarefa" onFechar={processando ? undefined : onFechar} largura="sm">
      <p className={estilos.detalheMeta}>{ocorrencia.titulo}</p>

      <Field label="Nome / observação da conclusão *" dica={`${observacao.length}/${LIMITE_OBSERVACAO}`}>
        <Input
          type="text"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          onKeyDown={aoTeclar}
          maxLength={LIMITE_OBSERVACAO}
          placeholder="Ex.: Maria - concluído sem pendências"
          autoFocus
        />
      </Field>

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <div className={estilos.rodape}>
        <Button variante="secondary" onClick={onFechar} disabled={processando}>Cancelar</Button>
        <Button onClick={confirmar} disabled={processando}>
          {processando ? 'Concluindo...' : 'Concluir'}
        </Button>
      </div>
    </Modal>
  );
}
