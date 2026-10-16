import LancamentoItem from './LancamentoItem';
import { alternarSelecao } from '../../lib/funcionarios/lancamentosCalculo';
import estilosPagamentos from './pagamentos.module.css';

// Lançamentos PENDENTES da funcionária dentro do modal de pagamento
// (migration 0076). A seleção é a MESMA do bloco da pessoa em A Pagar
// (estado controlado lá): nada vem marcado sozinho; marcar/desmarcar aqui
// ou no bloco é a mesma coisa. O que ficar desmarcado continua pendente.
export default function LancamentosSelecao({ lancamentos, selecionados, onAlterar, desabilitado = false }) {
  if (!lancamentos || lancamentos.length === 0) return null;

  return (
    <section aria-labelledby="lancamentos-pendentes-pagamento">
      <h4 id="lancamentos-pendentes-pagamento">Lançamentos pendentes</h4>
      <p className={estilosPagamentos.prevista}>Marque os que entram neste pagamento. Os não marcados continuam pendentes.</p>
      <ul className={estilosPagamentos.listaLancamentosSelecao}>
        {lancamentos.map((l) => (
          <li key={l.id}>
            <LancamentoItem lancamento={l} marcado={selecionados.has(l.id)} onAlternar={(id) => onAlterar(alternarSelecao(selecionados, id))} desabilitado={desabilitado} />
          </li>
        ))}
      </ul>
    </section>
  );
}
