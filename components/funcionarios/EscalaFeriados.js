import { useEffect, useState } from 'react';
import Alert from '../ui/Alert';
import { buscarFeriadosPeriodo, MARCA_FERIADO, rotuloFeriado, legendaFeriados } from '../../lib/funcionarios/escalaFeriados';
import estilos from './escala.module.css';

// Feriados do período exibido (semana, mês ou intervalo da Cobertura).
// Só informação: enquanto carrega, ou se a leitura falhar, a escala
// continua funcionando normalmente (mapa vazio + erroFeriados = true para a
// tela mostrar o aviso discreto -- nunca "sem feriados" em silêncio).
export function useFeriadosPeriodo(dataInicio, dataFim) {
  const [feriados, setFeriados] = useState(() => new Map());
  const [erroFeriados, setErroFeriados] = useState(false);

  useEffect(() => {
    if (!dataInicio || !dataFim) return undefined;
    let ativo = true;
    buscarFeriadosPeriodo(dataInicio, dataFim).then(({ feriados: mapa, error }) => {
      if (!ativo) return;
      setErroFeriados(!!error);
      setFeriados(error ? new Map() : mapa);
    });
    return () => {
      ativo = false;
    };
  }, [dataInicio, dataFim]);

  return { feriados, erroFeriados };
}

export function AvisoErroFeriados({ visivel }) {
  if (!visivel) return null;
  return (
    <Alert tom="warning" className={estilos.mensagem}>
      Não foi possível carregar os feriados deste período. A escala continua funcionando normalmente.
    </Alert>
  );
}

// "F*" junto à data num cabeçalho NÃO interativo (Semanal, Cobertura):
// focável por teclado, com o nome do feriado no aria-label e num balão
// que aparece no hover E no foco (nunca só com mouse). Texto "F*" --
// nunca só cor.
export function MarcaFeriado({ nome }) {
  if (!nome) return null;
  return (
    <span className={estilos.marcaFeriado} tabIndex={0} role="img" aria-label={rotuloFeriado(nome)} data-feriado={nome}>
      {MARCA_FERIADO}
    </span>
  );
}

// "F*" dentro de algo que JÁ é interativo (botão do cabeçalho do dia na
// Mensal, dia do calendário compacto): só visual -- o nome vai no
// aria-label/title do próprio botão (não pode haver foco aninhado).
export function MarcaFeriadoVisual({ nome }) {
  if (!nome) return null;
  return (
    <span className={estilos.marcaFeriado} aria-hidden="true">
      {MARCA_FERIADO}
    </span>
  );
}

// Legenda com os feriados do período por extenso -- identifica o feriado
// sem depender de hover (celular, leitura rápida). Não aparece sem feriado.
export function LegendaFeriados({ feriados, dias }) {
  const texto = legendaFeriados(feriados, dias);
  if (!texto) return null;
  return <p className={estilos.legendaFeriados}>{texto}</p>;
}

// Linha "Feriado: nome" nos modais do dia (EscalaDiaModal / Cobertura do dia).
export function LinhaFeriadoDia({ nome }) {
  if (!nome) return null;
  return (
    <p className={estilos.linhaFeriadoDia}>
      <span className={estilos.marcaFeriado} aria-hidden="true">{MARCA_FERIADO}</span> {rotuloFeriado(nome)}
    </p>
  );
}
