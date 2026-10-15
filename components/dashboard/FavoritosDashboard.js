import { useMemo } from 'react';
import Link from 'next/link';
import Icon from '../ui/Icon';
import SectionHeader from '../ui/SectionHeader';
import { useAuth } from '../../hooks/useAuth';
import { useFavoritos } from '../../hooks/useFavoritos';
import { telasNavegaveis } from '../../lib/nav/navegacao';
import { favoritosVisiveis } from '../../lib/favoritos/favoritos';
import styles from './dashboard.module.css';

// Seção "Favoritos" no topo do Dashboard (migration 0075): atalhos compactos
// para as telas que o usuário marcou com a estrela, com o nome e o ícone
// ATUAIS da tela. Só aparecem as que ele ainda pode abrir. Sem favoritos,
// uma linha discreta explica como criar -- sem ocupar espaço de card.
export default function FavoritosDashboard() {
  const { permissoes } = useAuth();
  const { chaves, disponivel, carregando } = useFavoritos();
  const telas = useMemo(() => telasNavegaveis(), []);
  if (!disponivel || carregando) return null;

  const favoritos = favoritosVisiveis(chaves, permissoes, telas);
  return (
    <section className={styles.secaoFavoritos} aria-labelledby="favoritos-titulo">
      <SectionHeader id="favoritos-titulo" titulo="Favoritos" />
      {favoritos.length === 0 ? (
        <p className={styles.favoritosVazio}>
          <Icon nome="star" tamanho={16} />
          Toque na estrela ao lado do título de uma tela para fixá-la aqui.
        </p>
      ) : (
        <ul className={styles.favoritos}>
          {favoritos.map((tela) => (
            <li key={tela.chave}>
              <Link href={tela.rota} className={styles.favorito}>
                <span className={styles.favoritoIcone}>
                  <Icon nome={tela.icone} tamanho={18} />
                </span>
                <span className={styles.favoritoRotulo}>{tela.rotulo}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
