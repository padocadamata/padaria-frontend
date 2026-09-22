import { useState } from 'react';
import LancarCompraForm from './LancarCompraForm';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import IconButton from '../ui/IconButton';
import SectionHeader from '../ui/SectionHeader';
import { createClient } from '../../lib/supabase/client';
import estilos from './catalogo.module.css';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Mapa explícito (migration 0037 ampliou o domínio de origem para 3
// valores) -- nunca um ternário binário que trataria qualquer origem
// não-manual como "Recebimento", o que rotularia compra_presencial
// incorretamente.
const ORIGEM_LABEL = {
  manual: 'Manual',
  recebimento_pedido: 'Recebimento de pedido',
  compra_presencial: 'Compra presencial',
};

// Card "Histórico de compras" de /catalogo/[id]. `lancamentos` já vem
// carregado pela página (ver comentário em FornecedoresDoProduto.js
// sobre a mesma decisão). "Editar" só aparece para origem='manual' --
// linhas origem='recebimento_pedido' (recebimento de pedido de entrega,
// migration 0026) e origem='compra_presencial' (migration 0037) são
// somente leitura por desenho do banco (trigger
// produtos_historico_compras_protecao) -- a segunda é corrigida
// exclusivamente via "Editar compra presencial" em /pedidos, nunca por
// aqui.
export default function HistoricoComprasDoProduto({ produtoId, lancamentos, configuracoesComerciais, fornecedoresAtivos, podeEditar, onRecarregar }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [lancamentoEmEdicao, setLancamentoEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  const [lancamentoParaExcluir, setLancamentoParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  function abrirNovoLancamento() {
    setLancamentoEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicaoLancamento(lancamento) {
    setLancamentoEmEdicao(lancamento);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setLancamentoEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = lancamentoEmEdicao != null;
    fecharModal();
    setMensagemSucesso(estaEditando ? 'Lançamento atualizado com sucesso.' : 'Compra lançada com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  function pedirExclusao(lancamento) {
    setErroExclusao('');
    setLancamentoParaExcluir(lancamento);
  }

  function cancelarExclusao() {
    setLancamentoParaExcluir(null);
    setErroExclusao('');
  }

  // Única forma permitida de excluir: a RPC excluir_historico_compra_manual
  // (migration 0025) -- SECURITY DEFINER, RPC-only, e a UNICA camada que
  // garante origem='manual' (a tabela não tem policy de DELETE nenhuma).
  // Nunca .from('produtos_historico_compras').delete(). onRecarregar()
  // recarrega tanto esta lista quanto o Resumo de preços (mesmo
  // recarregarTick da página) -- última compra/menor preço refletem a
  // exclusão sem F5.
  async function confirmarExclusao() {
    setExcluindo(true);
    setErroExclusao('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_historico_compra_manual', {
      p_historico_id: lancamentoParaExcluir.id,
    });

    setExcluindo(false);

    if (error) {
      console.error('Erro ao excluir lançamento de compra:', error);
      setErroExclusao('Não foi possível excluir este lançamento. Tente novamente ou avise um administrador.');
      return;
    }

    setLancamentoParaExcluir(null);
    setMensagemSucesso('Lançamento excluído com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  const colunas = [
    { chave: 'data', rotulo: 'Data', mobile: 'titulo', render: (l) => formatarData(l.data_compra) },
    { chave: 'fornecedor', rotulo: 'Fornecedor', mobile: 'titulo', render: (l) => l.fornecedorNome },
    { chave: 'unidade', rotulo: 'Unidade', render: (l) => l.unidade_comercial },
    { chave: 'quantidade', rotulo: 'Quantidade', render: (l) => l.quantidade_comercial },
    { chave: 'precoUnitario', rotulo: 'Preço unitário', render: (l) => formatarMoeda(l.preco_unitario_comercial) },
    { chave: 'precoBase', rotulo: 'Preço-base', render: (l) => (l.preco_unitario_base != null ? formatarMoeda(l.preco_unitario_base) : '—') },
    { chave: 'origem', rotulo: 'Origem', render: (l) => ORIGEM_LABEL[l.origem] || l.origem },
  ];

  return (
    <div>
      <SectionHeader
        titulo="Histórico de compras"
        acao={podeEditar && <Button tamanho="sm" icone="plus" onClick={abrirNovoLancamento}>Lançar compra</Button>}
      />

      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      {lancamentos.length === 0 ? (
        <EmptyState>Nenhuma compra registrada para este produto.</EmptyState>
      ) : (
        <DataTable
          rotulo="Histórico de compras"
          colunas={colunas}
          linhas={lancamentos}
          chaveLinha={(l) => l.id}
          cartoesAte={700}
          renderAcoes={
            podeEditar
              ? (l) =>
                  l.origem === 'manual' && (
                    <div className={estilos.itemConfigAcoes}>
                      <IconButton rotulo="Editar lançamento" icone="pencil" tamanho="sm" onClick={() => abrirEdicaoLancamento(l)} />
                      <IconButton rotulo="Excluir lançamento" icone="trash" tom="danger" tamanho="sm" onClick={() => pedirExclusao(l)} />
                    </div>
                  )
              : undefined
          }
        />
      )}

      {modalAberto && (
        <LancarCompraForm
          produtoId={produtoId}
          fornecedoresAtivos={fornecedoresAtivos}
          configuracoesComerciais={configuracoesComerciais}
          lancamento={lancamentoEmEdicao}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
        />
      )}

      {lancamentoParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir lançamento de compra"
          mensagem={
            <>
              Tem certeza que deseja excluir a compra de <strong>{formatarData(lancamentoParaExcluir.data_compra)}</strong> —{' '}
              <strong>{lancamentoParaExcluir.fornecedorNome}</strong>, {formatarMoeda(lancamentoParaExcluir.preco_unitario_comercial)} /{' '}
              {lancamentoParaExcluir.unidade_comercial}?
              <br />
              Esta ação é definitiva e não pode ser desfeita.
            </>
          }
          perigo
          textoConfirmar="Excluir"
          confirmando={excluindo}
          erro={erroExclusao}
          onConfirmar={confirmarExclusao}
          onCancelar={cancelarExclusao}
          modalDS
        />
      )}
    </div>
  );
}
