import { Children, cloneElement, isValidElement, useId } from 'react';
import { cx } from '../../lib/design/cx';
import styles from './Field.module.css';

// Rótulo + controle (+ dica/erro) com associação label/controle garantida:
// se o filho único (Input/Select/Textarea) não tiver id, ele recebe um id
// gerado, ligado ao <label htmlFor>.
export default function Field({ label, dica, erro, id, className, children }) {
  const idGerado = useId();
  const filho = Children.count(children) === 1 && isValidElement(children) ? children : null;
  const idControle = id || (filho && filho.props.id) || idGerado;
  const controle = filho && !filho.props.id ? cloneElement(filho, { id: idControle }) : children;

  return (
    <div className={cx(styles.campo, className)}>
      {label && (
        <label htmlFor={idControle} className={styles.rotulo}>
          {label}
        </label>
      )}
      {controle}
      {dica && <p className={styles.dica}>{dica}</p>}
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
