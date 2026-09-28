import { useEffect, useMemo, useState } from 'react';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { buscarEscalaPeriodo, ROTULO_DIA_SEMANA, formatarDataCurta, formatarPeriodoSemana, formatarHora } from '../../lib/funcionarios/escala';
import { resolverEstadosDoDia, calcularFaixasCobertura, obterPrimeiroNome } from '../../lib/funcionarios/escalaCobertura';
import { cx } from '../../lib/design/cx';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
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
function CabecalhoDiaCobertura({ data, janela }) {
  const indice = new Date(`${data}T12:00:00`).getDay();
  const horas = [];
  for (let m = janela.inicio; m <= janela.fim; m += 60) horas.push(m);
  return (
    <div className={estilos.cabecalhoDiaCobertura}>
      <strong>{ROTULO_DIA_SEMANA[indice]} {formatarDataCurta(data)}</strong>
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
// (lib/funcionarios/escalaCobertura.js), chamado 1x por dia exibido -- este
// componente só organiza e posiciona.
// Domingo da semana que contém `data` -- mesma convenção de inicioDaSemana
// em lib/funcionarios/escala.js, reimplementada aqui só para o default
// inicial (import evitado de propósito para não puxar diasDaSemana junto).
function inicioDaSemanaCorrente(data) {
  const indice = new Date(`${data}T12:00:00`).getDay();
  return somarDias(data, -indice);
}

export default function EscalaPorHora({ funcionarios, cargos }) {
  const [dataInicio, setDataInicio] = useState(() => inicioDaSemanaCorrente(dataLocalHoje()));
  const [dataFim, setDataFim] = useState(() => somarDias(inicioDaSemanaCorrente(dataLocalHoje()), 6));
  const [mapaEscala, setMapaEscala] = useState(new Map());
  const [carregando, setCarregando] = useState(true);
  const [cargoId, setCargoId] = useState('');

  const dias = useMemo(() => intervaloDeDias(dataInicio, dataFim), [dataInicio, dataFim]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      const idsFuncionarios = funcionarios.map((f) => f.id);
      const mapa = await buscarEscalaPeriodo(idsFuncionarios, dias[0], dias[dias.length - 1]);
      if (!ativo) return;
      setMapaEscala(mapa);
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataInicio, dataFim, funcionarios]);

  const funcionariosExibidos = useMemo(
    () => (cargoId ? funcionarios.filter((f) => f.cargo_id === cargoId) : funcionarios),
    [cargoId, funcionarios]
  );

  // Resolve 1x por dia exibido (motor único) e organiza os resultados para
  // consumo direto pela grade: quem cobre cada dia (por funcionario_id) e
  // as faixas de cobertura agregada daquele dia.
  const { porFuncionarioEDia, faixasPorDia, janela } = useMemo(() => {
    const porFuncionarioEDia = new Map(); // data -> Map<funcionario_id, item>
    const faixasPorDia = new Map(); // data -> faixas[]
    let todosOsPeriodos = [];

    for (const data of dias) {
      const estados = resolverEstadosDoDia({ funcionarios: funcionariosExibidos, mapaEscala, data });
      const porFuncionario = new Map();
      for (const item of estados.escalaIndividual) porFuncionario.set(item.funcionario.funcionario_id, item);
      porFuncionarioEDia.set(data, porFuncionario);
      faixasPorDia.set(data, calcularFaixasCobertura(estados.periodosPrevistos, estados.periodosEfetivos));
      todosOsPeriodos = todosOsPeriodos.concat(estados.periodosPrevistos, estados.periodosEfetivos);
    }

    return { porFuncionarioEDia, faixasPorDia, janela: calcularJanelaHoraria(todosOsPeriodos) };
  }, [dias, funcionariosExibidos, mapaEscala]);

  function aoMudarDataInicio(novoValor) {
    const { inicio, fim } = normalizarIntervalo(novoValor, dataFim);
    setDataInicio(inicio);
    setDataFim(fim);
  }

  function aoMudarDataFim(novoValor) {
    const { inicio, fim } = normalizarIntervalo(dataInicio, novoValor);
    setDataInicio(inicio);
    setDataFim(fim);
  }

  function irParaHoje() {
    const span = Math.max(dias.length, 1);
    const hoje = dataLocalHoje();
    const { inicio, fim } = normalizarIntervalo(hoje, somarDias(hoje, span - 1));
    setDataInicio(inicio);
    setDataFim(fim);
  }

  function deslocarPeriodo(sinal) {
    const span = Math.max(dias.length, 1);
    setDataInicio((atual) => somarDias(atual, sinal * span));
    setDataFim((atual) => somarDias(atual, sinal * span));
  }

  // Larguras FIXAS em px (nunca "fr") -- um grid com faixas flexíveis some
  // width:auto no container deixa o navegador comprimir as colunas abaixo
  // do mínimo pretendido quando a soma excede a viewport (era exatamente o
  // bug relatado: 7 dias ficavam espremidos). largura total EXPLÍCITA no
  // próprio grid força overflow real + scroll horizontal em vez de
  // encolher, e cada dia mantém a mesma largura sozinho ou com 7 dias.
  const numDias = Math.max(dias.length, 1);
  const gridColunas = `${LARGURA_FUNCIONARIO}px repeat(${numDias}, ${LARGURA_DIA}px)`;
  const larguraTotalGrid = LARGURA_FUNCIONARIO + numDias * LARGURA_DIA;

  return (
    <>
      <div className={estilos.cabecalhoSemana}>
        <div className={estilos.navegacaoSemana}>
          <Button variante="secondary" tamanho="sm" onClick={() => deslocarPeriodo(-1)}>← Período anterior</Button>
          <Button variante="secondary" tamanho="sm" onClick={irParaHoje}>Hoje</Button>
          <Button variante="secondary" tamanho="sm" onClick={() => deslocarPeriodo(1)}>Próximo período →</Button>
        </div>
        <h3 className={estilos.tituloSemana}>{dias.length > 0 ? formatarPeriodoSemana(dias) : ''}</h3>
        {cargos.length > 0 && (
          <Select value={cargoId} onChange={(e) => setCargoId(e.target.value)} aria-label="Filtrar por cargo">
            <option value="">Todos os cargos</option>
            {cargos.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        )}
      </div>

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

      {carregando || dias.length === 0 ? (
        <p role="status">Carregando escala...</p>
      ) : funcionariosExibidos.length === 0 ? (
        <p className={estilos.notaOcorrencia}>Nenhum funcionário para este filtro.</p>
      ) : (
        <div className={estilos.envolucroCobertura}>
          <div className={estilos.timelineCobertura} style={{ gridTemplateColumns: gridColunas, minWidth: `${larguraTotalGrid}px` }}>
            <span className={estilos.cantoCobertura} />
            {dias.map((data) => (
              <CabecalhoDiaCobertura key={data} data={data} janela={janela} />
            ))}

            {funcionariosExibidos.map((funcionario) => (
              <FragmentoLinhaFuncionario key={funcionario.id} funcionario={funcionario} dias={dias} porFuncionarioEDia={porFuncionarioEDia} janela={janela} />
            ))}

            <span className={cx(estilos.nomeCoberturaFixo, estilos.nomeCoberturaFixoTotal)}><strong>Cobertura</strong></span>
            {dias.map((data) => (
              <TrilhaCoberturaDia key={data} faixas={faixasPorDia.get(data) || []} janela={janela} />
            ))}
          </div>
        </div>
      )}

      <p className={estilos.legenda}>Visão somente leitura -- para editar a escala, use a visão Semanal.</p>
    </>
  );
}

// Uma linha de funcionário = nome fixo + 1 trilha por dia exibido -- extraído
// só para poder usar hooks/organização sem quebrar a sequência de filhos
// diretos do grid (o nome + as N trilhas continuam sendo N+1 filhos diretos
// em sequência, do jeito que o CSS Grid espera).
function FragmentoLinhaFuncionario({ funcionario, dias, porFuncionarioEDia, janela }) {
  return (
    <>
      <span className={estilos.nomeCoberturaFixo} title={funcionario.nome}>{obterPrimeiroNome(funcionario.nome)}</span>
      {dias.map((data) => (
        <TrilhaFuncionarioDia key={data} item={porFuncionarioEDia.get(data)?.get(funcionario.id) || null} janela={janela} />
      ))}
    </>
  );
}
