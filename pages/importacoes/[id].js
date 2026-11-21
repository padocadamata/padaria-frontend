import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import SomenteAdmin from '../../components/importacoes/SomenteAdmin';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Checkbox from '../../components/ui/Checkbox';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import Modal from '../../components/ui/Modal';
import Paginacao from '../../components/Paginacao';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import styles from '../../components/importacoes/importacoes.module.css';
import { createClient } from '../../lib/supabase/client';
import {
  ACOES, MOTIVOS, ROTULOS_LAYOUT, STATUS,
  confirmarImportacao, contagensDoResumo, descartarImportacao, formatarBytes, formatarData, formatarDataHora,
  formatarMoeda, gerarPrevia, listarLotePaginado, mensagemDeErro, obterImportacao, reverterImportacao,
} from '../../lib/importacoes/consultas';
import {
  TAMANHOS_PAGINA, TAMANHO_PAGINA_PADRAO, calcularPaginacao, chaveContexto, normalizarTamanho, paginaEfetiva, precisaRolar, textoContador,
} from '../../lib/importacoes/paginacao';

// Detalhe de um lote da Central de Importações G3 (migration 0081): prévia
// (conferir -> confirmar ou descartar), lote confirmado (o que ele atestou ->
// reverter) e lotes rejeitados/encerrados (motivos).

function Dado({ rotulo, children }) {
  return (
    <div className={styles.dado}>
      <span className={styles.dadoRotulo}>{rotulo}</span>
      <span className={styles.dadoValor}>{children}</span>
    </div>
  );
}

function Contadores({ resumo, filtro, onFiltrar }) {
  const itens = contagensDoResumo(resumo);
  if (itens.length === 0) return <EmptyState>Nenhum registro de dados no arquivo.</EmptyState>;
  return (
    <div className={styles.contadores}>
      {itens.map((c) => (
        <button
          key={c.acao}
          type="button"
          className={`${styles.contador} ${filtro === c.acao ? styles.contadorAtivo : ''}`}
          onClick={() => onFiltrar(filtro === c.acao ? null : c.acao)}
          aria-pressed={filtro === c.acao}
          title={c.descricao}
        >
          <Badge tom={c.tom}>{c.rotulo}</Badge>
          <span className={styles.contadorNumero}>{Number(c.quantidade).toLocaleString('pt-BR')}</span>
          {c.valor !== null && <span className={styles.textoPequeno}>{formatarMoeda(c.valor)}</span>}
        </button>
      ))}
    </div>
  );
}

// Lista paginada NO SERVIDOR: cada troca de página/filtro/tamanho pede só a
// página atual a g3_listar_lote, que devolve também o total do filtro.
function TabelaRegistros({ supabase, loteId, acao, versao }) {
  const [tamanho, setTamanho] = useState(TAMANHO_PAGINA_PADRAO);
  const contexto = chaveContexto({ acao, tamanho, versao });
  const [estadoPagina, setEstadoPagina] = useState(null); // { contexto, pagina }
  const pagina = paginaEfetiva(estadoPagina, contexto);
  const [resultado, setResultado] = useState(null); // { contexto, pagina, registros, total }
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const topoRef = useRef(null);
  const rolarAoCarregar = useRef(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    listarLotePaginado(supabase, loteId, { acao, pagina, tamanho })
      .then((r) => {
        if (!ativo) return;
        // página que deixou de existir (ex.: lote recarregado): volta para a 1
        if (r.registros.length === 0 && pagina > 1) {
          setEstadoPagina({ contexto, pagina: 1 });
          return;
        }
        setResultado({ contexto, pagina, ...r });
      })
      .catch((e) => { if (ativo) setErro(mensagemDeErro(e)); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [supabase, loteId, acao, pagina, tamanho, contexto]);

  // depois que a nova página chega, mantém o usuário no início da tabela
  useEffect(() => {
    if (!rolarAoCarregar.current || carregando || !resultado) return;
    rolarAoCarregar.current = false;
    const el = topoRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const margem = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (precisaRolar(el.getBoundingClientRect().top, { alturaCabecalho: margem, alturaTela: window.innerHeight })) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [carregando, resultado]);

  function irPara(nova) {
    rolarAoCarregar.current = true;
    setEstadoPagina({ contexto, pagina: nova });
  }

  function mudarTamanho(evento) {
    rolarAoCarregar.current = true;
    setTamanho(normalizarTamanho(evento.target.value)); // novo contexto: volta para a página 1
  }

  const colunas = [
    { chave: 'data', rotulo: 'Data', mobile: 'titulo', semQuebra: true, render: (l) => formatarData(l.data) },
    { chave: 'chave', rotulo: 'Registro', render: (l) => (l.faceta === 'dia' ? 'Dia' : `Venda nº ${l.chave}`) },
    { chave: 'acao', rotulo: 'Situação', render: (l) => <Badge tom={ACOES[l.acao]?.tom || 'neutral'}>{ACOES[l.acao]?.rotulo || l.acao}</Badge> },
    {
      chave: 'motivo',
      rotulo: 'Detalhe',
      render: (l) => {
        if (l.motivo === 'conflito_numero' && l.detalhe) return `${MOTIVOS.conflito_numero}: ${formatarData(l.detalhe.data_atual)} no sistema`;
        if (l.motivo) return MOTIVOS[l.motivo] || l.motivo;
        return l.linhas?.length ? `Linha(s) ${l.linhas.slice(0, 6).join(', ')}${l.linhas.length > 6 ? '…' : ''}` : '—';
      },
    },
    { chave: 'valor', rotulo: 'Valor', alinhar: 'direita', render: (l) => <span className={styles.numero}>{formatarMoeda(l.valor)}</span> },
  ];

  // enquanto a próxima página carrega, a anterior continua na tela (sem saltos)
  const atual = resultado && resultado.contexto === contexto ? resultado : null;
  const exibido = atual || (resultado && resultado.contexto.split('|')[0] === contexto.split('|')[0] ? resultado : null);
  const info = calcularPaginacao({ pagina: exibido ? exibido.pagina : pagina, tamanho, total: exibido ? exibido.total : 0 });

  let corpo;
  if (erro) corpo = <Alert tom="danger">{erro}</Alert>;
  else if (!exibido) corpo = <p className={styles.texto}>Carregando…</p>;
  else if (exibido.registros.length === 0) corpo = <EmptyState>Nenhum registro {acao ? `com a situação "${ACOES[acao]?.rotulo}"` : ''}.</EmptyState>;
  else {
    corpo = (
      <div className={carregando ? styles.tabelaCarregando : undefined} aria-busy={carregando}>
        <DataTable colunas={colunas} linhas={exibido.registros} chaveLinha={(l) => `${l.faceta}:${l.chave}:${l.acao}`} rotulo="Registros do lote" denso />
      </div>
    );
  }

  return (
    <div className={`${styles.pilha} ${styles.topoTabela}`} ref={topoRef}>
      {corpo}
      {exibido && exibido.total > 0 && (
        <div className={styles.rodapeTabela}>
          <p className={styles.textoPequeno} aria-live="polite">
            {textoContador(info)}
            {info.totalPaginas > 1 ? ` — página ${info.paginaAtual} de ${info.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={info.paginaAtual} totalPaginas={info.totalPaginas} onMudarPagina={irPara} desabilitado={carregando} />
          <label className={styles.porPagina}>
            <span>Por página</span>
            <Select value={tamanho} onChange={mudarTamanho} disabled={carregando} aria-label="Registros por página" className={styles.porPaginaSelect}>
              {TAMANHOS_PAGINA.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </label>
        </div>
      )}
    </div>
  );
}

function Totais({ layout, totais }) {
  if (!totais) return null;
  if (layout === 'faturamento_geral' && totais.conferencia) {
    const nomes = { total_liquido: 'Total líquido', vendas: 'Quantidade de vendas', taxa: 'Taxa de serviço', subtotal: 'Subtotal', descontos: 'Descontos', acrescimos: 'Acréscimos', ticket_medio: 'Ticket médio' };
    return (
      <div className={styles.selos}>
        {Object.entries(totais.conferencia).map(([k, ok]) => <Badge key={k} tom={ok ? 'success' : 'danger'}>{`${nomes[k] || k}: ${ok ? 'confere' : 'não confere'}`}</Badge>)}
      </div>
    );
  }
  if (layout === 'vendas_produto_cliente') {
    return <p className={styles.textoPequeno}>Total geral do relatório: {formatarMoeda(totais.total_informado)} · soma das linhas: {formatarMoeda(totais.total_itens)}</p>;
  }
  if (totais.informado) {
    return <p className={styles.textoPequeno}>Total de vendas do relatório: {formatarMoeda(totais.informado['TOTAL VENDAS'])} · líquido: {formatarMoeda(totais.informado['TOTAL LIQ. S/ TAXA'])}</p>;
  }
  return null;
}

function DetalheLote() {
  const router = useRouter();
  const { id } = router.query;
  const supabase = createClient();
  const [lote, setLote] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState(null);
  const [reconhecer, setReconhecer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [desatualizada, setDesatualizada] = useState(false);
  const [modal, setModal] = useState(null); // 'descartar' | 'reverter'
  const [motivo, setMotivo] = useState('');
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async () => {
    if (!id) return;
    setCarregando(true);
    try {
      setLote(await obterImportacao(supabase, id));
      setErro('');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function executar(acao, sucesso) {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      await acao();
      setAviso(sucesso);
      setModal(null);
      setMotivo('');
      setDesatualizada(false);
      setFiltro(null);
      await carregar();
      setVersao((v) => v + 1);
    } catch (e) {
      const codigo = e?.causa?.code;
      if (codigo === '40001') setDesatualizada(true);
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (carregando && !lote) return <PageShell titulo="Importações G3"><p className={styles.texto}>Carregando…</p></PageShell>;
  if (!lote) {
    return (
      <PageShell titulo="Importações G3">
        <div className={styles.pilha}>
          <PageHeader titulo="Importação" acoes={<Button href="/importacoes" variante="secondary">Voltar</Button>} />
          <Alert tom="danger">{erro || 'Lote não encontrado.'}</Alert>
        </div>
      </PageShell>
    );
  }

  const st = STATUS[lote.status] || { rotulo: lote.status, tom: 'neutral' };
  const ausentes = lote.resumo?.ausentes || 0;
  const bloqueadas = lote.resumo?.bloqueadas || 0;
  const emPrevia = lote.status === 'previa';
  const confirmado = lote.status === 'confirmado' || lote.status === 'revertido';

  return (
    <PageShell titulo="Importações G3">
      <div className={styles.pilha}>
        <PageHeader
          titulo={ROTULOS_LAYOUT[lote.layout] || 'Importação'}
          subtitulo={`Lote ${lote.seq} · ${lote.arquivo_nome}`}
          acoes={<Button href="/importacoes" variante="secondary">Voltar</Button>}
        />
        {erro && <Alert tom="danger">{erro}</Alert>}
        {aviso && <Alert tom="success">{aviso}</Alert>}
        {desatualizada && (
          <Alert tom="warning">
            <div className={styles.pilha}>
              <span>Outra importação foi confirmada ou revertida depois desta prévia. Gere a prévia de novo para conferir o resultado atualizado.</span>
              <div className={styles.acoes}>
                <Button variante="primary" tamanho="sm" disabled={ocupado} onClick={() => executar(() => gerarPrevia(supabase, lote.id), 'Prévia atualizada.')}>Gerar a prévia de novo</Button>
              </div>
            </div>
          </Alert>
        )}

        <Card titulo="Lote" acao={<Badge tom={st.tom}>{st.rotulo}</Badge>}>
          <div className={styles.grade}>
            <Dado rotulo="Período do relatório">{lote.periodo_inicio ? `${formatarData(lote.periodo_inicio)} a ${formatarData(lote.periodo_fim)}` : '—'}</Dado>
            <Dado rotulo="Gerado no G3">{formatarDataHora(lote.gerado_em)}{lote.usuario_g3 ? ` · ${lote.usuario_g3}` : ''}</Dado>
            <Dado rotulo="Dias completos até">{lote.cobertura_completa_fim && lote.cobertura_completa_fim >= lote.periodo_inicio ? formatarData(lote.cobertura_completa_fim) : 'nenhum'}</Dado>
            <Dado rotulo="Dia parcial">{lote.dia_parcial ? `${formatarData(lote.dia_parcial)} (gerado no meio do dia)` : '—'}</Dado>
            <Dado rotulo="Arquivo">{`${formatarBytes(lote.arquivo_tamanho)} · ${lote.arquivo_metadados?.original ? 'original do G3' : 'regravado'}`}</Dado>
            <Dado rotulo="Linhas">{`${Number(lote.linhas_recebidas).toLocaleString('pt-BR')} de ${Number(lote.linhas_total).toLocaleString('pt-BR')}`}</Dado>
            <Dado rotulo="Enviado por">{`${lote.criado_por_nome || '—'} · ${formatarDataHora(lote.criado_em)}`}</Dado>
            {lote.confirmado_em && <Dado rotulo="Confirmado por">{`${lote.confirmado_por_nome || '—'} · ${formatarDataHora(lote.confirmado_em)}`}</Dado>}
            {lote.revertido_em && <Dado rotulo="Revertido por">{`${lote.revertido_por_nome || '—'} · ${formatarDataHora(lote.revertido_em)}`}</Dado>}
          </div>
          {lote.motivo_reversao && <p className={styles.texto}>Motivo da reversão: {lote.motivo_reversao}</p>}
        </Card>

        {lote.status === 'recebendo' && (
          <Alert tom="warning">O envio foi interrompido antes de terminar. Descarte este lote e envie o arquivo de novo (lotes interrompidos expiram sozinhos em 24 h).</Alert>
        )}

        {lote.status === 'rejeitado' && (
          <Card titulo="Arquivo recusado" subtitulo="Nada foi importado. Corrija a exportação no G3 e envie de novo.">
            <ul className={styles.lista}>
              {(lote.erros || []).map((e, i) => <li key={i}>{e.mensagem}{e.linha ? ` (linha ${e.linha})` : ''}</li>)}
            </ul>
          </Card>
        )}

        {(lote.alertas || []).length > 0 && (
          <Alert tom="warning">
            <ul className={styles.lista}>{lote.alertas.map((a, i) => <li key={i}>{a.mensagem}</li>)}</ul>
          </Alert>
        )}

        {(emPrevia || confirmado) && (
          <Card
            titulo={emPrevia ? 'Prévia: o que esta importação vai fazer' : 'O que esta importação registrou'}
            subtitulo="Toque num contador para filtrar a lista."
          >
            <div className={styles.pilha}>
              <Contadores resumo={lote.resumo} filtro={filtro} onFiltrar={setFiltro} />
              <Totais layout={lote.layout} totais={lote.totais} />
              {filtro && <p className={styles.textoPequeno}>{ACOES[filtro]?.descricao}</p>}
              <TabelaRegistros supabase={supabase} loteId={lote.id} acao={filtro} versao={versao} />
            </div>
          </Card>
        )}

        {emPrevia && (
          <Card titulo="Confirmar">
            <div className={styles.pilha}>
              {bloqueadas > 0 && (
                <p className={styles.texto}>
                  {bloqueadas} registro(s) bloqueado(s) ficam como pendência de revisão: a última versão válida continua valendo e os dias afetados não aparecem como completos.
                </p>
              )}
              {ausentes > 0 && (
                <Checkbox
                  rotulo={`Reconheço que ${ausentes} registro(s) já importado(s) não aparecem neste relatório e serão marcados como ausentes no G3.`}
                  checked={reconhecer}
                  onChange={(e) => setReconhecer(e.target.checked)}
                />
              )}
              <div className={styles.acoes}>
                <Button
                  variante="primary"
                  disabled={ocupado || (ausentes > 0 && !reconhecer)}
                  onClick={() => executar(() => confirmarImportacao(supabase, lote.id, { estadoBase: lote.estado_base, reconhecerAusentes: reconhecer }), 'Importação confirmada.')}
                >
                  Confirmar importação
                </Button>
                <Button variante="dangerOutline" disabled={ocupado} onClick={() => setModal('descartar')}>Descartar</Button>
              </div>
            </div>
          </Card>
        )}

        {(lote.status === 'recebendo' || lote.status === 'rejeitado') && (
          <div className={styles.acoes}>
            <Button variante="dangerOutline" disabled={ocupado} onClick={() => setModal('descartar')}>Descartar lote</Button>
            {lote.status === 'rejeitado' && (
              <Button variante="secondary" disabled={ocupado} onClick={() => executar(() => gerarPrevia(supabase, lote.id), 'Validação refeita.')}>Validar de novo</Button>
            )}
          </div>
        )}

        {lote.status === 'confirmado' && (
          <div className={styles.acoes}>
            <Button variante="dangerOutline" disabled={ocupado} onClick={() => setModal('reverter')}>Reverter importação</Button>
          </div>
        )}
      </div>

      {modal === 'descartar' && (
        <Modal titulo="Descartar lote" onFechar={() => setModal(null)} largura="sm">
          <div className={styles.pilha}>
            <p className={styles.texto}>As linhas enviadas e a prévia serão apagadas. Nada foi importado ainda; o histórico do lote continua registrado.</p>
            <div className={styles.acoes}>
              <Button variante="danger" disabled={ocupado} onClick={() => executar(() => descartarImportacao(supabase, lote.id), 'Lote descartado.')}>Descartar</Button>
              <Button variante="secondary" onClick={() => setModal(null)}>Cancelar</Button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'reverter' && (
        <Modal titulo="Reverter importação" onFechar={() => setModal(null)} largura="md">
          <div className={styles.pilha}>
            <p className={styles.texto}>
              Tudo o que este lote registrou deixa de valer. Cada venda ou dia volta ao que dizem as outras importações confirmadas (a de geração mais recente vence).
              O histórico do lote é preservado.
            </p>
            <Field label="Motivo da reversão (obrigatório)">
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} />
            </Field>
            <div className={styles.acoes}>
              <Button
                variante="danger"
                disabled={ocupado || motivo.trim().length < 3}
                onClick={() => executar(() => reverterImportacao(supabase, lote.id, motivo.trim()), 'Importação revertida.')}
              >
                Reverter
              </Button>
              <Button variante="secondary" onClick={() => setModal(null)}>Cancelar</Button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

export default function PaginaDetalheImportacao() {
  return (
    <RequireAuth>
      <SomenteAdmin>
        <DetalheLote />
      </SomenteAdmin>
    </RequireAuth>
  );
}
