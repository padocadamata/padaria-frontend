import { Fragment } from 'react';
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
}) {
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
            <li className={cx(styles.cartao, marca === 'aviso' && styles.cartaoAviso, marca === 'inativo' && styles.cartaoInativo)}>
              {titulo.length > 0 && (
                <div className={styles.cartaoTopo}>
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
            {colunas.map((c) => (
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
              <tr className={cx(marca === 'aviso' && styles.linhaAviso, marca === 'inativo' && styles.linhaInativa, novoGrupo && styles.inicioGrupo)}>
                {colunas.map((c) => (
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
                  <td colSpan={colunas.length + (renderAcoes ? 1 : 0)}>{extra}</td>
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
