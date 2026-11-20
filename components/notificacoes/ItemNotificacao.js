import Link from 'next/link';
import Badge from '../ui/Badge';
import Icon from '../ui/Icon';
import { cx } from '../../lib/design/cx';
import {
  dataHoraNotificacao,
  iconeDaNotificacao,
  linkDaNotificacao,
  rotuloDoTipo,
  situacaoDaPendencia,
  textoResolucao,
} from '../../lib/notificacoes/tipos';
import styles from './notificacoes.module.css';

// Uma notificação (painel do sino e página /notificacoes). Texto sempre como
// texto (o React escapa); o link vem só do catálogo de tipos do frontend.
//
// onAbrir(n): chamado ao seguir o link (marca como lida e fecha o painel).
// onMarcarLida(n): botão "Marcar como lida" (só para não lidas).
export default function ItemNotificacao({ notificacao: n, onAbrir, onMarcarLida, compacto = false }) {
  const link = linkDaNotificacao(n);
  const naoLida = !n.lida_em;
  const pendencia = situacaoDaPendencia(n.pendencia_status);
  const resolucao = textoResolucao(n);
  const quando = dataHoraNotificacao(n.criado_em);

  return (
    <li className={cx(styles.item, naoLida && styles.itemNaoLida, compacto && styles.itemCompacto)}>
      <span className={styles.itemIcone} aria-hidden="true">
        <Icon nome={iconeDaNotificacao(n)} tamanho={18} />
      </span>

      <div className={styles.itemCorpo}>
        <div className={styles.itemTopo}>
          {link ? (
            <Link href={link} className={styles.itemTitulo} onClick={() => onAbrir?.(n)}>
              {n.titulo}
            </Link>
          ) : (
            <span className={styles.itemTitulo}>{n.titulo}</span>
          )}
          {naoLida && (
            <span className={styles.pontoNaoLida} title="Não lida">
              <span className={styles.somenteLeitor}>Não lida</span>
            </span>
          )}
        </div>

        {n.descricao && <p className={styles.itemDescricao}>{n.descricao}</p>}

        <div className={styles.itemMeta}>
          <time dateTime={n.criado_em}>{quando}</time>
          {!compacto && <span className={styles.itemTipo}>{rotuloDoTipo(n)}</span>}
          {pendencia && <Badge tom={pendencia.tom}>{pendencia.texto}</Badge>}
        </div>

        {resolucao && <p className={styles.itemResolucao}>{resolucao}</p>}

        {(link || naoLida) && (
          <div className={styles.itemAcoes}>
            {link && (
              <Link href={link} className={styles.acaoLink} onClick={() => onAbrir?.(n)}>
                Abrir registro
                <Icon nome="chevronRight" tamanho={16} />
              </Link>
            )}
            {naoLida && onMarcarLida && (
              <button type="button" className={styles.acaoBotao} onClick={() => onMarcarLida(n)}>
                <Icon nome="check" tamanho={16} />
                Marcar como lida
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
