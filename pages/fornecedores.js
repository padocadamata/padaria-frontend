import { useEffect, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import FornecedorForm from '../components/fornecedores/FornecedorForm';
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
import estilos from '../components/fornecedores/fornecedores.module.css';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useOrdenacao } from '../lib/ordenacao/useOrdenacao';
import { useFiltrosPersistidos } from '../lib/filtros/useFiltrosPersistidos';
import { FILTROS_FORNECEDORES } from '../lib/filtros/telas';
import { nomeExibicaoFornecedor } from '../lib/fornecedores/nomeExibicao';
import { useAuth } from '../hooks/useAuth';

function apenasDigitos(valor) {
  return (valor || '').replace(/\D/g, '');
}

function formatarDocumento(documento, tipoDocumento) {
  if (!documento) return '—';

  const digitos = apenasDigitos(documento);

  if (tipoDocumento === 'CNPJ' && digitos.length === 14) {
    return digitos.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5'
    );
  }

  if (tipoDocumento === 'CPF' && digitos.length === 11) {
    return digitos.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      '$1.$2.$3-$4'
    );
  }

  return documento;
}

function formatarContato(telefone, whatsapp) {
  if (!telefone && !whatsapp) return '-';

  if (telefone && whatsapp && telefone === whatsapp) {
    return telefone;
  }

  if (telefone && whatsapp) {
    return `${telefone} / ${whatsapp}`;
  }

  return telefone || whatsapp;
}

function formatarModalidade(modalidade) {
  if (modalidade === 'compra_presencial') {
    return 'Compra presencial';
  }

  return 'Pedido com entrega';
}

function BadgeStatus({ ativo }) {
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

function BadgeModalidade({ modalidade }) {
  const presencial = modalidade === 'compra_presencial';

  return <Badge tom={presencial ? 'warning' : 'info'}>{formatarModalidade(modalidade)}</Badge>;
}

function FornecedoresConteudo() {
  const { permissoes } = useAuth();

  const [fornecedores, setFornecedores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Busca/Status/Modalidade persistidos durante a sessão de login
  // (lib/filtros) -- a primeira consulta já usa o Status restaurado.
  const filtros = useFiltrosPersistidos('fornecedores', FILTROS_FORNECEDORES);
  const { status: filtroStatus, modalidade: filtroModalidade, busca } = filtros.valores;
  // Página da lista (paginação VISUAL, 20 por página, aplicada DEPOIS da
  // busca/filtros -- ver `paginacao` abaixo).
  const [pagina, setPagina] = useState(1);

  const [modalAberto, setModalAberto] = useState(false);
  const [fornecedorEmEdicao, setFornecedorEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);
  // Ordenação escolhida no cabeçalho, guardada durante a sessão de login;
  // mudar a ordenação volta para a página 1 (a página nunca é guardada).
  const ordenacao = useOrdenacao({ aoMudar: () => setPagina(1), persistirEm: 'fornecedores' });

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarFornecedores() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      let consulta = supabase
        .from('fornecedores')
        .select(
          'id, nome, nome_fantasia, razao_social, tipo_documento, documento, contato_nome, telefone, whatsapp, email, endereco, forma_pagamento, modalidade_compra, observacoes, ativo'
        )
        .order('nome_fantasia', {
          ascending: true,
          nullsFirst: false,
        });

      if (filtroStatus === 'ativos') {
        consulta = consulta.eq('ativo', true);
      } else if (filtroStatus === 'inativos') {
        consulta = consulta.eq('ativo', false);
      }

      const { data, error } = await consulta;

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error(
          'Erro ao carregar fornecedores:',
          error
        );

        setErro(
          'Não foi possível carregar a lista de fornecedores.'
        );

        setFornecedores([]);
      } else {
        setFornecedores(data || []);
      }

      setCarregando(false);
    }

    carregarFornecedores();

    return () => {
      efeitoAtivo = false;
    };
  }, [filtroStatus, recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);

    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  const buscaNormalizada = busca
    .trim()
    .toLowerCase();

  const buscaDigitos = apenasDigitos(busca);

  const fornecedoresFiltrados = fornecedores.filter(
    (fornecedor) => {
      if (
        filtroModalidade !== 'todas' &&
        fornecedor.modalidade_compra !== filtroModalidade
      ) {
        return false;
      }

      if (!buscaNormalizada) {
        return true;
      }

      const nomeFantasia = (
        fornecedor.nome_fantasia || ''
      ).toLowerCase();

      const razaoSocial = (
        fornecedor.razao_social || ''
      ).toLowerCase();

      const nomeLegado = (
        fornecedor.nome || ''
      ).toLowerCase();

      const telefoneTexto = (
        fornecedor.telefone || ''
      ).toLowerCase();

      const whatsappTexto = (
        fornecedor.whatsapp || ''
      ).toLowerCase();

      const textoBate =
        nomeFantasia.includes(buscaNormalizada) ||
        razaoSocial.includes(buscaNormalizada) ||
        nomeLegado.includes(buscaNormalizada) ||
        telefoneTexto.includes(buscaNormalizada) ||
        whatsappTexto.includes(buscaNormalizada);

      if (textoBate) {
        return true;
      }

      if (buscaDigitos) {
        const documentoDigitos = apenasDigitos(
          fornecedor.documento
        );

        const telefoneDigitos = apenasDigitos(
          fornecedor.telefone
        );

        const whatsappDigitos = apenasDigitos(
          fornecedor.whatsapp
        );

        if (
          documentoDigitos.includes(buscaDigitos) ||
          telefoneDigitos.includes(buscaDigitos) ||
          whatsappDigitos.includes(buscaDigitos)
        ) {
          return true;
        }
      }

      return false;
    }
  );

  // Qualquer mudança de filtro/busca volta para a página 1.
  function alterarFiltro(campo) {
    return (valor) => {
      filtros.definir(campo, valor);
      setPagina(1);
    };
  }

  const quantidadeFiltrosAtivos = [
    filtroStatus !== 'ativos',
    filtroModalidade !== 'todas',
    busca !== '',
  ].filter(Boolean).length;

  // Volta aos valores iniciais da tela (Status = Ativos, demais em "todas"/vazio).
  function limparFiltros() {
    filtros.redefinir();
    setPagina(1);
  }

  const podeEditar = hasPermissao(permissoes, PERMISSOES.FORNECEDORES_EDITAR);
  const podeInserir = hasPermissao(permissoes, PERMISSOES.FORNECEDORES_INSERIR);

  // UMA definição de colunas para a tabela (desktop) e os cartões (mobile).
  const colunas = [
    {
      chave: 'nome',
      rotulo: 'Nome',
      mobile: 'titulo',
      cartaoOrdem: 0,
      ordenavel: { valor: (fornecedor) => nomeExibicaoFornecedor(fornecedor) },
      render: (fornecedor) => nomeExibicaoFornecedor(fornecedor, '-'),
    },
    {
      chave: 'status',
      rotulo: 'Status',
      mobile: 'titulo',
      cartaoOrdem: 1,
      ordenavel: { tipo: 'booleano', valor: (fornecedor) => fornecedor.ativo },
      render: (fornecedor) => <BadgeStatus ativo={fornecedor.ativo} />,
    },
    {
      chave: 'documento',
      rotulo: 'Documento',
      semQuebra: true,
      ordenavel: { valor: (fornecedor) => fornecedor.documento },
      render: (fornecedor) => formatarDocumento(fornecedor.documento, fornecedor.tipo_documento),
    },
    {
      chave: 'contato',
      rotulo: 'Contato',
      soCartao: true, // some da tabela desktop (comprimia as demais); continua nos cartões mobile
      render: (fornecedor) => (
        <span className={estilos.contato}>{formatarContato(fornecedor.telefone, fornecedor.whatsapp)}</span>
      ),
    },
    { chave: 'pagamento', rotulo: 'Forma de pagamento', ordenavel: { valor: (fornecedor) => fornecedor.forma_pagamento }, render: (fornecedor) => fornecedor.forma_pagamento || '-' },
    {
      chave: 'modalidade',
      rotulo: 'Modalidade',
      ordenavel: { valor: (fornecedor) => fornecedor.modalidade_compra, ordem: ['pedido_com_entrega', 'compra_presencial'] },
      render: (fornecedor) => <BadgeModalidade modalidade={fornecedor.modalidade_compra} />,
    },
  ];

  // Ordem das colunas na tabela (como antes): Nome, Documento, Contato,
  // Forma de pagamento, Modalidade, Status.
  const colunasTabela = [colunas[0], colunas[2], colunas[3], colunas[4], colunas[5], colunas[1]];

  // Paginação VISUAL (client-side, 20 por página): a lista já vem inteira do
  // banco (filtro de Status na consulta; Modalidade e Buscar no navegador) e
  // aqui só se fatia o resultado já filtrado e ORDENADO (ordem padrão da
  // consulta, ou a coluna escolhida no cabeçalho -- aplicada ao conjunto
  // inteiro, antes de fatiar). Tabela e cartões recebem o mesmo subconjunto.
  const paginacao = paginarLista(ordenacao.ordenar(fornecedoresFiltrados, colunas), pagina);
  const paginaAtual = paginacao.paginaAtual;

  // Resultado encolheu (filtro, recarga): corrige a página guardada.
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  function abrirNovoFornecedor() {
    setFornecedorEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicao(fornecedor) {
    setFornecedorEmEdicao(fornecedor);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setFornecedorEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = fornecedorEmEdicao != null;

    fecharModal();

    setMensagemSucesso(
      estaEditando
        ? 'Fornecedor atualizado com sucesso.'
        : 'Fornecedor cadastrado com sucesso.'
    );

    setRecarregarTick((tick) => tick + 1);
  }

  return (
    <PageShell titulo="Fornecedores">
      <PageHeader
        titulo="Fornecedores"
        acoes={
          podeInserir && (
            <Button icone="plus" onClick={abrirNovoFornecedor}>
              Novo fornecedor
            </Button>
          )
        }
      />

      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      <FilterBar ativos={quantidadeFiltrosAtivos} onLimpar={limparFiltros}>
        <Field label="Buscar">
          <Input
            type="text"
            value={busca}
            onChange={(e) => alterarFiltro('busca')(e.target.value)}
            placeholder="Nome, razão social, documento, telefone..."
          />
        </Field>
        <Field label="Status">
          <Select value={filtroStatus} onChange={(e) => alterarFiltro('status')(e.target.value)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
        <Field label="Modalidade">
          <Select value={filtroModalidade} onChange={(e) => alterarFiltro('modalidade')(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="pedido_com_entrega">Pedido com entrega</option>
            <option value="compra_presencial">Compra presencial</option>
          </Select>
        </Field>
      </FilterBar>

      {carregando ? (
        <p role="status">Carregando fornecedores...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : fornecedores.length === 0 ? (
        <EmptyState>Nenhum fornecedor encontrado.</EmptyState>
      ) : fornecedoresFiltrados.length === 0 ? (
        <EmptyState>Nenhum resultado para esta busca/filtro.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Fornecedores"
            colunas={colunasTabela}
            linhas={paginacao.itens}
            chaveLinha={(fornecedor) => fornecedor.id}
            destaque={(fornecedor) => (fornecedor.ativo ? null : 'inativo')}
            cartoesAte={1180}
            ordenacao={ordenacao.props}
            renderAcoes={
              podeEditar
                ? (fornecedor) => (
                    <Button variante="secondary" tamanho="sm" icone="pencil" onClick={() => abrirEdicao(fornecedor)}>
                      Editar
                    </Button>
                  )
                : undefined
            }
          />

          <p className={estilos.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}{' '}
            {paginacao.total === 1 ? 'fornecedor' : 'fornecedores'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </div>
      )}

      {modalAberto && (
        <FornecedorForm
          fornecedor={fornecedorEmEdicao}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
          permissoes={permissoes}
        />
      )}
    </PageShell>
  );
}

export default function Fornecedores() {
  return (
    <RequireAuth
      permissao={
        PERMISSOES.FORNECEDORES_VISUALIZAR
      }
    >
      <FornecedoresConteudo />
    </RequireAuth>
  );
}
