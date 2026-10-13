import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { formatarValorEditavel, lerValorMonetario } from '../../lib/funcionarios/pagamentosCalculo';
import {
  FORMAS_A_PRAZO, FORMAS_NO_ATO, centavos, formatarReais, gerarParcelas, somaParcelasTexto,
} from '../../lib/financeiro/contasPagarRegras';
import { somarDias } from '../../lib/data/dataLocal';
import estilos from './financeiro.module.css';

// Seção "Pagamento" (migration 0073) -- reutilizada no recebimento de pedido,
// na compra presencial, no "Lançar financeiro" e na nova despesa manual.
// Componente CONTROLADO: o estado vem de estadoPagamentoInicial() e o
// payload sai de montarPagamento() (lib/financeiro/contasPagarRegras.js).
//
//   total:          total da compra (reais) quando conhecido; null quando o
//                   valor é digitado aqui (despesa manual -> totalEditavel).
//   permitirNaoLancar: mostra "Não lançar agora" (receber sem financeiro).
//   podePagar:      sem contas_pagar.pagar não existe "Pago no ato".
export default function SecaoPagamento({
  estado,
  onChange,
  total = null,
  totalEditavel = false,
  dataBase,
  hoje,
  permitirNaoLancar = true,
  podePagar = true,
  titulo = 'Pagamento',
  mostrarObservacao = true,
  desabilitado = false,
}) {
  const alterar = (campos) => onChange({ ...estado, ...campos });
  const totalEfetivo = totalEditavel ? lerValorMonetario(estado.totalTexto) : total;

  function escolherModo(modo) {
    const campos = { modo };
    if (modo === 'no_ato') {
      if (!estado.pagoEm) campos.pagoEm = dataBase || hoje;
      if (estado.forma === 'boleto') campos.forma = 'pix';
    }
    if (modo === 'a_prazo') {
      if (!estado.forma || estado.forma.startsWith('cartao_')) campos.forma = 'boleto';
      const primeiro = estado.primeiroVencimento || (dataBase ? somarDias(dataBase, 30) : hoje);
      campos.primeiroVencimento = primeiro;
      if ((!estado.parcelas || estado.parcelas.length === 0) && totalEfetivo > 0) {
        campos.parcelas = gerarParcelas({ total: totalEfetivo, quantidade: estado.quantidade, primeiroVencimento: primeiro, intervaloDias: estado.intervaloDias });
      }
    }
    alterar(campos);
  }

  function gerar() {
    if (!(totalEfetivo > 0) || !estado.primeiroVencimento) return;
    alterar({
      parcelas: gerarParcelas({
        total: totalEfetivo,
        quantidade: estado.quantidade,
        primeiroVencimento: estado.primeiroVencimento,
        intervaloDias: estado.intervaloDias,
      }),
    });
  }

  function alterarParcela(indice, campos) {
    alterar({ parcelas: estado.parcelas.map((p, i) => (i === indice ? { ...p, ...campos } : p)) });
  }

  const soma = somaParcelasTexto(estado.parcelas);
  const confere = totalEfetivo !== null && totalEfetivo !== undefined && centavos(soma) === centavos(totalEfetivo);
  const semValor = !totalEditavel && total !== null && total !== undefined && centavos(total) === 0;

  const opcao = (modo, rotulo, disabled = false) => (
    <Button
      variante={estado.modo === modo ? 'primary' : 'secondary'}
      tamanho="sm"
      onClick={() => escolherModo(modo)}
      disabled={desabilitado || disabled}
      aria-pressed={estado.modo === modo}
    >
      {rotulo}
    </Button>
  );

  return (
    <section className={estilos.secaoPagamento} aria-label={titulo}>
      <h4 className={estilos.secaoTitulo}>{titulo}</h4>
      <div className={estilos.opcoes} role="group" aria-label="Condição de pagamento">
        {permitirNaoLancar && opcao('nao_lancar', 'Não lançar agora')}
        {opcao('no_ato', 'Pago no ato', !podePagar)}
        {opcao('a_prazo', 'A prazo')}
      </div>
      {!podePagar && <p className={estilos.dica}>“Pago no ato” registra o pagamento junto e exige a permissão de pagar no Financeiro.</p>}

      {estado.modo === 'nao_lancar' && (
        <p className={estilos.dica}>A compra entra em Financeiro &gt; Contas a Pagar &gt; “Compras sem lançamento”, para lançar quando a condição chegar.</p>
      )}

      {semValor && estado.modo !== 'nao_lancar' && (
        <p className={estilos.diferenca}>Esta compra não tem valor a pagar (total R$ 0,00) — não há financeiro a lançar.</p>
      )}

      {estado.modo !== 'nao_lancar' && totalEditavel && (
        <div className={estilos.linhaCampos}>
          <Field label="Valor total *">
            <Input inputMode="decimal" value={estado.totalTexto || ''} onChange={(e) => alterar({ totalTexto: e.target.value })} placeholder="0,00" disabled={desabilitado} />
          </Field>
        </div>
      )}

      {estado.modo === 'no_ato' && (
        <div className={estilos.linhaCampos}>
          <Field label="Forma *">
            <Select value={estado.forma} onChange={(e) => alterar({ forma: e.target.value })} disabled={desabilitado}>
              {FORMAS_NO_ATO.map((f) => (
                <option key={f.valor} value={f.valor}>{f.rotulo}</option>
              ))}
            </Select>
          </Field>
          <Field label="Pago em *">
            <Input type="date" max={hoje} value={estado.pagoEm} onChange={(e) => alterar({ pagoEm: e.target.value })} disabled={desabilitado} />
          </Field>
          {!totalEditavel && (
            <Field label="Valor">
              <p className={estilos.totalValor}>{formatarReais(total)}</p>
            </Field>
          )}
        </div>
      )}

      {estado.modo === 'a_prazo' && (
        <>
          <div className={estilos.linhaCampos}>
            <Field label="Forma prevista *">
              <Select value={estado.forma} onChange={(e) => alterar({ forma: e.target.value })} disabled={desabilitado}>
                {FORMAS_A_PRAZO.map((f) => (
                  <option key={f.valor} value={f.valor}>{f.rotulo}</option>
                ))}
              </Select>
            </Field>
            <Field label="Parcelas">
              <Input type="number" min="1" max="60" value={estado.quantidade} onChange={(e) => alterar({ quantidade: e.target.value })} disabled={desabilitado} />
            </Field>
            <Field label="1º vencimento">
              <Input type="date" value={estado.primeiroVencimento} onChange={(e) => alterar({ primeiroVencimento: e.target.value })} disabled={desabilitado} />
            </Field>
            <Field label="Intervalo (dias)">
              <Input type="number" min="1" value={estado.intervaloDias} onChange={(e) => alterar({ intervaloDias: e.target.value })} disabled={desabilitado} />
            </Field>
          </div>
          <div>
            <Button variante="secondary" tamanho="sm" onClick={gerar} disabled={desabilitado || !(totalEfetivo > 0) || !estado.primeiroVencimento}>
              {estado.parcelas?.length ? 'Recalcular parcelas' : 'Gerar parcelas'}
            </Button>
          </div>
          {estado.parcelas?.length > 0 && (
            <>
              <ul className={estilos.parcelas} aria-label="Parcelas">
                {estado.parcelas.map((p, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className={estilos.parcela}>
                    <span className={estilos.numeroParcela}>{i + 1}/{estado.parcelas.length}</span>
                    <Input type="date" aria-label={`Vencimento da parcela ${i + 1}`} value={p.vencimento} onChange={(e) => alterarParcela(i, { vencimento: e.target.value })} disabled={desabilitado} />
                    <Input
                      inputMode="decimal"
                      aria-label={`Valor da parcela ${i + 1}`}
                      value={p.valorTexto}
                      onChange={(e) => alterarParcela(i, { valorTexto: e.target.value })}
                      onBlur={() => {
                        const v = lerValorMonetario(p.valorTexto);
                        if (v !== null) alterarParcela(i, { valorTexto: formatarValorEditavel(v) });
                      }}
                      disabled={desabilitado}
                    />
                  </li>
                ))}
              </ul>
              <div className={estilos.conferencia}>
                <span>Soma das parcelas: <strong>{formatarReais(soma)}</strong></span>
                {totalEfetivo !== null && totalEfetivo !== undefined && (
                  <span className={confere ? estilos.ok : estilos.diferenca}>
                    {confere ? `Confere com o total (${formatarReais(totalEfetivo)})` : `Total: ${formatarReais(totalEfetivo)} — ajuste ou recalcule`}
                  </span>
                )}
              </div>
              <p className={estilos.dica}>Valores e vencimentos podem ser ajustados; a diferença de centavos do cálculo automático fica na 1ª parcela.</p>
            </>
          )}
        </>
      )}

      {estado.modo !== 'nao_lancar' && mostrarObservacao && (
        <Field label="Observação do financeiro">
          <Textarea rows={2} value={estado.observacao} onChange={(e) => alterar({ observacao: e.target.value })} disabled={desabilitado} />
        </Field>
      )}
    </section>
  );
}
