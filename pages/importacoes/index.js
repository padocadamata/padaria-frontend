import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import RequireAuth from '../../components/RequireAuth';
import SomenteAdmin from '../../components/importacoes/SomenteAdmin';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import Input from '../../components/ui/Input';
import Checkbox from '../../components/ui/Checkbox';
import styles from '../../components/importacoes/importacoes.module.css';
import { createClient } from '../../lib/supabase/client';
import {
  COBERTURA, ESTADO_DIA, FACETAS, MOTIVOS, ROTULOS_LAYOUT, STATUS,
  conciliacaoDiaria, espacoOcupado, formatarBytes, formatarData, formatarDataHora, formatarMoeda,
  hojeSP, limparExpirados, listarImportacoes, listarPendencias, mensagemDeErro, somarDias,
} from '../../lib/importacoes/consultas';

// Central de Importações do G3ERP (migration 0081) -- painel: conferência
// diária entre os 3 relatórios, pendências abertas e histórico de lotes.
// Exclusiva do proprietario_admin (SomenteAdmin + is_admin() no banco).

const TAMANHO_HISTORICO = 30;

function Selo({ mapa, valor }) {
  const def = mapa[valor] || { rotulo: valor || '—', tom: 'neutral' };
  return <Badge tom={def.tom}>{def.rotulo}</Badge>;
}

function resumoCurto(resumo) {
  const por = resumo?.por_acao;
  if (!por) return '—';
  const partes = [];
  if (por.nova) partes.push(`${por.nova} novas`);
  if (por.alterada) partes.push(`${por.alterada} alteradas`);
  if (por.igual) partes.push(`${por.igual} iguais`);
  if (por.bloqueada) partes.push(`${por.bloqueada} bloqueadas`);
  if (por.ausente) partes.push(`${por.ausente} ausentes`);
  return partes.join(' · ') || '—';
}

function PainelImportacoes() {
  const supabase = createClient();
  const [inicio, setInicio] = useState(() => somarDias(hojeSP(), -30));
  const [fim, setFim] = useState(() => hojeSP());
  const [soProblemas, setSoProblemas] = useState(true);
  const [dias, setDias] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [espaco, setEspaco] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregarLotes = useCallback(async (deslocamento = 0) => {
    const lista = await listarImportacoes(supabase, { limite: TAMANHO_HISTORICO + 1, deslocamento });
    setTemMais(lista.length > TAMANHO_HISTORICO);
    const pagina = lista.slice(0, TAMANHO_HISTORICO);
    setLotes((atual) => (deslocamento === 0 ? pagina : [...atual, ...pagina]));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const [conc, pend, bytes] = await Promise.all([
        conciliacaoDiaria(supabase, inicio, fim),
        listarPendencias(supabase),
        espacoOcupado(supabase),
        carregarLotes(0),
      ]);
      setDias(conc);
      setPendencias(pend);
      setEspaco(bytes);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [supabase, inicio, fim, carregarLotes]);

  useEffect(() => {
    if (inicio && fim && inicio <= fim) carregar();
  }, [carregar, inicio, fim]);

  const contagemDias = useMemo(() => {
    const c = {};
    for (const d of dias) c[d.estado] = (c[d.estado] || 0) + 1;
    return c;
  }, [dias]);
  const diasVisiveis = useMemo(() => (soProblemas ? dias.filter((d) => d.estado !== 'conciliado') : dias), [dias, soProblemas]);

  async function limpar() {
    setAviso('');
    try {
      const r = await limparExpirados(supabase);
      setAviso(`Limpeza concluída: ${r.expirados} lote(s) interrompido(s) expirado(s), ${r.revertidos_purgados} lote(s) revertido(s) sem linhas brutas.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  const colunasDias = [
    { chave: 'dia', rotulo: 'Dia', mobile: 'titulo', semQuebra: true, render: (d) => formatarData(d.dia) },
    { chave: 'estado', rotulo: 'Situação', render: (d) => <Selo mapa={ESTADO_DIA} valor={d.estado} /> },
    {
      chave: 'cobertura',
      rotulo: 'Itens · Faturamento · Diário',
      render: (d) => (
        <span className={styles.selos}>
          <Selo mapa={COBERTURA} valor={d.cobertura_itens} />
          <Selo mapa={COBERTURA} valor={d.cobertura_faturamento} />
          <Selo mapa={COBERTURA} valor={d.cobertura_periodo} />
        </span>
      ),
    },
    { chave: 'vendas', rotulo: 'Vendas', alinhar: 'direita' },
    {
      chave: 'problemas',
      rotulo: 'Divergências',
      render: (d) => {
        const p = [];
        if (d.divergentes) p.push(`${d.divergentes} itens ≠ bruto`);
        if (d.sem_itens) p.push(`${d.sem_itens} sem itens`);
        if (d.sem_faturamento) p.push(`${d.sem_faturamento} sem faturamento`);
        if (d.ausentes) p.push(`${d.ausentes} ausentes`);
        if (d.pendencias) p.push(`${d.pendencias} pendências`);
        return p.join(' · ') || '—';
      },
    },
    { chave: 'soma_itens', rotulo: 'Itens (bruto)', alinhar: 'direita', render: (d) => <span className={styles.numero}>{formatarMoeda(d.soma_itens)}</span> },
    { chave: 'soma_prod', rotulo: 'Faturamento bruto', alinhar: 'direita', render: (d) => <span className={styles.numero}>{formatarMoeda(d.soma_prod)}</span> },
    { chave: 'periodo_venda', rotulo: 'Diário (venda)', alinhar: 'direita', render: (d) => <span className={styles.numero}>{formatarMoeda(d.periodo_venda)}</span> },
    { chave: 'soma_liquido', rotulo: 'Faturamento líquido', alinhar: 'direita', render: (d) => <span className={styles.numero}>{formatarMoeda(d.soma_liquido)}</span> },
    { chave: 'periodo_liquido', rotulo: 'Diário (líquido)', alinhar: 'direita', render: (d) => <span className={styles.numero}>{formatarMoeda(d.periodo_liquido)}</span> },
  ];

  const colunasPendencias = [
    { chave: 'data', rotulo: 'Data', mobile: 'titulo', semQuebra: true, render: (p) => formatarData(p.data) },
    { chave: 'faceta', rotulo: 'Registro', render: (p) => `${FACETAS[p.faceta] || p.faceta} ${p.faceta === 'dia' ? '' : `nº ${p.chave}`}` },
    { chave: 'motivo', rotulo: 'Motivo', render: (p) => MOTIVOS[p.motivo] || p.motivo },
    { chave: 'valor', rotulo: 'Valor', alinhar: 'direita', render: (p) => <span className={styles.numero}>{formatarMoeda(p.valor)}</span> },
    { chave: 'lote', rotulo: 'Lote', render: (p) => <Link href={`/importacoes/${p.lote_id}`}>{ROTULOS_LAYOUT[p.layout] || 'Abrir'}</Link> },
  ];

  const colunasLotes = [
    { chave: 'criado_em', rotulo: 'Enviado em', mobile: 'titulo', semQuebra: true, render: (l) => formatarDataHora(l.criado_em) },
    { chave: 'layout', rotulo: 'Relatório', render: (l) => ROTULOS_LAYOUT[l.layout] || l.layout },
    { chave: 'periodo', rotulo: 'Período', semQuebra: true, render: (l) => (l.periodo_inicio ? `${formatarData(l.periodo_inicio)} a ${formatarData(l.periodo_fim)}` : '—') },
    { chave: 'gerado_em', rotulo: 'Gerado no G3', semQuebra: true, render: (l) => formatarDataHora(l.gerado_em) },
    { chave: 'status', rotulo: 'Situação', render: (l) => <Selo mapa={STATUS} valor={l.status} /> },
    { chave: 'resumo', rotulo: 'Resultado', render: (l) => resumoCurto(l.resumo) },
    { chave: 'arquivo_nome', rotulo: 'Arquivo', render: (l) => l.arquivo_nome },
  ];

  return (
    <PageShell titulo="Importações G3">
      <div className={styles.pilha}>
        <PageHeader
          titulo="Central de Importações G3"
          subtitulo="Itens, faturamento e totais diários exportados do G3ERP, com prévia, conferência e reversão. Exclusiva do proprietário."
          acoes={<Button href="/importacoes/nova" variante="primary" icone="plus">Nova importação</Button>}
        />

        {erro && <Alert tom="danger">{erro}</Alert>}
        {aviso && <Alert tom="success">{aviso}</Alert>}

        <Card titulo="Conferência entre os relatórios" subtitulo="Um dia só fica conciliado com os 3 relatórios completos, sem pendências e com todos os totais batendo.">
          <div className={styles.pilha}>
            <div className={styles.filtros}>
              <Field label="De"><Input type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} /></Field>
              <Field label="Até"><Input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} /></Field>
              <Checkbox rotulo="Só dias que pedem atenção" checked={soProblemas} onChange={(e) => setSoProblemas(e.target.checked)} />
            </div>
            <div className={styles.selos}>
              {Object.entries(ESTADO_DIA).map(([k, def]) => (
                <Badge key={k} tom={def.tom}>{`${def.rotulo}: ${contagemDias[k] || 0}`}</Badge>
              ))}
            </div>
            {carregando ? (
              <p className={styles.texto}>Carregando…</p>
            ) : diasVisiveis.length === 0 ? (
              <EmptyState>{soProblemas ? 'Nenhum dia com divergência, pendência ou falta de dados no período.' : 'Nenhum dia no período.'}</EmptyState>
            ) : (
              <DataTable colunas={colunasDias} linhas={diasVisiveis} chaveLinha={(d) => d.dia} rotulo="Conferência diária" denso />
            )}
          </div>
        </Card>

        <Card titulo={`Pendências abertas (${pendencias.length})`} subtitulo="Vendas ou dias bloqueados. A última versão válida continua valendo; a pendência só se resolve com um relatório posterior válido.">
          {pendencias.length === 0 ? (
            <EmptyState>Nenhuma pendência aberta.</EmptyState>
          ) : (
            <DataTable colunas={colunasPendencias} linhas={pendencias} chaveLinha={(p) => p.id} rotulo="Pendências abertas" />
          )}
        </Card>

        <Card titulo="Histórico de importações">
          <div className={styles.pilha}>
            {lotes.length === 0 && !carregando ? (
              <EmptyState>Nenhuma importação ainda.</EmptyState>
            ) : (
              <DataTable
                colunas={colunasLotes}
                linhas={lotes}
                chaveLinha={(l) => l.id}
                rotulo="Histórico de importações"
                renderAcoes={(l) => <Button href={`/importacoes/${l.id}`} variante="secondary" tamanho="sm">Abrir</Button>}
              />
            )}
            {temMais && (
              <div className={styles.acoes}>
                <Button variante="secondary" onClick={() => carregarLotes(lotes.length).catch((e) => setErro(mensagemDeErro(e)))}>Carregar mais</Button>
              </div>
            )}
          </div>
        </Card>

        <div className={styles.rodapePagina}>
          <p className={styles.textoPequeno}>
            Espaço ocupado pela Central no banco: {espaco === null ? '—' : formatarBytes(espaco)}. Lotes interrompidos expiram em 24 h.
          </p>
          <Button variante="ghost" tamanho="sm" onClick={limpar}>Limpar lotes expirados</Button>
        </div>
      </div>
    </PageShell>
  );
}

export default function PaginaImportacoes() {
  return (
    <RequireAuth>
      <SomenteAdmin>
        <PainelImportacoes />
      </SomenteAdmin>
    </RequireAuth>
  );
}
