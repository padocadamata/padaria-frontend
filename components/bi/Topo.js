import { useEffect, useMemo, useRef, useState } from 'react';
import { useBi } from './contexto';
import { Minigrafico } from './Graficos';
import { useConsulta } from '../../lib/bi/useConsulta';
import { ATALHOS, ATALHOS_ATE_ULTIMO_COMPLETO, LETRA_DIA, LIMITES, NOMES_DIA, REFERENCIAS, TODOS_OS_DIAS, dataValida, diaDaSemana, diasNoIntervalo, periodoReferencia } from '../../lib/bi/datas';
import { AGRUPAMENTOS, alternarDia } from '../../lib/bi/filtros';
import {
  AVISO_COMPARACAO, AVISO_PERIODO, MOTIVO_COMPARACAO, MOTIVO_PERIODO, ROTULO_AGRUPAMENTO, ROTULO_CLASSE,
  data, dataCurta, dataHora, intervalo, intervaloCurto, moeda, nomeDosDias, numero, percentual, plural, variacao,
} from '../../lib/bi/formatos';
import { contagemCobertura, diasForaDasMedias, situacaoComparacao, variacaoValida } from '../../lib/bi/modelos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

// Botão discreto "Atualizar": relê cobertura/última importação e recarrega
// os relatórios (cache invalidado), mantendo filtros e seleção. NÃO inicia
// importação do G3.
function BotaoAtualizar() {
  const { atualizacao } = useBi();
  if (!atualizacao) return null;
  const ocupado = atualizacao.fase !== 'ocioso';
  const hora = atualizacao.concluidaEm
    ? atualizacao.concluidaEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' })
    : null;
  return (
    <span className={s.atualizar}>
      <button
        type="button"
        className={s.btnAtualizar}
        onClick={atualizacao.executar}
        disabled={ocupado}
        aria-busy={ocupado}
        title="Consultar novamente os dados já importados (não inicia uma nova importação do G3). Filtros e produtos selecionados são mantidos."
      >
        <svg className={ocupado ? s.girando : undefined} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {atualizacao.fase === 'status' ? 'Consultando…' : atualizacao.fase === 'relatorios' ? 'Atualizando relatórios…' : 'Atualizar'}
      </button>
      <span className={s.atualizarNota} aria-live="polite">
        {atualizacao.erro ? <span className={s.atualizarErro}>Não foi possível atualizar: {atualizacao.erro}</span> : !ocupado && hora ? `atualizado às ${hora}` : ''}
      </span>
    </span>
  );
}

export function Cabecalho() {
  const { status } = useBi();
  const parcial = useMemo(() => {
    const rel = (status.relatorios || []).find((r) => r.layout === 'faturamento_geral');
    if (!rel || !rel.dia_parcial || (status.padrao_ate && rel.dia_parcial <= status.padrao_ate)) return null;
    return { dia: rel.dia_parcial, hora: rel.hora_limite };
  }, [status]);
  return (
    <div className={s.cab}>
      <div>
        <h1>BI Gerencial</h1>
        <div className={s.sub}>
          <span>
            <span className={cx(s.ponto, !status.padrao_ate && s.pontoAviso)} />
            {status.ultima_importacao_em ? `Última importação do G3 em ${dataHora(status.ultima_importacao_em)}` : 'Nenhuma importação confirmada'}
            <BotaoAtualizar />
          </span>
          <span>
            {status.padrao_ate ? (
              <>
                Dados completos até <b>{data(status.padrao_ate)}</b>
              </>
            ) : (
              'Ainda não há dia completo importado'
            )}
          </span>
          {parcial && (
            <span>
              Parcial de <b>{dataCurta(parcial.dia)}</b>
              {parcial.hora ? ` até ${parcial.hora}` : ''}
            </span>
          )}
          <span>Operação oficial desde {data(status.data_inicio_operacao)}</span>
        </div>
      </div>
    </div>
  );
}

// Barra de filtros gerais. Fixa ao rolar; quando "gruda" no topo, entra no
// modo compacto (uma linha, rótulos ocultos -- os controles mantêm nome
// acessível e dica). Nenhum controle é removido. No celular continua o
// botão "Filtros" com o resumo.
function useBarraFixa() {
  const sentinela = useRef(null);
  const barra = useRef(null);
  const [fixa, setFixa] = useState(false);
  useEffect(() => {
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const sEl = sentinela.current;
      const bEl = barra.current;
      if (!sEl || !bEl) return;
      const topo = parseFloat(window.getComputedStyle(bEl).top) || 0;
      setFixa(sEl.getBoundingClientRect().top < topo - 1);
    };
    const agendar = () => {
      if (!quadro) quadro = window.requestAnimationFrame(medir);
    };
    document.addEventListener('scroll', agendar, { passive: true, capture: true });
    window.addEventListener('resize', agendar);
    medir();
    return () => {
      document.removeEventListener('scroll', agendar, { capture: true });
      window.removeEventListener('resize', agendar);
      if (quadro) window.cancelAnimationFrame(quadro);
    };
  }, []);
  return { sentinela, barra, fixa };
}

export function FiltrosGerais() {
  const { geral, definirGeral, restaurarTudo, status } = useBi();
  const [aberto, setAberto] = useState(false);
  const { sentinela, barra, fixa } = useBarraFixa();
  const refOk = geral.referencia !== 'livre' || (dataValida(geral.refDe) && dataValida(geral.refAte) && geral.refDe <= geral.refAte);
  const dicaAtalho = ATALHOS_ATE_ULTIMO_COMPLETO.has(geral.atalho) && status.padrao_ate
    ? `Termina em ${data(status.padrao_ate)}, último dia com importação completa. Dias sem importação continuam dentro do período, como lacuna.`
    : undefined;
  return (
    <>
      <div ref={sentinela} className={s.sentinela} aria-hidden="true" />
      <section ref={barra} className={cx(s.filtros, fixa && s.filtrosFixos, aberto && s.filtrosAbertos)} aria-label="Filtros gerais">
        <button className={cx(s.btn, s.soMobile)} type="button" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
          Filtros {aberto ? '▴' : '▾'}
        </button>
        <span className={cx(s.soMobile, s.resumoFiltros)}>
          {intervaloCurto(geral.de, geral.ate)} · {nomeDosDias(geral.dias)} · por {ROTULO_AGRUPAMENTO[geral.agrupamento]}
        </span>
        <div className={s.campo}>
          <label className={s.rot} htmlFor="bi-atalho">
            Período
          </label>
          <select id="bi-atalho" className={s.controle} value={geral.atalho} title={dicaAtalho} onChange={(e) => definirGeral({ atalho: e.target.value })}>
            {ATALHOS.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className={s.campo}>
          <span className={s.rot}>De / até</span>
          <div className={s.datas}>
            <input className={cx(s.controle, s.controleData)} type="date" aria-label="Data inicial" value={geral.de || ''} max={geral.ate || undefined} onChange={(e) => e.target.value && definirGeral({ de: e.target.value })} />–
            <input className={cx(s.controle, s.controleData)} type="date" aria-label="Data final" value={geral.ate || ''} min={geral.de || undefined} onChange={(e) => e.target.value && definirGeral({ ate: e.target.value })} />
          </div>
        </div>
        <div className={s.campo}>
          <span className={s.rot}>Dias da semana</span>
          <div className={s.chips} role="group" aria-label="Dias da semana">
            {TODOS_OS_DIAS.map((d) => (
              <button key={d} type="button" className={s.chip} aria-pressed={geral.dias.includes(d)} title={NOMES_DIA[d]} aria-label={NOMES_DIA[d]} onClick={() => definirGeral({ dias: alternarDia(geral.dias, d) })}>
                {LETRA_DIA[d]}
              </button>
            ))}
          </div>
        </div>
        <div className={s.campo}>
          <span className={s.rot}>Agrupamento</span>
          <div className={s.seg} role="group" aria-label="Agrupamento">
            {AGRUPAMENTOS.map((a) => (
              <button key={a} type="button" aria-pressed={geral.agrupamento === a} onClick={() => definirGeral({ agrupamento: a })}>
                {a === 'dia' ? 'Dia' : a === 'semana' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        </div>
        <div className={s.campo}>
          <label className={s.rot} htmlFor="bi-referencia">
            Variação nos cartões
          </label>
          <select id="bi-referencia" className={cx(s.controle, s.controleRef)} value={geral.referencia} title="Variação nos cartões" onChange={(e) => definirGeral({ referencia: e.target.value })}>
            {REFERENCIAS.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.rotulo}
              </option>
            ))}
          </select>
        </div>
        {geral.referencia === 'livre' && (
          <div className={s.campo}>
            <span className={s.rot}>Referência (B)</span>
            <div className={s.datas}>
              <input className={cx(s.controle, s.controleData)} type="date" aria-label="Referência: data inicial" value={geral.refDe || ''} onChange={(e) => definirGeral({ refDe: e.target.value })} />–
              <input className={cx(s.controle, s.controleData)} type="date" aria-label="Referência: data final" value={geral.refAte || ''} onChange={(e) => definirGeral({ refAte: e.target.value })} />
            </div>
            {!refOk && <span className={s.critAviso}>Informe um período válido.</span>}
          </div>
        )}
        <span className={cx(s.esp, s.soDesktop)} />
        <div className={s.campo}>
          <button className={cx(s.btn, s.btnRestaurar)} type="button" onClick={restaurarTudo} aria-label="Restaurar filtros" title="Volta aos filtros padrão e faz todos os blocos herdarem os filtros gerais (a seleção de produtos é mantida)">
            ⟲<span className={s.rotRestaurar}> Restaurar filtros</span>
          </button>
        </div>
      </section>
    </>
  );
}

export function FaixaCobertura({ resumo }) {
  const { cliente, geral, status } = useBi();
  const n = geral.de && geral.ate ? diasNoIntervalo(geral.de, geral.ate) : 0;
  const cal = useConsulta(cliente, 'calendario', n > 0 && n <= 120 ? { de: geral.de, ate: geral.ate } : null);
  const c = resumo.status === 'ok' && resumo.dados ? contagemCobertura(resumo.dados.dias) : null;
  const filtroDias = geral.dias.length < 7 ? new Set(geral.dias) : null;
  const doCal = cal.status === 'ok' && cal.dados ? cal.dados.filter((d) => !filtroDias || filtroDias.has(diaDaSemana(d.dia))) : null;
  const fora = cal.status === 'ok' ? diasForaDasMedias(cal.dados, geral.dias) : [];
  const classeTrilha = (d) => {
    if (d.entra_media_vendas) return '';
    if (d.classe_vendas === 'sem_importacao' || d.classe_vendas === 'sem_operacao') return s.tSem;
    if (d.classe_vendas === 'cobertura_nao_confirmada') return s.tNc;
    return s.tParcial;
  };
  const noFiltro = resumo.dados && resumo.dados.filtro ? resumo.dados.filtro.dias_calendario : null;
  const foraFiltro = resumo.dados && resumo.dados.filtro ? resumo.dados.filtro.dias_fora_filtro : 0;
  if (!c) return <div className={s.cobertura}>{resumo.status === 'erro' ? null : <span>Calculando cobertura…</span>}</div>;
  return (
    <div className={s.cobertura} aria-label="Cobertura do período">
      <b>Cobertura do período:</b>
      {doCal && doCal.length > 0 && (
        <span className={s.trilha} aria-hidden="true">
          {doCal.map((d) => (
            <i key={d.dia} className={cx(classeTrilha(d), d.dia === status.hoje && s.tHoje)} title={`${data(d.dia)} · ${ROTULO_CLASSE[d.classe_vendas] || d.classe_vendas}${d.hora_limite_vendas ? ` (até ${String(d.hora_limite_vendas).slice(0, 5)})` : ''}`} />
          ))}
        </span>
      )}
      <span className={s.leg}>
        <b className={cx(s.legCor, s.legCompleto)} />
        {plural(c.completos, 'completo')}
        {c.semVendas > 0 ? ` (${numero(c.semVendas)} sem vendas: zero real)` : ''}
      </span>
      {(c.parciais > 0 || c.pendencias > 0) && (
        <span className={s.leg}>
          <b className={cx(s.legCor, s.legParcial)} />
          {plural(c.parciais + c.pendencias, 'parcial', 'parciais')} (fora das médias)
        </span>
      )}
      {(c.semImportacao > 0 || c.semOperacao > 0) && (
        <span className={s.leg}>
          <b className={cx(s.legCor, s.legSem)} />
          {c.semImportacao > 0 && `${numero(c.semImportacao)} sem importação (lacuna, não zero)`}
          {c.semImportacao > 0 && c.semOperacao > 0 && ' · '}
          {c.semOperacao > 0 && `${numero(c.semOperacao)} sem operação`}
        </span>
      )}
      {c.naoConfirmados > 0 && (
        <span className={s.leg}>
          <b className={cx(s.legCor, s.legNc)} />
          {numero(c.naoConfirmados)} cobertura não confirmada
        </span>
      )}
      {fora.length > 0 && fora.length <= 6 && (
        <span className={s.foraMedias}>
          Fora das médias: {fora.map((d) => `${dataCurta(d.dia)} ${ROTULO_CLASSE[d.classe] || d.classe}${d.classe === 'parcial' && d.horaLimite ? ` (até ${d.horaLimite})` : ''}`).join(' · ')}
        </span>
      )}
      {noFiltro !== null && (
        <span>
          {plural(noFiltro, 'dia')} no filtro ({nomeDosDias(geral.dias)}){foraFiltro ? ` · ${numero(foraFiltro)} fora do filtro` : ''}
        </span>
      )}
      {ATALHOS_ATE_ULTIMO_COMPLETO.has(geral.atalho) && status.padrao_ate && (
        <span className={s.notaPeriodo}>
          ⓘ {geral.atalho === '7' ? '7' : '30'} dias corridos até {dataCurta(status.padrao_ate)}, o último dia com importação completa; lacunas não são compensadas.
        </span>
      )}
    </div>
  );
}

function Variacao({ valor, bomQuandoSobe = true }) {
  const v = variacao(valor);
  if (!v) return null;
  const cls = !bomQuandoSobe ? s.varNeutra : v.sentido === 'sobe' ? s.varSobe : v.sentido === 'desce' ? s.varDesce : s.varNeutra;
  return <span className={cx(s.var, cls)}>{v.texto}</span>;
}

function Cartao({ titulo, valor, linhaVar, detalhe, spark, parcial }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiTitulo}>
        {titulo} {parcial && <span className={s.badgeParcial}>parcial</span>}
      </div>
      <div className={s.kpiValor} title={valor}>
        {valor}
      </div>
      <div className={s.kpiDet}>{linhaVar}</div>
      <div className={s.kpiDet}>{detalhe}</div>
      {spark}
    </div>
  );
}

export function Indicadores({ resumo }) {
  const { cliente, geral } = useBi();
  const n = geral.de && geral.ate ? diasNoIntervalo(geral.de, geral.ate) : 0;
  const ref = periodoReferencia({ de: geral.de, ate: geral.ate }, geral.referencia, { atalho: geral.atalho, livre: { de: geral.refDe, ate: geral.refAte } });
  const podeComparar = !!ref && n <= LIMITES.comparacao && diasNoIntervalo(ref.de, ref.ate) <= LIMITES.comparacao;
  const comp = useConsulta(cliente, 'comparar', podeComparar ? { a: { de: geral.de, ate: geral.ate }, b: ref, dias: geral.dias } : null);
  const serie = useConsulta(cliente, 'serie', n > 0 && n <= LIMITES.serieDia ? { de: geral.de, ate: geral.ate, agrupamento: 'dia', dias: geral.dias } : null);

  if (resumo.status !== 'ok') {
    return (
      <div className={s.kpis}>
        {resumo.status === 'erro' ? (
          <div className={cx(s.aviso, s.avisoErro)} style={{ gridColumn: '1 / -1' }} role="alert">
            <span>{resumo.erro}</span>
            <button type="button" className={s.btnLink} onClick={resumo.tentarDeNovo}>
              Tentar de novo
            </button>
          </div>
        ) : (
          Array.from({ length: 6 }, (_, i) => <div key={i} className={cx(s.kpi, s.esqueleto)} style={{ height: 116 }} />)
        )}
      </div>
    );
  }

  const r = resumo.dados;
  if (r.motivo) {
    return (
      <div className={s.kpis}>
        <div className={s.kpi} style={{ gridColumn: '1 / -1' }}>
          <p className={s.vazio}>{MOTIVO_PERIODO[r.motivo] || 'Período sem dados.'} Os indicadores ficam “sem dados”.</p>
        </div>
      </div>
    );
  }

  const base = r.base_media || {};
  const reg = r.registrado;
  const temBase = Number(base.dias_validos || 0) > 0;
  const sit = situacaoComparacao(comp.status === 'ok' ? comp.dados : null);
  const pareado = sit.estado === 'ok' && sit.pareado;
  const sparkDe = (campo) => (serie.status === 'ok' && serie.dados ? serie.dados.map((l) => (l[campo] === null || l[campo] === undefined ? null : Number(l[campo]))) : null);

  const linhaVar = (campo, total, bom = true) => {
    if (!ref) return null;
    if (!podeComparar) return <span className={cx(s.var, s.varNeutra)}>comparação até {LIMITES.comparacao} dias</span>;
    if (comp.status === 'carregando' || comp.status === 'inativo') return <span className={s.cod}>calculando variação…</span>;
    if (comp.status === 'erro') return <span className={cx(s.var, s.varNeutra)}>variação indisponível</span>;
    if (sit.estado !== 'ok') return <span className={cx(s.var, s.varNeutra)}>não comparável</span>;
    if (total && !pareado) return <span className={cx(s.var, s.varNeutra)}>só médias comparáveis</span>;
    const v = variacaoValida(comp.dados, campo);
    if (v === null) return <span className={cx(s.var, s.varNeutra)}>{comp.dados.geral.base_zero ? 'referência zerada' : '—'}</span>;
    return (
      <>
        <Variacao valor={v} bomQuandoSobe={bom} /> vs. ref.
      </>
    );
  };

  // Período só com dia parcial (ex.: Hoje): mostra o registrado, marcado.
  if (!temBase && reg) {
    return (
      <>
        <div className={s.kpis}>
          <Cartao parcial titulo="Faturamento bruto" valor={moeda(reg.bruto)} linhaVar="sem variação (dia parcial)" detalhe="Registrado até a última importação" />
          <Cartao parcial titulo="Faturamento líquido" valor={moeda(reg.liquido)} linhaVar="sem variação (dia parcial)" detalhe="Registrado até a última importação" />
          <Cartao parcial titulo="Vendas" valor={numero(reg.vendas)} linhaVar="sem variação (dia parcial)" detalhe="Registrado até a última importação" />
          <Cartao parcial titulo="Ticket médio" valor={moeda(reg.ticket)} linhaVar="sem variação (dia parcial)" detalhe="Líquido ÷ vendas" />
          <Cartao parcial titulo="Descontos" valor={moeda(reg.descontos)} linhaVar="sem variação (dia parcial)" detalhe={`${percentual(reg.percentual_descontos, 2)} do bruto`} />
          <Cartao titulo="Média diária (bruto)" valor="sem dados" linhaVar="" detalhe="Nenhum dia completo no período" />
        </div>
        <div className={s.crit} style={{ margin: '8px 2px 0' }}>
          <span className={s.critAviso}>
            <b>Período sem dia completo:</b> valores registrados até a última importação; fora das médias e das comparações.
          </span>
        </div>
      </>
    );
  }

  if (!temBase) {
    return (
      <div className={s.kpis}>
        <div className={s.kpi} style={{ gridColumn: '1 / -1' }}>
          <p className={s.vazio}>Sem dias completos no período e filtro escolhidos — os indicadores ficam “sem dados” (nunca R$ 0,00).</p>
        </div>
      </div>
    );
  }

  const g = comp.status === 'ok' && comp.dados ? comp.dados : null;
  return (
    <>
      <div className={s.kpis}>
        <Cartao
          titulo="Faturamento bruto"
          valor={moeda(base.bruto)}
          linhaVar={linhaVar('bruto', true)}
          detalhe={reg && Number(reg.bruto) !== Number(base.bruto) ? `Registrado c/ parciais: ${moeda(reg.bruto)}` : `${plural(base.dias_validos, 'dia completo', 'dias completos')}`}
          spark={<Minigrafico valores={sparkDe('media_diaria_bruto')} />}
        />
        <Cartao titulo="Faturamento líquido" valor={moeda(base.liquido)} linhaVar={linhaVar('liquido', true)} detalhe="Bruto − descontos + acréscimos" spark={<Minigrafico valores={sparkDe('media_diaria_liquido')} />} />
        <Cartao titulo="Vendas" valor={numero(base.vendas)} linhaVar={linhaVar('vendas', true)} detalhe={`${numero(base.media_diaria_vendas, 1)} por dia`} spark={<Minigrafico valores={sparkDe('media_diaria_vendas')} />} />
        <Cartao titulo="Ticket médio" valor={moeda(base.ticket)} linhaVar={linhaVar('ticket', false)} detalhe="Líquido ÷ vendas" />
        <Cartao
          titulo="Descontos"
          valor={moeda(base.descontos)}
          linhaVar={linhaVar('descontos', true, false)}
          detalhe={`${percentual(base.percentual_descontos, 2)} do bruto · ${moeda(base.media_diaria_descontos)}/dia`}
          spark={<Minigrafico valores={sparkDe('media_diaria_descontos')} />}
        />
        <Cartao titulo="Média diária (bruto)" valor={moeda(base.media_diaria_bruto)} linhaVar={linhaVar('media_diaria_bruto', false)} detalhe={`por dia completo (${plural(base.dias_validos, 'dia')})`} />
      </div>
      <div className={s.crit} style={{ margin: '8px 2px 0' }}>
        {!ref && <span>Variação desativada · {plural(base.dias_validos, 'dia completo', 'dias completos')}</span>}
        {ref && g && (
          <>
            <span>
              Referência: <b>{intervalo(g.periodos.b.de, g.periodos.b.ate)}</b>
            </span>
            <span>
              Critério:{' '}
              <b>
                {g.criterio === 'pareado'
                  ? `pareado · ${numero(g.pareamento ? g.pareamento.pares_validos_vendas : 0)} de ${numero(g.pareamento ? g.pareamento.pares : 0)} pares válidos`
                  : 'média por dia válido'}
              </b>
            </span>
            <span>
              Cobertura A {percentual(g.geral.a.cobertura, 0)} · B {percentual(g.geral.b.cobertura, 0)} (mínimo {percentual(g.cobertura_minima, 0)})
            </span>
            {!g.geral.comparavel && (
              <span className={s.critAviso}>
                <b>Não comparável:</b> {MOTIVO_COMPARACAO[g.geral.motivo] || g.geral.motivo} As variações não são exibidas.
              </span>
            )}
            {(g.avisos || []).map((a) => (
              <span key={a} className={s.critInfo}>
                ⓘ {AVISO_COMPARACAO[a] || a}
              </span>
            ))}
          </>
        )}
        {ref && !podeComparar && <span className={s.critAviso}>A variação está disponível para períodos de até {LIMITES.comparacao} dias.</span>}
        {(r.avisos || []).filter((a) => AVISO_PERIODO[a] && a !== 'contem_dia_parcial').map((a) => (
          <span key={a} className={s.critInfo}>
            ⓘ {AVISO_PERIODO[a]}
          </span>
        ))}
      </div>
    </>
  );
}

