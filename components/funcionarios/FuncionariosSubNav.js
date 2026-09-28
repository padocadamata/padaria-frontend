import SubNav from '../ui/SubNav';
import { useAuth } from '../../hooks/useAuth';
import { subitensDoModulo } from '../../lib/nav/navegacao';

// Abas internas do módulo Folha de Pagamento (Funcionários, Escala --
// migration 0055) -- rotas e permissões reais vêm de lib/nav/navegacao.js,
// mesmo padrão de PedidosSubNav.js/NavegacaoProducao.js. Cada aba aparece
// pela sua própria permissão, independente da outra.
export default function FuncionariosSubNav({ ativo }) {
  const { permissoes } = useAuth();
  const itens = subitensDoModulo('funcionarios', permissoes).map((sub) => ({ chave: sub.chave, rotulo: sub.rotulo, href: sub.rota }));
  return <SubNav itens={itens} ativo={ativo} rotulo="Seções da Folha de Pagamento" />;
}
