import { AuthProvider } from '../hooks/useAuth';
// Design System (nova base visual). Só declaram variáveis e regras escopadas
// em .ds / body.ds-body -- páginas ainda não migradas não são afetadas.
import '../styles/tokens.css';
import '../styles/base.css';

// Aparência deixou de ser configurável (decisão de negócio 2026-09-12,
// ver relatório da rodada de branding) -- não há mais nenhuma leitura de
// localStorage/polling/CSS var para "aplicar tema" aqui. A identidade
// visual oficial (lib/branding/tema.js) é fixa e cada página já importa
// TEMA/APARENCIA_FIXA diretamente.
function MyApp({ Component, pageProps }) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
}

export default MyApp;
