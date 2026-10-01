import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import EditorDescontos from './EditorDescontos';
import { formatarDataCurta, formatarHora } from '../../lib/funcionarios/escala';
import { formatarMoeda, formatarCompetencia, criarPagamentoMensal } from '../../lib/funcionarios/pagamentos';
import { TIPOS_LANCAMENTO_MENSAL, normalizarDescontos, resumirValores, somarValores, chaveJornada, valorBaseDoLancamento, integralPermitido } from '../../lib/funcionarios/pagamentosCalculo';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

// Confirma atomicamente 1 pagamento natureza=mensal (migration 0066) na
// competência. Vários pagamentos por competência são permitidos:
// tipo de lançamento (integral/adiantamento/parcial/complemento -- NÃO é o
// benefício Adiantamento Salarial) + quanto da base este pagamento quita
// (0..saldo; o banco recusa acima do saldo). A sugestão de desconto por
// falta NUNCA entra sozinha: só por botão explícito, e continua editável.
export default function PagamentoMensalModal({ funcionario, competencia, resumo, extras, onFechar, onConfirmado }) {
  const saldo = Number(resumo.saldo_base || 0);
  const primeiroDaCompetencia = Number(resumo.pagamentos_ativos_qtd || 0) === 0;
  // Integral = quitar TODO o saldo-base pendente da competência (regra
  // também garantida no banco pela migration 0067): com Integral o valor
  // é sempre o saldo atual e o campo fica travado; sem saldo, Integral nem
  // é oferecido (use Complemento para lançar só extras).
  const integralDisponivel = integralPermitido(saldo);
  const [tipoLancamento, setTipoLancamento] = useState(integralDisponivel && primeiroDaCompetencia ? 'integral' : 'complemento');
  const [valorBaseDigitado, setValorBaseDigitado] = useState(saldo > 0 && primeiroDaCompetencia ? String(saldo.toFixed(2)) : '0');
  const ehIntegral = tipoLancamento === 'integral';
  const valorBase = ehIntegral ? String(saldo.toFixed(2)) : valorBaseDigitado;
  const [descontos, setDescontos] = useState([]);
  const [dataEfetiva, setDataEfetiva] = useState(dataLocalHoje());
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const valorBaseCalculado = valorBaseDoLancamento({ tipo: tipoLancamento, digitado: valorBaseDigitado, saldo });
  const valorBaseNumero = valorBaseCalculado ?? NaN;
  const valorBaseValido = valorBaseCalculado !== null && valorBaseCalculado >= 0;
  const valorExtras = somarValores(extras);
  const { payload: descontosPayload, erros: errosDescontos } = normalizarDescontos(descontos);
  const valores = resumirValores((valorBaseValido ? valorBaseNumero : 0) + valorExtras, descontosPayload);
  const sugestaoJaIncluida = descontos.some((d) => d.origem === 'sugestao_falta');

  function aplicarSugestaoFalta() {
    if (resumo.sugestao_desconto_falta === null || sugestaoJaIncluida) return;
    setDescontos([
      ...descontos,
      { tipo: `Faltas (${resumo.faltas_qtd}) — ${formatarCompetencia(competencia)}`, valor: String(resumo.sugestao_desconto_falta), observacao: '', origem: 'sugestao_falta' },
    ]);
  }

  function alterarTipo(novo) {
    if (novo === 'integral' && !integralDisponivel) return;
    // Ao sair de Integral, o campo começa com o saldo, já editável.
    if (tipoLancamento === 'integral' && novo !== 'integral') setValorBaseDigitado(String(saldo.toFixed(2)));
    setTipoLancamento(novo);
  }

  async function confirmar() {
    setErro('');
    if (!valorBaseValido) {
      setErro('Informe quanto da remuneração-base este pagamento quita (0 se for só extras).');
      return;
    }
    if (ehIntegral && (!integralDisponivel || Math.round(valorBaseNumero * 100) !== Math.round(saldo * 100))) {
      setErro('Integral precisa quitar exatamente todo o saldo da competência.');
      return;
    }
    if (valorBaseNumero > saldo + 0.0001) {
      setErro(`O valor da base não pode passar do saldo da competência (${formatarMoeda(saldo)}).`);
      return;
    }
    if (valores.bruto <= 0) {
      setErro('Informe um valor de base maior que zero ou selecione ao menos um extra.');
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
    const { id, erro: erroRpc } = await criarPagamentoMensal({
      funcionarioId: funcionario.id,
      competencia,
      tipoLancamento,
      valorBase: Math.round(valorBaseNumero * 100) / 100,
      extras: extras.map((e) => ({ data: e.data, hora_inicio: e.hora_inicio, hora_fim: e.hora_fim })),
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
    <Modal titulo={`Pagamento mensal — ${funcionario.nome} — ${formatarCompetencia(competencia)}`} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        <div className={estilosPagamentos.resumoLinha}>
          <span>Remuneração-base da competência</span>
          <span>{formatarMoeda(resumo.valor_mensal_base)}</span>
        </div>
        <div className={estilosPagamentos.resumoLinha}>
          <span>Já pago da base ({resumo.pagamentos_ativos_qtd} pagamento(s))</span>
          <span>{formatarMoeda(resumo.valor_base_ja_pago)}</span>
        </div>
        <div className={estilosPagamentos.resumoLinha}>
          <strong>Saldo da base</strong>
          <strong>{formatarMoeda(saldo)}</strong>
        </div>

        <Field label="Tipo de lançamento" dica="Não confundir com o benefício Adiantamento Salarial do cadastro.">
          <Select value={tipoLancamento} onChange={(e) => alterarTipo(e.target.value)}>
            {TIPOS_LANCAMENTO_MENSAL.map((t) => (
              <option key={t.valor} value={t.valor} disabled={t.valor === 'integral' && !integralDisponivel}>
                {t.rotulo}
                {t.valor === 'integral' && !integralDisponivel ? ' (base já quitada)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Valor da base neste pagamento"
          dica={ehIntegral ? `Integral quita todo o saldo da competência: ${formatarMoeda(saldo)}.` : `Entre R$ 0,00 e o saldo (${formatarMoeda(saldo)}).`}
        >
          <Input
            type="number"
            step="0.01"
            min="0"
            max={saldo}
            value={valorBase}
            readOnly={ehIntegral}
            disabled={ehIntegral}
            onChange={(e) => setValorBaseDigitado(e.target.value)}
          />
        </Field>

        {extras.length > 0 && (
          <ul className={estilosPagamentos.listaJornadas}>
            {extras.map((e) => (
              <li key={chaveJornada(e)}>
                Extra: {formatarDataCurta(e.data)} {formatarHora(e.hora_inicio)}–{formatarHora(e.hora_fim)} ({e.duracao_minutos}min × {formatarMoeda(e.valor_hora_aplicado)}/h) — {formatarMoeda(e.valor)}
              </li>
            ))}
          </ul>
        )}

        <div className={estilosPagamentos.resumoLinha}>
          <strong>Bruto</strong>
          <strong>{formatarMoeda(valores.bruto)}</strong>
        </div>

        <h4>Descontos</h4>
        {resumo.sugestao_desconto_falta !== null && (
          <div className={estilosPagamentos.resumoLinha}>
            <span>
              Sugestão: {resumo.faltas_qtd} falta(s) × base/30 = {formatarMoeda(resumo.sugestao_desconto_falta)}
            </span>
            <Button type="button" variante="secondary" tamanho="sm" onClick={aplicarSugestaoFalta} disabled={sugestaoJaIncluida}>
              {sugestaoJaIncluida ? 'Sugestão incluída' : 'Incluir sugestão'}
            </Button>
          </div>
        )}
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
