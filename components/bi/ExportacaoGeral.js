import { useRef, useState } from 'react';
import Button from '../ui/Button';
import { useBi } from './contexto';
import s from './bi.module.css';

// Exportação GERAL do BI (todos os blocos) em Excel ou PDF, no cabeçalho.
// As exportações individuais da Tabela de produtos continuam no próprio bloco.
//  - Instantâneo no clique (filtros, seleção, parâmetros e consultas de cada
//    bloco): mudar os filtros durante a geração não afeta o arquivo.
//  - Uma geração por vez (cliques repetidos são ignorados) e indicação do
//    andamento; blocos com erro são declarados no arquivo E aqui.
//  - Mesmo cliente das RPCs (cache + fila de 3): o que o painel já carregou
//    não é consultado de novo.
//  - O código da exportação (modelo + gráficos do PDF) só é carregado no
//    clique (import dinâmico), sem pesar no carregamento do painel.
export default function BotoesExportacaoGeral() {
  const { cliente, geral, status, selecionados, descricoes, cores, lerRegistroExportacao } = useBi();
  const [estado, setEstado] = useState({ formato: null, fase: '', mensagem: '', aviso: false });
  const emAndamento = useRef(false);

  const exportar = async (formato) => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    const nome = formato === 'pdf' ? 'PDF' : 'Excel';
    setEstado({ formato, fase: 'Coletando dados…', mensagem: '', aviso: false });
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      // Instantâneo ANTES de qualquer espera (import/consultas).
      const agora = new Date();
      const registro = lerRegistroExportacao();
      const estadoNoClique = JSON.parse(JSON.stringify({ registro, geral, status, selecionados, descricoes, cores }));
      const [{ capturarInstantaneo, coletarDadosExportacao, montarExportacaoGeral }, { exportarRelatorio }] = await Promise.all([
        import('../../lib/bi/exportacaoGeral'),
        import('../../lib/exportacao/exportar'),
      ]);
      const instantaneo = capturarInstantaneo({
        ...estadoNoClique,
        geradoEm: agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        geradoEmIso: agora.toISOString(),
      });
      const dados = await coletarDadosExportacao(cliente, instantaneo, {
        aoProgredir: (feitas, total) => setEstado((e) => ({ ...e, fase: `Coletando dados (${feitas}/${total})…` })),
      });
      setEstado((e) => ({ ...e, fase: `Montando ${nome}…` }));
      const modelo = montarExportacaoGeral(instantaneo, dados);
      await exportarRelatorio(modelo, formato);
      const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      if (typeof window !== 'undefined') window.__biUltimaExportacao = { formato, ms, completo: modelo.completo, situacoes: modelo.situacoes };
      setEstado({
        formato: null,
        fase: '',
        aviso: !modelo.completo,
        mensagem: modelo.completo
          ? `${nome} gerado (${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s).`
          : `${nome} gerado INCOMPLETO: ${modelo.situacoes.filter((x) => x.estado === 'erro' || x.estado === 'parcial').map((x) => x.titulo).join(', ')} (indicado no arquivo).`,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[BI] exportação geral', e);
      setEstado({ formato: null, fase: '', aviso: true, mensagem: `Não foi possível gerar o ${nome}: ${e && e.message ? e.message : 'erro inesperado'}.` });
    } finally {
      emAndamento.current = false;
    }
  };

  const ocupado = !!estado.formato;
  return (
    <div className={s.exportacaoGeral}>
      <div className={s.exportacaoBotoes}>
        <Button
          variante="secondary"
          tamanho="sm"
          icone="download"
          onClick={() => exportar('xlsx')}
          disabled={ocupado}
          aria-busy={estado.formato === 'xlsx'}
          title="Exportar o BI Gerencial completo em Excel (.xlsx): todas as análises, com os filtros gerais e os de cada bloco"
          aria-label="Exportar o BI Gerencial completo em Excel"
        >
          {estado.formato === 'xlsx' ? 'Gerando Excel…' : 'Exportar Excel'}
        </Button>
        <Button
          variante="secondary"
          tamanho="sm"
          icone="download"
          onClick={() => exportar('pdf')}
          disabled={ocupado}
          aria-busy={estado.formato === 'pdf'}
          title="Exportar o BI Gerencial completo em PDF (relatório gerencial para impressão), com os filtros gerais e os de cada bloco"
          aria-label="Exportar o BI Gerencial completo em PDF"
        >
          {estado.formato === 'pdf' ? 'Gerando PDF…' : 'Exportar PDF'}
        </Button>
      </div>
      <span className={estado.aviso ? s.exportacaoAviso : s.exportacaoNota} aria-live="polite" role={estado.aviso ? 'status' : undefined}>
        {ocupado ? estado.fase : estado.mensagem}
      </span>
    </div>
  );
}
