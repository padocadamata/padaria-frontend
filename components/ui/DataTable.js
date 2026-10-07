import { Fragment, useEffect, useRef } from 'react';
import { cx } from '../../lib/design/cx';
import { useMediaQuery } from '../../lib/design/useMediaQuery';
import styles from './DataTable.module.css';

// Tabela responsiva: UMA definição de colunas alimenta a tabela (desktop) e
// a lista de cartões (mobile) -- as mesmas funções `render`, os mesmos
// handlers; nenhuma regra é escrita duas vezes. Só uma das duas
// representações existe no DOM por vez (a troca é feita por media query em
// JS), então campos editáveis nunca ficam duplicados.
//
// colunas: [{
//   chave,             // identificador (e campo padrão de leitura)
//   rotulo,            // cabeçalho / rótulo no cartão
//   render(linha),     // opcional; padrão: linha[chave]
//   alinhar,           // 'direita' (números) | 'centro'
//   mobile,            // 'titulo' (cabeçalho do cartão) | 'meta' (padrão, par rótulo/valor) | 'oculta'
//   semQuebra,         // impede quebra de linha na tabela
//   cartaoOrdem,       // ordem entre as colunas 'titulo' do cartão (padrão: ordem das colunas)
//   minLargura,        // largura mínima (px) da coluna na tabela (evita colunas espremidas)
//   soCartao,          // true: a coluna aparece só nos cartões (mobile), não na tabela (desktop)
// }]
// renderAcoes(linha, { cartao }): conteúdo da coluna "Ações" / rodapé do cartão.
// linhaExtra(linha): nó exibido logo abaixo da linha (ex.: mensagem de erro da linha).
// destaque(linha): 'aviso' para realçar linhas que pedem atenção.
// destaque também aceita 'inativo' (linha esmaecida, ex.: dia fechado).
// grupo: { chave(linha), rotulo(linha) } separa visualmente blocos de linhas
//   consecutivas com a mesma chave (ex.: por data): na tabela a 1ª linha do
//   bloco ganha uma divisória mais forte; nos cartões, um título de bloco.
//   Não adiciona linhas à <tbody>.
// denso: tabela com menos respiro lateral (telas com muitas colunas).
// cartoesAte: largura (px) até a qual a tela usa cartões (padrão 768).
// selecao (opcional): seleção múltipla por CHAVE da linha (nunca índice) --
//   { selecionados: Set<chave>, podeSelecionar(linha), onAlternar(linha),
//     rotuloLinha(linha), estadoTodos: 'nenhum'|'parcial'|'todos',
//     onAlternarTodos(), desabilitado, semSelecionaveis }.
//   Tabela: 1ª coluna com checkbox (cabeçalho = selecionar todos os itens
//   VISÍVEIS, com estado indeterminado). Cartões: checkbox no topo do
//   cartão. Só a caixa seleciona -- clicar na linha/ações não muda nada.
export default function DataTable({
  colunas,
  linhas,
  chaveLinha,
  renderAcoes,
  tituloAcoes = 'Ações',
  linhaExtra,
  destaque,
  grupo,
  cartoesAte = 768,
  denso = false,
  rotulo,
  className,
  selecao,
}) {
  // Colunas exibidas na TABELA (as marcadas soCartao ficam só nos cartões).
  const colunasTabela = colunas.filter((c) => !c.soCartao);
  const modoCartoes = useMediaQuery(`(max-width: ${cartoesAte}px)`);

  if (modoCartoes) {
    // Ordem no topo do cartão: `cartaoOrdem` (quando informada) ou a ordem das colunas.
    const titulo = colunas
      .map((c, i) => ({ c, o: c.cartaoOrdem ?? 100 + i }))
      .filter(({ c }) => c.mobile === 'titulo')
      .sort((a, b) => a.o - b.o)
      .map(({ c }) => c);
    const meta = colunas.filter((c) => c.mobile !== 'titulo' && c.mobile !== 'oculta');

    return (
      <ul className={cx(styles.cartoes, className)} aria-label={rotulo}>
        {linhas.map((linha, indice) => {
          const marca = destaque ? destaque(linha) : null;
          const extra = linhaExtra ? linhaExtra(linha) : null;
          const novoGrupo = grupo && (indice === 0 || grupo.chave(linhas[indice - 1]) !== grupo.chave(linha));
          return (
            <Fragment key={chaveLinha(linha)}>
            {novoGrupo && (
              <li className={styles.grupoTitulo}>
                {grupo.rotulo(linha)}
              </li>
            )}
            <li
              className={cx(
                styles.cartao,
                marca === 'aviso' && styles.cartaoAviso,
                marca === 'inativo' && styles.cartaoInativo,
                selecao?.selecionados.has(chaveLinha(linha)) && styles.cartaoSelecionado
              )}
            >
              {selecao && titulo.length === 0 && <CaixaSelecaoLinha selecao={selecao} linha={linha} chave={chaveLinha(linha)} className={styles.selecaoCartao} />}
              {titulo.length > 0 && (
                <div className={styles.cartaoTopo}>
                  {selecao && <CaixaSelecaoLinha selecao={selecao} linha={linha} chave={chaveLinha(linha)} className={styles.selecaoCartao} />}
                  {titulo.map((c, i) => (
                    <div key={c.chave} className={i === 0 ? styles.cartaoTitulo : styles.cartaoSub}>
                      {c.render ? c.render(linha) : linha[c.chave]}
                    </div>
                  ))}
                </div>
              )}
              {meta.length > 0 && (
                <dl className={styles.meta}>
                  {meta.map((c) => (
                    <div key={c.chave} className={styles.metaItem}>
                      <dt>{c.rotulo}</dt>
                      <dd>{c.render ? c.render(linha) : linha[c.chave]}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {extra}
              {renderAcoes && <div className={styles.cartaoAcoes}>{renderAcoes(linha, { cartao: true })}</div>}
            </li>
            </Fragment>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={cx(styles.envolucro, className)}>
      <table className={cx(styles.tabela, denso && styles.densa)} aria-label={rotulo}>
        <thead>
          <tr>
            {selecao && (
              <th className={styles.colSelecao}>
                <CaixaSelecao
                  checked={selecao.estadoTodos === 'todos'}
                  indeterminado={selecao.estadoTodos === 'parcial'}
                  disabled={selecao.desabilitado || selecao.semSelecionaveis}
                  rotulo="Selecionar todas as linhas visíveis"
                  onChange={selecao.onAlternarTodos}
                />
              </th>
            )}
            {colunasTabela.map((c) => (
              <th
                key={c.chave}
                className={cx(c.alinhar === 'direita' && styles.dir, c.alinhar === 'centro' && styles.centro)}
                style={c.minLargura ? { minWidth: c.minLargura } : undefined}
              >
                {c.rotulo}
              </th>
            ))}
            {renderAcoes && <th>{tituloAcoes}</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, indice) => {
            const marca = destaque ? destaque(linha) : null;
            const extra = linhaExtra ? linhaExtra(linha) : null;
            const novoGrupo = grupo && indice > 0 && grupo.chave(linhas[indice - 1]) !== grupo.chave(linha);
            return (
              <Fragment key={chaveLinha(linha)}>
              <tr
                className={cx(
                  marca === 'aviso' && styles.linhaAviso,
                  marca === 'inativo' && styles.linhaInativa,
                  novoGrupo && styles.inicioGrupo,
                  selecao?.selecionados.has(chaveLinha(linha)) && styles.linhaSelecionada
                )}
              >
                {selecao && (
                  <td className={styles.colSelecao}>
                    <CaixaSelecaoLinha selecao={selecao} linha={linha} chave={chaveLinha(linha)} />
                  </td>
                )}
                {colunasTabela.map((c) => (
                  <td
                    key={c.chave}
                    className={cx(c.alinhar === 'direita' && styles.dir, c.alinhar === 'centro' && styles.centro, c.semQuebra && styles.semQuebra)}
                  >
                    {c.render ? c.render(linha) : linha[c.chave]}
                  </td>
                ))}
                {renderAcoes && <td className={styles.celulaAcoes}>{renderAcoes(linha, { cartao: false })}</td>}
              </tr>
              {extra && (
                <tr className={styles.linhaExtra}>
                  <td colSpan={colunasTabela.length + (renderAcoes ? 1 : 0) + (selecao ? 1 : 0)}>{extra}</td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Checkbox nativo com o visual do Design System (Checkbox.module.css usa o
// mesmo accent-color) e área de toque >= 44px. `indeterminate` é
// propriedade DOM (não existe como atributo JSX) -- setada via ref, mesmo
// padrão de components/admin/MatrizPermissoes.js.
function CaixaSelecao({ checked, indeterminado = false, disabled, rotulo, onChange, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminado;
  }, [indeterminado]);
  return (
    <label className={cx(styles.caixaSelecao, disabled && styles.caixaSelecaoDesabilitada, className)} title={rotulo}>
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={rotulo} aria-checked={indeterminado ? 'mixed' : checked} />
    </label>
  );
}

function CaixaSelecaoLinha({ selecao, linha, chave, className }) {
  const pode = selecao.podeSelecionar(linha);
  return (
    <CaixaSelecao
      className={className}
      checked={pode && selecao.selecionados.has(chave)}
      disabled={!pode || selecao.desabilitado}
      rotulo={pode ? `Selecionar ${selecao.rotuloLinha(linha)}` : `${selecao.rotuloLinha(linha)}: sem ações em lote disponíveis`}
      onChange={() => selecao.onAlternar(linha)}
    />
  );
}
