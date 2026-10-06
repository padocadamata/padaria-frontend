import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import FuncionariosSubNav from '../../components/funcionarios/FuncionariosSubNav';
import EscalaDiaModal from '../../components/funcionarios/EscalaDiaModal';
import EscalaLoteModal from '../../components/funcionarios/EscalaLoteModal';
import EscalaPadraoLoteModal from '../../components/funcionarios/EscalaPadraoLoteModal';
import EscalaCoberturaDiaModal from '../../components/funcionarios/EscalaCoberturaDiaModal';
import EscalaMensal from '../../components/funcionarios/EscalaMensal';
import EscalaPorHora from '../../components/funcionarios/EscalaPorHora';
import IndicadorVinculo from '../../components/funcionarios/IndicadorVinculo';
import EscalaFiltrosExportacao from '../../components/funcionarios/EscalaFiltrosExportacao';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
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
import { FILTRO_ESCALA_VAZIO, filtrarFuncionariosEscala, descreverFiltroEscala } from '../../lib/funcionarios/escalaFiltro';
import { montarExportacaoSemanal, montarExportacaoMensal } from '../../lib/funcionarios/escalaExportacao';
import { exportarRelatorio } from '../../lib/exportacao/exportar';
import estilos from '../../components/funcionarios/escala.module.css';

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
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  const dias = diasDaSemana(semanaInicio);

  // Filtro de análise (cargo + funcionária, escalaFiltro.js) -- só restringe
  // as LINHAS exibidas/exportadas; ações em lote/cópia continuam operando
  // sobre a equipe toda (filtro é análise, não escopo de escrita).
  const funcionariosExibidos = filtrarFuncionariosEscala(funcionarios, filtro);

  function exportar(formato) {
    const modelo = montarExportacaoSemanal({
      dias,
      funcionarios: funcionariosExibidos,
      mapaEscala,
      filtroDescricao: descreverFiltroEscala(filtro, { cargos, funcionarios }),
    });
    return exportarRelatorio(modelo, formato);
  }

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErro('');
      const idsFuncionarios = funcionarios.map((f) => f.id);
      const mapa = await buscarEscalaPeriodo(idsFuncionarios, dias[0], dias[6]);
      if (!ativo) return;
      setMapaEscala(mapa);
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaInicio, recarregarTick, funcionarios]);

  useEffect(() => {
    if (!mensagemSucesso) return undefined;
    const timer = setTimeout(() => setMensagemSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

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
  // for ser sobrescrito.
  async function prepararCopiaSemanaAnterior() {
    setErroCopiaSemana('');
    const semanaAnteriorInicio = somarDias(semanaInicio, -7);
    const idsFuncionarios = funcionarios.map((f) => f.id);

    const mapaAnterior = await buscarEscalaPeriodo(idsFuncionarios, semanaAnteriorInicio, somarDias(semanaAnteriorInicio, 6));

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

  const colunas = [
    {
      chave: 'nome',
      rotulo: 'Funcionário',
      mobile: 'titulo',
      cartaoOrdem: 0,
      render: (f) => f.nome,
    },
    {
      chave: 'vinculo',
      rotulo: 'Vínculo',
      alinhar: 'centro',
      render: (f) => <IndicadorVinculo tipoVinculo={f.tipo_vinculo} />,
    },
    ...dias.map((data) => ({
      chave: `dia_${data}`,
      rotulo: `${rotuloDiaSemana(data)} ${formatarDataCurta(data)}`,
      render: (f) => (
        <CelulaDia funcionario={f} data={data} mapaEscala={mapaEscala} podeEditar={podeEditar} onAbrir={abrirModalDia} />
      ),
    })),
  ];

  return (
    <>
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
      {erroCopiaSemana && <Alert tom="danger" className={estilos.mensagem}>{erroCopiaSemana}</Alert>}

      <div className={estilos.cabecalhoSemana}>
        <div className={estilos.navegacaoSemana}>
          <Button variante="secondary" tamanho="sm" onClick={irParaSemanaAnterior}>← Semana anterior</Button>
          <Button variante="secondary" tamanho="sm" onClick={irParaHoje}>Hoje</Button>
          <Button variante="secondary" tamanho="sm" onClick={irParaProximaSemana}>Próxima semana →</Button>
        </div>
        <h3 className={estilos.tituloSemana}>{formatarPeriodoSemana(dias)}</h3>
        <div className={estilos.navegacaoSemana}>
          <EscalaFiltrosExportacao
            cargos={cargos}
            funcionarios={funcionarios}
            filtro={filtro}
            onFiltroChange={onFiltroChange}
            rotuloVisao="Semanal"
            onExportar={exportar}
            desabilitarExportacao={carregando || funcionariosExibidos.length === 0}
          />
          {podeEditar && (
            <>
              <Button variante="secondary" tamanho="sm" onClick={prepararCopiaSemanaAnterior}>Copiar semana anterior</Button>
              <Button variante="secondary" tamanho="sm" onClick={() => setModalPadraoAberto(true)}>Preencher pela Escala Padrão</Button>
              <Button tamanho="sm" icone="plus" onClick={() => setModalLoteAberto(true)}>Aplicar em lote</Button>
            </>
          )}
        </div>
      </div>

      {carregando ? (
        <p role="status">Carregando escala...</p>
      ) : funcionariosExibidos.length === 0 ? (
        <EmptyState>Nenhum funcionário para este filtro.</EmptyState>
      ) : (
        <DataTable
          rotulo="Escala semanal"
          colunas={colunas}
          linhas={funcionariosExibidos}
          chaveLinha={(f) => f.id}
          cartoesAte={900}
        />
      )}

      <p className={estilos.legenda}>Clique numa célula para definir horário, folga ou registrar falta/atestado.</p>

      {modalDia && (
        <EscalaDiaModal
          funcionario={modalDia.funcionario}
          data={modalDia.data}
          estadoAtual={modalDia.estado}
          podeEditar={podeEditar}
          onFechar={fecharModalDia}
          onSalvo={aoSalvarDia}
        />
      )}

      {modalLoteAberto && (
        <EscalaLoteModal funcionarios={funcionarios} dias={dias} mapaEscala={mapaEscala} onFechar={fecharModalLote} onSalvo={aoSalvarLote} />
      )}

      {modalPadraoAberto && (
        <EscalaPadraoLoteModal funcionarios={funcionarios} dias={dias} onFechar={fecharModalPadrao} onAplicado={aoAplicarPadrao} />
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
// nas colunas (seção 2/3 da instrução aprovada) -- não é mais um calendário
// FullCalendar. Fetch cobre o mês INTEIRO de todos os funcionários (nunca
// pré-filtrado por cargo), para o detalhamento do dia poder trocar de
// cargo sem refazer a busca.
function VisaoMensal({ funcionarios, cargos, filtro, onFiltroChange }) {
  const [mesInicio, setMesInicio] = useState(() => inicioDoMes(dataLocalHoje()));
  const [mapaEscala, setMapaEscala] = useState(new Map());
  const [carregando, setCarregando] = useState(true);
  const [detalheFuncionarioDia, setDetalheFuncionarioDia] = useState(null); // { funcionario, data, estado }
  const [diaDetalhe, setDiaDetalhe] = useState(''); // 'YYYY-MM-DD' | ''

  const dias = useMemo(() => diasDoMes(mesInicio), [mesInicio]);

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
  }, [mesInicio, funcionarios]);

  const funcionariosExibidos = useMemo(() => filtrarFuncionariosEscala(funcionarios, filtro), [filtro, funcionarios]);

  function exportar(formato) {
    const modelo = montarExportacaoMensal({
      dias,
      funcionarios: funcionariosExibidos,
      mapaEscala,
      filtroDescricao: descreverFiltroEscala(filtro, { cargos, funcionarios }),
    });
    return exportarRelatorio(modelo, formato);
  }

  return (
    <>
      <div className={estilos.cabecalhoSemana}>
        <div className={estilos.navegacaoSemana}>
          <Button variante="secondary" tamanho="sm" onClick={() => setMesInicio((atual) => inicioDoMes(somarDias(atual, -1)))}>←</Button>
          <Button variante="secondary" tamanho="sm" onClick={() => setMesInicio(inicioDoMes(dataLocalHoje()))}>Hoje</Button>
          <Button variante="secondary" tamanho="sm" onClick={() => setMesInicio((atual) => inicioDoMes(somarDias(dias[dias.length - 1], 1)))}>→</Button>
        </div>
        <h3 className={estilos.tituloSemana}>{mesExibicao(mesInicio)}</h3>
        <EscalaFiltrosExportacao
          cargos={cargos}
          funcionarios={funcionarios}
          filtro={filtro}
          onFiltroChange={onFiltroChange}
          rotuloVisao="Mensal"
          onExportar={exportar}
          desabilitarExportacao={carregando || funcionariosExibidos.length === 0}
        />
        {carregando && <span role="status">Carregando...</span>}
      </div>

      {carregando ? (
        <p role="status">Carregando escala...</p>
      ) : (
        <EscalaMensal
          funcionarios={funcionariosExibidos}
          mapaEscala={mapaEscala}
          dias={dias}
          onAbrirFuncionarioDia={(funcionario, data, estado) => setDetalheFuncionarioDia({ funcionario, data, estado })}
          onAbrirDia={setDiaDetalhe}
        />
      )}

      <p className={estilos.legenda}>Clique numa célula para ver os horários daquela pessoa; clique no cabeçalho do dia para a cobertura geral.</p>

      {detalheFuncionarioDia && (
        <EscalaDiaModal
          funcionario={detalheFuncionarioDia.funcionario}
          data={detalheFuncionarioDia.data}
          estadoAtual={detalheFuncionarioDia.estado}
          podeEditar={false}
          onFechar={() => setDetalheFuncionarioDia(null)}
          onSalvo={() => setDetalheFuncionarioDia(null)}
        />
      )}

      {diaDetalhe && (
        <EscalaCoberturaDiaModal
          data={diaDetalhe}
          funcionarios={funcionarios}
          mapaEscala={mapaEscala}
          cargos={cargos}
          cargoIdInicial={filtro.cargoId}
          onFechar={() => setDiaDetalhe('')}
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
  // mantém o recorte) e pelas exportações.
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

  // Cargo é FILTRO de análise da escala, nunca uma regra nova (seção 6 da
  // instrução aprovada) -- reaproveita cargo_id/funcionarios_cargos já
  // cadastrados no funcionário (mesma fonte de pages/funcionarios.js), sem
  // nenhuma tabela/cadastro paralelo de cargos.
  const cargos = useMemo(() => {
    const porId = new Map();
    for (const f of funcionarios) {
      if (f.cargo_id && !porId.has(f.cargo_id)) {
        porId.set(f.cargo_id, { id: f.cargo_id, nome: f.funcionarios_cargos?.nome || '' });
      }
    }
    return Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome));
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
        <VisaoMensal funcionarios={funcionarios} cargos={cargos} filtro={filtro} onFiltroChange={setFiltro} />
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
