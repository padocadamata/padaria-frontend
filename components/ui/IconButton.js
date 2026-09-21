import Icon from './Icon';
import { cx } from '../../lib/design/cx';
import styles from './IconButton.module.css';

// Botão só com ícone. `rotulo` é OBRIGATÓRIO: vira aria-label (e title, a
// dica ao passar o mouse) -- um botão sem texto visível precisa de nome
// acessível. Tons: neutral | danger | success | inverso (para fundo escuro).
export default function IconButton({
  icone,
  rotulo,
  tom = 'neutral',
  tamanho = 'md',
  type = 'button',
  className,
  ...resto
}) {
  return (
    <button
      type={type}
      aria-label={rotulo}
      title={rotulo}
      className={cx(styles.botao, styles[tom], tamanho === 'sm' && styles.sm, className)}
      {...resto}
    >
      <Icon nome={icone} tamanho={tamanho === 'sm' ? 18 : 20} />
    </button>
  );
}
