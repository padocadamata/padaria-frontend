import { useId, useState } from 'react';
import Button from './Button';
import Badge from './Badge';
import Icon from './Icon';
import { cx } from '../../lib/design/cx';
import { MQ_MOBILE } from '../../lib/design/breakpoints';
import { useMediaQuery } from '../../lib/design/useMediaQuery';
import styles from './FilterBar.module.css';

// Barra de filtros padrão. Só apresentação: os campos (Field + Input/Select)
// e a lógica de cada filtro continuam sendo da página.
//
// Desktop: campos sempre visíveis, alinhados numa grade, com "Limpar
// filtros" discreto ao final (desabilitado sem filtro ativo).
// Mobile (<= 768px): a área começa RECOLHIDA para ocupar pouco espaço; o
// botão "Filtros" abre/fecha e mostra quantos filtros estão ativos (mais um
// atalho "Limpar" quando há algum ativo).
//
// `ativos` = quantidade de filtros diferentes do padrão (número).
export default function FilterBar({ ativos = 0, onLimpar, rotuloLimpar = 'Limpar filtros', children }) {
  const mobile = useMediaQuery(MQ_MOBILE);
  const [aberto, setAberto] = useState(false);
  const idConteudo = useId();

  const limpar = (
    <Button variante="ghost" tamanho="sm" onClick={onLimpar} disabled={!ativos}>
      {rotuloLimpar}
    </Button>
  );

  if (!mobile) {
    return (
      <section className={styles.barra} aria-label="Filtros">
        <div className={styles.grade}>{children}</div>
        <div className={styles.rodape}>{limpar}</div>
      </section>
    );
  }

  return (
    <section className={styles.barra} aria-label="Filtros">
      <div className={styles.topoMobile}>
        <button
          type="button"
          className={styles.alternar}
          aria-expanded={aberto}
          aria-controls={idConteudo}
          onClick={() => setAberto((valor) => !valor)}
        >
          <Icon nome="filter" tamanho={18} />
          Filtros
          {ativos > 0 && <Badge tom="primary">{ativos} {ativos === 1 ? 'ativo' : 'ativos'}</Badge>}
          <span className={cx(styles.seta, aberto && styles.setaAberta)}>
            <Icon nome="chevronDown" tamanho={18} />
          </span>
        </button>
        {ativos > 0 && (
          <Button variante="ghost" tamanho="sm" onClick={onLimpar}>
            Limpar
          </Button>
        )}
      </div>

      {aberto && (
        <div id={idConteudo} className={styles.conteudoMobile}>
          <div className={styles.grade}>{children}</div>
          <div className={styles.rodape}>{limpar}</div>
        </div>
      )}
    </section>
  );
}
