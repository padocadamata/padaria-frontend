import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';

const LIMITE_VISIVEL = 5;

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '18px 20px',
  borderRadius: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

function formatarDataExibicao(dataYYYYMMDD) {
  const [, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

// Recebimentos PREVISTOS a partir de public.pedidos REAIS -- diferente de
// components/dashboard/ProximosPedidos.js, que é a agenda TEÓRICA (quando
// pedir/entregar, calculada só a partir de fornecedor_regras_pedido, sem
// nenhum pedido real envolvido). Este componente não lê
// fornecedor_regras_pedido em nenhum momento -- só public.pedidos.
//
// Critério (aprovado): status='aguardando_entrega' e
//   previsao_entrega === hoje    -> "Recebimento previsto hoje"
//   previsao_entrega <  hoje     -> "Entrega atrasada"
//   previsao_entrega >  hoje     -> não entra neste widget (sem urgência)
//   previsao_entrega === null    -> não entra (não dá pra classificar)
// recebido/cancelado nunca aparecem (já filtrados na própria query).
export default function RecebimentosPrevistos({ corPrimaria }) {
  const router = useRouter();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      const supabase = createClient();

      const [pedidosResp, fornecedoresResp] = await Promise.all([
        supabase
          .from('pedidos')
          .select('id, fornecedor_id, previsao_entrega')
          .eq('status', 'aguardando_entrega')
          .not('previsao_entrega', 'is', null),
        supabase.from('fornecedores').select('id, nome, nome_fantasia, razao_social'),
      ]);

      if (!efeitoAtivo) return;

      const primeiroErro = pedidosResp.error || fornecedoresResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar recebimentos previstos:', primeiroErro);
        setErro('Não foi possível carregar os recebimentos previstos.');
        setItens([]);
        setCarregando(false);
        return;
      }

      const nomePorFornecedorId = {};
      for (const f of fornecedoresResp.data || []) {
        nomePorFornecedorId[f.id] = f.nome_fantasia || f.razao_social || f.nome || f.id;
      }

      const hoje = dataLocalHoje();

      const classificados = (pedidosResp.data || [])
        .filter((p) => p.previsao_entrega <= hoje)
        .map((p) => ({
          id: p.id,
          fornecedorNome: nomePorFornecedorId[p.fornecedor_id] || p.fornecedor_id,
          previsaoEntrega: p.previsao_entrega,
          atrasado: p.previsao_entrega < hoje,
        }))
        .sort((a, b) => (a.previsaoEntrega < b.previsaoEntrega ? -1 : a.previsaoEntrega > b.previsaoEntrega ? 1 : 0));

      setItens(classificados);
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  function irParaPedido(id) {
    router.push(`/pedidos?id=${id}`);
  }

  const visiveis = itens.slice(0, LIMITE_VISIVEL);
  const restantes = itens.length - visiveis.length;

  return (
    <section style={caixaEstilo}>
      <h3 style={{ margin: '0 0 12px 0', color: corPrimaria, fontSize: '16px' }}>
        Recebimentos previstos (pedidos reais)
      </h3>

      {erro ? (
        <p style={{ color: '#f44336', fontSize: '13px', margin: 0 }}>{erro}</p>
      ) : carregando ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Carregando...</p>
      ) : itens.length === 0 ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>
          Nenhum recebimento previsto para hoje nem atrasado.
        </p>
      ) : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {visiveis.map((item) => (
              <li
                key={item.id}
                onClick={() => irParaPedido(item.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  backgroundColor: item.atrasado ? '#ffebee' : '#fff3e0',
                  border: item.atrasado ? '1px solid #ef9a9a' : '1px solid #ffcc80',
                  borderRadius: '5px',
                  fontSize: '13px',
                }}
              >
                {item.atrasado ? '🔴 Entrega atrasada' : '🟡 Recebimento previsto hoje'} — {item.fornecedorNome} · previsão{' '}
                {formatarDataExibicao(item.previsaoEntrega)}
              </li>
            ))}
          </ul>

          {restantes > 0 && (
            <p
              onClick={() => router.push('/pedidos')}
              style={{
                cursor: 'pointer',
                color: corPrimaria,
                fontSize: '13px',
                fontWeight: 'bold',
                marginTop: '8px',
                marginBottom: 0,
                textDecoration: 'underline',
              }}
            >
              + {restantes} outros pedidos
            </p>
          )}
        </>
      )}
    </section>
  );
}
