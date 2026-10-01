import { useEffect, useMemo, useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import IndicadorVinculo from './IndicadorVinculo';
import PagamentoDetalheModal from './PagamentoDetalheModal';
import { buscarHistoricoPagamentos, formatarMoeda, formatarCompetencia } from '../../lib/funcionarios/pagamentos';
import { rotuloTipoLancamento, centavos } from '../../lib/funcionarios/pagamentosCalculo';
import { OPCOES_VINCULO } from '../../lib/funcionarios/vinculo';
import estilosPagamentos from './pagamentos.module.css';

function formatarDataExibicao(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Histórico de pagamentos (confirmados e cancelados). Filtros: período
// (data efetiva), pessoa, vínculo e forma de remuneração -- os dois últimos
// pelo SNAPSHOT do pagamento, nunca pelo cadastro atual -- e status.
// podeCancelar controla só a AÇÃO dentro do detalhe.
export default function PagamentosPagosVisao({ funcionarios, podeCancelar }) {
  const [funcionarioId, setFuncionarioId] = useState('');
  const [status, setStatus] = useState('');
  const [tipoVinculo, setTipoVinculo] = useState('');
  const [natureza, setNatureza] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [pagamentos, setPagamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState(null);

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
    return { quantidade: ativos.length, bruto: soma('valor_bruto'), descontos: soma('total_descontos'), liquido: soma('valor_liquido') };
  }, [pagamentos]);

  const colunas = [
    { chave: 'data_efetiva', rotulo: 'Data efetiva', render: (p) => formatarDataExibicao(p.data_efetiva) },
    { chave: 'funcionario', rotulo: 'Pessoa', mobile: 'titulo', render: (p) => p.funcionarios?.nome || '—' },
    { chave: 'vinculo', rotulo: 'Vínculo', render: (p) => <IndicadorVinculo tipoVinculo={p.tipo_vinculo_snapshot} /> },
    {
      chave: 'natureza',
      rotulo: 'Forma',
      render: (p) => (p.natureza === 'mensal' ? `Mensal ${formatarCompetencia(p.competencia)} · ${rotuloTipoLancamento(p.tipo_lancamento)}` : 'Por hora'),
    },
    { chave: 'bruto', rotulo: 'Bruto', alinhar: 'direita', render: (p) => formatarMoeda(p.valor_bruto) },
    { chave: 'descontos', rotulo: 'Descontos', alinhar: 'direita', render: (p) => formatarMoeda(p.total_descontos) },
    { chave: 'liquido', rotulo: 'Líquido', alinhar: 'direita', render: (p) => formatarMoeda(p.valor_liquido) },
    {
      chave: 'status',
      rotulo: 'Status',
      render: (p) => <Badge tom={p.status === 'cancelado' ? 'danger' : 'success'}>{p.status === 'cancelado' ? 'Cancelado' : 'Confirmado'}</Badge>,
    },
  ];

  return (
    <>
      <div className={estilosPagamentos.controlesFiltro}>
        <Field label="Data efetiva — de">
          <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </Field>
        <Field label="até">
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </Field>
        <Field label="Pessoa">
          <Select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
            <option value="">Todas</option>
            {funcionarios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.ativo === false ? ' (inativo)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vínculo">
          <Select value={tipoVinculo} onChange={(e) => setTipoVinculo(e.target.value)}>
            <option value="">Todos</option>
            {OPCOES_VINCULO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forma">
          <Select value={natureza} onChange={(e) => setNatureza(e.target.value)}>
            <option value="">Todas</option>
            <option value="por_hora">Por hora</option>
            <option value="mensal">Mensal</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
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
          <div className={estilosPagamentos.resumoLinha}>
            <span>{totais.quantidade} confirmado(s) no filtro</span>
            <span>
              Bruto {formatarMoeda(totais.bruto)} · Descontos {formatarMoeda(totais.descontos)} · <strong>Líquido {formatarMoeda(totais.liquido)}</strong>
            </span>
          </div>
          <DataTable
            rotulo="Pagamentos"
            colunas={colunas}
            linhas={pagamentos}
            chaveLinha={(p) => p.id}
            destaque={(p) => (p.status === 'cancelado' ? 'inativo' : undefined)}
            renderAcoes={(p) => (
              <Button variante="secondary" tamanho="sm" onClick={() => setDetalhe(p)}>
                Detalhes
              </Button>
            )}
          />
        </>
      )}

      {detalhe && <PagamentoDetalheModal pagamento={detalhe} podeCancelar={podeCancelar} onFechar={() => setDetalhe(null)} onCancelado={aoCancelar} />}
    </>
  );
}
