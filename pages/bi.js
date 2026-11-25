import RequireAuth from '../components/RequireAuth';
import SomenteAdmin from '../components/importacoes/SomenteAdmin';
import PageShell from '../components/shell/PageShell';
import PainelBi from '../components/bi/PainelBi';
import { createClient } from '../lib/supabase/client';

// BI Gerencial (migrations 0083 + 0084) -- painel único /bi, sem abas.
// EXCLUSIVO do perfil proprietario_admin ativo, como a Central de
// Importações: SomenteAdmin aqui é só UX; a garantia real é
// g3_exigir_admin() dentro de cada RPC (SECURITY DEFINER, erro 42501).

function Pagina() {
  return (
    <PageShell titulo="BI Gerencial">
      <PainelBi supabase={createClient()} />
    </PageShell>
  );
}

export default function PaginaBi() {
  return (
    <RequireAuth>
      <SomenteAdmin descricao="O BI Gerencial é exclusivo do perfil proprietário/administrador.">
        <Pagina />
      </SomenteAdmin>
    </RequireAuth>
  );
}
