import { useState } from 'react';
import Bloco, { AvisoLimite, EstadoConsulta, useFiltrosDoBloco } from './Bloco';
import { ComparacaoDica, GraficoColunas, GraficoLinhas, Legenda, LinhaDica, notasDasMarcas } from './Graficos';
import { useBi, useRegistroExportacao } from './contexto';
import { useConsulta, useVisivel } from '../../lib/bi/useConsulta';
import { LIMITES, NOMES_DIA, diasNoIntervalo, periodoReferencia } from '../../lib/bi/datas';
import { METRICAS_SERIE, analisarHorarios, juntarSeries, pontosSerie, situacaoDoDia, situacaoDoGrupo } from '../../lib/bi/modelos';
import { COR_SERIE_A, COR_SERIE_B } from '../../lib/bi/cores';
import { ROTULO_AGRUPAMENTO, dataComDia, intervalo, intervaloCurto, moeda, moedaEixo, nomeDosDias, numero, numeroEixo, plural } from '../../lib/bi/formatos';
import s from './bi.module.css';

const valido = (f) => !!(f.de && f.ate && f.de <= f.ate);

export function EvolucaoFaturamento() {
  const { cliente } = useBi();
  const f = useFiltrosDoBloco('evolucao');
  const [refVisivel, visivel] = useVisivel();
  const [metrica, setMetrica] = useState('bruto');
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const limite = f.agrupamento === 'dia' ? LIMITES.serieDia : LIMITES.geral;
  const acimaDoLimite = n > limite;
  const ref = periodoReferencia({ de: f.de, ate: f.ate }, f.referencia, { atalho: f.atalho, livre: f.referenciaLivre });
  const refAcima = ref && diasNoIntervalo(ref.de, ref.ate) > limite;
  const argsA = n > 0 && !acimaDoLimite ? { de: f.de, ate: f.ate, agrupamento: f.agrupamento, dias: f.dias } : null;
  const argsB = argsA && ref && !refAcima ? { de: ref.de, ate: ref.ate, agrupamento: f.agrupamento, dias: f.dias } : null;
  const a = useConsulta(cliente, 'serie', visivel ? argsA : null);
  const b = useConsulta(cliente, 'serie', visivel ? argsB : null);
  useRegistroExportacao('evolucao', {
    filtros: f,
    ref: argsB ? ref : null,
    parametros: { metrica },
    consultas: { a: argsA && { tipo: 'serie', args: argsA }, b: argsB && { tipo: 'serie', args: argsB } },
    indisponivel: acimaDoLimite ? `O agrupamento por ${ROTULO_AGRUPAMENTO[f.agrupamento]} aceita até ${numero(limite)} dias e o período tem ${numero(n)}.` : null,
    avisos: refAcima ? [`Referência acima de ${numero(limite)} dias: não exibida.`] : [],
  });
  const def = METRICAS_SERIE[metrica];
  const pa = a.status === 'ok' ? pontosSerie(a.dados, metrica, f.agrupamento) : [];
  const pb = b.status === 'ok' ? pontosSerie(b.dados, metrica, f.agrupamento) : null;
  const dados = juntarSeries(pa, pb);
  const series = [{ chave: 'a', nome: `A · ${intervaloCurto(f.de, f.ate)}`, cor: COR_SERIE_A, rotuloPonto: (p) => p.rotuloA }];
  if (pb) series.push({ chave: 'b', nome: `B · ${intervaloCurto(ref.de, ref.ate)}`, cor: COR_SERIE_B, tracejado: true, rotuloPonto: (p) => p.rotuloB || '—' });
  const fmtValor = def.tipo === 'moeda' ? moeda : (v) => numero(v, f.agrupamento === 'dia' ? 0 : 1);
  const fmtEixo = def.tipo === 'moeda' ? moedaEixo : numeroEixo;
  const porDia = f.agrupamento === 'dia';
  // Tooltip: data + dia da semana, valor exato de A e B, situação da
  // cobertura de cada lado (parcial mostra o registrado, fora das médias),
  // diferença e variação só quando os dois lados são válidos.
  const valorPonto = (v, sit) => (v === null || v === undefined ? (sit.valido ? 'não se aplica (sem vendas)' : 'sem dados') : fmtValor(v));
  const subPonto = (sit, registrado) => (registrado !== null && registrado !== undefined && !sit.valido ? `${sit.texto} · registrado: ${fmtValor(registrado)}` : sit.texto);
  const conteudoDica = (p) => {
    const sitA = porDia ? situacaoDoDia(p.classe, p.horaA) : situacaoDoGrupo(p.diasValidosA, p.diasCalendarioA);
    const sitB = pb ? (porDia ? situacaoDoDia(p.classeB, p.horaB) : situacaoDoGrupo(p.diasValidosB, p.diasCalendarioB)) : null;
    const temB = pb && (p.rotuloB || p.inicioB);
    return (
      <>
        <b className={s.ttTitulo}>{porDia ? dataComDia(p.inicioA) : p.rotuloA || p.rotulo}</b>
        <LinhaDica cor={COR_SERIE_A} rotulo={`A · ${def.rotulo}`} valor={valorPonto(p.a, sitA)} sub={subPonto(sitA, porDia ? p.registradoA : null)} />
        {pb && (
          <LinhaDica
            cor={COR_SERIE_B}
            tracejado
            rotulo={`B · ${temB ? (porDia ? dataComDia(p.inicioB) : p.rotuloB) : 'sem período correspondente'}`}
            valor={temB ? valorPonto(p.b, sitB) : '—'}
            sub={temB ? subPonto(sitB, porDia ? p.registradoB : null) : null}
          />
        )}
        {pb && <ComparacaoDica a={p.a} b={p.b} formato={fmtValor} bomQuandoSobe={metrica !== 'descontos'} invalida={!temB ? 'sem período correspondente em B' : null} />}
        {!porDia && metrica !== 'ticket' && <div className={s.ttSub}>valores = média por dia completo do agrupamento</div>}
      </>
    );
  };
  const validos = pa.reduce((acc, p) => acc + (p.diasValidos || 0), 0);
  const calendario = pa.reduce((acc, p) => acc + (p.diasCalendario || 0), 0);
  const semValor = a.status === 'ok' && !pa.some((p) => p.valor !== null);

  return (
    <Bloco
      nome="evolucao"
      titulo="Evolução do faturamento"
      largura="s8"
      refVisivel={refVisivel}
      acoes={
        <select className={`${s.controle} ${s.controlePequeno}`} value={metrica} aria-label="Métrica" onChange={(e) => setMetrica(e.target.value)}>
          {Object.entries(METRICAS_SERIE).map(([k, m]) => (
            <option key={k} value={k}>
              {m.rotulo}
            </option>
          ))}
        </select>
      }
      rodape={
        <>
          <span>Período {intervalo(f.de, f.ate)}</span>
          <span>{nomeDosDias(f.dias)}</span>
          <span>agrupado por {ROTULO_AGRUPAMENTO[f.agrupamento]}</span>
          {a.status === 'ok' && <span>{plural(validos, 'dia completo', 'dias completos')} de {plural(calendario, 'dia')}</span>}
        </>
      }
    >
      {acimaDoLimite ? (
        <AvisoLimite>
          O agrupamento por {ROTULO_AGRUPAMENTO[f.agrupamento]} aceita até {numero(limite)} dias e o período tem {numero(n)}. Escolha o agrupamento por semana ou mês neste bloco (o período não é cortado).
        </AvisoLimite>
      ) : (
        <EstadoConsulta consulta={a} altura={260} vazio={semValor ? 'Sem dias completos no período: nada a exibir (sem dados não é zero).' : null}>
          <Legenda
            itens={series}
            notas={[
              ...notasDasMarcas(dados),
              ...(f.agrupamento !== 'dia' && metrica !== 'ticket' ? ['valores = média por dia completo do agrupamento'] : []),
              ...(refAcima ? [`referência acima de ${numero(limite)} dias: não exibida`] : []),
            ]}
          />
          {b.status === 'erro' && <div className={`${s.aviso} ${s.avisoAt}`}>Referência indisponível: {b.erro}</div>}
          <GraficoLinhas
            dados={dados}
            series={series}
            formatoEixo={fmtEixo}
            formatoValor={fmtValor}
            altura={240}
            titulo={(p) => p.rotuloA || p.rotulo}
            conteudoDica={conteudoDica}
            rotuloAcessivel={`Evolução de ${def.rotulo.toLowerCase()} por ${ROTULO_AGRUPAMENTO[f.agrupamento]}`}
          />
        </EstadoConsulta>
      )}
    </Bloco>
  );
}

export function MediaDiaSemana() {
  const { cliente } = useBi();
  const f = useFiltrosDoBloco('semana');
  const [refVisivel, visivel] = useVisivel();
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const ref = periodoReferencia({ de: f.de, ate: f.ate }, f.referencia, { atalho: f.atalho, livre: f.referenciaLivre });
  const argsA = n > 0 && n <= LIMITES.geral ? { de: f.de, ate: f.ate, dias: f.dias } : null;
  const argsB = argsA && ref && diasNoIntervalo(ref.de, ref.ate) <= LIMITES.geral ? { de: ref.de, ate: ref.ate, dias: f.dias } : null;
  const a = useConsulta(cliente, 'horarios', visivel ? argsA : null);
  const b = useConsulta(cliente, 'horarios', visivel ? argsB : null);
  useRegistroExportacao('semana', {
    filtros: f,
    ref: argsB ? ref : null,
    parametros: {},
    consultas: { a: argsA && { tipo: 'horarios', args: argsA }, b: argsB && { tipo: 'horarios', args: argsB } },
    indisponivel: n > LIMITES.geral ? `Período acima de ${numero(LIMITES.geral)} dias.` : null,
  });
  const ha = a.status === 'ok' ? analisarHorarios(a.dados) : null;
  const hb = b.status === 'ok' ? analisarHorarios(b.dados) : null;
  const dados = ha ? ha.diaSemana.map((d, i) => ({ rotulo: d.rotulo, dow: d.dow, a: d.media, b: hb ? hb.diaSemana[i].media : null, diasA: d.dias, diasB: hb ? hb.diaSemana[i].dias : 0 })) : [];
  const foraFiltro = (dow) => f.dias.length < 7 && !f.dias.includes(dow);
  const subDia = (dow, dias) => (foraFiltro(dow) ? 'fora do filtro de dias da semana' : dias ? `média de ${plural(dias, 'dia completo', 'dias completos')}` : 'nenhum dia completo: sem dados (não é zero)');
  const conteudoDica = (p) => (
    <>
      <b className={s.ttTitulo}>{NOMES_DIA[p.dow]}</b>
      <LinhaDica cor={COR_SERIE_A} rotulo={`A · ${intervaloCurto(f.de, f.ate)}`} valor={p.a === null ? 'sem dados' : moeda(p.a)} sub={subDia(p.dow, p.diasA)} />
      {hb && <LinhaDica cor={COR_SERIE_B} rotulo={`B · ${intervaloCurto(ref.de, ref.ate)}`} valor={p.b === null ? 'sem dados' : moeda(p.b)} sub={subDia(p.dow, p.diasB)} />}
      {hb && <ComparacaoDica a={p.a} b={p.b} formato={moeda} invalida={foraFiltro(p.dow) ? 'dia fora do filtro' : null} />}
    </>
  );
  const series = [{ chave: 'a', nome: `A · ${intervaloCurto(f.de, f.ate)}`, cor: COR_SERIE_A, tipo: 'barra' }];
  if (hb) series.push({ chave: 'b', nome: `B · ${intervaloCurto(ref.de, ref.ate)}`, cor: COR_SERIE_B, tipo: 'barra' });
  const semValor = ha && !dados.some((d) => d.a !== null);
  return (
    <Bloco
      nome="semana"
      titulo="Média diária por dia da semana"
      largura="s4"
      refVisivel={refVisivel}
      rodape={
        <>
          <span>Faturamento bruto médio por dia completo</span>
          <span>{nomeDosDias(f.dias)}</span>
          {ha && <span>{plural(ha.diasConsiderados, 'dia completo', 'dias completos')}</span>}
        </>
      }
    >
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias. Escolha um período menor neste bloco.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={a} altura={260} vazio={semValor ? 'Sem dias completos no período.' : null}>
          <Legenda itens={series} />
          <GraficoColunas
            dados={dados}
            series={series}
            formatoEixo={moedaEixo}
            formatoValor={moeda}
            altura={240}
            titulo={(p) => `${p.rotulo}${p.diasA ? ` · ${plural(p.diasA, 'dia')}` : ''}`}
            conteudoDica={conteudoDica}
            rotuloAcessivel="Faturamento médio por dia da semana"
          />
        </EstadoConsulta>
      )}
    </Bloco>
  );
}
