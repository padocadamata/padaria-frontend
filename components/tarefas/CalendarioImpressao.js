import { useEffect, useRef, useState } from 'react';
import estilos from './impressao.module.css';

// Folha(s) impressa(s) do Calendário de Tarefas -- só PLANEJAMENTO: nome
// completo da tarefa, código de frequência (Freq.) e F1/F2/F3 nas células.
// Sem checkbox, executor, status de conclusão, botões ou grupos de
// distribuição. Recebe o modelo pronto de lib/tarefas/impressao.js.
//
// Altura de linha fixa: o nome sai em 9 pt; se o navegador precisar quebrá-lo
// (medido no DOM, uma vez por modelo), só esse nome passa ao estilo de duas
// linhas, que cabe na MESMA altura -- a linha nunca cresce.
export default function CalendarioImpressao({ modelo }) {
  const totalColunas = modelo.dias.length + 2;
  const tabela = useRef(null);
  const [nomesLongos, setNomesLongos] = useState(() => new Set());

  useEffect(() => {
    const longos = new Set();
    for (const el of tabela.current.querySelectorAll('[data-tarefa]')) {
      if (el.offsetHeight > parseFloat(getComputedStyle(el).fontSize) * 1.5) longos.add(el.dataset.tarefa);
    }
    setNomesLongos(longos);
  }, [modelo]);

  return (
    <div className={estilos.folha}>
      <table ref={tabela} className={estilos.tabela}>
        <colgroup>
          <col className={estilos.colTarefa} />
          <col className={estilos.colFreq} />
          {modelo.dias.map((d) => (
            <col key={d.data} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th colSpan={totalColunas} className={estilos.titulo}>
              <div className={estilos.tituloLinha}>
                <span className={estilos.tituloPrincipal}>CALENDÁRIO DE TAREFAS</span>
                <span className={estilos.tituloMes}>{modelo.rotuloMes}</span>
                <span className={estilos.marca}>Padoca da Mata</span>
              </div>
            </th>
          </tr>
          <tr>
            <th scope="col" className={estilos.cabTarefa}>Tarefa</th>
            <th scope="col" className={estilos.cabFreq}>Freq.</th>
            {modelo.dias.map((d) => (
              <th key={d.data} scope="col" className={`${estilos.cabDia} ${d.fimDeSemana ? estilos.cabDiaFimDeSemana : ''}`}>
                <span className={estilos.numDia}>{d.numero}</span>
                <span className={estilos.siglaDia}>{d.sigla}</span>
              </th>
            ))}
          </tr>
        </thead>
        {modelo.secoes.map((secao) => (
          <tbody key={secao.categoria} className={estilos.secao}>
            <tr className={estilos.linhaCategoria}>
              <th colSpan={totalColunas} scope="colgroup">{secao.categoria}</th>
            </tr>
            {secao.linhas.map((linha) => (
              <tr key={linha.tarefaId} className={estilos.linhaTarefa}>
                <th scope="row" className={estilos.celNome}>
                  <span
                    data-tarefa={linha.tarefaId}
                    className={nomesLongos.has(linha.tarefaId) ? `${estilos.nome} ${estilos.nomeDuasLinhas}` : estilos.nome}
                  >
                    {linha.descricao}
                  </span>
                </th>
                <td className={estilos.celFreq}>{linha.frequencia}</td>
                {linha.celulas.map((c) => (
                  <td key={c.data} className={`${c.texto ? estilos.celF : estilos.celVazia} ${c.fimDeSemana ? estilos.celFimDeSemana : ''}`}>
                    {c.texto}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <section className={estilos.responsaveis} aria-label="Responsáveis">
        <h2 className={estilos.tituloResponsaveis}>RESPONSÁVEIS</h2>
        {[1, 2, 3].map((p) => (
          <div key={p} className={estilos.linhaResponsavel}>
            <span className={estilos.rotuloResponsavel}>F{p}</span>
            <span className={estilos.areaEscrita} />
          </div>
        ))}
      </section>
    </div>
  );
}
