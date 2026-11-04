import { resumoDoCartao } from '../../lib/ponto/apresentacao';
import { cx } from '../../lib/design/cx';
import estilos from './ponto.module.css';

// Resumo do mês: Previsto, Trabalhado, Saldo e Dias pendentes em destaque;
// os demais indicadores (atestados, faltas, fora do previsto, não coberto,
// extra e faltante) ficam em "Mais indicadores". Extra/Faltante são a SOMA
// dos saldos de cada dia (sem compensação entre dias).
export default function TotaisCartao({ apuracao, expandido = false }) {
  const { principais, secundarios } = resumoDoCartao(apuracao);
  return (
    <div className={estilos.resumo}>
      <div className={cx(estilos.totais, estilos.totaisPrincipais)} role="list" aria-label="Resumo do mês">
        {principais.map((c) => <CardTotal key={c.chave} card={c} />)}
      </div>
      <details className={estilos.maisIndicadores} open={expandido || undefined}>
        <summary>Mais indicadores (atestados, faltas, fora do previsto, não coberto, extra e faltante)</summary>
        <div className={estilos.totais} role="list" aria-label="Outros totais do mês">
          {secundarios.map((c) => <CardTotal key={c.chave} card={c} />)}
        </div>
      </details>
    </div>
  );
}

function CardTotal({ card: c }) {
  return (
    <div role="listitem" className={cx(estilos.total, c.tom && estilos[`tom${c.tom}`])} title={c.ajuda}>
      <span className={estilos.totalRotulo}>{c.rotulo}</span>
      <span className={estilos.totalValor}>
        {c.valor}
        {c.sufixo && <span className={estilos.totalSufixo}>{c.sufixo}</span>}
      </span>
      {c.nota && <span className={estilos.totalNota}>{c.nota}</span>}
    </div>
  );
}
