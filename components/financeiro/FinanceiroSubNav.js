import SubNav from '../ui/SubNav';
import { useAuth } from '../../hooks/useAuth';
import { subitensDoModulo } from '../../lib/nav/navegacao';

// Abas da área Financeiro (migration 0073) -- rotas e permissões vêm de
// lib/nav/navegacao.js, mesmo padrão de FuncionariosSubNav.js.
export default function FinanceiroSubNav({ ativo }) {
  const { permissoes } = useAuth();
  const itens = subitensDoModulo('financeiro', permissoes).map((sub) => ({ chave: sub.chave, rotulo: sub.rotulo, href: sub.rota }));
  return <SubNav itens={itens} ativo={ativo} rotulo="Seções do Financeiro" />;
}
