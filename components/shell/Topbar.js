import IconButton from '../ui/IconButton';
import UserMenu from './UserMenu';
import SinoNotificacoes from './SinoNotificacoes';
import styles from './shell.module.css';

// Topbar desktop: botão de recolher/expandir a sidebar, contexto (nome do
// módulo/tela), o sino da Central de Notificações (migration 0080) e o menu
// do usuário. Sem busca.
export default function Topbar({ titulo, compacta, onAlternarSidebar, usuario, perfil, onSair }) {
  return (
    <header className={styles.topbar}>
      <IconButton
        icone="panelLeft"
        rotulo={compacta ? 'Expandir menu lateral' : 'Recolher menu lateral'}
        aria-expanded={!compacta}
        aria-controls="menu-lateral"
        onClick={onAlternarSidebar}
      />
      <span className={styles.contexto}>{titulo}</span>
      <span className={styles.espaco} />
      <SinoNotificacoes variante="topbar" />
      <UserMenu usuario={usuario} perfil={perfil} onSair={onSair} />
    </header>
  );
}
