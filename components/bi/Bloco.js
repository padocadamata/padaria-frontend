import { useEffect, useId, useRef, useState } from 'react';
import { useBi } from './contexto';
import { CAMPOS_DO_BLOCO, AGRUPAMENTOS, alternarDia, filtrosEfetivos } from '../../lib/bi/filtros';
import { LETRA_DIA, NOMES_DIA, REFERENCIAS, TODOS_OS_DIAS, dataValida } from '../../lib/bi/datas';
import { ROTULO_AGRUPAMENTO, intervaloCurto, nomeDosDias } from '../../lib/bi/formatos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

const ROTULO_REF = Object.fromEntries(REFERENCIAS.map((r) => [r.valor, r.rotulo.replace(/^vs\. /, '')]));

// Filtros efetivos do bloco (gerais + próprios).
export function useFiltrosDoBloco(nome) {
  const { geral, blocos } = useBi();
  return filtrosEfetivos(geral, blocos, nome);
}

function SeloEscopo({ nome, efetivo }) {
  const { blocos, definirBloco } = useBi();
  const o = blocos[nome] || {};
  if (!efetivo.proprios.length) {
    return (
      <span className={cx(s.badge, s.badgeHerda)} title="Este bloco usa os filtros gerais">
        Filtros gerais
      </span>
    );
  }
  const partes = [];
  if (o.periodo) partes.push(intervaloCurto(o.periodo.de, o.periodo.ate));
  if (o.dias) partes.push(nomeDosDias(o.dias));
  if (o.agrupamento) partes.push(`por ${ROTULO_AGRUPAMENTO[o.agrupamento]}`);
  if (o.referencia) partes.push(o.referencia === 'nenhuma' ? 'sem comparação' : `comparação: ${ROTULO_REF[o.referencia]}`);
  return (
    <span className={cx(s.badge, s.badgeProprio)} title="Este bloco substitui os filtros gerais">
      Filtro próprio: {partes.join(' · ')}{' '}
      <button type="button" onClick={() => definirBloco(nome, null)} title="Voltar a herdar os filtros gerais">
        ⟲ restaurar
      </button>
    </span>
  );
}

function PainelFiltros({ nome, efetivo, aoFechar }) {
  const { geral, blocos, definirBloco } = useBi();
  const campos = CAMPOS_DO_BLOCO[nome] || [];
  const o = blocos[nome] || {};
  const [rascunho, setRascunho] = useState(() => ({
    periodo: o.periodo || null,
    de: efetivo.de,
    ate: efetivo.ate,
    dias: o.dias || null,
    diasValor: efetivo.dias,
    agrupamento: o.agrupamento || null,
    agrupamentoValor: efetivo.agrupamento,
    referencia: o.referencia || null,
    referenciaValor: efetivo.referencia,
    livreDe: (o.referenciaLivre && o.referenciaLivre.de) || geral.refDe || efetivo.de,
    livreAte: (o.referenciaLivre && o.referenciaLivre.ate) || geral.refAte || efetivo.ate,
  }));
  const id = useId();
  const ref = useRef(null);

  useEffect(() => {
    const fechar = (ev) => {
      if (ev.key === 'Escape') aoFechar();
    };
    document.addEventListener('keydown', fechar);
    ref.current?.querySelector('input,button,select')?.focus();
    return () => document.removeEventListener('keydown', fechar);
  }, [aoFechar]);

  const herdaOuProprio = (campo, rotuloHerdar, proprio, setProprio) => (
    <div className={s.op}>
      <label>
        <input type="radio" name={`${id}-${campo}`} checked={!proprio} onChange={() => setProprio(false)} /> {rotuloHerdar}
      </label>
      <label>
        <input type="radio" name={`${id}-${campo}`} checked={!!proprio} onChange={() => setProprio(true)} /> Próprio
      </label>
    </div>
  );

  const periodoOk = dataValida(rascunho.de) && dataValida(rascunho.ate) && rascunho.de <= rascunho.ate;
  const livreOk = dataValida(rascunho.livreDe) && dataValida(rascunho.livreAte) && rascunho.livreDe <= rascunho.livreAte;

  const aplicar = () => {
    const proprio = {};
    if (rascunho.periodo && periodoOk) proprio.periodo = { de: rascunho.de, ate: rascunho.ate };
    if (rascunho.dias) proprio.dias = rascunho.diasValor;
    if (rascunho.agrupamento) proprio.agrupamento = rascunho.agrupamentoValor;
    if (rascunho.referencia) {
      proprio.referencia = rascunho.referenciaValor;
      if (rascunho.referenciaValor === 'livre' && livreOk) proprio.referenciaLivre = { de: rascunho.livreDe, ate: rascunho.livreAte };
    }
    definirBloco(nome, proprio);
    aoFechar();
  };

  return (
    <div className={s.pop} role="dialog" aria-label="Filtros deste bloco" ref={ref}>
      <h3>Filtros deste bloco</h3>
      {campos.includes('periodo') && (
        <div className={s.popLinha}>
          <span className={s.rot}>Período</span>
          {herdaOuProprio('periodo', `Herdar (${intervaloCurto(geral.de, geral.ate)})`, rascunho.periodo, (p) => setRascunho((r) => ({ ...r, periodo: p })))}
          <div className={s.datas}>
            <input
              className={s.controle}
              type="date"
              value={rascunho.de || ''}
              aria-label="Data inicial do bloco"
              onChange={(e) => setRascunho((r) => ({ ...r, de: e.target.value, periodo: true }))}
            />
            –
            <input
              className={s.controle}
              type="date"
              value={rascunho.ate || ''}
              aria-label="Data final do bloco"
              onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value, periodo: true }))}
            />
          </div>
          {rascunho.periodo && !periodoOk && <span className={s.critAviso}>Informe um período válido.</span>}
        </div>
      )}
      {campos.includes('dias') && (
        <div className={s.popLinha}>
          <span className={s.rot}>Dias da semana</span>
          {herdaOuProprio('dias', `Herdar (${nomeDosDias(geral.dias)})`, rascunho.dias, (p) => setRascunho((r) => ({ ...r, dias: p })))}
          <div className={s.chips}>
            {TODOS_OS_DIAS.map((d) => (
              <button
                key={d}
                type="button"
                className={s.chip}
                aria-pressed={rascunho.diasValor.includes(d)}
                title={NOMES_DIA[d]}
                onClick={() => setRascunho((r) => ({ ...r, dias: true, diasValor: alternarDia(r.diasValor, d) }))}
              >
                {LETRA_DIA[d]}
              </button>
            ))}
          </div>
        </div>
      )}
      {campos.includes('agrupamento') && (
        <div className={s.popLinha}>
          <span className={s.rot}>Agrupamento</span>
          {herdaOuProprio('agrupamento', `Herdar (${ROTULO_AGRUPAMENTO[geral.agrupamento]})`, rascunho.agrupamento, (p) => setRascunho((r) => ({ ...r, agrupamento: p })))}
          <div className={cx(s.seg, s.segPequeno)}>
            {AGRUPAMENTOS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={rascunho.agrupamentoValor === a}
                onClick={() => setRascunho((r) => ({ ...r, agrupamento: true, agrupamentoValor: a }))}
              >
                {ROTULO_AGRUPAMENTO[a]}
              </button>
            ))}
          </div>
        </div>
      )}
      {campos.includes('referencia') && (
        <div className={s.popLinha}>
          <span className={s.rot}>Comparação</span>
          {herdaOuProprio('referencia', 'Herdar', rascunho.referencia, (p) => setRascunho((r) => ({ ...r, referencia: p })))}
          <select
            className={cx(s.controle, s.controlePequeno)}
            value={rascunho.referenciaValor}
            aria-label="Referência de comparação do bloco"
            onChange={(e) => setRascunho((r) => ({ ...r, referencia: true, referenciaValor: e.target.value }))}
          >
            {REFERENCIAS.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.rotulo}
              </option>
            ))}
          </select>
          {rascunho.referenciaValor === 'livre' && (
            <div className={s.datas}>
              <input className={s.controle} type="date" value={rascunho.livreDe || ''} aria-label="Referência: data inicial" onChange={(e) => setRascunho((r) => ({ ...r, referencia: true, livreDe: e.target.value }))} />–
              <input className={s.controle} type="date" value={rascunho.livreAte || ''} aria-label="Referência: data final" onChange={(e) => setRascunho((r) => ({ ...r, referencia: true, livreAte: e.target.value }))} />
            </div>
          )}
        </div>
      )}
      <div className={s.popRodape}>
        <button
          className={s.btn}
          type="button"
          onClick={() => {
            definirBloco(nome, null);
            aoFechar();
          }}
        >
          ⟲ Restaurar filtros gerais
        </button>
        <button className={cx(s.btn, s.btnPrim)} type="button" onClick={aplicar} disabled={!!rascunho.periodo && !periodoOk}>
          Aplicar
        </button>
      </div>
    </div>
  );
}

// Cartão de um bloco do painel. `refVisivel` liga o carregamento sob demanda.
export default function Bloco({ nome, titulo, largura = 's12', acoes, rodape, children, refVisivel, semFiltros = false }) {
  const efetivo = useFiltrosDoBloco(nome);
  const [aberto, setAberto] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (ev) => {
      if (cardRef.current && !cardRef.current.contains(ev.target)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  return (
    <article
      className={cx(s.card, s[largura])}
      data-bloco={nome}
      ref={(el) => {
        cardRef.current = el;
        if (refVisivel) refVisivel.current = el;
      }}
    >
      <div className={s.cardH}>
        <h2>{titulo}</h2>
        {!semFiltros && <SeloEscopo nome={nome} efetivo={efetivo} />}
        <div className={s.acoes}>
          {acoes}
          {!semFiltros && (
            <button
              type="button"
              className={s.icone}
              aria-expanded={aberto}
              aria-label={`Filtros do bloco ${titulo}`}
              title="Filtros deste bloco"
              onClick={() => setAberto((a) => !a)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {aberto && <PainelFiltros nome={nome} efetivo={efetivo} aoFechar={() => setAberto(false)} />}
      <div className={s.cardB}>{children}</div>
      {rodape && <div className={s.cardF}>{rodape}</div>}
    </article>
  );
}

// Estados padronizados de uma consulta dentro do bloco.
export function EstadoConsulta({ consulta, altura = 200, vazio = null, children }) {
  if (consulta.status === 'inativo' || consulta.status === 'carregando') {
    return <div className={s.esqueleto} style={{ height: altura }} aria-busy="true" aria-label="Carregando" />;
  }
  if (consulta.status === 'erro') {
    return (
      <div className={cx(s.aviso, s.avisoErro)} role="alert">
        <span>{consulta.erro}</span>
        <button type="button" className={s.btnLink} onClick={consulta.tentarDeNovo}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (vazio) return <p className={s.vazio}>{vazio}</p>;
  return children;
}

export function AvisoLimite({ children }) {
  return <div className={cx(s.aviso, s.avisoAt)}>⚠ <span>{children}</span></div>;
}
