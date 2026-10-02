import SubNav from '../ui/SubNav';
import { useAuth } from '../../hooks/useAuth';
import { subitensDoModulo } from '../../lib/nav/navegacao';

// Abas internas do módulo Clientes (Clientes, Encomendas) -- rotas e
// permissões reais vêm de lib/nav/navegacao.js (mesma fonte da sidebar),
// cada aba pela sua própria permissão (clientes.visualizar /
// encomendas.visualizar). Mesmo padrão de PedidosSubNav/FuncionariosSubNav.
export default function ClientesSubNav({ ativo }) {
  const { permissoes } = useAuth();
  const itens = subitensDoModulo('clientes', permissoes).map((sub) => ({ chave: sub.chave, rotulo: sub.rotulo, href: sub.rota }));
  return <SubNav itens={itens} ativo={ativo} rotulo="Seções de Clientes" />;
}
