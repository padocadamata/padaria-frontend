import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { diaSemanaISO, adicionarDias, calcularDataEntrega } from '../../lib/fornecedores/regrasPedido';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { cx } from '../../lib/design/cx';
import styles from './dashboard.module.css';

// 1=segunda .. 7=domingo — mesma convenção de public.fornecedor_regras_pedido
// (migration 0007) e de components/fornecedores/FornecedorRegras.js.
const DIA_SEMANA_LABEL = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};

// Posição 0 do grid é SEMPRE domingo (ver domingoInicioSemana) — por
// isso este array é indexado por posição, não pelo índice ISO.
const DIA_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Este, ao contrário do array acima, é indexado pelo índice ISO
// (1=segunda..7=domingo) — usado no tooltip, onde a data pode ser de
// fora do grid exibido (semana anterior/seguinte), então não dá pra usar
// posição relativa ao domingo exibido.
const DIA_SEMANA_CURTO_POR_ISO = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };

// Domingo que INICIA a semana corrente (contém "hoje") — sempre olha
// para trás até o domingo mais recente (ou o próprio hoje, se hoje já
// for domingo). Propositalmente diferente de domingoDaSemana() em
// pages/producao/planejamento.js, que calcula o domingo de FIM de um
// período (para frente, como limite superior de um filtro) — aqui é o
// início de uma semana fixa exibida (domingo a sábado).
export function domingoInicioSemana(hojeYYYYMMDD) {
  const diaIso = diaSemanaISO(hojeYYYYMMDD);
  const diasDesdeDomingo = diaIso === 7 ? 0 : diaIso;
  return adicionarDias(hojeYYYYMMDD, -diasDesdeDomingo);
}

function formatarDataExibicao(dataYYYYMMDD) {
  const [, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

function formatarDataComDia(dataYYYYMMDD) {
  return `${DIA_SEMANA_CURTO_POR_ISO[diaSemanaISO(dataYYYYMMDD)]} ${formatarDataExibicao(dataYYYYMMDD)}`;
}

function descreverEntregaTexto(regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return `entrega D+${regra.dias_prazo}`;
  }
  return `entrega ${DIA_SEMANA_LABEL[regra.dia_entrega]}`;
}

// "Agenda de pedidos e entregas" — grade semanal (domingo a sábado)
// calculada só a partir de public.fornecedor_regras_pedido (fornecedores
// ativos + regras ativas). NÃO representa pedido real algum — não existe
// módulo de Pedidos ainda; nenhum status "feito", nenhuma baixa, nenhum
// "atrasado", nenhum recebimento aqui (isso é outra frente, futura).
//
// dia_pedido = NULL (regra diária, "pode pedir qualquer dia") NUNCA gera
// evento em uma célula específica — repetiria a mesma regra nos 7 dias
// sem informação real de "quando". Em vez disso, aparece numa linha
// separada abaixo da grade ("Pedido diário: ..."), com a entrega descrita
// só textualmente (D+N ou dia da semana), nunca posicionada numa célula —
// sem uma data real de pedido não há como calcular a ocorrência.
//
// Entregas podem ser originadas por um pedido de ANTES do domingo
// exibido (ex.: pedido sexta da semana anterior + D+3 cai na segunda
// desta semana) — por isso a avaliação de regras cobre uma janela
// retrospectiva antes do domingo, não só os 7 dias visíveis. A janela é
// max(6, maior dias_prazo cadastrado): 6 é o deslocamento máximo
// possível de uma regra dia_fixo (ciclo semanal, nunca mais que 6 dias);
// para prazo_dias usa o maior valor realmente cadastrado, nunca um
// número arbitrário fixo.
export default function ProximosPedidos() {
  const [colunas, setColunas] = useState([]);
  const [diarios, setDiarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregar() {
      setCarregando(true);
      const supabase = createClient();

      const [fornecedoresResp, regrasResp] = await Promise.all([
        supabase.from('fornecedores').select('id, nome, nome_fantasia, razao_social').eq('ativo', true),
        supabase
          .from('fornecedor_regras_pedido')
          .select('id, fornecedor_id, dia_pedido, tipo_entrega, dias_prazo, dia_entrega')
          .eq('ativo', true),
      ]);

      if (!efeitoAtivo) return;

      const primeiroErro = fornecedoresResp.error || regrasResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar agenda de pedidos e entregas:', primeiroErro);
        setErro('Não foi possível carregar a agenda de pedidos e entregas.');
        setColunas([]);
        setDiarios([]);
        setCarregando(false);
        return;
      }

      const nomePorFornecedorId = {};
      for (const f of fornecedoresResp.data || []) {
        nomePorFornecedorId[f.id] = f.nome_fantasia || f.razao_social || f.nome || f.id;
      }

      // Só regras de fornecedor ainda ativo.
      const todasRegras = (regrasResp.data || []).filter((r) => nomePorFornecedorId[r.fornecedor_id]);
      const regrasComDia = todasRegras.filter((r) => r.dia_pedido !== null);
      const regrasDiarias = todasRegras.filter((r) => r.dia_pedido === null);

      const hoje = dataLocalHoje();
      const domingo = domingoInicioSemana(hoje);
      const sabado = adicionarDias(domingo, 6);
      const diasSemana = Array.from({ length: 7 }, (_, i) => adicionarDias(domingo, i));

      const maiorDiasPrazo = regrasComDia
        .filter((r) => r.tipo_entrega === 'prazo_dias')
        .reduce((maior, r) => Math.max(maior, r.dias_prazo ?? 0), 0);
      const janelaRetrospectivaDias = Math.max(6, maiorDiasPrazo);

      const diasAvaliacao = [];
      for (let i = -janelaRetrospectivaDias; i <= 6; i++) {
        diasAvaliacao.push(adicionarDias(domingo, i));
      }

      // Número visual (¹²³...) — vinculado à REGRA, não à ocorrência
      // calculada numa semana específica. Por fornecedor, ordena as
      // regras com dia_pedido por dia_pedido crescente (desempate pelo
      // próprio id, só para determinismo total) e numera 1..N. Esse
      // número é FIXO para aquela regra — a mesma regra sempre aparece
      // com o mesmo número, em qualquer semana exibida, porque não
      // depende de quantas ocorrências históricas caem na janela de
      // avaliação (se dependesse da ocorrência, o número de uma regra
      // "andaria" conforme quantas semanas de histórico calculado
      // existissem — testado e descartado antes de implementar).
      const regrasPorFornecedor = new Map();
      for (const regra of regrasComDia) {
        if (!regrasPorFornecedor.has(regra.fornecedor_id)) {
          regrasPorFornecedor.set(regra.fornecedor_id, []);
        }
        regrasPorFornecedor.get(regra.fornecedor_id).push(regra);
      }
      const numeroPorRegraId = new Map();
      for (const [, lista] of regrasPorFornecedor.entries()) {
        const ordenada = [...lista].sort((a, b) => {
          if (a.dia_pedido !== b.dia_pedido) return a.dia_pedido - b.dia_pedido;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        ordenada.forEach((regra, indice) => numeroPorRegraId.set(regra.id, indice + 1));
      }

      // eventosPorData[data] = { pedidos: Map(chaveCiclo->evento), entregas: Map(chaveCiclo->evento) }
      // chaveCiclo = fornecedor+dataPedido+dataEntrega — deduplicação
      // visual (duas regras idênticas do mesmo fornecedor no mesmo dia
      // colapsam numa entrada só), sem perder ciclos genuinamente
      // diferentes do mesmo fornecedor (dataEntrega diferente = chave
      // diferente = entradas separadas, cada uma com seu próprio número).
      const eventosPorData = {};
      for (const data of diasSemana) {
        eventosPorData[data] = { pedidos: new Map(), entregas: new Map() };
      }

      for (const dataAvaliada of diasAvaliacao) {
        const diaIso = diaSemanaISO(dataAvaliada);

        for (const regra of regrasComDia) {
          if (regra.dia_pedido !== diaIso) continue;

          const nome = nomePorFornecedorId[regra.fornecedor_id];
          const numero = numeroPorRegraId.get(regra.id);
          const dataEntrega = calcularDataEntrega(dataAvaliada, regra);
          const chaveCiclo = `${regra.fornecedor_id}|${dataAvaliada}|${dataEntrega}`;
          const evento = { chaveCiclo, fornecedorId: regra.fornecedor_id, nome, numero, dataPedido: dataAvaliada, dataEntrega };

          // PEDIR só é mostrado se o próprio dia do pedido cair dentro
          // da semana exibida (não mostramos PEDIR de dias passados de
          // semanas anteriores).
          if (dataAvaliada >= domingo && dataAvaliada <= sabado) {
            eventosPorData[dataAvaliada].pedidos.set(chaveCiclo, evento);
          }

          // ENTREGA é calculada a partir de QUALQUER pedido dentro da
          // janela de avaliação (inclusive antes do domingo exibido) —
          // só entra na grade se a data de entrega resultante cair
          // dentro da semana exibida.
          if (dataEntrega >= domingo && dataEntrega <= sabado) {
            eventosPorData[dataEntrega].entregas.set(chaveCiclo, evento);
          }
        }
      }

      const colunasCalculadas = diasSemana.map((data, indice) => ({
        data,
        label: DIA_SEMANA_CURTO[indice],
        ehHoje: data === hoje,
        pedidos: Array.from(eventosPorData[data].pedidos.values()),
        entregas: Array.from(eventosPorData[data].entregas.values()),
      }));

      // Regras diárias: nunca em célula específica — linha única abaixo
      // da grade, deduplicada por fornecedor + descrição de entrega
      // (duas regras diárias idênticas do mesmo fornecedor colapsam;
      // duas regras diárias DIFERENTES do mesmo fornecedor, ex. D+2 e
      // D+5, continuam aparecendo como itens distintos).
      const diariosMap = new Map();
      for (const regra of regrasDiarias) {
        const nome = nomePorFornecedorId[regra.fornecedor_id];
        const chave = `${regra.fornecedor_id}|${regra.tipo_entrega}|${regra.dias_prazo ?? ''}|${regra.dia_entrega ?? ''}`;
        if (!diariosMap.has(chave)) {
          diariosMap.set(chave, `${nome} (${descreverEntregaTexto(regra)})`);
        }
      }

      setColunas(colunasCalculadas);
      setDiarios(Array.from(diariosMap.values()));
      setCarregando(false);
    }

    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  const semanaVazia = colunas.every((c) => c.pedidos.length === 0 && c.entregas.length === 0);

  return (
    <Card titulo="Agenda de pedidos e entregas" subtitulo="Semana atual (domingo a sábado)" icone="calendar">
      {erro ? (
        <p className={styles.erro}>{erro}</p>
      ) : carregando ? (
        <p className={styles.vazio}>Carregando...</p>
      ) : (
        <>
          <ul className={styles.semana}>
            {colunas.map((coluna) => {
              const temEvento = coluna.pedidos.length > 0 || coluna.entregas.length > 0;

              const conteudo = (
                <>
                  <div className={styles.diaCabecalho}>
                    <span>
                      {coluna.label} {formatarDataExibicao(coluna.data)}
                    </span>
                    {coluna.ehHoje && <Badge tom="primary">Hoje</Badge>}
                  </div>

                  {temEvento ? (
                    <div className={styles.eventos}>
                      {coluna.pedidos.map((p) => (
                        <div key={`pedir-${p.chaveCiclo}`} className={styles.evento}>
                          <Badge tom="info">Pedir</Badge>
                          <span>
                            {p.nome}{' '}
                            <sup
                              title={`Pedido ${formatarDataComDia(p.dataPedido)} → Entrega ${formatarDataComDia(p.dataEntrega)}`}
                              className={styles.nota}
                            >
                              {p.numero}
                            </sup>
                          </span>
                        </div>
                      ))}
                      {coluna.entregas.map((e) => (
                        <div key={`entrega-${e.chaveCiclo}`} className={styles.evento}>
                          <Badge tom="success">Entrega</Badge>
                          <span>
                            {e.nome}{' '}
                            <sup
                              title={`Pedido ${formatarDataComDia(e.dataPedido)} → Entrega ${formatarDataComDia(e.dataEntrega)}`}
                              className={styles.nota}
                            >
                              {e.numero}
                            </sup>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.diaVazio}>—</div>
                  )}
                </>
              );

              return (
                <li key={coluna.data} className={styles.diaItem}>
                  {temEvento ? (
                    <Link href="/fornecedores" className={cx(styles.dia, coluna.ehHoje && styles.diaHoje)}>
                      {conteudo}
                    </Link>
                  ) : (
                    <div className={cx(styles.dia, coluna.ehHoje && styles.diaHoje)}>{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ul>

          {diarios.length > 0 && <p className={styles.diarios}>Pedido diário: {diarios.join(' · ')}</p>}

          {semanaVazia && diarios.length === 0 && (
            <p className={styles.vazio}>Nenhum pedido programado para esta semana.</p>
          )}
        </>
      )}
    </Card>
  );
}
