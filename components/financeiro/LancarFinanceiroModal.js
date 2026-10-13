import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import SecaoPagamento from './SecaoPagamento';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { estadoPagamentoInicial, formatarReais, montarPagamento } from '../../lib/financeiro/contasPagarRegras';
import { lancarFinanceiroCompra } from '../../lib/financeiro/contasPagar';
import { formatarData } from './formatacao';
import estilos from './financeiro.module.css';

// "Lançar financeiro" de uma compra já recebida (fila "Compras sem
// lançamento" ou seção Financeiro do pedido). O total vem da compra e é
// conferido de novo pelo banco (contas_pagar_lancar_compra).
export default function LancarFinanceiroModal({ compra, podePagar, onFechar, onLancado }) {
  const hoje = dataLocalHoje();
  const dataBase = compra.data_compra || hoje;
  const total = compra.total === null || compra.total === undefined ? null : Number(compra.total);
  const [pagamento, setPagamento] = useState(() => ({ ...estadoPagamentoInicial({ dataBase }), modo: podePagar ? 'no_ato' : 'a_prazo', forma: podePagar ? 'pix' : 'boleto' }));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    const r = montarPagamento(pagamento, { total, hoje, exigeLancamento: true });
    if (r.erro) return setErro(r.erro);
    setErro('');
    setSalvando(true);
    const { erro: erroRpc } = await lancarFinanceiroCompra(compra.pedido_id, r.payload);
    setSalvando(false);
    if (erroRpc) return setErro(erroRpc);
    onLancado();
  }

  return (
    <Modal titulo={`Lançar financeiro — ${compra.fornecedor_nome || ''}`} onFechar={salvando ? undefined : onFechar} largura="lg" fecharComEsc={false}>
      <div className={estilos.modalCorpo}>
        <dl className={estilos.detalheLista}>
          <dt>Data da compra</dt>
          <dd>{formatarData(compra.data_compra)}</dd>
          <dt>Total recebido</dt>
          <dd><strong>{formatarReais(total)}</strong></dd>
          {compra.numero_nota_fiscal && (
            <>
              <dt>Nota fiscal</dt>
              <dd>{compra.numero_nota_fiscal}</dd>
            </>
          )}
        </dl>
        {compra.anterior_implantacao && (
          <Alert tom="info">Compra recebida antes da implantação do Financeiro — o lançamento é opcional.</Alert>
        )}
        <SecaoPagamento
          estado={pagamento}
          onChange={setPagamento}
          total={total}
          dataBase={dataBase}
          hoje={hoje}
          permitirNaoLancar={false}
          podePagar={podePagar}
          desabilitado={salvando}
        />
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Voltar</Button>
          <Button onClick={confirmar} disabled={salvando}>{salvando ? 'Lançando...' : 'Lançar financeiro'}</Button>
        </div>
      </div>
    </Modal>
  );
}
