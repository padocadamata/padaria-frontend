import { useEffect, useMemo, useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import IndicadorVinculo from './IndicadorVinculo';
import PagamentoDetalheModal from './PagamentoDetalheModal';
import Paginacao, { paginarLista } from '../Paginacao';
import { buscarHistoricoPagamentos, formatarMoeda, formatarCompetencia, rotuloNaturezaPagamento } from '../../lib/funcionarios/pagamentos';
import { rotuloTipoLancamento, centavos } from '../../lib/funcionarios/pagamentosCalculo';
import { OPCOES_VINCULO } from '../../lib/funcionarios/vinculo';
import estilosPagamentos from './pagamentos.module.css';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';
import { useFiltrosPersistidos, useSanearFiltros } from '../../lib/filtros/useFiltrosPersistidos';
import { FILTROS_PAGAMENTOS_PAGOS, regrasSaneamentoPagamentosPagos } from '../../lib/filtros/telas';
import { ordenarOpcoes } from '../../lib/ordenacao/opcoes';
import { useMediaQuery } from '../../lib/design/useMediaQuery';
import { PAGAMENTOS_CARTOES_ATE } from './PagamentosAPagarVisao';

// Ordem dos campos no CARTÃO (celular/tablet pequeno): pessoa e status no
// topo; depois data, líquido, forma, vínculo, bruto e descontos. A tabela
// do desktop mantém a ordem das colunas.
const ORDEM_CARTAO = ['funcionario', 'status', 'data_efetiva', 'liquido', 'natureza', 'vinculo', 'bruto', 'descontos'];

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Histórico de pagamentos (confirmados e cancelados). Filtros: período
// (data efetiva), pessoa, vínculo e forma de remuneração -- os dois últimos
// pelo SNAPSHOT do pagamento, nunca pelo cadastro atual -- e status.
// podeCancelar controla só a AÇÃO dentro do detalhe. Filtros e ordenação
// persistidos durante a sessão de login (lib/filtros); funcionariosProntos
// = lista de pessoas carregada sem erro (só então uma pessoa salva que não
// existe mais volta a "Todas").
export default function PagamentosPagosVisao({ funcionarios, funcionariosProntos = false, podeCancelar }) {
  const filtros = useFiltrosPersistidos('pagamentos.pagos', FILTROS_PAGAMENTOS_PAGOS);
  const { definir: definirFiltro } = filtros;
  const { funcionarioId, status, tipoVinculo, natureza, dataInicio, dataFim } = useSanearFiltros(
    filtros,
    regrasSaneamentoPagamentosPagos({ funcionariosProntos, funcionarios })
  );
  const [pagamentos, setPagamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState(null);
  // Paginação no navegador, mesmo padrão de Funcionários/Clientes (20 por
  // página, paginarLista + Paginacao): filtro ou ordenação novos voltam à
  // página 1; os totais acima continuam sendo do filtro INTEIRO.
  const [pagina, setPagina] = useState(1);
  // Ordenação do cabeçalho, guardada durante a sessão de login.
  const ordenacao = useOrdenacao({ aoMudar: () => setPagina(1), persistirEm: 'pagamentos.pagos' });
  const cartoes = useMediaQuery(`(max-width: ${PAGAMENTOS_CARTOES_ATE}px)`);

  async function carregar() {
    setCarregando(true);
    const dados = await buscarHistoricoPagamentos({
      dataInicio: dataInicio || undefined,
      dataFim: dataFim || undefined,
      funcionarioId: funcionarioId || undefined,
      status: status || undefined,
      tipoVinculo: tipoVinculo || undefined,
      natureza: natureza || undefined,
    });
    setPagamentos(dados);
    setCarregando(false);
  }

  useEffect(() => {
    setPagina(1);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionarioId, status, tipoVinculo, natureza, dataInicio, dataFim]);

  function aoCancelar() {
    setDetalhe(null);
    carregar();
  }

  // Totais só dos CONFIRMADOS (cancelado nunca soma).
  const totais = useMemo(() => {
    const ativos = pagamentos.filter((p) => p.status === 'confirmado');
    const soma = (campo) => ativos.reduce((s, p) => s + centavos(p[campo]), 0) / 100;
    return {
      quantidade: ativos.length,
      bruto: soma('valor_bruto'),
      acrescimos: soma('total_acrescimos'),
      descontos: soma('total_descontos'),
      liquido: soma('valor_liquido'),
    };
  }, [pagamentos]);
  // Migration 0076: coluna Acréscimos só quando algum pagamento do filtro tem
  // acréscimo (líquido = bruto + acréscimos − descontos). Sem a 0076 no banco,
  // total_acrescimos não vem e conta como 0.
  const temAcrescimos = pagamentos.some((p) => Number(p.total_acrescimos || 0) > 0);

  const colunas = [
    { chave: 'data_efetiva', rotulo: 'Data efetiva', ordenavel: { tipo: 'data', valor: (p) => p.data_efetiva }, render: (p) => formatarDataExibicao(p.data_efetiva) },
    { chave: 'funcionario', rotulo: 'Pessoa', mobile: 'titulo', cartaoOrdem: 0, ordenavel: { valor: (p) => p.funcionarios?.nome }, render: (p) => p.funcionarios?.nome || '—' },
    {
      chave: 'vinculo',
      rotulo: 'Vínculo',
      ordenavel: { valor: (p) => p.tipo_vinculo_snapshot, ordem: OPCOES_VINCULO.map((o) => o.valor) },
      render: (p) => <IndicadorVinculo tipoVinculo={p.tipo_vinculo_snapshot} />,
    },
    {
      chave: 'natureza',
      rotulo: 'Forma',
      // Mesma ordem do filtro "Forma": Por hora, Mensal, Regularização.
      ordenavel: { valor: (p) => p.natureza, ordem: ['por_hora', 'mensal', 'regularizacao_historica'] },
      render: (p) =>
        p.natureza === 'mensal' ? `Mensal ${formatarCompetencia(p.competencia)} · ${rotuloTipoLancamento(p.tipo_lancamento)}` : rotuloNaturezaPagamento(p.natureza),
    },
    { chave: 'bruto', rotulo: 'Bruto', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (p) => p.valor_bruto }, render: (p) => formatarMoeda(p.valor_bruto) },
    temAcrescimos && {
      chave: 'acrescimos',
      rotulo: 'Acréscimos',
      alinhar: 'direita',
      ordenavel: { tipo: 'moeda', valor: (p) => p.total_acrescimos || 0 },
      render: (p) => formatarMoeda(p.total_acrescimos || 0),
    },
    { chave: 'descontos', rotulo: 'Descontos', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (p) => p.total_descontos }, render: (p) => formatarMoeda(p.total_descontos) },
    { chave: 'liquido', rotulo: 'Líquido', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (p) => p.valor_liquido }, render: (p) => formatarMoeda(p.valor_liquido) },
    {
      chave: 'status',
      rotulo: 'Status',
      mobile: 'titulo',
      cartaoOrdem: 1,
      ordenavel: { valor: (p) => p.status, ordem: ['confirmado', 'cancelado'] },
      render: (p) => <Badge tom={p.status === 'cancelado' ? 'danger' : 'success'}>{p.status === 'cancelado' ? 'Cancelado' : 'Confirmado'}</Badge>,
    },
  ].filter(Boolean);
  const ordemCartao = temAcrescimos ? ORDEM_CARTAO.flatMap((c) => (c === 'bruto' ? ['bruto', 'acrescimos'] : [c])) : ORDEM_CARTAO;
  const colunasExibidas = cartoes ? ordemCartao.map((chave) => colunas.find((c) => c.chave === chave)) : colunas;

  // Ordena o conjunto filtrado INTEIRO e só depois fatia a página. Se a
  // lista encolher (cancelamento, recarga), paginarLista cai na última
  // página válida e o estado acompanha.
  const paginacao = paginarLista(ordenacao.ordenar(pagamentos, colunas), pagina);
  const paginaAtual = paginacao.paginaAtual;

  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  return (
    <>
      <div className={estilosPagamentos.controlesFiltro}>
        <Field label="Data efetiva — de" className={estilosPagamentos.filtroData}>
          <Input type="date" value={dataInicio} onChange={(e) => definirFiltro('dataInicio', e.target.value)} />
        </Field>
        <Field label="até" className={estilosPagamentos.filtroData}>
          <Input type="date" value={dataFim} onChange={(e) => definirFiltro('dataFim', e.target.value)} />
        </Field>
        <Field label="Pessoa">
          <Select value={funcionarioId} onChange={(e) => definirFiltro('funcionarioId', e.target.value)}>
            <option value="">Todas</option>
            {ordenarOpcoes(funcionarios).map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.ativo === false ? ' (inativo)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vínculo">
          <Select value={tipoVinculo} onChange={(e) => definirFiltro('tipoVinculo', e.target.value)}>
            <option value="">Todos</option>
            {OPCOES_VINCULO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forma">
          <Select value={natureza} onChange={(e) => definirFiltro('natureza', e.target.value)}>
            <option value="">Todas</option>
            <option value="por_hora">Por hora</option>
            <option value="mensal">Mensal</option>
            <option value="regularizacao_historica">Regularização histórica</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => definirFiltro('status', e.target.value)}>
            <option value="">Todos</option>
            <option value="confirmado">Confirmado</option>
            <option value="cancelado">Cancelado</option>
          </Select>
        </Field>
      </div>

      {carregando ? (
        <p role="status">Carregando...</p>
      ) : pagamentos.length === 0 ? (
        <p className={estilosPagamentos.vazio}>Nenhum pagamento encontrado para este filtro.</p>
      ) : (
        <>
          <div className={`${estilosPagamentos.resumoLinha} ${estilosPagamentos.resumoPagos}`}>
            <span>{totais.quantidade} confirmado(s) no filtro</span>
            <span>
              Bruto {formatarMoeda(totais.bruto)}
              {totais.acrescimos > 0 ? ` · Acréscimos ${formatarMoeda(totais.acrescimos)}` : ''} · Descontos {formatarMoeda(totais.descontos)} ·{' '}
              <strong>Líquido {formatarMoeda(totais.liquido)}</strong>
            </span>
          </div>
          <DataTable
            rotulo="Pagamentos"
            colunas={colunasExibidas}
            linhas={paginacao.itens}
            chaveLinha={(p) => p.id}
            ordenacao={ordenacao.props}
            cartoesAte={PAGAMENTOS_CARTOES_ATE}
            destaque={(p) => (p.status === 'cancelado' ? 'inativo' : undefined)}
            renderAcoes={(p) => (
              <Button variante="secondary" tamanho="sm" onClick={() => setDetalhe(p)}>
                Detalhes
              </Button>
            )}
          />
          <p className={estilosPagamentos.resumoPaginacao}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total} {paginacao.total === 1 ? 'pagamento' : 'pagamentos'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </>
      )}

      {detalhe && <PagamentoDetalheModal pagamento={detalhe} podeCancelar={podeCancelar} onFechar={() => setDetalhe(null)} onCancelado={aoCancelar} />}
    </>
  );
}
