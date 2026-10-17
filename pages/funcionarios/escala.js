import { useEffect, useMemo, useRef, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import FuncionariosSubNav from '../../components/funcionarios/FuncionariosSubNav';
import EscalaDiaModal from '../../components/funcionarios/EscalaDiaModal';
import EscalaLoteModal from '../../components/funcionarios/EscalaLoteModal';
import EscalaPadraoLoteModal from '../../components/funcionarios/EscalaPadraoLoteModal';
import EscalaCoberturaDiaModal from '../../components/funcionarios/EscalaCoberturaDiaModal';
import EscalaMensal, { EscalaMensalCalendario, EscalaSemanaCalendario } from '../../components/funcionarios/EscalaMensal';
import EscalaPorHora from '../../components/funcionarios/EscalaPorHora';
import IndicadorVinculo from '../../components/funcionarios/IndicadorVinculo';
import EscalaFiltrosExportacao from '../../components/funcionarios/EscalaFiltrosExportacao';
import { SecoesPorCargo } from '../../components/funcionarios/EscalaGrupos';
import { useFeriadosPeriodo, AvisoErroFeriados, MarcaFeriado, LegendaFeriados } from '../../components/funcionarios/EscalaFeriados';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable, { OrdenacaoCartoes } from '../../components/ui/DataTable';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmarAcaoModal from '../../components/admin/ConfirmarAcaoModal';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, somarDias, inicioDoMes, diasDoMes, mesExibicao } from '../../lib/data/dataLocal';
import {
  diasDaSemana,
  inicioDaSemana,
  obterEstadoDia,
  buscarEscalaPeriodo,
  formatarPeriodo,
  construirCopiaSemana,
  detectarSobrescritas,
  rotuloDiaSemana,
  formatarDataCurta,
  formatarPeriodoSemana,
} from '../../lib/funcionarios/escala';
import { agruparPorCargo, ordenarDentroDosGrupos } from '../../lib/funcionarios/escalaGrupos';
import { nomeCompactoEscala } from '../../lib/funcionarios/escalaNomes';
import { FILTRO_ESCALA_VAZIO, filtrarFuncionariosEscala, funcionariosDoCargo, descreverFiltroEscala } from '../../lib/funcionarios/escalaFiltro';
import { ordenarOpcoes } from '../../lib/ordenacao/opcoes';
import { montarExportacaoSemanal, montarExportacaoMensal } from '../../lib/funcionarios/escalaExportacao';
import { exportarRelatorio } from '../../lib/exportacao/exportar';
import estilos from '../../components/funcionarios/escala.module.css';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';
import { OPCOES_VINCULO } from '../../lib/funcionarios/vinculo';
import { useMediaQuery } from '../../lib/design/useMediaQuery';
import { ESCALA_COMPACTA_ATE, MQ_ESCALA_COMPACTA, contarFiltrosEscalaAtivos } from '../../lib/funcionarios/escalaMobile';
import { NavegacaoCompacta } from '../../components/funcionarios/EscalaCompacta';

// Grade semanal/mensal: só Funcionário (e Vínculo, na semanal) ordenam --
// as colunas de dia são células de escala, não valores comparáveis.
const COLUNAS_ORDENACAO_MENSAL = [{ chave: 'nome', rotulo: 'Funcionário', ordenavel: true }];

const MENSAGEM_ERRO_CARREGAR = 'Não foi possível carregar a escala. Atualize a página para tentar novamente.';

// Célula de UM funcionário em UMA data -- estados sempre distintos (nunca
// confundidos): não definido (sem linha em funcionarios_escala_dias),
// folga, ou trabalho (1+ períodos, com badge de ocorrência se houver
// falta/atestado -- o previsto nunca some, só ganha um selo ao lado).
function CelulaDia({ funcionario, data, mapaEscala, podeEditar, onAbrir }) {
  const estado = obterEstadoDia(mapaEscala, funcionario.id, data);

  const conteudo = !estado ? (
    <span className={estilos.celulaNaoDefinido}>Não definido</span>
  ) : estado.tipo === 'folga' ? (
    <span className={estilos.celulaFolga}>Folga</span>
  ) : (
    <>
      {estado.periodos.map((p, i) => (
        <span key={i} className={estilos.celulaPeriodo} title={p.natureza_financeira === 'extra_remunerado' ? 'Extra remunerado' : undefined}>
          {formatarPeriodo(p)}
          {p.natureza_financeira === 'extra_remunerado' ? ' · extra' : ''}
        </span>
      ))}
      {estado.ocorrencia && (
        <span className={estilos.celulaOcorrencia}>
          <Badge tom={estado.ocorrencia.tipo === 'falta' ? 'danger' : 'warning'}>
            {estado.ocorrencia.tipo === 'falta' ? 'Falta' : 'Atestado'}
          </Badge>
        </span>
      )}
    </>
  );

  if (!podeEditar) {
    return <div className={estilos.celulaDia}>{conteudo}</div>;
  }

  return (
    <button type="button" className={estilos.celulaDia} onClick={() => onAbrir(funcionario, data, estado)}>
      {conteudo}
    </button>
  );
}

// Mensagem de sucesso que some sozinha (4s) -- mesma de Semanal e Mensal.
function useMensagemTemporaria() {
  const [mensagem, setMensagem] = useState('');
  useEffect(() => {
    if (!mensagem) return undefined;
    const timer = setTimeout(() => setMensagem(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagem]);
  return [mensagem, setMensagem];
}

// A visão é organizada por cargo (agruparPorCargo) SOBRE a população do
// filtro Cargo/Funcionária (escalaFiltro.js) -- filtro e agrupamento só
// decidem QUAIS linhas aparecem/são exportadas. Ações (cópia, lote, Escala
// Padrão) continuam sobre a EQUIPE TODA (`funcionarios`), exatamente como
// antes desta frente -- nem o filtro nem o agrupamento viram escopo de
// escrita.
function VisaoSemanal({ funcionarios, cargos, podeEditar, filtro, onFiltroChange }) {
  const [semanaInicio, setSemanaInicio] = useState(() => inicioDaSemana(dataLocalHoje()));
  const [mapaEscala, setMapaEscala] = useState(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  const [modalDia, setModalDia] = useState(null); // { funcionario, data, estado }
  const [modalLoteAberto, setModalLoteAberto] = useState(false);
  const [modalPadraoAberto, setModalPadraoAberto] = useState(false);

  const [confirmarCopiaSemana, setConfirmarCopiaSemana] = useState(null); // { atribuicoes, conflitos }
  const [copiandoSemana, setCopiandoSemana] = useState(false);
  const [erroCopiaSemana, setErroCopiaSemana] = useState('');
  const [mensagemSucesso, setMensagemSucesso] = useMensagemTemporaria();
  // Ordenação do cabeçalho (Funcionário/Vínculo): estado local, nunca salvo,
  // UMA só para a página -- clicar no cabeçalho de qualquer tabela ordena
  // as funcionárias dentro de TODOS os cargos; a ordem dos cargos não muda.
  const ordenacao = useOrdenacao();

  const dias = diasDaSemana(semanaInicio);

  // Celular/tablet pequeno: a semana inteira por funcionário no calendário
  // compacto do Mensal; filtros, exportação, ordenação e ações ficam no
  // painel "Filtros e ações". Mesmos dados, handlers e modais do desktop.
  const compacta = useMediaQuery(MQ_ESCALA_COMPACTA);
  const [painelAberto, setPainelAberto] = useState(false);

  const funcionariosExibidos = filtrarFuncionariosEscala(funcionarios, filtro);
  const grupos = useMemo(() => agruparPorCargo(funcionariosExibidos), [funcionariosExibidos]);
  // Feriados da semana: só informação (nunca bloqueia nem altera a escala).
  const { feriados, erroFeriados } = useFeriadosPeriodo(dias[0], dias[6]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErro('');
      try {
        const mapa = await buscarEscalaPeriodo(funcionarios.map((f) => f.id), dias[0], dias[6]);
        if (!ativo) return;
        setMapaEscala(mapa);
      } catch {
        if (!ativo) return;
        // Nunca mostra (nem deixa editar) uma escala incompleta.
        setMapaEscala(null);
        setErro(MENSAGEM_ERRO_CARREGAR);
      }
      if (ativo) setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaInicio, recarregarTick, funcionarios]);

  function irParaSemanaAnterior() {
    setSemanaInicio((atual) => somarDias(atual, -7));
  }

  function irParaProximaSemana() {
    setSemanaInicio((atual) => somarDias(atual, 7));
  }

  function irParaHoje() {
    setSemanaInicio(inicioDaSemana(dataLocalHoje()));
  }

  function abrirModalDia(funcionario, data, estado) {
    setModalDia({ funcionario, data, estado });
  }

  function fecharModalDia() {
    setModalDia(null);
  }

  function recarregarTudo() {
    setRecarregarTick((t) => t + 1);
  }

  function aoSalvarDia() {
    setModalDia(null);
    setMensagemSucesso('Escala atualizada com sucesso.');
    recarregarTudo();
  }

  function fecharModalLote() {
    setModalLoteAberto(false);
  }

  function aoSalvarLote() {
    setModalLoteAberto(false);
    setMensagemSucesso('Escala aplicada em lote com sucesso.');
    recarregarTudo();
  }

  function fecharModalPadrao() {
    setModalPadraoAberto(false);
  }

  function aoAplicarPadrao() {
    setModalPadraoAberto(false);
    setMensagemSucesso('Escala padrão aplicada com sucesso.');
    recarregarTudo();
  }

  // "Copiar semana anterior" (recurso mais usado da produtividade, seção 10
  // da arquitetura aprovada) -- busca a semana anterior sob demanda (não
  // fica carregada o tempo todo), revisa conflitos ANTES de escrever
  // qualquer coisa, e só aplica depois de confirmação explícita se algo
  // for ser sobrescrito. Sempre a equipe ativa inteira.
  async function prepararCopiaSemanaAnterior() {
    setErroCopiaSemana('');
    const semanaAnteriorInicio = somarDias(semanaInicio, -7);
    const idsFuncionarios = funcionarios.map((f) => f.id);

    let mapaAnterior;
    try {
      mapaAnterior = await buscarEscalaPeriodo(idsFuncionarios, semanaAnteriorInicio, somarDias(semanaAnteriorInicio, 6));
    } catch {
      setErroCopiaSemana('Não foi possível ler a semana anterior. Tente novamente.');
      return;
    }

    const atribuicoes = construirCopiaSemana({
      funcionarioIds: idsFuncionarios,
      mapaEscala: mapaAnterior,
      semanaOrigemInicio: semanaAnteriorInicio,
      semanaDestinoInicio: semanaInicio,
    });

    if (atribuicoes.length === 0) {
      setErroCopiaSemana('A semana anterior não tem nenhuma escala definida para copiar.');
      return;
    }

    const conflitos = detectarSobrescritas({ funcionarioIds: idsFuncionarios, datas: dias, mapaEscala });
    setConfirmarCopiaSemana({ atribuicoes, conflitos });
  }

  async function confirmarCopiaSemanaAnterior() {
    if (!confirmarCopiaSemana) return;
    setCopiandoSemana(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('aplicar_escala_em_lote', { p_atribuicoes: confirmarCopiaSemana.atribuicoes });
    setCopiandoSemana(false);

    if (error) {
      // Protecao K (migration 0066) -- repassa a mensagem exata da RPC em
      // vez do fallback generico (mesmo tratamento de EscalaDiaModal.js).
      if (error.message?.includes('já possui pagamento confirmado')) {
        setErroCopiaSemana(error.message);
        return;
      }
      console.error('Erro ao copiar semana anterior:', error);
      setErroCopiaSemana('Não foi possível copiar a semana anterior. Verifique se algum dia de destino já tem falta/atestado registrado.');
      return;
    }

    setConfirmarCopiaSemana(null);
    setMensagemSucesso('Semana anterior copiada com sucesso.');
    recarregarTudo();
  }

  // Layout fixo com TODAS as larguras explícitas (Funcionário, Vínculo e
  // dias): as tabelas dos vários cargos ficam alinhadas e a grade não
  // estica até a largura da tela (os dias ficam do tamanho do conteúdo,
  // como antes desta frente). Nome compacto (primeiro + último) na grade;
  // o completo fica no title.
  const colunas = [
    {
      chave: 'nome',
      rotulo: 'Funcionário',
      mobile: 'titulo',
      cartaoOrdem: 0,
      ordenavel: true,
      largura: '168px',
      render: (f) => <span title={f.nome}>{nomeCompactoEscala(f.nome)}</span>,
    },
    {
      chave: 'vinculo',
      rotulo: 'Vínculo',
      alinhar: 'centro',
      largura: '96px',
      ordenavel: { valor: (f) => f.tipo_vinculo, ordem: OPCOES_VINCULO.map((o) => o.valor) },
      render: (f) => <IndicadorVinculo tipoVinculo={f.tipo_vinculo} />,
    },
    ...dias.map((data) => ({
      chave: `dia_${data}`,
      largura: '104px',
      rotulo: (
        <>
          {`${rotuloDiaSemana(data)} ${formatarDataCurta(data)}`}
          <MarcaFeriado nome={feriados.get(data)} />
        </>
      ),
      render: (f) => (
        <CelulaDia funcionario={f} data={data} mapaEscala={mapaEscala} podeEditar={podeEditar} onAbrir={abrirModalDia} />
      ),
    })),
  ];

  const gruposOrdenados = ordenarDentroDosGrupos(grupos, (lista) => ordenacao.ordenar(lista, colunas));
  const semDados = carregando || !mapaEscala;

  function exportar(formato) {
    const modelo = montarExportacaoSemanal({
      dias,
      grupos: gruposOrdenados,
      mapaEscala,
      filtroDescricao: descreverFiltroEscala(filtro, { cargos, funcionarios }),
      feriados,
    });
    return exportarRelatorio(modelo, formato);
  }

  // Ações da semana: as MESMAS funções nos dois modos; no painel do celular
  // o painel fecha antes (a confirmação/modal da ação abre sobre a tela).
  const acoesEscala = (fecharPainel) => {
    const executar = (acao) => () => {
      if (fecharPainel) setPainelAberto(false);
      acao();
    };
    return (
      <>
        <Button variante="secondary" tamanho="sm" onClick={executar(prepararCopiaSemanaAnterior)} disabled={semDados}>Copiar semana anterior</Button>
        <Button variante="secondary" tamanho="sm" onClick={executar(() => setModalPadraoAberto(true))} disabled={semDados}>Preencher pela Escala Padrão</Button>
        <Button tamanho="sm" icone="plus" onClick={executar(() => setModalLoteAberto(true))} disabled={semDados}>Aplicar em lote</Button>
      </>
    );
  };

  const filtrosAtivos = contarFiltrosEscalaAtivos(filtro);
  const propsFiltrosExportacao = {
    cargos,
    funcionarios,
    filtro,
    onFiltroChange,
    rotuloVisao: 'Semanal',
    onExportar: exportar,
    desabilitarExportacao: semDados || funcionariosExibidos.length === 0,
  };

  return (
    <>
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
      {erroCopiaSemana && <Alert tom="danger" className={estilos.mensagem}>{erroCopiaSemana}</Alert>}
      <AvisoErroFeriados visivel={erroFeriados} />

      {compacta ? (
        <div className={estilos.cabecalhoCompacto}>
          <NavegacaoCompacta
            titulo={formatarPeriodoSemana(dias)}
            rotuloAnterior="Semana anterior"
            rotuloProximo="Próxima semana"
            onAnterior={irParaSemanaAnterior}
            onHoje={irParaHoje}
            onProximo={irParaProximaSemana}
          />
          <div className={estilos.linhaPainel}>
            <Button variante="secondary" tamanho="sm" icone="filter" onClick={() => setPainelAberto(true)} aria-haspopup="dialog">
              Filtros e ações
              {filtrosAtivos > 0 && <Badge tom="primary">{filtrosAtivos} {filtrosAtivos === 1 ? 'ativo' : 'ativos'}</Badge>}
            </Button>
          </div>
        </div>
      ) : (
        <div className={estilos.cabecalhoSemana}>
          <div className={estilos.navegacaoSemana}>
            <Button variante="secondary" tamanho="sm" onClick={irParaSemanaAnterior}>← Semana anterior</Button>
            <Button variante="secondary" tamanho="sm" onClick={irParaHoje}>Hoje</Button>
            <Button variante="secondary" tamanho="sm" onClick={irParaProximaSemana}>Próxima semana →</Button>
          </div>
          <h3 className={estilos.tituloSemana}>{formatarPeriodoSemana(dias)}</h3>
          <div className={estilos.navegacaoSemana}>
            <EscalaFiltrosExportacao {...propsFiltrosExportacao} />
            {podeEditar && acoesEscala(false)}
          </div>
        </div>
      )}

      {carregando ? (
        <p role="status">Carregando escala...</p>
      ) : !mapaEscala ? null : grupos.length === 0 ? (
        <EmptyState>Nenhum funcionário para este filtro.</EmptyState>
      ) : compacta ? (
        <SecoesPorCargo grupos={gruposOrdenados}>
          {(grupo) => (
            <EscalaSemanaCalendario
              funcionarios={grupo.funcionarios}
              mapaEscala={mapaEscala}
              dias={dias}
              feriados={feriados}
              onAbrirFuncionarioDia={podeEditar ? abrirModalDia : undefined}
            />
          )}
        </SecoesPorCargo>
      ) : (
        <SecoesPorCargo grupos={gruposOrdenados}>
          {(grupo) => (
            <DataTable
              rotulo={`Escala semanal — ${grupo.nome}`}
              colunas={colunas}
              linhas={grupo.funcionarios}
              chaveLinha={(f) => f.id}
              ordenacao={ordenacao.props}
              cartoesAte={ESCALA_COMPACTA_ATE}
              layoutFixo
              className={estilos.tabelaSemanalGrupo}
            />
          )}
        </SecoesPorCargo>
      )}

      <p className={estilos.legenda}>
        {compacta
          ? `M = manhã · T = tarde · F = falta · A = atestado · — = não definido.${podeEditar ? ' Toque num dia para definir horário, folga ou registrar falta/atestado.' : ''}`
          : 'Clique numa célula para definir horário, folga ou registrar falta/atestado.'}
      </p>
      <LegendaFeriados feriados={feriados} dias={dias} />

      {compacta && painelAberto && (
        <Modal titulo="Filtros e ações" largura="sm" fecharAoClicarFora onFechar={() => setPainelAberto(false)}>
          <div className={estilos.painelFiltrosAcoes}>
            <EscalaFiltrosExportacao {...propsFiltrosExportacao} agrupado />
            {funcionariosExibidos.length > 1 && (
              <section className={estilos.secaoPainel}>
                <h4 className={estilos.tituloOcorrencia}>Ordenação</h4>
                <OrdenacaoCartoes colunas={colunas} ordenacao={ordenacao.props} rotuloTabela="Escala semanal" />
              </section>
            )}
            {podeEditar && (
              <section className={estilos.secaoPainel}>
                <h4 className={estilos.tituloOcorrencia}>Ações da escala</h4>
                <div className={estilos.acoesPainel}>{acoesEscala(true)}</div>
              </section>
            )}
            <div className={estilos.rodapePlanejamento}>
              <Button variante="secondary" onClick={() => setPainelAberto(false)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      )}

      {modalDia && (
        <EscalaDiaModal
          funcionario={modalDia.funcionario}
          data={modalDia.data}
          estadoAtual={modalDia.estado}
          podeEditar={podeEditar}
          feriado={feriados.get(modalDia.data)}
          onFechar={fecharModalDia}
          onSalvo={aoSalvarDia}
        />
      )}

      {modalLoteAberto && mapaEscala && (
        <EscalaLoteModal funcionarios={funcionarios} dias={dias} mapaEscala={mapaEscala} onFechar={fecharModalLote} onSalvo={aoSalvarLote} />
      )}

      {modalPadraoAberto && (
        <EscalaPadraoLoteModal funcionarios={funcionarios} dias={dias} periodo="semana" onFechar={fecharModalPadrao} onAplicado={aoAplicarPadrao} />
      )}

      {confirmarCopiaSemana && (
        <ConfirmarAcaoModal
          modalDS
          titulo="Copiar semana anterior"
          perigo={confirmarCopiaSemana.conflitos.length > 0}
          confirmando={copiandoSemana}
          erro={erroCopiaSemana}
          textoConfirmar={confirmarCopiaSemana.conflitos.length > 0 ? 'Confirmar e sobrescrever' : 'Copiar'}
          mensagem={
            confirmarCopiaSemana.conflitos.length > 0 ? (
              <p>
                Isto vai SOBRESCREVER a escala já existente em <strong>{confirmarCopiaSemana.conflitos.length}</strong> combinação(ões)
                de funcionário/dia nesta semana. Deseja continuar?
              </p>
            ) : (
              <p>Copiar a escala da semana anterior para <strong>{formatarPeriodoSemana(dias)}</strong>?</p>
            )
          }
          onConfirmar={confirmarCopiaSemanaAnterior}
          onCancelar={() => setConfirmarCopiaSemana(null)}
        />
      )}
    </>
  );
}

// "Mensal" = planejamento visual macro: funcionário nas linhas, dias do mês
// nas colunas (seção 2/3 da instrução aprovada), organizado por cargo numa
// grade ÚNICA. Fetch cobre o mês INTEIRO de todos os funcionários.
//
// Edição: com escala.editar, clicar na célula abre o MESMO EscalaDiaModal
// da Semanal (mesma RPC, mesmas validações e proteções) -- nenhuma regra
// de escala própria do Mensal. Depois de salvar, a recarga é em SEGUNDO
// PLANO: a grade continua montada (mantém a rolagem horizontal) e só troca
// os dados quando a nova leitura chega. "Carregando escala..." no lugar da
// grade só na 1ª carga e na troca de mês.
function VisaoMensal({ funcionarios, cargos, podeEditar, filtro, onFiltroChange }) {
  const [mesInicio, setMesInicio] = useState(() => inicioDoMes(dataLocalHoje()));
  const [mapaEscala, setMapaEscala] = useState(new Map());
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useMensagemTemporaria();
  const [detalheFuncionarioDia, setDetalheFuncionarioDia] = useState(null); // { funcionario, data, estado }
  const [diaDetalhe, setDiaDetalhe] = useState(''); // 'YYYY-MM-DD' | ''
  const [modalPadraoAberto, setModalPadraoAberto] = useState(false);
  // Mês cujos dados estão na tela -- distingue troca de mês (carregamento
  // com a grade escondida) de recarga do MESMO mês (segundo plano).
  const mesCarregadoRef = useRef(null);
  // Ordenação pelo cabeçalho "Funcionário" da grade: estado local, aplicado
  // dentro de cada cargo.
  const ordenacao = useOrdenacao();

  const dias = useMemo(() => diasDoMes(mesInicio), [mesInicio]);
  // Celular/tablet pequeno: calendário por funcionário no lugar da grade.
  const compacta = useMediaQuery(MQ_ESCALA_COMPACTA);
  // Filtro Cargo/Funcionária -> população exibida/exportada, agrupada por
  // cargo. A cobertura do dia (cabeçalho) usa o recorte de CARGO (mesma
  // semântica de antes desta frente: cargoIdInicial = filtro de cargo).
  const funcionariosExibidos = useMemo(() => filtrarFuncionariosEscala(funcionarios, filtro), [filtro, funcionarios]);
  const grupos = useMemo(() => agruparPorCargo(funcionariosExibidos), [funcionariosExibidos]);
  const funcionariosCobertura = useMemo(() => funcionariosDoCargo(funcionarios, filtro.cargoId), [filtro.cargoId, funcionarios]);
  const gruposCobertura = useMemo(() => agruparPorCargo(funcionariosCobertura), [funcionariosCobertura]);
  const { feriados, erroFeriados } = useFeriadosPeriodo(dias[0], dias[dias.length - 1]);

  useEffect(() => {
    let ativo = true;
    const trocaDeMes = mesCarregadoRef.current !== mesInicio;
    async function carregar() {
      if (trocaDeMes) setCarregando(true);
      else setAtualizando(true);
      setErro('');
      try {
        const mapa = await buscarEscalaPeriodo(funcionarios.map((f) => f.id), dias[0], dias[dias.length - 1]);
        if (!ativo) return;
        mesCarregadoRef.current = mesInicio;
        setMapaEscala(mapa);
      } catch {
        if (!ativo) return;
        // Nunca mostra (nem deixa editar) uma escala incompleta.
        mesCarregadoRef.current = null;
        setMapaEscala(null);
        setErro(MENSAGEM_ERRO_CARREGAR);
      }
      if (ativo) {
        setCarregando(false);
        setAtualizando(false);
      }
    }
    carregar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesInicio, recarregarTick, funcionarios]);

  const gruposOrdenados = ordenarDentroDosGrupos(grupos, (lista) => ordenacao.ordenar(lista, COLUNAS_ORDENACAO_MENSAL));
  const semDados = carregando || !mapaEscala;

  function exportar(formato) {
    const modelo = montarExportacaoMensal({
      dias,
      grupos: gruposOrdenados,
      mapaEscala,
      filtroDescricao: descreverFiltroEscala(filtro, { cargos, funcionarios }),
      feriados,
    });
    return exportarRelatorio(modelo, formato);
  }

  function recarregar() {
    setRecarregarTick((t) => t + 1);
  }

  function aoSalvarDia() {
    setDetalheFuncionarioDia(null);
    setMensagemSucesso('Escala atualizada com sucesso.');
    recarregar();
  }

  function aoAplicarPadrao() {
    setModalPadraoAberto(false);
    setMensagemSucesso('Escala padrão aplicada com sucesso.');
    recarregar();
  }

  const irParaMesAnterior = () => setMesInicio((atual) => inicioDoMes(somarDias(atual, -1)));
  const irParaMesAtual = () => setMesInicio(inicioDoMes(dataLocalHoje()));
  const irParaProximoMes = () => setMesInicio((atual) => inicioDoMes(somarDias(dias[dias.length - 1], 1)));
  const abrirFuncionarioDia = (funcionario, data, estado) => setDetalheFuncionarioDia({ funcionario, data, estado });

  const exportacao = (
    <EscalaFiltrosExportacao
      cargos={cargos}
      funcionarios={funcionarios}
      filtro={filtro}
      onFiltroChange={onFiltroChange}
      rotuloVisao="Mensal"
      onExportar={exportar}
      desabilitarExportacao={semDados || funcionariosExibidos.length === 0}
    />
  );
  const botaoPadrao = podeEditar && (
    <Button variante="secondary" tamanho="sm" onClick={() => setModalPadraoAberto(true)} disabled={semDados}>
      Preencher pela Escala Padrão
    </Button>
  );

  return (
    <>
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
      <AvisoErroFeriados visivel={erroFeriados} />

      {compacta ? (
        <div className={estilos.cabecalhoCompacto}>
          <NavegacaoCompacta
            titulo={mesExibicao(mesInicio)}
            rotuloAnterior="Mês anterior"
            rotuloProximo="Próximo mês"
            onAnterior={irParaMesAnterior}
            onHoje={irParaMesAtual}
            onProximo={irParaProximoMes}
          />
          <div className={estilos.grupoCompacto}>
            {exportacao}
            {botaoPadrao}
            {atualizando && <span role="status" className={estilos.atualizandoEscala}>Atualizando…</span>}
          </div>
          {/* Cobertura geral do dia (no desktop: clique no cabeçalho do dia). */}
          <label className={estilos.campoCompacto}>
            <span>Cobertura do dia</span>
            <Select value="" onChange={(e) => e.target.value && setDiaDetalhe(e.target.value)} disabled={semDados}>
              <option value="">Escolha um dia…</option>
              {dias.map((data) => (
                <option key={data} value={data}>{`${rotuloDiaSemana(data)} ${formatarDataCurta(data)}${feriados.has(data) ? ` — Feriado: ${feriados.get(data)}` : ''}`}</option>
              ))}
            </Select>
          </label>
        </div>
      ) : (
        <div className={estilos.cabecalhoSemana}>
          <div className={estilos.navegacaoSemana}>
            <Button variante="secondary" tamanho="sm" onClick={irParaMesAnterior} aria-label="Mês anterior">←</Button>
            <Button variante="secondary" tamanho="sm" onClick={irParaMesAtual}>Hoje</Button>
            <Button variante="secondary" tamanho="sm" onClick={irParaProximoMes} aria-label="Próximo mês">→</Button>
          </div>
          <h3 className={estilos.tituloSemana}>{mesExibicao(mesInicio)}</h3>
          <div className={estilos.navegacaoSemana}>
            {exportacao}
            {botaoPadrao}
          </div>
          {carregando && <span role="status">Carregando...</span>}
          {atualizando && <span role="status" className={estilos.atualizandoEscala}>Atualizando…</span>}
        </div>
      )}

      {carregando ? (
        <p role="status">Carregando escala...</p>
      ) : !mapaEscala ? null : grupos.length === 0 ? (
        <EmptyState>Nenhum funcionário para este filtro.</EmptyState>
      ) : compacta ? (
        <>
          {funcionariosExibidos.length > 1 && (
            <OrdenacaoCartoes colunas={COLUNAS_ORDENACAO_MENSAL} ordenacao={ordenacao.props} rotuloTabela="Escala mensal" />
          )}
          <SecoesPorCargo grupos={gruposOrdenados}>
            {(grupo) => (
              <EscalaMensalCalendario funcionarios={grupo.funcionarios} mapaEscala={mapaEscala} dias={dias} feriados={feriados} onAbrirFuncionarioDia={abrirFuncionarioDia} />
            )}
          </SecoesPorCargo>
        </>
      ) : (
        <EscalaMensal
          grupos={gruposOrdenados}
          ordenacao={ordenacao.props}
          mapaEscala={mapaEscala}
          dias={dias}
          feriados={feriados}
          onAbrirFuncionarioDia={abrirFuncionarioDia}
          onAbrirDia={setDiaDetalhe}
        />
      )}

      <p className={estilos.legenda}>
        {compacta
          ? `M = manhã · T = tarde · F = falta · A = atestado · — = não definido. ${podeEditar ? 'Toque num dia para definir horário, folga ou registrar falta/atestado.' : 'Toque num dia para ver os horários daquela pessoa.'}`
          : `${podeEditar ? 'Clique numa célula para definir horário, folga ou registrar falta/atestado' : 'Clique numa célula para ver os horários daquela pessoa'}; clique no cabeçalho do dia para a cobertura geral.`}
      </p>
      <LegendaFeriados feriados={feriados} dias={dias} />

      {detalheFuncionarioDia && (
        <EscalaDiaModal
          funcionario={detalheFuncionarioDia.funcionario}
          data={detalheFuncionarioDia.data}
          estadoAtual={detalheFuncionarioDia.estado}
          podeEditar={podeEditar}
          feriado={feriados.get(detalheFuncionarioDia.data)}
          onFechar={() => setDetalheFuncionarioDia(null)}
          onSalvo={aoSalvarDia}
        />
      )}

      {diaDetalhe && mapaEscala && (
        <EscalaCoberturaDiaModal
          data={diaDetalhe}
          funcionarios={funcionariosCobertura}
          grupos={gruposCobertura}
          mapaEscala={mapaEscala}
          feriado={feriados.get(diaDetalhe)}
          onFechar={() => setDiaDetalhe('')}
        />
      )}

      {modalPadraoAberto && (
        <EscalaPadraoLoteModal
          funcionarios={funcionarios}
          dias={dias}
          periodo="mes"
          onFechar={() => setModalPadraoAberto(false)}
          onAplicado={aoAplicarPadrao}
        />
      )}
    </>
  );
}

function EscalaConteudo() {
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.ESCALA_EDITAR);

  const [visao, setVisao] = useState('semanal');
  const [funcionarios, setFuncionarios] = useState([]);
  const [carregandoFuncionarios, setCarregandoFuncionarios] = useState(true);
  const [erro, setErro] = useState('');
  // Filtro compartilhado pelas três visões (trocar de Semanal para Mensal
  // mantém o recorte) e pelas exportações -- o agrupamento por cargo é
  // aplicado SOBRE a população filtrada.
  const [filtro, setFiltro] = useState(FILTRO_ESCALA_VAZIO);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregandoFuncionarios(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('funcionarios')
        .select('id, nome, ativo, tipo_vinculo, cargo_id, funcionarios_cargos(nome)')
        .eq('ativo', true)
        .order('nome');
      if (!ativo) return;
      if (error) {
        console.error('Erro ao carregar funcionários para a escala:', error);
        setErro('Não foi possível carregar os funcionários.');
      }
      setFuncionarios(data || []);
      setCarregandoFuncionarios(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, []);

  // Cargo é FILTRO de análise e AGRUPAMENTO visual da escala, nunca uma
  // regra nova (seção 6 da instrução aprovada) -- reaproveita cargo_id/
  // funcionarios_cargos já cadastrados no funcionário (mesma fonte de
  // pages/funcionarios.js), sem nenhuma tabela/cadastro paralelo de cargos.
  const cargos = useMemo(() => {
    const porId = new Map();
    for (const f of funcionarios) {
      if (f.cargo_id && !porId.has(f.cargo_id)) {
        porId.set(f.cargo_id, { id: f.cargo_id, nome: f.funcionarios_cargos?.nome || '' });
      }
    }
    return ordenarOpcoes(Array.from(porId.values()));
  }, [funcionarios]);

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="escala" />
      <PageHeader
        titulo="Escala"
        acoes={
          <div className={estilos.navegacaoSemana}>
            <Button variante={visao === 'semanal' ? 'primary' : 'secondary'} tamanho="sm" onClick={() => setVisao('semanal')}>Semanal</Button>
            <Button variante={visao === 'mensal' ? 'primary' : 'secondary'} tamanho="sm" onClick={() => setVisao('mensal')}>Mensal</Button>
            <Button variante={visao === 'cobertura' ? 'primary' : 'secondary'} tamanho="sm" onClick={() => setVisao('cobertura')}>Cobertura</Button>
          </div>
        }
      />

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      {carregandoFuncionarios ? (
        <p role="status">Carregando...</p>
      ) : visao === 'semanal' ? (
        <VisaoSemanal funcionarios={funcionarios} cargos={cargos} podeEditar={podeEditar} filtro={filtro} onFiltroChange={setFiltro} />
      ) : visao === 'mensal' ? (
        <VisaoMensal funcionarios={funcionarios} cargos={cargos} podeEditar={podeEditar} filtro={filtro} onFiltroChange={setFiltro} />
      ) : (
        <EscalaPorHora funcionarios={funcionarios} cargos={cargos} filtro={filtro} onFiltroChange={setFiltro} />
      )}
    </PageShell>
  );
}

export default function EscalaPage() {
  return (
    <RequireAuth permissao={PERMISSOES.ESCALA_VISUALIZAR}>
      <EscalaConteudo />
    </RequireAuth>
  );
}
