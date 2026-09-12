import CabecalhoPrincipal from '../components/CabecalhoPrincipal';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import LembretesRapidos from '../components/dashboard/LembretesRapidos';
import AtencaoProducao from '../components/dashboard/AtencaoProducao';
import RecebimentosPrevistos from '../components/dashboard/RecebimentosPrevistos';
import ProximosPedidos from '../components/dashboard/ProximosPedidos';
import AniversariantesFuncionarios from '../components/dashboard/AniversariantesFuncionarios';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { useAuth } from '../hooks/useAuth';
import { dataLocalHoje, diaDaSemanaExibicao } from '../lib/data/dataLocal';
import { APARENCIA_FIXA } from '../lib/branding/tema';

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function DashboardConteudo() {
  const { permissoes } = useAuth();
  const hoje = dataLocalHoje();
  const podeVerProducao = hasPermissao(permissoes, PERMISSOES.PRODUCAO_VISUALIZAR);
  const podeVerFornecedores = hasPermissao(permissoes, PERMISSOES.FORNECEDORES_VISUALIZAR);
  const podeVerPedidos = hasPermissao(permissoes, PERMISSOES.PEDIDOS_VISUALIZAR);
  const podeVerFuncionarios = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_VISUALIZAR);
  const aparencia = APARENCIA_FIXA;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Dashboard" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <h2 style={{ color: aparencia.corPrimaria, margin: '0 0 20px 0' }}>
          Dashboard — {capitalizar(diaDaSemanaExibicao(hoje))}, {formatarDataExibicao(hoje)}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {podeVerProducao && <AtencaoProducao corPrimaria={aparencia.corPrimaria} />}

          {podeVerFuncionarios && <AniversariantesFuncionarios corPrimaria={aparencia.corPrimaria} />}

          <LembretesRapidos corPrimaria={aparencia.corPrimaria} />

          {podeVerPedidos && <RecebimentosPrevistos corPrimaria={aparencia.corPrimaria} />}

          {podeVerFornecedores && <ProximosPedidos corPrimaria={aparencia.corPrimaria} />}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <RequireAuth permissao={PERMISSOES.DASHBOARD_VISUALIZAR}>
      <DashboardConteudo />
    </RequireAuth>
  );
}
