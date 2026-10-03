import { useEffect, useMemo, useState } from 'react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Icon from '../ui/Icon';
import IndicadorVinculo from './IndicadorVinculo';
import PagamentoPorHoraModal from './PagamentoPorHoraModal';
import PagamentoMensalModal from './PagamentoMensalModal';
import { formatarDataCurta, formatarHora, rotuloDiaSemana } from '../../lib/funcionarios/escala';
import { inicioDoMes, dataLocalHoje } from '../../lib/data/dataLocal';
import { buscarSituacaoRemuneracaoEmLote, buscarPendenciasPorHora, buscarPendenciaMensal, buscarPendenciasHistoricas, formatarMoeda, formatarCompetencia } from '../../lib/funcionarios/pagamentos';
import { agruparPorForma, chaveJornada, formatarValorEditavel, resolverValorAPagar, somarValoresAPagar } from '../../lib/funcionarios/pagamentosCalculo';
import { agruparPorCompetencia, descreverPendencias, descreverPix, plural, totalPendenteJornadas, totalPendenteMensal } from '../../lib/funcionarios/pagamentosApresentacao';
import { cx } from '../../lib/design/cx';
import estilosPagamentos from './pagamentos.module.css';

// Colunas fixas das tabelas Por hora / Mensal / Regularização: seleção |
// Data | Jornada | Duração | Valor calculado | Valor a pagar | Previsto.
const COLUNAS = 7;

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
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
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

// Tabela de uma modalidade: cabeçalho de colunas + blocos (um <tbody> por
// pessoa). Em tela estreita rola na horizontal -- nenhuma coluna some.
function TabelaPagamentos({ rotulo, colunaDescricao = 'Jornada', children }) {
  return (
    <div className={estilosPagamentos.tabelaEnvolucro}>
      <table className={estilosPagamentos.tabela} aria-label={rotulo}>
        <thead>
          <tr>
            <th className={estilosPagamentos.colSel}>
              <span className={estilosPagamentos.somenteLeitor}>Selecionar</span>
            </th>
            <th>Data</th>
            <th>{colunaDescricao}</th>
            <th className={estilosPagamentos.colNum}>Duração</th>
            <th className={estilosPagamentos.colNum}>Valor calculado</th>
            <th className={estilosPagamentos.colNum}>Valor a pagar</th>
            <th>Previsto</th>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

// Linha de cabeçalho da pessoa (sempre visível): seta para expandir/
// recolher, nome, vínculo, avisos, PIX (só leitura) e o total pendente --
// o MESMO valor da linha "Total a pagar" do bloco (mesma função), nunca um
// cálculo paralelo. A seleção "tudo" só aparece com o bloco aberto.
function LinhaFuncionario({ funcionario, extras, selecao, expandido, onAlternar, total, resumoTotal }) {
  const pix = descreverPix(funcionario);
  const rotulo = `${expandido ? 'Recolher' : 'Expandir'} ${funcionario.nome}`;
  return (
    <tr className={cx(estilosPagamentos.linhaFuncionario, expandido && estilosPagamentos.linhaFuncionarioAberta)}>
      <td className={estilosPagamentos.colSel}>
        <button type="button" className={estilosPagamentos.botaoExpandir} onClick={onAlternar} aria-expanded={expandido} aria-label={rotulo} title={rotulo}>
          <Icon nome={expandido ? 'chevronDown' : 'chevronRight'} tamanho={18} />
        </button>
      </td>
      {/* Cabeçalho do BLOCO (não segue as colunas das jornadas): uma célula
          só, com composição própria -- identificação | PIX | total | resumo. */}
      <td colSpan={COLUNAS - 1}>
        <div className={estilosPagamentos.cabecalhoBloco}>
          <span className={estilosPagamentos.identificacaoFuncionario}>
            {expandido && selecao && (
              <input type="checkbox" checked={selecao.todas} onChange={selecao.onAlternar} aria-label={`Selecionar tudo de ${funcionario.nome}`} />
            )}
            <button type="button" className={estilosPagamentos.nomeBotao} onClick={onAlternar} aria-expanded={expandido}>
              <strong className={estilosPagamentos.nomeFuncionario}>{funcionario.nome}</strong>
            </button>
            {funcionario.tipo_vinculo && <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />}
            {extras}
          </span>
          <span className={cx(estilosPagamentos.pix, !pix.cadastrado && estilosPagamentos.pixAusente)} title={pix.texto}>
            {pix.texto}
          </span>
          <span className={estilosPagamentos.totalCabecalho}>
            <span className={estilosPagamentos.rotuloTotalCabecalho}>Total a pagar:</span> <strong>{total}</strong>
          </span>
          <span className={estilosPagamentos.resumoCabecalho}>{resumoTotal}</span>
        </div>
      </td>
    </tr>
  );
}

// Separação discreta por mês dentro do bloco (só quando há mais de um).
function SeparadorCompetencia({ competencia }) {
  return (
    <tr className={estilosPagamentos.linhaSubtitulo}>
      <td />
      <td colSpan={COLUNAS - 1}>{formatarCompetencia(competencia)}</td>
    </tr>
  );
}

// 1 jornada (ou extra remunerado): valor calculado (sugestão) x "Valor a
// pagar" editável -- mesma regra da antiga JornadaValorLinha (0068).
function LinhaJornada({ item, sel, extra = false }) {
  const chave = chaveJornada(item);
  const temCalculo = item.valor !== null && item.valor !== undefined;
  const digitado = sel.digitados[chave];
  const textoCampo = digitado !== undefined ? digitado : formatarValorEditavel(item.valor);
  const r = resolverValorAPagar(item.valor ?? null, digitado);
  const ehExtra = extra || item.natureza_financeira === 'extra_remunerado';
  return (
    <tr className={estilosPagamentos.linhaDetalhe}>
      <td className={estilosPagamentos.colSel}>
        <input
          type="checkbox"
          checked={sel.selecionadas.has(chave)}
          onChange={() => sel.alternar(chave)}
          aria-label={`Selecionar ${formatarDataCurta(item.data)} ${formatarHora(item.hora_inicio)}`}
        />
      </td>
      <td className={estilosPagamentos.colData}>
        {rotuloDiaSemana(item.data)} {formatarDataCurta(item.data)}
      </td>
      <td>
        {formatarHora(item.hora_inicio)}–{formatarHora(item.hora_fim)}
        {ehExtra && <span className={estilosPagamentos.prevista}> · extra</span>}
      </td>
      <td className={estilosPagamentos.colNum}>{formatarDuracao(item.duracao_minutos)}</td>
      <td className={estilosPagamentos.colNum}>
        {temCalculo ? (
          <>
            {formatarMoeda(item.valor)}
            <span className={estilosPagamentos.valorHora}>{formatarMoeda(item.valor_hora_aplicado)}/h</span>
          </>
        ) : (
          <em className={estilosPagamentos.prevista}>não disponível</em>
        )}
      </td>
      <td className={estilosPagamentos.colNum}>
        <span className={estilosPagamentos.campoValor}>
          <Input
            inputMode="decimal"
            aria-label={`Valor a pagar ${formatarDataCurta(item.data)} ${formatarHora(item.hora_inicio)}`}
            placeholder={temCalculo ? formatarValorEditavel(item.valor) : 'Valor'}
            value={textoCampo}
            onChange={(e) => sel.digitar(chave, e.target.value)}
          />
          {r.invalido && <Badge tom="danger">inválido</Badge>}
          {!r.invalido && r.pendente && <Badge tom="warning">informe</Badge>}
          {!r.invalido && r.manual && <Badge tom="info">ajustado</Badge>}
        </span>
      </td>
      <td className={estilosPagamentos.prevista}>{item.data_prevista ? formatarDataCurta(item.data_prevista) : '—'}</td>
    </tr>
  );
}

function LinhaMensagem({ children, tom }) {
  return (
    <tr className={estilosPagamentos.linhaDetalhe}>
      <td />
      <td colSpan={COLUNAS - 1}>{tom ? <Alert tom={tom}>{children}</Alert> : <span className={estilosPagamentos.vazio}>{children}</span>}</td>
    </tr>
  );
}

// Linha de resumo (Mensal): descrição + valor alinhado na coluna "Valor a pagar".
function LinhaResumo({ descricao, valor, previsto, forte = false }) {
  return (
    <tr className={cx(estilosPagamentos.linhaDetalhe, forte && estilosPagamentos.linhaForte)}>
      <td />
      <td colSpan={4}>{descricao}</td>
      <td className={estilosPagamentos.colNum}>{valor}</td>
      <td className={estilosPagamentos.prevista}>{previsto || ''}</td>
    </tr>
  );
}

// Linha de total da pessoa + seleção e ação (Incluir pagamento).
function LinhaTotal({ total, observacao, selecao, acao, mensagem, modal }) {
  return (
    <tr className={estilosPagamentos.linhaTotal}>
      <td />
      <td colSpan={4}>
        <div className={estilosPagamentos.totalConteudo}>
          <span>
            <strong>Total a pagar</strong>
            {observacao && <span className={estilosPagamentos.prevista}> · {observacao}</span>}
          </span>
          <span className={estilosPagamentos.totalAcoes}>
            {mensagem && <span className={estilosPagamentos.mensagemSucesso}>{mensagem}</span>}
            {selecao && <span className={estilosPagamentos.prevista}>{selecao}</span>}
            {acao}
          </span>
        </div>
        {modal}
      </td>
      <td className={cx(estilosPagamentos.colNum, estilosPagamentos.valorTotal)}>{formatarMoeda(total)}</td>
      <td />
    </tr>
  );
}

// Bloco de 1 pessoa com jornadas por hora (ou regularização histórica):
// jornadas pendentes (falta/atestado/folga/futuras já vêm excluídas pela
// RPC), valor calculado e "Valor a pagar" editável (0068), seleção de
// qualquer subconjunto (pagamento parcial) e "Incluir pagamento".
// historico: jornadas já carregadas (RPC de regularização), sem valor
// calculado, modal em modo "historico".
function BlocoJornadas({ funcionario, formaAtual, podeConfirmar, historico = null, onRegistrado }) {
  const [expandido, setExpandido] = useState(false);
  const [carregando, setCarregando] = useState(!historico);
  const [pendencias, setPendencias] = useState(historico ? historico.jornadas : []);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [suporteValorManual, setSuporteValorManual] = useState(true);
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

  function alternarTodas() {
    sel.setSelecionadas(todasSelecionadas ? new Set() : new Set(pendencias.map(chaveJornada)));
  }

  function aoConfirmar() {
    setModalAberto(false);
    if (historico) {
      sel.limpar();
      setMensagemSucesso('Regularização registrada.');
      onRegistrado();
    } else {
      setMensagemSucesso('Pagamento registrado.');
      carregar();
    }
  }

  const avisos = historico ? (
    <Badge tom="warning">Regularização histórica</Badge>
  ) : (
    formaAtual !== 'por_hora' && <Badge tom="warning">Hoje: {formaAtual === 'mensal' ? 'Mensal' : 'Não configurado'} — jornadas por hora anteriores</Badge>
  );

  return (
    <tbody className={estilosPagamentos.blocoFuncionario}>
      <LinhaFuncionario
        funcionario={funcionario}
        extras={avisos}
        selecao={pendencias.length > 0 ? { todas: todasSelecionadas, onAlternar: alternarTodas } : null}
        expandido={expandido}
        onAlternar={() => setExpandido((v) => !v)}
        total={carregando ? '…' : erro ? '—' : total.semValor > 0 && total.total === 0 ? 'a informar' : formatarMoeda(total.total)}
        resumoTotal={
          carregando || erro
            ? ''
            : pendencias.length === 0
              ? descreverPendencias(0)
              : descreverPendencias(pendencias.length, meses.length)
        }
      />
      {expandido &&
        (carregando ? (
          <LinhaMensagem>Carregando...</LinhaMensagem>
        ) : erro ? (
          <LinhaMensagem tom="danger">{erro}</LinhaMensagem>
        ) : pendencias.length === 0 ? (
          <LinhaMensagem>Nenhuma jornada pendente.</LinhaMensagem>
        ) : (
          meses.map((m) => [
            meses.length > 1 && <SeparadorCompetencia key={`mes-${m.competencia}`} competencia={m.competencia} />,
            ...m.jornadas.map((p) => <LinhaJornada key={chaveJornada(p)} item={p} sel={sel} />),
          ])
        ))}
      {expandido && (
      <LinhaTotal
        total={total.total}
        observacao={
          [
            total.quantidade > 0 && descreverPendencias(total.quantidade, meses.length),
            total.semValor > 0 && `${plural(total.semValor, 'sem valor', 'sem valor')} — informe o valor a pagar`,
          ]
            .filter(Boolean)
            .join(' · ')
        }
        mensagem={mensagemSucesso}
        selecao={
          jornadasSelecionadas.length > 0
            ? `Selecionado: ${plural(jornadasSelecionadas.length, 'jornada', 'jornadas')} — ${formatarMoeda(totalSelecionado)}${faltamValores > 0 ? ` · falta informar ${plural(faltamValores, 'valor', 'valores')}` : ''}`
            : ''
        }
        acao={
          podeConfirmar &&
          pendencias.length > 0 && (
            <Button tamanho="sm" disabled={jornadasSelecionadas.length === 0 || faltamValores > 0} onClick={() => setModalAberto(true)}>
              {historico ? 'Registrar regularização' : 'Incluir pagamento'}
            </Button>
          )
        }
        modal={
          modalAberto && (
            <PagamentoPorHoraModal
              modo={historico ? 'historico' : undefined}
              funcionario={funcionario}
              jornadas={jornadasSelecionadas}
              digitados={sel.digitados}
              suporteValorManual={historico ? undefined : suporteValorManual}
              onFechar={() => setModalAberto(false)}
              onConfirmado={aoConfirmar}
            />
          )
        }
      />
      )}
    </tbody>
  );
}

// Bloco de 1 pessoa mensal na competência escolhida: remuneração-base, já
// pago, saldo, faltas/atestados, data prevista e extras remunerados
// pendentes (valor calculado + "Valor a pagar"). A base nunca vira valor
// por jornada.
function BlocoMensal({ funcionario, competencia, podeConfirmar }) {
  const [expandido, setExpandido] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [suporteValorManual, setSuporteValorManual] = useState(true);
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
  const podeIncluir = temBase && (Number(resumo?.saldo_base) > 0 || extrasDisponiveis.length > 0) && faltamValores === 0;
  const todasExtras = extrasDisponiveis.length > 0 && extrasSelecionados.length === extrasDisponiveis.length;
  const total = temBase ? totalPendenteMensal(resumo, sel.digitados) : { total: 0, semValor: 0, extras: 0 };

  function aoConfirmar() {
    setModalAberto(false);
    setMensagemSucesso('Pagamento registrado.');
    carregar();
  }

  return (
    <tbody className={estilosPagamentos.blocoFuncionario}>
      <LinhaFuncionario
        funcionario={funcionario}
        selecao={
          temBase && extrasDisponiveis.length > 0
            ? { todas: todasExtras, onAlternar: () => sel.setSelecionadas(todasExtras ? new Set() : new Set(extrasDisponiveis.map(chaveJornada))) }
            : null
        }
        expandido={expandido}
        onAlternar={() => setExpandido((v) => !v)}
        total={carregando ? '…' : temBase ? formatarMoeda(total.total) : '—'}
        resumoTotal={carregando || erro ? '' : !temBase ? 'Ver detalhes' : `Competência ${formatarCompetencia(competencia)}`}
      />
      {!expandido ? null : carregando ? (
        <LinhaMensagem>Carregando...</LinhaMensagem>
      ) : erro ? (
        <LinhaMensagem tom="danger">{erro}</LinhaMensagem>
      ) : !resumo ? null : !mensalNaCompetencia ? (
        <LinhaMensagem tom="warning">Não estava configurado(a) como mensal em {formatarCompetencia(competencia)}.</LinhaMensagem>
      ) : !temBase ? (
        <LinhaMensagem tom="warning">Sem remuneração-base mensal configurada para {formatarCompetencia(competencia)}. Configure em &quot;Configurações&quot;.</LinhaMensagem>
      ) : (
        <>
          <LinhaResumo descricao={`Remuneração-base (${formatarCompetencia(competencia)})`} valor={formatarMoeda(resumo.valor_mensal_base)} />
          <LinhaResumo
            descricao={`Já pago da base (${plural(resumo.pagamentos_ativos_qtd, 'pagamento ativo', 'pagamentos ativos')})`}
            valor={Number(resumo.valor_base_ja_pago) > 0 ? `− ${formatarMoeda(resumo.valor_base_ja_pago)}` : formatarMoeda(0)}
          />
          <LinhaResumo
            descricao="Saldo da base"
            valor={formatarMoeda(resumo.saldo_base)}
            previsto={resumo.data_prevista ? `${rotuloDiaSemana(resumo.data_prevista)} ${formatarDataCurta(resumo.data_prevista)}` : ''}
            forte
          />
          {(resumo.faltas_qtd > 0 || resumo.atestados_qtd > 0) && (
            <LinhaResumo
              descricao={`Faltas: ${resumo.faltas_qtd} · Atestados: ${resumo.atestados_qtd}`}
              valor={
                resumo.sugestao_desconto_falta !== null ? (
                  <span className={estilosPagamentos.prevista}>sugestão de desconto por falta: {formatarMoeda(resumo.sugestao_desconto_falta)}</span>
                ) : (
                  ''
                )
              }
            />
          )}
          {extrasDisponiveis.length > 0 && (
            <tr className={estilosPagamentos.linhaSubtitulo}>
              <td />
              <td colSpan={COLUNAS - 1}>Extras remunerados pendentes</td>
            </tr>
          )}
          {extrasDisponiveis.map((e) => (
            <LinhaJornada key={chaveJornada(e)} item={e} sel={sel} extra />
          ))}
        </>
      )}
      {expandido && (
      <LinhaTotal
        total={total.total}
        observacao={temBase ? `saldo da base${total.extras > 0 ? ` + ${plural(total.extras, 'extra', 'extras')}` : ''}${total.semValor > 0 ? ` · ${plural(total.semValor, 'extra sem valor', 'extras sem valor')}` : ''}` : ''}
        mensagem={mensagemSucesso}
        selecao={
          extrasSelecionados.length > 0
            ? `${plural(extrasSelecionados.length, 'extra selecionado', 'extras selecionados')}${faltamValores > 0 ? ` · falta informar ${plural(faltamValores, 'valor', 'valores')}` : ''}`
            : ''
        }
        acao={
          podeConfirmar &&
          temBase && (
            <Button tamanho="sm" disabled={!podeIncluir} onClick={() => setModalAberto(true)}>
              Incluir pagamento
            </Button>
          )
        }
        modal={
          modalAberto &&
          resumo && (
            <PagamentoMensalModal
              funcionario={funcionario}
              competencia={competencia}
              resumo={resumo}
              extras={extrasSelecionados}
              digitados={sel.digitados}
              suporteValorManual={suporteValorManual}
              onFechar={() => setModalAberto(false)}
              onConfirmado={aoConfirmar}
            />
          )
        }
      />
      )}
    </tbody>
  );
}

// Visão "A Pagar": Por hora e Mensal SEPARADOS, cada um numa tabela
// contínua com todas as pessoas da modalidade (bloco por pessoa: cabeçalho
// com nome/vínculo/PIX, linhas de detalhe e total). Nenhum cálculo novo:
// mesmas RPCs e os mesmos modais de pagamento de antes.
export default function PagamentosAPagarVisao({ funcionarios, podeConfirmar, onIrParaConfiguracoes }) {
  const [situacao, setSituacao] = useState({ formaAtual: new Map(), comPorHora: new Set() });
  const [historico, setHistorico] = useState({ disponivel: false, jornadas: [] });
  const [carregando, setCarregando] = useState(true);
  const [recarregarHistorico, setRecarregarHistorico] = useState(0);
  const [competencia, setCompetencia] = useState(() => inicioDoMes(dataLocalHoje()));

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

  if (carregando) return <p role="status">Carregando...</p>;

  return (
    <div className={estilosPagamentos.colunaSecoes}>
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

      <section>
        <h3 className={estilosPagamentos.tituloSecao}>Por hora</h3>
        {grupos.porHora.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhum funcionário configurado como por hora.</p>
        ) : (
          <TabelaPagamentos rotulo="Pagamentos por hora">
            {grupos.porHora.map((f) => (
              <BlocoJornadas key={f.id} funcionario={f} formaAtual={situacao.formaAtual.get(f.id)} podeConfirmar={podeConfirmar} />
            ))}
          </TabelaPagamentos>
        )}
      </section>

      <section>
        <div className={estilosPagamentos.cabecalhoSecao}>
          <h3 className={estilosPagamentos.tituloSecao}>Mensal</h3>
          {grupos.mensal.length > 0 && (
            <label className={estilosPagamentos.campoCompetencia}>
              Competência
              <Input type="month" value={competencia.slice(0, 7)} onChange={(e) => e.target.value && setCompetencia(`${e.target.value}-01`)} aria-label="Competência" />
            </label>
          )}
        </div>
        {grupos.mensal.length > 0 && (
          <p className={estilosPagamentos.dicaCompetencia}>
            O cálculo mensal é feito por competência: escolha o mês acima para ver o saldo de cada pessoa nesse mês.
          </p>
        )}
        {grupos.mensal.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhum funcionário configurado como mensal.</p>
        ) : (
          <TabelaPagamentos rotulo="Pagamentos mensais" colunaDescricao="Jornada / item">
            {grupos.mensal.map((f) => (
              <BlocoMensal key={f.id} funcionario={f} competencia={competencia} podeConfirmar={podeConfirmar} />
            ))}
          </TabelaPagamentos>
        )}
      </section>

      {historico.disponivel && historicoPorPessoa.length > 0 && (
        <section>
          <h3 className={estilosPagamentos.tituloSecao}>Regularização histórica</h3>
          <p className={estilosPagamentos.prevista}>
            Jornadas da Escala anteriores a {dataCorte ? formatarDataCurta(dataCorte) + '/' + dataCorte.slice(0, 4) : 'início do valor/hora'}, ainda sem pagamento. Não há
            valor calculado: informe o valor a pagar de cada jornada. Esta seção some quando não houver mais pendências.
          </p>
          <TabelaPagamentos rotulo="Regularização histórica">
            {historicoPorPessoa.map(({ funcionario, historico: h }) => (
              <BlocoJornadas
                key={funcionario.id}
                funcionario={funcionario}
                podeConfirmar={podeConfirmar}
                historico={h}
                onRegistrado={() => setRecarregarHistorico((n) => n + 1)}
              />
            ))}
          </TabelaPagamentos>
        </section>
      )}
    </div>
  );
}
