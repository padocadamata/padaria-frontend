import Button from '../ui/Button';
import Field from '../ui/Field';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import { LIMITES } from '../../lib/ponto/lancamento';
import estilos from './ponto.module.css';

// Lista de períodos REALIZADOS (entrada/saída, HH:MM) com incluir/excluir --
// usada no modal do dia (3+ períodos) e em "Repetir horários". Controlado:
// quem usa é dono do array. Validação é a de lancamento.js, no salvar.
export default function PeriodosCampos({ periodos, onAlterar, desabilitado = false }) {
  const atualizar = (i, campo, valor) => onAlterar(periodos.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  return (
    <div className={estilos.formulario}>
      {periodos.length === 0 && <p className={estilos.aux}>Nenhum horário lançado.</p>}
      {periodos.map((p, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className={estilos.periodo}>
          <Field label={`Entrada ${i + 1}`}>
            <Input type="time" step="60" value={p.entrada} onChange={(e) => atualizar(i, 'entrada', e.target.value)} disabled={desabilitado} />
          </Field>
          <Field label={`Saída ${i + 1}`}>
            <Input type="time" step="60" value={p.saida} onChange={(e) => atualizar(i, 'saida', e.target.value)} disabled={desabilitado} />
          </Field>
          <IconButton icone="trash" tom="danger" rotulo={`Excluir período ${i + 1}`} onClick={() => onAlterar(periodos.filter((_, j) => j !== i))} disabled={desabilitado} />
        </div>
      ))}
      <div>
        <Button
          variante="secondary"
          tamanho="sm"
          icone="plus"
          onClick={() => onAlterar([...periodos, { entrada: '', saida: '' }])}
          disabled={desabilitado || periodos.length >= LIMITES.periodos}
        >
          Incluir período
        </Button>
      </div>
    </div>
  );
}
