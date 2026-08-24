import { useRouter } from 'next/router';
import { useAuth } from '../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';

// Navegação interna do módulo Produção (não é o menu principal
// Dashboard/Fornecedores/Produção — essa continua intacta em cada página).
// Cada aba só aparece se o usuário tiver a permissão correspondente — regra
// centralizada aqui (não duplicada em producao.js/historico.js/produtos.js),
// no mesmo espírito de MenuOpcoes.js.
//
// Planejamento fica de fora desta lista de propósito: pages/producao/
// planejamento.js ainda não está versionado (frente separada, commit
// próprio no futuro) — apontar uma rota para ele aqui publicaria um link
// que 404 num checkout limpo. Reintroduzir a aba (com
// permissao: PERMISSOES.PLANEJAMENTO_VISUALIZAR) faz parte do commit que
// versionar aquela página.
const ABAS = [
  { chave: 'hoje', label: 'Hoje', rota: '/producao', permissao: PERMISSOES.PRODUCAO_VISUALIZAR },
  { chave: 'historico', label: 'Histórico', rota: '/producao/historico', permissao: PERMISSOES.HISTORICO_VISUALIZAR },
  { chave: 'produtos', label: 'Produtos de Produção', rota: '/producao/produtos', permissao: PERMISSOES.PRODUTOS_PRODUCAO_VISUALIZAR },
];

export default function NavegacaoProducao({ abaAtiva, corPrimaria }) {
  const router = useRouter();
  const { permissoes } = useAuth();

  const abasVisiveis = ABAS.filter((aba) => hasPermissao(permissoes, aba.permissao));

  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '20px',
        flexWrap: 'wrap',
        borderBottom: '2px solid #eee',
        paddingBottom: '15px',
      }}
    >
      {abasVisiveis.map((aba) => {
        const ativa = aba.chave === abaAtiva;
        const desabilitada = !aba.rota;

        return (
          <button
            key={aba.chave}
            type="button"
            onClick={desabilitada ? undefined : () => router.push(aba.rota)}
            disabled={desabilitada}
            title={desabilitada ? 'Em breve' : undefined}
            style={{
              padding: '8px 16px',
              backgroundColor: ativa ? corPrimaria : 'white',
              color: desabilitada ? '#bbb' : ativa ? 'white' : corPrimaria,
              border: `1px solid ${desabilitada ? '#ddd' : corPrimaria}`,
              borderRadius: '5px',
              cursor: desabilitada ? 'not-allowed' : 'pointer',
              fontWeight: ativa ? 'bold' : 'normal',
              fontSize: '14px',
            }}
          >
            {aba.label}
          </button>
        );
      })}
    </div>
  );
}
