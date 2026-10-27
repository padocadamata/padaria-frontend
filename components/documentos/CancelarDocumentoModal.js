import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Textarea from '../ui/Textarea';
import { cancelarDocumento } from '../../lib/documentos/consultas';
import { mensagemErroDocumento } from '../../lib/documentos/apresentacao';
import { aparar } from '../../lib/documentos/texto';
import estilos from './documentos.module.css';

const LIMITE_MOTIVO = 500;

// Cancelamento LÓGICO (RPC folha_documento_cancelar): motivo obrigatório;
// o documento continua existindo, com conteúdo e número, marcado como
// cancelado. Errou o conteúdo? Cancele e emita outro -- nunca se edita.
export default function CancelarDocumentoModal({ documento, onFechar, onCancelado }) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const motivoLimpo = aparar(motivo);

  async function confirmar() {
    setErro('');
    if (motivoLimpo === '') {
      setErro('Informe o motivo do cancelamento.');
      return;
    }
    setEnviando(true);
    try {
      await cancelarDocumento(documento.id, motivoLimpo);
      onCancelado();
    } catch (e) {
      setErro(mensagemErroDocumento(e));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Cancelar documento ${documento.numero_formatado}?`} onFechar={() => !enviando && onFechar()} largura="md" fecharComEsc={!enviando}>
      <div className={estilos.formulario}>
        <p className={estilos.secundario}>
          O documento não é apagado: continua no histórico, com o mesmo número e conteúdo, marcado como cancelado. O cancelamento não pode ser desfeito.
          Se o problema foi o conteúdo, emita um novo documento depois.
        </p>
        <Field label="Motivo do cancelamento *" dica={`${[...motivo].length} / ${LIMITE_MOTIVO}`}>
          <Textarea rows={3} maxLength={LIMITE_MOTIVO} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Field>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilos.rodapeAcoes}>
          <Button variante="secondary" onClick={onFechar} disabled={enviando}>Voltar</Button>
          <Button variante="danger" onClick={confirmar} disabled={enviando || motivoLimpo === ''}>
            {enviando ? 'Cancelando…' : 'Cancelar documento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
