import { useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import { LIMITES } from '../../lib/ponto/lancamento';
import { mensagemErroPonto } from '../../lib/ponto/apresentacao';
import estilos from './ponto.module.css';

// Confirmação com MOTIVO obrigatório (reabrir cartão, cancelar atestado).
// onConfirmar(motivo) devolve uma promessa; o erro do banco aparece aqui.
export default function MotivoModal({ titulo, texto, rotuloMotivo = 'Motivo', rotuloConfirmar, perigo = false, onConfirmar, onFechar }) {
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const limpo = motivo.trim();

  async function confirmar(evento) {
    evento.preventDefault();
    if (!limpo) {
      setErro('Informe o motivo.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await onConfirmar(limpo);
    } catch (e) {
      setErro(mensagemErroPonto(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={titulo} onFechar={salvando ? () => {} : onFechar} largura="sm" fecharComEsc={!salvando}>
      <form className={estilos.formulario} onSubmit={confirmar}>
        {texto && <p className={estilos.mensagem}>{texto}</p>}
        <Field label={rotuloMotivo} dica={`Obrigatório, até ${LIMITES.motivo} caracteres. Fica registrado no histórico.`}>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={LIMITES.motivo} rows={3} autoFocus />
        </Field>
        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Voltar</Button>
          <Button type="submit" variante={perigo ? 'danger' : 'primary'} disabled={salvando || !limpo}>
            {salvando ? 'Salvando…' : rotuloConfirmar}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
