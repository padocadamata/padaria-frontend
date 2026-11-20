// node --test lib/notificacoes/__tests__/*.test.mjs
// Conferência estrutural da integração do sino no shell (sem renderizar):
// desktop (Topbar) e celular (MobileHeader) recebem o sino, a navegação
// inferior NÃO é tocada, o provider envolve todas as páginas e a rota do
// histórico exige login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ler = (p) => readFileSync(join(RAIZ, p), 'utf8');

test('Topbar: sino antes do menu do usuário', () => {
  const src = ler('components/shell/Topbar.js');
  const sino = src.indexOf('<SinoNotificacoes variante="topbar"');
  const menu = src.indexOf('<UserMenu');
  assert.ok(sino > 0, 'sino presente');
  assert.ok(menu > sino, 'sino vem antes do UserMenu');
  assert.ok(src.indexOf('onAlternarSidebar') > 0, 'botão de recolher a sidebar preservado');
});

test('MobileHeader: logo + título + sino no canto direito', () => {
  const src = ler('components/shell/MobileHeader.js');
  assert.ok(src.includes('TEMA.logo.src'), 'logo preservado');
  assert.ok(src.includes('{titulo}'), 'título preservado');
  assert.ok(src.indexOf('<SinoNotificacoes variante="mobile"') > src.indexOf('{titulo}'), 'sino à direita do título');
});

test('BottomNav não depende da Central de Notificações', () => {
  const src = ler('components/shell/BottomNav.js');
  assert.ok(!/notifica|Sino/i.test(src));
});

test('PageShell continua montando Sidebar, Topbar, MobileHeader e BottomNav', () => {
  const src = ler('components/shell/PageShell.js');
  for (const c of ['<Sidebar', '<Topbar', '<MobileHeader', '<BottomNav']) assert.ok(src.includes(c), c);
});

test('_app: NotificacoesProvider dentro do AuthProvider, envolvendo a página', () => {
  const src = ler('pages/_app.js');
  const auth = src.indexOf('<AuthProvider>');
  const prov = src.indexOf('<NotificacoesProvider>');
  const pag = src.indexOf('<Component {...pageProps} />');
  assert.ok(auth >= 0 && prov > auth && pag > prov);
});

test('/notificacoes protegida no middleware e na página (RequireAuth)', () => {
  assert.ok(ler('middleware.js').includes("'/notificacoes'"));
  const pagina = ler('pages/notificacoes.js');
  assert.ok(pagina.includes('<RequireAuth>') && pagina.includes('<PageShell'));
});

test('o painel do celular não usa overlay sobre a navegação inferior', () => {
  const css = ler('components/notificacoes/notificacoes.module.css');
  const bloco = css.slice(css.indexOf('.painelMobile {'), css.indexOf('}', css.indexOf('.painelMobile {')));
  assert.ok(bloco.includes('--ds-bottomnav-h'), 'altura máxima desconta a bottom nav');
  assert.ok(!css.includes('inset: 0'), 'sem overlay de tela cheia');
});
