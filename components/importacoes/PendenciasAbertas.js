import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Card from '../ui/Card';
import Alert from '../ui/Alert';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import Field from '../ui/Field';
import Select from '../ui/Select';
import Paginacao from '../Paginacao';
import styles from './importacoes.module.css';
import {
  FACETAS, MOTIVOS, ROTULOS_LAYOUT, formatarData, formatarMoeda, listarPendencias, mensagemDeErro,
} from '../../lib/importacoes/consultas';
import {
  TAMANHOS_PAGINA, TAMANHO_PAGINA_PADRAO, calcularPaginacao, chaveContexto, normalizarTamanho, paginaEfetiva,
  precisaRolar, textoContador,
} from '../../lib/importacoes/paginacao';

// Quadro "Pendências abertas" do painel da Central de Importações G3: mesmo
// padrão da lista de registros do lote -- paginação NO SERVIDOR
// (g3_listar_pendencias devolve só a página e as contagens), 20 por página,
// opções 10/20/50/100, contador real e filtro por motivo. Nunca pede o
// conjunto inteiro (a API do Supabase corta respostas em 1000 linhas).
// `versao` muda quando o painel recarrega (volta para a página 1).
export default function PendenciasAbertas({ supabase, versao }) {
  const [motivo, setMotivo] = useState('');
  const [tamanho, setTamanho] = useState(TAMANHO_PAGINA_PADRAO);
  const contexto = chaveContexto({ acao: motivo || null, tamanho, versao });
  const [estadoPagina, setEstadoPagina] = useState(null); // { contexto, pagina }
  const pagina = paginaEfetiva(estadoPagina, contexto);
  const [resultado, setResultado] = useState(null); // { contexto, pagina, registros, total }
  const [totalGeral, setTotalGeral] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const topoRef = useRef(null);
  const rolarAoCarregar = useRef(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    listarPendencias(supabase, { motivo: motivo || null, pagina, tamanho })
      .then((r) => {
        if (!ativo) return;
        // página que deixou de existir (pendências resolvidas): volta para a 1
        if (r.registros.length === 0 && pagina > 1) {
          setEstadoPagina({ contexto, pagina: 1 });
          return;
        }
        if (r.totalGeral !== null) setTotalGeral(r.totalGeral);
        else if (!motivo) setTotalGeral(0);
        setResultado({ contexto, pagina, registros: r.registros, total: r.total });
      })
      .catch((e) => { if (ativo) setErro(mensagemDeErro(e)); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [supabase, motivo, pagina, tamanho, contexto]);

  // depois que a nova página chega, mantém o usuário no início do quadro
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

  const colunas = [
    { chave: 'data', rotulo: 'Data', mobile: 'titulo', semQuebra: true, render: (p) => formatarData(p.data) },
    { chave: 'faceta', rotulo: 'Registro', render: (p) => `${FACETAS[p.faceta] || p.faceta} ${p.faceta === 'dia' ? '' : `nº ${p.chave}`}` },
    { chave: 'motivo', rotulo: 'Motivo', render: (p) => MOTIVOS[p.motivo] || p.motivo },
    { chave: 'valor', rotulo: 'Valor', alinhar: 'direita', render: (p) => <span className={styles.numero}>{formatarMoeda(p.valor)}</span> },
    { chave: 'lote', rotulo: 'Lote', render: (p) => <Link href={`/importacoes/${p.lote_id}`}>{ROTULOS_LAYOUT[p.layout] || 'Abrir'}</Link> },
  ];

  // enquanto a próxima página carrega, a anterior continua na tela (sem saltos)
  const exibido = resultado && resultado.contexto.split('|')[0] === contexto.split('|')[0] ? resultado : null;
  const info = calcularPaginacao({ pagina: exibido ? exibido.pagina : pagina, tamanho, total: exibido ? exibido.total : 0 });
  const titulo = `Pendências abertas (${totalGeral === null ? '…' : Number(totalGeral).toLocaleString('pt-BR')})`;

  let corpo;
  if (erro) corpo = <Alert tom="danger">{erro}</Alert>;
  else if (!exibido) corpo = <p className={styles.texto}>Carregando…</p>;
  else if (exibido.registros.length === 0) {
    corpo = <EmptyState>{motivo ? `Nenhuma pendência aberta com o motivo "${MOTIVOS[motivo]}".` : 'Nenhuma pendência aberta.'}</EmptyState>;
  } else {
    corpo = (
      <div className={carregando ? styles.tabelaCarregando : undefined} aria-busy={carregando}>
        <DataTable colunas={colunas} linhas={exibido.registros} chaveLinha={(p) => p.id} rotulo="Pendências abertas" />
      </div>
    );
  }

  return (
    <Card titulo={titulo} subtitulo="Vendas ou dias bloqueados. A última versão válida continua valendo; a pendência só se resolve com um relatório posterior válido.">
      <div className={`${styles.pilha} ${styles.topoTabela}`} ref={topoRef}>
        {(totalGeral > 0 || motivo) && (
          <div className={styles.filtros}>
            <Field label="Motivo">
              <Select value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={carregando}>
                <option value="">Todos os motivos</option>
                {Object.entries(MOTIVOS).map(([k, rotulo]) => <option key={k} value={k}>{rotulo}</option>)}
              </Select>
            </Field>
          </div>
        )}
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
              <Select
                value={tamanho}
                onChange={(e) => { rolarAoCarregar.current = true; setTamanho(normalizarTamanho(e.target.value)); }}
                disabled={carregando}
                aria-label="Pendências por página"
                className={styles.porPaginaSelect}
              >
                {TAMANHOS_PAGINA.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </label>
          </div>
        )}
      </div>
    </Card>
  );
}
