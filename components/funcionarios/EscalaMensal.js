import { Fragment } from 'react';
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
import { rotuloQuantidadeFuncionarias } from '../../lib/funcionarios/escalaGrupos';
import { rotuloFeriado } from '../../lib/funcionarios/escalaFeriados';
import { nomeCompactoEscala } from '../../lib/funcionarios/escalaNomes';
import { MarcaFeriadoVisual } from './EscalaFeriados';
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

// Texto do tooltip numa linha só -- nome acessível da célula (o conteúdo
// visual compacto, "M T", não diria nada a um leitor de tela).
function rotuloAcessivel(titulo) {
  return titulo.replace(/\n+/g, '. ');
}

function CelulaMensal({ funcionario, data, estado, ehHoje, onAbrir }) {
  const titulo = tituloCelula(funcionario, data, estado);
  return (
    <td className={cx(estilos.celulaMensalContainer, ehFimDeSemana(data) && estilos.celulaMensalFimDeSemana, ehHoje && estilos.celulaMensalHoje)}>
      <button type="button" className={estilos.celulaMensalBotao} title={titulo} aria-label={rotuloAcessivel(titulo)} onClick={() => onAbrir(funcionario, data, estado)}>
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
// Tooltip/nome acessível do dia + feriado (só informação) na 1ª linha.
function comFeriado(titulo, nomeFeriado) {
  return nomeFeriado ? `${titulo}\n${rotuloFeriado(nomeFeriado)}` : titulo;
}

// feriados (Map data -> nome, opcional): "F*" ao lado do número do dia e o
// nome no title/aria-label; o nome por extenso fica na legenda da tela e no
// modal do dia -- os cartões não ganham texto extra.
function CalendarioEscalaFuncionarios({ funcionarios, mapaEscala, dias, feriados, onAbrirFuncionarioDia, rotulo }) {
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
            <strong title={funcionario.nome}>{nomeCompactoEscala(funcionario.nome)}</strong>
            <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} />
          </div>
          <div className={estilos.calendarioMensal}>
            {CABECALHO_CALENDARIO.map((rotulo) => (
              <span key={rotulo} className={estilos.calendarioCabecalho} aria-hidden="true">{rotulo}</span>
            ))}
            {semanas.flat().map((data, i) => {
              if (!data) return <span key={`vazio-${i}`} className={estilos.calendarioVazio} />;
              const estado = obterEstadoDia(mapaEscala, funcionario.id, data);
              const nomeFeriado = feriados?.get(data) || null;
              const titulo = comFeriado(tituloCelula(funcionario, data, estado), nomeFeriado);
              const classe = cx(estilos.calendarioDia, ehFimDeSemana(data) && estilos.celulaMensalFimDeSemana, data === hoje && estilos.calendarioDiaHoje);
              const conteudo = (
                <>
                  <span className={estilos.calendarioNumero}>
                    {Number(data.slice(8))}
                    <MarcaFeriadoVisual nome={nomeFeriado} />
                  </span>
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

// Mensal no celular: o mês inteiro; tocar no dia abre o MESMO modal do dia
// (editável com escala.editar, só leitura sem).
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
//
// grupos (agruparPorCargo, já ordenados pela página): UMA grade só, com uma
// linha de título por cargo antes das funcionárias dele -- um único
// cabeçalho de dias, uma única rolagem horizontal/vertical, todos os cargos
// alinhados. O título fica preso à esquerda durante a rolagem horizontal.
//
// Rolagem: a grade CRESCE na vertical com todas as funcionárias (a página
// rola, como qualquer outra tela) -- o container só rola na HORIZONTAL
// (dias do mês), com Funcionário fixo à esquerda. Sem altura máxima, para
// nunca existir uma segunda barra vertical dentro da página.
// feriados (Map data -> nome, opcional): "F*" no cabeçalho do dia; o nome
// vai no aria-label/title do botão do cabeçalho e num balão no hover/foco.
export default function EscalaMensal({ grupos, mapaEscala, dias, feriados, onAbrirFuncionarioDia, onAbrirDia, ordenacao }) {
  const hoje = dataLocalHoje();
  const nomeAtivo = ordenacao?.chave === 'nome';
  const totalColunas = dias.length + 2;
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
            <th className={cx(estilos.colVinculoMensal, estilos.colVinculoMensalCabecalho)}>Vínculo</th>
            {dias.map((data) => {
              const nomeFeriado = feriados?.get(data) || null;
              const rotuloBotao = `Cobertura de ${formatarDataCurta(data)}${nomeFeriado ? ` — ${rotuloFeriado(nomeFeriado)}` : ''}`;
              return (
                <th key={data} className={cx(estilos.colDiaMensal, ehFimDeSemana(data) && estilos.colDiaMensalFimDeSemana, data === hoje && estilos.colDiaMensalHoje)}>
                  <button
                    type="button"
                    className={cx(estilos.botaoCabecalhoDia, nomeFeriado && estilos.comFeriado)}
                    onClick={() => onAbrirDia(data)}
                    aria-label={rotuloBotao}
                    title={nomeFeriado ? rotuloFeriado(nomeFeriado) : undefined}
                    data-feriado={nomeFeriado || undefined}
                  >
                    <span className={estilos.rotuloDiaSemanaMensal}>{ROTULO_DIA_SEMANA[diaDaSemanaIndice(data)]}</span>
                    <span>
                      {formatarDataCurta(data).split('/')[0]}
                      <MarcaFeriadoVisual nome={nomeFeriado} />
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grupos.length === 0 ? (
            <tr>
              <td className={estilos.colFuncionarioFixa} colSpan={totalColunas}>Nenhum funcionário para este filtro.</td>
            </tr>
          ) : (
            grupos.map((grupo) => (
              <Fragment key={grupo.chave}>
                <tr>
                  <th scope="colgroup" colSpan={totalColunas} className={estilos.celulaGrupoMensal}>
                    <span className={estilos.tituloGrupoMensal}>
                      <span className={estilos.tituloGrupoNome}>{grupo.nome}</span>
                      <span className={estilos.tituloGrupoContagem}>{rotuloQuantidadeFuncionarias(grupo.funcionarios.length)}</span>
                    </span>
                  </th>
                </tr>
                {grupo.funcionarios.map((funcionario) => (
                  <tr key={funcionario.id}>
                    <th scope="row" className={estilos.colFuncionarioFixa} title={funcionario.nome}>{nomeCompactoEscala(funcionario.nome)}</th>
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
                ))}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
