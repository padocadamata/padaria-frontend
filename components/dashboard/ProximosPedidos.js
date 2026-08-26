import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';

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

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '18px 20px',
  borderRadius: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

// Converte Date.getDay() (0=domingo..6=sábado) para a convenção de
// fornecedor_regras_pedido (1=segunda..7=domingo). Mesma técnica segura
// de meio-dia local já usada em todo o projeto — evita que a conversão
// de fuso empurre a data para o dia anterior/seguinte.
export function diaSemanaISO(dataYYYYMMDD) {
  const diaJs = new Date(`${dataYYYYMMDD}T12:00:00`).getDay();
  return diaJs === 0 ? 7 : diaJs;
}

export function adicionarDias(dataYYYYMMDD, dias) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  data.setDate(data.getDate() + dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

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

function descreverEntregaTexto(regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return `entrega D+${regra.dias_prazo}`;
  }
  return `entrega ${DIA_SEMANA_LABEL[regra.dia_entrega]}`;
}

// Data de entrega gerada por UMA ocorrência de pedido desta regra, a
// partir da data em que o pedido teria ocorrido.
//   prazo_dias: soma direta de dias_prazo.
//   dia_fixo: próxima ocorrência do dia_entrega a partir da data do
//     pedido, INCLUSIVE (se o pedido já cair no próprio dia_entrega,
//     a entrega é no mesmo dia — não empurra pra semana seguinte).
export function calcularDataEntrega(dataPedido, regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return adicionarDias(dataPedido, regra.dias_prazo);
  }
  const diferenca = (regra.dia_entrega - diaSemanaISO(dataPedido) + 7) % 7;
  return adicionarDias(dataPedido, diferenca);
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
export default function ProximosPedidos({ corPrimaria }) {
  const router = useRouter();
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

      // eventosPorData[data] = { pedidos: Map(fornecedorId->nome), entregas: Map(fornecedorId->nome) }
      // O Map, chaveado por fornecedorId dentro de cada (data, tipo), já
      // é a deduplicação por data|tipo|fornecedorId — duas regras do
      // mesmo fornecedor batendo no mesmo dia/tipo colapsam numa entrada só.
      const eventosPorData = {};
      for (const data of diasSemana) {
        eventosPorData[data] = { pedidos: new Map(), entregas: new Map() };
      }

      for (const dataAvaliada of diasAvaliacao) {
        const diaIso = diaSemanaISO(dataAvaliada);

        for (const regra of regrasComDia) {
          if (regra.dia_pedido !== diaIso) continue;

          const nome = nomePorFornecedorId[regra.fornecedor_id];

          // PEDIR só é mostrado se o próprio dia do pedido cair dentro
          // da semana exibida (não mostramos PEDIR de dias passados de
          // semanas anteriores).
          if (dataAvaliada >= domingo && dataAvaliada <= sabado) {
            eventosPorData[dataAvaliada].pedidos.set(regra.fornecedor_id, nome);
          }

          // ENTREGA é calculada a partir de QUALQUER pedido dentro da
          // janela de avaliação (inclusive antes do domingo exibido) —
          // só entra na grade se a data de entrega resultante cair
          // dentro da semana exibida.
          const dataEntrega = calcularDataEntrega(dataAvaliada, regra);
          if (dataEntrega >= domingo && dataEntrega <= sabado) {
            eventosPorData[dataEntrega].entregas.set(regra.fornecedor_id, nome);
          }
        }
      }

      const colunasCalculadas = diasSemana.map((data, indice) => ({
        data,
        label: DIA_SEMANA_CURTO[indice],
        ehHoje: data === hoje,
        pedidos: Array.from(eventosPorData[data].pedidos.entries()).map(([id, nome]) => ({ id, nome })),
        entregas: Array.from(eventosPorData[data].entregas.entries()).map(([id, nome]) => ({ id, nome })),
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

  function irParaFornecedores() {
    router.push('/fornecedores');
  }

  const semanaVazia = colunas.every((c) => c.pedidos.length === 0 && c.entregas.length === 0);

  return (
    <section style={caixaEstilo}>
      <h3 style={{ margin: '0 0 12px 0', color: corPrimaria, fontSize: '16px' }}>Agenda de pedidos e entregas</h3>

      {erro ? (
        <p style={{ color: '#f44336', fontSize: '13px', margin: 0 }}>{erro}</p>
      ) : carregando ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Carregando...</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))',
                gap: '8px',
                minWidth: '770px',
              }}
            >
              {colunas.map((coluna) => {
                const temEvento = coluna.pedidos.length > 0 || coluna.entregas.length > 0;
                return (
                  <div
                    key={coluna.data}
                    onClick={temEvento ? irParaFornecedores : undefined}
                    style={{
                      padding: '8px',
                      borderRadius: '5px',
                      minHeight: '92px',
                      backgroundColor: coluna.ehHoje ? '#e3f2fd' : '#fafafa',
                      border: coluna.ehHoje ? '1px solid #90caf9' : '1px solid #eee',
                      cursor: temEvento ? 'pointer' : 'default',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: coluna.ehHoje ? corPrimaria : '#666',
                        marginBottom: '6px',
                      }}
                    >
                      {coluna.label} {formatarDataExibicao(coluna.data)}
                    </div>

                    {temEvento ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {coluna.pedidos.map((p) => (
                          <div key={`pedir-${p.id}`} style={{ fontSize: '11px', color: '#1565c0' }}>
                            PEDIR · {p.nome}
                          </div>
                        ))}
                        {coluna.entregas.map((e) => (
                          <div key={`entrega-${e.id}`} style={{ fontSize: '11px', color: '#2e7d32' }}>
                            ENTREGA · {e.nome}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '11px', color: '#ccc' }}>—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {diarios.length > 0 && (
            <p style={{ fontSize: '12px', color: '#666', marginTop: '10px', marginBottom: 0 }}>
              Pedido diário: {diarios.join(' · ')}
            </p>
          )}

          {semanaVazia && diarios.length === 0 && (
            <p style={{ color: '#999', fontSize: '13px', margin: '10px 0 0 0' }}>
              Nenhum pedido programado para esta semana.
            </p>
          )}
        </>
      )}
    </section>
  );
}
