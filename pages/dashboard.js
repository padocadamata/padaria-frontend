import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import RequireAuth from '../components/RequireAuth';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import SectionHeader from '../components/ui/SectionHeader';
import Icon from '../components/ui/Icon';
import Button from '../components/ui/Button';
import LembretesRapidos from '../components/dashboard/LembretesRapidos';
import AgendaDeHoje from '../components/dashboard/AgendaDeHoje';
import AtencaoProducao from '../components/dashboard/AtencaoProducao';
import RecebimentosPrevistos from '../components/dashboard/RecebimentosPrevistos';
import ProximosPedidos from '../components/dashboard/ProximosPedidos';
import AniversariantesFuncionarios from '../components/dashboard/AniversariantesFuncionarios';
import FavoritosDashboard from '../components/dashboard/FavoritosDashboard';
import PersonalizacaoDashboard, { GradePersonalizada } from '../components/dashboard/PersonalizacaoDashboard';
import styles from '../components/dashboard/dashboard.module.css';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { useAuth } from '../hooks/useAuth';
import { dataLocalExibicao } from '../lib/data/dataLocal';
import { navegacaoDoUsuario } from '../lib/nav/navegacao';
import { carregarLayoutDashboard, salvarLayoutDashboard } from '../lib/dashboard/layoutDados';
import { layoutPadrao, mesclarLayout } from '../lib/dashboard/layout';

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Saudação pela hora LOCAL da Padoca (America/Sao_Paulo), nunca pela hora do
// aparelho -- mesma regra de fuso usada nas datas do sistema.
function saudacaoDoDia() {
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date())
  );
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

function primeiroNome(nomeCompleto) {
  return (nomeCompleto || '').trim().split(/\s+/)[0] || '';
}

// Dashboard = tela PILOTO do Design System. Só usa dados/funcionalidades que
// já existiam: os widgets de antes (mesmas consultas, mesmas permissões) e
// atalhos derivados das permissões reais do usuário. Nada de indicador novo.
//
// Migration 0075: Favoritos (topo) e personalização individual da ordem e
// do tamanho (P/M/G) dos widgets. Sem preferência salva, a grade é EXATAMENTE
// a de antes; a personalização só muda a apresentação, nunca os dados.
function DashboardConteudo() {
  const { permissoes, perfilUsuario, usuarioAuth } = useAuth();
  const podeVerProducao = hasPermissao(permissoes, PERMISSOES.PRODUCAO_VISUALIZAR);
  const podeVerFornecedores = hasPermissao(permissoes, PERMISSOES.FORNECEDORES_VISUALIZAR);
  const podeVerPedidos = hasPermissao(permissoes, PERMISSOES.PEDIDOS_VISUALIZAR);
  const podeVerFuncionarios = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_VISUALIZAR);
  // Agenda de hoje: mesma exigência da página /agenda (agenda.visualizar). Aniversários dentro
  // dela seguem o gate da Agenda: só com funcionarios.visualizar também.
  const podeVerAgenda = hasPermissao(permissoes, PERMISSOES.AGENDA_VISUALIZAR);
  // Encomendas (migration 0071) e o lembrete de 1 dia antes entram no MESMO
  // card, só para quem também tem encomendas.visualizar.
  const podeVerEncomendas = hasPermissao(permissoes, PERMISSOES.ENCOMENDAS_VISUALIZAR);

  // Widgets por id estável (lib/dashboard/layout.js) -- mesmas condições de
  // exibição e as mesmas props de antes.
  const widgets = {
    agenda_hoje: podeVerAgenda && <AgendaDeHoje incluirAniversarios={podeVerFuncionarios} incluirEncomendas={podeVerEncomendas} />,
    atencao_producao: podeVerProducao && <AtencaoProducao />,
    recebimentos_previstos: podeVerPedidos && <RecebimentosPrevistos />,
    lembretes: <LembretesRapidos />,
    aniversariantes: podeVerFuncionarios && <AniversariantesFuncionarios excluirHoje={podeVerAgenda} />,
    agenda_pedidos: podeVerFornecedores && <ProximosPedidos />,
  };
  const visiveis = useMemo(
    () => new Set(Object.entries(widgets).filter(([, el]) => el).map(([id]) => id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [podeVerAgenda, podeVerProducao, podeVerPedidos, podeVerFuncionarios, podeVerFornecedores]
  );

  const [preferencia, setPreferencia] = useState({ carregada: false, widgets: null, disponivel: false });
  const [rascunho, setRascunho] = useState(null); // layout em edição (null = fora do modo Personalizar)
  const [salvando, setSalvando] = useState(false);
  const [erroPersonalizacao, setErroPersonalizacao] = useState('');

  useEffect(() => {
    let ativo = true;
    carregarLayoutDashboard().then((r) => {
      if (ativo) setPreferencia({ carregada: true, widgets: r.widgets, disponivel: r.disponivel });
    });
    return () => {
      ativo = false;
    };
  }, []);

  function iniciarPersonalizacao() {
    setErroPersonalizacao('');
    setRascunho(mesclarLayout(preferencia.widgets));
  }

  async function salvarPersonalizacao() {
    setSalvando(true);
    setErroPersonalizacao('');
    const { erro } = await salvarLayoutDashboard(usuarioAuth?.id, rascunho);
    setSalvando(false);
    if (erro) {
      setErroPersonalizacao(erro);
      return;
    }
    const padrao = JSON.stringify(rascunho) === JSON.stringify(layoutPadrao());
    setPreferencia((p) => ({ ...p, widgets: padrao ? null : rascunho }));
    setRascunho(null);
  }

  // Atalhos = os mesmos módulos que a navegação já mostra a este usuário
  // (exceto o próprio Dashboard).
  const atalhos = navegacaoDoUsuario(permissoes).principais.filter((modulo) => modulo.chave !== 'dashboard');

  const nome = primeiroNome(perfilUsuario?.nome);
  const titulo = nome ? `${saudacaoDoDia()}, ${nome}` : saudacaoDoDia();
  const editando = rascunho !== null;
  const podePersonalizar = preferencia.disponivel && !!usuarioAuth?.id && visiveis.size > 1;

  return (
    <PageShell titulo="Dashboard">
      <PageHeader
        titulo={titulo}
        subtitulo={capitalizar(dataLocalExibicao())}
        acoes={
          podePersonalizar &&
          !editando && (
            <Button variante="secondary" tamanho="sm" icone="pencil" onClick={iniciarPersonalizacao}>
              Personalizar
            </Button>
          )
        }
      />

      <FavoritosDashboard />

      {atalhos.length > 0 && (
        <section className={styles.secao} aria-labelledby="atalhos-titulo">
          <SectionHeader id="atalhos-titulo" titulo="Acesso rápido" />
          <ul className={styles.atalhos}>
            {atalhos.map((modulo) => (
              <li key={modulo.chave}>
                <Link href={modulo.href || modulo.rota} className={styles.atalho}>
                  <span className={styles.atalhoIcone}>
                    <Icon nome={modulo.icone} tamanho={22} />
                  </span>
                  {modulo.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!preferencia.carregada ? null : editando ? (
        <PersonalizacaoDashboard
          rascunho={rascunho}
          visiveis={visiveis}
          widgets={widgets}
          salvando={salvando}
          erro={erroPersonalizacao}
          onAlterar={setRascunho}
          onRestaurarPadrao={() => setRascunho(layoutPadrao())}
          onCancelar={() => {
            setRascunho(null);
            setErroPersonalizacao('');
          }}
          onSalvar={salvarPersonalizacao}
        />
      ) : preferencia.widgets ? (
        <GradePersonalizada layout={mesclarLayout(preferencia.widgets)} visiveis={visiveis} widgets={widgets} />
      ) : (
        <>
          <div className={styles.grade}>
            {widgets.agenda_hoje}
            {widgets.atencao_producao}
            {widgets.recebimentos_previstos}
            {widgets.lembretes}
            {widgets.aniversariantes}
          </div>

          {widgets.agenda_pedidos}
        </>
      )}
    </PageShell>
  );
}

export default function Dashboard() {
  return (
    <RequireAuth permissao={PERMISSOES.DASHBOARD_VISUALIZAR}>
      <DashboardConteudo />
    </RequireAuth>
  );
}
