import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import EditorDescontos from './EditorDescontos';
import ItensComAjuste from './ItensComAjuste';
import { formatarMoeda, criarPagamentoPorHora, criarPagamentoRegularizacaoHistorica } from '../../lib/funcionarios/pagamentos';
import { normalizarDescontos, resumirValores, somarValoresAPagar, montarItensPayload, payloadExigeValorManual, MENSAGEM_SEM_0068 } from '../../lib/funcionarios/pagamentosCalculo';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

// Confirma atomicamente 1 pagamento natureza=por_hora (migrations 0066/
// 0068) -- não existe rascunho persistido; a RPC grava cabeçalho + jornadas
// + descontos numa única transação e recalcula tudo. Cada jornada vai com
// o valor automático, ou com o "Valor a pagar" informado (ajuste manual,
// só daquela jornada -- nunca o valor/hora global).
// modo="historico" (migration 0068): mesma conferência, mas grava uma
// REGULARIZAÇÃO HISTÓRICA (valor manual obrigatório em todas as jornadas,
// sem valor/hora, sem forma de remuneração).
export default function PagamentoPorHoraModal({ funcionario, jornadas, digitados = {}, suporteValorManual = true, modo = 'por_hora', onFechar, onConfirmado }) {
  const historico = modo === 'historico';
  const [descontos, setDescontos] = useState([]);
  const [observacoesAjuste, setObservacoesAjuste] = useState({});
  const [dataEfetiva, setDataEfetiva] = useState(dataLocalHoje());
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const { payload: descontosPayload, erros: errosDescontos } = normalizarDescontos(descontos);
  const valores = resumirValores(somarValoresAPagar(jornadas, digitados), descontosPayload);

  async function confirmar() {
    setErro('');
    if (jornadas.length === 0) {
      setErro('Selecione ao menos 1 jornada.');
      return;
    }
    const { payload: itensPayload, erros: errosItens } = montarItensPayload(jornadas, digitados, observacoesAjuste);
    if (errosItens.length > 0) {
      setErro(errosItens.join(' '));
      return;
    }
    if (historico && itensPayload.some((linha) => !Object.prototype.hasOwnProperty.call(linha, 'valor'))) {
      setErro('Informe o valor a pagar de todas as jornadas da regularização histórica.');
      return;
    }
    if (!historico && !suporteValorManual && payloadExigeValorManual(itensPayload)) {
      setErro(MENSAGEM_SEM_0068);
      return;
    }
    if (errosDescontos.length > 0) {
      setErro(errosDescontos.join(' '));
      return;
    }
    if (!dataEfetiva) {
      setErro('Informe a data efetiva do pagamento.');
      return;
    }
    if (valores.liquido < 0) {
      setErro('Os descontos ultrapassam o valor bruto do pagamento.');
      return;
    }

    setSalvando(true);
    const criar = historico ? criarPagamentoRegularizacaoHistorica : criarPagamentoPorHora;
    const { id, erro: erroRpc } = await criar({
      funcionarioId: funcionario.id,
      jornadas: itensPayload,
      descontos: descontosPayload,
      dataEfetiva,
      observacao,
    });
    setSalvando(false);

    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onConfirmado(id);
  }

  return (
    <Modal titulo={`${historico ? 'Regularização histórica' : 'Pagamento por hora'} — ${funcionario.nome}`} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        {historico && (
          <p className={estilosPagamentos.prevista}>Registro financeiro manual de jornadas anteriores ao primeiro valor/hora. Não define forma de remuneração.</p>
        )}
        <ItensComAjuste itens={jornadas} digitados={digitados} observacoes={observacoesAjuste} onObservacao={setObservacoesAjuste} historico={historico} />

        <div className={estilosPagamentos.resumoLinha}>
          <strong>Bruto</strong>
          <strong>{formatarMoeda(valores.bruto)}</strong>
        </div>

        <h4>Descontos</h4>
        <EditorDescontos descontos={descontos} onAlterar={setDescontos} />

        <div className={estilosPagamentos.resumoLinha}>
          <span>Descontos</span>
          <span>-{formatarMoeda(valores.descontos)}</span>
        </div>
        <div className={estilosPagamentos.resumoLinha}>
          <strong>Líquido</strong>
          <strong>{formatarMoeda(valores.liquido)}</strong>
        </div>

        <Field label="Data efetiva do pagamento">
          <Input type="date" value={dataEfetiva} onChange={(e) => setDataEfetiva(e.target.value)} />
        </Field>
        <Field label="Observação (opcional)">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        </Field>

        {erro && <Alert tom="danger">{erro}</Alert>}

        <div className={estilosEscala.rodapePlanejamento}>
          <Button type="button" variante="secondary" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirmar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Confirmar pagamento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
