import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { proximosAniversariantes } from '../../lib/funcionarios/aniversarios';

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

// Widget independente, mesmo padrão de composição de
// components/dashboard/ProximosPedidos.js/RecebimentosPrevistos.js --
// só é renderizado por pages/dashboard.js quando o usuário tem
// funcionarios.visualizar. Fonte de verdade é SEMPRE
// funcionarios.data_nascimento -- nenhum evento é criado/duplicado em
// nenhuma outra tabela (Agenda inclusive). Funcionário inativo nunca
// aparece aqui porque a query já filtra ativo=true -- não existe
// nenhuma lista separada para "esquecer" de atualizar quando alguém é
// desligado.
export default function AniversariantesFuncionarios({ corPrimaria }) {
  const [aniversariantes, setAniversariantes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('funcionarios')
        .select('id, nome, data_nascimento')
        .eq('ativo', true)
        .not('data_nascimento', 'is', null);

      if (!efeitoAtivo) return;

      if (error) {
        console.error('Erro ao carregar aniversariantes:', error);
        setErro('Não foi possível carregar os aniversariantes.');
        setCarregando(false);
        return;
      }

      setAniversariantes(proximosAniversariantes(data || [], { dentroDeDias: 30 }));
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  if (carregando) return null;
  if (erro) return null; // widget de baixo risco -- some silenciosamente em vez de poluir o Dashboard com erro
  if (aniversariantes.length === 0) return null; // sem aniversariante nos próximos 30 dias: widget não ocupa espaço

  return (
    <section style={caixaEstilo}>
      <h3 style={{ margin: '0 0 12px 0', color: corPrimaria, fontSize: '16px' }}>🎂 Aniversariantes</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {aniversariantes.map((f) => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span>{f.nome}</span>
            <span style={{ color: f.diasRestantes === 0 ? '#2e7d32' : '#666', fontWeight: f.diasRestantes === 0 ? 'bold' : 'normal' }}>
              {f.diasRestantes === 0 ? 'Hoje!' : formatarDataExibicao(f.proximaData)} · {f.idadeNoAniversario} anos
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
