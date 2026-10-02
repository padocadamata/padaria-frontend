import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Textarea from '../ui/Textarea';
import { formatarHora } from '../../lib/funcionarios/escala';
import { buscarDetalhePagamento, cancelarPagamento, formatarMoeda, formatarCompetencia, rotuloNaturezaPagamento } from '../../lib/funcionarios/pagamentos';
import { rotuloTipoLancamento } from '../../lib/funcionarios/pagamentosCalculo';
import { rotuloVinculo } from '../../lib/funcionarios/vinculo';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Detalhe completo de 1 pagamento -- tudo vem do SNAPSHOT gravado na
// confirmação (vínculo, forma, competência, base, valor/hora por jornada,
// descontos, autoria), nunca do cadastro atual. Cancelamento lógico com
// motivo OBRIGATÓRIO (migration 0066); nada é editado nem apagado.
export default function PagamentoDetalheModal({ pagamento, podeCancelar, onFechar, onCancelado }) {
  const [detalhe, setDetalhe] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [formularioCancelar, setFormularioCancelar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    buscarDetalhePagamento(pagamento.id).then((d) => {
      if (!ativo) return;
      setDetalhe(d);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, [pagamento.id]);

  async function confirmarCancelamento() {
    setErro('');
    if (!motivo.trim()) {
      setErro('Informe o motivo do cancelamento.');
      return;
    }
    setCancelando(true);
    const { erro: erroRpc } = await cancelarPagamento(pagamento.id, motivo.trim());
    setCancelando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onCancelado();
  }

  const mensal = pagamento.natureza === 'mensal';

  return (
    <Modal titulo={`Pagamento — ${pagamento.funcionarios?.nome || ''}`} onFechar={cancelando ? undefined : onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        <dl className={estilosPagamentos.detalheLista}>
          <dt>Status</dt>
          <dd>
            <Badge tom={pagamento.status === 'cancelado' ? 'danger' : 'success'}>{pagamento.status === 'cancelado' ? 'Cancelado' : 'Confirmado'}</Badge>
          </dd>
          <dt>Vínculo (na época)</dt>
          <dd>{rotuloVinculo(pagamento.tipo_vinculo_snapshot)}</dd>
          <dt>Forma de remuneração</dt>
          <dd>{rotuloNaturezaPagamento(pagamento.natureza)}</dd>
          {mensal && (
            <>
              <dt>Competência</dt>
              <dd>{formatarCompetencia(pagamento.competencia)}</dd>
              <dt>Tipo de lançamento</dt>
              <dd>{rotuloTipoLancamento(pagamento.tipo_lancamento)}</dd>
              <dt>Remuneração-base aplicada</dt>
              <dd>{formatarMoeda(pagamento.valor_mensal_base_snapshot)}</dd>
              <dt>Parte da base neste pagamento</dt>
              <dd>{formatarMoeda(pagamento.valor_base_pago)}</dd>
            </>
          )}
          <dt>Data efetiva</dt>
          <dd>{formatarDataExibicao(pagamento.data_efetiva)}</dd>
          <dt>Confirmado por</dt>
          <dd>
            {pagamento.confirmado_por_nome || '—'} em {formatarDataHora(pagamento.confirmado_em)}
          </dd>
        </dl>

        {carregando ? (
          <p role="status">Carregando composição...</p>
        ) : (
          <>
            {detalhe.itens.length > 0 && (
              <>
                <h4>{mensal ? 'Extras remunerados' : 'Jornadas'}</h4>
                <ul className={estilosPagamentos.listaJornadas}>
                  {detalhe.itens.map((item) => (
                    <li key={item.id} className={estilosPagamentos.itemConferencia}>
                      <span>
                        {formatarDataExibicao(item.data)} {formatarHora(item.hora_inicio)}–{formatarHora(item.hora_fim)} ({item.duracao_minutos}min
                        {item.valor_hora_aplicado !== null ? ` × ${formatarMoeda(item.valor_hora_aplicado)}/h` : ', sem valor/hora vigente'})
                        {item.natureza_financeira === 'extra_remunerado' && !mensal ? ' · extra' : ''} — <strong>{formatarMoeda(item.valor)}</strong>{' '}
                        {item.origem_valor === 'regularizacao_historica' ? (
                          <Badge tom="warning">regularização histórica</Badge>
                        ) : (
                          (item.origem_valor === 'manual' || (!item.origem_valor && item.valor_manual)) && <Badge tom="info">ajuste manual</Badge>
                        )}
                      </span>
                      {item.valor_manual && (
                        <span className={estilosPagamentos.prevista}>
                          Calculado: {item.valor_calculado !== null && item.valor_calculado !== undefined ? formatarMoeda(item.valor_calculado) : 'não disponível'} · pago:{' '}
                          {formatarMoeda(item.valor)}
                          {item.observacao_ajuste ? ` · ${item.observacao_ajuste}` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className={estilosPagamentos.resumoLinha}>
              <strong>Bruto</strong>
              <strong>{formatarMoeda(pagamento.valor_bruto)}</strong>
            </div>

            {detalhe.descontos.length > 0 && (
              <ul className={estilosPagamentos.listaJornadas}>
                {detalhe.descontos.map((d) => (
                  <li key={d.id}>
                    − {d.tipo}: {formatarMoeda(d.valor)}
                    {d.observacao ? ` (${d.observacao})` : ''}
                  </li>
                ))}
              </ul>
            )}
            <div className={estilosPagamentos.resumoLinha}>
              <span>Descontos</span>
              <span>-{formatarMoeda(pagamento.total_descontos)}</span>
            </div>
            <div className={estilosPagamentos.resumoLinha}>
              <strong>Líquido</strong>
              <strong>{formatarMoeda(pagamento.valor_liquido)}</strong>
            </div>

            {pagamento.observacao && <p>Observação: {pagamento.observacao}</p>}

            {detalhe.cancelamento && (
              <Alert tom="danger">
                Cancelado por {detalhe.cancelamento.cancelado_por_nome || '—'} em {formatarDataHora(detalhe.cancelamento.cancelado_em)} — motivo: {detalhe.cancelamento.motivo}
              </Alert>
            )}
          </>
        )}

        {erro && <Alert tom="danger">{erro}</Alert>}

        {podeCancelar && pagamento.status !== 'cancelado' && !formularioCancelar && (
          <div className={estilosEscala.rodapePlanejamento}>
            <Button variante="danger" onClick={() => setFormularioCancelar(true)}>
              Cancelar pagamento
            </Button>
          </div>
        )}

        {formularioCancelar && (
          <div className={estilosPagamentos.secaoCancelamento}>
            <p>O pagamento continua no histórico como cancelado e as jornadas/extras voltam a ficar pendentes{mensal ? '; a parte da base volta ao saldo da competência' : ''}.</p>
            <Field label="Motivo do cancelamento (obrigatório)">
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
            </Field>
            <div className={estilosEscala.rodapePlanejamento}>
              <Button variante="secondary" onClick={() => setFormularioCancelar(false)} disabled={cancelando}>
                Voltar
              </Button>
              <Button variante="danger" onClick={confirmarCancelamento} disabled={cancelando}>
                {cancelando ? 'Cancelando...' : 'Confirmar cancelamento'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
