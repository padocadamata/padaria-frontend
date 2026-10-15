import { useRouter } from 'next/router';
import { useMemo } from 'react';
import IconButton from '../ui/IconButton';
import { useAuth } from '../../hooks/useAuth';
import { useFavoritos } from '../../hooks/useFavoritos';
import { telasNavegaveis } from '../../lib/nav/navegacao';
import { podeFavoritar, telaDaRota } from '../../lib/favoritos/favoritos';
import styles from './BotaoFavorito.module.css';

// Estrela de favorito no PageHeader: vazia = não favorito; preenchida =
// favorito. Só aparece em tela do catálogo de navegação que o usuário pode
// abrir, e só depois que os favoritos carregaram (sem "piscar" errado).
// Enquanto grava, o botão fica desabilitado (sem clique duplo).
export default function BotaoFavorito() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const { chaves, disponivel, carregando, gravando, alternar, erro } = useFavoritos();
  const telas = useMemo(() => telasNavegaveis(), []);
  const tela = telaDaRota(router?.pathname, telas);

  if (!tela || carregando || !disponivel || !podeFavoritar(tela, permissoes)) return null;

  const favorito = chaves.includes(tela.chave);
  const rotulo = favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
  return (
    <span className={styles.envolucro}>
      <IconButton
        icone={favorito ? 'starFilled' : 'star'}
        rotulo={rotulo}
        aria-pressed={favorito}
        tamanho="sm"
        className={favorito ? styles.ativo : styles.inativo}
        disabled={gravando.has(tela.chave)}
        onClick={() => alternar(tela.chave)}
      />
      {erro && (
        <span role="alert" className={styles.erro}>
          {erro}
        </span>
      )}
    </span>
  );
}
