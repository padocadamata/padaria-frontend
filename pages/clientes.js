import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import ClienteModal from '../components/clientes/ClienteModal';
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
import estilos from '../components/clientes/clientes.module.css';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { useAuth } from '../hooks/useAuth';
import { carregarClientes, definirStatusCliente } from '../lib/clientes/clientes';
import { clientePassaFiltro, produtosComInteresse, rotuloSituacaoProduto } from '../lib/clientes/filtros';
import { formatarTelefone } from '../lib/clientes/telefone';

const MAX_PRODUTOS_NA_LINHA = 3;

function BadgeStatus({ ativo }) {
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

function ProdutosDoCliente({ produtos, destacado }) {
  if (!produtos.length) return <span className={estilos.vazio}>Nenhum</span>;
  // O produto filtrado aparece primeiro, para a resposta de "quem gosta
  // de X?" ficar evidente na linha.
  const ordenados = destacado ? [...produtos].sort((a, b) => (a.produto_id === destacado ? -1 : b.produto_id === destacado ? 1 : 0)) : produtos;
  const visiveis = ordenados.slice(0, MAX_PRODUTOS_NA_LINHA);
  const resto = produtos.length - visiveis.length;
  return (
    <span className={estilos.produtosCelula} title={produtos.map((p) => p.nome).join(', ')}>
      {visiveis.map((p) => (
        <Badge key={p.produto_id} tom={p.produto_id === destacado ? 'primary' : rotuloSituacaoProduto(p) ? 'neutral' : 'info'}>
          {p.nome}
          {rotuloSituacaoProduto(p) ? ` (${rotuloSituacaoProduto(p)})` : ''}
        </Badge>
      ))}
      {resto > 0 && <Badge tom="neutral">+{resto}</Badge>}
    </span>
  );
}

// CLIENTES (migration 0069): cadastro operacional simples para contato
// manual. Mesmo padrão de listagem de Funcionários/Fornecedores: carrega o
// conjunto (com os produtos de interesse embutidos, 1 consulta), filtra e
// pagina no navegador (20 por página). "Quem gosta de LUA DE MEL?" =
// filtro Produto de interesse.
function ClientesConteudo() {
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.CLIENTES_EDITAR);

  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [limiteAtingido, setLimiteAtingido] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [busca, setBusca] = useState('');
  const [filtroProduto, setFiltroProduto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState(null); // { cliente } | { cliente: null } para novo

  async function carregar() {
    setCarregando(true);
    const resultado = await carregarClientes();
    setClientes(resultado.clientes);
    setErro(resultado.erro);
    setLimiteAtingido(resultado.limiteAtingido);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (!mensagem) return undefined;
    const timer = setTimeout(() => setMensagem(''), 4000);
    return () => clearTimeout(timer);
  }, [mensagem]);

  const opcoesProduto = useMemo(() => produtosComInteresse(clientes), [clientes]);
  const produtoSelecionado = opcoesProduto.find((p) => p.id === filtroProduto) || null;

  const listaFiltrada = useMemo(
    () => clientes.filter((c) => clientePassaFiltro(c, { termo: busca, produto: filtroProduto, status: filtroStatus })),
    [clientes, busca, filtroProduto, filtroStatus]
  );

  const paginacao = paginarLista(listaFiltrada, pagina);
  const paginaAtual = paginacao.paginaAtual;

  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  function alterarFiltro(setter) {
    return (valor) => {
      setter(valor);
      setPagina(1);
    };
  }

  const quantidadeFiltrosAtivos = [busca !== '', filtroProduto !== '', filtroStatus !== 'ativos'].filter(Boolean).length;

  function limparFiltros() {
    setBusca('');
    setFiltroProduto('');
    setFiltroStatus('ativos');
    setPagina(1);
  }

  async function alternarStatus(cliente) {
    const { erro: erroRpc } = await definirStatusCliente(cliente.id, !cliente.ativo);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    setMensagem(cliente.ativo ? `${cliente.nome} inativado.` : `${cliente.nome} reativado.`);
    carregar();
  }

  function aoSalvar(texto) {
    setModal(null);
    setMensagem(texto);
    carregar();
  }

  const colunas = [
    { chave: 'nome', rotulo: 'Nome', mobile: 'titulo', cartaoOrdem: 0, render: (c) => c.nome },
    { chave: 'telefone', rotulo: 'Telefone', render: (c) => <span className={estilos.telefone}>{formatarTelefone(c.telefone)}</span> },
    { chave: 'produtos', rotulo: 'Produtos de interesse', render: (c) => <ProdutosDoCliente produtos={c.produtos} destacado={filtroProduto} /> },
    { chave: 'status', rotulo: 'Status', mobile: 'titulo', cartaoOrdem: 1, render: (c) => <BadgeStatus ativo={c.ativo} /> },
  ];

  return (
    <PageShell titulo="Clientes">
      <PageHeader
        titulo="Clientes"
        acoes={
          podeEditar && (
            <Button icone="plus" onClick={() => setModal({ cliente: null })}>
              Novo cliente
            </Button>
          )
        }
      />

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Buscar">
          <Input type="search" value={busca} onChange={(e) => alterarFiltro(setBusca)(e.target.value)} placeholder="Nome ou telefone" />
        </Field>
        <Field label="Produto de interesse">
          <Select value={filtroProduto} onChange={(e) => alterarFiltro(setFiltroProduto)(e.target.value)}>
            <option value="">Todos os produtos</option>
            {opcoesProduto.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} ({p.quantidade}){rotuloSituacaoProduto(p) ? ` — ${rotuloSituacaoProduto(p)}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={filtroStatus} onChange={(e) => alterarFiltro(setFiltroStatus)(e.target.value)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
      </FilterBar>

      {mensagem && <Alert tom="success">{mensagem}</Alert>}
      {limiteAtingido && <Alert tom="warning">Mostrando os primeiros 2.000 clientes por nome. Use a busca para encontrar os demais.</Alert>}

      {carregando ? (
        <p role="status">Carregando clientes...</p>
      ) : erro && clientes.length === 0 ? (
        <Alert tom="danger">{erro}</Alert>
      ) : clientes.length === 0 ? (
        <EmptyState>Nenhum cliente cadastrado ainda.</EmptyState>
      ) : listaFiltrada.length === 0 ? (
        <EmptyState>Nenhum cliente para esta busca/filtro.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          {erro && <Alert tom="danger">{erro}</Alert>}
          {produtoSelecionado && (
            <p className={estilos.destaqueProduto}>
              {listaFiltrada.length} {listaFiltrada.length === 1 ? 'cliente tem' : 'clientes têm'} interesse em <strong>{produtoSelecionado.nome}</strong>
              {filtroStatus === 'ativos' ? ' (somente ativos)' : ''}.
            </p>
          )}
          <DataTable
            rotulo="Clientes"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(c) => c.id}
            destaque={(c) => (c.ativo ? null : 'inativo')}
            cartoesAte={900}
            renderAcoes={(c) => (
              <>
                <Button variante="secondary" tamanho="sm" icone={podeEditar ? 'pencil' : 'eye'} onClick={() => setModal({ cliente: c })}>
                  {podeEditar ? 'Editar' : 'Ver'}
                </Button>
                {podeEditar && (
                  <Button variante="secondary" tamanho="sm" icone={c.ativo ? 'pause' : 'play'} onClick={() => alternarStatus(c)}>
                    {c.ativo ? 'Inativar' : 'Reativar'}
                  </Button>
                )}
              </>
            )}
          />
          <p className={estilos.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total} {paginacao.total === 1 ? 'cliente' : 'clientes'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </div>
      )}

      {modal && <ClienteModal cliente={modal.cliente} clientes={clientes} podeEditar={podeEditar} onFechar={() => setModal(null)} onSalvo={aoSalvar} />}
    </PageShell>
  );
}

export default function ClientesPage() {
  return (
    <RequireAuth permissao={PERMISSOES.CLIENTES_VISUALIZAR}>
      <ClientesConteudo />
    </RequireAuth>
  );
}
