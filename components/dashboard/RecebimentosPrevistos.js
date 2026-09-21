import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { cx } from '../../lib/design/cx';
import styles from './dashboard.module.css';

const LIMITE_VISIVEL = 5;

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
export default function RecebimentosPrevistos() {
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

  const visiveis = itens.slice(0, LIMITE_VISIVEL);
  const restantes = itens.length - visiveis.length;

  return (
    <Card titulo="Recebimentos previstos" subtitulo="Pedidos reais aguardando entrega" icone="package">
      {erro ? (
        <p className={styles.erro}>{erro}</p>
      ) : carregando ? (
        <p className={styles.vazio}>Carregando...</p>
      ) : itens.length === 0 ? (
        <p className={styles.vazio}>Nenhum recebimento previsto para hoje nem atrasado.</p>
      ) : (
        <>
          <ul className={styles.lista}>
            {visiveis.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/pedidos?id=${item.id}`}
                  className={cx(styles.item, styles.itemLink, item.atrasado ? styles.itemErro : styles.itemAviso)}
                >
                  <span className={styles.itemTextos}>
                    <span className={styles.itemTitulo}>{item.fornecedorNome}</span>
                    <span className={styles.itemMeta}>previsão {formatarDataExibicao(item.previsaoEntrega)}</span>
                  </span>
                  <Badge tom={item.atrasado ? 'danger' : 'warning'}>
                    {item.atrasado ? 'Entrega atrasada' : 'Recebimento previsto hoje'}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>

          {restantes > 0 && (
            <Link href="/pedidos" className={styles.mais}>
              + {restantes} outros pedidos
            </Link>
          )}
        </>
      )}
    </Card>
  );
}
