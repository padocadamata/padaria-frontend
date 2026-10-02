import Badge from '../ui/Badge';
import Input from '../ui/Input';
import { formatarDataCurta, formatarHora, rotuloDiaSemana } from '../../lib/funcionarios/escala';
import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import { chaveJornada, formatarValorEditavel, resolverValorAPagar } from '../../lib/funcionarios/pagamentosCalculo';
import estilosPagamentos from './pagamentos.module.css';

// 1 jornada (ou extra remunerado) pendente com "Valor calculado" (sugestão
// automática: duração × valor/hora vigente na data) e "Valor a pagar"
// (editável -- começa com o calculado; obrigatório quando não há
// valor/hora vigente). O ajuste vale só para ESTA jornada; nunca altera o
// valor/hora global (migration 0068).
export default function JornadaValorLinha({ item, selecionada, onAlternar, digitado, onDigitar, extra = false, mostrarPrevista = true }) {
  const chave = chaveJornada(item);
  const temCalculo = item.valor !== null && item.valor !== undefined;
  const textoCampo = digitado !== undefined ? digitado : formatarValorEditavel(item.valor);
  const r = resolverValorAPagar(item.valor ?? null, digitado);

  return (
    <li className={estilosPagamentos.linhaJornada}>
      <label className={estilosPagamentos.jornadaInfo}>
        <input type="checkbox" checked={selecionada} onChange={() => onAlternar(chave)} />
        <span>
          <strong>
            {rotuloDiaSemana(item.data)} {formatarDataCurta(item.data)}
          </strong>{' '}
          {formatarHora(item.hora_inicio)}–{formatarHora(item.hora_fim)} · {item.duracao_minutos}min
          {extra ? ' · extra' : item.natureza_financeira === 'extra_remunerado' ? ' · extra' : ''}
          {mostrarPrevista && item.data_prevista && <span className={estilosPagamentos.prevista}> · previsto {formatarDataCurta(item.data_prevista)}</span>}
        </span>
      </label>
      <span className={estilosPagamentos.jornadaCalculado}>
        Valor calculado:{' '}
        {temCalculo ? (
          <>
            {formatarMoeda(item.valor)} <span className={estilosPagamentos.prevista}>({formatarMoeda(item.valor_hora_aplicado)}/h)</span>
          </>
        ) : (
          <em>não disponível</em>
        )}
      </span>
      <span className={estilosPagamentos.jornadaValor}>
        <Input
          inputMode="decimal"
          aria-label={`Valor a pagar ${formatarDataCurta(item.data)} ${formatarHora(item.hora_inicio)}`}
          placeholder={temCalculo ? formatarValorEditavel(item.valor) : 'Valor a pagar'}
          value={textoCampo}
          onChange={(e) => onDigitar(chave, e.target.value)}
        />
        {r.invalido && <Badge tom="danger">inválido</Badge>}
        {!r.invalido && r.pendente && <Badge tom="warning">informe</Badge>}
        {!r.invalido && r.manual && <Badge tom="info">ajustado</Badge>}
      </span>
    </li>
  );
}
