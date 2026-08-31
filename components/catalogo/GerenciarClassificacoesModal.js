import { useState } from 'react';
import { BotaoIconeAcao, IconeLapis, IconeLixeira, IconeCheck, IconeCancelar } from '../producao/IconesAcoes';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import { createClient } from '../../lib/supabase/client';

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

function BlocoClassificacao({ titulo, nomeSingular, nomeSingularCapitalizado, itens, podeEditar, corPrimaria, tabela, rpcExcluir, campoIdRpc, aoAtualizar }) {
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
    <div style={{ flex: '1 1 260px', minWidth: '260px' }}>
      <h4 style={{ margin: '0 0 10px 0', color: corPrimaria }}>{titulo}</h4>

      {podeEditar && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          <input
            type="text"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder={`Nova ${nomeSingular}`}
            style={{ flex: 1, padding: '7px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '13px' }}
          />
          <button
            type="button"
            onClick={criar}
            disabled={criando}
            style={{
              padding: '7px 12px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: criando ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}
          >
            {criando ? 'Aguarde...' : '+ Nova'}
          </button>
        </div>
      )}
      {erroCriar && <p style={{ color: '#f44336', fontSize: '13px', marginTop: '-4px', marginBottom: '10px' }}>{erroCriar}</p>}

      {itens.length === 0 ? (
        <p style={{ color: '#666', fontSize: '13px' }}>Nenhuma {nomeSingular} cadastrada.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
          {itens.map((item) => {
            const emEdicao = idEmEdicao === item.id;
            const salvandoEsteItem = salvandoId === item.id;
            const erroItem = erroPorId[item.id];

            return (
              <div key={item.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px',
                    backgroundColor: emEdicao ? '#fff8e1' : '#f9f9f9',
                    borderRadius: '5px',
                  }}
                >
                  {emEdicao ? (
                    <input
                      type="text"
                      value={nomeEditado}
                      onChange={(e) => setNomeEditado(e.target.value)}
                      style={{ flex: 1, padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
                    />
                  ) : (
                    <span style={{ flex: 1, fontSize: '14px' }}>{item.nome}</span>
                  )}

                  {podeEditar && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {emEdicao ? (
                        <>
                          <BotaoIconeAcao
                            rotulo="Salvar"
                            icone={IconeCheck}
                            cor="#4CAF50"
                            disabled={salvandoEsteItem}
                            onClick={() => salvarEdicao(item.id)}
                          />
                          <BotaoIconeAcao
                            rotulo="Cancelar"
                            icone={IconeCancelar}
                            disabled={salvandoEsteItem}
                            onClick={cancelarEdicao}
                          />
                        </>
                      ) : (
                        <>
                          <BotaoIconeAcao rotulo="Renomear" icone={IconeLapis} cor={corPrimaria} onClick={() => abrirEdicao(item)} />
                          <BotaoIconeAcao rotulo="Excluir" icone={IconeLixeira} destrutivo onClick={() => pedirExclusao(item)} />
                        </>
                      )}
                    </div>
                  )}
                </div>
                {erroItem && <p style={{ color: '#f44336', fontSize: '12px', margin: '4px 0 0 4px' }}>{erroItem}</p>}
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
          corPrimaria={corPrimaria}
          perigo
          textoConfirmar="Excluir"
          confirmando={excluindo}
          erro={erroExclusao}
          onConfirmar={confirmarExclusao}
          onCancelar={cancelarExclusao}
        />
      )}
    </div>
  );
}

const overlayEstilo = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '20px',
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '640px',
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

export default function GerenciarClassificacoesModal({ aberto, onFechar, secoes, categorias, podeEditar, corPrimaria = '#8B4513', aoAtualizarSecoes, aoAtualizarCategorias }) {
  if (!aberto) return null;

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, color: corPrimaria }}>Gerenciar classificações</h3>
          <button
            type="button"
            onClick={onFechar}
            style={{ padding: '6px 14px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Fechar
          </button>
        </div>

        {!podeEditar && (
          <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
            Você pode visualizar as classificações existentes. Criar, renomear ou excluir exige a permissão de edição do Catálogo.
          </p>
        )}

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <BlocoClassificacao
            titulo="Seções"
            nomeSingular="seção"
            nomeSingularCapitalizado="Seção"
            itens={secoes}
            podeEditar={podeEditar}
            corPrimaria={corPrimaria}
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
            corPrimaria={corPrimaria}
            tabela="catalogo_categorias"
            rpcExcluir="excluir_catalogo_categoria"
            campoIdRpc="p_categoria_id"
            aoAtualizar={aoAtualizarCategorias}
          />
        </div>
      </div>
    </div>
  );
}
