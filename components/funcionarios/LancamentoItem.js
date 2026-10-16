import { useId } from 'react';
import Badge from '../ui/Badge';
import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import { rotuloNatureza, sinalNatureza } from '../../lib/funcionarios/lancamentosCalculo';
import { cx } from '../../lib/design/cx';
import estilosPagamentos from './pagamentos.module.css';

export function formatarDataLancamento(dataYYYYMMDD) {
  const [ano, mes, dia] = String(dataYYYYMMDD).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// 1 lançamento pendente (migration 0076): tipo, natureza, data, observação
// e valor com sinal (− desconto / + acréscimo -- palavra e sinal, nunca só
// cor). Mesmo item no bloco da pessoa em A Pagar, no modal de pagamento e
// na lista de quem está fora de A Pagar.
// onAlternar presente = selecionável (caixa + rótulo clicável); `acoes`
// (editar/cancelar) fica fora do rótulo para não marcar ao clicar nelas.
export default function LancamentoItem({ lancamento: l, marcado = false, onAlternar, desabilitado = false, acoes = null }) {
  const id = useId();
  const selecionavel = typeof onAlternar === 'function';
  const valor = `${sinalNatureza(l.natureza)} ${formatarMoeda(l.valor)}`;
  const info = (
    <>
      <span className={estilosPagamentos.lancamentoLinha}>
        <strong className={estilosPagamentos.lancamentoTipo}>{l.tipo_nome}</strong>
        <Badge tom={l.natureza === 'acrescimo' ? 'success' : 'warning'}>{rotuloNatureza(l.natureza)}</Badge>
        <span className={estilosPagamentos.lancamentoData}>{formatarDataLancamento(l.data_lancamento)}</span>
      </span>
      {l.observacao && <span className={estilosPagamentos.lancamentoObservacao}>{l.observacao}</span>}
    </>
  );
  return (
    <div className={cx(estilosPagamentos.lancamento, selecionavel && estilosPagamentos.lancamentoSelecionavel, marcado && estilosPagamentos.lancamentoMarcado)}>
      {selecionavel && (
        <span className={estilosPagamentos.lancamentoCaixa}>
          <input
            id={id}
            type="checkbox"
            checked={marcado}
            onChange={() => onAlternar(l.id)}
            disabled={desabilitado}
            aria-label={`Incluir neste pagamento: ${l.tipo_nome}, ${rotuloNatureza(l.natureza)} de ${formatarMoeda(l.valor)}, ${formatarDataLancamento(l.data_lancamento)}`}
          />
        </span>
      )}
      {selecionavel ? (
        <label htmlFor={id} className={estilosPagamentos.lancamentoInfo}>
          {info}
        </label>
      ) : (
        <span className={estilosPagamentos.lancamentoInfo}>{info}</span>
      )}
      <span className={cx(estilosPagamentos.lancamentoValor, l.natureza === 'acrescimo' ? estilosPagamentos.valorAcrescimo : estilosPagamentos.valorDesconto)}>{valor}</span>
      {acoes && <span className={estilosPagamentos.lancamentoAcoes}>{acoes}</span>}
    </div>
  );
}
