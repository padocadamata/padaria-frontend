import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import PageHeader from '../ui/PageHeader';
import AtestadoModal from './AtestadoModal';
import AtestadosPainel from './AtestadosPainel';
import CompetenciaNavegacao from './CompetenciaNavegacao';
import ConfirmarModal from './ConfirmarModal';
import DiaModal from './DiaModal';
import GradeDias from './GradeDias';
import HistoricoModal from './HistoricoModal';
import MotivoModal from './MotivoModal';
import PeriodosCampos from './PeriodosCampos';
import TotaisCartao from './TotaisCartao';
import { useProtecaoAlteracoes } from './useProtecaoAlteracoes';
import { apurarCartao, divergenciasDoSnapshot } from '../../lib/ponto/apuracao';
import { colunasPrincipais, igualAoPrevisto, proximoPendente } from '../../lib/ponto/lancamento';
import {
  STATUS_CARTAO, acoesDoCartao, avisosDoCartao, baseComRascunhos, diaEditavel, diasAlterados, ehConflito, mensagemErroPonto,
  montarLote, rascunhoDoDia, rascunhoIgualAoPrevisto, rotuloCompetencia, statusDoCartao,
} from '../../lib/ponto/apresentacao';
import {
  abrirCartao, cancelarAtestado, carregarCartao, carregarEmpresa, conferirCartao, fecharCartao, listarAtestados, listarEventosDoAtestado,
  listarEventosDoCartao, reabrirCartao, salvarDias,
} from '../../lib/ponto/consultas';
import { montarExportacaoCartao } from '../../lib/ponto/exportacao';
import { cx } from '../../lib/design/cx';
import estilos from './ponto.module.css';

// Cartão-Ponto de UMA funcionária numa competência. Leitura: folha_ponto_base
// (nunca cria nada -- a prévia de um cartão não aberto é só leitura).
// Escrita: só pelas RPCs da 0078, sempre com a versão esperada; conflito
// (outra pessoa/aba salvou antes) é avisado com "Recarregar", mantendo o
// que ainda não foi salvo. Cartão fechado = somente o snapshot.
// Rascunho não salvo: protegido contra qualquer saída da tela
// (useProtecaoAlteracoes) e guardado na sessão da aba (sessionStorage) --
// se a página recarregar, a tela oferece restaurar; nunca descarta calado.
export default function CartaoPonto({ funcionarioId, mes, mesAtual, pode, onMudarMes }) {
  const chaveRascunho = `cartao-ponto.rascunho.${funcionarioId}.${mes}`;
  const verificouGuardado = useRef(false);
  const [rascunhoGuardado, setRascunhoGuardado] = useState(null);
  const [base, setBase] = useState(null);
  const [erroCarga, setErroCarga] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [rascunhos, setRascunhos] = useState({});
  const [errosDias, setErrosDias] = useState({});
  const [mensagem, setMensagem] = useState(null); // { tom, texto, conflito? }
  const [salvando, setSalvando] = useState(false);
  const [selecionados, setSelecionados] = useState(new Set());
  const [modal, setModal] = useState(null); // { tipo, ... }
  const [atestados, setAtestados] = useState([]);
  const [atestadosEstado, setAtestadosEstado] = useState({ carregando: true, erro: '' });
  const [mostrarCancelados, setMostrarCancelados] = useState(false);
  const [exportando, setExportando] = useState('');
  const [filtro, setFiltro] = useState('todos'); // 'todos' | 'pendencias'
  const [ultimoSalvo, setUltimoSalvo] = useState(null); // { quantidade, hora, recente }

  const carregar = useCallback(async ({ manterRascunhos = false } = {}) => {
    setCarregando(true);
    setErroCarga('');
    try {
      const nova = await carregarCartao(funcionarioId, mes);
      setBase(nova);
      if (!manterRascunhos) setRascunhos({});
      setErrosDias({});
      setSelecionados(new Set());
    } catch (e) {
      setErroCarga(mensagemErroPonto(e));
    } finally {
      setCarregando(false);
    }
  }, [funcionarioId, mes]);

  const carregarAtestados = useCallback(async () => {
    setAtestadosEstado({ carregando: true, erro: '' });
    try {
      setAtestados(await listarAtestados(funcionarioId, { incluirCancelados: mostrarCancelados }));
      setAtestadosEstado({ carregando: false, erro: '' });
    } catch (e) {
      setAtestadosEstado({ carregando: false, erro: mensagemErroPonto(e) });
    }
  }, [funcionarioId, mostrarCancelados]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarAtestados(); }, [carregarAtestados]);

  const status = base ? statusDoCartao(base.cartao) : null;
  const fechado = status === 'fechado';
  const aberto = status === 'em_preenchimento' || status === 'conferido' || status === 'conferencia_desatualizada';
  const editando = aberto && pode.lancar;

  // Exibição: fechado = snapshot; senão a base atual COM os rascunhos.
  const exibicao = useMemo(() => {
    if (!base) return null;
    if (fechado) return { base: base.cartao.snapshot.base, apuracao: base.cartao.snapshot.apuracao };
    const previa = editando ? baseComRascunhos(base, rascunhos) : base;
    return { base: previa, apuracao: apurarCartao(previa) };
  }, [base, fechado, editando, rascunhos]);

  const alterados = useMemo(() => new Set(base && editando ? diasAlterados(base, rascunhos) : []), [base, editando, rascunhos]);
  const apuracaoSalva = useMemo(() => (base && !fechado ? apurarCartao(base) : exibicao?.apuracao), [base, fechado, exibicao]);
  const divergencias = useMemo(() => (base && fechado ? divergenciasDoSnapshot(base.cartao.snapshot.base, base) : []), [base, fechado]);

  const confirmarSaida = useProtecaoAlteracoes(alterados.size > 0);

  // Rascunho guardado na sessão da aba: lido UMA vez (depois da 1ª carga),
  // depois espelhado a cada mudança. Armazenamento indisponível = só não guarda.
  useEffect(() => {
    if (!base || verificouGuardado.current) return;
    verificouGuardado.current = true;
    try {
      const salvo = JSON.parse(window.sessionStorage.getItem(chaveRascunho) || 'null');
      if (salvo && editando && diasAlterados(base, salvo).length > 0) setRascunhoGuardado(salvo);
      else window.sessionStorage.removeItem(chaveRascunho);
    } catch {
      // sem sessionStorage: segue sem recuperação
    }
  }, [base, editando, chaveRascunho]);

  useEffect(() => {
    if (!verificouGuardado.current || rascunhoGuardado) return;
    try {
      if (alterados.size > 0) window.sessionStorage.setItem(chaveRascunho, JSON.stringify(rascunhos));
      else window.sessionStorage.removeItem(chaveRascunho);
    } catch {
      // sem sessionStorage: segue sem recuperação
    }
  }, [rascunhos, alterados.size, rascunhoGuardado, chaveRascunho]);

  useEffect(() => { setUltimoSalvo(null); }, [funcionarioId, mes]);
  useEffect(() => {
    if (!ultimoSalvo?.recente) return undefined;
    const t = setTimeout(() => setUltimoSalvo((u) => (u ? { ...u, recente: false } : u)), 5000);
    return () => clearTimeout(t);
  }, [ultimoSalvo]);

  const diaOriginal = useCallback((data) => base.dias.find((d) => d.data === data), [base]);
  const rascunhoDe = useCallback((data) => rascunhos[data] || rascunhoDoDia(diaOriginal(data)), [rascunhos, diaOriginal]);

  function mudarRascunho(data, novo) {
    setRascunhos((r) => ({ ...r, [data]: novo }));
    setErrosDias((e) => {
      if (!e[data]) return e;
      const { [data]: _, ...resto } = e;
      return resto;
    });
  }

  // Trocar de competência é navegação: pergunta antes, se houver rascunho.
  const mudarMes = (novo) => {
    if (confirmarSaida()) onMudarMes(novo);
  };

  function descartar() {
    if (!window.confirm(`Descartar as alterações de ${alterados.size} dia(s)? Elas não foram salvas.`)) return;
    setRascunhos({});
    setErrosDias({});
  }

  async function executar(acao, sucesso) {
    setMensagem(null);
    try {
      await acao();
      setModal(null);
      await carregar({ manterRascunhos: true });
      await carregarAtestados();
      if (sucesso) setMensagem({ tom: 'success', texto: sucesso });
    } catch (e) {
      if (ehConflito(e)) {
        setModal(null);
        setMensagem({ tom: 'warning', texto: mensagemErroPonto(e), conflito: true });
        return;
      }
      throw e;
    }
  }

  async function salvar() {
    const lote = montarLote(base, rascunhos);
    setErrosDias(lote.erros);
    if (Object.keys(lote.erros).length > 0) {
      setMensagem({ tom: 'danger', texto: `Corrija ${Object.keys(lote.erros).length} dia(s) antes de salvar (detalhe em cada linha).` });
      return;
    }
    if (lote.itens.length === 0) return;
    setSalvando(true);
    setMensagem(null);
    try {
      await salvarDias(base.cartao.id, base.cartao.versao, lote.itens);
      await carregar();
      // Confirmação onde o usuário está (barra de salvar e barra da grade),
      // não só no topo da página.
      setUltimoSalvo({ quantidade: lote.itens.length, hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), recente: true });
    } catch (e) {
      setMensagem({ tom: ehConflito(e) ? 'warning' : 'danger', texto: mensagemErroPonto(e), conflito: ehConflito(e) });
    } finally {
      setSalvando(false);
    }
  }

  async function exportar(formato) {
    setExportando(formato);
    setMensagem(null);
    try {
      const empresa = fechado ? null : await carregarEmpresa();
      const modelo = montarExportacaoCartao(base, { empresa });
      const { exportarCartao } = await import('../../lib/ponto/exportarCartao');
      await exportarCartao(modelo, formato);
    } catch (e) {
      console.error('Cartão-Ponto: falha ao exportar', e);
      setMensagem({ tom: 'danger', texto: 'Não foi possível gerar o arquivo. Tente de novo.' });
    } finally {
      setExportando('');
    }
  }

  function mudarFiltro(novo) {
    setFiltro(novo);
    setSelecionados(new Set()); // seleção só do que está visível
  }

  function registrarAtestado() {
    const dataInicial = base.hoje < base.dias[base.dias.length - 1].data && base.hoje >= base.competencia ? base.hoje : base.competencia;
    setModal({ tipo: 'atestado', dataInicial });
  }

  function irAoProximoPendente() {
    const inicio = modal?.tipo === 'dia' ? modal.data : '0000-00-00';
    const proximo = proximoPendente(exibicao.apuracao, inicio) || proximoPendente(exibicao.apuracao, '0000-00-00');
    if (proximo) setModal({ tipo: 'dia', data: proximo });
  }

  if (carregando && !base) return <p role="status">Carregando o cartão…</p>;
  if (erroCarga && !base) {
    return (
      <Alert tom="danger" className={estilos.mensagem}>
        <div className={estilos.avisoLinha}>
          <span>{erroCarga}</span>
          <Button tamanho="sm" variante="secondary" onClick={() => carregar()}>Tentar de novo</Button>
        </div>
      </Alert>
    );
  }
  if (!base) return null;

  const { apuracao } = exibicao;
  const func = base.funcionario;
  const semVinculo = apuracao.dias.every((d) => d.fora_vinculo);
  const acoes = acoesDoCartao({ status, apuracao: apuracaoSalva, pode, competenciaFutura: mes > base.hoje.slice(0, 7), semVinculo });
  const pendenteAlteracao = alterados.size > 0 ? 'Salve ou descarte as alterações antes.' : null;
  const avisos = avisosDoCartao({ status, apuracao, cartao: base.cartao, divergencias, competencia: base.competencia, semVinculo });
  const linhas = exibicao.base.dias.map((d, i) => ({ base: d, apurado: apuracao.dias[i], rascunho: fechado ? rascunhoDoDia(d) : rascunhoDe(d.data) }));
  // "Somente pendências": dias pendentes, com erro ou com rascunho não salvo
  // (o dia não some da tela enquanto está sendo preenchido).
  const linhasVisiveis = filtro === 'pendencias'
    ? linhas.filter((l) => l.apurado.pendencias.length > 0 || errosDias[l.base.data] || alterados.has(l.base.data))
    : linhas;
  const pendentes = apuracao.totais.dias_pendentes;
  const podeRegistrarAtestado = pode.lancar && !fechado && !semVinculo;
  const avisosPrincipais = avisos.filter((a) => !a.discreto && !a.pendentes);
  const avisosDiscretos = avisos.filter((a) => a.discreto);
  const atestadosAtivos = atestados.filter((a) => a.status === 'ativo');
  const subtitulo = [func.cargo, rotuloCompetencia(base.competencia), func.data_demissao ? `Desligada em ${func.data_demissao.split('-').reverse().join('/')}` : null].filter(Boolean).join(' · ');
  const s = STATUS_CARTAO[status];

  return (
    <div className={estilos.pilha}>
      <PageHeader
        titulo={func.nome}
        subtitulo={subtitulo}
        acoes={(
          <div className={estilos.acoes}>
            <Button href={`/funcionarios/ponto?competencia=${mes}`} variante="ghost" tamanho="sm" icone="chevronLeft">Lista</Button>
            <Button variante="secondary" tamanho="sm" icone="download" onClick={() => exportar('pdf')} disabled={Boolean(exportando)}>{exportando === 'pdf' ? 'Gerando…' : 'PDF'}</Button>
            <Button variante="secondary" tamanho="sm" icone="download" onClick={() => exportar('xlsx')} disabled={Boolean(exportando)}>{exportando === 'xlsx' ? 'Gerando…' : 'Excel'}</Button>
            {base.cartao && <Button variante="ghost" tamanho="sm" onClick={() => setModal({ tipo: 'historico' })}>Histórico</Button>}
            {podeRegistrarAtestado && <Button variante="secondary" tamanho="sm" icone="plus" onClick={registrarAtestado}>Registrar atestado</Button>}
          </div>
        )}
      />

      <div className={estilos.avisoLinha}>
        <CompetenciaNavegacao mes={mes} mesAtual={mesAtual} onMudar={mudarMes} />
        <div className={estilos.acoes}>
          <Badge tom={s.tom}>{s.rotulo}</Badge>
          {acoes.abrir.visivel && (
            <Button onClick={() => executar(() => abrirCartao(funcionarioId, mes), 'Cartão aberto.').catch((e) => setMensagem({ tom: 'danger', texto: mensagemErroPonto(e) }))} disabled={!acoes.abrir.habilitado} title={acoes.abrir.motivo || undefined}>
              Abrir cartão
            </Button>
          )}
          {acoes.conferir.visivel && (
            <Button onClick={() => setModal({ tipo: 'conferir' })} disabled={!acoes.conferir.habilitado || Boolean(pendenteAlteracao)} title={pendenteAlteracao || acoes.conferir.motivo || undefined}>
              Conferir
            </Button>
          )}
          {acoes.fechar.visivel && (
            <Button onClick={() => setModal({ tipo: 'fechar' })} disabled={!acoes.fechar.habilitado || Boolean(pendenteAlteracao)} title={pendenteAlteracao || acoes.fechar.motivo || undefined}>
              Fechar cartão
            </Button>
          )}
          {acoes.reabrir.visivel && <Button variante="secondary" onClick={() => setModal({ tipo: 'reabrir' })}>Reabrir</Button>}
        </div>
      </div>
      {(acoes.conferir.visivel && !acoes.conferir.habilitado) && <p className={estilos.aux}>Conferir: {acoes.conferir.motivo}</p>}

      {mensagem && (
        <Alert tom={mensagem.tom} className={estilos.mensagem}>
          <div className={estilos.avisoLinha}>
            <span>{mensagem.texto}</span>
            {mensagem.conflito && <Button tamanho="sm" variante="secondary" onClick={() => { setMensagem(null); carregar({ manterRascunhos: true }); carregarAtestados(); }}>Recarregar (mantém o que não foi salvo)</Button>}
          </div>
        </Alert>
      )}

      {rascunhoGuardado && (
        <Alert tom="warning" className={estilos.mensagem}>
          <div className={estilos.avisoLinha}>
            <span>Há alterações não salvas deste cartão, feitas antes de a página recarregar ({diasAlterados(base, rascunhoGuardado).length} dia(s)).</span>
            <div className={estilos.acoes}>
              <Button tamanho="sm" onClick={() => { setRascunhos(rascunhoGuardado); setRascunhoGuardado(null); }}>Restaurar</Button>
              <Button tamanho="sm" variante="secondary" onClick={() => { setRascunhoGuardado(null); try { window.sessionStorage.removeItem(chaveRascunho); } catch { /* sem armazenamento */ } }}>Descartar</Button>
            </div>
          </div>
        </Alert>
      )}

      {avisosPrincipais.length > 0 && (
        <div className={estilos.avisos}>
          {avisosPrincipais.map((a) => (
            <Alert key={a.texto} tom={a.tom} className={estilos.mensagem}>{a.texto}</Alert>
          ))}
        </div>
      )}

      <TotaisCartao apuracao={apuracao} />
      {avisosDiscretos.map((a) => <p key={a.texto} className={cx(estilos.aux, estilos.discreto)}>{a.texto}</p>)}

      <div className={estilos.barraGrade}>
        <div className={estilos.acoes}>
          <div className={estilos.filtro} role="group" aria-label="Dias exibidos">
            <button type="button" className={estilos.filtroOpcao} aria-pressed={filtro === 'todos'} onClick={() => mudarFiltro('todos')}>Todos os dias</button>
            <button type="button" className={estilos.filtroOpcao} aria-pressed={filtro === 'pendencias'} onClick={() => mudarFiltro('pendencias')}>Somente pendências ({pendentes})</button>
          </div>
          {pendentes > 0 && <Button tamanho="sm" variante="secondary" onClick={irAoProximoPendente}>Ir ao próximo pendente</Button>}
        </div>
        {editando && (
          <div className={estilos.estadoSalvo} role="status" aria-live="polite">
            {alterados.size > 0 ? (
              <>
                <span className={estilos.estadoPendente}>{alterados.size} dia(s) com alterações não salvas</span>
                <Button tamanho="sm" icone="check" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</Button>
              </>
            ) : ultimoSalvo ? (
              <span className={estilos.estadoOk}>✓ Alterações salvas às {ultimoSalvo.hora}</span>
            ) : (
              <span className={estilos.aux}>Nenhuma alteração por salvar</span>
            )}
          </div>
        )}
      </div>

      {editando && selecionados.size > 0 && (
        <div className={estilos.acoes}>
          <span>{selecionados.size} dia(s) selecionado(s)</span>
          <Button
            tamanho="sm"
            variante="secondary"
            title="Cada dia recebe o horário previsto na própria Escala."
            onClick={() => {
              setRascunhos((r) => {
                const novo = { ...r };
                for (const data of selecionados) novo[data] = rascunhoIgualAoPrevisto(diaOriginal(data), r[data] || rascunhoDoDia(diaOriginal(data)));
                return novo;
              });
              setSelecionados(new Set());
            }}
          >
            Igual ao previsto
          </Button>
          <Button tamanho="sm" variante="secondary" onClick={() => setModal({ tipo: 'repetir' })}>Repetir horários</Button>
          <Button tamanho="sm" variante="ghost" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
        </div>
      )}

      {linhasVisiveis.length === 0 ? (
        <div className={estilos.vazioFiltro}>
          <span>Nenhum dia pendente nesta competência.</span>
          <Button tamanho="sm" variante="secondary" onClick={() => mudarFiltro('todos')}>Ver todos os dias</Button>
        </div>
      ) : (
        <GradeDias
          dias={linhasVisiveis}
          atestados={exibicao.base.atestados || []}
          aberto={aberto}
          podeLancar={pode.lancar}
          alterados={alterados}
          erros={errosDias}
          selecionados={selecionados}
          onAlternarSelecao={(data) => setSelecionados((sel) => {
            const novo = new Set(sel);
            if (novo.has(data)) novo.delete(data); else novo.add(data);
            return novo;
          })}
          onAlternarTodos={(datas) => setSelecionados((sel) => (datas.every((d) => sel.has(d)) ? new Set() : new Set(datas)))}
          onCampo={(data, campo, valor) => mudarRascunho(data, { ...rascunhoDe(data), [campo]: valor })}
          onIgualAoPrevisto={(data) => mudarRascunho(data, rascunhoIgualAoPrevisto(diaOriginal(data), rascunhoDe(data)))}
          onAbrirDia={(data) => setModal({ tipo: 'dia', data })}
        />
      )}

      {editando && alterados.size > 0 && (
        <div className={estilos.barraSalvar} role="region" aria-label="Alterações não salvas">
          <span><strong>{alterados.size}</strong> dia(s) com alterações não salvas. Os horários só valem depois de salvar.</span>
          <div className={estilos.acoes}>
            <Button variante="secondary" onClick={descartar} disabled={salvando}>Descartar</Button>
            <Button icone="check" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</Button>
          </div>
        </div>
      )}
      {editando && alterados.size === 0 && ultimoSalvo?.recente && (
        <div className={cx(estilos.barraSalvar, estilos.barraSalvarOk)} role="status">
          <span className={estilos.estadoOk}>✓ {ultimoSalvo.quantidade} dia(s) salvo(s) às {ultimoSalvo.hora}.</span>
        </div>
      )}

      <AtestadosPainel
        atestados={atestados}
        carregando={atestadosEstado.carregando}
        erro={atestadosEstado.erro}
        mostrarCancelados={mostrarCancelados}
        onMostrarCancelados={setMostrarCancelados}
        podeLancar={pode.lancar}
        onRegistrar={registrarAtestado}
        onEditar={(a) => setModal({ tipo: 'atestado', existente: a })}
        onCancelar={(a) => setModal({ tipo: 'cancelarAtestado', atestado: a })}
        onHistorico={(a) => setModal({ tipo: 'historicoAtestado', atestado: a })}
      />

      {modal?.tipo === 'dia' && (() => {
        const i = exibicao.base.dias.findIndex((d) => d.data === modal.data);
        const dBase = fechado ? exibicao.base.dias[i] : diaOriginal(modal.data);
        const editavel = pode.lancar ? diaEditavel(apuracao.dias[i], { aberto, atestados: exibicao.base.atestados || [] }) : { horarios: false, ajuste: false };
        return (
          <DiaModal
            key={modal.data}
            diaBase={dBase}
            diaApurado={apuracao.dias[i]}
            rascunho={fechado ? rascunhoDoDia(dBase) : rascunhoDe(modal.data)}
            base={exibicao.base}
            editavel={editavel}
            podeLancarAtestado={pode.lancar && !fechado}
            onAplicar={(novo) => { mudarRascunho(modal.data, novo); setModal(null); }}
            onRegistrarAtestado={(data) => setModal({ tipo: 'atestado', dataInicial: data })}
            onFechar={() => setModal(null)}
          />
        );
      })()}

      {modal?.tipo === 'repetir' && (
        <RepetirHorariosModal
          quantidade={selecionados.size}
          inicial={igualAoPrevisto(diaOriginal([...selecionados].sort()[0])?.escala)}
          onAplicar={(periodos) => {
            const colunas = colunasPrincipais(periodos);
            setRascunhos((r) => {
              const novo = { ...r };
              for (const data of selecionados) novo[data] = { ...(r[data] || rascunhoDoDia(diaOriginal(data))), ...colunas };
              return novo;
            });
            setSelecionados(new Set());
            setModal(null);
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'atestado' && (
        <AtestadoModal
          base={base}
          funcionarioId={funcionarioId}
          existente={modal.existente || null}
          dataInicial={modal.dataInicial}
          outros={atestadosAtivos}
          onSalvo={async () => {
            setModal(null);
            await carregar({ manterRascunhos: true });
            await carregarAtestados();
            setMensagem({ tom: 'success', texto: modal.existente ? 'Atestado alterado.' : 'Atestado registrado.' });
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'cancelarAtestado' && (
        <MotivoModal
          titulo="Cancelar atestado"
          texto="O atestado deixa de valer em todos os dias que cobre. O registro e o histórico são mantidos."
          rotuloMotivo="Motivo do cancelamento"
          rotuloConfirmar="Cancelar atestado"
          perigo
          onConfirmar={(motivo) => executar(() => cancelarAtestado(modal.atestado.id, modal.atestado.versao, motivo), 'Atestado cancelado.')}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'conferir' && (
        <ConfirmarModal
          titulo="Conferir cartão"
          texto={`Confirma a conferência de ${rotuloCompetencia(base.competencia)}? Qualquer alteração posterior (no cartão, em atestados ou na Escala) desfaz a conferência.`}
          apuracao={apuracaoSalva}
          rotuloConfirmar="Conferir"
          onConfirmar={() => executar(() => conferirCartao(base.cartao.id, base.cartao.versao), 'Cartão conferido.')}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'fechar' && (
        <ConfirmarModal
          titulo="Fechar cartão"
          texto="Fechar congela o documento (snapshot): a tela, o PDF e o Excel passam a usar só o que foi fechado, e mudanças na Escala não o alteram. Para corrigir depois, será preciso reabrir com motivo."
          apuracao={apuracaoSalva}
          rotuloConfirmar="Fechar cartão"
          onConfirmar={() => executar(() => fecharCartao(base.cartao.id, base.cartao.versao), 'Cartão fechado.')}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'reabrir' && (
        <MotivoModal
          titulo="Reabrir cartão"
          texto="O cartão volta a ficar em preenchimento e sem conferência. O documento fechado é guardado no histórico."
          rotuloMotivo="Motivo da reabertura"
          rotuloConfirmar="Reabrir"
          onConfirmar={(motivo) => executar(() => reabrirCartao(base.cartao.id, base.cartao.versao, motivo), 'Cartão reaberto.')}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'historico' && (
        <HistoricoModal titulo="Histórico do cartão" carregar={() => listarEventosDoCartao(base.cartao.id)} onFechar={() => setModal(null)} />
      )}
      {modal?.tipo === 'historicoAtestado' && (
        <HistoricoModal titulo="Histórico do atestado" carregar={() => listarEventosDoAtestado(modal.atestado.id)} onFechar={() => setModal(null)} />
      )}
    </div>
  );
}

// "Repetir horários": os mesmos períodos nos dias selecionados (situação e
// observação de cada dia são mantidas). Só muda o rascunho.
function RepetirHorariosModal({ quantidade, inicial, onAplicar, onFechar }) {
  const [periodos, setPeriodos] = useState(inicial.length > 0 ? inicial : [{ entrada: '', saida: '' }]);
  const preenchidos = periodos.filter((p) => p.entrada || p.saida);
  return (
    <Modal titulo={`Repetir horários em ${quantidade} dia(s)`} onFechar={onFechar} largura="sm">
      <div className={estilos.formulario}>
        <PeriodosCampos periodos={periodos} onAlterar={setPeriodos} />
        <p className={estilos.aux}>Os horários entram como rascunho; a validação acontece em “Salvar alterações”.</p>
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={() => onAplicar(preenchidos)} disabled={preenchidos.length === 0}>Aplicar</Button>
        </div>
      </div>
    </Modal>
  );
}
