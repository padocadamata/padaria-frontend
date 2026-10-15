import {
  formatarHora,
  formatarPeriodo,
  diaDaSemanaIndice,
  ROTULO_DIA_SEMANA,
  formatarDataCurta,
  obterEstadoDia,
} from '../../lib/funcionarios/escala';
import { classificarCelulaMensal as classificarCelula, faixasDoDia } from '../../lib/funcionarios/escalaFaixas';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { semanasDoCalendario } from '../../lib/funcionarios/escalaMobile';
import { cx } from '../../lib/design/cx';
import IndicadorVinculo from './IndicadorVinculo';
import CabecalhoOrdenavel, { ariaSort } from '../ui/CabecalhoOrdenavel';
import estilos from './escala.module.css';

// Identifica sábado/domingo pela DATA real (0=domingo, 6=sábado -- mesma
// convenção de diaDaSemanaIndice), nunca por posição fixa de coluna --
// vale para qualquer mês/semana, independente de onde o fim de semana cai
// no calendário.
function ehFimDeSemana(data) {
  const dia = diaDaSemanaIndice(data);
  return dia === 0 || dia === 6;
}

// Tooltip nativo (hover no desktop) com os horários REAIS -- o grid em si
// fica compacto (seção 4: "não precisa mostrar todos os horários exatos
// escritos permanentemente").
function tituloCelula(funcionario, data, estado) {
  const [, mes, dia] = data.split('-');
  const cabecalho = `${funcionario.nome} — ${dia}/${mes}`;
  if (!estado) return `${cabecalho}\nNão definido`;
  if (estado.tipo === 'folga') return `${cabecalho}\nFolga`;

  const { periodosManha: doManha, periodosTarde: doTarde } = faixasDoDia(estado.periodos);
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

// Conteúdo de uma célula funcionário×dia: Não definido / Folga / Trabalho
// (com M/T distintos + selo de ocorrência). Nunca depende só de cor -- cada
// estado tem texto próprio (seção 5 da instrução aprovada). Usado pela
// grade do desktop e pelo calendário do celular.
function ConteudoCelulaMensal({ estado }) {
  const info = classificarCelula(estado);
  if (info.tipo === 'nao_definido') {
    return <span className={estilos.celulaMensalNaoDefinido}>—</span>;
  }
  if (info.tipo === 'folga') {
    return <span className={estilos.celulaMensalFolga}>Folga</span>;
  }
  return (
      <div className={estilos.celulaMensalTrabalho}>
        {/* Só as faixas realmente programadas são desenhadas (uma letra
            ausente não aparece mais esmaecida). Trabalho sem horário dentro
            das faixas mostra o 1º horário real, no estilo neutro. */}
        {info.manha && <span className={estilos.faixaMTPreenchida}>M</span>}
        {info.tarde && <span className={estilos.faixaMTPreenchida}>T</span>}
        {!info.manha && !info.tarde && (
          <span className={estilos.faixaMTVazia}>{info.periodos.length > 0 ? formatarHora(info.periodos[0].hora_inicio) : 'S/h'}</span>
        )}
        {info.ocorrencia && (
          <span className={info.ocorrencia.tipo === 'falta' ? estilos.seloMensalFalta : estilos.seloMensalAtestado}>
            {info.ocorrencia.tipo === 'falta' ? 'F' : 'A'}
          </span>
        )}
      </div>
  );
}

function CelulaMensal({ funcionario, data, estado, ehHoje, onAbrir }) {
  const titulo = tituloCelula(funcionario, data, estado);
  return (
    <td className={cx(estilos.celulaMensalContainer, ehFimDeSemana(data) && estilos.celulaMensalFimDeSemana, ehHoje && estilos.celulaMensalHoje)}>
      <button type="button" className={estilos.celulaMensalBotao} title={titulo} onClick={() => onAbrir(funcionario, data, estado)}>
        <ConteudoCelulaMensal estado={estado} />
      </button>
    </td>
  );
}

const CABECALHO_CALENDARIO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// Calendário compacto (segunda a domingo) por funcionário -- celular e
// tablet pequeno. Mesmas células (ConteudoCelulaMensal) e mesmo destaque de
// fim de semana/hoje da grade do desktop. Usado pelo Mensal (mês inteiro) e
// pela Semanal (1 semana); sem onAbrirFuncionarioDia (Semanal sem permissão
// de edição) os dias ficam só para leitura, como na grade da Semanal.
function CalendarioEscalaFuncionarios({ funcionarios, mapaEscala, dias, onAbrirFuncionarioDia, rotulo }) {
  const hoje = dataLocalHoje();
  const semanas = semanasDoCalendario(dias);
  if (funcionarios.length === 0) {
    return <p className={estilos.notaOcorrencia}>Nenhum funcionário para este filtro.</p>;
  }
  return (
    <ul className={estilos.listaCalendarios} aria-label={rotulo}>
      {funcionarios.map((funcionario) => (
        <li key={funcionario.id} className={estilos.cartaoCalendario}>
          <div className={estilos.cartaoCalendarioTopo}>
            <strong>{funcionario.nome}</strong>
            <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />
          </div>
          <div className={estilos.calendarioMensal}>
            {CABECALHO_CALENDARIO.map((rotulo) => (
              <span key={rotulo} className={estilos.calendarioCabecalho} aria-hidden="true">{rotulo}</span>
            ))}
            {semanas.flat().map((data, i) => {
              if (!data) return <span key={`vazio-${i}`} className={estilos.calendarioVazio} />;
              const estado = obterEstadoDia(mapaEscala, funcionario.id, data);
              const titulo = tituloCelula(funcionario, data, estado);
              const classe = cx(estilos.calendarioDia, ehFimDeSemana(data) && estilos.celulaMensalFimDeSemana, data === hoje && estilos.calendarioDiaHoje);
              const conteudo = (
                <>
                  <span className={estilos.calendarioNumero}>{Number(data.slice(8))}</span>
                  <ConteudoCelulaMensal estado={estado} />
                </>
              );
              if (!onAbrirFuncionarioDia) {
                return (
                  <div key={data} className={cx(classe, estilos.calendarioDiaLeitura)} title={titulo} aria-label={titulo.replace(/\n+/g, '. ')} role="img">
                    {conteudo}
                  </div>
                );
              }
              return (
                <button
                  key={data}
                  type="button"
                  className={classe}
                  title={titulo}
                  aria-label={titulo.replace(/\n+/g, '. ')}
                  onClick={() => onAbrirFuncionarioDia(funcionario, data, estado)}
                >
                  {conteudo}
                </button>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Mensal no celular: o mês inteiro, só leitura (abre o detalhe do dia).
export function EscalaMensalCalendario(props) {
  return <CalendarioEscalaFuncionarios {...props} rotulo="Escala mensal por funcionário" />;
}

// Semanal no celular: a semana inteira (segunda a domingo) com a mesma
// linguagem do Mensal; tocar no dia abre o MESMO modal de edição da grade.
export function EscalaSemanaCalendario(props) {
  return <CalendarioEscalaFuncionarios {...props} rotulo="Escala semanal por funcionário" />;
}

// Planejamento visual do MÊS (seção 2/3 da instrução aprovada): funcionário
// nas linhas, dias do mês nas colunas -- substitui o antigo calendário
// FullCalendar (que também escondia o bug do clique: o evento sintético
// cobria a célula inteira e o FullCalendar recusa dateClick em cima de
// qualquer .fc-event, ver isValidDateDownEl no core). Clique simples de
// <button>, sem biblioteca de calendário -- nunca mais sujeito a esse tipo
// de bloqueio.
// ordenacao (opcional): { chave, direcao, onOrdenar } -- só a coluna
// Funcionário ordena (A → Z / Z → A); quem ordena as linhas é a página.
export default function EscalaMensal({ funcionarios, mapaEscala, dias, onAbrirFuncionarioDia, onAbrirDia, ordenacao }) {
  const hoje = dataLocalHoje();
  const nomeAtivo = ordenacao?.chave === 'nome';
  return (
    <div className={estilos.envolucroMensal}>
      <table className={estilos.gradeMensal}>
        <thead>
          <tr>
            <th className={estilos.colFuncionarioFixa} aria-sort={ariaSort(nomeAtivo, ordenacao?.direcao)}>
              {ordenacao ? (
                <CabecalhoOrdenavel rotulo="Funcionário" ativa={nomeAtivo} direcao={ordenacao.direcao} onOrdenar={() => ordenacao.onOrdenar('nome')} />
              ) : (
                'Funcionário'
              )}
            </th>
            <th className={estilos.colVinculoMensal}>Vínculo</th>
            {dias.map((data) => (
              <th key={data} className={cx(estilos.colDiaMensal, ehFimDeSemana(data) && estilos.colDiaMensalFimDeSemana, data === hoje && estilos.colDiaMensalHoje)}>
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
              <td className={estilos.colFuncionarioFixa} colSpan={dias.length + 2}>Nenhum funcionário para este filtro.</td>
            </tr>
          ) : (
            funcionarios.map((funcionario) => (
              <tr key={funcionario.id}>
                <th scope="row" className={estilos.colFuncionarioFixa}>{funcionario.nome}</th>
                <td className={estilos.colVinculoMensal}>
                  <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />
                </td>
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
