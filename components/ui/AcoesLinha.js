import { useState } from 'react';
import Button from './Button';
import IconButton from './IconButton';
import Icon from './Icon';
import Modal from './Modal';
import { cx } from '../../lib/design/cx';
import styles from './AcoesLinha.module.css';

// Ações de uma linha/cartão a partir de UMA lista de descritores:
//   { chave, rotulo, icone, onClick, destrutivo, desabilitado, primaria }
// Cada `onClick` é exatamente o handler que a página já usava.
//
// Desktop (cartao=false): fileira de botões só com ícone (rótulo em
// aria-label/tooltip), como antes.
// Mobile (cartao=true): com até 2 ações, botões com texto; com mais, a ação
// principal (marcada `primaria`, ou a primeira) fica visível com texto e o
// resto vai para "Mais ações" -- uma folha (bottom sheet) com itens
// nomeados, em vez de vários botões minúsculos lado a lado.
// menuUnico (só no modo cartão): todas as ações vão para "Mais ações", sem botão
// principal visível -- usado quando as ações de uso frequente já aparecem
// como botões próprios ao lado.
export default function AcoesLinha({ acoes, cartao = false, menuUnico = false }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const lista = (acoes || []).filter(Boolean);
  if (lista.length === 0) return null;

  if (!cartao) {
    return (
      <div className={styles.icones}>
        {lista.map((a) => (
          <IconButton
            key={a.chave}
            icone={a.icone}
            rotulo={a.rotulo}
            tom={a.destrutivo ? 'danger' : 'neutral'}
            tamanho="sm"
            disabled={a.desabilitado}
            onClick={a.onClick}
          />
        ))}
      </div>
    );
  }

  const botao = (a, variante) => (
    <Button
      key={a.chave}
      tamanho="sm"
      variante={a.destrutivo ? 'danger' : variante}
      icone={a.icone}
      disabled={a.desabilitado}
      onClick={a.onClick}
    >
      {a.rotulo}
    </Button>
  );

  if (lista.length <= 2 && !menuUnico) {
    return <div className={styles.cartao}>{lista.map((a) => botao(a, a.primaria ? 'primary' : 'secondary'))}</div>;
  }

  const principal = menuUnico ? null : lista.find((a) => a.primaria) || lista.find((a) => !a.destrutivo) || lista[0];
  const demais = lista.filter((a) => a !== principal);

  return (
    <div className={styles.cartao}>
      {principal && botao(principal, 'primary')}
      <Button
        tamanho="sm"
        variante="secondary"
        icone="more"
        aria-haspopup="dialog"
        aria-expanded={menuAberto}
        onClick={() => setMenuAberto(true)}
      >
        Mais ações
      </Button>

      {menuAberto && (
        <Modal titulo="Ações" largura="sm" onFechar={() => setMenuAberto(false)} fecharAoClicarFora>
          <ul className={styles.menu}>
            {demais.map((a) => (
              <li key={a.chave}>
                <button
                  type="button"
                  className={cx(styles.item, a.destrutivo && styles.itemDestrutivo)}
                  disabled={a.desabilitado}
                  onClick={() => {
                    setMenuAberto(false);
                    a.onClick();
                  }}
                >
                  <Icon nome={a.icone} tamanho={20} />
                  {a.rotulo}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
