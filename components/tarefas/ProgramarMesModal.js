import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { dataCurta, descreverSincronizacao } from '../../lib/tarefas/calendario';
import { programarMes } from '../../lib/tarefas/consultas';
import { mensagemErro } from '../../lib/tarefas/erros';
import { mesExibicao } from '../../lib/data/dataLocal';
import estilos from './tarefas.module.css';

// Lista legível do resultado jsonb de uma prévia (programar mês, salvar
// regra, inativar, identificar posição).
export function PreviaSincronizacao({ resultado }) {
  const linhas = descreverSincronizacao(resultado);
  return (
    <div className={estilos.caixaInfo}>
      <ul>
        {linhas.map((l) => (
          <li key={l}>{l}.</li>
        ))}
      </ul>
    </div>
  );
}

// Programar mês: SEMPRE prévia primeiro (mesmo código da RPC, desfeito no
// banco), depois confirmação explícita. Nunca é disparado ao abrir a tela.
export default function ProgramarMesModal({ mes, jaProgramado, onFechar, onConcluido }) {
  const [previa, setPrevia] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    programarMes(mes, true)
      .then((r) => ativo && setPrevia(r))
      .catch((e) => ativo && setErro(mensagemErro(e)))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [mes]);

  async function confirmar() {
    setSalvando(true);
    setErro('');
    try {
      const r = await programarMes(mes, false);
      onConcluido(r);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  const nadaAFazer = previa && !previa.criadas && !previa.removidas && !previa.nomes_atualizados;

  return (
    <Modal titulo={`${jaProgramado ? 'Atualizar programação' : 'Programar'} — ${mesExibicao(mes)}`} onFechar={onFechar} largura="md">
      <div className={estilos.pilha}>
        {carregando && <p role="status">Calculando prévia...</p>}
        {erro && <Alert tom="danger">{erro}</Alert>}
        {previa && (
          <>
            <p className={estilos.textoAuxiliar}>
              {previa.primeira_programacao
                ? `As regras cadastradas serão aplicadas de ${dataCurta(previa.inicio)} a ${dataCurta(previa.fim)}.`
                : `O mês já foi programado. Só as datas de ${dataCurta(previa.inicio)} em diante são revisadas; o passado fica como está.`}
            </p>
            {nadaAFazer ? (
              <Alert tom="info">A programação deste mês já está em dia com as regras. Nada a alterar.</Alert>
            ) : (
              <PreviaSincronizacao resultado={previa} />
            )}
            <p className={estilos.textoAuxiliar}>
              Conclusões, ajustes, cancelamentos e ocorrências avulsas nunca são alterados. Programar de novo não duplica nada.
            </p>
          </>
        )}
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={carregando || salvando || !previa || (nadaAFazer && jaProgramado)}>
            {salvando ? 'Programando...' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
