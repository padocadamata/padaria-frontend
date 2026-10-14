import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import Field from '../../components/ui/Field';
import FilterBar from '../../components/ui/FilterBar';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import FinanceiroSubNav from '../../components/financeiro/FinanceiroSubNav';
import ContaDetalheModal from '../../components/financeiro/ContaDetalheModal';
import PagarParcelaModal from '../../components/financeiro/PagarParcelaModal';
import LancarFinanceiroModal from '../../components/financeiro/LancarFinanceiroModal';
import DespesaModal from '../../components/financeiro/DespesaModal';
import CategoriasDespesaModal from '../../components/financeiro/CategoriasDespesaModal';
import { descreverOrigem, formatarData } from '../../components/financeiro/formatacao';
import estilos from '../../components/financeiro/financeiro.module.css';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { useAuth } from '../../hooks/useAuth';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';
import { ordenarOpcoes } from '../../lib/ordenacao/opcoes';
import { dataLocalHoje, inicioDoMes } from '../../lib/data/dataLocal';
import {
  FORMAS_PAGAMENTO, GRUPOS_A_PAGAR, centavos, classificarParcela, deCentavos, formatarReais, rotuloForma, totalizarAPagar,
} from '../../lib/financeiro/contasPagarRegras';
import { buscarCategorias, buscarComprasSemLancamento, buscarFornecedoresAtivos, buscarParcelas } from '../../lib/financeiro/contasPagar';

// Financeiro > Contas a Pagar (migration 0073). Três visões na mesma rota
// (padrão de Folha > Pagamentos): A Pagar (agrupada em Vencidas / Vence
// hoje / Próximos 7 dias / Depois), Pagas e Compras sem lançamento.
// Compras e despesas manuais aparecem juntas nas mesmas visões. "Vencida"
// e os demais grupos são derivados aqui com o "hoje" de São Paulo -- o banco
// não grava esse estado. Toda escrita passa pelas RPCs (componentes de
// components/financeiro/).

const VISOES = [
  { chave: 'a_pagar', rotulo: 'A Pagar' },
  { chave: 'pagas', rotulo: 'Pagas' },
  { chave: 'sem_lancamento', rotulo: 'Compras sem lançamento' },
];

const FILTROS_VAZIOS = { credor: '', origem: '', forma: '', grupo: '', categoria: '', de: '', ate: '' };

function CredorCelula({ linha }) {
  return (
    <span className={estilos.credor}>
      <strong>{linha.credor_exibicao || '—'}</strong>
      <span className={estilos.sub}>
        {descreverOrigem(linha)}
        {linha.origem === 'manual' && linha.descricao ? ` · ${linha.descricao}` : ''}
      </span>
    </span>
  );
}

function ContasPagarConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.CONTAS_PAGAR_EDITAR);
  const podePagar = hasPermissao(permissoes, PERMISSOES.CONTAS_PAGAR_PAGAR);
  const hoje = dataLocalHoje();

  const [visao, setVisao] = useState('a_pagar');
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [pagoDe, setPagoDe] = useState(inicioDoMes(hoje));
  const [pagoAte, setPagoAte] = useState(hoje);
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [tick, setTick] = useState(0);
  const [mensagem, setMensagem] = useState('');

  const [categorias, setCategorias] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);

  const [contaAberta, setContaAberta] = useState(null);
  const [pagando, setPagando] = useState(null);
  const [lancando, setLancando] = useState(null);
  const [novaDespesa, setNovaDespesa] = useState(false);
  const [gerenciarCategorias, setGerenciarCategorias] = useState(false);
  // Ordenação do cabeçalho: estado local, UM por visão (cada aba guarda a
  // sua escolha enquanto a tela estiver aberta; nunca salvo). Em "A Pagar"
  // a mesma escolha vale dentro de cada grupo de situação.
  const ordenacaoAPagar = useOrdenacao();
  const ordenacaoPagas = useOrdenacao();
  const ordenacaoSemLancamento = useOrdenacao();

  // ?conta=<id> abre o detalhe (link vindo do detalhe da compra).
  useEffect(() => {
    if (router.isReady && typeof router.query.conta === 'string') setContaAberta(router.query.conta);
  }, [router.isReady, router.query.conta]);

  useEffect(() => {
    let ativo = true;
    Promise.all([buscarCategorias(), buscarFornecedoresAtivos()]).then(([cats, forns]) => {
      if (!ativo) return;
      setCategorias(cats.dados);
      setFornecedores(forns);
    });
    return () => {
      ativo = false;
    };
  }, [tick]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      const r =
        visao === 'a_pagar'
          ? await buscarParcelas({ situacao: 'pendente' })
          : visao === 'pagas'
            ? await buscarParcelas({ situacao: 'paga', pagoDe: pagoDe || undefined, pagoAte: pagoAte || undefined })
            : await buscarComprasSemLancamento();
      if (!ativo) return;
      setLinhas(r.dados);
      setErro(r.erro);
      setCarregando(false);
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [visao, pagoDe, pagoAte, tick]);

  function trocarVisao(nova) {
    setVisao(nova);
    setFiltros(FILTROS_VAZIOS);
    setMensagem('');
  }

  function recarregar(texto) {
    if (texto) setMensagem(texto);
    setTick((t) => t + 1);
  }

  function fecharConta() {
    setContaAberta(null);
    if (router.query.conta) router.replace('/financeiro/contas-pagar', undefined, { shallow: true });
  }

  const alterarFiltro = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));
  const filtrosAtivos = Object.values(filtros).filter(Boolean).length;

  const credores = useMemo(
    () => ordenarOpcoes(Array.from(new Set(linhas.map((l) => l.credor_exibicao || l.fornecedor_nome).filter(Boolean)))),
    [linhas]
  );

  const filtradas = useMemo(() => {
    if (visao === 'sem_lancamento') {
      return linhas.filter((l) => (!filtros.credor || l.fornecedor_nome === filtros.credor)
        && (!filtros.de || l.data_compra >= filtros.de) && (!filtros.ate || l.data_compra <= filtros.ate));
    }
    return linhas.filter((l) => {
      if (filtros.credor && l.credor_exibicao !== filtros.credor) return false;
      if (filtros.origem && l.origem !== filtros.origem) return false;
      if (filtros.categoria && l.categoria_id !== filtros.categoria) return false;
      if (filtros.forma && (visao === 'pagas' ? l.forma_pagamento : l.forma_prevista) !== filtros.forma) return false;
      if (visao === 'a_pagar') {
        if (filtros.grupo && classificarParcela(l, hoje) !== filtros.grupo) return false;
        if (filtros.de && l.vencimento < filtros.de) return false;
        if (filtros.ate && l.vencimento > filtros.ate) return false;
      }
      return true;
    });
  }, [linhas, filtros, visao, hoje]);

  const totais = useMemo(() => {
    if (visao === 'a_pagar') return totalizarAPagar(filtradas, hoje);
    if (visao === 'pagas') {
      const soma = (campo) => deCentavos(filtradas.reduce((s, l) => s + centavos(l[campo]), 0));
      return { pago: soma('valor_pago'), acrescimos: deCentavos(centavos(soma('juros')) + centavos(soma('multa'))), descontos: soma('desconto'), quantidade: filtradas.length };
    }
    return { quantidade: filtradas.length, total: deCentavos(filtradas.reduce((s, l) => s + centavos(l.total), 0)) };
  }, [visao, filtradas, hoje]);

  const colunasAPagar = [
    { chave: 'vencimento', rotulo: 'Vencimento', semQuebra: true, ordenavel: { tipo: 'data', valor: (l) => l.vencimento }, render: (l) => formatarData(l.vencimento) },
    { chave: 'credor', rotulo: 'Fornecedor / credor', mobile: 'titulo', ordenavel: { valor: (l) => l.credor_exibicao }, render: (l) => <CredorCelula linha={l} /> },
    { chave: 'parcela', rotulo: 'Parcela', ordenavel: { tipo: 'numero', valor: (l) => l.numero }, render: (l) => `${l.numero}/${l.total_parcelas}` },
    { chave: 'forma', rotulo: 'Forma prevista', ordenavel: { valor: (l) => rotuloForma(l.forma_prevista) }, render: (l) => rotuloForma(l.forma_prevista) },
    { chave: 'valor', rotulo: 'Valor', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (l) => l.valor }, render: (l) => <strong>{formatarReais(l.valor)}</strong> },
  ];

  const acrescimos = (l) => deCentavos(centavos(l.juros) + centavos(l.multa));
  const colunasPagas = [
    { chave: 'pago_em', rotulo: 'Pago em', semQuebra: true, ordenavel: { tipo: 'data', valor: (l) => l.pago_em }, render: (l) => formatarData(l.pago_em) },
    { chave: 'credor', rotulo: 'Fornecedor / credor', mobile: 'titulo', ordenavel: { valor: (l) => l.credor_exibicao }, render: (l) => <CredorCelula linha={l} /> },
    { chave: 'parcela', rotulo: 'Parcela', ordenavel: { tipo: 'numero', valor: (l) => l.numero }, render: (l) => `${l.numero}/${l.total_parcelas}${l.condicao === 'no_ato' ? ' · no ato' : ''}` },
    { chave: 'forma', rotulo: 'Forma', ordenavel: { valor: (l) => rotuloForma(l.forma_pagamento) }, render: (l) => rotuloForma(l.forma_pagamento) },
    { chave: 'original', rotulo: 'Original', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (l) => l.valor }, render: (l) => formatarReais(l.valor) },
    { chave: 'acrescimos', rotulo: 'Juros + multa', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: acrescimos }, render: (l) => formatarReais(acrescimos(l)) },
    { chave: 'desconto', rotulo: 'Desconto', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (l) => l.desconto }, render: (l) => formatarReais(l.desconto) },
    { chave: 'pago', rotulo: 'Pago', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (l) => l.valor_pago }, render: (l) => <strong>{formatarReais(l.valor_pago)}</strong> },
  ];

  const colunasSemLancamento = [
    { chave: 'data', rotulo: 'Data da compra', semQuebra: true, ordenavel: { tipo: 'data', valor: (l) => l.data_compra }, render: (l) => formatarData(l.data_compra) },
    { chave: 'fornecedor', rotulo: 'Fornecedor', mobile: 'titulo', ordenavel: { valor: (l) => l.fornecedor_nome }, render: (l) => <strong>{l.fornecedor_nome}</strong> },
    {
      chave: 'modalidade',
      rotulo: 'Modalidade',
      ordenavel: { valor: (l) => l.modalidade_compra, ordem: ['pedido_com_entrega', 'compra_presencial'] },
      render: (l) => (l.modalidade_compra === 'compra_presencial' ? 'Retirada' : 'Entrega'),
    },
    { chave: 'nf', rotulo: 'Nota fiscal', ordenavel: { valor: (l) => l.numero_nota_fiscal }, render: (l) => l.numero_nota_fiscal || '—' },
    { chave: 'total', rotulo: 'Total', alinhar: 'direita', ordenavel: { tipo: 'moeda', valor: (l) => l.total }, render: (l) => <strong>{formatarReais(l.total)}</strong> },
  ];

  const acoesParcela = (l) => (
    <div className={estilos.acoes}>
      {visao === 'a_pagar' && podePagar && <Button tamanho="sm" onClick={() => setPagando(l)}>Pagar</Button>}
      <Button tamanho="sm" variante="secondary" onClick={() => setContaAberta(l.conta_id)}>Detalhes</Button>
    </div>
  );

  const acoesCompra = (l) => (
    <div className={estilos.acoes}>
      {podeEditar && <Button tamanho="sm" onClick={() => setLancando(l)}>Lançar financeiro</Button>}
      <Button tamanho="sm" variante="secondary" href={`/pedidos?id=${l.pedido_id}`}>Abrir compra</Button>
    </div>
  );

  const total = (rotulo, valor, perigo = false) => (
    <div className={`${estilos.total} ${perigo ? estilos.totalPerigo : ''}`}>
      <span className={estilos.totalRotulo}>{rotulo}</span>
      <span className={estilos.totalValor}>{valor}</span>
    </div>
  );

  return (
    <PageShell titulo="Financeiro">
      <FinanceiroSubNav ativo="contas-pagar" />
      <PageHeader
        titulo="Contas a Pagar"
        acoes={
          <div className={estilos.navegacaoVisoes}>
            {VISOES.map((v) => (
              <Button key={v.chave} tamanho="sm" variante={visao === v.chave ? 'primary' : 'secondary'} aria-pressed={visao === v.chave} onClick={() => trocarVisao(v.chave)}>
                {v.rotulo}
              </Button>
            ))}
            {podeEditar && <Button tamanho="sm" icone="plus" onClick={() => setNovaDespesa(true)}>Nova despesa</Button>}
            <Button tamanho="sm" variante="ghost" onClick={() => setGerenciarCategorias(true)}>Categorias</Button>
          </div>
        }
      />

      {mensagem && <Alert tom="success">{mensagem}</Alert>}
      {erro && <Alert tom="danger">{erro}</Alert>}

      <FilterBar ativos={filtrosAtivos} onLimpar={() => setFiltros(FILTROS_VAZIOS)}>
        <Field label={visao === 'sem_lancamento' ? 'Fornecedor' : 'Fornecedor / credor'}>
          <Select value={filtros.credor} onChange={alterarFiltro('credor')}>
            <option value="">Todos</option>
            {credores.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        {visao === 'pagas' ? (
          <>
            <Field label="Pago de">
              <Input type="date" value={pagoDe} onChange={(e) => setPagoDe(e.target.value)} />
            </Field>
            <Field label="até">
              <Input type="date" value={pagoAte} onChange={(e) => setPagoAte(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label={visao === 'a_pagar' ? 'Vencimento de' : 'Compra de'}>
              <Input type="date" value={filtros.de} onChange={alterarFiltro('de')} />
            </Field>
            <Field label="até">
              <Input type="date" value={filtros.ate} onChange={alterarFiltro('ate')} />
            </Field>
          </>
        )}
        {visao !== 'sem_lancamento' && (
          <>
            <Field label="Origem">
              <Select value={filtros.origem} onChange={alterarFiltro('origem')}>
                <option value="">Todas</option>
                <option value="compra">Compras</option>
                <option value="manual">Despesas</option>
              </Select>
            </Field>
            <Field label={visao === 'pagas' ? 'Forma de pagamento' : 'Forma prevista'}>
              <Select value={filtros.forma} onChange={alterarFiltro('forma')}>
                <option value="">Todas</option>
                {FORMAS_PAGAMENTO.map((f) => (
                  <option key={f.valor} value={f.valor}>{f.rotulo}</option>
                ))}
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={filtros.categoria} onChange={alterarFiltro('categoria')}>
                <option value="">Todas</option>
                {ordenarOpcoes(categorias).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {visao === 'a_pagar' && (
          <Field label="Situação">
            <Select value={filtros.grupo} onChange={alterarFiltro('grupo')}>
              <option value="">Todas</option>
              {GRUPOS_A_PAGAR.map((g) => (
                <option key={g.chave} value={g.chave}>{g.rotulo}</option>
              ))}
            </Select>
          </Field>
        )}
      </FilterBar>

      {!carregando && visao === 'a_pagar' && (
        <div className={estilos.totais}>
          {total('Total a pagar', formatarReais(totais.geral))}
          {total('Vencido', formatarReais(totais.vencida), totais.vencida > 0)}
          {total('Vence hoje', formatarReais(totais.vence_hoje))}
          {total('Próximos 7 dias', formatarReais(totais.proximos_7))}
        </div>
      )}
      {!carregando && visao === 'pagas' && (
        <div className={estilos.totais}>
          {total('Pago no período', formatarReais(totais.pago))}
          {total('Parcelas pagas', totais.quantidade)}
          {total('Juros + multa', formatarReais(totais.acrescimos))}
          {total('Descontos', formatarReais(totais.descontos))}
        </div>
      )}
      {!carregando && visao === 'sem_lancamento' && (
        <div className={estilos.totais}>
          {total('Compras sem lançamento', totais.quantidade)}
          {total('Total dessas compras', formatarReais(totais.total))}
        </div>
      )}

      {carregando ? (
        <p role="status">Carregando...</p>
      ) : visao === 'a_pagar' ? (
        filtradas.length === 0 ? (
          <p className={estilos.vazio}>Nenhuma conta a pagar para este filtro.</p>
        ) : (
          GRUPOS_A_PAGAR.map((g) => {
            const doGrupo = filtradas.filter((l) => classificarParcela(l, hoje) === g.chave);
            if (doGrupo.length === 0) return null;
            // A mesma ordenação vale para todos os grupos: nos cartões, o
            // "Ordenar por" aparece só no primeiro grupo exibido.
            const primeiroGrupo = GRUPOS_A_PAGAR.find((x) => filtradas.some((l) => classificarParcela(l, hoje) === x.chave))?.chave === g.chave;
            return (
              <section key={g.chave} className={estilos.grupo} aria-label={g.rotulo}>
                <div className={estilos.grupoCabecalho}>
                  <h2 className={estilos.grupoTitulo}>
                    {g.rotulo} <Badge tom={g.tom}>{doGrupo.length}</Badge>
                  </h2>
                  <strong>{formatarReais(deCentavos(doGrupo.reduce((s, l) => s + centavos(l.valor), 0)))}</strong>
                </div>
                <DataTable
                  rotulo={g.rotulo}
                  colunas={colunasAPagar}
                  linhas={ordenacaoAPagar.ordenar(doGrupo, colunasAPagar)}
                  chaveLinha={(l) => l.id}
                  renderAcoes={acoesParcela}
                  destaque={() => (g.chave === 'vencida' ? 'aviso' : undefined)}
                  ordenacao={ordenacaoAPagar.props}
                  semControleCartoes={!primeiroGrupo}
                />
              </section>
            );
          })
        )
      ) : visao === 'pagas' ? (
        filtradas.length === 0 ? (
          <p className={estilos.vazio}>Nenhum pagamento no período/filtro.</p>
        ) : (
          <DataTable
            rotulo="Pagas"
            colunas={colunasPagas}
            linhas={ordenacaoPagas.ordenar(filtradas, colunasPagas)}
            chaveLinha={(l) => l.id}
            renderAcoes={acoesParcela}
            ordenacao={ordenacaoPagas.props}
          />
        )
      ) : filtradas.length === 0 ? (
        <p className={estilos.vazio}>Nenhuma compra recebida sem lançamento financeiro.</p>
      ) : (
        <>
          <p className={estilos.dica}>Compras recebidas desde a implantação do Financeiro, com valores completos, ainda sem condição de pagamento lançada.</p>
          <DataTable
            rotulo="Compras sem lançamento"
            colunas={colunasSemLancamento}
            linhas={ordenacaoSemLancamento.ordenar(filtradas, colunasSemLancamento)}
            chaveLinha={(l) => l.pedido_id}
            renderAcoes={acoesCompra}
            ordenacao={ordenacaoSemLancamento.props}
          />
        </>
      )}

      {contaAberta && (
        <ContaDetalheModal
          contaId={contaAberta}
          permissoes={permissoes}
          categorias={categorias}
          fornecedores={fornecedores}
          onFechar={fecharConta}
          onAlterado={() => recarregar()}
        />
      )}
      {pagando && (
        <PagarParcelaModal parcela={pagando} onFechar={() => setPagando(null)} onPago={() => { setPagando(null); recarregar('Pagamento registrado.'); }} />
      )}
      {lancando && (
        <LancarFinanceiroModal
          compra={lancando}
          podePagar={podePagar}
          onFechar={() => setLancando(null)}
          onLancado={() => { setLancando(null); recarregar('Financeiro lançado.'); }}
        />
      )}
      {novaDespesa && (
        <DespesaModal
          categorias={categorias}
          fornecedores={fornecedores}
          podePagar={podePagar}
          onFechar={() => setNovaDespesa(false)}
          onSalvo={() => { setNovaDespesa(false); recarregar('Despesa criada.'); }}
        />
      )}
      {gerenciarCategorias && (
        <CategoriasDespesaModal categorias={categorias} podeEditar={podeEditar} onFechar={() => setGerenciarCategorias(false)} onAlterado={() => recarregar()} />
      )}
    </PageShell>
  );
}

export default function ContasPagarPage() {
  return (
    <RequireAuth permissao={PERMISSOES.CONTAS_PAGAR_VISUALIZAR}>
      <ContasPagarConteudo />
    </RequireAuth>
  );
}
