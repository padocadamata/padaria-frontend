import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../../components/RequireAuth';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import CompetenciaNavegacao from '../../../components/ponto/CompetenciaNavegacao';
import PageShell from '../../../components/shell/PageShell';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import PageHeader from '../../../components/ui/PageHeader';
import estilos from '../../../components/ponto/ponto.module.css';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../../lib/auth/permissoes';
import { dataLocalHoje } from '../../../lib/data/dataLocal';
import {
  STATUS_CARTAO, formatarData, mensagemErroPonto, mesValido, permissoesDoPonto, resumoDaBase, rotuloCompetencia, statusDoResumo,
} from '../../../lib/ponto/apresentacao';
import { abrirCartao, carregarCartao, carregarEmpresa, listarCompetencia } from '../../../lib/ponto/consultas';
import { montarExportacaoCartao } from '../../../lib/ponto/exportacao';

// Folha de Pagamento > Cartão-Ponto (migration 0078) -- lista da
// competência (padrão: mês atual; histórico sem limite). Só TEMPO: nada
// aqui lê ou escreve Pagamentos. A prévia de cada cartão é só leitura
// (folha_ponto_base); abrir o cartão é uma ação explícita. Pendências e
// status exato (conferência desatualizada) vêm da base de cada funcionária,
// lida em paralelo limitado (3 por vez).
const PARALELO = 3;

function CartaoPontoLista() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const pode = permissoesDoPonto(permissoes, hasPermissao, PERMISSOES);
  const mesAtual = dataLocalHoje().slice(0, 7);
  const mes = mesValido(router.query.competencia) && router.query.competencia <= mesAtual ? router.query.competencia : mesAtual;

  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState('');
  const [bases, setBases] = useState({}); // funcionario_id -> base | { erro }
  const [mensagem, setMensagem] = useState(null);
  const [ocupado, setOcupado] = useState('');

  useEffect(() => {
    if (!router.isReady) return undefined;
    let ativo = true;
    setLinhas(null);
    setBases({});
    setErro('');
    listarCompetencia(mes)
      .then(async (lista) => {
        if (!ativo) return;
        setLinhas(lista);
        const fila = [...lista];
        const trabalhar = async () => {
          while (ativo && fila.length > 0) {
            const linha = fila.shift();
            try {
              const base = await carregarCartao(linha.funcionario_id, mes);
              if (ativo) setBases((b) => ({ ...b, [linha.funcionario_id]: base }));
            } catch (e) {
              if (ativo) setBases((b) => ({ ...b, [linha.funcionario_id]: { erro: mensagemErroPonto(e) } }));
            }
          }
        };
        await Promise.all(Array.from({ length: PARALELO }, trabalhar));
      })
      .catch((e) => { if (ativo) setErro(mensagemErroPonto(e)); });
    return () => { ativo = false; };
  }, [router.isReady, mes]);

  const mudarMes = (novo) => router.push({ pathname: '/funcionarios/ponto', query: { competencia: novo } }, undefined, { shallow: true });
  const hrefCartao = (id) => `/funcionarios/ponto/${id}?competencia=${mes}`;

  async function abrir(linha) {
    setOcupado(linha.funcionario_id);
    setMensagem(null);
    try {
      await abrirCartao(linha.funcionario_id, mes);
      await router.push(hrefCartao(linha.funcionario_id));
    } catch (e) {
      setMensagem({ tom: 'danger', texto: mensagemErroPonto(e) });
      setOcupado('');
    }
  }

  const prontas = useMemo(() => (linhas || []).filter((l) => bases[l.funcionario_id] && !bases[l.funcionario_id].erro), [linhas, bases]);
  const todasLidas = linhas !== null && linhas.every((l) => bases[l.funcionario_id]);

  async function baixarZip() {
    setOcupado('zip');
    setMensagem(null);
    try {
      const empresa = await carregarEmpresa();
      const modelos = prontas.map((l) => montarExportacaoCartao(bases[l.funcionario_id], { empresa }));
      const { exportarZipCompetencia } = await import('../../../lib/ponto/exportarCartao');
      await exportarZipCompetencia(modelos, `Cartao-Ponto_${mes}`);
    } catch (e) {
      console.error('Cartão-Ponto: falha ao gerar o ZIP', e);
      setMensagem({ tom: 'danger', texto: 'Não foi possível gerar o ZIP. Tente de novo.' });
    } finally {
      setOcupado('');
    }
  }

  const colunas = [
    {
      chave: 'nome',
      rotulo: 'Funcionária',
      mobile: 'titulo',
      render: (l) => {
        const base = bases[l.funcionario_id];
        const demissao = base?.funcionario?.data_demissao;
        return (
          <span className={estilos.itemTexto}>
            <strong>{l.nome}</strong>
            {demissao ? <span className={estilos.aux}>Desligada em {formatarData(demissao)}</span> : !l.ativo && <span className={estilos.aux}>Inativa</span>}
          </span>
        );
      },
    },
    { chave: 'cargo', rotulo: 'Cargo', render: (l) => l.cargo || '—' },
    {
      chave: 'status',
      rotulo: 'Status',
      render: (l) => {
        const base = bases[l.funcionario_id];
        const chave = base && !base.erro ? resumoDaBase(base).status : statusDoResumo(l);
        return <Badge tom={STATUS_CARTAO[chave].tom}>{STATUS_CARTAO[chave].rotulo}</Badge>;
      },
    },
    {
      chave: 'pendentes',
      rotulo: 'Dias pendentes',
      alinhar: 'direita',
      render: (l) => {
        const base = bases[l.funcionario_id];
        if (!base) return <span className={estilos.aux}>apurando…</span>;
        if (base.erro) return <span className={estilos.aux} title={base.erro}>—</span>;
        const { pendentes } = resumoDaBase(base);
        return pendentes > 0 ? <Badge tom="warning">{pendentes}</Badge> : '0';
      },
    },
  ];

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="ponto" />
      <PageHeader
        titulo="Cartão-Ponto"
        subtitulo="Jornada prevista na Escala x realizada, em horas. Funcionárias CLT com vínculo na competência."
        acoes={linhas && linhas.length > 0 && (
          <Button variante="secondary" tamanho="sm" icone="download" onClick={baixarZip} disabled={!todasLidas || prontas.length === 0 || ocupado === 'zip'}>
            {ocupado === 'zip' ? 'Gerando…' : 'PDFs da competência (ZIP)'}
          </Button>
        )}
      />
      <div className={estilos.pilha}>
        <CompetenciaNavegacao mes={mes} mesAtual={mesAtual} onMudar={mudarMes} />
        {mensagem && <Alert tom={mensagem.tom} className={estilos.mensagem}>{mensagem.texto}</Alert>}
        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        {!erro && linhas === null && <p role="status">Carregando…</p>}
        {linhas && linhas.length === 0 && <EmptyState>Nenhuma funcionária CLT com vínculo em {rotuloCompetencia(mes)}.</EmptyState>}
        {linhas && linhas.length > 0 && (
          <DataTable
            rotulo={`Cartões de ${rotuloCompetencia(mes)}`}
            colunas={colunas}
            linhas={linhas}
            chaveLinha={(l) => l.funcionario_id}
            renderAcoes={(l) => (
              <div className={estilos.acoes}>
                <Button href={hrefCartao(l.funcionario_id)} variante="secondary" tamanho="sm">{l.cartao_id ? 'Ver cartão' : 'Ver prévia'}</Button>
                {!l.cartao_id && pode.lancar && (
                  <Button tamanho="sm" onClick={() => abrir(l)} disabled={Boolean(ocupado)}>{ocupado === l.funcionario_id ? 'Abrindo…' : 'Abrir cartão'}</Button>
                )}
              </div>
            )}
          />
        )}
      </div>
    </PageShell>
  );
}

export default function CartaoPontoPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_PONTO_VISUALIZAR}>
      <CartaoPontoLista />
    </RequireAuth>
  );
}
