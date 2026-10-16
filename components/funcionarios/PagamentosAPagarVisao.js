import { useEffect, useId, useMemo, useState } from 'react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import IndicadorVinculo from './IndicadorVinculo';
import PagamentoPorHoraModal from './PagamentoPorHoraModal';
import PagamentoMensalModal from './PagamentoMensalModal';
import LancamentoItem from './LancamentoItem';
import LancamentoModal from './LancamentoModal';
import CancelarLancamentoModal from './CancelarLancamentoModal';
import { buscarLancamentosPendentes, buscarTiposLancamento } from '../../lib/funcionarios/lancamentos';
import { agruparPendentesPorFuncionaria, alternarSelecao, descreverPendentes, lancamentosSelecionados, pendentesDaPessoa, pendentesForaDosBlocos, resumoDoBloco, totaisLancamentos } from '../../lib/funcionarios/lancamentosCalculo';
import { formatarDataCurta, formatarHora, rotuloDiaSemana } from '../../lib/funcionarios/escala';
import { inicioDoMes, dataLocalHoje } from '../../lib/data/dataLocal';
import { buscarSituacaoRemuneracaoEmLote, buscarPendenciasPorHora, buscarPendenciaMensal, buscarPendenciasHistoricas, formatarMoeda, formatarCompetencia } from '../../lib/funcionarios/pagamentos';
import { agruparPorForma, centavos, chaveJornada, formatarValorEditavel, resolverValorAPagar, somarValoresAPagar } from '../../lib/funcionarios/pagamentosCalculo';
import { agruparPorCompetencia, descreverPendencias, descreverPix, plural, totalPendenteJornadas, totalPendenteMensal } from '../../lib/funcionarios/pagamentosApresentacao';
import { cx } from '../../lib/design/cx';
import estilosPagamentos from './pagamentos.module.css';

// Até esta largura (px) as telas de Pagamentos usam o layout compacto de
// celular/tablet (Pagos: DataTable em cartões). Em A Pagar o MESMO DOM
// serve aos dois tamanhos -- só o CSS (@media max-width: 900px em
// pagamentos.module.css) reorganiza; trocar de tamanho (girar o tablet)
// nunca remonta nada: valores digitados, seleção e modal aberto continuam.
export const PAGAMENTOS_CARTOES_ATE = 900;

function formatarDuracao(minutos) {
  const m = Number(minutos) || 0;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`;
}

// Estado comum de seleção + "Valor a pagar" digitado por jornada (chave
// lógica funcionario+data+hora_inicio+hora_fim, nunca id físico).
function useSelecaoComValores() {
  const [selecionadas, setSelecionadas] = useState(new Set());
  const [digitados, setDigitados] = useState({});
  function alternar(chave) {
    setSelecionadas((atual) => alternarSelecao(atual, chave));
  }
  function digitar(chave, texto) {
    setDigitados((atual) => ({ ...atual, [chave]: texto }));
    // Digitar um valor numa jornada não selecionada já a seleciona.
    if (String(texto).trim()) setSelecionadas((atual) => (atual.has(chave) ? atual : new Set(atual).add(chave)));
  }
  function limpar() {
    setSelecionadas(new Set());
    setDigitados({});
  }
  return { selecionadas, setSelecionadas, digitados, alternar, digitar, limpar };
}

function contarValoresFaltando(itens, digitados) {
  return itens.filter((p) => {
    const r = resolverValorAPagar(p.valor ?? null, digitados[chaveJornada(p)]);
    return r.pendente || r.invalido;
  }).length;
}

// Cartão de 1 pessoa (superfície do Card do Design System, como os cartões
// de turno da Produção): cabeçalho sempre visível -- seta, nome, vínculo,
// selos, resumo, PIX (só leitura) e o TOTAL PENDENTE bruto (tudo o que
// falta pagar, sem lançamentos) -- o líquido do pagamento que está sendo
// montado aparece só no resumo, com outro nome. Aberto, as seções.
function CartaoPessoa({ funcionario, selos, resumo, total, expandido, onAlternar, children }) {
  const idCorpo = useId();
  const pix = descreverPix(funcionario);
  const rotulo = `${expandido ? 'Recolher' : 'Expandir'} ${funcionario.nome}`;
  return (
    <article className={cx(estilosPagamentos.pessoa, expandido && estilosPagamentos.pessoaAberta)} aria-label={funcionario.nome}>
      <div className={estilosPagamentos.pessoaCabecalho}>
        <button type="button" className={estilosPagamentos.botaoExpandir} onClick={onAlternar} aria-expanded={expandido} aria-controls={idCorpo} aria-label={rotulo} title={rotulo}>
          <Icon nome={expandido ? 'chevronDown' : 'chevronRight'} tamanho={18} />
        </button>
        <div className={estilosPagamentos.pessoaIdentificacao}>
          <span className={estilosPagamentos.identificacaoFuncionario}>
            <button type="button" className={estilosPagamentos.nomeBotao} onClick={onAlternar} aria-expanded={expandido} aria-controls={idCorpo}>
              <strong className={estilosPagamentos.nomeFuncionario}>{funcionario.nome}</strong>
            </button>
            {funcionario.tipo_vinculo && <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />}
          </span>
          {resumo && <span className={estilosPagamentos.pessoaResumo}>{resumo}</span>}
          {selos && <span className={estilosPagamentos.pessoaSelos}>{selos}</span>}
        </div>
        <div className={cx(estilosPagamentos.pessoaPix, estilosPagamentos.pix, !pix.cadastrado && estilosPagamentos.pixAusente)} title={pix.texto}>
          {pix.texto}
        </div>
        <div className={estilosPagamentos.pessoaTotal}>
          <span className={estilosPagamentos.rotuloTotalCabecalho}>Total pendente</span>
          <strong>{total}</strong>
        </div>
      </div>
      {expandido && (
        <div id={idCorpo} className={estilosPagamentos.pessoaCorpo}>
          {children}
        </div>
      )}
    </article>
  );
}

// Seção dentro do cartão aberto: título discreto + ação opcional à direita.
function SecaoPessoa({ titulo, detalhe, acao, children }) {
  const idTitulo = useId();
  return (
    <section className={estilosPagamentos.secaoPessoa} aria-labelledby={idTitulo}>
      <div className={estilosPagamentos.secaoPessoaCabecalho}>
        <h4 id={idTitulo} className={estilosPagamentos.secaoPessoaTitulo}>
          {titulo}
          {detalhe && <span className={estilosPagamentos.secaoPessoaDetalhe}> · {detalhe}</span>}
        </h4>
        {acao}
      </div>
      {children}
    </section>
  );
}

// Cabeçalho das colunas das jornadas -- só no desktop (no celular cada
// jornada traz os próprios rótulos).
function CabecalhoJornadas({ selecao, rotuloSelecao }) {
  return (
    <div className={estilosPagamentos.jornadasCabecalho}>
      <span className={estilosPagamentos.jornadaCaixa}>
        {selecao && <input type="checkbox" checked={selecao.todas} onChange={selecao.onAlternar} aria-label={rotuloSelecao} />}
      </span>
      <span>Jornada</span>
      <span>Valor calculado</span>
      <span>Previsto</span>
      <span className={estilosPagamentos.jornadasCabecalhoValor}>Valor a pagar</span>
    </div>
  );
}

// "Selecionar tudo" do celular (o do desktop fica no cabeçalho de colunas).
function SelecionarTudoCompacto({ selecao, rotulo }) {
  if (!selecao) return null;
  return (
    <label className={estilosPagamentos.selecionarTudoCompacto}>
      <input type="checkbox" checked={selecao.todas} onChange={selecao.onAlternar} aria-label={rotulo} />
      Selecionar tudo
    </label>
  );
}

// 1 jornada (ou extra remunerado): valor calculado (sugestão) x "Valor a
// pagar" editável -- mesma regra da antiga JornadaValorLinha (0068).
// Um só DOM: no desktop vira linha em colunas; no celular, cartão.
function LinhaJornada({ item, sel, extra = false }) {
  const chave = chaveJornada(item);
  const selecionada = sel.selecionadas.has(chave);
  const temCalculo = item.valor !== null && item.valor !== undefined;
  const digitado = sel.digitados[chave];
  const textoCampo = digitado !== undefined ? digitado : formatarValorEditavel(item.valor);
  const r = resolverValorAPagar(item.valor ?? null, digitado);
  const ehExtra = extra || item.natureza_financeira === 'extra_remunerado';
  const descricao = `${formatarDataCurta(item.data)} ${formatarHora(item.hora_inicio)}`;
  return (
    <div className={cx(estilosPagamentos.jornada, selecionada && estilosPagamentos.jornadaSelecionada)}>
      <span className={estilosPagamentos.jornadaCaixa}>
        <input type="checkbox" checked={selecionada} onChange={() => sel.alternar(chave)} aria-label={`Selecionar ${descricao}`} />
      </span>
      <div className={estilosPagamentos.jornadaQuando}>
        <strong>
          {rotuloDiaSemana(item.data)} {formatarDataCurta(item.data)}
        </strong>
        <span className={estilosPagamentos.jornadaHorario}>
          {formatarHora(item.hora_inicio)}–{formatarHora(item.hora_fim)} · {formatarDuracao(item.duracao_minutos)}
          {ehExtra && ' · extra'}
        </span>
      </div>
      <div className={estilosPagamentos.jornadaCalculado}>
        <span className={estilosPagamentos.rotuloCompacto}>Calculado </span>
        {temCalculo ? (
          <>
            {formatarMoeda(item.valor)}
            <span className={estilosPagamentos.valorHora}>{formatarMoeda(item.valor_hora_aplicado)}/h</span>
          </>
        ) : (
          <em>não disponível</em>
        )}
      </div>
      <div className={estilosPagamentos.jornadaPrevisto}>
        <span className={estilosPagamentos.rotuloCompacto}>Previsto </span>
        {item.data_prevista ? formatarDataCurta(item.data_prevista) : '—'}
      </div>
      <div className={estilosPagamentos.jornadaValor}>
        <span className={estilosPagamentos.rotuloCompacto}>Valor a pagar</span>
        <span className={estilosPagamentos.campoValor}>
          <Input
            inputMode="decimal"
            aria-label={`Valor a pagar ${descricao}`}
            placeholder={temCalculo ? formatarValorEditavel(item.valor) : 'Valor'}
            value={textoCampo}
            onChange={(e) => sel.digitar(chave, e.target.value)}
          />
          {r.invalido && <Badge tom="danger">inválido</Badge>}
          {!r.invalido && r.pendente && <Badge tom="warning">informe</Badge>}
          {!r.invalido && r.manual && <Badge tom="info">ajustado</Badge>}
        </span>
      </div>
    </div>
  );
}

// Lista de jornadas (por mês, quando há mais de um) com cabeçalho de colunas.
function ListaJornadas({ itens, sel, selecao, rotuloSelecao, extra = false, porMes = false }) {
  const meses = porMes ? agruparPorCompetencia(itens) : [{ competencia: null, jornadas: itens }];
  return (
    <>
      <SelecionarTudoCompacto selecao={selecao} rotulo={rotuloSelecao} />
      <div className={estilosPagamentos.jornadas}>
        <CabecalhoJornadas selecao={selecao} rotuloSelecao={rotuloSelecao} />
        {meses.map((m) => (
          <div key={m.competencia || 'todas'} role="group" aria-label={m.competencia ? formatarCompetencia(m.competencia) : undefined}>
            {meses.length > 1 && <div className={estilosPagamentos.jornadasMes}>{formatarCompetencia(m.competencia)}</div>}
            {m.jornadas.map((p) => (
              <LinhaJornada key={chaveJornada(p)} item={p} sel={sel} extra={extra} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// Lançamentos pendentes DENTRO do cartão da pessoa (migration 0076): nada
// vem marcado; o que for marcado entra no resumo abaixo e no pagamento
// (p_lancamentos). Editar/cancelar ficam no próprio lançamento.
function SecaoLancamentos({ funcionario, lancamentos, selecionados, onAlterar, acoes }) {
  const podeCriar = acoes.podeCriarPara(funcionario.id);
  if (lancamentos.length === 0 && !podeCriar) return null;
  return (
    <SecaoPessoa
      titulo="Lançamentos pendentes"
      detalhe={lancamentos.length > 0 ? `${lancamentosSelecionados(lancamentos, selecionados).length} de ${lancamentos.length} selecionado${lancamentos.length === 1 ? '' : 's'}` : ''}
      acao={
        podeCriar && (
          <Button variante="secondary" tamanho="sm" icone="plus" onClick={() => acoes.novo(funcionario.id)} aria-label={`Novo lançamento para ${funcionario.nome}`}>
            Lançamento
          </Button>
        )
      }
    >
      {lancamentos.length === 0 ? (
        <p className={estilosPagamentos.vazio}>Nenhum lançamento pendente.</p>
      ) : (
        <>
          <p className={estilosPagamentos.dicaSecao}>Marque os que entram neste pagamento. Os não marcados continuam pendentes.</p>
          <ul className={estilosPagamentos.listaLancamentosSelecao}>
            {lancamentos.map((l) => (
              <li key={l.id}>
                <LancamentoItem
                  lancamento={l}
                  marcado={selecionados.has(l.id)}
                  onAlternar={(id) => onAlterar(alternarSelecao(selecionados, id))}
                  acoes={acoes.podeEditar && <AcoesLancamento lancamento={l} nome={funcionario.nome} acoes={acoes} />}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </SecaoPessoa>
  );
}

function AcoesLancamento({ lancamento: l, nome, acoes }) {
  return (
    <>
      <IconButton icone="pencil" tamanho="sm" rotulo={`Editar lançamento ${l.tipo_nome} de ${nome}`} onClick={() => acoes.editar(l)} />
      <IconButton icone="close" tamanho="sm" tom="danger" rotulo={`Cancelar lançamento ${l.tipo_nome} de ${nome}`} onClick={() => acoes.cancelar(l, nome)} />
    </>
  );
}

// Resumo do pagamento ANTES do modal: bruto + acréscimos − descontos dos
// lançamentos marcados = líquido (mesma conta das RPCs da 0076). Linhas
// zeradas de acréscimo/desconto não aparecem. A ação principal mostra o
// líquido resultante. semSelecao: nada escolhido ainda -- só a orientação
// (sem "líquido" de um pagamento que não existe).
// rotuloLiquido: "Líquido a pagar" (por hora: valor final) ou "Líquido
// previsto" (mensal: a base ainda é escolhida no modal).
function ResumoPagamento({ rotuloBruto, rotuloLiquido = 'Líquido a pagar', valores, semSelecao = false, avisos = [], nota, mensagem, acao }) {
  return (
    <div className={estilosPagamentos.resumoPagamento}>
      <h4 className={estilosPagamentos.somenteLeitor}>Resumo do pagamento</h4>
      {!semSelecao && (
        <dl className={estilosPagamentos.resumoPagamentoLinhas}>
          <div>
            <dt>{rotuloBruto}</dt>
            <dd>{formatarMoeda(valores.bruto)}</dd>
          </div>
          {valores.acrescimos > 0 && (
            <div>
              <dt>Acréscimos</dt>
              <dd className={estilosPagamentos.valorAcrescimo}>+ {formatarMoeda(valores.acrescimos)}</dd>
            </div>
          )}
          {valores.descontos > 0 && (
            <div>
              <dt>Descontos</dt>
              <dd className={estilosPagamentos.valorDesconto}>− {formatarMoeda(valores.descontos)}</dd>
            </div>
          )}
          <div className={estilosPagamentos.resumoPagamentoLiquido}>
            <dt>{rotuloLiquido}</dt>
            <dd>{formatarMoeda(valores.liquido)}</dd>
          </div>
        </dl>
      )}
      {avisos.filter(Boolean).map((a) => (
        <p key={a} className={estilosPagamentos.resumoPagamentoAviso} role="status">
          {a}
        </p>
      ))}
      {nota && <p className={estilosPagamentos.dicaSecao}>{nota}</p>}
      {(mensagem || acao) && (
        <div className={estilosPagamentos.resumoPagamentoAcoes}>
          {mensagem && <span className={estilosPagamentos.mensagemSucesso}>{mensagem}</span>}
          {acao}
        </div>
      )}
    </div>
  );
}

const AVISO_LIQUIDO_NEGATIVO = 'Os descontos ultrapassam o valor do pagamento. Desmarque algum desconto ou inclua mais jornadas.';

// Bloco de 1 pessoa com jornadas por hora (ou regularização histórica):
// jornadas pendentes (falta/atestado/folga/futuras já vêm excluídas pela
// RPC), valor calculado e "Valor a pagar" editável (0068), seleção de
// qualquer subconjunto (pagamento parcial), lançamentos pendentes (0076)
// e "Incluir pagamento".
// historico: jornadas já carregadas (RPC de regularização), sem valor
// calculado, modal em modo "historico".
function BlocoJornadas({ funcionario, formaAtual, podeConfirmar, historico = null, lancamentos = [], acoesLancamento, onRegistrado, onPagamentoRegistrado }) {
  const [expandido, setExpandido] = useState(false);
  const [carregando, setCarregando] = useState(!historico);
  const [pendencias, setPendencias] = useState(historico ? historico.jornadas : []);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [suporteValorManual, setSuporteValorManual] = useState(true);
  const [lancamentosMarcados, setLancamentosMarcados] = useState(() => new Set());
  const sel = useSelecaoComValores();

  async function carregar() {
    setCarregando(true);
    setErro('');
    const { pendencias: lista, erro: erroCarga, suporteValorManual: suporte } = await buscarPendenciasPorHora(funcionario.id);
    setPendencias(lista);
    setSuporteValorManual(suporte !== false);
    sel.limpar();
    if (erroCarga) setErro(erroCarga);
    setCarregando(false);
  }

  useEffect(() => {
    if (historico) {
      setPendencias(historico.jornadas);
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionario.id, historico]);

  const jornadasSelecionadas = pendencias.filter((p) => sel.selecionadas.has(chaveJornada(p)));
  const totalSelecionado = somarValoresAPagar(jornadasSelecionadas, sel.digitados);
  const faltamValores = contarValoresFaltando(jornadasSelecionadas, sel.digitados);
  const todasSelecionadas = pendencias.length > 0 && jornadasSelecionadas.length === pendencias.length;
  const total = totalPendenteJornadas(pendencias, sel.digitados);
  const meses = agruparPorCompetencia(pendencias);
  const valores = resumoDoBloco(totalSelecionado, lancamentos, lancamentosMarcados);
  const liquidoNegativo = jornadasSelecionadas.length > 0 && valores.liquido < 0;

  function alternarTodas() {
    sel.setSelecionadas(todasSelecionadas ? new Set() : new Set(pendencias.map(chaveJornada)));
  }

  function aoConfirmar() {
    setModalAberto(false);
    setLancamentosMarcados(new Set());
    if (historico) {
      sel.limpar();
      setMensagemSucesso('Regularização registrada.');
      onRegistrado();
    } else {
      setMensagemSucesso('Pagamento registrado.');
      carregar();
    }
    if (onPagamentoRegistrado) onPagamentoRegistrado();
  }

  const avisoForma = historico ? (
    <Badge tom="warning">Regularização histórica</Badge>
  ) : (
    formaAtual !== 'por_hora' && <Badge tom="warning">Hoje: {formaAtual === 'mensal' ? 'Mensal' : 'Não configurado'} — jornadas por hora anteriores</Badge>
  );
  const selos =
    avisoForma || lancamentos.length > 0 ? (
      <>
        {avisoForma}
        {lancamentos.length > 0 && <Badge tom="info">{descreverPendentes(totaisLancamentos(lancamentos))}</Badge>}
      </>
    ) : null;
  const rotuloAcao = historico ? 'Registrar regularização' : 'Incluir pagamento';

  return (
    <CartaoPessoa
      funcionario={funcionario}
      selos={selos}
      expandido={expandido}
      onAlternar={() => setExpandido((v) => !v)}
      total={carregando ? '…' : erro ? '—' : total.semValor > 0 && total.total === 0 ? 'a informar' : formatarMoeda(total.total)}
      resumo={carregando || erro ? '' : descreverPendencias(pendencias.length, meses.length || 1)}
    >
      <SecaoPessoa
        titulo="Jornadas pendentes"
        detalhe={pendencias.length > 0 ? `${jornadasSelecionadas.length} de ${pendencias.length} selecionada${pendencias.length === 1 ? '' : 's'}` : ''}
      >
        {carregando ? (
          <p role="status">Carregando...</p>
        ) : erro ? (
          <Alert tom="danger">{erro}</Alert>
        ) : pendencias.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhuma jornada pendente.</p>
        ) : (
          <ListaJornadas
            itens={pendencias}
            sel={sel}
            porMes
            selecao={{ todas: todasSelecionadas, onAlternar: alternarTodas }}
            rotuloSelecao={`Selecionar tudo de ${funcionario.nome}`}
          />
        )}
      </SecaoPessoa>

      <SecaoLancamentos funcionario={funcionario} lancamentos={lancamentos} selecionados={lancamentosMarcados} onAlterar={setLancamentosMarcados} acoes={acoesLancamento} />

      {pendencias.length > 0 || mensagemSucesso ? (
        <ResumoPagamento
          rotuloBruto={`Jornadas (${plural(jornadasSelecionadas.length, 'selecionada', 'selecionadas')})`}
          valores={valores}
          semSelecao={jornadasSelecionadas.length === 0}
          avisos={[
            pendencias.length > 0 && jornadasSelecionadas.length === 0 && 'Marque as jornadas que entram neste pagamento.',
            faltamValores > 0 && `Falta informar ${plural(faltamValores, 'valor', 'valores')} a pagar.`,
            total.semValor > 0 && jornadasSelecionadas.length === 0 && `${plural(total.semValor, 'jornada sem valor', 'jornadas sem valor')} — informe o valor a pagar.`,
            liquidoNegativo && AVISO_LIQUIDO_NEGATIVO,
          ]}
          mensagem={mensagemSucesso}
          acao={
            podeConfirmar &&
            pendencias.length > 0 && (
              <Button disabled={jornadasSelecionadas.length === 0 || faltamValores > 0 || liquidoNegativo} onClick={() => setModalAberto(true)}>
                {jornadasSelecionadas.length > 0 && faltamValores === 0 ? `${rotuloAcao} · ${formatarMoeda(valores.liquido)}` : rotuloAcao}
              </Button>
            )
          }
        />
      ) : null}

      {modalAberto && (
        <PagamentoPorHoraModal
          modo={historico ? 'historico' : undefined}
          funcionario={funcionario}
          jornadas={jornadasSelecionadas}
          digitados={sel.digitados}
          suporteValorManual={historico ? undefined : suporteValorManual}
          lancamentos={lancamentos}
          lancamentosMarcados={lancamentosMarcados}
          onAlterarLancamentos={setLancamentosMarcados}
          onFechar={() => setModalAberto(false)}
          onConfirmado={aoConfirmar}
        />
      )}
    </CartaoPessoa>
  );
}

// Bloco de 1 pessoa mensal na competência escolhida: remuneração-base, já
// pago, saldo, faltas/atestados, data prevista, extras remunerados
// pendentes (valor calculado + "Valor a pagar") e lançamentos (0076). A
// base nunca vira valor por jornada; quanto dela entra é decidido no modal
// (integral/adiantamento/parcial/complemento) -- o resumo daqui parte do
// mesmo padrão do modal.
function BlocoMensal({ funcionario, competencia, podeConfirmar, lancamentos = [], acoesLancamento, onPagamentoRegistrado }) {
  const [expandido, setExpandido] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [suporteValorManual, setSuporteValorManual] = useState(true);
  const [lancamentosMarcados, setLancamentosMarcados] = useState(() => new Set());
  const sel = useSelecaoComValores();

  async function carregar() {
    setCarregando(true);
    setErro('');
    const { pendencia, erro: erroCarga, suporteValorManual: suporte } = await buscarPendenciaMensal(funcionario.id, competencia);
    setResumo(pendencia);
    setSuporteValorManual(suporte !== false);
    sel.limpar();
    if (erroCarga) setErro(erroCarga);
    setCarregando(false);
  }

  useEffect(() => {
    setMensagemSucesso('');
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionario.id, competencia]);

  const extrasDisponiveis = resumo?.extras_pendentes || [];
  const extrasSelecionados = extrasDisponiveis.filter((e) => sel.selecionadas.has(chaveJornada(e)));
  const faltamValores = contarValoresFaltando(extrasSelecionados, sel.digitados);
  const mensalNaCompetencia = resumo?.forma_vigente === 'mensal';
  const temBase = mensalNaCompetencia && resumo?.valor_mensal_base !== null && resumo?.valor_mensal_base !== undefined;
  const todasExtras = extrasDisponiveis.length > 0 && extrasSelecionados.length === extrasDisponiveis.length;
  const total = temBase ? totalPendenteMensal(resumo, sel.digitados) : { total: 0, semValor: 0, extras: 0 };
  // Mesmo ponto de partida do modal: no 1º pagamento da competência a base
  // entra inteira (Integral); depois disso o modal abre em Complemento (0).
  const saldo = Math.max(0, Number(resumo?.saldo_base || 0));
  const basePadrao = Number(resumo?.pagamentos_ativos_qtd || 0) === 0 ? saldo : 0;
  const brutoPrevisto = (centavos(basePadrao) + centavos(somarValoresAPagar(extrasSelecionados, sel.digitados))) / 100;
  const valores = resumoDoBloco(brutoPrevisto, lancamentos, lancamentosMarcados);
  // Prévia: quanto da base entra só é decidido no modal (que bloqueia
  // líquido negativo, como o banco). Aqui nunca trava o botão por isso --
  // senão o 2º pagamento da competência (base 0 até ser informada) com um
  // desconto marcado não conseguiria nem abrir o modal.
  const semPrevia = brutoPrevisto <= 0;
  const liquidoNegativo = !semPrevia && valores.liquido < 0;
  const podeIncluir = temBase && (Number(resumo?.saldo_base) > 0 || extrasDisponiveis.length > 0) && faltamValores === 0;

  function aoConfirmar() {
    setModalAberto(false);
    setLancamentosMarcados(new Set());
    setMensagemSucesso('Pagamento registrado.');
    carregar();
    if (onPagamentoRegistrado) onPagamentoRegistrado();
  }

  const linhaBase = (rotulo, valor, forte = false, aux = '') => (
    <div className={cx(forte && estilosPagamentos.valoresForte)}>
      <dt>
        {rotulo}
        {aux && <span className={estilosPagamentos.valoresAux}>{aux}</span>}
      </dt>
      <dd>{valor}</dd>
    </div>
  );

  return (
    <CartaoPessoa
      funcionario={funcionario}
      selos={lancamentos.length > 0 ? <Badge tom="info">{descreverPendentes(totaisLancamentos(lancamentos))}</Badge> : null}
      expandido={expandido}
      onAlternar={() => setExpandido((v) => !v)}
      total={carregando ? '…' : temBase ? formatarMoeda(total.total) : '—'}
      resumo={carregando || erro ? '' : !temBase ? 'Ver detalhes' : `Competência ${formatarCompetencia(competencia)}`}
    >
      {carregando ? (
        <p role="status">Carregando...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : !resumo ? null : !mensalNaCompetencia ? (
        <Alert tom="warning">Não estava configurado(a) como mensal em {formatarCompetencia(competencia)}.</Alert>
      ) : !temBase ? (
        <Alert tom="warning">Sem remuneração-base mensal configurada para {formatarCompetencia(competencia)}. Configure em &quot;Configurações&quot;.</Alert>
      ) : (
        <>
          <SecaoPessoa titulo="Remuneração-base" detalhe={formatarCompetencia(competencia)}>
            <dl className={estilosPagamentos.valores}>
              {linhaBase('Remuneração-base', formatarMoeda(resumo.valor_mensal_base))}
              {linhaBase(
                `Já pago da base (${plural(resumo.pagamentos_ativos_qtd, 'pagamento ativo', 'pagamentos ativos')})`,
                Number(resumo.valor_base_ja_pago) > 0 ? `− ${formatarMoeda(resumo.valor_base_ja_pago)}` : formatarMoeda(0),
              )}
              {linhaBase(
                'Saldo da base',
                formatarMoeda(resumo.saldo_base),
                true,
                resumo.data_prevista ? `Previsto ${rotuloDiaSemana(resumo.data_prevista)} ${formatarDataCurta(resumo.data_prevista)}` : '',
              )}
              {(resumo.faltas_qtd > 0 || resumo.atestados_qtd > 0) &&
                linhaBase(
                  `Faltas: ${resumo.faltas_qtd} · Atestados: ${resumo.atestados_qtd}`,
                  resumo.sugestao_desconto_falta !== null ? <span className={estilosPagamentos.prevista}>sugestão de desconto: {formatarMoeda(resumo.sugestao_desconto_falta)}</span> : '',
                )}
            </dl>
          </SecaoPessoa>

          {extrasDisponiveis.length > 0 && (
            <SecaoPessoa titulo="Extras remunerados pendentes" detalhe={`${extrasSelecionados.length} de ${extrasDisponiveis.length} selecionado${extrasDisponiveis.length === 1 ? '' : 's'}`}>
              <ListaJornadas
                itens={extrasDisponiveis}
                sel={sel}
                extra
                selecao={{ todas: todasExtras, onAlternar: () => sel.setSelecionadas(todasExtras ? new Set() : new Set(extrasDisponiveis.map(chaveJornada))) }}
                rotuloSelecao={`Selecionar todos os extras de ${funcionario.nome}`}
              />
            </SecaoPessoa>
          )}

          <SecaoLancamentos funcionario={funcionario} lancamentos={lancamentos} selecionados={lancamentosMarcados} onAlterar={setLancamentosMarcados} acoes={acoesLancamento} />

          <ResumoPagamento
            rotuloBruto={
              basePadrao > 0
                ? `Saldo da base (integral)${extrasSelecionados.length > 0 ? ` + ${plural(extrasSelecionados.length, 'extra', 'extras')}` : ''}`
                : `Extras (${plural(extrasSelecionados.length, 'selecionado', 'selecionados')})`
            }
            rotuloLiquido="Líquido previsto"
            valores={valores}
            semSelecao={semPrevia}
            avisos={[
              semPrevia && 'A base deste pagamento é definida na confirmação.',
              faltamValores > 0 && `Falta informar ${plural(faltamValores, 'valor', 'valores')} a pagar.`,
              liquidoNegativo && 'Os descontos marcados ultrapassam o valor previsto. Ajuste na confirmação.',
            ]}
            nota={`${basePadrao > 0 ? 'Previsão com a base integral. ' : ''}Na confirmação dá para escolher quanto da base entra (integral, adiantamento, parcial ou complemento) e incluir descontos avulsos; o líquido final aparece no botão de confirmar.`}
            mensagem={mensagemSucesso}
            acao={
              podeConfirmar && (
                <Button disabled={!podeIncluir} onClick={() => setModalAberto(true)}>
                  Incluir pagamento
                </Button>
              )
            }
          />
        </>
      )}

      {modalAberto && resumo && (
        <PagamentoMensalModal
          funcionario={funcionario}
          competencia={competencia}
          resumo={resumo}
          extras={extrasSelecionados}
          digitados={sel.digitados}
          suporteValorManual={suporteValorManual}
          lancamentos={lancamentos}
          lancamentosMarcados={lancamentosMarcados}
          onAlterarLancamentos={setLancamentosMarcados}
          onFechar={() => setModalAberto(false)}
          onConfirmado={aoConfirmar}
        />
      )}
    </CartaoPessoa>
  );
}

// Lançamentos pendentes de quem não tem cartão em A Pagar (inativa, sem
// configuração de pagamento): continuam visíveis e auditáveis; não geram
// pagamento por aqui, só editar/cancelar.
function LancamentosForaDaLista({ grupos, acoes }) {
  if (grupos.length === 0) return null;
  return (
    <section aria-labelledby="titulo-lancamentos-fora">
      <h3 id="titulo-lancamentos-fora" className={estilosPagamentos.tituloSecao}>
        Lançamentos de pessoas fora de A Pagar
      </h3>
      <p className={estilosPagamentos.dicaCompetencia}>Pessoas inativas ou sem configuração de pagamento. Os lançamentos continuam pendentes e podem ser editados ou cancelados.</p>
      <div className={estilosPagamentos.listaPessoas}>
        {grupos.map((g) => (
          <article key={g.id} className={cx(estilosPagamentos.pessoa, estilosPagamentos.pessoaSimples)} aria-label={g.nome}>
            <div className={estilosPagamentos.pessoaSimplesCabecalho}>
              <strong className={estilosPagamentos.nomeFuncionario}>{g.nome}</strong>
              {g.inativa ? <Badge tom="neutral">inativa</Badge> : <Badge tom="warning">sem configuração de pagamento</Badge>}
              <span className={estilosPagamentos.pessoaResumo}>{descreverPendentes(g)}</span>
            </div>
            <ul className={estilosPagamentos.listaLancamentosSelecao}>
              {g.lancamentos.map((l) => (
                <li key={l.id}>
                  <LancamentoItem lancamento={l} acoes={acoes.podeEditar && <AcoesLancamento lancamento={l} nome={g.nome} acoes={acoes} />} />
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

// Visão "A Pagar": Por hora, Mensal e Regularização SEPARADOS, um cartão por
// pessoa (jornadas, lançamentos e resumo do líquido dentro dele). Nenhum
// cálculo novo: mesmas RPCs e os mesmos modais de pagamento de antes.
export default function PagamentosAPagarVisao({ funcionarios, podeConfirmar, podeEditar = false, onIrParaConfiguracoes }) {
  const [situacao, setSituacao] = useState({ formaAtual: new Map(), comPorHora: new Set() });
  const [historico, setHistorico] = useState({ disponivel: false, jornadas: [] });
  const [carregando, setCarregando] = useState(true);
  const [recarregarHistorico, setRecarregarHistorico] = useState(0);
  const [competencia, setCompetencia] = useState(() => inicioDoMes(dataLocalHoje()));
  // Migration 0076 -- lançamentos pendentes (1 consulta para todos) e tipos.
  // disponivel = false sem a 0076 no banco: seções e ações nem aparecem.
  const [lancamentos, setLancamentos] = useState({ disponivel: false, lancamentos: [] });
  const [tiposLancamento, setTiposLancamento] = useState([]);
  const [recarregarLancamentos, setRecarregarLancamentos] = useState(0);
  const [modalLancamento, setModalLancamento] = useState(null); // { tipo: 'novo'|'editar'|'cancelar', ... }

  useEffect(() => {
    let ativo = true;
    Promise.all([buscarLancamentosPendentes(), buscarTiposLancamento()]).then(([pendentes, tipos]) => {
      if (!ativo) return;
      setLancamentos(pendentes);
      setTiposLancamento(tipos.tipos);
    });
    return () => {
      ativo = false;
    };
  }, [recarregarLancamentos]);

  const pendentesPorPessoa = useMemo(() => agruparPendentesPorFuncionaria(lancamentos.lancamentos), [lancamentos]);
  const idsAtivos = useMemo(() => new Set(funcionarios.map((f) => f.id)), [funcionarios]);
  // Só pessoa ATIVA tem lançamentos selecionáveis no cartão. Inativa (ex.:
  // só com regularização histórica) fica na seção "fora de A Pagar": visível,
  // editável/cancelável, nunca consumida num pagamento (decisão da 0076).
  const pendentesDe = (id) => (lancamentos.disponivel ? pendentesDaPessoa(pendentesPorPessoa, id, idsAtivos) : []);
  const recarregarPendentes = () => setRecarregarLancamentos((n) => n + 1);

  // Ações de lançamento (novo/editar/cancelar), num só lugar para todos os
  // cartões; o modal fica aqui e a lista recarrega ao salvar.
  const acoesLancamento = {
    podeEditar: lancamentos.disponivel && podeEditar,
    podeCriarPara: (id) => lancamentos.disponivel && podeEditar && idsAtivos.has(id),
    novo: (funcionarioId = '') => setModalLancamento({ tipo: 'novo', funcionarioId }),
    editar: (lancamento) => setModalLancamento({ tipo: 'editar', lancamento }),
    cancelar: (lancamento, nome) => setModalLancamento({ tipo: 'cancelar', lancamento, nome }),
  };
  function aoSalvarLancamento() {
    setModalLancamento(null);
    recarregarPendentes();
  }

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      const dados = await buscarSituacaoRemuneracaoEmLote(funcionarios.map((f) => f.id));
      if (!ativo) return;
      setSituacao(dados);
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [funcionarios]);

  useEffect(() => {
    let ativo = true;
    buscarPendenciasHistoricas().then((dados) => {
      if (ativo) setHistorico(dados);
    });
    return () => {
      ativo = false;
    };
  }, [recarregarHistorico]);

  // Regularização histórica agrupada por pessoa (a RPC já vem ordenada por
  // nome/data e só traz jornadas SEM pagamento ativo -- quando tudo estiver
  // quitado, a lista vem vazia e a seção não aparece). PIX vem do cadastro
  // já carregado, quando a pessoa está entre os ativos.
  const historicoPorPessoa = useMemo(() => {
    const cadastro = new Map(funcionarios.map((f) => [f.id, f]));
    const mapa = new Map();
    for (const j of historico.jornadas) {
      if (!mapa.has(j.funcionario_id)) {
        const f = cadastro.get(j.funcionario_id);
        mapa.set(j.funcionario_id, {
          funcionario: { id: j.funcionario_id, nome: j.funcionario_nome, tipo_vinculo: j.tipo_vinculo, tipo_chave_pix: f?.tipo_chave_pix, chave_pix: f?.chave_pix },
          jornadas: [],
        });
      }
      mapa.get(j.funcionario_id).jornadas.push(j);
    }
    return Array.from(mapa.values()).map((g) => ({ ...g, historico: { jornadas: g.jornadas } }));
  }, [historico, funcionarios]);
  const dataCorte = historico.jornadas[0]?.data_corte || null;

  const grupos = useMemo(() => agruparPorForma(funcionarios, situacao.formaAtual, situacao.comPorHora), [funcionarios, situacao]);
  const foraDaLista = useMemo(() => {
    if (!lancamentos.disponivel) return [];
    const comCartao = new Set([...grupos.porHora, ...grupos.mensal].map((f) => f.id));
    if (historico.disponivel) for (const g of historicoPorPessoa) if (idsAtivos.has(g.funcionario.id)) comCartao.add(g.funcionario.id);
    return pendentesForaDosBlocos(pendentesPorPessoa, comCartao);
  }, [lancamentos.disponivel, grupos, historico.disponivel, historicoPorPessoa, pendentesPorPessoa, idsAtivos]);

  if (carregando) return <p role="status">Carregando...</p>;

  return (
    <div className={estilosPagamentos.colunaSecoes}>
      {acoesLancamento.podeEditar && (
        <div className={estilosPagamentos.barraLancamentos}>
          <p className={estilosPagamentos.prevista}>Descontos e acréscimos pendentes aparecem dentro de cada pessoa e só entram no pagamento quando marcados.</p>
          <Button variante="secondary" tamanho="sm" icone="plus" onClick={() => acoesLancamento.novo('')}>
            Novo lançamento
          </Button>
        </div>
      )}

      {grupos.naoConfigurado.length > 0 && (
        <Alert tom="warning">
          <div className={estilosPagamentos.avisoCompacto}>
            <span>
              <strong>
                {grupos.naoConfigurado.length === 1 ? '1 pessoa ainda está sem configuração de pagamento.' : `${grupos.naoConfigurado.length} pessoas ainda estão sem configuração de pagamento.`}
              </strong>{' '}
              Configure a forma de remuneração para que {grupos.naoConfigurado.length === 1 ? 'ela apareça' : 'elas apareçam'} nos valores a pagar.
            </span>
            {onIrParaConfiguracoes && (
              <Button variante="secondary" tamanho="sm" onClick={onIrParaConfiguracoes}>
                Ir para Configurações
              </Button>
            )}
          </div>
        </Alert>
      )}

      <section aria-labelledby="titulo-por-hora">
        <h3 id="titulo-por-hora" className={estilosPagamentos.tituloSecao}>
          Por hora
        </h3>
        {grupos.porHora.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhum funcionário configurado como por hora.</p>
        ) : (
          <div className={estilosPagamentos.listaPessoas}>
            {grupos.porHora.map((f) => (
              <BlocoJornadas
                key={f.id}
                funcionario={f}
                formaAtual={situacao.formaAtual.get(f.id)}
                podeConfirmar={podeConfirmar}
                lancamentos={pendentesDe(f.id)}
                acoesLancamento={acoesLancamento}
                onPagamentoRegistrado={recarregarPendentes}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="titulo-mensal">
        <div className={estilosPagamentos.cabecalhoSecao}>
          <h3 id="titulo-mensal" className={estilosPagamentos.tituloSecao}>
            Mensal
          </h3>
          {grupos.mensal.length > 0 && (
            <label className={estilosPagamentos.campoCompetencia}>
              Competência
              <Input type="month" value={competencia.slice(0, 7)} onChange={(e) => e.target.value && setCompetencia(`${e.target.value}-01`)} aria-label="Competência" />
            </label>
          )}
        </div>
        {grupos.mensal.length > 0 && (
          <p className={estilosPagamentos.dicaCompetencia}>O cálculo mensal é feito por competência: escolha o mês acima para ver o saldo de cada pessoa nesse mês.</p>
        )}
        {grupos.mensal.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhum funcionário configurado como mensal.</p>
        ) : (
          <div className={estilosPagamentos.listaPessoas}>
            {grupos.mensal.map((f) => (
              <BlocoMensal
                key={f.id}
                funcionario={f}
                competencia={competencia}
                podeConfirmar={podeConfirmar}
                lancamentos={pendentesDe(f.id)}
                acoesLancamento={acoesLancamento}
                onPagamentoRegistrado={recarregarPendentes}
              />
            ))}
          </div>
        )}
      </section>

      {historico.disponivel && historicoPorPessoa.length > 0 && (
        <section aria-labelledby="titulo-regularizacao">
          <h3 id="titulo-regularizacao" className={estilosPagamentos.tituloSecao}>
            Regularização histórica
          </h3>
          <p className={estilosPagamentos.dicaCompetencia}>
            Jornadas da Escala anteriores a {dataCorte ? formatarDataCurta(dataCorte) + '/' + dataCorte.slice(0, 4) : 'início do valor/hora'}, ainda sem pagamento. Não há
            valor calculado: informe o valor a pagar de cada jornada. Esta seção some quando não houver mais pendências.
          </p>
          <div className={estilosPagamentos.listaPessoas}>
            {historicoPorPessoa.map(({ funcionario, historico: h }) => (
              <BlocoJornadas
                key={funcionario.id}
                funcionario={funcionario}
                podeConfirmar={podeConfirmar}
                historico={h}
                lancamentos={pendentesDe(funcionario.id)}
                acoesLancamento={acoesLancamento}
                onRegistrado={() => setRecarregarHistorico((n) => n + 1)}
                onPagamentoRegistrado={recarregarPendentes}
              />
            ))}
          </div>
        </section>
      )}

      <LancamentosForaDaLista grupos={foraDaLista} acoes={acoesLancamento} />

      {modalLancamento?.tipo === 'novo' && (
        <LancamentoModal
          key={`novo-${modalLancamento.funcionarioId}`}
          funcionarios={funcionarios}
          tipos={tiposLancamento}
          funcionarioInicialId={modalLancamento.funcionarioId}
          onFechar={() => setModalLancamento(null)}
          onSalvo={aoSalvarLancamento}
        />
      )}
      {modalLancamento?.tipo === 'editar' && (
        <LancamentoModal lancamento={modalLancamento.lancamento} funcionarios={funcionarios} tipos={tiposLancamento} onFechar={() => setModalLancamento(null)} onSalvo={aoSalvarLancamento} />
      )}
      {modalLancamento?.tipo === 'cancelar' && (
        <CancelarLancamentoModal lancamento={modalLancamento.lancamento} nomeFuncionaria={modalLancamento.nome} onFechar={() => setModalLancamento(null)} onCancelado={aoSalvarLancamento} />
      )}
    </div>
  );
}
