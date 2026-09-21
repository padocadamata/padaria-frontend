import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Icon from '../ui/Icon';
import { cx } from '../../lib/design/cx';
import styles from './dashboard.module.css';

const TURNO_LABEL = { manha: 'Manhã', tarde: 'Tarde' };
const STATUS_LABEL = { aberto: 'Aberto', reaberto: 'Reaberto' };
const LIMITE_VISIVEL = 5;

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
export default function AtencaoProducao() {
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
        // Sem filtro de ativo (igual ao comportamento anterior à
        // unificação): pendências antigas podem referenciar uma extensão
        // ou um produto já desativado depois, e o nome precisa continuar
        // aparecendo. Por isso, diferente de Tela Hoje/Planejamento, NÃO
        // usar produtos!inner nem filtrar produtos.ativo/receitas.ativo
        // aqui -- LEFT embed (produtos, sem !inner) + fallback
        // produto.nome ?? receita.nome, mesmo princípio pedido para o
        // contexto histórico de pages/producao/historico.js.
        supabase.from('receitas').select('id, nome, produtos(nome)'),
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
        mapa[r.id] = r.produtos?.nome ?? r.nome;
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

  const visiveis = pendencias.slice(0, LIMITE_VISIVEL);
  const restantes = pendencias.length - visiveis.length;

  return (
    <Card titulo="Atenção" subtitulo="Produções pendentes" icone="alert">
      {erro ? (
        <p className={styles.erro}>{erro}</p>
      ) : carregando ? (
        <p className={styles.vazio}>Carregando...</p>
      ) : pendencias.length === 0 ? (
        <p className={styles.vazio}>Nenhuma pendência de produção no momento.</p>
      ) : (
        <>
          <ul className={styles.lista}>
            {visiveis.map((pendencia) => (
              <li key={pendencia.id}>
                <Link href="/producao/historico" className={cx(styles.item, styles.itemLink, styles.itemAviso)}>
                  <span className={styles.itemIcone}>
                    <Icon nome="alert" tamanho={18} />
                  </span>
                  <span className={styles.itemTextos}>
                    <span className={styles.itemTitulo}>
                      {receitaNomePorId[pendencia.receita_id] || pendencia.receita_id}
                    </span>
                    <span className={styles.itemMeta}>
                      {formatarDataExibicao(pendencia.data)} · {TURNO_LABEL[pendencia.turno] || pendencia.turno}
                    </span>
                  </span>
                  <Badge tom={pendencia.status === 'reaberto' ? 'danger' : 'warning'}>
                    {STATUS_LABEL[pendencia.status] || pendencia.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>

          {restantes > 0 && (
            <Link href="/producao/historico" className={styles.mais}>
              + {restantes} outras pendências
            </Link>
          )}
        </>
      )}
    </Card>
  );
}
