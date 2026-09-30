import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import RequireAuth from '../../../components/RequireAuth';
import CalendarioImpressao from '../../../components/tarefas/CalendarioImpressao';
import { PERMISSOES } from '../../../lib/auth/permissoes';
import { dataLocalHoje } from '../../../lib/data/dataLocal';
import { diasDoMes, inicioDoMes } from '../../../lib/tarefas/calendario';
import { carregarCadastro, carregarOcorrencias } from '../../../lib/tarefas/consultas';
import { montarImpressao, rotuloMesImpressao } from '../../../lib/tarefas/impressao';
import estilos from '../../../components/tarefas/impressao.module.css';

// Folha de Pagamento > Tarefas > Imprimir calendário (A4 paisagem / PDF).
//
// Visualização PRÓPRIA para papel (sem menu, filtros, botões ou checkbox):
// aberta pelo botão "Imprimir calendário" do calendário, que passa
// ?imprimir=1 para abrir o diálogo nativo do navegador (imprimir ou "Salvar
// como PDF") assim que os dados carregam. Abrir esta rota sem o parâmetro
// só mostra a prévia -- nunca imprime sozinha. Somente leitura.

const PAGINA_A4_PAISAGEM = `
  @page { size: A4 landscape; margin: 8mm; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  }
`;

function TarefasImpressao() {
  const router = useRouter();
  const hoje = dataLocalHoje();
  const [cadastro, setCadastro] = useState(null);
  const [ocorrencias, setOcorrencias] = useState([]);
  const [erro, setErro] = useState('');
  const imprimiu = useRef(false);

  const mes = useMemo(() => {
    const pedido = typeof router.query.mes === 'string' ? router.query.mes : '';
    return /^\d{4}-\d{2}(-\d{2})?$/.test(pedido) ? `${pedido.slice(0, 7)}-01` : inicioDoMes(hoje);
  }, [router.query.mes, hoje]);
  const dias = useMemo(() => diasDoMes(mes), [mes]);

  useEffect(() => {
    if (!router.isReady) return undefined;
    let ativo = true;
    Promise.all([carregarCadastro(), carregarOcorrencias(dias[0], dias[dias.length - 1])])
      .then(([c, o]) => {
        if (!ativo) return;
        setCadastro(c);
        setOcorrencias(o);
      })
      .catch((e) => {
        console.error('Erro ao carregar a impressão de Tarefas:', e);
        if (ativo) setErro('Não foi possível carregar o calendário para impressão.');
      });
    return () => {
      ativo = false;
    };
  }, [router.isReady, dias]);

  // Mesma data de referência do calendário (hoje, limitado ao mês).
  const dataReferencia = hoje < dias[0] ? dias[0] : hoje > dias[dias.length - 1] ? dias[dias.length - 1] : hoje;
  const modelo = useMemo(
    () => (cadastro ? montarImpressao({ ...cadastro, ocorrencias, mes, dataReferencia }) : null),
    [cadastro, ocorrencias, mes, dataReferencia]
  );

  // Diálogo de impressão SÓ quando aberto pelo botão (?imprimir=1).
  useEffect(() => {
    if (!modelo || imprimiu.current || router.query.imprimir !== '1') return undefined;
    imprimiu.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [modelo, router.query.imprimir]);

  return (
    <div className={estilos.pagina}>
      <Head>
        <title>{`Calendário de Tarefas — ${rotuloMesImpressao(mes)}`}</title>
        <style dangerouslySetInnerHTML={{ __html: PAGINA_A4_PAISAGEM }} />
      </Head>

      <div className={estilos.barra}>
        <Link href="/funcionarios/tarefas">← Voltar ao calendário</Link>
        <button type="button" onClick={() => window.print()} disabled={!modelo}>
          Imprimir / Salvar em PDF
        </button>
        <p className={estilos.dica}>
          Na janela de impressão: escolha a impressora ou &quot;Salvar como PDF&quot;, papel A4, layout Paisagem e margens Padrão.
          O cabeçalho do calendário se repete em cada folha.
        </p>
        {erro && <p className={estilos.dica} role="alert">{erro}</p>}
      </div>

      {!modelo && !erro && <p className={estilos.barra} role="status">Carregando calendário…</p>}
      {modelo && (
        <div className={estilos.previa}>
          <CalendarioImpressao modelo={modelo} />
        </div>
      )}
    </div>
  );
}

export default function TarefasImpressaoPage() {
  return (
    <RequireAuth permissao={PERMISSOES.TAREFAS_VISUALIZAR}>
      <TarefasImpressao />
    </RequireAuth>
  );
}
