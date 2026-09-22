import { useState } from 'react';
import ConfiguracaoComercialForm from './ConfiguracaoComercialForm';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import IconButton from '../ui/IconButton';
import SectionHeader from '../ui/SectionHeader';
import { createClient } from '../../lib/supabase/client';
import estilos from './catalogo.module.css';

// Card "Fornecedores" de /catalogo/[id]. Diferente de
// FornecedorRegras.js (que busca seus próprios dados por fornecedorId),
// este componente recebe `configuracoes` já carregado pela página --
// HistoricoComprasDoProduto precisa da mesma lista (para o preenchimento
// opcional em LancarCompraForm), então a busca fica centralizada em
// pages/catalogo/[id].js para não duplicar a query nem arriscar as duas
// listas ficarem dessincronizadas entre si.
export default function FornecedoresDoProduto({ produtoId, produtoUnidadeMedida, configuracoes, fornecedoresAtivos, podeEditar, onRecarregar }) {
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [configEmEdicao, setConfigEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  const [configParaExcluir, setConfigParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  function abrirNovaConfiguracao() {
    setConfigEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicaoConfiguracao(config) {
    setConfigEmEdicao(config);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setConfigEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = configEmEdicao != null;
    fecharModal();
    setMensagemSucesso(estaEditando ? 'Configuração atualizada com sucesso.' : 'Configuração cadastrada com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  function pedirExclusao(config) {
    setErroExclusao('');
    setConfigParaExcluir(config);
  }

  function cancelarExclusao() {
    setConfigParaExcluir(null);
    setErroExclusao('');
  }

  // Única forma permitida de excluir: a RPC excluir_produto_fornecedor
  // (migration 0025) -- SECURITY DEFINER, RPC-only por desenho (a tabela
  // não tem nenhuma policy de DELETE). Nunca .from('produto_fornecedores').delete().
  async function confirmarExclusao() {
    setExcluindo(true);
    setErroExclusao('');

    const supabase = createClient();
    const { error } = await supabase.rpc('excluir_produto_fornecedor', {
      p_produto_fornecedor_id: configParaExcluir.id,
    });

    setExcluindo(false);

    if (error) {
      console.error('Erro ao excluir configuração comercial:', error);
      setErroExclusao('Não foi possível excluir esta configuração. Tente novamente ou avise um administrador.');
      return;
    }

    setConfigParaExcluir(null);
    setMensagemSucesso('Configuração excluída com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  const configuracoesVisiveis = mostrarInativas ? configuracoes : configuracoes.filter((c) => c.ativo);

  return (
    <div>
      <SectionHeader
        titulo="Fornecedores"
        acao={podeEditar && <Button tamanho="sm" icone="plus" onClick={abrirNovaConfiguracao}>Nova configuração</Button>}
      />

      <Checkbox
        rotulo="Mostrar configurações inativas"
        checked={mostrarInativas}
        onChange={(e) => setMostrarInativas(e.target.checked)}
        className={estilos.mostrarInativas}
      />

      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      {configuracoesVisiveis.length === 0 ? (
        <p>Nenhum fornecedor cadastrado para este produto.</p>
      ) : (
        <div className={estilos.listaConfig}>
          {configuracoesVisiveis.map((config) => (
            <div key={config.id} className={estilos.itemConfig}>
              <div>
                <div className={estilos.itemConfigTitulo}>
                  {config.fornecedorNome} — {config.unidade_comercial}
                  {config.apresentacao ? ` (${config.apresentacao})` : ''}
                  {!config.ativo && <Badge tom="neutral">Inativa</Badge>}
                </div>

                {config.quantidade_embalagem != null && (
                  <div className={estilos.itemConfigDetalhe}>
                    1 {config.unidade_comercial} = {config.quantidade_embalagem} unidade(s)-base
                  </div>
                )}

                {config.controla_sacos_fechados && (
                  <div className={estilos.itemConfigDetalhe}>
                    Controla sacos fechados — {config.peso_por_saco_kg} kg/saco
                  </div>
                )}

                {config.codigo_produto_fornecedor && (
                  <div className={estilos.itemConfigDetalhe}>
                    Código no fornecedor: {config.codigo_produto_fornecedor}
                  </div>
                )}

                {config.observacao && (
                  <div className={estilos.itemConfigObservacao}>{config.observacao}</div>
                )}
              </div>

              {podeEditar && (
                <div className={estilos.itemConfigAcoes}>
                  <IconButton rotulo="Editar configuração" icone="pencil" tamanho="sm" onClick={() => abrirEdicaoConfiguracao(config)} />
                  <IconButton rotulo="Excluir configuração" icone="trash" tom="danger" tamanho="sm" onClick={() => pedirExclusao(config)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalAberto && (
        <ConfiguracaoComercialForm
          produtoId={produtoId}
          produtoUnidadeMedida={produtoUnidadeMedida}
          fornecedoresAtivos={fornecedoresAtivos}
          configuracao={configEmEdicao}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
        />
      )}

      {configParaExcluir && (
        <ConfirmarAcaoModal
          titulo="Excluir configuração comercial"
          mensagem={
            <>
              Tem certeza que deseja excluir a configuração <strong>{configParaExcluir.fornecedorNome} — {configParaExcluir.unidade_comercial}
              {configParaExcluir.apresentacao ? ` (${configParaExcluir.apresentacao})` : ''}</strong>?
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
