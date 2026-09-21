import Link from 'next/link';
import Icon from './Icon';
import { cx } from '../../lib/design/cx';
import styles from './Button.module.css';

// Botão do Design System. Variantes: primary | secondary | danger | ghost.
// Tamanhos: md (padrão) | sm. Com `href` renderiza um link (<a>) com a
// mesma aparência -- navegação é link, ação é botão.
//
// `icone` fica à esquerda do texto; `iconeDireita` à direita (ex.: seta).
// Uso: <Button variante="primary" icone="plus" onClick={...}>Adicionar</Button>
//      <Button href="/producao" variante="secondary">Abrir Produção</Button>
export default function Button({
  variante = 'primary',
  tamanho = 'md',
  icone,
  iconeDireita,
  href,
  type = 'button',
  block = false,
  className,
  children,
  ...resto
}) {
  const classes = cx(
    styles.botao,
    styles[variante],
    tamanho === 'sm' && styles.sm,
    block && styles.block,
    className
  );

  const conteudo = (
    <>
      {icone && <Icon nome={icone} tamanho={18} />}
      {children}
      {iconeDireita && <Icon nome={iconeDireita} tamanho={18} />}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} {...resto}>
        {conteudo}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} {...resto}>
      {conteudo}
    </button>
  );
}
