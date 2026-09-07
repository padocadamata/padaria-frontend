import { useRouter } from 'next/router';
import { useAuth } from '../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';

// Navegação interna do módulo Pedidos (não é a barra principal
// Dashboard/Fornecedores/Produção/Pedidos/... — essa continua intacta em
// cada página) — mesmo padrão de components/producao/NavegacaoProducao.js:
// cada aba é uma ROTA própria, e só aparece se o usuário tiver a
// permissão correspondente. Resumo usa "qualquer uma das duas" (pedidos.
// visualizar OU pedidos_solicitacoes.visualizar) porque mostra um
// subconjunto de cada, conforme o que o usuário puder ver — igual à regra
// já aplicada em MODULOS.pedidos (lib/auth/permissoes.js).
const ABAS = [
  {
    chave: 'resumo',
    label: 'Resumo',
    rota: '/pedidos/resumo',
    permissoes: [PERMISSOES.PEDIDOS_VISUALIZAR, PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR],
  },
  { chave: 'pedidos', label: 'Pedidos', rota: '/pedidos', permissoes: [PERMISSOES.PEDIDOS_VISUALIZAR] },
  {
    chave: 'solicitacoes',
    label: 'Solicitações',
    rota: '/pedidos/solicitacoes',
    permissoes: [PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR],
  },
];

export default function NavegacaoPedidos({ abaAtiva, corPrimaria }) {
  const router = useRouter();
  const { permissoes } = useAuth();

  const abasVisiveis = ABAS.filter((aba) => aba.permissoes.some((codigo) => hasPermissao(permissoes, codigo)));

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

        return (
          <button
            key={aba.chave}
            type="button"
            onClick={() => router.push(aba.rota)}
            style={{
              padding: '8px 16px',
              backgroundColor: ativa ? corPrimaria : 'white',
              color: ativa ? 'white' : corPrimaria,
              border: `1px solid ${corPrimaria}`,
              borderRadius: '5px',
              cursor: 'pointer',
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
