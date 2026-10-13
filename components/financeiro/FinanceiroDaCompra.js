import { useEffect, useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import LancarFinanceiroModal from './LancarFinanceiroModal';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import {
  CONDICOES, SITUACAO_CONTA, classificarParcela, formatarReais, rotuloClassificacao, rotuloForma, tomClassificacao,
} from '../../lib/financeiro/contasPagarRegras';
import { buscarComprasSemLancamento, buscarParcelas, buscarResumoContas } from '../../lib/financeiro/contasPagar';
import { formatarData } from './formatacao';
import estilos from './financeiro.module.css';

// Seção "Financeiro" dentro do detalhe da compra (migration 0073). Só é
// montada para quem tem contas_pagar.visualizar -- e o banco filtra de novo
// (as views devolvem vazio sem a permissão), então nada financeiro vaza
// para quem só tem pedidos.visualizar.
export default function FinanceiroDaCompra({ pedidoId, podeLancar, podePagar }) {
  const hoje = dataLocalHoje();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [contas, setContas] = useState([]);
  const [parcelas, setParcelas] = useState([]);
  const [semLancamento, setSemLancamento] = useState(null);
  const [lancando, setLancando] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      const [r1, r2, r3] = await Promise.all([
        buscarResumoContas({ pedidoId }),
        buscarParcelas({ pedidoId }),
        buscarComprasSemLancamento({ pedidoId }),
      ]);
      if (!ativo) return;
      setErro(r1.erro || r2.erro || r3.erro);
      setContas(r1.dados);
      setParcelas(r2.dados);
      setSemLancamento(r3.dados[0] || null);
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [pedidoId, tick]);

  const ativa = contas.find((c) => c.status === 'ativa');
  const canceladas = contas.filter((c) => c.status === 'cancelada').length;
  const parcelasAtivas = ativa ? parcelas.filter((p) => p.conta_id === ativa.id) : [];
  const temVencida = parcelasAtivas.some((p) => classificarParcela(p, hoje) === 'vencida');

  return (
    <section className={estilos.financeiroPedido} aria-label="Financeiro da compra">
      <div className={estilos.financeiroCabecalho}>
        <h3 className={estilos.grupoTitulo}>Financeiro</h3>
        {ativa && (
          <Badge tom={temVencida ? 'danger' : SITUACAO_CONTA[ativa.situacao]?.tom}>
            {temVencida ? 'Com parcela vencida' : SITUACAO_CONTA[ativa.situacao]?.rotulo}
          </Badge>
        )}
      </div>

      {carregando ? (
        <p role="status">Carregando financeiro...</p>
      ) : erro ? (
        <p className={estilos.diferenca}>{erro}</p>
      ) : ativa ? (
        <>
          <dl className={estilos.detalheLista}>
            <dt>Condição</dt>
            <dd>{CONDICOES[ativa.condicao]} · {rotuloForma(ativa.forma_prevista)}</dd>
            <dt>Data da compra</dt>
            <dd>{formatarData(ativa.data_compra)}</dd>
            <dt>Total</dt>
            <dd><strong>{formatarReais(ativa.valor_total)}</strong></dd>
            <dt>Pago</dt>
            <dd>{formatarReais(ativa.valor_pago)}</dd>
            <dt>Em aberto</dt>
            <dd>{formatarReais(ativa.valor_em_aberto)}</dd>
          </dl>
          <ul className={estilos.listaSimples} aria-label="Parcelas">
            {parcelasAtivas.map((p) => {
              const c = classificarParcela(p, hoje);
              return (
                <li key={p.id} className={estilos.itemLista}>
                  <span>
                    {p.numero}/{p.total_parcelas} · vence {formatarData(p.vencimento)} · <strong>{formatarReais(p.valor)}</strong>
                  </span>
                  <span>
                    {p.situacao === 'paga' && <span className={estilos.sub}>pago {formatarData(p.pago_em)} · {formatarReais(p.valor_pago)} · {rotuloForma(p.forma_pagamento)} </span>}
                    <Badge tom={tomClassificacao(c)}>{rotuloClassificacao(c)}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
          <div>
            <Button variante="secondary" tamanho="sm" href={`/financeiro/contas-pagar?conta=${ativa.id}`}>Abrir em Contas a Pagar</Button>
          </div>
        </>
      ) : semLancamento ? (
        <>
          {semLancamento.elegivel ? (
            <p className={estilos.dica}>
              Sem lançamento financeiro (total {formatarReais(semLancamento.total)}).
              {semLancamento.anterior_implantacao ? ' Compra anterior à implantação do Financeiro.' : ' Aparece em Contas a Pagar > Compras sem lançamento.'}
            </p>
          ) : (
            <p className={estilos.dica}>
              {semLancamento.total === null
                ? 'Recebimento sem valores completos (anterior ao recebimento detalhado) — não há financeiro a lançar.'
                : 'Compra sem valor a pagar (total R$ 0,00).'}
            </p>
          )}
          {semLancamento.elegivel && podeLancar && (
            <div>
              <Button tamanho="sm" onClick={() => setLancando(true)}>Lançar financeiro</Button>
            </div>
          )}
        </>
      ) : (
        <p className={estilos.dica}>Sem informação financeira para esta compra.</p>
      )}

      {canceladas > 0 && (
        <p className={estilos.sub}>{canceladas} lançamento(s) cancelado(s) no histórico.</p>
      )}

      {lancando && semLancamento && (
        <LancarFinanceiroModal
          compra={semLancamento}
          podePagar={podePagar}
          onFechar={() => setLancando(false)}
          onLancado={() => {
            setLancando(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </section>
  );
}
