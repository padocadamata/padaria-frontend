import Link from 'next/link';
import RequireAuth from '../components/RequireAuth';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import SectionHeader from '../components/ui/SectionHeader';
import Icon from '../components/ui/Icon';
import LembretesRapidos from '../components/dashboard/LembretesRapidos';
import AgendaDeHoje from '../components/dashboard/AgendaDeHoje';
import AtencaoProducao from '../components/dashboard/AtencaoProducao';
import RecebimentosPrevistos from '../components/dashboard/RecebimentosPrevistos';
import ProximosPedidos from '../components/dashboard/ProximosPedidos';
import AniversariantesFuncionarios from '../components/dashboard/AniversariantesFuncionarios';
import styles from '../components/dashboard/dashboard.module.css';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { useAuth } from '../hooks/useAuth';
import { dataLocalExibicao } from '../lib/data/dataLocal';
import { navegacaoDoUsuario } from '../lib/nav/navegacao';

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Saudação pela hora LOCAL da Padoca (America/Sao_Paulo), nunca pela hora do
// aparelho -- mesma regra de fuso usada nas datas do sistema.
function saudacaoDoDia() {
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date())
  );
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

function primeiroNome(nomeCompleto) {
  return (nomeCompleto || '').trim().split(/\s+/)[0] || '';
}

// Dashboard = tela PILOTO do Design System. Só usa dados/funcionalidades que
// já existiam: os 5 widgets de antes (mesmas consultas, mesmas permissões) e
// atalhos derivados das permissões reais do usuário. Nada de indicador novo.
function DashboardConteudo() {
  const { permissoes, perfilUsuario } = useAuth();
  const podeVerProducao = hasPermissao(permissoes, PERMISSOES.PRODUCAO_VISUALIZAR);
  const podeVerFornecedores = hasPermissao(permissoes, PERMISSOES.FORNECEDORES_VISUALIZAR);
  const podeVerPedidos = hasPermissao(permissoes, PERMISSOES.PEDIDOS_VISUALIZAR);
  const podeVerFuncionarios = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_VISUALIZAR);
  // Agenda de hoje: mesma exigência da página /agenda (agenda.visualizar). Aniversários dentro
  // dela seguem o gate da Agenda: só com funcionarios.visualizar também.
  const podeVerAgenda = hasPermissao(permissoes, PERMISSOES.AGENDA_VISUALIZAR);

  // Atalhos = os mesmos módulos que a navegação já mostra a este usuário
  // (exceto o próprio Dashboard).
  const atalhos = navegacaoDoUsuario(permissoes).principais.filter((modulo) => modulo.chave !== 'dashboard');

  const nome = primeiroNome(perfilUsuario?.nome);
  const titulo = nome ? `${saudacaoDoDia()}, ${nome}` : saudacaoDoDia();

  return (
    <PageShell titulo="Dashboard">
      <PageHeader titulo={titulo} subtitulo={capitalizar(dataLocalExibicao())} />

      {atalhos.length > 0 && (
        <section className={styles.secao} aria-labelledby="atalhos-titulo">
          <SectionHeader id="atalhos-titulo" titulo="Acesso rápido" />
          <ul className={styles.atalhos}>
            {atalhos.map((modulo) => (
              <li key={modulo.chave}>
                <Link href={modulo.rota} className={styles.atalho}>
                  <span className={styles.atalhoIcone}>
                    <Icon nome={modulo.icone} tamanho={22} />
                  </span>
                  {modulo.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.grade}>
        {podeVerAgenda && <AgendaDeHoje incluirAniversarios={podeVerFuncionarios} />}
        {podeVerProducao && <AtencaoProducao />}
        {podeVerPedidos && <RecebimentosPrevistos />}
        <LembretesRapidos />
        {podeVerFuncionarios && <AniversariantesFuncionarios excluirHoje={podeVerAgenda} />}
      </div>

      {podeVerFornecedores && <ProximosPedidos />}
    </PageShell>
  );
}

export default function Dashboard() {
  return (
    <RequireAuth permissao={PERMISSOES.DASHBOARD_VISUALIZAR}>
      <DashboardConteudo />
    </RequireAuth>
  );
}
