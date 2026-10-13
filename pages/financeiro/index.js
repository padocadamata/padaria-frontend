import { useEffect } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import { PERMISSOES } from '../../lib/auth/permissoes';

// /financeiro -> única sub-área existente (migration 0073). Quando surgirem
// outras (ex.: Contas a Receber), esta rota pode virar um resumo.
export default function FinanceiroPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/financeiro/contas-pagar');
  }, [router]);
  return (
    <RequireAuth permissao={PERMISSOES.CONTAS_PAGAR_VISUALIZAR}>
      <p role="status">Abrindo Contas a Pagar...</p>
    </RequireAuth>
  );
}
