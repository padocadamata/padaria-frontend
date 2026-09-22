import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../components/RequireAuth';
import GerenciarCargosModal from '../components/funcionarios/GerenciarCargosModal';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';
import Field from '../components/ui/Field';
import FilterBar from '../components/ui/FilterBar';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Paginacao, { paginarLista } from '../components/Paginacao';
import estilos from '../components/funcionarios/funcionarios.module.css';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';

function BadgeStatus({ ativo }) {
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  return new Date(`${dataYYYYMMDD}T12:00:00`).toLocaleDateString('pt-BR');
}

function FuncionariosConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const podeInserir = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_EDITAR);

  const [funcionarios, setFuncionarios] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [busca, setBusca] = useState('');
  // Paginação VISUAL (client-side, 20 por página): a listagem já carrega
  // o conjunto completo (limit 1000, ver `carregar` abaixo) -- aqui só se
  // fatia o resultado já filtrado. Mesmo padrão de pages/fornecedores.js/
  // pages/catalogo.js. A consulta e os filtros continuam exatamente
  // iguais; nenhum registro fica de fora dos cálculos porque tudo já está
  // em memória (`funcionarios`), só a EXIBIÇÃO é paginada.
  const [pagina, setPagina] = useState(1);
  const [modalCargosAberto, setModalCargosAberto] = useState(false);

  async function carregar() {
    setCarregando(true);
    setErro('');
    const supabase = createClient();
    const [{ data: funcionariosData, error: erroFuncionarios }, { data: cargosData }] = await Promise.all([
      supabase
        .from('funcionarios')
        .select('id, nome, telefone, ativo, data_admissao, cargo_id, funcionarios_cargos(nome)')
        .order('nome')
        .limit(1000),
      supabase.from('funcionarios_cargos').select('id, nome, ativo').order('nome'),
    ]);

    if (erroFuncionarios) {
      console.error('Erro ao carregar funcionários:', erroFuncionarios);
      setErro('Não foi possível carregar a lista de funcionários.');
    } else {
      setFuncionarios(funcionariosData || []);
    }
    setCargos(cargosData || []);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  const listaFiltrada = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return funcionarios.filter((f) => {
      if (filtroStatus === 'ativos' && !f.ativo) return false;
      if (filtroStatus === 'inativos' && f.ativo) return false;
      if (termo && !f.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [funcionarios, filtroStatus, busca]);

  const paginacao = paginarLista(listaFiltrada, pagina);
  const paginaAtual = paginacao.paginaAtual;

  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  const quantidadeFiltrosAtivos = [filtroStatus !== 'ativos', busca !== ''].filter(Boolean).length;

  function limparFiltros() {
    setFiltroStatus('ativos');
    setBusca('');
    setPagina(1);
  }

  const colunas = [
    { chave: 'nome', rotulo: 'Nome', mobile: 'titulo', cartaoOrdem: 0, render: (f) => f.nome },
    { chave: 'status', rotulo: 'Status', mobile: 'titulo', cartaoOrdem: 1, render: (f) => <BadgeStatus ativo={f.ativo} /> },
    { chave: 'cargo', rotulo: 'Cargo', render: (f) => f.funcionarios_cargos?.nome || '—' },
    { chave: 'telefone', rotulo: 'Telefone', render: (f) => f.telefone || '—' },
    { chave: 'admissao', rotulo: 'Admissão', render: (f) => formatarData(f.data_admissao) },
  ];

  return (
    <PageShell titulo="Folha de Pagamento">
      <PageHeader
        titulo="Cadastro de Funcionários"
        acoes={
          <>
            {podeEditar && (
              <Button variante="secondary" onClick={() => setModalCargosAberto(true)}>
                Gerenciar cargos
              </Button>
            )}
            {podeInserir && (
              <Button icone="plus" onClick={() => router.push('/funcionarios/novo')}>
                Novo funcionário
              </Button>
            )}
          </>
        }
      />

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Buscar">
          <Input type="text" value={busca} onChange={(e) => alterarFiltro(setBusca)(e.target.value)} placeholder="Nome do funcionário" />
        </Field>
        <Field label="Status">
          <Select value={filtroStatus} onChange={(e) => alterarFiltro(setFiltroStatus)(e.target.value)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
      </FilterBar>

      {carregando ? (
        <p role="status">Carregando funcionários...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : funcionarios.length === 0 ? (
        <EmptyState>Nenhum funcionário encontrado.</EmptyState>
      ) : listaFiltrada.length === 0 ? (
        <EmptyState>Nenhum resultado para esta busca/filtro.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Funcionários"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(f) => f.id}
            destaque={(f) => (f.ativo ? null : 'inativo')}
            cartoesAte={900}
            renderAcoes={(f) => (
              <Button variante="secondary" tamanho="sm" icone={podeEditar ? 'pencil' : 'eye'} onClick={() => router.push(`/funcionarios/${f.id}`)}>
                {podeEditar ? 'Editar' : 'Ver'}
              </Button>
            )}
          />

          <p className={estilos.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}{' '}
            {paginacao.total === 1 ? 'funcionário' : 'funcionários'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </div>
      )}

      <GerenciarCargosModal
        aberto={modalCargosAberto}
        onFechar={() => setModalCargosAberto(false)}
        cargos={cargos}
        podeGerenciar={podeEditar}
        onAtualizar={setCargos}
      />
    </PageShell>
  );
}

export default function Funcionarios() {
  return (
    <RequireAuth permissao={PERMISSOES.FUNCIONARIOS_VISUALIZAR}>
      <FuncionariosConteudo />
    </RequireAuth>
  );
}
