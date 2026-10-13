import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { lerValorMonetario } from '../../lib/funcionarios/pagamentosCalculo';
import { FORMAS_PAGAMENTO, formatarReais, valorEfetivo } from '../../lib/financeiro/contasPagarRegras';
import { pagarParcela } from '../../lib/financeiro/contasPagar';
import { formatarData } from './formatacao';
import estilos from './financeiro.module.css';

// Confirmar pagamento INTEGRAL de uma parcela (migration 0073):
// valor pago = original + juros + multa − desconto, sempre explícito -- a
// diferença nunca fica escondida só no valor pago. Data padrão = hoje em
// São Paulo, nunca no futuro.
export default function PagarParcelaModal({ parcela, onFechar, onPago }) {
  const hoje = dataLocalHoje();
  const [pagoEm, setPagoEm] = useState(hoje);
  const [forma, setForma] = useState(parcela.forma_prevista || 'pix');
  const [juros, setJuros] = useState('');
  const [multa, setMulta] = useState('');
  const [desconto, setDesconto] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const ler = (t) => (String(t).trim() === '' ? 0 : lerValorMonetario(t));
  const valores = { juros: ler(juros), multa: ler(multa), desconto: ler(desconto) };
  const invalido = Object.values(valores).some((v) => v === null);
  const efetivo = invalido ? null : valorEfetivo({ original: parcela.valor, ...valores });

  async function confirmar() {
    setErro('');
    if (!pagoEm) return setErro('Informe a data do pagamento.');
    if (pagoEm > hoje) return setErro('A data do pagamento não pode ser no futuro.');
    if (invalido) return setErro('Juros, multa e desconto precisam ser valores válidos (ou vazios).');
    if (!(efetivo > 0)) return setErro('O valor efetivamente pago precisa ser maior que zero.');
    setSalvando(true);
    const { erro: erroRpc } = await pagarParcela(parcela.id, { pagoEm, forma, ...valores, valorPago: efetivo, observacao });
    setSalvando(false);
    if (erroRpc) return setErro(erroRpc);
    onPago();
  }

  return (
    <Modal titulo={`Pagar parcela ${parcela.numero}/${parcela.total_parcelas} — ${parcela.credor_exibicao || ''}`} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilos.modalCorpo}>
        <dl className={estilos.detalheLista}>
          <dt>Vencimento</dt>
          <dd>{formatarData(parcela.vencimento)}</dd>
          <dt>Valor original</dt>
          <dd><strong>{formatarReais(parcela.valor)}</strong></dd>
        </dl>
        <div className={estilos.linhaCampos}>
          <Field label="Pago em *">
            <Input type="date" max={hoje} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
          </Field>
          <Field label="Forma *">
            <Select value={forma} onChange={(e) => setForma(e.target.value)}>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f.valor} value={f.valor}>{f.rotulo}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className={estilos.linhaCampos}>
          <Field label="Juros">
            <Input inputMode="decimal" placeholder="0,00" value={juros} onChange={(e) => setJuros(e.target.value)} />
          </Field>
          <Field label="Multa">
            <Input inputMode="decimal" placeholder="0,00" value={multa} onChange={(e) => setMulta(e.target.value)} />
          </Field>
          <Field label="Desconto">
            <Input inputMode="decimal" placeholder="0,00" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
          </Field>
        </div>
        <p className={estilos.equacao}>
          {formatarReais(parcela.valor)} + juros {formatarReais(valores.juros || 0)} + multa {formatarReais(valores.multa || 0)} − desconto{' '}
          {formatarReais(valores.desconto || 0)} = <strong>{efetivo === null ? '—' : formatarReais(efetivo)}</strong> efetivamente pago
        </p>
        <Field label="Observação">
          <Textarea rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Field>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Voltar</Button>
          <Button onClick={confirmar} disabled={salvando}>{salvando ? 'Registrando...' : 'Confirmar pagamento'}</Button>
        </div>
      </div>
    </Modal>
  );
}
