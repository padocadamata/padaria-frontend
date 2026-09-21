import PageShell from '../shell/PageShell';
import PageHeader from '../ui/PageHeader';
import ProducaoSubNav from './ProducaoSubNav';

// Moldura comum das seis telas de Produção: shell (sidebar/topbar/bottom
// nav), abas internas do módulo e cabeçalho da página. O conteúdo de cada
// tela entra como children.
export default function PaginaProducao({ ativo, titulo, subtitulo, acoes, children }) {
  return (
    <PageShell titulo="Produção">
      <ProducaoSubNav ativo={ativo} />
      <PageHeader titulo={titulo} subtitulo={subtitulo} acoes={acoes} />
      {children}
    </PageShell>
  );
}
