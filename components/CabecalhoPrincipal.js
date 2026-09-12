import MenuOpcoes from './MenuOpcoes';
import { TEMA } from '../lib/branding/tema';

// Tamanho ÚNICO do logo em todo o cabeçalho principal do sistema --
// NUNCA redefinir manualmente em nenhuma página. Se precisar mudar o
// tamanho, muda aqui uma vez só e reflete em todas as telas.
const ALTURA_LOGO_PX = 50;
const LARGURA_MAXIMA_LOGO_PX = 150;

// Cabeçalho principal único (decisão de padronização, 2026-09-12),
// usado por TODAS as páginas do sistema que exibem cabeçalho -- substitui
// os blocos de <img>+<h1>+<MenuOpcoes> antes duplicados literalmente em
// cada pages/*.js (mesmo raciocínio que levou a NavegacaoPrincipal.js a
// existir para a barra de módulos).
//
// Renderiza sempre: logo oficial fixo (lib/branding/tema.js, tamanho
// único acima) + nome do MÓDULO (prop `modulo`) + MenuOpcoes.
//
// Regra de nomenclatura do `modulo` (fonte única de verdade é quem CHAMA
// este componente, não este arquivo): é sempre o nome do módulo do topo
// (Dashboard/Fornecedores/Produção/Pedidos/Catálogo/Agenda/Folha de
// Pagamento/Usuários/Perfil) -- NUNCA o nome da empresa, NUNCA o nome da
// tela/submódulo específica. Uma página de submódulo (ex.: Produção >
// Histórico, Catálogo > novo produto, Folha de Pagamento > detalhe do
// funcionário) passa o nome do módulo PAI aqui; o nome da tela específica
// continua aparecendo dentro do conteúdo da página, abaixo da navegação
// secundária -- nunca neste cabeçalho.
export default function CabecalhoPrincipal({ modulo }) {
  return (
    <div style={{ backgroundColor: TEMA.cores.primaria, color: 'white', padding: '20px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <img
            src={TEMA.logo.src}
            alt={TEMA.logo.alt}
            style={{ height: `${ALTURA_LOGO_PX}px`, maxWidth: `${LARGURA_MAXIMA_LOGO_PX}px`, borderRadius: '5px' }}
          />
          <h1 style={{ margin: 0 }}>{modulo}</h1>
        </div>
        <MenuOpcoes corPrimaria={TEMA.cores.primaria} />
      </div>
    </div>
  );
}
