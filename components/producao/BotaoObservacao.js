import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import styles from './BotaoObservacao.module.css';

// Observação de um lote/registro: botão compacto (ícone "note") que abre um
// modal SOMENTE LEITURA com o texto completo -- leitura confortável em vez
// de depender de uma dica ao passar o mouse. Nada é editado aqui; o texto é
// mostrado exatamente como foi gravado (quebras de linha preservadas).
//
// `contexto` (opcional): linha discreta abaixo do produto (ex.: datas do lote).
export default function BotaoObservacao({ texto, produto, contexto }) {
  const [aberto, setAberto] = useState(false);
  if (!texto) return null;

  return (
    <>
      <IconButton icone="note" tamanho="sm" rotulo={`Ver observação — ${produto}`} onClick={() => setAberto(true)} />
      {aberto && (
        <Modal titulo="Observação do produto" onFechar={() => setAberto(false)} largura="md" fecharAoClicarFora>
          <p className={styles.produto}>{produto}</p>
          {contexto && <p className={styles.contexto}>{contexto}</p>}
          <p className={styles.texto}>{texto}</p>
          <div className={styles.rodape}>
            <Button variante="secondary" onClick={() => setAberto(false)}>
              Fechar
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
