import { AuthProvider } from '../hooks/useAuth';

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
