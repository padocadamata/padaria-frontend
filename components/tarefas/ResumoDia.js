import { useMemo } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { cx } from '../../lib/design/cx';
import { dataExtensa, descreverSituacao, ocorrenciaVisivel, resumoDoDia } from '../../lib/tarefas/calendario';
import estilos from './tarefas.module.css';

// Resumo de UM dia: tarefas agrupadas pelo responsável exibido (F1 -> F2
// -> F3, nomes seguem a posição), com checkbox de conclusão e progresso.
// Mesmo conteúdo no modal (desktop, clique no cabeçalho do dia) e na visão
// principal do celular (onde a matriz de 31 colunas não cabe). O grupo é
// a POSIÇÃO PROGRAMADA; o texto de cada tarefa mostra QUEM EXECUTOU (0062).
export function ResumoDiaConteudo({ data, ocorrencias, execucoesPorOcorrencia, tarefasPorId, categorias, filtros, podeConcluir, onAlternarConclusao, onAbrirOcorrencia }) {
  const resumo = useMemo(() => {
    const visiveis = filtros ? ocorrencias.filter((o) => ocorrenciaVisivel(o, filtros)) : ocorrencias;
    return resumoDoDia({ ocorrencias: visiveis, data, tarefasPorId, categorias });
  }, [ocorrencias, data, tarefasPorId, categorias, filtros]);

  const { total, concluidas, canceladas } = resumo.progresso;
  const percentual = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  if (resumo.grupos.length === 0) {
    return <EmptyState>Nenhuma tarefa programada para este dia{filtros ? ' com os filtros atuais' : ''}.</EmptyState>;
  }

  return (
    <>
      <div className={estilos.progressoDia} role="status">
        {concluidas} de {total} concluída{total === 1 ? '' : 's'}{canceladas > 0 ? ` · ${canceladas} cancelada${canceladas === 1 ? '' : 's'}` : ''}
        <div className={estilos.barraProgresso} aria-hidden="true">
          <div className={estilos.barraProgressoValor} style={{ width: `${percentual}%` }} />
        </div>
      </div>

      {resumo.grupos.map((grupo) => (
        <section key={grupo.chave} className={estilos.grupoResponsavel} aria-label={`Tarefas de ${grupo.rotulo}`}>
          <div className={estilos.cabecalhoGrupo}>
            <span className={cx(estilos.chipPosicao, estilos[`pos${grupo.posicao}`])}>
              {grupo.rotulo}{/^F[123]$/.test(grupo.rotulo) ? '' : ` · F${grupo.posicao}`}
            </span>
            <span className={estilos.contagemGrupo}>
              {grupo.progresso.concluidas}/{grupo.progresso.total}
            </span>
          </div>
          <ul className={estilos.listaTarefasDia}>
            {grupo.itens.map((o) => {
              const tarefa = tarefasPorId.get(o.tarefa_id);
              return (
                <li key={o.id} className={cx(estilos.itemTarefaDia, o.concluida && estilos.itemConcluido, o.cancelada && estilos.itemCancelado)}>
                  {!o.cancelada && (
                    <input
                      type="checkbox"
                      checked={o.concluida}
                      disabled={!podeConcluir}
                      onChange={(e) => onAlternarConclusao(o, e.target.checked, tarefa)}
                      aria-label={`${o.concluida ? 'Remover execução' : 'Registrar execução'}: ${tarefa?.descricao ?? ''}`}
                    />
                  )}
                  <span className={estilos.textoItemDia}>
                    {tarefa?.descricao ?? '(tarefa removida)'}
                    <span className={estilos.detalheItemDia}>
                      {descreverSituacao(o, execucoesPorOcorrencia?.get(o.id) || [])}
                      {o.ajustado_em ? ' · ajustada' : ''}
                      {o.origem === 'avulsa' ? ' · avulsa' : ''}
                    </span>
                  </span>
                  {onAbrirOcorrencia && (
                    <Button variante="ghost" tamanho="sm" onClick={() => onAbrirOcorrencia(o, tarefa)}>
                      Detalhes
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function ResumoDiaModal({ data, onFechar, ...resto }) {
  return (
    <Modal titulo={`Tarefas do dia — ${dataExtensa(data)}`} onFechar={onFechar} largura="lg">
      <ResumoDiaConteudo data={data} {...resto} />
    </Modal>
  );
}
