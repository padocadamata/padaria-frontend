import { memo } from 'react';
import { cx } from '../../lib/design/cx';
import { abrevDiaSemana, dataCurta, ehFimDeSemana, nomeExecucao, rotuloCelula, rotuloResponsavel } from '../../lib/tarefas/calendario';
import { descreverRegra, frequenciaCurta } from '../../lib/tarefas/regras';
import estilos from './tarefas.module.css';

// Matriz mensal de Tarefas (0061/0062): LINHAS = tarefas por categoria
// (menos frequente -> diárias -> sem programação), COLUNAS = todos os dias
// reais do mês (inclui 31). Primeira coluna e cabeçalho fixos; rolagem
// horizontal interna. Só EXIBE ocorrências já materializadas.
//
// Célula: checkbox (execução) + posição/nome da PROGRAMAÇÃO. Estado nunca
// depende só de cor: concluída = riscado + ✓; 2 execuções = "×2";
// cancelada = "✕"; ajustada = ponto no canto; avulsa = contorno tracejado.
// Grupos de distribuição (blocos) são internos do motor e não aparecem.

function tituloOcorrencia(tarefa, data, o, execucoes) {
  const linhas = [`${tarefa.descricao}`, `${dataCurta(data)} — programada para F${o.posicao}${o.responsavel_nome || o.responsavel_avulso ? ` (${rotuloResponsavel(o)})` : ''}`];
  if (o.ajustado_em && o.posicao !== o.posicao_programada) linhas.push(`Ajustada (originalmente F${o.posicao_programada})`);
  else if (o.ajustado_em) linhas.push('Ajustada manualmente');
  if (o.origem === 'avulsa') linhas.push('Ocorrência avulsa');
  if (o.cancelada) linhas.push(`Cancelada: ${o.cancelado_motivo}`);
  else if (execucoes.length > 0) linhas.push(`Executada por: ${execucoes.map(nomeExecucao).join(', ')}`);
  else linhas.push('Pendente');
  return linhas.join('\n');
}

const SEM_EXECUCOES = [];

const Celula = memo(function Celula({ tarefa, data, ocorrencia, execucoes, ehHoje, podeConcluir, podeEditar, onAlternar, onAbrir, onNovaAvulsa, ocupada }) {
  const classesTd = cx(estilos.celula, ehFimDeSemana(data) && estilos.fimDeSemana, ehHoje && estilos.hoje);

  if (!ocorrencia) {
    // "ocupada" = existe ocorrência escondida pelo filtro: não oferecer "+".
    if (!podeEditar || ocupada) return <td className={classesTd} />;
    return (
      <td className={classesTd}>
        <button
          type="button"
          className={estilos.celulaVazia}
          onClick={() => onNovaAvulsa(tarefa, data)}
          aria-label={`Adicionar ocorrência avulsa de ${tarefa.descricao} em ${dataCurta(data)}`}
          title="Adicionar ocorrência avulsa"
        >
          +
        </button>
      </td>
    );
  }

  const o = ocorrencia;
  const titulo = tituloOcorrencia(tarefa, data, o, execucoes);

  return (
    <td className={cx(classesTd, o.concluida && estilos.concluida, o.cancelada && estilos.cancelada, o.origem === 'avulsa' && estilos.avulsa)}>
      <div className={estilos.ocorrencia} title={titulo}>
        {o.cancelada ? (
          <span className={estilos.seloCancelada} aria-hidden="true">✕</span>
        ) : (
          <input
            type="checkbox"
            className={estilos.checkbox}
            checked={o.concluida}
            disabled={!podeConcluir}
            onChange={(e) => onAlternar(o, e.target.checked, tarefa)}
            aria-label={`${o.concluida ? 'Remover execução' : 'Registrar execução (informar quem executou)'}: ${tarefa.descricao} em ${dataCurta(data)}`}
          />
        )}
        <button
          type="button"
          className={cx(estilos.rotulo, estilos[`pos${o.posicao}`])}
          onClick={() => onAbrir(o, tarefa)}
          aria-label={`Detalhes: ${titulo.replace(/\n/g, '. ')}`}
        >
          {rotuloCelula(o)}
        </button>
      </div>
      {execucoes.length > 1 && <span className={estilos.seloDuasExecucoes} aria-hidden="true">×2</span>}
      {o.ajustado_em && <span className={estilos.indicadorAjuste} aria-hidden="true" />}
    </td>
  );
});

export default function TarefasMatriz({ secoes, dias, hoje, execucoesPorOcorrencia, podeConcluir, podeEditar, onAlternarConclusao, onAbrirOcorrencia, onAbrirDia, onNovaAvulsa }) {
  const totalColunas = dias.length + 1;

  return (
    <div className={estilos.envolucro}>
      <table className={estilos.grade}>
        <thead>
          <tr>
            <th scope="col" className={estilos.colTarefa}>Tarefa</th>
            {dias.map((d) => (
              <th
                key={d}
                scope="col"
                className={cx(estilos.colDia, ehFimDeSemana(d) && estilos.fimDeSemana, d === hoje && estilos.hoje)}
              >
                <button type="button" className={estilos.botaoDia} onClick={() => onAbrirDia(d)} aria-label={`Resumo do dia ${dataCurta(d)}`}>
                  <span className={estilos.numeroDia}>{Number(d.slice(8))}</span>
                  <span className={estilos.siglaDia}>{abrevDiaSemana(d)}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {secoes.map((secao) => (
            <SecaoMatriz
              key={secao.categoria.valor}
              secao={secao}
              dias={dias}
              hoje={hoje}
              totalColunas={totalColunas}
              execucoesPorOcorrencia={execucoesPorOcorrencia}
              podeConcluir={podeConcluir}
              podeEditar={podeEditar}
              onAlternarConclusao={onAlternarConclusao}
              onAbrirOcorrencia={onAbrirOcorrencia}
              onNovaAvulsa={onNovaAvulsa}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SecaoMatriz({ secao, dias, hoje, totalColunas, execucoesPorOcorrencia, podeConcluir, podeEditar, onAlternarConclusao, onAbrirOcorrencia, onNovaAvulsa }) {
  return (
    <>
      <tr className={estilos.linhaSecao}>
        <td colSpan={totalColunas}>{secao.categoria.valor}</td>
      </tr>
      {secao.linhas.map((linha) => (
        <tr key={linha.tarefa.id} className={cx(!linha.tarefa.ativo && estilos.tarefaInativa)}>
          <th scope="row" className={cx(estilos.colTarefa, estilos.celulaTarefa)} title={`${linha.tarefa.descricao}\n${descreverRegra(linha.regra)}`}>
            <span className={estilos.descricaoTarefa}>{linha.tarefa.descricao}</span>
            <span className={estilos.metaTarefa}>
              <span>{frequenciaCurta(linha.regra)}</span>
              {!linha.tarefa.ativo && <span>(inativa)</span>}
            </span>
          </th>
          {dias.map((d) => {
            const ocorrencia = linha.ocorrencias.get(d);
            return (
              <Celula
                key={d}
                tarefa={linha.tarefa}
                data={d}
                ocorrencia={ocorrencia}
                execucoes={(ocorrencia && execucoesPorOcorrencia.get(ocorrencia.id)) || SEM_EXECUCOES}
                ocupada={linha.todasOcorrencias.has(d)}
                ehHoje={d === hoje}
                podeConcluir={podeConcluir}
                podeEditar={podeEditar}
                onAlternar={onAlternarConclusao}
                onAbrir={onAbrirOcorrencia}
                onNovaAvulsa={onNovaAvulsa}
              />
            );
          })}
        </tr>
      ))}
    </>
  );
}
