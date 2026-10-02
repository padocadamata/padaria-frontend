import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje, somarDias } from '../../lib/data/dataLocal';
import { buscarItensDaAgenda, buscarNascimentosParaAgenda } from '../../lib/agenda/consultasAgenda';
import { ocorrenciasDoDia, resumirAgendaDoDia } from '../../lib/agenda/resumoDoDia';
import { carregarEncomendas } from '../../lib/encomendas/encomendas';
import { itensDashboardEncomendas } from '../../lib/encomendas/agenda';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Icon from '../ui/Icon';
import { cx } from '../../lib/design/cx';
import styles from './dashboard.module.css';

const ICONE_POR_TIPO = { aniversario: 'gift', evento: 'calendar', tarefa: 'check', encomenda: 'clipboard', lembrete_encomenda: 'note' };

// Resumo do DIA ATUAL (America/Sao_Paulo) da Agenda: mesmas consultas
// (lib/agenda/consultasAgenda.js), mesma expansão de recorrência e mesma
// síntese de aniversário de /agenda -- nada é gravado nem duplicado.
//
// Permissões (o gate é da página): só é renderizado para quem tem
// agenda.visualizar. Aniversários só entram (e a consulta de funcionários só
// dispara) para quem também tem funcionarios.visualizar -- `incluirAniversarios`.
// Encomendas (migration 0071) só entram para quem tem encomendas.visualizar
// -- `incluirEncomendas`: as de HOJE como compromisso e, pela regra padrão
// do módulo, as PENDENTES de AMANHÃ como lembrete (lib/encomendas/agenda.js).
// Projeção da mesma RPC da tela de Encomendas -- nada gravado.
export default function AgendaDeHoje({ incluirAniversarios, incluirEncomendas = false }) {
  const [itens, setItens] = useState([]);
  const [excecoes, setExcecoes] = useState([]);
  const [nascimentos, setNascimentos] = useState([]);
  const [encomendas, setEncomendas] = useState([]);
  const [erroEncomendas, setErroEncomendas] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const hoje = dataLocalHoje();

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      const supabase = createClient();

      const [agenda, funcionarios, resultadoEncomendas] = await Promise.all([
        buscarItensDaAgenda(supabase, { inicio: hoje, fim: hoje }, { continuar: () => efeitoAtivo }),
        incluirAniversarios ? buscarNascimentosParaAgenda(supabase) : Promise.resolve({ data: [], error: null }),
        incluirEncomendas ? carregarEncomendas(hoje, somarDias(hoje, 1), supabase) : Promise.resolve({ encomendas: [], erro: '' }),
      ]);

      if (!efeitoAtivo || agenda.cancelado) return;

      if (agenda.erro || funcionarios.error) {
        if (funcionarios.error) console.error('Erro ao carregar aniversários para a Agenda de hoje:', funcionarios.error);
        setErro('Não foi possível carregar a agenda de hoje.');
        setCarregando(false);
        return;
      }

      setItens(agenda.itens);
      setExcecoes(agenda.excecoes);
      setNascimentos(funcionarios.data || []);
      // Falha só das encomendas não esconde o resto da agenda do dia.
      setEncomendas(resultadoEncomendas.encomendas);
      setErroEncomendas(resultadoEncomendas.erro ? 'Não foi possível carregar as encomendas de hoje/amanhã.' : '');
      setErro('');
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, [hoje, incluirAniversarios, incluirEncomendas]);

  const resumo = useMemo(
    () =>
      resumirAgendaDoDia(
        ocorrenciasDoDia({
          itens,
          excecoes,
          funcionariosNascimento: incluirAniversarios ? nascimentos : [],
          itensAdicionais: incluirEncomendas ? itensDashboardEncomendas(encomendas, hoje) : [],
          dia: hoje,
        })
      ),
    [itens, excecoes, nascimentos, encomendas, incluirAniversarios, incluirEncomendas, hoje]
  );

  return (
    <Card
      titulo="Agenda de hoje"
      icone="calendar"
      acao={
        <Button href="/agenda" variante="ghost" tamanho="sm" iconeDireita="arrowRight">
          Ver agenda
        </Button>
      }
    >
      {erro ? (
        <p className={styles.erro}>{erro}</p>
      ) : carregando ? (
        <p className={styles.vazio}>Carregando...</p>
      ) : resumo.total === 0 ? (
        <p className={styles.vazio}>Nenhum compromisso para hoje.</p>
      ) : (
        <>
          <ul className={styles.lista}>
            {resumo.itens.map((item) => (
              <li key={item.id} className={cx(styles.item, styles.itemNota)}>
                <span className={cx(styles.itemIcone, styles.itemIconeAgenda)}>
                  <Icon nome={ICONE_POR_TIPO[item.tipo] || 'calendar'} tamanho={18} />
                </span>
                <span className={styles.itemTexto}>
                  {item.hora && <span className={styles.agendaHora}>{item.hora} · </span>}
                  {item.titulo}
                </span>
              </li>
            ))}
          </ul>

          {resumo.restantes > 0 && (
            <Link href="/agenda" className={styles.mais}>
              + {resumo.restantes} {resumo.restantes === 1 ? 'outro evento' : 'outros eventos'} hoje
            </Link>
          )}
        </>
      )}
      {!erro && !carregando && erroEncomendas && <p className={styles.erro}>{erroEncomendas}</p>}
    </Card>
  );
}
