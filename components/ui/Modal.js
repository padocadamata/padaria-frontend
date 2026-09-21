import { useEffect, useId, useRef } from 'react';
import IconButton from './IconButton';
import { cx } from '../../lib/design/cx';
import styles from './Modal.module.css';

const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LARGURAS = { sm: '380px', md: '520px', lg: '720px', xl: '920px' };

// Contador de modais abertos: a rolagem do fundo só é liberada quando o
// último fecha.
let modaisAbertos = 0;
let overflowAnterior = '';
// Pilha de modais abertos (o último é o do topo): Esc e a prisão de foco valem
// só para o modal do topo -- uma confirmação aberta sobre outro modal fecha
// sozinha, sem fechar o de baixo junto.
const pilhaModais = [];

// Quadro padrão dos modais.
//
// Desktop: centralizado, largura por tamanho (sm/md/lg/xl), altura máxima da
// tela, rolagem INTERNA do conteúdo. Mobile (<= 768px): vira bottom sheet
// (largura total, cantos superiores arredondados, altura máxima 92% da tela,
// respeita a área segura do iPhone).
//
// Acessibilidade: role="dialog" + aria-modal; nome vem de `titulo` ou, no
// modal legado, do primeiro título (h1-h3) do conteúdo; foco inicial no
// primeiro campo (respeita autoFocus já aplicado), Tab preso dentro do
// modal, Esc chama onFechar e o foco volta ao elemento que abriu o modal.
//
// Não fecha ao clicar no fundo por padrão (evita perder um formulário
// preenchido por engano); habilite com fecharAoClicarFora. Formulários longos
// podem desligar o Esc com fecharComEsc={false} pelo mesmo motivo.
//
// legado: aplica uma camada de compatibilidade (só dentro deste quadro) que
// normaliza fonte, altura e raio dos campos/botões dos modais que ainda têm
// o corpo em estilo inline antigo -- nenhum handler ou validação é tocado.
export default function Modal({
  titulo,
  onFechar,
  largura = 'md',
  fecharAoClicarFora = false,
  fecharComEsc = true,
  legado = false,
  rotulo,
  children,
}) {
  const caixaRef = useRef(null);
  const idTitulo = useId();
  const onFecharRef = useRef(onFechar);
  onFecharRef.current = onFechar;
  const escRef = useRef(fecharComEsc);
  escRef.current = fecharComEsc;

  useEffect(() => {
    const caixa = caixaRef.current;
    const anterior = document.activeElement;

    if (modaisAbertos === 0) {
      overflowAnterior = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    modaisAbertos += 1;
    const meuToken = {};
    pilhaModais.push(meuToken);

    // Nome acessível do modal legado: primeiro título do conteúdo.
    if (!titulo && !rotulo && caixa) {
      const cabecalho = caixa.querySelector('h1, h2, h3');
      if (cabecalho) {
        if (!cabecalho.id) cabecalho.id = idTitulo;
        caixa.setAttribute('aria-labelledby', cabecalho.id);
      }
    }

    // Foco inicial (autoFocus do conteúdo já vale).
    if (caixa && !caixa.contains(document.activeElement)) {
      const primeiro = caixa.querySelector(SELETOR_FOCAVEL);
      // preventScroll: um modal longo cujo 1º controle está no fim (ex.: só "Fechar")
      // continua aberto no topo, com o título visível.
      (primeiro || caixa).focus({ preventScroll: true });
      caixa.scrollTop = 0;
    }

    function aoTeclar(evento) {
      if (pilhaModais[pilhaModais.length - 1] !== meuToken) return;
      if (evento.key === 'Escape') {
        evento.stopPropagation();
        if (escRef.current && onFecharRef.current) onFecharRef.current();
        return;
      }
      if (evento.key !== 'Tab' || !caixa) return;

      const focaveis = [...caixa.querySelectorAll(SELETOR_FOCAVEL)];
      if (focaveis.length === 0) {
        evento.preventDefault();
        return;
      }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && (document.activeElement === primeiro || document.activeElement === caixa)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      modaisAbertos -= 1;
      const posicao = pilhaModais.indexOf(meuToken);
      if (posicao >= 0) pilhaModais.splice(posicao, 1);
      if (modaisAbertos === 0) document.body.style.overflow = overflowAnterior;
      if (anterior && typeof anterior.focus === 'function' && document.contains(anterior)) anterior.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(evento) => {
        if (fecharAoClicarFora && evento.target === evento.currentTarget && onFechar) onFechar();
      }}
    >
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo ? idTitulo : undefined}
        aria-label={!titulo ? rotulo : undefined}
        tabIndex={-1}
        className={cx(styles.caixa, legado && styles.legado)}
        style={{ '--largura-modal': LARGURAS[largura] || largura }}
      >
        {titulo && (
          <div className={styles.cabecalho}>
            <h2 id={idTitulo} className={styles.titulo}>
              {titulo}
            </h2>
            {onFechar && <IconButton icone="close" rotulo="Fechar" onClick={onFechar} tamanho="sm" />}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
