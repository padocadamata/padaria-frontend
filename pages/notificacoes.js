import { useCallback, useEffect, useRef, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import FilterBar from '../components/ui/FilterBar';
import Field from '../components/ui/Field';
import Select from '../components/ui/Select';
import Checkbox from '../components/ui/Checkbox';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import EmptyState from '../components/ui/EmptyState';
import ItemNotificacao from '../components/notificacoes/ItemNotificacao';
import styles from '../components/notificacoes/notificacoes.module.css';
import { createClient } from '../lib/supabase/client';
import { useNotificacoes } from '../hooks/useNotificacoes';
import { TAMANHO_PAGINA, aplicarLeituraLocal, listarNotificacoes } from '../lib/notificacoes/consultas';

// Histórico completo da Central de Notificações (migration 0080). Qualquer
// usuário autenticado e ativo abre a página; o CONTEÚDO já vem filtrado pela
// RLS (perfil + permissão efetiva + autor excluído) -- quem não recebe
// nenhum tipo vê a lista vazia. Paginação por cursor ("Carregar mais"),
// mais recentes primeiro. Nada é apagado: notificações de registros já
// resolvidos ou excluídos continuam aqui.
const OPCOES_LEITURA = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'nao_lidas', rotulo: 'Não lidas' },
  { valor: 'lidas', rotulo: 'Lidas' },
];

function HistoricoNotificacoes() {
  const notificacoes = useNotificacoes();
  const [leitura, setLeitura] = useState('todas');
  const [somentePendencias, setSomentePendencias] = useState(false);
  const [itens, setItens] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState('');
  const [erroAcao, setErroAcao] = useState('');
  const consultaRef = useRef(0);

  const buscar = useCallback(
    async (cursor) => {
      const lista = await listarNotificacoes(createClient(), {
        limite: TAMANHO_PAGINA + 1,
        cursor,
        leitura,
        somentePendenciasAbertas: somentePendencias,
      });
      return { pagina: lista.slice(0, TAMANHO_PAGINA), mais: lista.length > TAMANHO_PAGINA };
    },
    [leitura, somentePendencias]
  );

  useEffect(() => {
    const consulta = ++consultaRef.current;
    setCarregando(true);
    setErro('');
    buscar(null)
      .then(({ pagina, mais }) => {
        if (consulta !== consultaRef.current) return;
        setItens(pagina);
        setTemMais(mais);
      })
      .catch((e) => {
        if (consulta !== consultaRef.current) return;
        console.error('Erro ao carregar o histórico de notificações:', e);
        setItens([]);
        setTemMais(false);
        setErro('Não foi possível carregar as notificações agora.');
      })
      .finally(() => {
        if (consulta === consultaRef.current) setCarregando(false);
      });
  }, [buscar]);

  async function carregarMais() {
    const ultima = itens[itens.length - 1];
    if (!ultima) return;
    const consulta = consultaRef.current;
    setCarregandoMais(true);
    try {
      const { pagina, mais } = await buscar({ criado_em: ultima.criado_em, id: ultima.id });
      if (consulta !== consultaRef.current) return;
      setItens((atual) => {
        const vistos = new Set(atual.map((n) => n.id));
        return [...atual, ...pagina.filter((n) => !vistos.has(n.id))];
      });
      setTemMais(mais);
    } catch (e) {
      console.error('Erro ao carregar mais notificações:', e);
      setErroAcao('Não foi possível carregar mais notificações agora.');
    } finally {
      setCarregandoMais(false);
    }
  }

  async function marcarLida(n) {
    setErroAcao('');
    setItens((atual) => aplicarLeituraLocal(atual, [n.id]));
    try {
      await notificacoes.marcarLidas([n.id]);
    } catch {
      setErroAcao('Não foi possível marcar como lida agora. Tente de novo.');
    }
  }

  async function marcarTodas() {
    setErroAcao('');
    setItens((atual) => aplicarLeituraLocal(atual, atual.map((n) => n.id)));
    try {
      await notificacoes.marcarTodas();
    } catch {
      setErroAcao('Não foi possível marcar todas como lidas agora. Tente de novo.');
    }
  }

  function abrir(n) {
    if (!n.lida_em) notificacoes.marcarLidas([n.id]).catch(() => {});
  }

  const filtrosAtivos = (leitura !== 'todas' ? 1 : 0) + (somentePendencias ? 1 : 0);
  const algumaNaoLida = notificacoes.naoLidas > 0 || itens.some((n) => !n.lida_em);

  return (
    <div className={styles.pagina}>
      <PageHeader
        titulo="Notificações"
        subtitulo="Histórico de avisos do sistema, mais recentes primeiro."
        acoes={
          <Button variante="secondary" icone="check" onClick={marcarTodas} disabled={!algumaNaoLida}>
            Marcar todas como lidas
          </Button>
        }
      />

      <FilterBar
        ativos={filtrosAtivos}
        onLimpar={() => {
          setLeitura('todas');
          setSomentePendencias(false);
        }}
      >
        <Field label="Leitura">
          <Select value={leitura} onChange={(e) => setLeitura(e.target.value)}>
            {OPCOES_LEITURA.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          rotulo="Somente pendências abertas"
          checked={somentePendencias}
          onChange={(e) => setSomentePendencias(e.target.checked)}
        />
      </FilterBar>

      {erroAcao && <Alert tom="danger">{erroAcao}</Alert>}
      {erro && <Alert tom="danger">{erro}</Alert>}

      {carregando ? (
        <p role="status">Carregando notificações…</p>
      ) : !erro && itens.length === 0 ? (
        <EmptyState>
          {filtrosAtivos ? 'Nenhuma notificação com esses filtros.' : 'Nenhuma notificação por aqui.'}
        </EmptyState>
      ) : itens.length > 0 ? (
        <>
          <div className={styles.superficie}>
            <ul className={styles.lista}>
              {itens.map((n) => (
                <ItemNotificacao key={n.id} notificacao={n} onAbrir={abrir} onMarcarLida={marcarLida} />
              ))}
            </ul>
          </div>
          {temMais && (
            <div className={styles.maisWrap}>
              <Button variante="secondary" onClick={carregarMais} disabled={carregandoMais}>
                {carregandoMais ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function PaginaNotificacoes() {
  return (
    <RequireAuth>
      <PageShell titulo="Notificações">
        <HistoricoNotificacoes />
      </PageShell>
    </RequireAuth>
  );
}
