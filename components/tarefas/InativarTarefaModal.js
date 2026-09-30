import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Alert from '../ui/Alert';
import { inativarTarefa } from '../../lib/tarefas/consultas';
import { mensagemErro } from '../../lib/tarefas/erros';
import { primeiraDataAlteracao } from '../../lib/tarefas/regras';
import { PreviaSincronizacao } from './ProgramarMesModal';
import estilos from './tarefas.module.css';

// Inativação "a partir de" (>= hoje), com prévia: some das datas futuras
// ainda não tocadas; passado, concluídas, ajustadas, canceladas e avulsas
// permanecem no calendário. A data começa na primeira aceita pelo banco
// (nunca antes de uma versão de regra já agendada).
export default function InativarTarefaModal({ tarefa, regras, hoje, onFechar, onSalvo }) {
  const dataMinima = primeiraDataAlteracao(regras, hoje);
  const [aPartirDe, setAPartirDe] = useState(dataMinima);
  const [previa, setPrevia] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function executar(simular) {
    setSalvando(true);
    setErro('');
    try {
      const r = await inativarTarefa(tarefa.id, aPartirDe, simular);
      if (simular) setPrevia(r);
      else onSalvo(r);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Inativar tarefa" onFechar={onFechar} largura="md">
      <div className={estilos.pilha}>
        <p className={estilos.caixaInfo}><strong>{tarefa.descricao}</strong></p>
        <Field label="Deixa de ser programada a partir de">
          <Input type="date" min={dataMinima} value={aPartirDe} onChange={(e) => { setAPartirDe(e.target.value); setPrevia(null); }} disabled={salvando} />
        </Field>
        <p className={estilos.textoAuxiliar}>
          O histórico continua no calendário. Para voltar a programá-la depois, use &quot;Reativar&quot;.
        </p>
        {erro && <Alert tom="danger">{erro}</Alert>}
        {previa && <PreviaSincronizacao resultado={previa} />}
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          {previa ? (
            <Button variante="danger" onClick={() => executar(false)} disabled={salvando || !aPartirDe}>Confirmar inativação</Button>
          ) : (
            <Button onClick={() => executar(true)} disabled={salvando || !aPartirDe}>Ver prévia</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
