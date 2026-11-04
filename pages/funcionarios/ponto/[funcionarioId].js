import { useRouter } from 'next/router';
import RequireAuth from '../../../components/RequireAuth';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import CartaoPonto from '../../../components/ponto/CartaoPonto';
import PageShell from '../../../components/shell/PageShell';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../../lib/auth/permissoes';
import { dataLocalHoje } from '../../../lib/data/dataLocal';
import { mesValido, permissoesDoPonto } from '../../../lib/ponto/apresentacao';

// Folha de Pagamento > Cartão-Ponto > cartão de uma funcionária
// (?competencia=AAAA-MM; padrão = mês atual). Ver CartaoPonto.js.
function CartaoPontoFuncionaria() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const pode = permissoesDoPonto(permissoes, hasPermissao, PERMISSOES);
  const mesAtual = dataLocalHoje().slice(0, 7);
  const { funcionarioId, competencia } = router.query;
  const mes = mesValido(competencia) && competencia <= mesAtual ? competencia : mesAtual;

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="ponto" />
      {router.isReady && typeof funcionarioId === 'string' ? (
        <CartaoPonto
          key={`${funcionarioId}-${mes}`}
          funcionarioId={funcionarioId}
          mes={mes}
          mesAtual={mesAtual}
          pode={pode}
          onMudarMes={(novo) => router.push({ pathname: router.pathname, query: { funcionarioId, competencia: novo } })}
        />
      ) : (
        <p role="status">Carregando…</p>
      )}
    </PageShell>
  );
}

export default function CartaoPontoFuncionariaPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_PONTO_VISUALIZAR}>
      <CartaoPontoFuncionaria />
    </RequireAuth>
  );
}
