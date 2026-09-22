import { useState } from 'react';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { cx } from '../../lib/design/cx';
import { createClient } from '../../lib/supabase/client';
import estilos from './catalogo.module.css';

// Modal "Gerenciar classificações" de /catalogo -- duas áreas
// independentes (Seções, Categorias), SEM relação/hierarquia entre elas
// (decisão fechada na migration 0028: catalogo_secoes e
// catalogo_categorias não têm FK uma para a outra). Cada área é uma
// instância separada de BlocoClassificacao, mesma lógica, tabela/RPC
// diferentes.
//
// Criar/renomear: INSERT/UPDATE direto via supabase-js, protegido pelas
// policies existentes (catalogo_produtos.editar) -- não precisa de RPC,
// mesma lógica de qualquer outro cadastro simples do projeto. Excluir:
// SEMPRE via RPC (excluir_catalogo_secao/excluir_catalogo_categoria,
// migration 0028) -- nunca .delete() direto, já que não existe nenhuma
// policy de DELETE nessas tabelas por desenho.
//
// Como produtos.secao_id/categoria_id são FK (não cópia de texto), um
// UPDATE de nome aqui já reflete automaticamente em qualquer lugar que
// leia catalogo_secoes/catalogo_categorias -- por isso este modal só
// precisa devolver a lista atualizada para o componente pai (via
// aoAtualizarSecoes/aoAtualizarCategorias), sem tocar em nenhuma linha
// de produtos.

function ordenarPorNome(itens) {
  return [...itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

function mensagemErroClassificacao(error, nomeSingular) {
  if (error.code === '23505') {
    return `Já existe uma ${nomeSingular} com este nome.`;
  }
  if (error.code === '23514') {
    return 'O nome não pode ficar em branco.';
  }
  console.error(`Erro ao salvar ${nomeSingular}:`, error);
  return `Não foi possível salvar. Tente novamente ou avise um administrador.`;
}

// Mesmo princípio já usado em components/pedidos/ReceberPedidoModal.js
// (mensagemErroRecebimento): NUNCA mostrar error.message bruto na UI --
// só reconhecer o formato ESPECÍFICO e conhecido que a nossa própria RPC
// (excluir_catalogo_secao/excluir_catalogo_categoria, migration 0028)
// levanta, e devolver uma mensagem pré-escrita. Nenhum parser genérico:
// só uma regex estreita para o único formato que a RPC realmente produz
// ("...vinculada a N produto(s).") -- qualquer outra coisa (erro de
// rede, mudança futura no texto da RPC, erro inesperado) cai no
// fallback genérico, nunca expõe SQL/stack/texto técnico.
function mensagemErroExclusaoClassificacao(error, nomeSingularCapitalizado) {
  const msg = error?.message || '';
  const match = msg.match(/vinculada a (\d+) produto/);

  if (match) {
    return `Não é possível excluir esta ${nomeSingularCapitalizado} porque ela está sendo utilizada por ${match[1]} produtos.`;
  }

  console.error(`Erro ao excluir ${nomeSingularCapitalizado}:`, error);
  return 'Não foi possível excluir esta classificação. Ela pode estar em uso por produtos.';
}

function BlocoClassificacao({ titulo, nomeSingular, nomeSingularCapitalizado, itens, podeEditar, tabela, rpcExcluir, campoIdRpc, aoAtualizar }) {
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');

  const [idEmEdicao, setIdEmEdicao] = useState(null);
  const [nomeEditado, setNomeEditado] = useState('');
  const [salvandoId, setSalvandoId] = useState(null);
  const [erroPorId, setErroPorId] = useState({});

  const [itemParaExcluir, setItemParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  async function criar() {
    const nome = novoNome.trim();
    if (!nome) {
      setErroCriar('Informe um nome.');
      return;
    }

    setCriando(true);
    setErroCriar('');

    const supabase = createClient();
    const { data, error } = await supabase.from(tabela).insert({ nome }).select('id, nome').single();

    setCriando(false);

    if (error) {
      setErroCriar(mensagemErroClassificacao(error, nomeSingular));
      return;
    }

    setNovoNome('');
    aoAtualizar(ordenarPorNome([...itens, data]));
  }

  function abrirEdicao(item) {
    setIdEmEdicao(item.id);
    setNomeEditado(item.nome);
    setErroPorId((atual) => {
      const { [item.id]: _removido, ...resto } = atual;
      return resto;
    });
  }

  function cancelarEdicao() {
    setIdEmEdicao(null);
    setNomeEditado('');
  }

  async function salvarEdicao(id) {
    const nome = nomeEditado.trim();
    if (!nome) {
      setErroPorId((atual) => ({ ...atual, [id]: 'O nome não pode ficar em branco.' }));
      return;
    }

    setSalvandoId(id);
    setErroPorId((atual) => {
      const { [id]: _removido, ...resto } = atual;
      return resto;
    });

    const supabase = createClient();
    const { data, error } = await supabase.from(tabela).update({ nome }).eq('id', id).select('id, nome').single();

    setSalvandoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [id]: mensagemErroClassificacao(error, nomeSingular) }));
      return;
    }

    aoAtualizar(ordenarPorNome(itens.map((item) => (item.id === id ? data : item))));
    setIdEmEdicao(null);
    setNomeEditado('');
  }

  function pedirExclusao(item) {
    setErroExclusao('');
    setItemParaExcluir(item);
  }

  function cancelarExclusao() {
    setItemParaExcluir(null);
    setErroExclusao('');
  }

  // Mensagem de erro NUNCA mostrada verbatim -- mensagemErroExclusaoClassificacao
  // só reconhece o formato conhecido da nossa própria RPC (contagem de
  // produtos em uso) e devolve uma mensagem pré-escrita; qualquer coisa
  // não reconhecida cai num fallback genérico. Nunca CASCADE, nunca
  // limpa produtos automaticamente.
  async function confirmarExclusao() {
    setExcluindo(true);
    setErroExclusao('');

    const supabase = createClient();
    const { error } = await supabase.rpc(rpcExcluir, { [campoIdRpc]: itemParaExcluir.id });

    setExcluindo(false);

    if (error) {
      setErroExclusao(mensagemErroExclusaoClassificacao(error, nomeSingularCapitalizado));
      return;
    }

    aoAtualizar(itens.filter((item) => item.id !== itemParaExcluir.id));
    setItemParaExcluir(null);
  }

  return (
    <div className={estilos.blocoClassificacao}>
      <h4 className={estilos.blocoClassificacaoTitulo}>{titulo}</h4>

      {podeEditar && (
        <div className={estilos.criarClassificacao}>
          <Input
            type="text"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder={`Nova ${nomeSingular}`}
            aria-label={`Nova ${nomeSingular}`}
          />
          <Button tamanho="sm" onClick={criar} disabled={criando}>
            {criando ? 'Aguarde...' : '+ Nova'}
          </Button>
        </div>
      )}
      {erroCriar && <p className={estilos.linhaErro}>{erroCriar}</p>}

      {itens.length === 0 ? (
        <p>Nenhuma {nomeSingular} cadastrada.</p>
      ) : (
        <div className={estilos.listaClassificacao}>
          {itens.map((item) => {
            const emEdicao = idEmEdicao === item.id;
            const salvandoEsteItem = salvandoId === item.id;
            const erroItem = erroPorId[item.id];

            return (
              <div key={item.id}>
                <div className={cx(estilos.itemClassificacao, emEdicao && estilos.itemClassificacaoEmEdicao)}>
                  {emEdicao ? (
                    <Input
                      type="text"
                      value={nomeEditado}
                      onChange={(e) => setNomeEditado(e.target.value)}
                      className={estilos.itemClassificacaoNome}
                      aria-label={`Renomear ${nomeSingular}`}
                    />
                  ) : (
                    <span className={estilos.itemClassificacaoNome}>{item.nome}</span>
                  )}

                  {podeEditar && (
                    <div className={estilos.itemClassificacaoAcoes}>
                      {emEdicao ? (
                        <>
                          <IconButton
                            rotulo="Salvar"
                            icone="check"
                            tamanho="sm"
                            disabled={salvandoEsteItem}
                            onClick={() => salvarEdicao(item.id)}
                          />
                          <IconButton
                            rotulo="Cancelar"
                            icone="undo"
                            tamanho="sm"
                            disabled={salvandoEsteItem}
                            onClick={cancelarEdicao}
                          />
                        </>
                      ) : (
                        <>
                          <IconButton rotulo="Renomear" icone="pencil" tamanho="sm" onClick={() => abrirEdicao(item)} />
                          <IconButton rotulo="Excluir" icone="trash" tom="danger" tamanho="sm" onClick={() => pedirExclusao(item)} />
                        </>
                      )}
                    </div>
                  )}
                </div>
                {erroItem && <p className={estilos.linhaErro}>{erroItem}</p>}
              </div>
            );
          })}
        </div>
      )}

      {itemParaExcluir && (
        <ConfirmarAcaoModal
          titulo={`Excluir ${nomeSingular}`}
          mensagem={
            <>
              Tem certeza que deseja excluir <strong>{itemParaExcluir.nome}</strong>?
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

export default function GerenciarClassificacoesModal({ aberto, onFechar, secoes, categorias, podeEditar, aoAtualizarSecoes, aoAtualizarCategorias }) {
  if (!aberto) return null;

  return (
    <Modal titulo="Gerenciar classificações" onFechar={onFechar} largura="lg">
      {!podeEditar && (
        <p className={estilos.nota}>
          Você pode visualizar as classificações existentes. Criar, renomear ou excluir exige a permissão de edição do Catálogo.
        </p>
      )}

      <div className={estilos.classificacoes}>
        <BlocoClassificacao
          titulo="Seções"
          nomeSingular="seção"
          nomeSingularCapitalizado="Seção"
          itens={secoes}
          podeEditar={podeEditar}
          tabela="catalogo_secoes"
          rpcExcluir="excluir_catalogo_secao"
          campoIdRpc="p_secao_id"
          aoAtualizar={aoAtualizarSecoes}
        />
        <BlocoClassificacao
          titulo="Categorias"
          nomeSingular="categoria"
          nomeSingularCapitalizado="Categoria"
          itens={categorias}
          podeEditar={podeEditar}
          tabela="catalogo_categorias"
          rpcExcluir="excluir_catalogo_categoria"
          campoIdRpc="p_categoria_id"
          aoAtualizar={aoAtualizarCategorias}
        />
      </div>
    </Modal>
  );
}
