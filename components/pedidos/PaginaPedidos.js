import PageShell from '../shell/PageShell';
import PageHeader from '../ui/PageHeader';
import PedidosSubNav from './PedidosSubNav';

// Moldura comum das telas de Pedidos: shell (sidebar/topbar/bottom nav),
// abas internas do módulo e cabeçalho da página. O conteúdo entra como
// children.
export default function PaginaPedidos({ ativo, titulo, subtitulo, acoes, children }) {
  return (
    <PageShell titulo="Pedidos">
      <PedidosSubNav ativo={ativo} />
      <PageHeader titulo={titulo} subtitulo={subtitulo} acoes={acoes} />
      {children}
    </PageShell>
  );
}
