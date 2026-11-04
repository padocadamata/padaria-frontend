import { useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import TotaisCartao from './TotaisCartao';
import { mensagemErroPonto } from '../../lib/ponto/apresentacao';
import estilos from './ponto.module.css';

// Confirmação de Conferir / Fechar com o resumo dos totais que serão
// conferidos/congelados (todos os indicadores à vista). O banco recalcula
// e confere tudo de novo.
export default function ConfirmarModal({ titulo, texto, apuracao, rotuloConfirmar, onConfirmar, onFechar }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setSalvando(true);
    setErro('');
    try {
      await onConfirmar();
    } catch (e) {
      setErro(mensagemErroPonto(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={titulo} onFechar={salvando ? () => {} : onFechar} largura="lg" fecharComEsc={!salvando}>
      <div className={estilos.formulario}>
        <p className={estilos.mensagem}>{texto}</p>
        {apuracao && <TotaisCartao apuracao={apuracao} expandido />}
        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Voltar</Button>
          <Button onClick={confirmar} disabled={salvando}>{salvando ? 'Salvando…' : rotuloConfirmar}</Button>
        </div>
      </div>
    </Modal>
  );
}
