import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { BotaoIconeAcao, IconeCheck, IconeLixeira } from '../producao/IconesAcoes';

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '18px 20px',
  borderRadius: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

// Quadro coletivo de lembretes rápidos (post-it digital) — public.
// dashboard_lembretes (migration 0021). Sem status, sem histórico: a
// existência da linha é o próprio estado "ativo". Concluir e Excluir são,
// no banco, o mesmo DELETE — a distinção é só de intenção visual (dois
// ícones diferentes), nenhum comportamento de dado diferente. Sem
// registrarAuditoria de propósito — não é dado de negócio auditável.
// Reaproveita BotaoIconeAcao/ícones já usados no Histórico de Produção.
export default function LembretesRapidos({ corPrimaria }) {
  const [lembretes, setLembretes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recarregarTick, setRecarregarTick] = useState(0);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('dashboard_lembretes')
        .select('id, texto, criado_por_nome, criado_em')
        .order('criado_em', { ascending: false });

      if (!efeitoAtivo) return;

      if (error) {
        console.error('Erro ao carregar lembretes:', error);
        setErro('Não foi possível carregar os lembretes.');
        setLembretes([]);
      } else {
        setErro('');
        setLembretes(data || []);
      }
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, [recarregarTick]);

  async function adicionar() {
    const valor = texto.trim();
    if (!valor) return;

    setSalvando(true);
    const supabase = createClient();
    // criado_por/criado_por_nome são preenchidos pelo trigger
    // dashboard_lembretes_preencher_usuario (0021) — nunca enviados
    // pelo cliente.
    const { error } = await supabase.from('dashboard_lembretes').insert({ texto: valor });
    setSalvando(false);

    if (error) {
      console.error('Erro ao adicionar lembrete:', error);
      setErro('Não foi possível adicionar o lembrete.');
      return;
    }

    setTexto('');
    setErro('');
    setRecarregarTick((tick) => tick + 1);
  }

  async function remover(id) {
    const supabase = createClient();
    const { error } = await supabase.from('dashboard_lembretes').delete().eq('id', id);

    if (error) {
      console.error('Erro ao remover lembrete:', error);
      setErro('Não foi possível remover o lembrete.');
      return;
    }

    setLembretes((atual) => atual.filter((l) => l.id !== id));
  }

  return (
    <section style={caixaEstilo}>
      <h3 style={{ margin: '0 0 12px 0', color: corPrimaria, fontSize: '16px' }}>Lembretes rápidos</h3>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') adicionar();
          }}
          placeholder="Ex.: Avisar cliente Maria quando chegar o bolo"
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid #ddd',
            borderRadius: '5px',
            boxSizing: 'border-box',
            fontSize: '14px',
          }}
        />
        <button
          onClick={adicionar}
          disabled={salvando || !texto.trim()}
          style={{
            padding: '8px 16px',
            backgroundColor: corPrimaria,
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: salvando || !texto.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
            fontSize: '13px',
            opacity: salvando || !texto.trim() ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          + Adicionar
        </button>
      </div>

      {erro && <p style={{ color: '#f44336', fontSize: '13px', margin: '0 0 10px 0' }}>{erro}</p>}

      {carregando ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Carregando lembretes...</p>
      ) : lembretes.length === 0 ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Nenhum lembrete no momento.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {lembretes.map((lembrete) => (
            <li
              key={lembrete.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '8px 10px',
                backgroundColor: '#fffde7',
                border: '1px solid #fff59d',
                borderRadius: '5px',
              }}
            >
              <span style={{ fontSize: '14px', wordBreak: 'break-word' }}>{lembrete.texto}</span>
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                <BotaoIconeAcao
                  rotulo="Concluir lembrete"
                  icone={IconeCheck}
                  cor="#4CAF50"
                  onClick={() => remover(lembrete.id)}
                />
                <BotaoIconeAcao
                  rotulo="Excluir lembrete"
                  icone={IconeLixeira}
                  destrutivo
                  onClick={() => remover(lembrete.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
