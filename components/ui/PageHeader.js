import BotaoFavorito from '../shell/BotaoFavorito';
import styles from './PageHeader.module.css';

// Cabeçalho de conteúdo da página: o <h1> da tela (24px; 20px no mobile),
// subtítulo auxiliar opcional e uma área de ações à direita (empilha abaixo
// do título em telas estreitas). O contexto do módulo fica na topbar do
// shell; aqui vai o título da tela em si.
//
// Favoritos (migration 0075): em telas do catálogo de navegação, uma
// estrela discreta ao lado do título (BotaoFavorito decide sozinho, pela
// rota atual, se a tela é elegível -- nas demais não renderiza nada).
export default function PageHeader({ titulo, subtitulo, acoes }) {
  return (
    <header className={styles.cabecalho}>
      <div className={styles.textos}>
        <div className={styles.linhaTitulo}>
          <h1 className={styles.titulo}>{titulo}</h1>
          <BotaoFavorito />
        </div>
        {subtitulo && <p className={styles.subtitulo}>{subtitulo}</p>}
      </div>
      {acoes && <div className={styles.acoes}>{acoes}</div>}
    </header>
  );
}
