import SubNav from '../ui/SubNav';
import { useAuth } from '../../hooks/useAuth';
import { subitensDoModulo } from '../../lib/nav/navegacao';

// Abas internas do módulo Produção (Hoje, Histórico, Planejamento, Produtos,
// Expositores, Sacos Fechados) -- as rotas e permissões reais vêm de
// lib/nav/navegacao.js (mesma fonte da sidebar). Só aparecem as abas que o
// usuário pode abrir.
export default function ProducaoSubNav({ ativo }) {
  const { permissoes } = useAuth();
  const itens = subitensDoModulo('producao', permissoes).map((sub) => ({ chave: sub.chave, rotulo: sub.rotulo, href: sub.rota }));
  return <SubNav itens={itens} ativo={ativo} rotulo="Seções de Produção" />;
}
