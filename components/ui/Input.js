import { forwardRef } from 'react';
import { cx } from '../../lib/design/cx';
import styles from './Input.module.css';

// Campo de texto do Design System (versão mínima, só o necessário para o
// Dashboard). Fonte >= 16px em mobile/touch (evita o zoom automático do
// iOS), altura de toque 44px. Para associar um label visível use id +
// <label htmlFor>; sem label visível, passe aria-label.
const Input = forwardRef(function Input({ className, ...resto }, ref) {
  return <input ref={ref} className={cx(styles.input, className)} {...resto} />;
});

export default Input;
