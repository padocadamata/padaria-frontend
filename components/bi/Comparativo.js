import { useState } from 'react';
import Bloco, { AvisoLimite, EstadoConsulta } from './Bloco';
import { useBi, useRegistroExportacao } from './contexto';
import { useConsulta, useVisivel } from '../../lib/bi/useConsulta';
import {
  LETRA_DIA, LIMITES, NOMES_DIA, TODOS_OS_DIAS, dataValida, diaDaSemana, diasNoIntervalo, inicioDaSemana, inicioDoMes,
  mesmoDiaMesAnterior, periodoReferencia, somarDias,
} from '../../lib/bi/datas';
import { alternarDia } from '../../lib/bi/filtros';
import {
  AVISO_COMPARACAO, MOTIVO_COMPARACAO, intervalo, moeda, nomeDosDias, numero, percentual, pontosPercentuais, variacao,
} from '../../lib/bi/formatos';
import { INDICADORES_COMPARATIVO, linhaComparativoGeral } from '../../lib/bi/modelos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

export const MODOS_COMPARATIVO = [
  { valor: 'anterior', rotulo: 'Período anterior' },
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'dow', rotulo: 'Mesmo dia da semana' },
  { valor: 'livre', rotulo: 'Livre A × B' },
];

// Períodos A/B de cada modo, calculados a partir de bi_status (receitas de
// docs/bi-gerencial/contratos-rpc.md).
export function periodosDoModo(modo, { geral, ultimoCompleto, livre }) {
  const ult = ultimoCompleto;
  switch (modo) {
    case 'mes': {
      if (!ult) return null;
      const a = { de: inicioDoMes(ult), ate: ult };
      return { a, b: { de: mesmoDiaMesAnterior(a.de), ate: mesmoDiaMesAnterior(a.ate) }, dias: geral.dias };
    }
    case 'semana': {
      if (!ult) return null;
      const a = { de: inicioDaSemana(ult), ate: ult };
      return { a, b: { de: somarDias(a.de, -7), ate: somarDias(a.ate, -7) }, dias: geral.dias };
    }
    case 'dow': {
      if (!ult) return null;
      return { a: { de: ult, ate: ult }, b: { de: somarDias(ult, -28), ate: somarDias(ult, -7) }, dias: [diaDaSemana(ult)] };
    }
    case 'livre':
      return livre;
    case 'anterior':
    default: {
      const b = periodoReferencia({ de: geral.de, ate: geral.ate }, 'anterior', { atalho: geral.atalho });
      return b ? { a: { de: geral.de, ate: geral.ate }, b, dias: geral.dias } : null;
    }
  }
}

function Var({ v, bom = true }) {
  const x = variacao(v);
  if (!x) return '—';
  const cls = !bom ? s.varNeutra : x.sentido === 'sobe' ? s.varSobe : x.sentido === 'desce' ? s.varDesce : s.varNeutra;
  return <span className={cx(s.var, cls)}>{x.texto}</span>;
}

// Linhas e regras do comparativo geral vêm de lib/bi/modelos (as mesmas da
// exportação geral); aqui só a formatação.
const FMT = {
  moeda,
  numero: (v) => numero(v),
  numero1: (v) => numero(v, 1),
  percentual: (v) => percentual(v, 2),
};

function TabelaGeral({ c }) {
  const pareado = c.criterio === 'pareado';
  return (
    <div className={s.rolagemX}>
      <table className={cx(s.tabela, s.tabelaComparativo)}>
        <thead>
          <tr>
            <th className={s.colIndicador}>Indicador</th>
            <th className={s.n}>A</th>
            <th className={s.n}>B</th>
            <th className={s.n}>Diferença</th>
            <th className={s.n}>Variação</th>
          </tr>
        </thead>
        <tbody>
          {INDICADORES_COMPARATIVO.map((def) => {
            const l = linhaComparativoGeral(c, def);
            const fmt = FMT[def.tipo];
            const semTotal = def.total && !pareado;
            return (
              <tr key={def.campo}>
                <td>
                  {def.rotulo}
                  {semTotal && <span className={s.cod}> (total)</span>}
                </td>
                <td className={s.n}>{fmt(l.a)}</td>
                <td className={s.n}>{fmt(l.b)}</td>
                <td className={s.n}>{l.diferenca === null ? '—' : def.tipo === 'percentual' ? pontosPercentuais(l.diferenca) : fmt(l.diferenca)}</td>
                <td className={s.n}>{semTotal ? <span className={s.cod}>durações diferentes</span> : c.geral.comparavel ? <Var v={l.variacao} bom={def.bom !== false} /> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {c.geral.base_zero && <p className={s.cod}>Algum indicador da referência é zero: a variação percentual desse indicador não é calculada (divisão por zero).</p>}
    </div>
  );
}

function TabelaProdutos({ c, cores }) {
  return (
    <div className={s.rolagemX}>
      <table className={cx(s.tabela, s.tabelaComparativo)}>
        <thead>
          <tr>
            <th className={s.colProduto}>Produto</th>
            <th className={s.n}>A /dia</th>
            <th className={s.n}>B /dia</th>
            <th className={s.n}>Var. fat.</th>
            <th className={s.n}>Preço médio A</th>
            <th className={s.n}>Part. A</th>
            <th className={s.n}>Part. B</th>
          </tr>
        </thead>
        <tbody>
          {c.produtos.map((p) => (
            <tr key={p.codigo}>
              <td className={s.colProduto}>
                <span className={s.nomeProduto}>
                  <span className={s.sw} style={{ background: cores[p.codigo] }} />
                  {p.descricao} <span className={s.cod}>cód. {p.codigo}</span>
                </span>
                {!p.comparavel && <div className={s.cod}>{MOTIVO_COMPARACAO[p.motivo] || p.motivo}</div>}
              </td>
              <td className={s.n}>{moeda(p.a.media_diaria_bruto)}</td>
              <td className={s.n}>{moeda(p.b.media_diaria_bruto)}</td>
              <td className={s.n}>{p.comparavel ? <Var v={p.variacoes ? p.variacoes.media_diaria_bruto : null} /> : '—'}</td>
              <td className={s.n}>{p.a.preco_medio === null ? '—' : moeda(p.a.preco_medio)}</td>
              <td className={s.n}>{percentual(p.a.participacao, 2)}</td>
              <td className={s.n}>{percentual(p.b.participacao, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.cod} style={{ margin: '6px 0 0' }}>
        Descontos existem só por venda no G3: não são atribuídos a produtos. Quantidades como registradas (sem unidade).
      </p>
    </div>
  );
}

export function Comparativo() {
  const { cliente, geral, status, selecionados, cores } = useBi();
  const [refVisivel, visivel] = useVisivel();
  const [modo, setModo] = useState('anterior');
  const ultimo = status.padrao_ate;
  const [livre, setLivre] = useState(() => {
    const ate = ultimo || status.hoje;
    return { a: { de: inicioDoMes(ate), ate }, b: { de: mesmoDiaMesAnterior(inicioDoMes(ate)), ate: mesmoDiaMesAnterior(ate) }, dias: TODOS_OS_DIAS };
  });
  const p = periodosDoModo(modo, { geral, ultimoCompleto: ultimo, livre });
  const okDatas = p && [p.a.de, p.a.ate, p.b.de, p.b.ate].every(dataValida) && p.a.de <= p.a.ate && p.b.de <= p.b.ate;
  const acima = okDatas && (diasNoIntervalo(p.a.de, p.a.ate) > LIMITES.comparacao || diasNoIntervalo(p.b.de, p.b.ate) > LIMITES.comparacao);
  const argsComp = okDatas && !acima ? { a: p.a, b: p.b, dias: p.dias, codigos: selecionados.length ? selecionados : null } : null;
  const c = useConsulta(cliente, 'comparar', visivel ? argsComp : null);
  useRegistroExportacao('comparativo', {
    filtros: null,
    parametros: { modo, rotuloModo: (MODOS_COMPARATIVO.find((m) => m.valor === modo) || {}).rotulo, periodos: p, selecionados },
    consultas: { comparar: argsComp && { tipo: 'comparar', args: argsComp } },
    indisponivel: !p || !okDatas
      ? !ultimo && modo !== 'livre' && modo !== 'anterior'
        ? 'Ainda não há dia completo importado para montar esta comparação.'
        : 'Períodos inválidos para comparar.'
      : acima
        ? `A comparação aceita períodos de até ${numero(LIMITES.comparacao)} dias em cada lado.`
        : null,
  });
  const d = c.status === 'ok' ? c.dados : null;

  return (
    <Bloco
      nome="comparativo"
      titulo="Comparativo entre períodos"
      largura="s12"
      refVisivel={refVisivel}
      semFiltros
      acoes={
        <div className={cx(s.seg, s.segPequeno, s.segQuebra)} role="group" aria-label="Modo de comparação">
          {MODOS_COMPARATIVO.map((m) => (
            <button key={m.valor} type="button" aria-pressed={modo === m.valor} onClick={() => setModo(m.valor)}>
              {m.rotulo}
            </button>
          ))}
        </div>
      }
      rodape={
        <>
          <span>Variação = (A − B) ÷ B</span>
          <span>Totais só no critério pareado; durações diferentes comparam médias por dia válido</span>
        </>
      }
    >
      {modo === 'livre' && (
        <div className={s.crit} style={{ gap: '10px 18px', alignItems: 'flex-end' }}>
          {['a', 'b'].map((lado) => (
            <div className={s.campo} key={lado}>
              <span className={s.rot}>{lado === 'a' ? 'Período A (analisado)' : 'Período B (referência)'}</span>
              <div className={s.datas}>
                <input className={s.controle} type="date" aria-label={`Período ${lado.toUpperCase()}: data inicial`} value={livre[lado].de} onChange={(e) => setLivre((x) => ({ ...x, [lado]: { ...x[lado], de: e.target.value } }))} />–
                <input className={s.controle} type="date" aria-label={`Período ${lado.toUpperCase()}: data final`} value={livre[lado].ate} onChange={(e) => setLivre((x) => ({ ...x, [lado]: { ...x[lado], ate: e.target.value } }))} />
              </div>
            </div>
          ))}
          <div className={s.campo}>
            <span className={s.rot}>Dias da semana (próprio)</span>
            <div className={s.chips}>
              {TODOS_OS_DIAS.map((dd) => (
                <button key={dd} type="button" className={s.chip} aria-pressed={livre.dias.includes(dd)} title={NOMES_DIA[dd]} aria-label={NOMES_DIA[dd]} onClick={() => setLivre((x) => ({ ...x, dias: alternarDia(x.dias, dd) }))}>
                  {LETRA_DIA[dd]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {!p || !okDatas ? (
        <p className={s.vazio}>{!ultimo && modo !== 'livre' && modo !== 'anterior' ? 'Ainda não há dia completo importado para montar esta comparação.' : 'Informe períodos válidos para comparar.'}</p>
      ) : acima ? (
        <AvisoLimite>A comparação aceita períodos de até {numero(LIMITES.comparacao)} dias em cada lado.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={c} altura={300}>
          {d && (
            <>
              <div className={s.crit}>
                <span>
                  A: <b>{intervalo(d.periodos.a.de, d.periodos.a.ate)}</b> ({numero(d.periodos.a.dias_filtrados)} dias no filtro)
                </span>
                <span>
                  B: <b>{intervalo(d.periodos.b.de, d.periodos.b.ate)}</b> ({numero(d.periodos.b.dias_filtrados)} dias no filtro)
                </span>
                <span>
                  Dias: <b>{nomeDosDias(p.dias)}</b>
                </span>
                <span>
                  Critério:{' '}
                  <b>
                    {d.criterio === 'pareado'
                      ? `pareado · ${numero(d.pareamento ? d.pareamento.pares_validos_vendas : 0)} de ${numero(d.pareamento ? d.pareamento.pares : 0)} pares válidos${d.pareamento && d.pareamento.mesmo_dia_semana ? ' · mesmos dias da semana' : ''}`
                      : 'média por dia válido'}
                  </b>
                </span>
                <span>
                  Cobertura A <b>{percentual(d.geral.a.cobertura, 0)}</b> · B <b>{percentual(d.geral.b.cobertura, 0)}</b> (mínimo {percentual(d.cobertura_minima, 0)})
                </span>
              </div>
              {!d.geral.comparavel && (
                <div className={cx(s.aviso, s.avisoAt)}>
                  ⚠{' '}
                  <span>
                    <b>Não comparável:</b> {MOTIVO_COMPARACAO[d.geral.motivo] || d.geral.motivo} As variações não são exibidas.
                  </span>
                </div>
              )}
              {(d.avisos || []).map((a) => (
                <div className={s.aviso} key={a}>
                  ⓘ <span>{AVISO_COMPARACAO[a] || a}</span>
                </div>
              ))}
              {/* Geral em cima e produtos embaixo, ambos com a largura total do bloco. */}
              <div className={s.comparativoSecao}>
                <div className={s.rot}>Geral (base vendas)</div>
                <TabelaGeral c={d} />
              </div>
              <div className={s.comparativoSecao}>
                <div className={s.rot}>Produtos selecionados (base itens · média por dia válido)</div>
                {d.produtos && d.produtos.length ? <TabelaProdutos c={d} cores={cores} /> : <p className={s.vazio}>Selecione produtos no ranking ou na tabela para compará-los.</p>}
              </div>
            </>
          )}
        </EstadoConsulta>
      )}
    </Bloco>
  );
}
