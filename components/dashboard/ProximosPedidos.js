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
function diaSemanaISO(dataYYYYMMDD) {
  const diaJs = new Date(`${dataYYYYMMDD}T12:00:00`).getDay();
  return diaJs === 0 ? 7 : diaJs;
}

function adicionarDias(dataYYYYMMDD, dias) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  data.setDate(data.getDate() + dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// De hoje até o domingo desta semana (inclusive) — nunca ultrapassa a
// semana corrente.
function datasAteFimDaSemana(hojeYYYYMMDD) {
  const datas = [hojeYYYYMMDD];
  let atual = hojeYYYYMMDD;
  while (diaSemanaISO(atual) !== 7) {
    atual = adicionarDias(atual, 1);
    datas.push(atual);
  }
  return datas;
}

function formatarDataExibicao(dataYYYYMMDD) {
  const [, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

function descreverEntrega(regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return `entrega D+${regra.dias_prazo}`;
  }
  return `entrega ${DIA_SEMANA_LABEL[regra.dia_entrega]}`;
}

// "Próximos pedidos" — agenda da semana calculada só a partir de
// public.fornecedor_regras_pedido (fornecedores ativos + regras ativas).
// NÃO representa pedido real algum — não existe módulo de Pedidos ainda.
// dia_pedido = NULL é tratado como regra diária (significado já definido
// na migration 0007: "pode pedir qualquer dia"), então aparece em todos
// os dias do horizonte. Nenhum status de "pedido feito", nenhuma baixa,
// nenhum "atrasado" — isso depende do futuro módulo de Pedidos.
export default function ProximosPedidos({ corPrimaria }) {
  const router = useRouter();
  const [linhas, setLinhas] = useState([]);
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
        console.error('Erro ao carregar próximos pedidos:', primeiroErro);
        setErro('Não foi possível carregar os próximos pedidos.');
        setLinhas([]);
        setCarregando(false);
        return;
      }

      const nomePorFornecedorId = {};
      for (const f of fornecedoresResp.data || []) {
        nomePorFornecedorId[f.id] = f.nome_fantasia || f.razao_social || f.nome || f.id;
      }

      const hoje = dataLocalHoje();
      const datas = datasAteFimDaSemana(hoje);
      const regras = regrasResp.data || [];

      const linhasCalculadas = [];
      for (const data of datas) {
        const diaIso = diaSemanaISO(data);

        // Agrupa por fornecedor dentro do mesmo dia — evita mostrar o
        // mesmo fornecedor duas vezes na mesma data quando ele tem mais
        // de uma regra ativa batendo com esse dia.
        const descricoesPorFornecedor = new Map();
        for (const regra of regras) {
          if (!nomePorFornecedorId[regra.fornecedor_id]) continue; // fornecedor inativo
          const combina = regra.dia_pedido === null || regra.dia_pedido === diaIso;
          if (!combina) continue;

          const atuais = descricoesPorFornecedor.get(regra.fornecedor_id) || new Set();
          atuais.add(descreverEntrega(regra));
          descricoesPorFornecedor.set(regra.fornecedor_id, atuais);
        }

        for (const [fornecedorId, descricoesSet] of descricoesPorFornecedor.entries()) {
          linhasCalculadas.push({
            chave: `${data}|${fornecedorId}`,
            data,
            fornecedorNome: nomePorFornecedorId[fornecedorId],
            descricao: Array.from(descricoesSet).join(' · '),
            ehHoje: data === hoje,
          });
        }
      }

      setLinhas(linhasCalculadas);
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

  return (
    <section style={caixaEstilo}>
      <h3 style={{ margin: '0 0 12px 0', color: corPrimaria, fontSize: '16px' }}>Próximos pedidos</h3>

      {erro ? (
        <p style={{ color: '#f44336', fontSize: '13px', margin: 0 }}>{erro}</p>
      ) : carregando ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Carregando...</p>
      ) : linhas.length === 0 ? (
        <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Nenhum pedido programado para esta semana.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {linhas.map((linha) => (
            <li
              key={linha.chave}
              onClick={irParaFornecedores}
              style={{
                cursor: 'pointer',
                padding: '8px 10px',
                borderRadius: '5px',
                fontSize: '13px',
                backgroundColor: linha.ehHoje ? '#e3f2fd' : '#fafafa',
                border: linha.ehHoje ? '1px solid #90caf9' : '1px solid #eee',
                fontWeight: linha.ehHoje ? 'bold' : 'normal',
              }}
            >
              {linha.ehHoje ? 'Hoje' : `${DIA_SEMANA_LABEL[diaSemanaISO(linha.data)]} ${formatarDataExibicao(linha.data)}`}
              {' — '}
              {linha.fornecedorNome}
              <span style={{ color: '#666', fontWeight: 'normal' }}> ({linha.descricao})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
