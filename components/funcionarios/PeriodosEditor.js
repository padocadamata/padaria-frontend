import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import estilos from './escala.module.css';

// Editor de 1..N períodos de trabalho (entrada/saída) -- reutilizado por
// EscalaDiaModal (1 dia) e EscalaLoteModal (vários dias/funcionários de
// uma vez, mesmos períodos aplicados a todos). Controlado: quem usa é
// dono do array `periodos`, este componente só avisa `onAlterar`.
export default function PeriodosEditor({ periodos, onAlterar, podeEditar }) {
  function atualizar(indice, campo, valor) {
    onAlterar(periodos.map((p, i) => (i === indice ? { ...p, [campo]: valor } : p)));
  }

  function adicionar() {
    onAlterar([...periodos, { hora_inicio: '', hora_fim: '' }]);
  }

  function remover(indice) {
    onAlterar(periodos.filter((_, i) => i !== indice));
  }

  return (
    <div className={estilos.listaPeriodos}>
      {periodos.map((periodo, indice) => (
        <div key={indice} className={estilos.linhaPeriodo}>
          <Field label="Entrada">
            <Input type="time" value={periodo.hora_inicio} disabled={!podeEditar} onChange={(e) => atualizar(indice, 'hora_inicio', e.target.value)} />
          </Field>
          <Field label="Saída">
            <Input type="time" value={periodo.hora_fim} disabled={!podeEditar} onChange={(e) => atualizar(indice, 'hora_fim', e.target.value)} />
          </Field>
          {podeEditar && periodos.length > 1 && (
            <Button type="button" variante="secondary" tamanho="sm" onClick={() => remover(indice)}>
              Remover
            </Button>
          )}
        </div>
      ))}
      {podeEditar && (
        <Button type="button" variante="secondary" tamanho="sm" icone="plus" onClick={adicionar}>
          Adicionar período
        </Button>
      )}
    </div>
  );
}
