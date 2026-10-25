import { Fragment, useEffect, useMemo, useState } from 'react';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { buscarEscalaPeriodo, ROTULO_DIA_SEMANA, formatarDataCurta, formatarPeriodoSemana, formatarHora, inicioDaSemana } from '../../lib/funcionarios/escala';
import { resolverCoberturaPeriodo } from '../../lib/funcionarios/escalaCobertura';
import { nomeCompactoEscala } from '../../lib/funcionarios/escalaNomes';
import { agruparPorCargo, rotuloQuantidadeFuncionarias } from '../../lib/funcionarios/escalaGrupos';
import { filtrarFuncionariosEscala, funcionariosDoCargo, descreverFiltroEscala } from '../../lib/funcionarios/escalaFiltro';
import { montarExportacaoCobertura, basesDeCobertura } from '../../lib/funcionarios/escalaExportacao';
import { exportarRelatorio } from '../../lib/exportacao/exportar';
import { cx } from '../../lib/design/cx';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';
import IndicadorVinculo from './IndicadorVinculo';
import EscalaFiltrosExportacao from './EscalaFiltrosExportacao';
import { useFeriadosPeriodo, AvisoErroFeriados, MarcaFeriado, LegendaFeriados } from './EscalaFeriados';
import { ListaFaixasCobertura } from './EscalaCoberturaDiaModal';
import { NavegacaoCompacta, SeletorDia } from './EscalaCompacta';
import { useMediaQuery } from '../../lib/design/useMediaQuery';
import { MQ_ESCALA_COMPACTA, diaSelecionadoNaLista } from '../../lib/funcionarios/escalaMobile';
import { useFiltrosPersistidos } from '../../lib/filtros/useFiltrosPersistidos';
import { filtrosEscalaPorHora } from '../../lib/filtros/telas';
import estilos from './escala.module.css';

const MAX_DIAS = 7;
const JANELA_PADRAO = { inicio: 6 * 60, fim: 20 * 60 }; // 06:00-20:00, fallback sem nenhum período no período exibido

// Larguras FIXAS (não "fr"/flexíveis) da grade da Cobertura -- cada dia
// mantém a mesma largura/legibilidade não importa quantos dias estejam
// selecionados (seção "IMPORTANTE" da instrução aprovada). LARGURA_DIA
// reaproveita o mesmo valor que já tinha dado boa densidade de leitura no
// desenho anterior (1 dia = referência aprovada); LARGURA_FUNCIONARIO
// ampliada de 128px para nunca cortar nomes (sugestão 190-220px).
const LARGURA_FUNCIONARIO = 200;
const LARGURA_VINCULO = 40;
const LARGURA_DIA = 640;

function minutosDesde(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pct(minutos, janela) {
  return ((minutos - janela.inicio) / (janela.fim - janela.inicio)) * 100;
}

// Todas as datas (inclusive) entre inicio e fim. A guarda (MAX_DIAS) é só
// uma rede de segurança contra loop infinito se algo além de
// normalizarIntervalo chamar isto com um intervalo inválido -- a validação
// real de tamanho mora em normalizarIntervalo, via contagem SEM essa
// guarda (ver comentário lá: um bug real já existiu aqui por causa disso).
function intervaloDeDias(inicio, fim) {
  const dias = [];
  let cursor = inicio;
  let guarda = 0;
  while (cursor <= fim && guarda < MAX_DIAS) {
    dias.push(cursor);
    cursor = somarDias(cursor, 1);
    guarda++;
  }
  return dias;
}

// Dias desde uma referência arbitrária, só para SUBTRAIR e obter a
// contagem de dias entre duas datas -- nunca usado como data real.
function numeroDeDias(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-').map(Number);
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

// Garante fim >= início e no máximo MAX_DIAS dias (seção "PERÍODO
// PERSONALIZADO" da instrução aprovada) -- nunca deixa a UI entrar num
// intervalo inválido ou grande demais para a timeline continuar legível.
// BUG CORRIGIDO nesta rodada: a validação antes chamava
// intervaloDeDias(inicio, f).length > MAX_DIAS, mas intervaloDeDias tem sua
// própria guarda em MAX_DIAS -- o comprimento NUNCA passava de MAX_DIAS, e
// a condição nunca disparava. Um intervalo de 13 dias, por exemplo, ficava
// salvo sem cortar no estado (o campo "Data final" mostrava a data errada),
// só a grade renderizada é que aparecia truncada em 7 dias, sem nenhum
// aviso. Contagem agora feita por aritmética de dias, nunca pelo array
// capado.
function normalizarIntervalo(inicio, fim) {
  let f = fim < inicio ? inicio : fim;
  const diasNoIntervalo = numeroDeDias(f) - numeroDeDias(inicio) + 1;
  if (diasNoIntervalo > MAX_DIAS) f = somarDias(inicio, MAX_DIAS - 1);
  return { inicio, fim: f };
}

// Janela horária COMPARTILHADA pelo período inteiro (mesmo eixo em todos os
// dias exibidos, para comparar cobertura de um dia para o outro) -- min/max
// real arredondado para a hora cheia, nunca um bloco artificial.
function calcularJanelaHoraria(todosOsPeriodos) {
  if (todosOsPeriodos.length === 0) return JANELA_PADRAO;
  let min = Infinity;
  let max = -Infinity;
  for (const p of todosOsPeriodos) {
    const hi = minutosDesde(formatarHora(p.horaInicio));
    const hf = minutosDesde(formatarHora(p.horaFim));
    if (hi < min) min = hi;
    if (hf > max) max = hf;
  }
  return { inicio: Math.floor(min / 60) * 60, fim: Math.ceil(max / 60) * 60 };
}

// Cabeçalho de UM dia: rótulo (dia da semana + data) + eixo de horas em
// miniatura -- o eixo aparece só AQUI, nunca repetido linha a linha (seção
// "evitar repetição desnecessária" da instrução aprovada).
// nomeFeriado (opcional): "F*" ao lado da data (balão com o nome no
// hover/foco) -- só informação, não muda nenhum cálculo da cobertura.
function CabecalhoDiaCobertura({ data, janela, nomeFeriado }) {
  const indice = new Date(`${data}T12:00:00`).getDay();
  const horas = [];
  for (let m = janela.inicio; m <= janela.fim; m += 60) horas.push(m);
  return (
    <div className={estilos.cabecalhoDiaCobertura}>
      <strong>{ROTULO_DIA_SEMANA[indice]} {formatarDataCurta(data)}</strong>
      <MarcaFeriado nome={nomeFeriado} />
      <div className={estilos.eixoHorarioCobertura}>
        {horas.map((m) => (
          <span key={m} className={estilos.marcaHoraCobertura} style={{ left: `${pct(m, janela)}%` }}>
            {String(Math.floor(m / 60)).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}

// Trilha de UM funcionário em UM dia -- período previsto sempre desenhado
// (mesmo com falta/atestado, que ganham tratamento visual + texto próprio,
// nunca só cor). Folga vira um selo curto, sem barra. Ausência de estado
// (funcionário sem escala aquele dia) = trilha vazia, sem poluir.
function TrilhaFuncionarioDia({ item, janela }) {
  if (!item) return <div className={estilos.trilhaCobertura} />;
  const temOcorrencia = !!item.ocorrencia;
  return (
    <div className={estilos.trilhaCobertura}>
      {item.tipo === 'folga' ? (
        <span className={estilos.chipFolgaCobertura}>Folga</span>
      ) : (
        item.periodos.map((p, i) => {
          const inicio = minutosDesde(formatarHora(p.hora_inicio));
          const fim = minutosDesde(formatarHora(p.hora_fim));
          return (
            <span
              key={i}
              className={temOcorrencia ? estilos.barraCoberturaAusente : estilos.barraCoberturaTrabalho}
              style={{ left: `${pct(inicio, janela)}%`, width: `${pct(fim, janela) - pct(inicio, janela)}%` }}
              title={`${formatarHora(p.hora_inicio)}–${formatarHora(p.hora_fim)}${temOcorrencia ? ` · ${item.ocorrencia.tipo === 'falta' ? 'Falta' : 'Atestado'}` : ''}`}
            >
              {temOcorrencia ? (item.ocorrencia.tipo === 'falta' ? 'Falta' : 'Atestado') : `${formatarHora(p.hora_inicio)}–${formatarHora(p.hora_fim)}`}
            </span>
          );
        })
      )}
    </div>
  );
}

// Trilha de cobertura agregada de UM dia -- reaproveita calcularFaixasCobertura
// (motor único), só posiciona os segmentos já calculados proporcionalmente.
// Respeita as transições REAIS de horário (nunca manhã/tarde genérico).
function TrilhaCoberturaDia({ faixas, janela }) {
  return (
    <div className={cx(estilos.trilhaCobertura, estilos.trilhaCoberturaTotal)}>
      {faixas.map((f, i) => {
        const inicio = minutosDesde(f.inicio);
        const fim = minutosDesde(f.fim);
        return (
          <span
            key={i}
            className={estilos.segmentoCoberturaTotal}
            style={{ left: `${pct(inicio, janela)}%`, width: `${pct(fim, janela) - pct(inicio, janela)}%` }}
            title={`${f.inicio}–${f.fim}: ${f.efetivos.length} pessoa(s)`}
          >
            {f.efetivos.length}
          </span>
        );
      })}
    </div>
  );
}

// "Cobertura" (dimensionamento operacional -- seção 2 da instrução
// aprovada): UMA timeline contínua para todo o período selecionado, nunca
// um mini-Gantt repetido por dia. Funcionário fixo nas linhas, dias lado a
// lado nas colunas, cada um com sua própria faixa temporal proporcional
// (mesma janela horária para todos, calculada sobre o período inteiro).
// Somente leitura. Todo o cálculo vem do motor único de cobertura
// (lib/funcionarios/escalaCobertura.js) -- este componente só organiza e
// posiciona.
//
// Organizada por CARGO sobre a população dos filtros Cargo/Funcionária:
// uma grade só, com o título de cada cargo exibido, as trilhas das
// funcionárias dele e a linha "Cobertura · cargo"; no fim, "Cobertura
// geral". Semântica dos filtros (a publicada antes desta frente): a BASE
// do cálculo é a equipe do recorte de CARGO; o filtro de FUNCIONÁRIA só
// restringe as linhas individuais -- a cobertura nunca "vira 1" porque uma
// pessoa foi filtrada. Com um único cargo na base, só a geral (seria
// repetida). A janela horária é a da base: todos os grupos usam o mesmo
// eixo e continuam comparáveis.
// Período padrão = semana OPERACIONAL corrente (segunda a domingo), a
// mesma da visão Semanal -- inicioDaSemana de lib/funcionarios/escala.js.
function inicioDaSemanaCorrente(data) {
  return inicioDaSemana(data);
}

export default function EscalaPorHora({ funcionarios, cargos, filtro, onFiltroChange }) {
  // Período (e dia escolhido no celular) guardados durante a sessão de
  // login: sem nada salvo abre na semana corrente e, daí em diante, fica
  // onde o usuário deixou (não avança sozinho quando vira o dia).
  const periodo = useFiltrosPersistidos('escala.cobertura', filtrosEscalaPorHora({ semanaAtual: inicioDaSemanaCorrente(dataLocalHoje()) }));
  const { dataInicio, dataFim, diaEscolhido } = periodo.valores;
  const { definir: definirPeriodo } = periodo;
  const [mapaEscala, setMapaEscala] = useState(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const dias = useMemo(() => intervaloDeDias(dataInicio, dataFim), [dataInicio, dataFim]);

  // Celular/tablet pequeno: UM dia do período por vez (seletor de dia), na
  // largura da tela -- mesmas trilhas, mesmo motor e mesma janela horária.
  const compacta = useMediaQuery(MQ_ESCALA_COMPACTA);
  const setDiaEscolhido = (valor) => definirPeriodo('diaEscolhido', valor);
  const diaAtivo = diaSelecionadoNaLista(dias, dataLocalHoje(), diaEscolhido);

  // Base do cálculo (recorte de cargo) x linhas exibidas (cargo +
  // funcionária), ambas agrupadas por cargo.
  const gruposBase = useMemo(() => agruparPorCargo(funcionariosDoCargo(funcionarios, filtro.cargoId)), [filtro.cargoId, funcionarios]);
  const funcionariosExibidos = useMemo(() => filtrarFuncionariosEscala(funcionarios, filtro), [filtro, funcionarios]);
  const grupos = useMemo(() => agruparPorCargo(funcionariosExibidos), [funcionariosExibidos]);
  const filtroDescricao = descreverFiltroEscala(filtro, { cargos, funcionarios });
  const { feriados, erroFeriados } = useFeriadosPeriodo(dias[0], dias[dias.length - 1]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const mapa = await buscarEscalaPeriodo(funcionarios.map((f) => f.id), dias[0], dias[dias.length - 1]);
        if (!ativo) return;
        setMapaEscala(mapa);
      } catch {
        if (!ativo) return;
        // Nunca mostra uma escala incompleta.
        setMapaEscala(null);
        setErro('Não foi possível carregar a escala. Atualize a página para tentar novamente.');
      }
      if (ativo) setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataInicio, dataFim, funcionarios]);

  // Resolve 1x por dia exibido e por BASE (motor único,
  // resolverCoberturaPeriodo): a geral (equipe toda) dá as trilhas
  // individuais, a janela horária e a "Cobertura geral"; cada cargo dá a
  // sua linha de cobertura. Mesmas bases da exportação (basesDeCobertura).
  const { porFuncionarioEDia, faixasGerais, faixasPorCargo, janela } = useMemo(() => {
    if (!mapaEscala) return { porFuncionarioEDia: new Map(), faixasGerais: new Map(), faixasPorCargo: new Map(), janela: JANELA_PADRAO };
    const [geral, ...porCargo] = basesDeCobertura(gruposBase, grupos);
    const resolvidaGeral = resolverCoberturaPeriodo({ funcionarios: geral.funcionarios, mapaEscala, dias });
    const faixasCargo = new Map();
    for (const base of porCargo) {
      faixasCargo.set(base.chave, resolverCoberturaPeriodo({ funcionarios: base.funcionarios, mapaEscala, dias }).faixasPorDia);
    }
    return {
      porFuncionarioEDia: resolvidaGeral.porFuncionarioEDia,
      faixasGerais: resolvidaGeral.faixasPorDia,
      faixasPorCargo: faixasCargo,
      janela: calcularJanelaHoraria(resolvidaGeral.todosOsPeriodos),
    };
  }, [dias, grupos, gruposBase, mapaEscala]);

  function exportar(formato) {
    const modelo = montarExportacaoCobertura({ dias, grupos, gruposBase, mapaEscala, filtroDescricao, feriados });
    return exportarRelatorio(modelo, formato);
  }

  function aoMudarDataInicio(novoValor) {
    const { inicio, fim } = normalizarIntervalo(novoValor, dataFim);
    definirPeriodo({ dataInicio: inicio, dataFim: fim });
  }

  function aoMudarDataFim(novoValor) {
    const { inicio, fim } = normalizarIntervalo(dataInicio, novoValor);
    definirPeriodo({ dataInicio: inicio, dataFim: fim });
  }

  // Período de 7 dias -> volta à semana operacional corrente (segunda a
  // domingo). Período personalizado menor -> começa hoje, mesmo tamanho.
  function irParaHoje() {
    const span = Math.max(dias.length, 1);
    const hoje = dataLocalHoje();
    const base = span === MAX_DIAS ? inicioDaSemanaCorrente(hoje) : hoje;
    const { inicio, fim } = normalizarIntervalo(base, somarDias(base, span - 1));
    definirPeriodo({ dataInicio: inicio, dataFim: fim });
  }

  function deslocarPeriodo(sinal) {
    const span = Math.max(dias.length, 1);
    definirPeriodo({ dataInicio: somarDias(dataInicio, sinal * span), dataFim: somarDias(dataFim, sinal * span) });
  }

  // Larguras FIXAS em px (nunca "fr") -- um grid com faixas flexíveis some
  // width:auto no container deixa o navegador comprimir as colunas abaixo
  // do mínimo pretendido quando a soma excede a viewport (era exatamente o
  // bug relatado: 7 dias ficavam espremidos). largura total EXPLÍCITA no
  // próprio grid força overflow real + scroll horizontal em vez de
  // encolher, e cada dia mantém a mesma largura sozinho ou com 7 dias.
  const numDias = Math.max(dias.length, 1);
  const gridColunas = `${LARGURA_FUNCIONARIO}px ${LARGURA_VINCULO}px repeat(${numDias}, ${LARGURA_DIA}px)`;
  const larguraTotalGrid = LARGURA_FUNCIONARIO + LARGURA_VINCULO + numDias * LARGURA_DIA;
  const temPorCargo = faixasPorCargo.size > 0;
  // Rótulo da linha geral: "Cobertura geral" com vários cargos na base; com
  // um só (ex.: filtro de cargo), "Cobertura".
  const rotuloGeral = temPorCargo ? 'Cobertura geral' : 'Cobertura';

  const exportacao = (
    <EscalaFiltrosExportacao
      cargos={cargos}
      funcionarios={funcionarios}
      filtro={filtro}
      onFiltroChange={onFiltroChange}
      rotuloVisao="Cobertura"
      onExportar={exportar}
      desabilitarExportacao={carregando || !mapaEscala || dias.length === 0 || funcionariosExibidos.length === 0}
    />
  );

  return (
    <>
      {compacta ? (
        <div className={estilos.cabecalhoCompacto}>
          <NavegacaoCompacta
            titulo={dias.length > 0 ? formatarPeriodoSemana(dias) : ''}
            rotuloAnterior="Período anterior"
            rotuloProximo="Próximo período"
            onAnterior={() => deslocarPeriodo(-1)}
            onHoje={irParaHoje}
            onProximo={() => deslocarPeriodo(1)}
          />
          <div className={estilos.grupoCompacto}>{exportacao}</div>
        </div>
      ) : (
        <div className={estilos.cabecalhoSemana}>
          <div className={estilos.navegacaoSemana}>
            <Button variante="secondary" tamanho="sm" onClick={() => deslocarPeriodo(-1)}>← Período anterior</Button>
            <Button variante="secondary" tamanho="sm" onClick={irParaHoje}>Hoje</Button>
            <Button variante="secondary" tamanho="sm" onClick={() => deslocarPeriodo(1)}>Próximo período →</Button>
          </div>
          <h3 className={estilos.tituloSemana}>{dias.length > 0 ? formatarPeriodoSemana(dias) : ''}</h3>
          {exportacao}
        </div>
      )}

      <div className={estilos.controlesPeriodo}>
        <label className={estilos.campoData}>
          Data inicial
          <Input type="date" value={dataInicio} onChange={(e) => aoMudarDataInicio(e.target.value)} aria-label="Data inicial" />
        </label>
        <label className={estilos.campoData}>
          Data final
          <Input type="date" value={dataFim} onChange={(e) => aoMudarDataFim(e.target.value)} aria-label="Data final" />
        </label>
        <span className={estilos.notaOcorrencia}>Máximo de {MAX_DIAS} dias por análise.</span>
      </div>

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
      <AvisoErroFeriados visivel={erroFeriados} />

      {filtro.funcionarioId && funcionariosExibidos.length > 0 && (
        <p className={estilos.notaOcorrencia}>
          A linha <strong>{rotuloGeral}</strong> continua contando toda a equipe ({filtroDescricao.cargo ? `cargo ${filtroDescricao.cargo}` : 'todos os cargos'}) -- o filtro de funcionária só restringe as linhas individuais.
        </p>
      )}

      {compacta && dias.length > 1 && <SeletorDia dias={dias} valor={diaAtivo} onEscolher={setDiaEscolhido} feriados={feriados} />}

      {carregando || dias.length === 0 ? (
        <p role="status">Carregando escala...</p>
      ) : !mapaEscala ? null : funcionariosExibidos.length === 0 ? (
        <p className={estilos.notaOcorrencia}>Nenhum funcionário para este filtro.</p>
      ) : compacta ? (
        <div className={estilos.coberturaCompacta}>
          <div className={estilos.timelineCompacta}>
            <span className={estilos.cantoCompacto} />
            <CabecalhoDiaCobertura data={diaAtivo} janela={janela} nomeFeriado={feriados.get(diaAtivo)} />
            {grupos.map((grupo) => (
              <Fragment key={grupo.chave}>
                <TituloGrupoCobertura grupo={grupo} />
                {grupo.funcionarios.map((funcionario) => (
                  <Fragment key={funcionario.id}>
                    <span className={estilos.nomeCompacto} title={funcionario.nome}>
                      <span className={estilos.nomeCompactoTexto}>{nomeCompactoEscala(funcionario.nome)}</span>
                      <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />
                    </span>
                    <TrilhaFuncionarioDia item={porFuncionarioEDia.get(diaAtivo)?.get(funcionario.id) || null} janela={janela} />
                  </Fragment>
                ))}
                {faixasPorCargo.has(grupo.chave) && (
                  <>
                    <span className={cx(estilos.nomeCompacto, estilos.nomeCompactoTotal)} title={`Cobertura · ${grupo.nome}`}>
                      <strong className={estilos.nomeCompactoTexto}>Cobertura</strong>
                    </span>
                    <TrilhaCoberturaDia faixas={faixasPorCargo.get(grupo.chave).get(diaAtivo) || []} janela={janela} />
                  </>
                )}
              </Fragment>
            ))}
            <span className={cx(estilos.nomeCompacto, estilos.nomeCompactoTotal)}>
              <strong>{rotuloGeral}</strong>
            </span>
            <TrilhaCoberturaDia faixas={faixasGerais.get(diaAtivo) || []} janela={janela} />
          </div>
          <div className={estilos.secaoOcorrencia}>
            <h4 className={estilos.tituloOcorrencia}>{temPorCargo ? 'Cobertura geral por horário' : 'Cobertura por horário'}</h4>
            <ListaFaixasCobertura faixas={faixasGerais.get(diaAtivo) || []} />
          </div>
        </div>
      ) : (
        <div className={estilos.envolucroCobertura}>
          <div className={estilos.timelineCobertura} style={{ gridTemplateColumns: gridColunas, minWidth: `${larguraTotalGrid}px` }}>
            <span className={estilos.cantoCobertura} />
            <span className={estilos.cabecalhoVinculoCobertura} style={{ left: LARGURA_FUNCIONARIO }}>Vínculo</span>
            {dias.map((data) => (
              <CabecalhoDiaCobertura key={data} data={data} janela={janela} nomeFeriado={feriados.get(data)} />
            ))}

            {grupos.map((grupo) => (
              <Fragment key={grupo.chave}>
                <TituloGrupoCobertura grupo={grupo} />
                {grupo.funcionarios.map((funcionario) => (
                  <FragmentoLinhaFuncionario key={funcionario.id} funcionario={funcionario} dias={dias} porFuncionarioEDia={porFuncionarioEDia} janela={janela} />
                ))}
                {faixasPorCargo.has(grupo.chave) && (
                  <LinhaCobertura rotulo={`Cobertura · ${grupo.nome}`} dias={dias} faixasPorDia={faixasPorCargo.get(grupo.chave)} janela={janela} />
                )}
              </Fragment>
            ))}

            <LinhaCobertura rotulo={rotuloGeral} dias={dias} faixasPorDia={faixasGerais} janela={janela} />
          </div>
        </div>
      )}

      <p className={estilos.legenda}>Visão somente leitura -- para editar a escala, use a visão Semanal ou a Mensal.</p>
      <LegendaFeriados feriados={feriados} dias={dias} />
    </>
  );
}

// Título do cargo: UM filho do grid ocupando a linha inteira (grid-column
// 1 / -1); o texto fica preso à esquerda durante a rolagem horizontal.
function TituloGrupoCobertura({ grupo }) {
  return (
    <div className={estilos.grupoCobertura} role="heading" aria-level={4}>
      <span className={estilos.tituloGrupoCobertura}>
        <span className={estilos.tituloGrupoNome}>{grupo.nome}</span>
        <span className={estilos.tituloGrupoContagem}>{rotuloQuantidadeFuncionarias(grupo.funcionarios.length)}</span>
      </span>
    </div>
  );
}

// Linha de cobertura agregada (do cargo ou geral): rótulo fixo + vínculo
// vazio + 1 trilha por dia -- N+2 filhos diretos, como as linhas de
// funcionário (precisa bater com gridColunas).
function LinhaCobertura({ rotulo, dias, faixasPorDia, janela }) {
  return (
    <>
      <span className={cx(estilos.nomeCoberturaFixo, estilos.nomeCoberturaFixoTotal)} title={rotulo}>
        <strong className={estilos.nomeCoberturaTexto}>{rotulo}</strong>
      </span>
      <span className={cx(estilos.vinculoCobertura, estilos.vinculoCoberturaTotal)} style={{ left: LARGURA_FUNCIONARIO }} />
      {dias.map((data) => (
        <TrilhaCoberturaDia key={data} faixas={faixasPorDia.get(data) || []} janela={janela} />
      ))}
    </>
  );
}

// Uma linha de funcionário = nome fixo + vínculo fixo + 1 trilha por dia
// exibido -- extraído só para poder usar hooks/organização sem quebrar a
// sequência de filhos diretos do grid (nome + vínculo + as N trilhas
// continuam sendo N+2 filhos diretos em sequência, do jeito que o CSS Grid
// espera -- precisa bater exatamente com gridColunas, que também tem N+2
// entradas).
function FragmentoLinhaFuncionario({ funcionario, dias, porFuncionarioEDia, janela }) {
  return (
    <>
      <span className={estilos.nomeCoberturaFixo} title={funcionario.nome}>
        {nomeCompactoEscala(funcionario.nome)}
      </span>
      <span className={estilos.vinculoCobertura} style={{ left: LARGURA_FUNCIONARIO }}>
        <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />
      </span>
      {dias.map((data) => (
        <TrilhaFuncionarioDia key={data} item={porFuncionarioEDia.get(data)?.get(funcionario.id) || null} janela={janela} />
      ))}
    </>
  );
}
