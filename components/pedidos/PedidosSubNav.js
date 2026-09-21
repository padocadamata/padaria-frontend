import SubNav from '../ui/SubNav';
import { useAuth } from '../../hooks/useAuth';
import { subitensDoModulo } from '../../lib/nav/navegacao';

// Abas internas do módulo Pedidos (Resumo, Pedidos, Solicitações) -- rotas e
// permissões reais vêm de lib/nav/navegacao.js (mesma fonte da sidebar e da
// navegação antiga: Resumo aparece com pedidos.visualizar OU
// pedidos_solicitacoes.visualizar; as demais, cada uma pela sua permissão).
export default function PedidosSubNav({ ativo }) {
  const { permissoes } = useAuth();
  const itens = subitensDoModulo('pedidos', permissoes).map((sub) => ({ chave: sub.chave, rotulo: sub.rotulo, href: sub.rota }));
  return <SubNav itens={itens} ativo={ativo} rotulo="Seções de Pedidos" />;
}
