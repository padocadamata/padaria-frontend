import { Html, Head, Main, NextScript } from 'next/document';
import { cssVariaveisDeMarca } from '../lib/branding/cssVars';

// Documento HTML base: idioma correto (pt-BR) e variáveis CSS da marca
// (derivadas de lib/branding/tema.js). As variáveis só são CONSUMIDAS pelo
// Design System novo -- as páginas antigas não as usam, então nada muda
// nelas. Nenhuma fonte externa é carregada.
export default function Document() {
  return (
    <Html lang="pt-BR">
      <Head>
        <style id="ds-marca" dangerouslySetInnerHTML={{ __html: cssVariaveisDeMarca() }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
