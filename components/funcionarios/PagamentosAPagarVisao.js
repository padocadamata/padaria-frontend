import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Input from '../ui/Input';
import IndicadorVinculo from './IndicadorVinculo';
import PagamentoPorHoraModal from './PagamentoPorHoraModal';
import PagamentoMensalModal from './PagamentoMensalModal';
import { formatarDataCurta, formatarHora } from '../../lib/funcionarios/escala';
import { inicioDoMes, dataLocalHoje } from '../../lib/data/dataLocal';
import { buscarSituacaoRemuneracaoEmLote, buscarPendenciasPorHora, buscarPendenciaMensal, formatarMoeda, formatarCompetencia } from '../../lib/funcionarios/pagamentos';
import { agruparPorForma, chaveJornada, somarValores } from '../../lib/funcionarios/pagamentosCalculo';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

// 1 funcionário com jornadas por hora: lista de jornadas pendentes (falta/
// atestado/folga/futuras já vêm excluídas pela RPC), seleção de qualquer
// subconjunto (pagamento parcial) e "Incluir pagamento". Jornada sem
// valor/hora vigente na data aparece, mas não é selecionável.
function FuncionarioPorHora({ funcionario, formaAtual, podeConfirmar }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [pendencias, setPendencias] = useState([]);
  const [erro, setErro] = useState('');
  const [selecionadas, setSelecionadas] = useState(new Set());
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    const { pendencias: lista, erro: erroCarga } = await buscarPendenciasPorHora(funcionario.id);
    setPendencias(lista);
    setSelecionadas(new Set());
    if (erroCarga) setErro(erroCarga);
    setCarregando(false);
  }

  function alternarAberto() {
    const novo = !aberto;
    setAberto(novo);
    setMensagemSucesso('');
    if (novo) carregar();
  }

  function alternarSelecao(chave) {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  const pagaveis = pendencias.filter((p) => p.valor !== null && p.valor !== undefined);
  const semValorHora = pendencias.length - pagaveis.length;
  const jornadasSelecionadas = pagaveis.filter((p) => selecionadas.has(chaveJornada(p)));
  const totalSelecionado = somarValores(jornadasSelecionadas);
  const todasSelecionadas = pagaveis.length > 0 && jornadasSelecionadas.length === pagaveis.length;

  function alternarTodas() {
    setSelecionadas(todasSelecionadas ? new Set() : new Set(pagaveis.map(chaveJornada)));
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
            {semValorHora > 0 && (
              <Alert tom="warning">
                {semValorHora} jornada(s) sem valor/hora vigente na data (anteriores à primeira vigência). Cadastre a vigência em &quot;Configurações&quot; para poder pagá-las.
              </Alert>
            )}
            {pagaveis.length > 1 && (
              <Checkbox rotulo="Selecionar todas" checked={todasSelecionadas} onChange={alternarTodas} />
            )}
            <ul className={estilosPagamentos.listaJornadas}>
              {pendencias.map((p) => {
                const pagavel = p.valor !== null && p.valor !== undefined;
                return (
                  <li key={chaveJornada(p)}>
                    <Checkbox
                      rotulo={`${formatarDataCurta(p.data)} ${formatarHora(p.hora_inicio)}–${formatarHora(p.hora_fim)} (${p.duracao_minutos}min)${p.natureza_financeira === 'extra_remunerado' ? ' · extra' : ''} — ${pagavel ? `${formatarMoeda(p.valor)} (${formatarMoeda(p.valor_hora_aplicado)}/h)` : 'sem valor/hora'}`}
                      checked={selecionadas.has(chaveJornada(p))}
                      disabled={!pagavel}
                      onChange={() => alternarSelecao(chaveJornada(p))}
                    />
                  </li>
                );
              })}
            </ul>
            <div className={estilosPagamentos.rodapeSelecao}>
              <strong>
                Selecionado: {jornadasSelecionadas.length} jornada(s) — {formatarMoeda(totalSelecionado)}
              </strong>
              {podeConfirmar && (
                <Button disabled={jornadasSelecionadas.length === 0} onClick={() => setModalAberto(true)}>
                  Incluir pagamento
                </Button>
              )}
            </div>
          </>
        ))}

      {modalAberto && (
        <PagamentoPorHoraModal funcionario={funcionario} jornadas={jornadasSelecionadas} onFechar={() => setModalAberto(false)} onConfirmado={aoConfirmarPagamento} />
      )}
    </Card>
  );
}

// 1 funcionário mensal: resumo da competência (base vigente, quanto da base
// já foi quitado por pagamentos ativos, saldo, faltas/atestados, extras
// remunerados pendentes) e "Incluir pagamento". Vários pagamentos por
// competência são permitidos (adiantamento/parcial/complemento).
function FuncionarioMensal({ funcionario, podeConfirmar }) {
  const [competencia, setCompetencia] = useState(() => inicioDoMes(dataLocalHoje()));
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [extrasSelecionados, setExtrasSelecionados] = useState(new Set());
  const [modalAberto, setModalAberto] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    const { pendencia, erro: erroCarga } = await buscarPendenciaMensal(funcionario.id, competencia);
    setResumo(pendencia);
    setExtrasSelecionados(new Set());
    if (erroCarga) setErro(erroCarga);
    setCarregando(false);
  }

  useEffect(() => {
    if (aberto) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, aberto]);

  function alternarSelecao(chave) {
    setExtrasSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  const extrasDisponiveis = (resumo?.extras_pendentes || []).filter((e) => e.valor !== null && e.valor !== undefined);
  const extrasSemValorHora = (resumo?.extras_pendentes || []).length - extrasDisponiveis.length;
  const extrasSelecionadosLista = extrasDisponiveis.filter((e) => extrasSelecionados.has(chaveJornada(e)));
  const mensalNaCompetencia = resumo?.forma_vigente === 'mensal';
  const podeIncluir = mensalNaCompetencia && resumo?.valor_mensal_base !== null && (Number(resumo?.saldo_base) > 0 || extrasDisponiveis.length > 0);

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
            {(resumo.faltas_qtd > 0 || resumo.atestados_qtd > 0) && (
              <div className={estilosPagamentos.resumoLinha}>
                <span>
                  Faltas: {resumo.faltas_qtd} · Atestados: {resumo.atestados_qtd}
                </span>
                {resumo.sugestao_desconto_falta !== null && <span>Sugestão de desconto por falta: {formatarMoeda(resumo.sugestao_desconto_falta)}</span>}
              </div>
            )}

            {extrasSemValorHora > 0 && <Alert tom="warning">{extrasSemValorHora} extra(s) sem valor/hora vigente na data.</Alert>}
            {extrasDisponiveis.length > 0 && (
              <>
                <h4>Extras remunerados pendentes</h4>
                <ul className={estilosPagamentos.listaJornadas}>
                  {extrasDisponiveis.map((e) => (
                    <li key={chaveJornada(e)}>
                      <Checkbox
                        rotulo={`${formatarDataCurta(e.data)} ${formatarHora(e.hora_inicio)}–${formatarHora(e.hora_fim)} (${e.duracao_minutos}min) — ${formatarMoeda(e.valor)}`}
                        checked={extrasSelecionados.has(chaveJornada(e))}
                        onChange={() => alternarSelecao(chaveJornada(e))}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            {podeConfirmar && (
              <div className={estilosPagamentos.rodapeSelecao}>
                <span>{extrasSelecionadosLista.length > 0 ? `${extrasSelecionadosLista.length} extra(s) selecionado(s)` : ''}</span>
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
          onFechar={() => setModalAberto(false)}
          onConfirmado={aoConfirmarPagamento}
        />
      )}
    </Card>
  );
}

export default function PagamentosAPagarVisao({ funcionarios, podeConfirmar, onIrParaConfiguracoes }) {
  const [situacao, setSituacao] = useState({ formaAtual: new Map(), comPorHora: new Set() });
  const [carregando, setCarregando] = useState(true);

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
