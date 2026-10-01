import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../../components/RequireAuth';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import PagamentosAPagarVisao from '../../../components/funcionarios/PagamentosAPagarVisao';
import PagamentosPagosVisao from '../../../components/funcionarios/PagamentosPagosVisao';
import PagamentosConfiguracoesVisao from '../../../components/funcionarios/PagamentosConfiguracoesVisao';
import PageShell from '../../../components/shell/PageShell';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { PERMISSOES, hasPermissao } from '../../../lib/auth/permissoes';
import { createClient } from '../../../lib/supabase/client';
import { useAuth } from '../../../hooks/useAuth';
import estilosEscala from '../../../components/funcionarios/escala.module.css';

// Folha de Pagamento > Pagamentos (migrations 0065/0066) -- 3 "visões"
// (A Pagar / Pagos / Configurações) na mesma rota, mesmo padrão de Escala
// (Semanal/Mensal/Cobertura, pages/funcionarios/escala.js) -- nunca
// sub-rotas separadas, pra não precisar de outra entrada de navegação por
// visão.
function PagamentosConteudo() {
  const { permissoes } = useAuth();
  const podeConfirmar = hasPermissao(permissoes, PERMISSOES.FOLHA_PAGAMENTOS_CONFIRMAR);
  const podeCancelar = hasPermissao(permissoes, PERMISSOES.FOLHA_PAGAMENTOS_CANCELAR);
  const podeRegras = hasPermissao(permissoes, PERMISSOES.FOLHA_PAGAMENTOS_REGRAS);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.FOLHA_PAGAMENTOS_EDITAR);

  const [visao, setVisao] = useState('a_pagar');
  const [funcionarios, setFuncionarios] = useState([]);
  const [carregandoFuncionarios, setCarregandoFuncionarios] = useState(true);
  const [erro, setErro] = useState('');
  // Inativos só aparecem no filtro de Pagos (histórico); A Pagar e
  // Configurações trabalham com quem está ativo.
  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregandoFuncionarios(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('funcionarios')
        .select('id, nome, ativo, tipo_vinculo')
        .order('nome');
      if (!ativo) return;
      if (error) {
        console.error('Erro ao carregar funcionários para Pagamentos:', error);
        setErro('Não foi possível carregar os funcionários.');
      }
      setFuncionarios(data || []);
      setCarregandoFuncionarios(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="pagamentos" />
      <PageHeader
        titulo="Pagamentos"
        acoes={
          <div className={estilosEscala.navegacaoSemana}>
            <Button variante={visao === 'a_pagar' ? 'primary' : 'secondary'} tamanho="sm" onClick={() => setVisao('a_pagar')}>A Pagar</Button>
            <Button variante={visao === 'pagos' ? 'primary' : 'secondary'} tamanho="sm" onClick={() => setVisao('pagos')}>Pagos</Button>
            <Button variante={visao === 'configuracoes' ? 'primary' : 'secondary'} tamanho="sm" onClick={() => setVisao('configuracoes')}>Configurações</Button>
          </div>
        }
      />

      {erro && <Alert tom="danger" className={estilosEscala.mensagem}>{erro}</Alert>}

      {carregandoFuncionarios ? (
        <p role="status">Carregando...</p>
      ) : visao === 'a_pagar' ? (
        <PagamentosAPagarVisao funcionarios={ativos} podeConfirmar={podeConfirmar} onIrParaConfiguracoes={() => setVisao('configuracoes')} />
      ) : visao === 'pagos' ? (
        <PagamentosPagosVisao funcionarios={funcionarios} podeCancelar={podeCancelar} />
      ) : (
        <PagamentosConfiguracoesVisao funcionarios={ativos} podeRegras={podeRegras} podeEditar={podeEditar} />
      )}
    </PageShell>
  );
}

export default function PagamentosPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_PAGAMENTOS_VISUALIZAR}>
      <PagamentosConteudo />
    </RequireAuth>
  );
}
