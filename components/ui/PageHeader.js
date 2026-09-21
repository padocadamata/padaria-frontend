import styles from './PageHeader.module.css';

// Cabeçalho de conteúdo da página: o <h1> da tela (24px; 20px no mobile),
// subtítulo auxiliar opcional e uma área de ações à direita (empilha abaixo
// do título em telas estreitas). O contexto do módulo fica na topbar do
// shell; aqui vai o título da tela em si.
export default function PageHeader({ titulo, subtitulo, acoes }) {
  return (
    <header className={styles.cabecalho}>
      <div className={styles.textos}>
        <h1 className={styles.titulo}>{titulo}</h1>
        {subtitulo && <p className={styles.subtitulo}>{subtitulo}</p>}
      </div>
      {acoes && <div className={styles.acoes}>{acoes}</div>}
    </header>
  );
}
