import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useAuth } from '../hooks/useAuth';
import { TEMA } from '../lib/branding/tema';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Icon from '../components/ui/Icon';
import { cx } from '../lib/design/cx';
import estilos from '../components/login/login.module.css';

// Tela pública de login -- SEM PageShell (o usuário ainda não está
// autenticado, não faz sentido sidebar/topbar/bottom nav). Autenticação
// inalterada: mesmo useAuth().signIn(email, senha) (Supabase Auth,
// signInWithPassword), mesmo redirect para /dashboard, mesmas duas
// mensagens de erro (credenciais inválidas vs. falha genérica -- nunca
// diferenciando "email não existe" de "senha errada", o que permitiria
// enumerar usuários), mesmo estado de loading. Só a apresentação mudou.
//
// className="ds" no wrapper raiz (mesmo escopo que o PageShell aplica em
// todo o resto do sistema, ver styles/base.css): é o que dá
// box-sizing: border-box a esta árvore inteira -- sem isso, o Input
// (width:100% + padding) fica maior que 100% do cartão sob o content-box
// padrão do navegador. body.ds-body (margin:0 + fundo) replica o mesmo
// efeito que o PageShell já aplica enquanto montado, e é desfeito ao sair
// desta página -- mesmo padrão de components/shell/PageShell.js.
export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    document.body.classList.add('ds-body');
    return () => {
      document.body.classList.remove('ds-body');
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErro('');

    const resultado = await signIn(email, senha);

    if (resultado.sucesso) {
      router.push('/dashboard');
    } else {
      setErro(
        resultado.erro === 'Invalid login credentials'
          ? 'Email ou senha incorretos.'
          : 'Não foi possível entrar. Tente novamente em instantes.'
      );
    }

    setLoading(false);
  };

  return (
    <div className={cx('ds', estilos.pagina)}>
      <Head>
        <title>{`Entrar · ${TEMA.nomeEmpresa}`}</title>
      </Head>

      <div className={estilos.grade}>
        {/* Mobile/tablet: faixa institucional compacta (fundo verde
            primário) -- resolve o contraste do logo off-white sem editar o
            PNG, duplicar arquivo ou aplicar filtro de cor. Some a partir do
            desktop, onde o painel lateral cheio assume a mesma função. */}
        <div className={estilos.faixaInstitucional}>
          <img className={estilos.logo} src={TEMA.logo.src} alt={TEMA.logo.alt} />
        </div>

        {/* Desktop: painel lateral cheio, mesmo logo, sem repetir o nome da
            empresa em texto -- só o slogan, discreto. */}
        <div className={estilos.institucionalDesktop}>
          <img className={estilos.logo} src={TEMA.logo.src} alt={TEMA.logo.alt} />
          <p className={estilos.slogan}>Sistema de gestão</p>
        </div>

        <div className={estilos.areaFormulario}>
          <div className={estilos.cartao}>
            <h1 className={estilos.titulo}>Entrar</h1>
            <p className={estilos.subtitulo}>Faça login para continuar</p>

            {erro && (
              <Alert tom="danger" className={estilos.mensagem}>
                {erro}
              </Alert>
            )}

            <form onSubmit={handleLogin}>
              <div className={estilos.campos}>
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </Field>

                <Field label="Senha">
                  <div className={estilos.campoSenha}>
                    <Input
                      type={mostrarSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      autoComplete="current-password"
                      required
                      className={estilos.inputSenha}
                    />
                    <button
                      type="button"
                      className={estilos.botaoMostrarSenha}
                      onClick={() => setMostrarSenha((atual) => !atual)}
                      aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={mostrarSenha}
                    >
                      <Icon nome="eye" tamanho={18} />
                    </button>
                  </div>
                </Field>
              </div>

              <div className={estilos.rodape}>
                <Button type="submit" block disabled={loading}>
                  {loading ? 'Entrando…' : 'Entrar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
