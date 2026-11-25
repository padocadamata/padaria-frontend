import { useEffect, useMemo, useRef, useState } from 'react';
import Bloco, { AvisoLimite, EstadoConsulta, useFiltrosDoBloco } from './Bloco';
import { GraficoLinhas, GraficoRosca, Legenda, LinhaDica } from './Graficos';
import { useBi } from './contexto';
import DataTable from '../ui/DataTable';
import Paginacao from '../Paginacao';
import { useConsulta, useVisivel } from '../../lib/bi/useConsulta';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';
import { LIMITES, diasNoIntervalo } from '../../lib/bi/datas';
import { MAX_SELECIONADOS, RANKING_TOPS, TAMANHOS_PAGINA } from '../../lib/bi/filtros';
import { ORDENS_RANKING, juntarSeries, rotuloGrupo, segmentosParticipacao, situacaoDoGrupo } from '../../lib/bi/modelos';
import { COR_DEMAIS, PALETA_PRODUTOS, coresParticipacao } from '../../lib/bi/cores';
import { mediaPorDia, montarExportacaoProdutos } from '../../lib/bi/exportacao';
import { exportarRelatorio } from '../../lib/exportacao/exportar';
import { AVISO_PERIODO, MOTIVO_PERIODO, ROTULO_AGRUPAMENTO, dataComDia, intervalo, moeda, moedaEixo, nomeDosDias, numero, numeroEixo, percentual, plural, quantidade } from '../../lib/bi/formatos';
import { cx } from '../../lib/design/cx';
import s from './bi.module.css';

const valido = (f) => !!(f.de && f.ate && f.de <= f.ate);
const fmtPorTipo = { moeda, quantidade, numero };

function AvisoSelecao() {
  return (
    <div className={s.aviso}>
      ⓘ{' '}
      <span>
        Marque até {MAX_SELECIONADOS} produtos para usá-los na evolução, nos horários e nos comparativos. A seleção <b>não</b> filtra os indicadores financeiros gerais.
      </span>
    </div>
  );
}

function CaixaSelecao({ produto }) {
  const { selecionados, alternarSelecionado } = useBi();
  const marcado = selecionados.includes(produto.codigo);
  const cheio = !marcado && selecionados.length >= MAX_SELECIONADOS;
  return (
    <input
      type="checkbox"
      className={s.cb}
      checked={marcado}
      disabled={cheio}
      title={cheio ? `Máximo de ${MAX_SELECIONADOS} produtos` : undefined}
      aria-label={`Selecionar ${produto.descricao} (código ${produto.codigo})`}
      onChange={() => alternarSelecionado(produto.codigo, produto.descricao)}
    />
  );
}

function rodapeCobertura(resp) {
  if (!resp || !resp.cobertura) return null;
  return `${plural(resp.cobertura.dias_validos, 'dia completo', 'dias completos')} · ${plural(resp.cobertura.dias_com_dados, 'dia com dados', 'dias com dados')} (base itens)`;
}

function AvisosProdutos({ resp }) {
  if (!resp) return null;
  if (resp.motivo) return <p className={s.vazio}>{MOTIVO_PERIODO[resp.motivo] || 'Período sem dados.'}</p>;
  const avisos = (resp.avisos || []).filter((a) => ['contem_dia_parcial', 'contem_dia_com_pendencias', 'contem_dia_sem_conciliacao'].includes(a));
  if (!avisos.length) return null;
  return (
    <div className={cx(s.aviso, s.avisoAt)}>
      ⚠ <span>{avisos.map((a) => AVISO_PERIODO[a]).join(' ')} Os totais de produtos incluem os dias com dados; o ranking não usa médias.</span>
    </div>
  );
}

export function RankingProdutos() {
  const { cliente, selecionados, cores, lembrarDescricoes, rankingTop, definirPreferencia } = useBi();
  const f = useFiltrosDoBloco('ranking');
  const [refVisivel, visivel] = useVisivel();
  const [ordem, setOrdem] = useState('bruto');
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const ativo = visivel && n > 0 && n <= LIMITES.geral;
  // A RPC ordena TODO o conjunto elegível e só então aplica o limite (Top N).
  const c = useConsulta(cliente, 'produtos', ativo ? { de: f.de, ate: f.ate, ordem, direcao: 'desc', limite: rankingTop, deslocamento: 0, dias: f.dias } : null);
  const resp = c.status === 'ok' ? c.dados : null;
  useEffect(() => {
    if (resp && resp.produtos) lembrarDescricoes(resp.produtos);
  }, [resp, lembrarDescricoes]);
  const def = ORDENS_RANKING[ordem];
  const lista = resp ? resp.produtos : [];
  const maximo = lista.length ? Math.max(...lista.map((p) => Number(p[def.campo]) || 0)) : 0;
  const fmt = fmtPorTipo[def.tipo];
  return (
    <Bloco
      nome="ranking"
      titulo="Ranking de produtos"
      largura="s7"
      refVisivel={refVisivel}
      acoes={
        <>
          <div className={cx(s.seg, s.segPequeno)} role="group" aria-label="Ordenar ranking por">
            {Object.entries(ORDENS_RANKING).map(([k, o]) => (
              <button key={k} type="button" aria-pressed={ordem === k} onClick={() => setOrdem(k)}>
                {o.rotulo}
              </button>
            ))}
          </div>
          <select className={cx(s.controle, s.controlePequeno)} value={rankingTop} aria-label="Quantidade de produtos exibidos no ranking" title="Quantidade exibida (o ranking considera todos os produtos elegíveis)" onChange={(e) => definirPreferencia('rankingTop', Number(e.target.value))}>
            {RANKING_TOPS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </>
      }
      rodape={
        <>
          <span>Top {rankingTop} · {intervalo(f.de, f.ate)}</span>
          <span>{nomeDosDias(f.dias)}</span>
          {resp && <span>{rodapeCobertura(resp)}</span>}
          <span>códigos G3 separados (descrições iguais não são somadas)</span>
        </>
      }
    >
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias. Escolha um período menor neste bloco.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={c} altura={300} vazio={resp && !resp.motivo && lista.length === 0 ? 'Nenhum produto vendido (vendas conciliadas) no período.' : null}>
          <AvisosProdutos resp={resp} />
          {lista.length > 0 && (
            <div className={s.rolagemX}>
              <table className={s.tabela}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }} aria-label="Selecionar" />
                    <th>#</th>
                    <th>Produto</th>
                    <th className={s.colBarra} style={{ width: '32%' }} aria-hidden="true" />
                    <th className={s.n}>{def.rotulo}</th>
                    <th className={s.n}>Part.</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p, i) => {
                    const sel = selecionados.includes(p.codigo);
                    const v = Number(p[def.campo]) || 0;
                    return (
                      <tr key={p.codigo} className={sel ? s.sel : undefined}>
                        <td>
                          <CaixaSelecao produto={p} />
                        </td>
                        <td className={s.cod}>{i + 1}</td>
                        <td>
                          {p.descricao} <span className={s.cod}>cód. {p.codigo}</span>
                          {p.descricao_compartilhada && <span className={s.cod} title="Outra descrição igual existe com outro código G3"> · descrição em mais de um código</span>}
                        </td>
                        <td className={s.colBarra} aria-hidden="true">
                          <span className={s.barraMini} style={{ width: `${maximo ? (v / maximo) * 100 : 0}%`, background: sel ? cores[p.codigo] : PALETA_PRODUTOS[0], opacity: sel ? 1 : 0.55 }} />
                        </td>
                        <td className={s.n}>{fmt(p[def.campo])}</td>
                        <td className={s.n}>{percentual(p.participacao)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <AvisoSelecao />
        </EstadoConsulta>
      )}
    </Bloco>
  );
}

export function ParticipacaoFaturamento() {
  const { cliente, cores } = useBi();
  const f = useFiltrosDoBloco('participacao');
  const [refVisivel, visivel] = useVisivel();
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const ativo = visivel && n > 0 && n <= LIMITES.geral;
  // Mesma consulta do ranking padrão por faturamento (reaproveitada pelo cache).
  const c = useConsulta(cliente, 'produtos', ativo ? { de: f.de, ate: f.ate, ordem: 'bruto', direcao: 'desc', limite: 10, deslocamento: 0, dias: f.dias } : null);
  const seg = c.status === 'ok' ? segmentosParticipacao(c.dados, 5) : null;
  // Selecionado = a cor dele (igual nos demais gráficos); não selecionado =
  // tom secundário. O denominador NUNCA muda com a seleção.
  const corDe = seg ? coresParticipacao(seg.top.map((p) => p.codigo), cores) : {};
  const itens = seg
    ? [
        ...seg.top.map((p) => ({
          chave: p.codigo,
          nome: `${p.descricao} (${p.codigo})`,
          descricao: p.descricao,
          valor: p.bruto,
          proporcao: p.participacao,
          cor: corDe[p.codigo],
          selecionado: !!cores[p.codigo],
          sub: cores[p.codigo] ? 'produto selecionado' : null,
        })),
        ...(seg.demais ? [{ chave: 'demais', nome: `Demais ${plural(seg.demais.quantidade, 'código')}`, valor: seg.demais.bruto, proporcao: seg.demais.participacao, cor: COR_DEMAIS, sub: 'soma dos demais códigos G3 do período' }] : []),
      ]
    : [];
  const semTotal = seg && (seg.bruto === null || seg.bruto === undefined);
  return (
    <Bloco
      nome="participacao"
      titulo="Participação no faturamento"
      largura="s5"
      refVisivel={refVisivel}
      rodape={
        <>
          <span>Denominador: faturamento bruto de todos os itens conciliados do período</span>
          {c.status === 'ok' && <span>{rodapeCobertura(c.dados)}</span>}
        </>
      }
    >
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={c} altura={240} vazio={c.status === 'ok' && (!seg || !seg.top.length || semTotal) ? 'Sem produtos (itens conciliados) no período: sem dados, não é zero.' : null}>
          {/* Rosca centralizada no alto; legenda embaixo, uma linha por produto
              (identificação · valor · participação), com a largura do quadro. */}
          <div className={s.participacao}>
            <GraficoRosca
              itens={itens}
              tamanho={232}
              formatoValor={moeda}
              formatoProporcao={(v) => percentual(v, 2)}
              rotuloAcessivel="Participação no faturamento: 5 maiores produtos e demais"
              centro={
                seg && seg.bruto !== null ? (
                  <>
                    <span>Total do período</span>
                    <b>{moeda(seg.bruto)}</b>
                    <span>itens conciliados</span>
                  </>
                ) : null
              }
            />
            <table className={cx(s.tabela, s.legendaParticipacao)}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className={s.n}>Faturamento</th>
                  <th className={s.n}>Part.</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.chave} className={i.selecionado ? s.sel : undefined}>
                    <td>
                      <span className={s.legCor} style={{ background: i.cor, width: 10, height: 10, borderRadius: 3, marginRight: 8, display: 'inline-block' }} />
                      {i.chave === 'demais' ? (
                        i.nome
                      ) : (
                        <>
                          {i.descricao} <span className={s.cod}>cód. {i.chave}</span>
                          {i.selecionado && <span className={s.cod}> · selecionado</span>}
                        </>
                      )}
                    </td>
                    <td className={s.n}>{moeda(i.valor)}</td>
                    <td className={s.n}>
                      <b>{percentual(i.proporcao)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </EstadoConsulta>
      )}
    </Bloco>
  );
}

// Busca de produto por código ou descrição (qualquer código G3 vendido no
// período, independente do ranking).
export function BuscaProduto({ de, ate, dias, aoEscolher, excluir = [] }) {
  const { cliente } = useBi();
  const [texto, setTexto] = useState('');
  const [aberta, setAberta] = useState(false);
  const caixa = useRef(null);
  const busca = texto.trim();
  const c = useConsulta(cliente, 'produtos', aberta && busca.length >= 2 && de && ate ? { de, ate, busca, ordem: 'bruto', direcao: 'desc', limite: 8, deslocamento: 0, dias } : null);
  useEffect(() => {
    const fora = (e) => {
      if (caixa.current && !caixa.current.contains(e.target)) setAberta(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  const opcoes = c.status === 'ok' && c.dados && c.dados.produtos ? c.dados.produtos.filter((p) => !excluir.includes(p.codigo)) : [];
  return (
    <div className={s.busca} ref={caixa}>
      <input
        type="search"
        className={cx(s.controle, s.controlePequeno)}
        placeholder="+ Adicionar por código ou descrição"
        aria-label="Adicionar produto por código ou descrição"
        value={texto}
        onFocus={() => setAberta(true)}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberta(true);
        }}
      />
      {aberta && busca.length >= 2 && (
        <ul className={s.buscaLista} role="listbox">
          {c.status === 'carregando' && <li className={s.cod} style={{ padding: '6px 10px' }}>Buscando…</li>}
          {c.status === 'erro' && <li className={s.cod} style={{ padding: '6px 10px' }}>{c.erro}</li>}
          {c.status === 'ok' && opcoes.length === 0 && <li className={s.cod} style={{ padding: '6px 10px' }}>Nenhum produto vendido no período com esse termo.</li>}
          {opcoes.map((p) => (
            <li key={p.codigo}>
              <button
                type="button"
                onClick={() => {
                  aoEscolher(p);
                  setTexto('');
                  setAberta(false);
                }}
              >
                <b>{p.codigo}</b> · {p.descricao}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProdutosSelecionados({ de, ate, dias }) {
  const { selecionados, alternarSelecionado, cores, descricoes } = useBi();
  return (
    <div className={s.selProds}>
      <span className={s.rot}>Selecionados:</span>
      {selecionados.length === 0 && <span className={s.cod}>nenhum — marque no ranking ou na tabela, ou adicione um código</span>}
      {selecionados.map((c) => (
        <span className={s.tag} key={c}>
          <i style={{ background: cores[c] }} />
          {descricoes[c] ? `${descricoes[c]} · ${c}` : `código ${c}`}
          <button type="button" aria-label={`Remover ${descricoes[c] || c}`} onClick={() => alternarSelecionado(c)}>
            ×
          </button>
        </span>
      ))}
      {selecionados.length < MAX_SELECIONADOS ? (
        <BuscaProduto de={de} ate={ate} dias={dias} excluir={selecionados} aoEscolher={(p) => alternarSelecionado(p.codigo, p.descricao)} />
      ) : (
        <span className={s.cod}>máximo de {MAX_SELECIONADOS}</span>
      )}
    </div>
  );
}

const METRICAS_PRODUTO = {
  bruto: { rotulo: 'Faturamento', campo: 'bruto_media_dia', fmt: moeda, eixo: moedaEixo },
  quantidade: { rotulo: 'Quantidade', campo: 'quantidade_media_dia', fmt: quantidade, eixo: numeroEixo },
  vendas: { rotulo: 'Vendas', campo: 'vendas_media_dia', fmt: (v) => numero(v, 1), eixo: numeroEixo },
};

export function EvolucaoProdutos() {
  const { cliente, selecionados, cores, lembrarDescricoes } = useBi();
  const f = useFiltrosDoBloco('evoprod');
  const [refVisivel, visivel] = useVisivel();
  const [metrica, setMetrica] = useState('bruto');
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const limite = f.agrupamento === 'dia' ? LIMITES.serieDia : LIMITES.geral;
  const acima = n > limite;
  const c = useConsulta(cliente, 'produtoSerie', visivel && n > 0 && !acima && selecionados.length ? { codigos: selecionados, de: f.de, ate: f.ate, agrupamento: f.agrupamento, dias: f.dias } : null);
  const linhas = useMemo(() => (c.status === 'ok' && c.dados ? c.dados : []), [c.status, c.dados]);
  useEffect(() => {
    if (linhas.length) lembrarDescricoes(linhas.filter((l, i, a) => a.findIndex((x) => x.codigo === l.codigo) === i));
  }, [linhas, lembrarDescricoes]);
  const def = METRICAS_PRODUTO[metrica];
  const dados = useMemo(() => {
    const porCodigo = new Map();
    for (const l of linhas) {
      if (!porCodigo.has(l.codigo)) porCodigo.set(l.codigo, []);
      porCodigo.get(l.codigo).push(l);
    }
    const base = porCodigo.get(selecionados.find((x) => porCodigo.has(x))) || [];
    const pontos = juntarSeries(base.map((l) => ({ rotulo: rotuloGrupo(l, f.agrupamento), valor: null, inicio: l.inicio })), null);
    base.forEach((l, i) => {
      if (pontos[i]) pontos[i].fim = l.fim;
    });
    for (const [codigo, ls] of porCodigo) {
      ls.forEach((l, i) => {
        if (!pontos[i]) return;
        pontos[i][`c_${codigo}`] = l[def.campo] === null || l[def.campo] === undefined ? null : Number(l[def.campo]);
        pontos[i][`dv_${codigo}`] = l.dias_validos === null || l.dias_validos === undefined ? null : Number(l.dias_validos);
        pontos[i][`dc_${codigo}`] = l.dias_calendario === null || l.dias_calendario === undefined ? null : Number(l.dias_calendario);
        pontos[i][`cob_${codigo}`] = l.cobertura || null;
      });
    }
    return pontos;
  }, [linhas, selecionados, def.campo, f.agrupamento]);
  const nomes = Object.fromEntries(linhas.map((l) => [l.codigo, l.descricao]));
  const series = selecionados.map((codigo) => ({ chave: `c_${codigo}`, nome: `${nomes[codigo] || 'código'} (${codigo})`, cor: cores[codigo] }));
  const porDia = f.agrupamento === 'dia';
  const conteudoDica = (p) => (
    <>
      <b className={s.ttTitulo}>{porDia ? dataComDia(p.inicioA) : intervalo(p.inicioA, p.fim)}</b>
      {selecionados.map((codigo) => {
        const v = p[`c_${codigo}`];
        const dv = p[`dv_${codigo}`];
        const sit = porDia
          ? dv
            ? { texto: 'dia completo' }
            : { texto: 'dia fora das médias (parcial, sem importação ou sem operação): sem dados' }
          : situacaoDoGrupo(dv, p[`dc_${codigo}`]);
        return (
          <LinhaDica
            key={codigo}
            cor={cores[codigo]}
            rotulo={`${nomes[codigo] || 'código'} · cód. ${codigo}`}
            valor={v === null || v === undefined ? 'sem dados' : def.fmt(v)}
            sub={v === 0 && dv ? `${sit.texto} · sem vendas do produto (zero real)` : sit.texto}
          />
        );
      })}
      <div className={s.ttSub}>{def.rotulo}: média por dia completo{porDia ? '' : ' do agrupamento'}</div>
    </>
  );
  return (
    <Bloco
      nome="evoprod"
      titulo="Evolução de produtos selecionados"
      largura="s12"
      refVisivel={refVisivel}
      acoes={
        <select className={cx(s.controle, s.controlePequeno)} value={metrica} aria-label="Métrica" onChange={(e) => setMetrica(e.target.value)}>
          {Object.entries(METRICAS_PRODUTO).map(([k, m]) => (
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
          <span>por {ROTULO_AGRUPAMENTO[f.agrupamento]}</span>
          <span>quantidades como registradas no G3 (sem unidade)</span>
        </>
      }
    >
      <ProdutosSelecionados de={f.de} ate={f.ate} dias={f.dias} />
      {acima ? (
        <AvisoLimite>
          O agrupamento por {ROTULO_AGRUPAMENTO[f.agrupamento]} aceita até {numero(limite)} dias. Escolha semana ou mês neste bloco.
        </AvisoLimite>
      ) : selecionados.length === 0 ? (
        <p className={s.vazio}>Selecione ao menos um produto para ver a evolução.</p>
      ) : (
        <EstadoConsulta consulta={c} altura={240}>
          <Legenda itens={series} notas={['média por dia completo de cada agrupamento']} />
          <GraficoLinhas dados={dados} series={series} formatoEixo={def.eixo} formatoValor={def.fmt} altura={220} conteudoDica={conteudoDica} rotuloAcessivel="Evolução dos produtos selecionados" />
        </EstadoConsulta>
      )}
    </Bloco>
  );
}

const ORDEM_RPC = { codigo: 'codigo', descricao: 'descricao', quantidade: 'quantidade', vendas: 'vendas', bruto: 'bruto', preco_medio: 'preco_medio', participacao: 'participacao' };
const ROTULO_ORDEM = { codigo: 'Código', descricao: 'Descrição', quantidade: 'Quantidade', vendas: 'Vendas', bruto: 'Faturamento', preco_medio: 'Preço médio', participacao: 'Participação' };

function useAtrasado(valor, ms = 350) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function TabelaProdutos() {
  const { cliente, selecionados, alternarSelecionado, lembrarDescricoes, porPagina, definirPreferencia } = useBi();
  const f = useFiltrosDoBloco('tabela');
  const [refVisivel, visivel] = useVisivel();
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState('');
  const buscaAtrasada = useAtrasado(busca.trim());
  const ord = useOrdenacao({ inicial: { chave: 'bruto', direcao: 'desc' }, aoMudar: () => setPagina(1), persistirEm: 'bi-produtos' });
  const [menu, setMenu] = useState(false);
  const [exportando, setExportando] = useState(null);
  const n = valido(f) ? diasNoIntervalo(f.de, f.ate) : 0;
  const buscaValida = buscaAtrasada.length === 0 || buscaAtrasada.length >= 2;
  const ordem = ORDEM_RPC[ord.ordenacao?.chave] || 'bruto';
  const direcao = ord.ordenacao?.direcao || 'desc';
  useEffect(() => setPagina(1), [f.de, f.ate, f.dias, buscaAtrasada, porPagina]);
  // Busca e ordenação na RPC, sobre TODO o conjunto filtrado; a página é
  // só o recorte (limite/deslocamento) do resultado já ordenado.
  const args = visivel && n > 0 && n <= LIMITES.geral && buscaValida ? { de: f.de, ate: f.ate, busca: buscaAtrasada || null, ordem, direcao, limite: porPagina, deslocamento: (pagina - 1) * porPagina, dias: f.dias } : null;
  const c = useConsulta(cliente, 'produtos', args);
  const resp = c.status === 'ok' ? c.dados : null;
  useEffect(() => {
    if (resp && resp.produtos) lembrarDescricoes(resp.produtos);
  }, [resp, lembrarDescricoes]);
  const total = resp ? resp.paginacao.total_linhas : 0;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  const colunas = [
    { chave: 'codigo', rotulo: 'Código', mobile: 'titulo', cartaoOrdem: 2, ordenavel: { campoConsulta: 'codigo' }, semQuebra: true },
    {
      chave: 'descricao',
      rotulo: 'Descrição',
      mobile: 'titulo',
      cartaoOrdem: 1,
      ordenavel: { campoConsulta: 'descricao' },
      render: (p) => (
        <>
          {p.descricao}
          {p.descricao_compartilhada && <span className={s.cod} title="A mesma descrição existe com outro código G3"> · descrição em mais de um código</span>}
        </>
      ),
    },
    { chave: 'quantidade', rotulo: 'Quantidade', alinhar: 'direita', ordenavel: { campoConsulta: 'quantidade' }, render: (p) => quantidade(p.quantidade), semQuebra: true },
    { chave: 'vendas', rotulo: 'Vendas', alinhar: 'direita', ordenavel: { campoConsulta: 'vendas' }, render: (p) => numero(p.vendas), semQuebra: true, ajuda: 'Vendas que contêm o código (não somar entre produtos)' },
    { chave: 'bruto', rotulo: 'Faturamento', alinhar: 'direita', ordenavel: { campoConsulta: 'bruto' }, render: (p) => moeda(p.bruto), semQuebra: true },
    {
      chave: 'media',
      rotulo: 'Média/dia',
      alinhar: 'direita',
      semQuebra: true,
      ajuda: 'Faturamento ÷ dias completos (só quando o período não tem dia parcial)',
      render: (p) => {
        const m = mediaPorDia(p, resp && resp.cobertura);
        return m === null ? '—' : moeda(m);
      },
    },
    { chave: 'preco_medio', rotulo: 'Preço médio', alinhar: 'direita', ordenavel: { campoConsulta: 'preco_medio' }, render: (p) => (p.preco_medio === null ? '—' : moeda(p.preco_medio)), semQuebra: true },
    { chave: 'participacao', rotulo: 'Participação', alinhar: 'direita', ordenavel: { campoConsulta: 'participacao' }, render: (p) => percentual(p.participacao, 2), semQuebra: true },
  ];

  const exportar = async (formato) => {
    setMenu(false);
    setExportando(formato);
    try {
      // Conjunto filtrado INTEIRO, na ordem escolhida (páginas de 500).
      const todos = [];
      let deslocamento = 0;
      let cobertura = null;
      for (;;) {
        const r = await cliente.consultar('produtos', { de: f.de, ate: f.ate, busca: buscaAtrasada || null, ordem, direcao, limite: 500, deslocamento, dias: f.dias });
        cobertura = r.cobertura;
        todos.push(...(r.produtos || []));
        if (!r.paginacao || !r.paginacao.tem_mais) break;
        deslocamento += 500;
      }
      const modelo = montarExportacaoProdutos({
        produtos: todos,
        cobertura,
        filtros: f,
        busca: buscaAtrasada,
        ordemRotulo: `${ROTULO_ORDEM[ordem]} (${direcao === 'asc' ? 'crescente' : 'decrescente'})`,
        geradoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      });
      await exportarRelatorio(modelo, formato);
    } catch (e) {
      // eslint-disable-next-line no-alert
      setExportando(`erro:${e && e.message ? e.message : 'falha na exportação'}`);
      return;
    }
    setExportando(null);
  };

  return (
    <Bloco
      nome="tabela"
      titulo="Tabela de produtos"
      largura="s12"
      refVisivel={refVisivel}
      acoes={
        <>
          <input type="search" className={cx(s.controle, s.buscaTabela)} placeholder="Buscar por código ou descrição" aria-label="Buscar produto por código ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className={s.exportar}>
            <button type="button" className={s.btn} style={{ height: 32 }} aria-expanded={menu} disabled={!resp || total === 0 || !!(exportando && !exportando.startsWith('erro'))} onClick={() => setMenu((m) => !m)}>
              {exportando && !exportando.startsWith('erro') ? 'Exportando…' : 'Exportar'}
            </button>
            {menu && (
              <div className={s.menuExportar} role="menu">
                <button type="button" role="menuitem" onClick={() => exportar('xlsx')}>
                  Excel (.xlsx)
                </button>
                <button type="button" role="menuitem" onClick={() => exportar('pdf')}>
                  PDF
                </button>
              </div>
            )}
          </div>
        </>
      }
      rodape={
        <>
          <span>{intervalo(f.de, f.ate)}</span>
          <span>{nomeDosDias(f.dias)}</span>
          {resp && <span>{rodapeCobertura(resp)}</span>}
          <span>ordenação e busca sobre todo o conjunto filtrado, antes da paginação</span>
        </>
      }
    >
      {exportando && exportando.startsWith('erro:') && <div className={cx(s.aviso, s.avisoErro)}>Não foi possível exportar: {exportando.slice(5)}</div>}
      {!buscaValida && <p className={s.cod}>Digite ao menos 2 caracteres para buscar.</p>}
      {n > LIMITES.geral ? (
        <AvisoLimite>Período acima de {numero(LIMITES.geral)} dias.</AvisoLimite>
      ) : (
        <EstadoConsulta consulta={buscaValida ? c : { status: 'ok' }} altura={360} vazio={resp && !resp.motivo && total === 0 ? (buscaAtrasada ? 'Nenhum produto encontrado para a busca.' : 'Nenhum produto vendido no período.') : null}>
          <AvisosProdutos resp={resp} />
          {resp && resp.produtos.length > 0 && (
            <>
              <DataTable
                colunas={colunas}
                linhas={resp.produtos}
                chaveLinha={(p) => p.codigo}
                rotulo="Produtos do período"
                denso
                ordenacao={ord.props}
                destaque={(p) => (selecionados.includes(p.codigo) ? 'foco' : null)}
                selecao={{
                  selecionados: new Set(selecionados),
                  podeSelecionar: (p) => selecionados.includes(p.codigo) || selecionados.length < MAX_SELECIONADOS,
                  onAlternar: (p) => alternarSelecionado(p.codigo, p.descricao),
                  rotuloLinha: (p) => `${p.descricao} (código ${p.codigo})`,
                  estadoTodos: 'nenhum',
                  onAlternarTodos: () => {},
                  semSelecionaveis: true,
                }}
              />
              <div className={s.pag}>
                <span>
                  {numero(resp.paginacao.deslocamento + 1)}–{numero(resp.paginacao.deslocamento + resp.paginacao.retornadas)} de {plural(total, 'código')} · “Vendas” = vendas que contêm o código (não somar entre produtos)
                </span>
                <div className={s.pagDireita}>
                  <label className={s.porPagina}>
                    Por página
                    <select className={cx(s.controle, s.controlePequeno)} value={porPagina} onChange={(e) => definirPreferencia('porPagina', Number(e.target.value))}>
                      {TAMANHOS_PAGINA.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Paginacao paginaAtual={pagina} totalPaginas={totalPaginas} onMudarPagina={setPagina} />
                </div>
              </div>
            </>
          )}
        </EstadoConsulta>
      )}
    </Bloco>
  );
}
