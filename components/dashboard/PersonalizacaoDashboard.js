import Alert from '../ui/Alert';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { cx } from '../../lib/design/cx';
import { ROTULO_TAMANHO, WIDGETS_DASHBOARD, definirTamanho, ehLayoutPadrao, moverWidget } from '../../lib/dashboard/layout';
import styles from './dashboard.module.css';

const CLASSE_TAMANHO = { P: styles.tamanhoP, M: styles.tamanhoM, G: styles.tamanhoG };
const catalogo = new Map(WIDGETS_DASHBOARD.map((w) => [w.id, w]));

// Grade com a ordem/tamanho do usuário. Tamanho é relativo à LARGURA REAL
// da área (container query em dashboard.module.css), não à tela: P = 1/3,
// M = 1/2 e G = largura toda quando cabe; em área estreita, P e M dividem a
// linha; no celular, tudo empilha.
export function GradePersonalizada({ layout, visiveis, widgets, renderizarItem }) {
  const itens = layout.filter((w) => visiveis.has(w.id));
  return (
    <div className={styles.gradePersonalizadaArea}>
      <div className={styles.gradePersonalizada}>
        {itens.map((w, indice) => (
          <div key={w.id} className={cx(styles.celulaWidget, CLASSE_TAMANHO[w.tamanho])}>
            {renderizarItem ? renderizarItem(w, indice, itens.length) : widgets[w.id]}
          </div>
        ))}
      </div>
    </div>
  );
}

// Modo "Personalizar": a mesma grade, com uma barra de controles por widget
// (subir/descer e P/M/G conforme o que o widget permite). Nada é gravado até
// "Salvar"; "Cancelar" descarta; "Restaurar padrão" volta à ordem e aos
// tamanhos padrão (ao salvar, a preferência é apagada).
export default function PersonalizacaoDashboard({ rascunho, visiveis, widgets, salvando, erro, onAlterar, onRestaurarPadrao, onCancelar, onSalvar }) {
  const padrao = ehLayoutPadrao(rascunho);
  return (
    <section aria-label="Personalizar Dashboard">
      <div className={styles.barraPersonalizacao}>
        <p className={styles.avisoPersonalizacao}>
          <strong>Personalizando o Dashboard.</strong> Use as setas para mudar a ordem e P, M ou G para o tamanho. Nada muda até você salvar.
        </p>
        <div className={styles.acoesPersonalizacao}>
          <Button variante="ghost" tamanho="sm" onClick={onRestaurarPadrao} disabled={salvando || padrao}>
            Restaurar padrão
          </Button>
          <Button variante="secondary" tamanho="sm" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button tamanho="sm" onClick={onSalvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
      {erro && (
        <Alert tom="danger" className={styles.erroPersonalizacao}>
          {erro}
        </Alert>
      )}

      <GradePersonalizada
        layout={rascunho}
        visiveis={visiveis}
        widgets={widgets}
        renderizarItem={(w, indice, total) => {
          const def = catalogo.get(w.id);
          return (
            <div className={styles.widgetEmEdicao}>
              <div className={styles.controlesWidget}>
                <span className={styles.nomeWidget}>{def.titulo}</span>
                <span className={styles.botoesWidget}>
                  <IconButton
                    icone="arrowUp"
                    tamanho="sm"
                    rotulo={`Mover ${def.titulo} para cima`}
                    disabled={salvando || indice === 0}
                    onClick={() => onAlterar(moverWidget(rascunho, w.id, -1, visiveis))}
                  />
                  <IconButton
                    icone="arrowDown"
                    tamanho="sm"
                    rotulo={`Mover ${def.titulo} para baixo`}
                    disabled={salvando || indice === total - 1}
                    onClick={() => onAlterar(moverWidget(rascunho, w.id, 1, visiveis))}
                  />
                  {def.tamanhos.length > 1 && (
                    <span className={styles.tamanhos} role="group" aria-label={`Tamanho de ${def.titulo}`}>
                      {def.tamanhos.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={cx(styles.botaoTamanho, w.tamanho === t && styles.botaoTamanhoAtivo)}
                          aria-pressed={w.tamanho === t}
                          aria-label={`${ROTULO_TAMANHO[t]}`}
                          title={ROTULO_TAMANHO[t]}
                          disabled={salvando}
                          onClick={() => onAlterar(definirTamanho(rascunho, w.id, t))}
                        >
                          {t}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </div>
              {widgets[w.id]}
            </div>
          );
        }}
      />
    </section>
  );
}
