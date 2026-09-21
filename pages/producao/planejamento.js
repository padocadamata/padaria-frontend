import { useEffect, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import PaginaProducao from '../../components/producao/PaginaProducao';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Field from '../../components/ui/Field';
import FilterBar from '../../components/ui/FilterBar';
import Icon from '../../components/ui/Icon';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import estilos from '../../components/producao/producao.module.css';
import estilosPlan from '../../components/producao/planejamento.module.css';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { dataLocalHoje, diaDaSemanaExibicao } from '../../lib/data/dataLocal';
import { calcularSugestaoProducao } from '../../lib/producao/sugestaoProducao';
import { APARENCIA_FIXA } from '../../lib/branding/tema';
import Paginacao, { paginarLista } from '../../components/Paginacao';

const TURNOS = [
  { chave: 'manha', label: 'Manhã' },
  { chave: 'tarde', label: 'Tarde' },
];

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Mesma técnica segura de lib/data/dataLocal.js (meio-dia local, nunca
// UTC/toISOString) — evita que somar dias empurre para o dia
// anterior/seguinte por causa do fuso horário.
function adicionarDias(dataYYYYMMDD, dias) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  data.setDate(data.getDate() + dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Domingo da semana corrente, incluindo hoje se hoje já for domingo —
// padrão inicial do filtro (decisão 2026-08-24): "hoje até o domingo da
// semana corrente", nunca "amanhã em diante".
function domingoDaSemana(dataYYYYMMDD) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  const diaSemana = data.getDay(); // 0 = domingo
  const diasAteDomingo = diaSemana === 0 ? 0 : 7 - diaSemana;
  return adicionarDias(dataYYYYMMDD, diasAteDomingo);
}

function listaDatasEntre(dataInicial, dataFinal) {
  const datas = [];
  let atual = dataInicial;
  // Guarda de segurança contra período invertido/absurdo por engano de
  // digitação — não é um limite de produto, só evita loop infinito.
  let protecao = 0;
  while (atual <= dataFinal && protecao < 3660) {
    datas.push(atual);
    atual = adicionarDias(atual, 1);
    protecao += 1;
  }
  return datas;
}

function chaveSlot(data, turno, receitaId) {
  return `${data}|${turno}|${receitaId}`;
}

function baseDeEdicoes(mapa) {
  const base = {};
  for (const [chave, edicao] of Object.entries(mapa)) {
    base[chave] = { quantidade: edicao.quantidade.trim(), observacao: edicao.observacao.trim() };
  }
  return base;
}

const TOM_CONFIANCA = {
  'Sem base': 'neutral',
  Baixa: 'danger',
  Média: 'warning',
  Boa: 'success',
};

function BadgeConfianca({ confianca }) {
  return <Badge tom={TOM_CONFIANCA[confianca] || 'neutral'}>{confianca}</Badge>;
}

// Resumo compacto de uma linha ("8 ocorrências · média vendida 209 ·
// tendência +11%") — só formatação de apresentação, a partir dos campos
// já calculados pelo motor (nenhum cálculo novo aqui).
function resumoCompacto(resultado) {
  if (resultado.quantidadeOcorrencias === 0) {
    return null;
  }

  const partes = [
    `${resultado.quantidadeOcorrencias} ${resultado.quantidadeOcorrencias === 1 ? 'ocorrência' : 'ocorrências'}`,
  ];

  if (resultado.mediaVendida != null) {
    partes.push(`média vendida ${resultado.mediaVendida}`);
  }
  if (resultado.tendenciaPct != null) {
    const sinal = resultado.tendenciaPct >= 0 ? '+' : '';
    partes.push(`tendência ${sinal}${Math.round(resultado.tendenciaPct * 100)}%`);
  }

  return partes.join(' · ');
}

function DetalhesSugestaoModal({ detalhe, corPrimaria, onFechar }) {
  const { slot, resultado } = detalhe;

  return (
    <Modal onFechar={onFechar} largura="sm" legado>
      <h3 style={{ color: corPrimaria, marginTop: 0 }}>
        Detalhes da sugestão — {slot.produtoNome} ({slot.turnoLabel})
      </h3>
      <p className={estilosPlan.detalheData}>
        {formatarDataExibicao(slot.data)} · {capitalizar(diaDaSemanaExibicao(slot.data))}
      </p>

      <div className={estilosPlan.detalheQuantidade}>
        {resultado.quantidadeSugerida != null && <strong>{resultado.quantidadeSugerida} un</strong>}
        <BadgeConfianca confianca={resultado.confianca} />
      </div>

      <p className={estilosPlan.detalheJustificativa}>{resultado.justificativa}</p>

      <div className={estilosPlan.detalheRodape}>
        <Button variante="secondary" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </Modal>
  );
}

function PlanejamentoConteudo() {
  const { permissoes } = useAuth();
  // planejamento_producao (migration 0016) é gated inteiramente por
  // planejamento.editar — não depende mais de producao.editar.
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PLANEJAMENTO_EDITAR);

  const hoje = dataLocalHoje();

  const [carregandoBase, setCarregandoBase] = useState(true);
  const [carregandoPeriodo, setCarregandoPeriodo] = useState(true);
  const [erro, setErro] = useState('');
  const [produtos, setProdutos] = useState([]);
  const [registrosHistorico, setRegistrosHistorico] = useState([]);
  const [diasFechados, setDiasFechados] = useState(new Set());
  const [feriados, setFeriados] = useState({});
  const [edicoes, setEdicoes] = useState({});
  // Último valor salvo (ou carregado) de cada slot -- SÓ para sinalizar
  // "alteração não salva"; `edicoes` continua sendo a única fonte dos valores.
  const [baseSalva, setBaseSalva] = useState({});
  const [erroLinha, setErroLinha] = useState({});
  const [salvandoChave, setSalvandoChave] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [detalheAberto, setDetalheAberto] = useState(null);

  const [filtroDataInicial, setFiltroDataInicial] = useState(hoje);
  const [filtroDataFinal, setFiltroDataFinal] = useState(() => domingoDaSemana(hoje));
  const [filtroGrupo, setFiltroGrupo] = useState('todos');
  const [filtroProduto, setFiltroProduto] = useState('todos');
  const [filtroTurno, setFiltroTurno] = useState('todos');
  const [pagina, setPagina] = useState(1);

  const aparencia = APARENCIA_FIXA;

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  // Efeito 1 — produtos controlados + histórico fechado: independentes do
  // período visível, carregados uma única vez na montagem.
  useEffect(() => {
    async function carregarBase() {
      setCarregandoBase(true);

      const supabase = createClient();

      // Unificação Catálogo x Produção: nome vem de produtos (identidade
      // mestre), nunca mais de receitas.nome. Defesa em profundidade:
      // produtos.ativo=true E receitas.ativo=true juntos.
      const produtosResp = await supabase
        .from('receitas')
        .select('id, grupo, produtos!inner(nome)')
        .eq('ativo', true)
        .eq('controlado_producao', true)
        .eq('produtos.ativo', true);

      if (produtosResp.error) {
        console.error('Erro ao carregar produtos controlados:', produtosResp.error);
        setErro('Não foi possível carregar os produtos de produção.');
        setCarregandoBase(false);
        return;
      }

      // Achata para {id, nome, grupo} -- mesma forma usada pelo restante
      // do arquivo antes da unificação. Ordenado no cliente (grupo, depois
      // nome) -- ordenar por coluna de relação embutida via
      // .order({foreignTable}) não tem precedente no projeto.
      const produtosAchatados = (produtosResp.data || [])
        .map((p) => ({ id: p.id, nome: p.produtos?.nome || '', grupo: p.grupo }))
        .sort((a, b) => {
          const grupoA = a.grupo || '';
          const grupoB = b.grupo || '';
          if (grupoA !== grupoB) return grupoA.localeCompare(grupoB, 'pt-BR', { sensitivity: 'base' });
          return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
        });

      const idsControlados = produtosAchatados.map((p) => p.id);

      const historicoResp =
        idsControlados.length > 0
          ? await supabase
              .from('producao_registros')
              .select(
                'id, data, turno, receita_id, status, quantidade_produzida, quantidade_vendida, sobra_total, sobra_aproveitavel, perda_descarte, houve_falta'
              )
              .eq('status', 'fechado')
              .in('receita_id', idsControlados)
          : { data: [], error: null };

      if (historicoResp.error) {
        console.error('Erro ao carregar histórico de produção:', historicoResp.error);
        setErro('Não foi possível carregar o histórico de produção.');
        setCarregandoBase(false);
        return;
      }

      setProdutos(produtosAchatados);
      setRegistrosHistorico(historicoResp.data || []);
      setCarregandoBase(false);
    }

    carregarBase();
  }, []);

  // "Limpar filtros" restaura os padrões da tela (hoje até o domingo da
  // semana corrente, demais em "todos") -- não zera as datas: sem período
  // a tela não mostra nada. Só mexe nos filtros; edições ainda não salvas
  // e o restante do estado não são tocados.
  const dataInicialPadrao = hoje;
  const dataFinalPadrao = domingoDaSemana(hoje);
  const filtrosAtivos =
    filtroDataInicial !== dataInicialPadrao ||
    filtroDataFinal !== dataFinalPadrao ||
    filtroGrupo !== 'todos' ||
    filtroProduto !== 'todos' ||
    filtroTurno !== 'todos';

  const quantidadeFiltrosAtivos = [
    filtroDataInicial !== dataInicialPadrao,
    filtroDataFinal !== dataFinalPadrao,
    filtroGrupo !== 'todos',
    filtroProduto !== 'todos',
    filtroTurno !== 'todos',
  ].filter(Boolean).length;

  function limparFiltros() {
    setFiltroDataInicial(dataInicialPadrao);
    setFiltroDataFinal(dataFinalPadrao);
    setFiltroGrupo('todos');
    setFiltroProduto('todos');
    setFiltroTurno('todos');
    setPagina(1);
  }

  // Qualquer mudança de filtro volta para a página 1.
  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  const periodoValido =
    filtroDataInicial !== '' && filtroDataFinal !== '' && filtroDataFinal >= filtroDataInicial;

  let erroPeriodo = '';
  if (filtroDataInicial === '') {
    erroPeriodo = 'Data inicial é obrigatória.';
  } else if (filtroDataFinal === '') {
    erroPeriodo = 'Data final é obrigatória.';
  } else if (filtroDataFinal < filtroDataInicial) {
    erroPeriodo = 'Data final não pode ser anterior à data inicial.';
  }

  // Efeito 2 — dias fechados, feriados e planejamento já salvo: dependem
  // do período escolhido, recarregados sempre que ele muda.
  useEffect(() => {
    if (!periodoValido) {
      setCarregandoPeriodo(false);
      return;
    }

    let efeitoAtivo = true;

    async function carregarPeriodo() {
      setCarregandoPeriodo(true);

      const supabase = createClient();

      const [diasResp, feriadosResp, planejamentoResp] = await Promise.all([
        supabase
          .from('producao_dias')
          .select('data, fechado, motivo_fechamento')
          .gte('data', filtroDataInicial)
          .lte('data', filtroDataFinal)
          .eq('fechado', true),
        supabase
          .from('feriados_nacionais')
          .select('data, nome')
          .gte('data', filtroDataInicial)
          .lte('data', filtroDataFinal),
        supabase
          .from('planejamento_producao')
          .select('id, data, turno, receita_id, quantidade_planejada, observacao')
          .gte('data', filtroDataInicial)
          .lte('data', filtroDataFinal),
      ]);

      if (!efeitoAtivo) {
        return;
      }

      const primeiroErro = diasResp.error || feriadosResp.error || planejamentoResp.error;
      if (primeiroErro) {
        console.error('Erro ao carregar dados do período de planejamento:', primeiroErro);
        setErro('Não foi possível carregar os dados do período selecionado.');
        setCarregandoPeriodo(false);
        return;
      }

      const mapaFeriados = {};
      for (const f of feriadosResp.data || []) {
        mapaFeriados[f.data] = f.nome;
      }

      const diasFechadosSet = new Set((diasResp.data || []).map((d) => d.data));

      const mapaEdicoes = {};
      for (const p of planejamentoResp.data || []) {
        mapaEdicoes[chaveSlot(p.data, p.turno, p.receita_id)] = {
          id: p.id,
          quantidade: p.quantidade_planejada != null ? String(p.quantidade_planejada) : '',
          observacao: p.observacao || '',
        };
      }

      setDiasFechados(diasFechadosSet);
      setFeriados(mapaFeriados);
      setEdicoes(mapaEdicoes);
      setBaseSalva(baseDeEdicoes(mapaEdicoes));
      setErroLinha({});
      setCarregandoPeriodo(false);
    }

    setErro('');
    carregarPeriodo();

    return () => {
      efeitoAtivo = false;
    };
  }, [filtroDataInicial, filtroDataFinal, periodoValido]);

  function atualizarEdicao(chave, campo, valor) {
    setEdicoes((atual) => ({
      ...atual,
      [chave]: { ...(atual[chave] || { id: null, quantidade: '', observacao: '' }), [campo]: valor },
    }));
    setErroLinha((atual) => {
      if (!atual[chave]) return atual;
      const { [chave]: _remover, ...resto } = atual;
      return resto;
    });
  }

  function aceitarSugestao(chave, quantidadeSugerida) {
    atualizarEdicao(chave, 'quantidade', String(quantidadeSugerida));
  }

  async function salvarSlot(slot) {
    const chave = chaveSlot(slot.data, slot.turno, slot.receitaId);
    const edicao = edicoes[chave] || { id: null, quantidade: '', observacao: '' };

    const quantidadeTexto = edicao.quantidade.trim();
    const observacaoTexto = edicao.observacao.trim();

    if (quantidadeTexto === '' && observacaoTexto === '') {
      setErroLinha((atual) => ({
        ...atual,
        [chave]: 'Informe uma quantidade planejada ou uma observação.',
      }));
      return;
    }

    let quantidadePlanejada = null;
    if (quantidadeTexto !== '') {
      const numero = parseInt(quantidadeTexto, 10);
      if (!Number.isInteger(numero) || numero < 0) {
        setErroLinha((atual) => ({
          ...atual,
          [chave]: 'Quantidade planejada deve ser um número inteiro maior ou igual a zero.',
        }));
        return;
      }
      quantidadePlanejada = numero;
    }

    setSalvandoChave(chave);
    setErroLinha((atual) => {
      if (!atual[chave]) return atual;
      const { [chave]: _remover, ...resto } = atual;
      return resto;
    });

    const supabase = createClient();
    const { data, error } = await supabase
      .from('planejamento_producao')
      .upsert(
        {
          data: slot.data,
          turno: slot.turno,
          receita_id: slot.receitaId,
          quantidade_planejada: quantidadePlanejada,
          observacao: observacaoTexto || null,
        },
        { onConflict: 'data,turno,receita_id' }
      )
      .select('id')
      .single();

    setSalvandoChave(null);

    if (error) {
      console.error('Erro ao salvar planejamento:', error);
      setErroLinha((atual) => ({
        ...atual,
        [chave]: 'Não foi possível salvar. Tente novamente ou avise um administrador.',
      }));
      return;
    }

    setEdicoes((atual) => ({
      ...atual,
      [chave]: { ...atual[chave], id: data?.id ?? atual[chave]?.id ?? null },
    }));
    setBaseSalva((atual) => ({ ...atual, [chave]: { quantidade: quantidadeTexto, observacao: observacaoTexto } }));
    setMensagemSucesso('Planejamento salvo.');
  }

  const gruposDisponiveis = Array.from(
    new Set(produtos.map((p) => p.grupo).filter((g) => g != null && g !== ''))
  ).sort();

  const produtosFiltrados = produtos.filter((p) => {
    if (filtroGrupo !== 'todos' && p.grupo !== filtroGrupo) return false;
    if (filtroProduto !== 'todos' && p.id !== filtroProduto) return false;
    return true;
  });

  const datasHorizonte = periodoValido ? listaDatasEntre(filtroDataInicial, filtroDataFinal) : [];

  const registrosPorReceita = {};
  for (const r of registrosHistorico) {
    if (!registrosPorReceita[r.receita_id]) {
      registrosPorReceita[r.receita_id] = [];
    }
    registrosPorReceita[r.receita_id].push(r);
  }

  const turnosFiltrados = filtroTurno === 'todos' ? TURNOS : TURNOS.filter((t) => t.chave === filtroTurno);

  const slots = [];
  for (const data of datasHorizonte) {
    for (const turno of turnosFiltrados) {
      for (const produto of produtosFiltrados) {
        slots.push({
          data,
          turno: turno.chave,
          turnoLabel: turno.label,
          receitaId: produto.id,
          produtoNome: produto.nome,
          grupo: produto.grupo,
        });
      }
    }
  }

  // Paginação VISUAL (client-side, 20 linhas por página): `slots` são
  // linhas calculadas (data x turno x produto), não registros do banco, e
  // as edições não salvas vivem em `edicoes` (chave do slot), fora da
  // linha renderizada -- trocar de página só muda quais linhas aparecem;
  // nada é recalculado, perdido nem salvo. Sugestões continuam sendo
  // calculadas sobre o histórico inteiro em memória.
  const paginacao = paginarLista(slots, pagina);
  const paginaAtual = paginacao.paginaAtual;

  // Total encolheu (filtro/período/recarga): corrige a página guardada.
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  const carregando = carregandoBase || carregandoPeriodo;

  // Alteração ainda não salva: o que está digitado difere do último valor
  // salvo/carregado. Vale para todos os slots do período (inclusive os de
  // outras páginas ou fora do filtro atual).
  function edicaoPendente(chave) {
    const edicao = edicoes[chave];
    if (!edicao) return false;
    const base = baseSalva[chave] || { quantidade: '', observacao: '' };
    return edicao.quantidade.trim() !== base.quantidade || edicao.observacao.trim() !== base.observacao;
  }
  const totalPendentes = Object.keys(edicoes).filter(edicaoPendente).length;

  const colunas = [
    {
      chave: 'data',
      rotulo: 'Data',
      semQuebra: true,
      mobile: 'oculta',
      minLargura: 110,
      render: (slot) => (
        <>
          {formatarDataExibicao(slot.data)}
          {feriados[slot.data] && (
            <span
              className={estilosPlan.feriado}
              title={`Feriado: ${feriados[slot.data]}`}
              role="img"
              aria-label={`Feriado: ${feriados[slot.data]}`}
            >
              <Icon nome="gift" tamanho={16} />
            </span>
          )}
        </>
      ),
    },
    { chave: 'dia', rotulo: 'Dia da semana', semQuebra: true, mobile: 'oculta', render: (slot) => capitalizar(diaDaSemanaExibicao(slot.data)) },
    { chave: 'grupo', rotulo: 'Grupo', render: (slot) => slot.grupo || '—' },
    { chave: 'produto', rotulo: 'Produto', mobile: 'titulo', cartaoOrdem: 0, minLargura: 150, render: (slot) => slot.produtoNome },
    { chave: 'turno', rotulo: 'Turno', mobile: 'titulo', cartaoOrdem: 1, render: (slot) => <Badge tom="neutral">{slot.turnoLabel}</Badge> },
    {
      chave: 'sugestao',
      rotulo: 'Sugestão',
      render: (slot) => {
        if (diasFechados.has(slot.data)) {
          return <span className={estilosPlan.diaFechado}>Dia fechado — sem sugestão operacional.</span>;
        }
        const resultado = calcularSugestaoProducao({
          registros: registrosPorReceita[slot.receitaId] || [],
          dataAlvo: slot.data,
          turno: slot.turno,
          diasFechados,
        });
        const resumo = resumoCompacto(resultado);
        return (
          <div className={estilosPlan.sugestao}>
            <div className={estilosPlan.sugestaoLinha}>
              {resultado.quantidadeSugerida != null ? (
                <strong>{resultado.quantidadeSugerida} un</strong>
              ) : (
                <span className={estilosPlan.semSugestao}>Sem sugestão</span>
              )}
              <BadgeConfianca confianca={resultado.confianca} />
              <button
                type="button"
                className={estilosPlan.detalhes}
                onClick={() => setDetalheAberto({ slot, resultado })}
                title="Ver justificativa completa"
              >
                <Icon nome="info" tamanho={16} />
                Detalhes
              </button>
            </div>
            {resumo && <p className={estilosPlan.resumoSugestao}>{resumo}</p>}
          </div>
        );
      },
    },
    {
      chave: 'quantidade',
      rotulo: 'Quantidade planejada',
      render: (slot) => {
        const chave = chaveSlot(slot.data, slot.turno, slot.receitaId);
        const edicao = edicoes[chave] || { id: null, quantidade: '', observacao: '' };
        return (
          <Input
            type="number"
            min="0"
            className={estilosPlan.campoQuantidade}
            aria-label={`Quantidade planejada — ${slot.produtoNome}, ${formatarDataExibicao(slot.data)}, ${slot.turnoLabel}`}
            value={edicao.quantidade}
            disabled={diasFechados.has(slot.data) || !podeEditar}
            onChange={(e) => atualizarEdicao(chave, 'quantidade', e.target.value)}
          />
        );
      },
    },
    {
      chave: 'observacao',
      rotulo: 'Observação',
      render: (slot) => {
        const chave = chaveSlot(slot.data, slot.turno, slot.receitaId);
        const edicao = edicoes[chave] || { id: null, quantidade: '', observacao: '' };
        return (
          <Input
            type="text"
            className={estilosPlan.campoObservacao}
            aria-label={`Observação — ${slot.produtoNome}, ${formatarDataExibicao(slot.data)}, ${slot.turnoLabel}`}
            value={edicao.observacao}
            disabled={diasFechados.has(slot.data) || !podeEditar}
            onChange={(e) => atualizarEdicao(chave, 'observacao', e.target.value)}
          />
        );
      },
    },
  ];

  function renderAcoes(slot, { cartao }) {
    const chave = chaveSlot(slot.data, slot.turno, slot.receitaId);
    const fechado = diasFechados.has(slot.data);
    const pendente = edicaoPendente(chave);
    let quantidadeSugerida = null;
    if (!fechado && podeEditar) {
      quantidadeSugerida = calcularSugestaoProducao({
        registros: registrosPorReceita[slot.receitaId] || [],
        dataAlvo: slot.data,
        turno: slot.turno,
        diasFechados,
      }).quantidadeSugerida;
    }
    const tamanho = cartao ? 'md' : 'sm';

    return (
      <div className={estilosPlan.acoes}>
        {pendente && <Badge tom="warning">Alteração não salva</Badge>}
        <div className={estilosPlan.botoes}>
          {!fechado && podeEditar && quantidadeSugerida != null && (
            <Button variante="secondary" tamanho={tamanho} onClick={() => aceitarSugestao(chave, quantidadeSugerida)}>
              Aceitar sugestão
            </Button>
          )}
          {!fechado && podeEditar && (
            <Button tamanho={tamanho} onClick={() => salvarSlot(slot)} disabled={salvandoChave === chave}>
              {salvandoChave === chave ? 'Salvando...' : 'Salvar'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <PaginaProducao
      ativo="planejamento"
      titulo="Planejamento"
      subtitulo="Sugestão calculada a partir do histórico fechado — nunca gravada automaticamente. Só vira Planejamento de verdade quando você clicar em Salvar."
    >
      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Data inicial">
          <Input type="date" value={filtroDataInicial} onChange={(e) => alterarFiltro(setFiltroDataInicial)(e.target.value)} />
        </Field>
        <Field label="Data final">
          <Input type="date" value={filtroDataFinal} onChange={(e) => alterarFiltro(setFiltroDataFinal)(e.target.value)} />
        </Field>
        <Field label="Grupo">
          <Select value={filtroGrupo} onChange={(e) => alterarFiltro(setFiltroGrupo)(e.target.value)}>
            <option value="todos">Todos</option>
            {gruposDisponiveis.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Produto">
          <Select value={filtroProduto} onChange={(e) => alterarFiltro(setFiltroProduto)(e.target.value)}>
            <option value="todos">Todos</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Turno">
          <Select value={filtroTurno} onChange={(e) => alterarFiltro(setFiltroTurno)(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="manha">Manhã</option>
            <option value="tarde">Tarde</option>
          </Select>
        </Field>
      </FilterBar>

      {erroPeriodo && <Alert tom="danger" className={estilos.mensagem}>{erroPeriodo}</Alert>}

      {totalPendentes > 0 && (
        <Alert tom="warning" className={estilos.mensagem}>
          {totalPendentes === 1
            ? '1 alteração ainda não salva neste período.'
            : `${totalPendentes} alterações ainda não salvas neste período.`}{' '}
          Use "Salvar" em cada linha; trocar de página não descarta o que foi digitado.
        </Alert>
      )}

      {!periodoValido ? (
        <p className={estilosPlan.periodoInvalido}>Selecione um período válido para ver o planejamento.</p>
      ) : carregando ? (
        <p role="status">Carregando planejamento...</p>
      ) : produtosFiltrados.length === 0 ? (
        <EmptyState>Nenhum produto ativo e marcado para exibir na Tela Hoje foi encontrado.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Planejamento de produção"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(slot) => chaveSlot(slot.data, slot.turno, slot.receitaId)}
            destaque={(slot) =>
              diasFechados.has(slot.data) ? 'inativo' : edicaoPendente(chaveSlot(slot.data, slot.turno, slot.receitaId)) ? 'aviso' : null
            }
            linhaExtra={(slot) => {
              const mensagem = erroLinha[chaveSlot(slot.data, slot.turno, slot.receitaId)];
              return mensagem ? <Alert tom="danger">{mensagem}</Alert> : null;
            }}
            grupo={{
              chave: (slot) => slot.data,
              rotulo: (slot) =>
                `${capitalizar(diaDaSemanaExibicao(slot.data))}, ${formatarDataExibicao(slot.data)}${
                  feriados[slot.data] ? ` · Feriado: ${feriados[slot.data]}` : ''
                }${diasFechados.has(slot.data) ? ' · Dia fechado' : ''}`,
            }}
            cartoesAte={1439}
            denso
            renderAcoes={renderAcoes}
          />

          {paginacao.total > 0 && (
            <>
              <p className={estilos.resumo}>
                Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}{' '}
                {paginacao.total === 1 ? 'linha' : 'linhas'}
                {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
              </p>
              <Paginacao
                paginaAtual={paginaAtual}
                totalPaginas={paginacao.totalPaginas}
                onMudarPagina={setPagina}
                corPrimaria={aparencia.corPrimaria}
              />
            </>
          )}
        </div>
      )}

      {detalheAberto && (
        <DetalhesSugestaoModal
          detalhe={detalheAberto}
          corPrimaria={aparencia.corPrimaria}
          onFechar={() => setDetalheAberto(null)}
        />
      )}
    </PaginaProducao>
  );
}

export default function Planejamento() {
  return (
    <RequireAuth permissao={PERMISSOES.PLANEJAMENTO_VISUALIZAR}>
      <PlanejamentoConteudo />
    </RequireAuth>
  );
}
