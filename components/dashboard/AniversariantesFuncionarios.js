import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { proximosAniversariantes } from '../../lib/funcionarios/aniversarios';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { cx } from '../../lib/design/cx';
import styles from './dashboard.module.css';

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
// `excluirHoje`: true quando o card "Agenda de hoje" está na tela (quem tem
// agenda.visualizar) -- o aniversário de HOJE já aparece lá, então aqui ficam só os
// PRÓXIMOS (dias > 0), evitando repetir a mesma informação. Sem acesso à Agenda o
// widget segue como sempre foi (inclui "Hoje!"). Dados e permissões não mudam.
export default function AniversariantesFuncionarios({ excluirHoje = false }) {
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
  const exibidos = excluirHoje ? aniversariantes.filter((f) => f.diasRestantes > 0) : aniversariantes;
  if (exibidos.length === 0) return null; // sem aniversariante a exibir: widget não ocupa espaço

  return (
    <Card titulo={excluirHoje ? 'Próximos aniversários' : 'Aniversariantes'} subtitulo="Próximos 30 dias" icone="gift">
      <ul className={styles.lista}>
        {exibidos.map((f) => (
          <li key={f.id} className={cx(styles.item, styles.itemNota)}>
            <span className={styles.itemTextos}>
              <span className={styles.itemTitulo}>{f.nome}</span>
              <span className={styles.itemMeta}>
                {f.diasRestantes === 0 ? '' : `${formatarDataExibicao(f.proximaData)} · `}
                {f.idadeNoAniversario} anos
              </span>
            </span>
            {f.diasRestantes === 0 && <Badge tom="success">Hoje!</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
