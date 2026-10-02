import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Input from '../ui/Input';
import IndicadorVinculo from './IndicadorVinculo';
import JornadaValorLinha from './JornadaValorLinha';
import PagamentoPorHoraModal from './PagamentoPorHoraModal';
import PagamentoMensalModal from './PagamentoMensalModal';
import { formatarDataCurta, rotuloDiaSemana } from '../../lib/funcionarios/escala';
import { inicioDoMes, dataLocalHoje } from '../../lib/data/dataLocal';
import { buscarSituacaoRemuneracaoEmLote, buscarPendenciasPorHora, buscarPendenciaMensal, buscarPendenciasHistoricas, formatarMoeda, formatarCompetencia } from '../../lib/funcionarios/pagamentos';
import { agruparPorForma, chaveJornada, resolverValorAPagar, somarValoresAPagar } from '../../lib/funcionarios/pagamentosCalculo';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

function formatarPrevista(data) {
  return data ? `${rotuloDiaSemana(data)} ${formatarDataCurta(data)}` : null;
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

// 1 funcionário com jornadas por hora: lista de jornadas pendentes (falta/
// atestado/folga/futuras já vêm excluídas pela RPC), cada uma com valor
// calculado e "Valor a pagar" editável (migration 0068), seleção de
// qualquer subconjunto (pagamento parcial) e "Incluir pagamento".
function FuncionarioPorHora({ funcionario, formaAtual, podeConfirmar }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [pendencias, setPendencias] = useState([]);
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

  function alternarAberto() {
    const novo = !aberto;
    setAberto(novo);
    setMensagemSucesso('');
    if (novo) carregar();
  }

  const jornadasSelecionadas = pendencias.filter((p) => sel.selecionadas.has(chaveJornada(p)));
  const totalSelecionado = somarValoresAPagar(jornadasSelecionadas, sel.digitados);
  const faltamValores = contarValoresFaltando(jornadasSelecionadas, sel.digitados);
  const semValorHora = pendencias.filter((p) => p.valor === null || p.valor === undefined).length;
  const todasSelecionadas = pendencias.length > 0 && jornadasSelecionadas.length === pendencias.length;
  const previstas = Array.from(new Set(pendencias.map((p) => p.data_prevista).filter(Boolean))).sort();

  function alternarTodas() {
    sel.setSelecionadas(todasSelecionadas ? new Set() : new Set(pendencias.map(chaveJornada)));
  }

  function aoConfirmarPagamento() {
    setModalAberto(false);
    setMensagemSucesso('Pagamento registrado com sucesso.');
    carregar();
  }

  return (
    <Card
      titulo={funcionario.nome}
      subtitulo={
        <span className={estilosPagamentos.infoConfiguracao}>
          <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />
          {formaAtual !== 'por_hora' && <Badge tom="warning">Hoje: {formaAtual === 'mensal' ? 'Mensal' : 'Não configurado'} — jornadas por hora anteriores</Badge>}
        </span>
      }
      acao={
        <Button variante="secondary" tamanho="sm" onClick={alternarAberto}>
          {aberto ? 'Ocultar' : 'Ver pendências'}
        </Button>
      }
    >
      {mensagemSucesso && <Alert tom="success">{mensagemSucesso}</Alert>}
      {aberto &&
        (carregando ? (
          <p role="status">Carregando...</p>
        ) : erro ? (
          <Alert tom="danger">{erro}</Alert>
        ) : pendencias.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhuma jornada pendente.</p>
        ) : (
          <>
            {previstas.length > 0 && (
              <p className={estilosPagamentos.prevista}>
                Data prevista de pagamento (só referência): {previstas.slice(0, 3).map(formatarPrevista).join(' · ')}
                {previstas.length > 3 ? ' …' : ''}
              </p>
            )}
            {semValorHora > 0 && (
              <p className={estilosPagamentos.prevista}>{semValorHora} jornada(s) sem valor/hora vigente na data: informe o valor a pagar de cada uma.</p>
            )}
            {pendencias.length > 1 && <Checkbox rotulo="Selecionar todas" checked={todasSelecionadas} onChange={alternarTodas} />}
            <ul className={estilosPagamentos.listaJornadas}>
              {pendencias.map((p) => (
                <JornadaValorLinha
                  key={chaveJornada(p)}
                  item={p}
                  selecionada={sel.selecionadas.has(chaveJornada(p))}
                  onAlternar={sel.alternar}
                  digitado={sel.digitados[chaveJornada(p)]}
                  onDigitar={sel.digitar}
                />
              ))}
            </ul>
            <div className={estilosPagamentos.rodapeSelecao}>
              <span>
                <strong>
                  Selecionado: {jornadasSelecionadas.length} jornada(s) — {formatarMoeda(totalSelecionado)}
                </strong>
                {faltamValores > 0 && <span className={estilosPagamentos.prevista}> · falta informar {faltamValores} valor(es)</span>}
              </span>
              {podeConfirmar && (
                <Button disabled={jornadasSelecionadas.length === 0 || faltamValores > 0} onClick={() => setModalAberto(true)}>
                  Incluir pagamento
                </Button>
              )}
            </div>
          </>
        ))}

      {modalAberto && (
        <PagamentoPorHoraModal
          funcionario={funcionario}
          jornadas={jornadasSelecionadas}
          digitados={sel.digitados}
          suporteValorManual={suporteValorManual}
          onFechar={() => setModalAberto(false)}
          onConfirmado={aoConfirmarPagamento}
        />
      )}
    </Card>
  );
}

// REGULARIZAÇÃO HISTÓRICA (migration 0068): jornadas da Escala anteriores
// à primeira vigência do valor/hora, de 1 pessoa -- independente da forma
// de remuneração (inclusive nenhuma). Sem valor calculado: o "Valor a
// pagar" de cada jornada é obrigatório. Não é pagamento por hora nem
// mensal (nunca usa R$/h nem saldo-base).
function FuncionarioHistorico({ funcionario, jornadas, podeConfirmar, onRegistrado }) {
  const [aberto, setAberto] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const sel = useSelecaoComValores();

  const selecionadas = jornadas.filter((j) => sel.selecionadas.has(chaveJornada(j)));
  const total = somarValoresAPagar(selecionadas, sel.digitados);
  const faltamValores = contarValoresFaltando(selecionadas, sel.digitados);
  const todas = jornadas.length > 0 && selecionadas.length === jornadas.length;

  function aoConfirmar() {
    setModalAberto(false);
    sel.limpar();
    setMensagemSucesso('Regularização registrada com sucesso.');
    onRegistrado();
  }

  return (
    <Card
      titulo={funcionario.nome}
      subtitulo={
        <span className={estilosPagamentos.infoConfiguracao}>
          {funcionario.tipo_vinculo && <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />}
          <Badge tom="warning">Regularização histórica</Badge>
          <span className={estilosPagamentos.prevista}>{jornadas.length} jornada(s)</span>
        </span>
      }
      acao={
        <Button
          variante="secondary"
          tamanho="sm"
          onClick={() => {
            setMensagemSucesso('');
            setAberto((v) => !v);
          }}
        >
          {aberto ? 'Ocultar' : 'Ver jornadas'}
        </Button>
      }
    >
      {mensagemSucesso && <Alert tom="success">{mensagemSucesso}</Alert>}
      {aberto && (
        <>
          {jornadas.length > 1 && (
            <Checkbox rotulo="Selecionar todas" checked={todas} onChange={() => sel.setSelecionadas(todas ? new Set() : new Set(jornadas.map(chaveJornada)))} />
          )}
          <ul className={estilosPagamentos.listaJornadas}>
            {jornadas.map((j) => (
              <JornadaValorLinha
                key={chaveJornada(j)}
                item={j}
                selecionada={sel.selecionadas.has(chaveJornada(j))}
                onAlternar={sel.alternar}
                digitado={sel.digitados[chaveJornada(j)]}
                onDigitar={sel.digitar}
              />
            ))}
          </ul>
          <div className={estilosPagamentos.rodapeSelecao}>
            <span>
              <strong>
                Selecionado: {selecionadas.length} jornada(s) — {formatarMoeda(total)}
              </strong>
              {faltamValores > 0 && <span className={estilosPagamentos.prevista}> · falta informar {faltamValores} valor(es)</span>}
            </span>
            {podeConfirmar && (
              <Button disabled={selecionadas.length === 0 || faltamValores > 0} onClick={() => setModalAberto(true)}>
                Registrar regularização
              </Button>
            )}
          </div>
        </>
      )}
      {modalAberto && (
        <PagamentoPorHoraModal
          modo="historico"
          funcionario={funcionario}
          jornadas={selecionadas}
          digitados={sel.digitados}
          onFechar={() => setModalAberto(false)}
          onConfirmado={aoConfirmar}
        />
      )}
    </Card>
  );
}

// 1 funcionário mensal: resumo da competência (base vigente, quanto da base
// já foi quitado por pagamentos ativos, saldo, faltas/atestados, data
// prevista) e extras remunerados pendentes com valor calculado e "Valor a
// pagar" editável. A remuneração-base nunca vira valor por jornada.
function FuncionarioMensal({ funcionario, podeConfirmar }) {
  const [competencia, setCompetencia] = useState(() => inicioDoMes(dataLocalHoje()));
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
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
    if (aberto) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, aberto]);

  const extrasDisponiveis = resumo?.extras_pendentes || [];
  const extrasSelecionadosLista = extrasDisponiveis.filter((e) => sel.selecionadas.has(chaveJornada(e)));
  const faltamValores = contarValoresFaltando(extrasSelecionadosLista, sel.digitados);
  const mensalNaCompetencia = resumo?.forma_vigente === 'mensal';
  const podeIncluir =
    mensalNaCompetencia && resumo?.valor_mensal_base !== null && (Number(resumo?.saldo_base) > 0 || extrasDisponiveis.length > 0) && faltamValores === 0;

  function aoConfirmarPagamento() {
    setModalAberto(false);
    setMensagemSucesso('Pagamento registrado com sucesso.');
    carregar();
  }

  return (
    <Card
      titulo={funcionario.nome}
      subtitulo={<IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />}
      acao={
        <div className={estilosEscala.navegacaoSemana}>
          <Input type="month" value={competencia.slice(0, 7)} onChange={(e) => e.target.value && setCompetencia(`${e.target.value}-01`)} aria-label="Competência" />
          <Button
            variante="secondary"
            tamanho="sm"
            onClick={() => {
              setMensagemSucesso('');
              setAberto((v) => !v);
            }}
          >
            {aberto ? 'Ocultar' : 'Ver competência'}
          </Button>
        </div>
      }
    >
      {mensagemSucesso && <Alert tom="success">{mensagemSucesso}</Alert>}
      {aberto &&
        (carregando ? (
          <p role="status">Carregando...</p>
        ) : erro ? (
          <Alert tom="danger">{erro}</Alert>
        ) : !resumo ? null : !mensalNaCompetencia ? (
          <Alert tom="warning">Este funcionário não estava configurado como mensal em {formatarCompetencia(competencia)}.</Alert>
        ) : resumo.valor_mensal_base === null ? (
          <Alert tom="warning">Não há remuneração-base mensal configurada para {formatarCompetencia(competencia)}. Configure em &quot;Configurações&quot;.</Alert>
        ) : (
          <>
            <div className={estilosPagamentos.resumoLinha}>
              <span>Remuneração-base ({formatarCompetencia(competencia)})</span>
              <strong>{formatarMoeda(resumo.valor_mensal_base)}</strong>
            </div>
            <div className={estilosPagamentos.resumoLinha}>
              <span>Já pago da base ({resumo.pagamentos_ativos_qtd} pagamento(s) ativo(s))</span>
              <span>{formatarMoeda(resumo.valor_base_ja_pago)}</span>
            </div>
            <div className={estilosPagamentos.resumoLinha}>
              <strong>Saldo da base</strong>
              <strong>{formatarMoeda(resumo.saldo_base)}</strong>
            </div>
            {resumo.data_prevista && (
              <div className={estilosPagamentos.resumoLinha}>
                <span>Data prevista (só referência)</span>
                <span>{formatarPrevista(resumo.data_prevista)}</span>
              </div>
            )}
            {(resumo.faltas_qtd > 0 || resumo.atestados_qtd > 0) && (
              <div className={estilosPagamentos.resumoLinha}>
                <span>
                  Faltas: {resumo.faltas_qtd} · Atestados: {resumo.atestados_qtd}
                </span>
                {resumo.sugestao_desconto_falta !== null && <span>Sugestão de desconto por falta: {formatarMoeda(resumo.sugestao_desconto_falta)}</span>}
              </div>
            )}

            {extrasDisponiveis.length > 0 && (
              <>
                <h4>Extras remunerados pendentes</h4>
                <ul className={estilosPagamentos.listaJornadas}>
                  {extrasDisponiveis.map((e) => (
                    <JornadaValorLinha
                      key={chaveJornada(e)}
                      item={e}
                      extra
                      selecionada={sel.selecionadas.has(chaveJornada(e))}
                      onAlternar={sel.alternar}
                      digitado={sel.digitados[chaveJornada(e)]}
                      onDigitar={sel.digitar}
                    />
                  ))}
                </ul>
              </>
            )}

            {podeConfirmar && (
              <div className={estilosPagamentos.rodapeSelecao}>
                <span>
                  {extrasSelecionadosLista.length > 0 ? `${extrasSelecionadosLista.length} extra(s) selecionado(s)` : ''}
                  {faltamValores > 0 && <span className={estilosPagamentos.prevista}> · falta informar {faltamValores} valor(es)</span>}
                </span>
                <Button disabled={!podeIncluir} onClick={() => setModalAberto(true)}>
                  Incluir pagamento
                </Button>
              </div>
            )}
          </>
        ))}

      {modalAberto && resumo && (
        <PagamentoMensalModal
          funcionario={funcionario}
          competencia={competencia}
          resumo={resumo}
          extras={extrasSelecionadosLista}
          digitados={sel.digitados}
          suporteValorManual={suporteValorManual}
          onFechar={() => setModalAberto(false)}
          onConfirmado={aoConfirmarPagamento}
        />
      )}
    </Card>
  );
}

export default function PagamentosAPagarVisao({ funcionarios, podeConfirmar, onIrParaConfiguracoes }) {
  const [situacao, setSituacao] = useState({ formaAtual: new Map(), comPorHora: new Set() });
  const [historico, setHistorico] = useState({ disponivel: false, jornadas: [] });
  const [carregando, setCarregando] = useState(true);
  const [recarregarHistorico, setRecarregarHistorico] = useState(0);

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

  // Agrupa por pessoa (a RPC já vem ordenada por nome/data). Inclui quem
  // não tem forma de remuneração cadastrada.
  const historicoPorPessoa = useMemo(() => {
    const mapa = new Map();
    for (const j of historico.jornadas) {
      if (!mapa.has(j.funcionario_id)) {
        mapa.set(j.funcionario_id, { funcionario: { id: j.funcionario_id, nome: j.funcionario_nome, tipo_vinculo: j.tipo_vinculo }, jornadas: [] });
      }
      mapa.get(j.funcionario_id).jornadas.push(j);
    }
    return Array.from(mapa.values());
  }, [historico]);
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
          <div className={estilosPagamentos.listaCards}>
            {grupos.porHora.map((f) => (
              <FuncionarioPorHora key={f.id} funcionario={f} formaAtual={situacao.formaAtual.get(f.id)} podeConfirmar={podeConfirmar} />
            ))}
          </div>
        )}
      </section>

      {historico.disponivel && historicoPorPessoa.length > 0 && (
        <section>
          <h3 className={estilosPagamentos.tituloSecao}>Regularização histórica</h3>
          <p className={estilosPagamentos.prevista}>
            Jornadas da Escala anteriores a {dataCorte ? formatarDataCurta(dataCorte) + '/' + dataCorte.slice(0, 4) : 'início do valor/hora'} (antes do primeiro valor/hora
            cadastrado). Não há valor calculado: informe o valor a pagar de cada jornada. Não altera forma de remuneração nem saldo mensal.
          </p>
          <div className={estilosPagamentos.listaCards}>
            {historicoPorPessoa.map(({ funcionario, jornadas }) => (
              <FuncionarioHistorico
                key={funcionario.id}
                funcionario={funcionario}
                jornadas={jornadas}
                podeConfirmar={podeConfirmar}
                onRegistrado={() => setRecarregarHistorico((n) => n + 1)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className={estilosPagamentos.tituloSecao}>Mensal</h3>
        {grupos.mensal.length === 0 ? (
          <p className={estilosPagamentos.vazio}>Nenhum funcionário configurado como mensal.</p>
        ) : (
          <div className={estilosPagamentos.listaCards}>
            {grupos.mensal.map((f) => (
              <FuncionarioMensal key={f.id} funcionario={f} podeConfirmar={podeConfirmar} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
