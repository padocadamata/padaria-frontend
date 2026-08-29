import { useRouter } from 'next/router';
import { useAuth } from '../hooks/useAuth';
import { MODULOS, ITENS_NAVEGACAO_PRINCIPAL, hasPermissao } from '../lib/auth/permissoes';

// Barra horizontal principal (Dashboard/Fornecedores/Produção/Pedidos/...),
// fonte única substituindo os blocos de botões que antes eram duplicados
// literalmente em cada pages/*.js. Mesmo mecanismo já usado por
// MenuOpcoes.js (MODULOS + hasPermissao) — só a lista de itens é outra
// (ITENS_NAVEGACAO_PRINCIPAL, sem perfil/aparencia/usuarios). Não altera o
// menu "Opções" de forma nenhuma.
//
// "Ativa" é derivado direto de router.pathname (prefixo da rota do
// módulo) — nenhuma página precisa passar qual botão destacar; páginas
// como /producao/historico continuam destacando "Produção" automaticamente,
// igual ao comportamento anterior.
//
// Rótulos próprios desta barra (não os de MODULOS/MenuOpcoes): o menu
// "Opções" usa "🏠 Início" com emoji para o mesmo /dashboard, mas esta
// barra sempre mostrou o texto puro "Dashboard" — são rótulos legitimamente
// diferentes para o mesmo módulo em dois contextos de UI, preservados como
// já eram antes desta refatoração.
const ROTULOS = {
  dashboard: 'Dashboard',
  fornecedores: 'Fornecedores',
  producao: 'Produção',
  pedidos: 'Pedidos',
  catalogo: 'Catálogo',
};

export default function NavegacaoPrincipal({ corPrimaria }) {
  const router = useRouter();
  const { permissoes } = useAuth();

  const itensVisiveis = ITENS_NAVEGACAO_PRINCIPAL
    .filter((chave) => hasPermissao(permissoes, MODULOS[chave].permissao))
    .map((chave) => ({ chave, ...MODULOS[chave] }));

  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap' }}>
      {itensVisiveis.map((modulo) => {
        const ativa = router.pathname === modulo.rota || router.pathname.startsWith(modulo.rota + '/');

        return (
          <button
            key={modulo.rota}
            onClick={() => router.push(modulo.rota)}
            style={{
              padding: '10px 20px',
              backgroundColor: ativa ? corPrimaria : 'white',
              color: ativa ? 'white' : corPrimaria,
              border: ativa ? 'none' : '1px solid ' + corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            {ROTULOS[modulo.chave] || modulo.label}
          </button>
        );
      })}
    </div>
  );
}
