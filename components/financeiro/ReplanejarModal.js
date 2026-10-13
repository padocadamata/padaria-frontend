import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { formatarValorEditavel, lerValorMonetario } from '../../lib/funcionarios/pagamentosCalculo';
import { FORMAS_A_PRAZO, centavos, deCentavos, formatarReais, rotuloForma } from '../../lib/financeiro/contasPagarRegras';
import { replanejarConta } from '../../lib/financeiro/contasPagar';
import { formatarData } from './formatacao';
import estilos from './financeiro.module.css';

// Replanejar (migration 0073): vencimentos/valores das parcelas AINDA NÃO
// PAGAS e a forma prevista (só "a prazo"). Parcelas pagas aparecem só para
// conferência e nunca mudam. Compra: a soma precisa continuar igual ao
// total da compra. Despesa manual: o total pode mudar (fica auditado).
export default function ReplanejarModal({ conta, parcelas, onFechar, onSalvo }) {
  const pagas = parcelas.filter((p) => p.situacao === 'paga');
  const [pendentes, setPendentes] = useState(() =>
    parcelas.filter((p) => p.situacao === 'pendente').map((p) => ({ id: p.id, numero: p.numero, vencimento: p.vencimento, valorTexto: formatarValorEditavel(p.valor) }))
  );
  const [forma, setForma] = useState(conta.forma_prevista);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const ehCompra = conta.origem === 'compra';
  const somaPagas = pagas.reduce((s, p) => s + centavos(p.valor), 0);
  const somaPendentes = pendentes.reduce((s, p) => s + centavos(lerValorMonetario(p.valorTexto) || 0), 0);
  const novoTotal = deCentavos(somaPagas + somaPendentes);
  const confere = !ehCompra || centavos(novoTotal) === centavos(conta.valor_total);

  const alterar = (i, campos) => setPendentes((lista) => lista.map((p, j) => (j === i ? { ...p, ...campos } : p)));

  async function salvar() {
    setErro('');
    const lista = [];
    for (const p of pendentes) {
      const valor = lerValorMonetario(p.valorTexto);
      if (!p.vencimento || valor === null || valor <= 0) return setErro(`Parcela ${p.numero}: informe vencimento e valor maior que zero.`);
      lista.push({ parcela_id: p.id, vencimento: p.vencimento, valor });
    }
    if (!confere) return setErro(`A soma precisa continuar igual ao total da compra (${formatarReais(conta.valor_total)}).`);
    setSalvando(true);
    const { erro: erroRpc } = await replanejarConta(conta.id, conta.condicao === 'a_prazo' ? forma : null, lista);
    setSalvando(false);
    if (erroRpc) return setErro(erroRpc);
    onSalvo();
  }

  return (
    <Modal titulo="Replanejar parcelas" onFechar={salvando ? undefined : onFechar} largura="lg" fecharComEsc={false}>
      <div className={estilos.modalCorpo}>
        {conta.condicao === 'a_prazo' && (
          <div className={estilos.linhaCampos}>
            <Field label="Forma prevista">
              <Select value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS_A_PRAZO.map((f) => (
                  <option key={f.valor} value={f.valor}>{f.rotulo}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {pagas.length > 0 && (
          <>
            <h4 className={estilos.subtitulo}>Pagas (não mudam)</h4>
            <ul className={estilos.listaSimples}>
              {pagas.map((p) => (
                <li key={p.id} className={estilos.itemLista}>
                  <span>{p.numero}/{p.total_parcelas} · vence {formatarData(p.vencimento)}</span>
                  <span>{formatarReais(p.valor)} · pago {formatarData(p.pago_em)} ({rotuloForma(p.forma_pagamento)})</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <h4 className={estilos.subtitulo}>Pendentes</h4>
        {pendentes.length === 0 ? (
          <p className={estilos.vazio}>Não há parcela pendente.</p>
        ) : (
          <ul className={estilos.parcelas}>
            {pendentes.map((p, i) => (
              <li key={p.id} className={estilos.parcela}>
                <span className={estilos.numeroParcela}>{p.numero}</span>
                <Input type="date" aria-label={`Vencimento da parcela ${p.numero}`} value={p.vencimento} onChange={(e) => alterar(i, { vencimento: e.target.value })} />
                <Input inputMode="decimal" aria-label={`Valor da parcela ${p.numero}`} value={p.valorTexto} onChange={(e) => alterar(i, { valorTexto: e.target.value })} />
              </li>
            ))}
          </ul>
        )}
        <div className={estilos.conferencia}>
          <span>Total depois do replanejamento: <strong>{formatarReais(novoTotal)}</strong></span>
          {ehCompra && (
            <span className={confere ? estilos.ok : estilos.diferenca}>
              {confere ? 'Confere com o total da compra' : `Precisa ser ${formatarReais(conta.valor_total)}`}
            </span>
          )}
        </div>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Voltar</Button>
          <Button onClick={salvar} disabled={salvando || pendentes.length === 0 && forma === conta.forma_prevista}>{salvando ? 'Salvando...' : 'Salvar replanejamento'}</Button>
        </div>
      </div>
    </Modal>
  );
}
