import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Textarea from '../ui/Textarea';
import PagarParcelaModal from './PagarParcelaModal';
import ReplanejarModal from './ReplanejarModal';
import DespesaModal from './DespesaModal';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import {
  CONDICOES, SITUACAO_CONTA, classificarParcela, formatarReais, rotuloClassificacao, rotuloForma, tomClassificacao,
} from '../../lib/financeiro/contasPagarRegras';
import { buscarConta, cancelarConta, editarConta, estornarBaixa } from '../../lib/financeiro/contasPagar';
import { descreverOrigem, formatarCompetencia, formatarData, formatarDataHora } from './formatacao';
import estilos from './financeiro.module.css';

// Detalhe de uma conta (migration 0073): origem, credor, parcelas,
// vencimentos, pagamentos (inclusive estornados), observações e histórico.
// Ações conforme permissão: Pagar, Estornar, Replanejar, Editar, Cancelar.
// Tudo lógico -- nada é apagado.
export default function ContaDetalheModal({ contaId, permissoes, categorias, fornecedores, onFechar, onAlterado }) {
  const hoje = dataLocalHoje();
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [tick, setTick] = useState(0);
  const [pagando, setPagando] = useState(null);
  const [replanejando, setReplanejando] = useState(false);
  const [editandoDespesa, setEditandoDespesa] = useState(false);
  const [estornando, setEstornando] = useState(null);
  const [cancelando, setCancelando] = useState(false);
  const [editandoObs, setEditandoObs] = useState(false);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState('');

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    buscarConta(contaId).then((r) => {
      if (!ativo) return;
      setDados(r);
      setErro(r.erro);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, [contaId, tick]);

  function recarregar() {
    setTick((t) => t + 1);
    onAlterado();
  }

  async function executar(promessa, depois) {
    setErroAcao('');
    setOcupado(true);
    const { erro: erroRpc } = await promessa;
    setOcupado(false);
    if (erroRpc) return setErroAcao(erroRpc);
    depois();
    recarregar();
  }

  const conta = dados?.conta;
  const ativa = conta?.status === 'ativa';
  const temPaga = (dados?.parcelas || []).some((p) => p.situacao === 'paga');
  const temPendente = (dados?.parcelas || []).some((p) => p.situacao === 'pendente');
  const pode = (codigo) => permissoes.has(codigo);
  const podeEditar = pode('contas_pagar.editar');
  const podePagar = pode('contas_pagar.pagar');
  const podeCancelar = pode('contas_pagar.cancelar');

  return (
    <Modal titulo={conta ? `Conta — ${conta.credor_exibicao || ''}` : 'Conta'} onFechar={ocupado ? undefined : onFechar} largura="xl">
      {carregando && !dados ? (
        <p role="status">Carregando...</p>
      ) : erro || !conta ? (
        <Alert tom="danger">{erro || 'Conta não encontrada ou sem permissão.'}</Alert>
      ) : (
        <div className={estilos.modalCorpo}>
          <dl className={estilos.detalheLista}>
            <dt>Situação</dt>
            <dd><Badge tom={SITUACAO_CONTA[conta.situacao]?.tom}>{SITUACAO_CONTA[conta.situacao]?.rotulo}</Badge></dd>
            <dt>Origem</dt>
            <dd>
              {descreverOrigem(conta)}
              {conta.origem === 'compra' && (
                <>
                  {' '}
                  <Button tamanho="sm" variante="ghost" href={`/pedidos?id=${conta.pedido_id}`}>Abrir compra</Button>
                </>
              )}
            </dd>
            {conta.origem === 'manual' && (
              <>
                <dt>Descrição</dt>
                <dd>{conta.descricao}</dd>
                <dt>Competência</dt>
                <dd>{formatarCompetencia(conta.competencia)}</dd>
              </>
            )}
            {conta.origem === 'compra' && conta.numero_nota_fiscal && (
              <>
                <dt>Nota fiscal</dt>
                <dd>{conta.numero_nota_fiscal}</dd>
              </>
            )}
            <dt>Credor</dt>
            <dd>{conta.credor_exibicao}{conta.origem === 'manual' && !conta.credor_nome ? ' (fornecedor cadastrado)' : ''}</dd>
            <dt>Condição</dt>
            <dd>{CONDICOES[conta.condicao]} · {rotuloForma(conta.forma_prevista)}</dd>
            <dt>Total</dt>
            <dd><strong>{formatarReais(conta.valor_total)}</strong> · pago {formatarReais(conta.valor_pago)} · em aberto {formatarReais(conta.valor_em_aberto)}</dd>
            <dt>Lançada por</dt>
            <dd>{conta.criado_por_nome || '—'} em {formatarDataHora(conta.criado_em)}</dd>
            <dt>Observação</dt>
            <dd>{conta.observacao || '—'}</dd>
          </dl>

          {conta.status === 'cancelada' && (
            <Alert tom="info">
              Cancelada por {conta.cancelada_por_nome || '—'} em {formatarDataHora(conta.cancelada_em)} — motivo: {conta.motivo_cancelamento}
            </Alert>
          )}

          <h4 className={estilos.subtitulo}>Parcelas</h4>
          <ul className={estilos.listaSimples}>
            {dados.parcelas.map((p) => {
              const c = classificarParcela(p, hoje);
              return (
                <li key={p.id} className={estilos.itemLista}>
                  <span>
                    <strong>{p.numero}/{p.total_parcelas}</strong> · vence {formatarData(p.vencimento)} · {formatarReais(p.valor)}{' '}
                    <Badge tom={tomClassificacao(c)}>{rotuloClassificacao(c)}</Badge>
                    {p.situacao === 'paga' && (
                      <span className={estilos.sub}>
                        {' '}pago {formatarData(p.pago_em)} · {rotuloForma(p.forma_pagamento)} · {formatarReais(p.valor_pago)}
                        {Number(p.juros) + Number(p.multa) + Number(p.desconto) > 0
                          ? ` (juros ${formatarReais(p.juros)}, multa ${formatarReais(p.multa)}, desconto ${formatarReais(p.desconto)})`
                          : ''}
                      </span>
                    )}
                  </span>
                  <span className={estilos.acoes}>
                    {ativa && p.situacao === 'pendente' && podePagar && (
                      <Button tamanho="sm" onClick={() => setPagando(p)} disabled={ocupado}>Pagar</Button>
                    )}
                    {ativa && p.situacao === 'paga' && podeCancelar && (
                      <Button tamanho="sm" variante="dangerOutline" onClick={() => { setEstornando(p); setTexto(''); }} disabled={ocupado}>Estornar</Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {estornando && (
            <div className={estilos.secaoPerigo}>
              <p>
                Estornar o pagamento da parcela {estornando.numero} ({formatarReais(estornando.valor_pago)} em {formatarData(estornando.pago_em)})? O registro
                fica no histórico como estornado e a parcela volta a ficar pendente.
              </p>
              <Field label="Motivo do estorno (obrigatório)">
                <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </Field>
              <div className={estilos.acoes}>
                <Button variante="secondary" onClick={() => setEstornando(null)} disabled={ocupado}>Voltar</Button>
                <Button
                  variante="danger"
                  disabled={ocupado}
                  onClick={() => (texto.trim() ? executar(estornarBaixa(estornando.baixa_id, texto.trim()), () => setEstornando(null)) : setErroAcao('Informe o motivo do estorno.'))}
                >
                  Confirmar estorno
                </Button>
              </div>
            </div>
          )}

          {dados.baixas.length > 0 && (
            <>
              <h4 className={estilos.subtitulo}>Pagamentos registrados</h4>
              <ul className={estilos.listaSimples}>
                {dados.baixas.map((b) => (
                  <li key={b.id} className={estilos.itemLista}>
                    <span className={b.estornado_em ? estilos.estornada : undefined}>
                      Parcela {b.contas_pagar_parcelas?.numero} · {formatarData(b.pago_em)} · {rotuloForma(b.forma_pagamento)} · {formatarReais(b.valor_original)} + juros{' '}
                      {formatarReais(b.juros)} + multa {formatarReais(b.multa)} − desconto {formatarReais(b.desconto)} = <strong>{formatarReais(b.valor_pago)}</strong>
                    </span>
                    <span className={estilos.sub}>
                      por {b.registrado_por_nome || '—'} em {formatarDataHora(b.registrado_em)}
                      {b.observacao ? ` · ${b.observacao}` : ''}
                      {b.estornado_em ? ` · ESTORNADO por ${b.estornado_por_nome || '—'} em ${formatarDataHora(b.estornado_em)}: ${b.motivo_estorno}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {dados.historico.length > 0 && (
            <>
              <h4 className={estilos.subtitulo}>Histórico</h4>
              <ul className={estilos.listaSimples}>
                {dados.historico.map((h) => (
                  <li key={h.id} className={estilos.sub}>
                    {formatarDataHora(h.data_hora)} · {h.usuario_nome || '—'} · {h.acao}
                    {h.campo ? ` ${h.campo}` : ''}
                    {h.valor_anterior ? `: ${h.valor_anterior}` : ''}
                    {h.valor_novo ? ` → ${h.valor_novo}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          {editandoObs && (
            <div className={estilos.modalCorpo}>
              <Field label="Observação">
                <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </Field>
              <div className={estilos.acoes}>
                <Button variante="secondary" onClick={() => setEditandoObs(false)} disabled={ocupado}>Voltar</Button>
                <Button disabled={ocupado} onClick={() => executar(editarConta(conta.id, { observacao: texto.trim() || null }), () => setEditandoObs(false))}>Salvar observação</Button>
              </div>
            </div>
          )}

          {cancelando && (
            <div className={estilos.secaoPerigo}>
              <p>
                Cancelar esta conta? Ela continua no histórico como cancelada.
                {conta.origem === 'compra' ? ' A compra volta para “Compras sem lançamento”.' : ''}
              </p>
              <Field label="Motivo do cancelamento (obrigatório)">
                <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </Field>
              <div className={estilos.acoes}>
                <Button variante="secondary" onClick={() => setCancelando(false)} disabled={ocupado}>Voltar</Button>
                <Button
                  variante="danger"
                  disabled={ocupado}
                  onClick={() => (texto.trim() ? executar(cancelarConta(conta.id, texto.trim()), () => setCancelando(false)) : setErroAcao('Informe o motivo do cancelamento.'))}
                >
                  Confirmar cancelamento
                </Button>
              </div>
            </div>
          )}

          {erroAcao && <Alert tom="danger">{erroAcao}</Alert>}

          {ativa && !estornando && !cancelando && !editandoObs && (
            <div className={estilos.rodape}>
              {podeEditar && temPendente && <Button variante="secondary" onClick={() => setReplanejando(true)} disabled={ocupado}>Replanejar</Button>}
              {podeEditar && conta.origem === 'manual' && <Button variante="secondary" onClick={() => setEditandoDespesa(true)} disabled={ocupado}>Editar despesa</Button>}
              {podeEditar && conta.origem === 'compra' && (
                <Button variante="secondary" onClick={() => { setTexto(conta.observacao || ''); setEditandoObs(true); }} disabled={ocupado}>Editar observação</Button>
              )}
              {podeCancelar && (
                <Button
                  variante="dangerOutline"
                  onClick={() => (temPaga ? setErroAcao('A conta tem pagamento registrado. Estorne o pagamento antes de cancelar.') : (setTexto(''), setCancelando(true)))}
                  disabled={ocupado}
                >
                  Cancelar conta
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {pagando && (
        <PagarParcelaModal parcela={pagando} onFechar={() => setPagando(null)} onPago={() => { setPagando(null); recarregar(); }} />
      )}
      {replanejando && conta && (
        <ReplanejarModal conta={conta} parcelas={dados.parcelas} onFechar={() => setReplanejando(false)} onSalvo={() => { setReplanejando(false); recarregar(); }} />
      )}
      {editandoDespesa && conta && (
        <DespesaModal
          conta={conta}
          categorias={categorias}
          fornecedores={fornecedores}
          podePagar={podePagar}
          onFechar={() => setEditandoDespesa(false)}
          onSalvo={() => { setEditandoDespesa(false); recarregar(); }}
        />
      )}
    </Modal>
  );
}
