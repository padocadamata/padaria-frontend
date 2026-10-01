import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Badge from '../ui/Badge';
import estilos from './escala.module.css';

// Editor de 1..N períodos de trabalho (entrada/saída) -- reutilizado por
// EscalaDiaModal (1 dia) e EscalaLoteModal (vários dias/funcionários de
// uma vez, mesmos períodos aplicados a todos). Controlado: quem usa é
// dono do array `periodos`, este componente só avisa `onAlterar`.
//
// mostrarNaturezaFinanceira (migrations 0065/0066, frente Pagamentos): true
// quando quem chama (EscalaDiaModal) sabe que a forma de remuneração ATUAL
// do funcionário NÃO é por_hora -- para por_hora o campo é inerte (todo
// período já é remunerado). Um período já marcado como extra sempre mostra
// o selo, mesmo sem o toggle, e a natureza é sempre reenviada ao salvar.
// Por padrão false -- EscalaLoteModal/EscalaPadraoLoteModal nunca passam
// essa prop, continuam idênticos a antes (nenhum período criado em lote
// carrega natureza_financeira).
export default function PeriodosEditor({ periodos, onAlterar, podeEditar, mostrarNaturezaFinanceira = false }) {
  function atualizar(indice, campo, valor) {
    onAlterar(periodos.map((p, i) => (i === indice ? { ...p, [campo]: valor } : p)));
  }

  function adicionar() {
    onAlterar([...periodos, mostrarNaturezaFinanceira ? { hora_inicio: '', hora_fim: '', natureza_financeira: 'normal' } : { hora_inicio: '', hora_fim: '' }]);
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
          {mostrarNaturezaFinanceira && podeEditar && (
            <Checkbox
              rotulo="Extra remunerado"
              checked={periodo.natureza_financeira === 'extra_remunerado'}
              onChange={(e) => atualizar(indice, 'natureza_financeira', e.target.checked ? 'extra_remunerado' : 'normal')}
            />
          )}
          {(!mostrarNaturezaFinanceira || !podeEditar) && periodo.natureza_financeira === 'extra_remunerado' && (
            <Badge tom="info">Extra remunerado</Badge>
          )}
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
