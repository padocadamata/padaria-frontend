import { forwardRef } from 'react';
import { cx } from '../../lib/design/cx';
import styles from './Textarea.module.css';

const Textarea = forwardRef(function Textarea({ className, ...resto }, ref) {
  return <textarea ref={ref} className={cx(styles.textarea, className)} {...resto} />;
});

export default Textarea;
