// Modelo da impressão do Calendário de Tarefas (A4 paisagem / PDF).
//
// Função PURA -- testada em lib/tarefas/__tests__/impressao.test.mjs.
// Representa o PLANEJAMENTO do mês: em cada célula só a POSIÇÃO EFETIVA
// materializada na ocorrência (F1/F2/F3 -- respeita ajuste manual), nunca
// o executor real nem o estado de conclusão. Ocorrência cancelada = célula
// vazia (não há tarefa a fazer naquele dia). Linhas, ordem (menos
// frequente -> diárias -> sem programação) vêm da MESMA função do
// calendário (montarMatriz) -- nenhuma segunda lógica. No papel a regra vira
// só um código curto de frequência (coluna "Freq."), sem dias da semana.
// Grupos de distribuição não aparecem.

import { FILTROS_PADRAO, diasDoMes, montarMatriz } from './calendario.js';
import { DIAS_SEMANA, TIPOS_REGRA, frequenciaCurta } from './regras.js';

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export const POSICOES_IMPRESSAO = [1, 2, 3];

// "Outubro 2026"
export function rotuloMesImpressao(mesISO) {
  const [ano, mes] = mesISO.split('-').map(Number);
  return `${NOMES_MES[mes - 1]} ${ano}`;
}

// 1 = segunda ... 7 = domingo (ISO), sem depender do fuso do navegador.
function diaSemanaIso(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

// Código da coluna "Freq." da impressão (só frequência, nunca dias):
//   diária = D | N dias por semana = Nx (3x, 2x, 1x -- Sáb/Dom também é 2x)
//   quinzenal (uma semana sim, outra não no mês) = 15 | sem programação = —
// Combinação fora dessas (não existe no catálogo atual) cai na abreviação
// do calendário, em vez de inventar um código novo.
export function codigoFrequenciaImpressao(regra) {
  if (!regra || regra.tipo === TIPOS_REGRA.SEM_PROGRAMACAO) return '—';
  if (regra.tipo === TIPOS_REGRA.DIARIA) return 'D';
  const dias = new Set(regra.dias_semana || []);
  if (regra.tipo === TIPOS_REGRA.DIAS_SEMANA) return dias.size === 7 ? 'D' : `${dias.size}x`;
  const semanas = [...new Set(regra.semanas_do_mes || [])].sort((a, b) => a - b).join(',');
  if (dias.size === 1 && (semanas === '2,4' || semanas === '1,3')) return '15';
  return frequenciaCurta(regra);
}

// dataReferencia: a MESMA data que o calendário usa para escolher a regra
// exibida (hoje, limitado ao mês); sem ela, vale o último dia do mês.
export function montarImpressao({ categorias, tarefas, regrasPorTarefa, ocorrencias, mes, dataReferencia }) {
  const inicio = `${mes.slice(0, 7)}-01`;
  const dias = diasDoMes(inicio);
  const fim = dias[dias.length - 1];
  const doMes = ocorrencias.filter((o) => o.data >= inicio && o.data <= fim);

  const secoesMatriz = montarMatriz({
    categorias,
    tarefas,
    regrasPorTarefa,
    ocorrencias: doMes,
    filtros: FILTROS_PADRAO,
    dataReferencia: dataReferencia || fim,
  });

  return {
    mes: inicio,
    rotuloMes: rotuloMesImpressao(inicio),
    dias: dias.map((data) => {
      const iso = diaSemanaIso(data);
      return {
        data,
        numero: Number(data.slice(8)),
        sigla: DIAS_SEMANA.find((d) => d.valor === iso).curto,
        fimDeSemana: iso >= 6,
      };
    }),
    secoes: secoesMatriz.map((secao) => ({
      categoria: secao.categoria.valor,
      linhas: secao.linhas.map((linha) => ({
        tarefaId: linha.tarefa.id,
        descricao: linha.tarefa.descricao,
        frequencia: codigoFrequenciaImpressao(linha.regra),
        celulas: dias.map((data) => {
          const o = linha.todasOcorrencias.get(data);
          return { data, texto: o && !o.cancelada ? `F${o.posicao}` : '' };
        }),
      })),
    })),
  };
}
