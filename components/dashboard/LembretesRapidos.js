import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import Card from '../ui/Card';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import { cx } from '../../lib/design/cx';
import styles from './dashboard.module.css';

// Quadro coletivo de lembretes rápidos (post-it digital) — public.
// dashboard_lembretes (migration 0021). Sem status, sem histórico: a
// existência da linha é o próprio estado "ativo". Concluir e Excluir são,
// no banco, o mesmo DELETE — a distinção é só de intenção visual (dois
// ícones diferentes), nenhum comportamento de dado diferente. Sem
// registrarAuditoria de propósito — não é dado de negócio auditável.
// Visual do Design System (Card/Input/Button/IconButton); a lógica de dados
// abaixo não mudou.
export default function LembretesRapidos() {
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
    <Card titulo="Lembretes rápidos" subtitulo="Quadro coletivo da equipe" icone="note">
      <div className={styles.novoLembrete}>
        <Input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') adicionar();
          }}
          placeholder="Ex.: Avisar cliente Maria quando chegar o bolo"
          aria-label="Novo lembrete"
        />
        <Button variante="primary" icone="plus" onClick={adicionar} disabled={salvando || !texto.trim()}>
          Adicionar
        </Button>
      </div>

      {erro && <p className={styles.erro}>{erro}</p>}

      {carregando ? (
        <p className={styles.vazio}>Carregando lembretes...</p>
      ) : lembretes.length === 0 ? (
        <p className={styles.vazio}>Nenhum lembrete no momento.</p>
      ) : (
        <ul className={styles.lista}>
          {lembretes.map((lembrete) => (
            <li key={lembrete.id} className={cx(styles.item, styles.itemNota)}>
              <span className={styles.itemTexto}>{lembrete.texto}</span>
              <div className={styles.itemAcoes}>
                <IconButton
                  icone="check"
                  tom="success"
                  tamanho="sm"
                  rotulo="Concluir lembrete"
                  onClick={() => remover(lembrete.id)}
                />
                <IconButton
                  icone="trash"
                  tom="danger"
                  tamanho="sm"
                  rotulo="Excluir lembrete"
                  onClick={() => remover(lembrete.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
