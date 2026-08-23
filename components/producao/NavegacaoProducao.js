import { useRouter } from 'next/router';

// Navegação interna do módulo Produção (não é o menu principal
// Dashboard/Fornecedores/Produção — essa continua intacta em cada página).
// Histórico e Planejamento ainda não têm página nem rota: aparecem visíveis
// e desabilitados de propósito, sem criar página fictícia para eles.
const ABAS = [
  { chave: 'hoje', label: 'Hoje', rota: '/producao' },
  { chave: 'historico', label: 'Histórico', rota: null },
  { chave: 'planejamento', label: 'Planejamento', rota: null },
  { chave: 'produtos', label: 'Produtos de Produção', rota: '/producao/produtos' },
];

export default function NavegacaoProducao({ abaAtiva, corPrimaria }) {
  const router = useRouter();

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
      {ABAS.map((aba) => {
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
