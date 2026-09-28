import {
  formatarHora,
  formatarPeriodo,
  diaDaSemanaIndice,
  ROTULO_DIA_SEMANA,
  formatarDataCurta,
  obterEstadoDia,
} from '../../lib/funcionarios/escala';
import { LIMITE_MANHA_TARDE } from '../../lib/funcionarios/escalaConfig';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { cx } from '../../lib/design/cx';
import estilos from './escala.module.css';

// Classifica UMA célula funcionário×dia para o desenho de planejamento
// macro (seção 2/3 da instrução aprovada) -- não é cálculo de cobertura
// (isso continua só em lib/funcionarios/escalaCobertura.js); é só ler o
// EstadoDia já carregado e decidir o que a célula mostra. "Não definido" e
// "Folga" nunca se confundem (estado null vs. tipo_dia='folga' explícito).
function classificarCelula(estado) {
  if (!estado) return { tipo: 'nao_definido' };
  if (estado.tipo === 'folga') return { tipo: 'folga' };
  const manha = estado.periodos.some((p) => formatarHora(p.hora_inicio) < LIMITE_MANHA_TARDE);
  const tarde = estado.periodos.some((p) => formatarHora(p.hora_fim) > LIMITE_MANHA_TARDE);
  return { tipo: 'trabalho', manha, tarde, ocorrencia: estado.ocorrencia };
}

// Tooltip nativo (hover no desktop) com os horários REAIS -- o grid em si
// fica compacto (seção 4: "não precisa mostrar todos os horários exatos
// escritos permanentemente").
function tituloCelula(funcionario, data, estado) {
  const [, mes, dia] = data.split('-');
  const cabecalho = `${funcionario.nome} — ${dia}/${mes}`;
  if (!estado) return `${cabecalho}\nNão definido`;
  if (estado.tipo === 'folga') return `${cabecalho}\nFolga`;

  const doManha = estado.periodos.filter((p) => formatarHora(p.hora_inicio) < LIMITE_MANHA_TARDE);
  const doTarde = estado.periodos.filter((p) => formatarHora(p.hora_fim) > LIMITE_MANHA_TARDE);
  const linhas = [
    cabecalho,
    '',
    'Manhã',
    doManha.length > 0 ? doManha.map(formatarPeriodo).join(', ') : 'Não escalada',
    '',
    'Tarde',
    doTarde.length > 0 ? doTarde.map(formatarPeriodo).join(', ') : 'Não escalada',
  ];
  if (estado.ocorrencia) {
    linhas.push('', estado.ocorrencia.tipo === 'falta' ? 'FALTA' : 'ATESTADO');
  }
  return linhas.join('\n');
}

// Uma célula funcionário×dia: Não definido / Folga / Trabalho (com M/T
// distintos + selo de ocorrência). Nunca depende só de cor -- cada estado
// tem texto próprio (seção 5 da instrução aprovada).
function CelulaMensal({ funcionario, data, estado, ehHoje, onAbrir }) {
  const info = classificarCelula(estado);
  const titulo = tituloCelula(funcionario, data, estado);

  let conteudo;
  if (info.tipo === 'nao_definido') {
    conteudo = <span className={estilos.celulaMensalNaoDefinido}>—</span>;
  } else if (info.tipo === 'folga') {
    conteudo = <span className={estilos.celulaMensalFolga}>Folga</span>;
  } else {
    conteudo = (
      <div className={estilos.celulaMensalTrabalho}>
        <span className={info.manha ? estilos.faixaMTPreenchida : estilos.faixaMTVazia}>M</span>
        <span className={info.tarde ? estilos.faixaMTPreenchida : estilos.faixaMTVazia}>T</span>
        {info.ocorrencia && (
          <span className={info.ocorrencia.tipo === 'falta' ? estilos.seloMensalFalta : estilos.seloMensalAtestado}>
            {info.ocorrencia.tipo === 'falta' ? 'F' : 'A'}
          </span>
        )}
      </div>
    );
  }

  return (
    <td className={cx(estilos.celulaMensalContainer, ehHoje && estilos.celulaMensalHoje)}>
      <button type="button" className={estilos.celulaMensalBotao} title={titulo} onClick={() => onAbrir(funcionario, data, estado)}>
        {conteudo}
      </button>
    </td>
  );
}

// Planejamento visual do MÊS (seção 2/3 da instrução aprovada): funcionário
// nas linhas, dias do mês nas colunas -- substitui o antigo calendário
// FullCalendar (que também escondia o bug do clique: o evento sintético
// cobria a célula inteira e o FullCalendar recusa dateClick em cima de
// qualquer .fc-event, ver isValidDateDownEl no core). Clique simples de
// <button>, sem biblioteca de calendário -- nunca mais sujeito a esse tipo
// de bloqueio.
export default function EscalaMensal({ funcionarios, mapaEscala, dias, onAbrirFuncionarioDia, onAbrirDia }) {
  const hoje = dataLocalHoje();
  return (
    <div className={estilos.envolucroMensal}>
      <table className={estilos.gradeMensal}>
        <thead>
          <tr>
            <th className={estilos.colFuncionarioFixa}>Funcionário</th>
            {dias.map((data) => (
              <th key={data} className={cx(estilos.colDiaMensal, data === hoje && estilos.colDiaMensalHoje)}>
                <button type="button" className={estilos.botaoCabecalhoDia} onClick={() => onAbrirDia(data)}>
                  <span className={estilos.rotuloDiaSemanaMensal}>{ROTULO_DIA_SEMANA[diaDaSemanaIndice(data)]}</span>
                  <span>{formatarDataCurta(data).split('/')[0]}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {funcionarios.length === 0 ? (
            <tr>
              <td className={estilos.colFuncionarioFixa} colSpan={dias.length + 1}>Nenhum funcionário para este filtro.</td>
            </tr>
          ) : (
            funcionarios.map((funcionario) => (
              <tr key={funcionario.id}>
                <th scope="row" className={estilos.colFuncionarioFixa}>{funcionario.nome}</th>
                {dias.map((data) => (
                  <CelulaMensal
                    key={data}
                    funcionario={funcionario}
                    data={data}
                    estado={obterEstadoDia(mapaEscala, funcionario.id, data)}
                    ehHoje={data === hoje}
                    onAbrir={onAbrirFuncionarioDia}
                  />
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
