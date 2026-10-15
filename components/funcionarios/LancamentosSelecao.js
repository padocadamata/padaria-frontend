import Badge from '../ui/Badge';
import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import { rotuloNatureza, sinalNatureza } from '../../lib/funcionarios/lancamentosCalculo';
import { cx } from '../../lib/design/cx';
import estilosPagamentos from './pagamentos.module.css';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = String(dataYYYYMMDD).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// Lançamentos PENDENTES da funcionária dentro do modal de pagamento
// (migration 0076): nada vem marcado -- a pessoa escolhe o que entra neste
// pagamento; o que ficar desmarcado continua pendente para um próximo.
// Desconto/acréscimo distinguíveis por palavra e sinal (não só por cor).
export default function LancamentosSelecao({ lancamentos, selecionados, onAlterar, desabilitado = false }) {
  if (!lancamentos || lancamentos.length === 0) return null;

  function alternar(id) {
    const novo = new Set(selecionados);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    onAlterar(novo);
  }

  return (
    <section aria-labelledby="lancamentos-pendentes-pagamento">
      <h4 id="lancamentos-pendentes-pagamento">Lançamentos pendentes</h4>
      <p className={estilosPagamentos.prevista}>Marque os que entram neste pagamento. Os não marcados continuam pendentes.</p>
      <ul className={estilosPagamentos.listaLancamentosSelecao}>
        {lancamentos.map((l) => {
          const marcado = selecionados.has(l.id);
          return (
            <li key={l.id}>
              <label className={cx(estilosPagamentos.lancamentoSelecao, marcado && estilosPagamentos.lancamentoSelecaoMarcado)}>
                <input type="checkbox" checked={marcado} onChange={() => alternar(l.id)} disabled={desabilitado} />
                <span className={estilosPagamentos.lancamentoInfo}>
                  <span className={estilosPagamentos.lancamentoLinha}>
                    <Badge tom={l.natureza === 'acrescimo' ? 'info' : 'warning'}>{rotuloNatureza(l.natureza)}</Badge>
                    <strong>{l.tipo_nome}</strong>
                    <span className={estilosPagamentos.prevista}>{formatarData(l.data_lancamento)}</span>
                  </span>
                  {l.observacao && <span className={estilosPagamentos.prevista}>{l.observacao}</span>}
                </span>
                <span className={cx(estilosPagamentos.lancamentoValor, l.natureza === 'acrescimo' ? estilosPagamentos.valorAcrescimo : estilosPagamentos.valorDesconto)}>
                  {sinalNatureza(l.natureza)} {formatarMoeda(l.valor)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
