import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CORES_MARCA, COR_GRADE, COR_TEXTO_EIXO, ROTULO_MARCA } from '../../lib/bi/cores';
import { MOTIVO_PONTO, compararValores } from '../../lib/bi/modelos';
import { variacao } from '../../lib/bi/formatos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

// Gráficos do BI sobre Recharts (versão fixada 2.15.4). Convenções do
// mockup aprovado: um único eixo Y, linhas de 2px, barras finas com ponta
// arredondada, grade discreta, tooltip por ponto. Ausência de dado = lacuna
// (connectNulls=false), nunca zero. Cada situação de dia fora das médias
// (parcial, cobertura não confirmada, sem importação, sem operação) tem
// faixa de fundo e legenda próprias.

const ESTILO_EIXO = { fontSize: 11, fill: COR_TEXTO_EIXO };

function passoDosRotulos(n, largura = 640) {
  const cabem = Math.max(2, Math.floor((largura - 70) / 64));
  return Math.max(1, Math.ceil(n / cabem));
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

// Uma linha do tooltip: amostra de cor + rótulo à esquerda, valor à direita,
// e uma linha secundária opcional (situação da cobertura, período...).
export function LinhaDica({ cor, tracejado, rotulo, valor, sub, forte = true }) {
  return (
    <div>
      <div className={s.ttLinha}>
        <span>
          {cor && <span className={s.sw} style={tracejado ? { background: 'transparent', border: `2px dashed ${cor}`, width: 10, height: 2, borderRadius: 0, verticalAlign: 3 } : { background: cor }} />}
          {rotulo}
        </span>
        {forte ? <b>{valor}</b> : <span>{valor}</span>}
      </div>
      {sub && <div className={s.ttSub}>{sub}</div>}
    </div>
  );
}

// Diferença absoluta e variação percentual de A × B, só quando os dois
// valores são válidos. Caso contrário, o motivo (nunca uma variação falsa).
// apenasDiferenca: para participações (%), onde só a diferença em pontos
// percentuais faz sentido.
export function ComparacaoDica({ a, b, formato, formatoDiferenca, bomQuandoSobe = true, invalida = null, apenasDiferenca = false }) {
  if (invalida) {
    return (
      <>
        <div className={s.ttSep} />
        <div className={s.ttAviso}>Comparação indisponível: {invalida}</div>
      </>
    );
  }
  const c = compararValores(a, b);
  const fmtDif = formatoDiferenca || ((v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formato(Math.abs(v))}`);
  const v = c.variacao === null ? null : variacao(c.variacao);
  return (
    <>
      <div className={s.ttSep} />
      {c.diferenca === null ? (
        <div className={s.ttAviso}>Comparação indisponível: {MOTIVO_PONTO[c.motivo]}</div>
      ) : (
        <>
          <LinhaDica rotulo="Diferença (A − B)" valor={fmtDif(c.diferenca)} forte={false} />
          {!apenasDiferenca && (
          <LinhaDica
            rotulo="Variação"
            forte={false}
            valor={
              v ? (
                <span className={cx(s.var, !bomQuandoSobe ? s.varNeutra : v.sentido === 'sobe' ? s.varSobe : v.sentido === 'desce' ? s.varDesce : s.varNeutra)}>{v.texto}</span>
              ) : (
                <span className={s.ttAviso}>{MOTIVO_PONTO[c.motivo] || '—'}</span>
              )
            }
          />
          )}
        </>
      )}
    </>
  );
}

function DicaPadrao({ ponto, titulo, series, formatoValor }) {
  return (
    <>
      <b className={s.ttTitulo}>{titulo ? titulo(ponto) : ponto.rotulo}</b>
      {series.map((serie) => {
        const v = ponto[serie.chave];
        return (
          <LinhaDica
            key={serie.chave}
            cor={serie.cor}
            tracejado={serie.tracejado}
            rotulo={`${serie.nome}${serie.rotuloPonto && serie.rotuloPonto(ponto) ? ` (${serie.rotuloPonto(ponto)})` : ''}`}
            valor={v === null || v === undefined ? 'sem dados' : formatoValor(v)}
          />
        );
      })}
    </>
  );
}

// conteudo(ponto) -> nó do tooltip (detalhado por gráfico); sem ele, o
// tooltip padrão (título + valor de cada série).
function Dica({ active, payload, titulo, series, formatoValor, conteudo }) {
  if (!active || !payload || !payload.length) return null;
  const ponto = payload[0].payload;
  return <div className={s.tt}>{conteudo ? conteudo(ponto) : <DicaPadrao ponto={ponto} titulo={titulo} series={series} formatoValor={formatoValor} />}</div>;
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

// dados: [{ indice, rotulo, marca?, [serie.chave]: valor|null }]
export function GraficoLinhas({ dados, series, formatoEixo, formatoValor, altura = 240, titulo, conteudoDica, rotuloAcessivel }) {
  const n = dados.length;
  const passo = passoDosRotulos(n);
  const ticks = useMemo(() => {
    const t = [];
    for (let i = 0; i < n; i += passo) t.push(i);
    if (n > 1 && t[t.length - 1] !== n - 1) t.push(n - 1);
    return t;
  }, [n, passo]);
  const faixas = dados.filter((d) => d.marca && CORES_MARCA[d.marca]);
  const comPontos = n <= 40;
  return (
    <div className={s.grafico} style={{ height: altura }} role="img" aria-label={rotuloAcessivel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COR_GRADE} vertical={false} />
          {faixas.map((f) => (
            <ReferenceArea
              key={`f${f.indice}`}
              x1={f.indice - 0.5}
              x2={f.indice + 0.5}
              fill={CORES_MARCA[f.marca]}
              fillOpacity={f.marca === 'parcial' ? 0.6 : 0.9}
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            dataKey="indice"
            type="number"
            domain={n > 1 ? [-0.5, n - 0.5] : [-1, 1]}
            ticks={ticks}
            tickFormatter={(i) => (dados[i] ? dados[i].rotulo : '')}
            tick={ESTILO_EIXO}
            tickLine={false}
            axisLine={{ stroke: '#c9d4c7' }}
            allowDecimals={false}
            interval={0}
          />
          <YAxis tickFormatter={formatoEixo} tick={ESTILO_EIXO} tickLine={false} axisLine={false} width={78} />
          <Tooltip content={<Dica titulo={titulo} series={series} formatoValor={formatoValor} conteudo={conteudoDica} />} cursor={{ stroke: '#9aa7a4' }} isAnimationActive={false} />
          {series.map((serie) => (
            <Line
              key={serie.chave}
              dataKey={serie.chave}
              name={serie.nome}
              stroke={serie.cor}
              strokeWidth={2}
              strokeDasharray={serie.tracejado ? '5 4' : undefined}
              dot={comPontos && !serie.tracejado ? { r: 2.5, fill: serie.cor, stroke: serie.cor } : false}
              activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------

// dados: [{ rotulo, [serie.chave]: valor|null }]
export function GraficoColunas({ dados, series, formatoEixo, formatoValor, altura = 240, titulo, conteudoDica, rotuloAcessivel }) {
  return (
    <div className={s.grafico} style={{ height: altura }} role="img" aria-label={rotuloAcessivel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={COR_GRADE} vertical={false} />
          <XAxis dataKey="rotulo" tick={ESTILO_EIXO} tickLine={false} axisLine={{ stroke: '#c9d4c7' }} interval="preserveStartEnd" />
          <YAxis tickFormatter={formatoEixo} tick={ESTILO_EIXO} tickLine={false} axisLine={false} width={74} />
          <Tooltip content={<Dica titulo={titulo} series={series} formatoValor={formatoValor} conteudo={conteudoDica} />} cursor={{ fill: 'rgba(14,61,58,0.05)' }} isAnimationActive={false} />
          {series.map((serie) => (
            <Bar key={serie.chave} dataKey={serie.chave} name={serie.nome} fill={serie.cor} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rosca (participação)
// ---------------------------------------------------------------------------

// itens: [{ chave, nome, valor (R$ original), proporcao, cor, sub? }]
// As fatias usam o valor monetário original (sem arredondamento).
export function GraficoRosca({ itens, centro, formatoValor, formatoProporcao, rotuloAcessivel, tamanho = 176 }) {
  const dados = itens.filter((i) => i.valor !== null && i.valor !== undefined && i.valor > 0);
  return (
    <div className={s.rosca} style={{ width: tamanho, height: tamanho }} role="img" aria-label={rotuloAcessivel}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius="66%" outerRadius="98%" paddingAngle={dados.length > 1 ? 1 : 0} startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={1} isAnimationActive={false}>
            {dados.map((i) => (
              <Cell key={i.chave} fill={i.cor} />
            ))}
          </Pie>
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const i = payload[0].payload;
              return (
                <div className={s.tt}>
                  <b className={s.ttTitulo}>{i.nome}</b>
                  <LinhaDica cor={i.cor} rotulo="Faturamento bruto" valor={formatoValor(i.valor)} />
                  <LinhaDica rotulo="Participação" valor={formatoProporcao(i.proporcao)} />
                  {i.sub && <div className={s.ttSub}>{i.sub}</div>}
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {centro && <div className={s.roscaCentro}>{centro}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minigráfico e legenda
// ---------------------------------------------------------------------------

// Minigráfico dos cartões (sem eixos). Lacunas preservadas.
export function Minigrafico({ valores, cor = '#00897a' }) {
  const dados = (valores || []).map((v, i) => ({ i, v }));
  if (dados.filter((d) => d.v !== null && d.v !== undefined).length < 2) return null;
  return (
    <div className={s.spark} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <XAxis hide dataKey="i" type="number" domain={['dataMin', 'dataMax']} />
          <Line dataKey="v" stroke={cor} strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Notas de situação presentes nos dados (uma por marca, na ordem fixa).
export function notasDasMarcas(dados) {
  const presentes = new Set((dados || []).map((d) => d.marca).filter(Boolean));
  return ['parcial', 'nc', 'lacuna', 'semop'].filter((m) => presentes.has(m)).map((m) => ({ chave: `m-${m}`, texto: ROTULO_MARCA[m], cor: CORES_MARCA[m] }));
}

export function Legenda({ itens, notas = [] }) {
  return (
    <div className={s.legenda}>
      {itens.map((i) => (
        <span key={i.chave || i.nome}>
          <i className={i.tipo === 'barra' ? s.legBarra : i.tracejado ? s.legTracejada : undefined} style={i.tracejado ? undefined : { background: i.cor }} />
          {i.nome}
        </span>
      ))}
      {notas.map((n) =>
        typeof n === 'string' ? (
          <span key={n}>{n}</span>
        ) : (
          <span key={n.chave}>
            <i className={n.cor ? s.legSituacao : s.legFaixa} style={n.cor ? { background: n.cor } : undefined} />
            {n.texto}
          </span>
        )
      )}
    </div>
  );
}
