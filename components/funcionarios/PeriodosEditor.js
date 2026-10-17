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

  // Layout: com 2+ períodos, cada um vira um bloco próprio ("Período N" +
  // Remover no topo, campos embaixo); Entrada/Saída têm largura mínima e
  // QUEBRAM de linha (nunca encolhem a ponto do campo de horário invadir o
  // rótulo vizinho). Comportamento (adicionar/remover/alterar) inalterado.
  const varios = periodos.length > 1;
  return (
    <div className={estilos.listaPeriodos}>
      {periodos.map((periodo, indice) => (
        <div
          key={indice}
          className={varios ? estilos.periodoBloco : undefined}
          role={varios ? 'group' : undefined}
          aria-label={varios ? `Período ${indice + 1}` : undefined}
        >
          {varios && (
            <div className={estilos.periodoTopo}>
              <span className={estilos.periodoTitulo}>Período {indice + 1}</span>
              {podeEditar && (
                <Button type="button" variante="secondary" tamanho="sm" onClick={() => remover(indice)} aria-label={`Remover período ${indice + 1}`}>
                  Remover
                </Button>
              )}
            </div>
          )}
          <div className={estilos.linhaPeriodo}>
            <Field label="Entrada" className={estilos.campoHorario}>
              <Input type="time" value={periodo.hora_inicio} disabled={!podeEditar} onChange={(e) => atualizar(indice, 'hora_inicio', e.target.value)} />
            </Field>
            <Field label="Saída" className={estilos.campoHorario}>
              <Input type="time" value={periodo.hora_fim} disabled={!podeEditar} onChange={(e) => atualizar(indice, 'hora_fim', e.target.value)} />
            </Field>
            {mostrarNaturezaFinanceira && podeEditar && (
              <Checkbox
                className={estilos.extraPeriodo}
                rotulo="Extra remunerado"
                checked={periodo.natureza_financeira === 'extra_remunerado'}
                onChange={(e) => atualizar(indice, 'natureza_financeira', e.target.checked ? 'extra_remunerado' : 'normal')}
              />
            )}
            {(!mostrarNaturezaFinanceira || !podeEditar) && periodo.natureza_financeira === 'extra_remunerado' && (
              <Badge tom="info">Extra remunerado</Badge>
            )}
          </div>
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
