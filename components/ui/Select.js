import { forwardRef } from 'react';
import { cx } from '../../lib/design/cx';
import styles from './Select.module.css';

// <select> nativo com a aparência do Design System (mesma altura, borda e
// fonte do Input; >= 16px em mobile/touch). Mantém o comportamento nativo
// (teclado e seletor do sistema no celular).
const Select = forwardRef(function Select({ className, children, ...resto }, ref) {
  return (
    <select ref={ref} className={cx(styles.select, className)} {...resto}>
      {children}
    </select>
  );
});

export default Select;
