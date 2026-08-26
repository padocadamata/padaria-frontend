import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';

const TURNO_LABEL = { manha: 'Manhã', tarde: 'Tarde' };
const STATUS_LABEL = { aberto: 'Aberto', reaberto: 'Reaberto' };
const LIMITE_VISIVEL = 5;

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '18px 20px',
  borderRadius: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Bloco "Atenção" — produções pendentes. Reaproveita exatamente o mesmo
// critério já usado em pages/producao/historico.js (status <> 'fechado'
// == aberto ou reaberto == pendente) — nenhum conceito novo. Pendências
// antigas não somem sozinhas: sem filtro de data, aparecem até serem
// resolvidas no próprio módulo de Produção. Reaproveita producao.
// visualizar (RLS já existente) — este componente só é renderizado pelo
// Dashboard quando o usuário já tem essa permissão.
export default function AtencaoProducao({ corPrimaria }) {
  const router = useRouter();
  const [pendencias, setPendencias] = useState([]);
  const [receitaNomePorId, setReceitaNomePorId] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      const supabase = createClient();

      const [registrosResp, receitasResp] = await Promise.all([
        supabase
          .from('producao_registros')
          .select('id, data, turno, receita_id, status')
          .neq('status', 'fechado')
          .order('data', { ascending: true }),
        supabase.from('receitas').select('id, nome'),
      ]);

      if (!efeitoAtivo) return;

      const primeiroErro = registrosResp.error || receitasResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar pendências de produção:', primeiroErro);
        setErro('Não foi possível carregar as pendências de produção.');
        setPendencias([]);
        setCarregando(false);
        return;
      }

      const mapa = {};
      for (const r of receitasResp.data || []) {
        mapa[r.id] = r.nome;
      }

      setReceitaNomePorId(mapa);
      setPendencias(registrosResp.data || []);
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  function irParaHistorico() {
    router.push('/producao/historico');
  }

  const visiveis = pendencias.slice(0, LIMITE_VISIVEL);
  const restantes = pendencias.length - visiveis.length;

  return (
    <section style={caixaEstilo}>
      <h3 style={{ margin: '0 0 12px 0', color: corPrimaria, fontSize: '16px' }}>Atenção</h3>

      {erro ? (
        <p style={{ color: '#f44336', fontSize: '13px', margin: 0 }}>{erro}</p>
      ) : carregando ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Carregando...</p>
      ) : pendencias.length === 0 ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Nenhuma pendência de produção no momento.</p>
      ) : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {visiveis.map((pendencia) => (
              <li
                key={pendencia.id}
                onClick={irParaHistorico}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  backgroundColor: '#fff3e0',
                  border: '1px solid #ffcc80',
                  borderRadius: '5px',
                  fontSize: '13px',
                }}
              >
                ⚠ Produção pendente — {formatarDataExibicao(pendencia.data)} · {TURNO_LABEL[pendencia.turno] || pendencia.turno} ·{' '}
                {receitaNomePorId[pendencia.receita_id] || pendencia.receita_id} ·{' '}
                {STATUS_LABEL[pendencia.status] || pendencia.status}
              </li>
            ))}
          </ul>

          {restantes > 0 && (
            <p
              onClick={irParaHistorico}
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
              + {restantes} outras pendências
            </p>
          )}
        </>
      )}
    </section>
  );
}
