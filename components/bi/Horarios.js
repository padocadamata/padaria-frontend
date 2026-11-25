import { useId, useMemo, useRef, useState } from 'react';
import Bloco, { AvisoLimite, EstadoConsulta, useFiltrosDoBloco } from './Bloco';
import { ComparacaoDica, GraficoColunas, GraficoLinhas, Legenda, LinhaDica } from './Graficos';
import { ProdutosSelecionados } from './Produtos';
import { useBi, useRegistroExportacao } from './contexto';
import { useConsulta, useVisivel } from '../../lib/bi/useConsulta';
import { LIMITES, NOMES_DIA, diasNoIntervalo, periodoReferencia } from '../../lib/bi/datas';
import { analisarHorarios, curvasProdutoHorario, escalaCalor, faixaDeHoras, topPorHora } from '../../lib/bi/modelos';
import { COR_SERIE_A, COR_SERIE_B, corCalor } from '../../lib/bi/cores';
import { intervalo, intervaloCurto, moeda, moedaEixo, nomeDosDias, numero, numeroEixo, percentual, percentualEixo, plural, pontosPercentuais } from '../../lib/bi/formatos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

const valido = (f) => !!(f.de && f.ate && f.de <= f.ate);

const METRICAS_CURVA = {
  bruto: { rotulo: 'Faturamento médio/dia', fmt: moeda, eixo: moedaEixo },
  vendas: { rotulo: 'Vendas médias/dia', fmt: (v) => numero(v, 1), eixo: numeroEixo },
  ticket: { rotulo: 'Ticket médio', fmt: moeda, eixo: moedaEixo },
};

export function CurvaHorario() {
  const { cliente } = useBi();
  const f = useFiltrosDoBloco('curva');
  const [refVisivel, visivel] = useVisivel();
  const [metrica, setMetrica] = useState('bruto');
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const ref = periodoReferencia({ de: f.de, ate: f.ate }, f.referencia, { atalho: f.atalho, livre: f.referenciaLivre });
  // Mesma consulta do mapa de calor e da média por dia da semana (cache).
  const argsA = n > 0 && n <= LIMITES.geral ? { de: f.de, ate: f.ate, dias: f.dias } : null;
  const argsB = argsA && ref && diasNoIntervalo(ref.de, ref.ate) <= LIMITES.geral ? { de: ref.de, ate: ref.ate, dias: f.dias } : null;
  const a = useConsulta(cliente, 'horarios', visivel ? argsA : null);
  const b = useConsulta(cliente, 'horarios', visivel ? argsB : null);
  useRegistroExportacao('curva', {
    filtros: f,
    ref: argsB ? ref : null,
    parametros: { metrica },
    consultas: { a: argsA && { tipo: 'horarios', args: argsA }, b: argsB && { tipo: 'horarios', args: argsB } },
    indisponivel: n > LIMITES.geral ? `Período acima de ${numero(LIMITES.geral)} dias.` : null,
  });
  const ha = a.status === 'ok' ? analisarHorarios(a.dados) : null;
  const hb = b.status === 'ok' ? analisarHorarios(b.dados) : null;
  const faixa = faixaDeHoras(ha ? ha.curva : [], hb ? hb.curva : []);
  const def = METRICAS_CURVA[metrica];
  const dados = [];
  for (let h = faixa.inicio; h <= faixa.fim; h += 1) {
    const pa = ha && ha.curva.find((p) => p.hora === h);
    const pb = hb && hb.curva.find((p) => p.hora === h);
    dados.push({ hora: h, rotulo: `${h}h`, a: pa ? pa[metrica] : null, b: pb ? pb[metrica] : null, diasA: pa ? pa.dias : null, diasB: pb ? pb.dias : null, vendasA: pa ? pa.totalVendas : null, vendasB: pb ? pb.totalVendas : null });
  }
  const subHora = (dias, vendas) => {
    if (!dias) return 'sem dia completo no período: sem dados (não é zero)';
    if (metrica === 'ticket') return vendas ? `líquido ÷ ${plural(vendas, 'venda')} da hora` : 'sem vendas nesta hora: ticket não se aplica';
    return `média de ${plural(dias, 'dia completo', 'dias completos')}${vendas === 0 ? ' · sem vendas (zero real)' : ''}`;
  };
  const valorHora = (v, dias) => (v === null || v === undefined ? (dias && metrica === 'ticket' ? 'não se aplica' : 'sem dados') : def.fmt(v));
  const conteudoDica = (p) => (
    <>
      <b className={s.ttTitulo}>
        {p.hora}h às {p.hora}h59 · {def.rotulo}
      </b>
      <LinhaDica cor={COR_SERIE_A} rotulo={`A · ${intervaloCurto(f.de, f.ate)}`} valor={valorHora(p.a, p.diasA)} sub={subHora(p.diasA, p.vendasA)} />
      {hb && <LinhaDica cor={COR_SERIE_B} rotulo={`B · ${intervaloCurto(ref.de, ref.ate)}`} valor={valorHora(p.b, p.diasB)} sub={subHora(p.diasB, p.vendasB)} />}
      {hb && <ComparacaoDica a={p.a} b={p.b} formato={def.fmt} />}
    </>
  );
  const series = [{ chave: 'a', nome: `A · ${intervaloCurto(f.de, f.ate)}`, cor: COR_SERIE_A, tipo: 'barra' }];
  if (hb) series.push({ chave: 'b', nome: `B · ${intervaloCurto(ref.de, ref.ate)}`, cor: COR_SERIE_B, tipo: 'barra' });
  return (
    <Bloco
      nome="curva"
      titulo="Distribuição das vendas por horário"
      largura="s6"
      refVisivel={refVisivel}
      acoes={
        <select className={cx(s.controle, s.controlePequeno)} value={metrica} aria-label="Métrica" onChange={(e) => setMetrica(e.target.value)}>
          {Object.entries(METRICAS_CURVA).map(([k, m]) => (
            <option key={k} value={k}>
              {m.rotulo}
            </option>
          ))}
        </select>
      }
      rodape={
        <>
          <span>Média por dia completo, por hora de emissão (horário de Brasília)</span>
          <span>{nomeDosDias(f.dias)}</span>
          {ha && <span>{plural(ha.diasConsiderados, 'dia completo', 'dias completos')}</span>}
        </>
      }
    >
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={a} altura={240} vazio={ha && !ha.diasConsiderados ? 'Sem dias completos no período.' : null}>
          <Legenda itens={series} />
          <GraficoColunas dados={dados} series={series} formatoEixo={def.eixo} formatoValor={def.fmt} altura={220} conteudoDica={conteudoDica} rotuloAcessivel="Distribuição por hora" />
        </EstadoConsulta>
      )}
    </Bloco>
  );
}

// Indicadores do mapa de calor (dados de bi_horarios, só dias completos):
//  bruto  -> faturamento bruto da hora ÷ dias completos do dia da semana
//  vendas -> vendas da hora ÷ dias completos do dia da semana
//  ticket -> líquido da hora ÷ vendas da hora (razão dos totais)
const INDICADORES_CALOR = {
  bruto: { rotulo: 'Faturamento médio', curto: 'Faturamento', fmt: moeda, legenda: 'faturamento médio/dia', descricao: 'Faturamento bruto médio por dia completo de cada dia da semana' },
  vendas: { rotulo: 'Vendas médias', curto: 'Vendas', fmt: (v) => numero(v, 1), legenda: 'vendas médias/dia', descricao: 'Quantidade média de vendas por dia completo de cada dia da semana' },
  ticket: { rotulo: 'Ticket médio', curto: 'Ticket', fmt: moeda, legenda: 'ticket médio', descricao: 'Ticket médio = faturamento líquido ÷ vendas da hora (dias completos)' },
};

export function MapaCalor() {
  const { cliente } = useBi();
  const f = useFiltrosDoBloco('calor');
  const [refVisivel, visivel] = useVisivel();
  const [indicador, setIndicador] = useState('bruto');
  const [dica, setDica] = useState(null);
  const caixa = useRef(null);
  const idPadrao = `hachura${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const argsCalor = n > 0 && n <= LIMITES.geral ? { de: f.de, ate: f.ate, dias: f.dias } : null;
  const a = useConsulta(cliente, 'horarios', visivel ? argsCalor : null);
  useRegistroExportacao('calor', {
    filtros: f,
    parametros: { indicador },
    consultas: { horarios: argsCalor && { tipo: 'horarios', args: argsCalor } },
    indisponivel: n > LIMITES.geral ? `Período acima de ${numero(LIMITES.geral)} dias.` : null,
  });
  const h = a.status === 'ok' ? analisarHorarios(a.dados) : null;
  const faixa = faixaDeHoras(h ? h.curva : []);
  const horas = [];
  for (let x = faixa.inicio; x <= faixa.fim; x += 1) horas.push(x);
  const def = INDICADORES_CALOR[indicador];
  const escala = h ? escalaCalor(h.calor, indicador, horas) : { minimo: 0, maximo: 0, vazio: true };
  const foraFiltro = (dow) => f.dias.length < 7 && !f.dias.includes(dow);
  const cw = 30;
  const ch = 24;
  const l = 40;
  const t = 18;
  const w = l + horas.length * cw;
  const altura = t + 7 * ch + 4;

  // Situação de uma célula: valor válido (escala), sem dados (hachura) ou
  // ticket sem vendas na hora (não se aplica, contorno tracejado).
  const celula = (linha, hh) => {
    if (!linha.dias) return { tipo: 'sem_dados', motivo: foraFiltro(linha.dow) ? 'dia da semana fora do filtro' : 'nenhum dia completo deste dia da semana no período' };
    const v = linha[indicador][hh];
    if (v === null || v === undefined) return { tipo: 'nao_se_aplica', motivo: 'sem vendas nesta hora: ticket não se aplica' };
    return { tipo: 'valor', v };
  };

  const mostrar = (ev, linha, hh, i) => {
    const alvo = ev.currentTarget.getBoundingClientRect();
    const base = caixa.current ? caixa.current.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
    const x = alvo.left + alvo.width / 2 - base.left;
    const embaixo = i < 3;
    setDica({ dow: linha.dow, hora: hh, linha, x, y: embaixo ? alvo.bottom - base.top + 8 : alvo.top - base.top - 8, embaixo, largura: base.width });
  };

  const textoDica = (linha, hh) => {
    const c = celula(linha, hh);
    if (c.tipo === 'sem_dados') return `sem dados (${c.motivo})`;
    return Object.entries(INDICADORES_CALOR)
      .map(([k, d]) => `${d.curto}: ${linha[k][hh] === null ? 'não se aplica' : d.fmt(linha[k][hh])}`)
      .join(' · ');
  };

  return (
    <Bloco
      nome="calor"
      titulo="Mapa de calor · dia da semana × hora"
      largura="s6"
      refVisivel={refVisivel}
      acoes={
        <div className={cx(s.seg, s.segPequeno)} role="group" aria-label="Indicador do mapa de calor">
          {Object.entries(INDICADORES_CALOR).map(([k, d]) => (
            <button key={k} type="button" aria-pressed={indicador === k} onClick={() => setIndicador(k)}>
              {d.curto}
            </button>
          ))}
        </div>
      }
      rodape={
        <>
          <span>{def.descricao}</span>
          <span>{nomeDosDias(f.dias)}</span>
        </>
      }
    >
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={a} altura={240} vazio={h && !h.diasConsiderados ? 'Sem dias completos no período: sem dados (não é zero).' : null}>
          {h && (
            <div ref={caixa} style={{ position: 'relative' }} onMouseLeave={() => setDica(null)}>
              <div className={s.mapa}>
                <svg viewBox={`0 0 ${w} ${altura}`} width={w} height={altura} style={{ minWidth: Math.min(w, 320), maxWidth: '100%', height: 'auto' }} role="img" aria-label={`Mapa de calor: ${def.legenda} por dia da semana e hora`}>
                  <defs>
                    <pattern id={idPadrao} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="5" height="5" fill="#f4f6f5" />
                      <line x1="0" y1="0" x2="0" y2="5" stroke="#cfd8d5" strokeWidth="2" />
                    </pattern>
                  </defs>
                  {horas.map((hh, j) => (
                    <text key={hh} x={l + j * cw + cw / 2} y={12} textAnchor="middle">
                      {hh}h
                    </text>
                  ))}
                  {h.calor.map((linha, i) => (
                    <g key={linha.dow}>
                      <text x={l - 8} y={t + i * ch + ch / 2 + 4} textAnchor="end">
                        {linha.rotulo}
                      </text>
                      {horas.map((hh, j) => {
                        const c = celula(linha, hh);
                        const ativo = dica && dica.dow === linha.dow && dica.hora === hh;
                        return (
                          <rect
                            key={hh}
                            x={l + j * cw + 1}
                            y={t + i * ch + 1}
                            width={cw - 2}
                            height={ch - 2}
                            rx={3}
                            fill={c.tipo === 'valor' ? corCalor(c.v, escala.maximo, escala.minimo) : c.tipo === 'sem_dados' ? `url(#${idPadrao})` : '#fff'}
                            stroke={ativo ? '#0e3d3a' : c.tipo === 'nao_se_aplica' ? '#b5c0bd' : 'none'}
                            strokeWidth={ativo ? 1.5 : 1}
                            strokeDasharray={c.tipo === 'nao_se_aplica' && !ativo ? '3 2' : undefined}
                            onMouseEnter={(ev) => mostrar(ev, linha, hh, i)}
                          >
                            <title>{`${NOMES_DIA[linha.dow]} · ${hh}h: ${textoDica(linha, hh)}`}</title>
                          </rect>
                        );
                      })}
                    </g>
                  ))}
                </svg>
              </div>
              {dica && (
                <div
                  className={cx(s.tt, s.calorDica)}
                  style={{
                    // centralizado na célula, sem sair do bloco (largura 290px)
                    left: Math.max(149, Math.min(dica.x, dica.largura - 149)),
                    top: dica.y,
                    transform: dica.embaixo ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
                  }}
                  role="tooltip"
                >
                  <b className={s.ttTitulo}>
                    {NOMES_DIA[dica.dow]} · {dica.hora}h às {dica.hora}h59
                  </b>
                  {celula(dica.linha, dica.hora).tipo === 'sem_dados' ? (
                    <div className={s.ttAviso}>Sem dados: {celula(dica.linha, dica.hora).motivo} (não é zero).</div>
                  ) : (
                    <>
                      {Object.entries(INDICADORES_CALOR).map(([k, d]) => {
                        const v = dica.linha[k][dica.hora];
                        return <LinhaDica key={k} rotulo={d.rotulo} valor={v === null ? 'não se aplica (sem vendas)' : d.fmt(v)} forte={k === indicador} />;
                      })}
                      <div className={s.ttSub}>
                        Base: {plural(dica.linha.dias, 'dia completo', 'dias completos')} de {NOMES_DIA[dica.dow].toLowerCase()}
                        {dica.linha.vendas[dica.hora] === 0 ? ' · sem vendas nesta hora (zero real)' : ''}
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className={s.calorLegenda}>
                {!escala.vazio && (
                  <span className={s.calorRampa}>
                    {def.fmt(escala.minimo)}
                    {[0, 1, 2, 3, 4, 5].map((k) => (
                      <i key={k} style={{ background: corCalor(escala.minimo + ((escala.maximo - escala.minimo) * k) / 5, escala.maximo, escala.minimo) }} />
                    ))}
                    {def.fmt(escala.maximo)} <span>({def.legenda})</span>
                  </span>
                )}
                <span>
                  <i className={cx(s.calorAmostra, s.calorSemDados)} />
                  sem dados (dia da semana sem dia completo ou fora do filtro)
                </span>
                {indicador === 'ticket' && (
                  <span>
                    <i className={cx(s.calorAmostra, s.calorNaoSeAplica)} />
                    sem vendas na hora (ticket não se aplica)
                  </span>
                )}
              </div>
            </div>
          )}
        </EstadoConsulta>
      )}
    </Bloco>
  );
}

export function ProdutosPorHorario() {
  const { cliente, selecionados, cores } = useBi();
  const f = useFiltrosDoBloco('prodhora');
  const [refVisivel, visivel] = useVisivel();
  const [modo, setModo] = useState('escolhidos');
  const [compararB, setCompararB] = useState(true);
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const periodoOk = n > 0 && n <= LIMITES.geral;
  const ref = periodoReferencia({ de: f.de, ate: f.ate }, f.referencia === 'nenhuma' ? 'anterior' : f.referencia, { atalho: f.atalho, livre: f.referenciaLivre });
  const unico = selecionados[0];
  const argsTop = periodoOk && modo === 'top' ? { de: f.de, ate: f.ate, limite: 3, dias: f.dias } : null;
  const argsEsc = periodoOk && modo === 'escolhidos' && selecionados.length ? { codigos: selecionados, de: f.de, ate: f.ate, dias: f.dias } : null;
  const argsEscB = argsEsc && compararB && unico && ref && diasNoIntervalo(ref.de, ref.ate) <= LIMITES.geral ? { codigos: [unico], de: ref.de, ate: ref.ate, dias: f.dias } : null;
  const top = useConsulta(cliente, 'produtosHorario', visivel ? argsTop : null);
  const esc = useConsulta(cliente, 'produtoHorarios', visivel ? argsEsc : null);
  const escB = useConsulta(cliente, 'produtoHorarios', visivel ? argsEscB : null);
  useRegistroExportacao('prodhora', {
    filtros: f,
    ref: argsEscB ? ref : null,
    parametros: { modo, compararB, unico: unico || null, selecionados },
    consultas: {
      top: argsTop && { tipo: 'produtosHorario', args: argsTop },
      escolhidos: argsEsc && { tipo: 'produtoHorarios', args: argsEsc },
      referencia: argsEscB && { tipo: 'produtoHorarios', args: argsEscB },
    },
    indisponivel: n > LIMITES.geral
      ? `Período acima de ${numero(LIMITES.geral)} dias.`
      : modo === 'escolhidos' && !selecionados.length
        ? 'Nenhum produto selecionado.'
        : null,
  });
  const curvas = esc.status === 'ok' ? curvasProdutoHorario(esc.dados) : null;
  const curvasB = escB.status === 'ok' ? curvasProdutoHorario(escB.dados) : null;
  const dados = useMemo(() => {
    if (!curvas) return [];
    const horasComVenda = [];
    for (const c of [...curvas.values(), ...(curvasB ? curvasB.values() : [])]) {
      for (const [h, v] of c.horas) if ((v.vendas || 0) > 0) horasComVenda.push(h);
    }
    const ini = horasComVenda.length ? Math.min(...horasComVenda) : 6;
    const fim = horasComVenda.length ? Math.max(...horasComVenda) : 22;
    const out = [];
    for (let h = ini; h <= fim; h += 1) {
      const p = { indice: h - ini, rotulo: `${h}h`, hora: h };
      for (const codigo of selecionados) {
        const c = curvas.get(codigo);
        const x = c && c.horas.get(h);
        p[`c_${codigo}`] = x ? x.participacao : null;
        p[`m_${codigo}`] = x ? x.mediaBruto : null;
        p[`v_${codigo}`] = x ? x.vendas : null;
        p[`d_${codigo}`] = c ? c.dias : null;
      }
      if (curvasB && unico) {
        const c = curvasB.get(unico);
        const x = c && c.horas.get(h);
        p.b = x ? x.participacao : null;
        p.mb = x ? x.mediaBruto : null;
        p.db = c ? c.dias : null;
      }
      out.push(p);
    }
    return out;
  }, [curvas, curvasB, selecionados, unico]);
  const nome = (codigo) => (curvas && curvas.get(codigo) ? curvas.get(codigo).descricao : `código ${codigo}`);
  const series = selecionados.map((codigo) => ({ chave: `c_${codigo}`, nome: `${nome(codigo)} (${codigo})`, cor: cores[codigo] }));
  if (curvasB && unico) series.push({ chave: 'b', nome: `${nome(unico)} (${unico}) · B ${intervaloCurto(ref.de, ref.ate)}`, cor: cores[unico], tracejado: true });
  const semDias = curvas && [...curvas.values()].every((c) => !c.dias);
  const subProduto = (dias, media, vendas) => {
    if (!dias) return 'sem dia completo com vendas do produto: sem dados';
    if (vendas === 0) return `sem vendas do produto nesta hora (zero real) · ${plural(dias, 'dia completo', 'dias completos')}`;
    return `${media === null || media === undefined ? '—' : moeda(media)}/dia nesta hora · ${plural(dias, 'dia completo', 'dias completos')}`;
  };
  const conteudoDica = (p) => (
    <>
      <b className={s.ttTitulo}>{p.hora}h às {p.hora}h59 · % do faturamento do produto</b>
      {selecionados.map((codigo) => (
        <LinhaDica
          key={codigo}
          cor={cores[codigo]}
          rotulo={`${nome(codigo)} · cód. ${codigo}`}
          valor={p[`c_${codigo}`] === null || p[`c_${codigo}`] === undefined ? 'sem dados' : percentual(p[`c_${codigo}`], 1)}
          sub={subProduto(p[`d_${codigo}`], p[`m_${codigo}`], p[`v_${codigo}`])}
        />
      ))}
      {curvasB && unico && (
        <>
          <LinhaDica
            cor={cores[unico]}
            tracejado
            rotulo={`B · ${intervaloCurto(ref.de, ref.ate)} · cód. ${unico}`}
            valor={p.b === null || p.b === undefined ? 'sem dados' : percentual(p.b, 1)}
            sub={p.db ? `${p.mb === null || p.mb === undefined ? '—' : moeda(p.mb)}/dia nesta hora · ${plural(p.db, 'dia completo', 'dias completos')}` : 'sem dia completo com vendas do produto: sem dados'}
          />
          <ComparacaoDica a={p[`c_${unico}`]} b={p.b} formato={(v) => percentual(v, 1)} formatoDiferenca={(v) => pontosPercentuais(v, 1)} apenasDiferenca />
        </>
      )}
    </>
  );
  const linhasTop = top.status === 'ok' ? topPorHora(top.dados) : [];

  return (
    <Bloco
      nome="prodhora"
      titulo="Produtos por horário"
      largura="s12"
      refVisivel={refVisivel}
      acoes={
        <div className={cx(s.seg, s.segPequeno)} role="group" aria-label="Modo">
          <button type="button" aria-pressed={modo === 'top'} onClick={() => setModo('top')}>
            Mais vendidos por hora
          </button>
          <button type="button" aria-pressed={modo === 'escolhidos'} onClick={() => setModo('escolhidos')}>
            Produtos escolhidos
          </button>
        </div>
      }
      rodape={
        modo === 'top' ? (
          <>
            <span>Top 3 por hora (faturamento do item, nunca o total da venda)</span>
            <span>{intervalo(f.de, f.ate)}</span>
            <span>{nomeDosDias(f.dias)}</span>
          </>
        ) : (
          <>
            <span>
              <b>% do produto</b> = faturamento do produto na hora ÷ total do próprio produto no recorte (compara produtos e períodos de tamanhos diferentes)
            </span>
            <span>{nomeDosDias(f.dias)}</span>
          </>
        )
      }
    >
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias.</AvisoLimite>
      ) : modo === 'top' ? (
        <EstadoConsulta consulta={top} altura={300} vazio={top.status === 'ok' && linhasTop.length === 0 ? 'Sem dias completos com vendas conciliadas no período.' : null}>
          <div className={s.rolagemX}>
            <table className={s.tabela}>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>1º</th>
                  <th className={s.n}>Fat. médio/dia</th>
                  <th>2º</th>
                  <th className={s.n}>Fat. médio/dia</th>
                  <th>3º</th>
                  <th className={s.n}>Fat. médio/dia</th>
                </tr>
              </thead>
              <tbody>
                {linhasTop.map((l) => (
                  <tr key={l.hora}>
                    <td>
                      <b>{l.hora}h</b>
                    </td>
                    {[0, 1, 2].map((i) => {
                      const it = l.itens[i];
                      return it ? (
                        <FragmentoTop key={i} item={it} />
                      ) : (
                        <FragmentoVazio key={i} />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </EstadoConsulta>
      ) : (
        <>
          <ProdutosSelecionados de={f.de} ate={f.ate} dias={f.dias} />
          {selecionados.length > 0 && (
            <div className={s.crit}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" className={s.cb} checked={compararB} onChange={(e) => setCompararB(e.target.checked)} /> comparar <b>{nome(unico)} ({unico})</b> com {ref ? `a referência (${intervaloCurto(ref.de, ref.ate)})` : 'a referência'}
              </label>
            </div>
          )}
          {selecionados.length === 0 ? (
            <p className={s.vazio}>Selecione ao menos um produto (qualquer código G3, independente do ranking).</p>
          ) : (
            <EstadoConsulta consulta={esc} altura={240} vazio={semDias ? 'Sem dias completos com vendas conciliadas no período.' : null}>
              <Legenda itens={series} />
              {escB.status === 'erro' && <div className={cx(s.aviso, s.avisoAt)}>Referência indisponível: {escB.erro}</div>}
              <GraficoLinhas dados={dados} series={series} formatoEixo={percentualEixo} formatoValor={(v) => percentual(v, 1)} altura={230} conteudoDica={conteudoDica} rotuloAcessivel="Distribuição horária dos produtos selecionados" />
            </EstadoConsulta>
          )}
        </>
      )}
    </Bloco>
  );
}

function FragmentoTop({ item }) {
  return (
    <>
      <td>
        {item.descricao} <span className={s.cod}>{item.codigo}</span>
      </td>
      <td className={s.n}>{moeda(item.mediaBruto)}</td>
    </>
  );
}

function FragmentoVazio() {
  return (
    <>
      <td className={s.cod}>—</td>
      <td className={s.n}>—</td>
    </>
  );
}
