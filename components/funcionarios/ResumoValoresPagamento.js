import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import estilosPagamentos from './pagamentos.module.css';

// Linhas de conferência abaixo dos descontos do modal de pagamento:
//   (+) acréscimos selecionados, (−) descontos de lançamentos selecionados,
//   (−) descontos digitados, = líquido.
// Mesma conta das RPCs (migration 0076): líquido = bruto + acréscimos −
// descontos. `valores` vem de resumirComLancamentos.
export default function ResumoValoresPagamento({ valores }) {
  const comLancamentos = valores.acrescimos > 0 || valores.descontosLancamentos > 0;
  return (
    <>
      {valores.acrescimos > 0 && (
        <div className={estilosPagamentos.resumoLinha}>
          <span>Acréscimos selecionados</span>
          <span>+ {formatarMoeda(valores.acrescimos)}</span>
        </div>
      )}
      {valores.descontosLancamentos > 0 && (
        <div className={estilosPagamentos.resumoLinha}>
          <span>Descontos selecionados (lançamentos)</span>
          <span>− {formatarMoeda(valores.descontosLancamentos)}</span>
        </div>
      )}
      <div className={estilosPagamentos.resumoLinha}>
        <span>{comLancamentos ? 'Descontos digitados' : 'Descontos'}</span>
        <span>-{formatarMoeda(valores.descontosManuais)}</span>
      </div>
      <div className={estilosPagamentos.resumoLinha}>
        <strong>Líquido</strong>
        <strong>{formatarMoeda(valores.liquido)}</strong>
      </div>
    </>
  );
}
