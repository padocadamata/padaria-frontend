import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';

const MAX_LEN = 50;

function mensagemErroCategoria(error) {
  const code = error?.code;
  if (code === '23505') return 'Já existe uma categoria com este valor.';
  if (code === '23514') return 'O valor da categoria não pode ficar em branco.';
  if (code === '22001') return `O valor da categoria não pode ultrapassar ${MAX_LEN} caracteres.`;
  return error?.message || 'Não foi possível salvar a categoria.';
}

function textoQtdItens(qtd) {
  return qtd === 1 ? '1 item da Agenda' : `${qtd} itens da Agenda`;
}

// Regra global do projeto para dados mestres: persistidos em MAIÚSCULAS,
// preservando acentos. Normaliza na PERSISTÊNCIA (antes do INSERT/
// UPDATE), nunca só na exibição via CSS -- toUpperCase() do JS já
// converte corretamente á/ã/ç/õ/ê etc.
function normalizarCategoria(texto) {
  return texto.trim().toUpperCase();
}

// Gerenciamento de agenda_categorias -- mesmo ciclo (criar/renomear/
// ativar/inativar, sem exclusão física) já usado por
// GerenciarClassificacoesProducaoModal.js para producao_tipos/grupos,
// com um único bloco de classificação em vez de dois.
export default function GerenciarCategoriasAgendaModal({ aberto, onFechar, categorias, podeGerenciar, onAtualizar }) {
  const [usoPorValor, setUsoPorValor] = useState(new Map());
  const [carregandoUso, setCarregandoUso] = useState(true);
  const [usoTick, setUsoTick] = useState(0);

  const [novoValor, setNovoValor] = useState('');
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null);
  const [valorEditado, setValorEditado] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [alternandoAtivo, setAlternandoAtivo] = useState(null);
  const [acaoPendente, setAcaoPendente] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erroConfirmacao, setErroConfirmacao] = useState('');

  useEffect(() => {
    if (!aberto) return undefined;
    let efeitoAtivo = true;

    async function carregarUso() {
      setCarregandoUso(true);
      const supabase = createClient();
      const { data, error } = await supabase.from('agenda_itens').select('categoria');
      if (!efeitoAtivo) return;
      if (error) {
        console.error('Erro ao carregar uso de categorias da Agenda:', error);
        setCarregandoUso(false);
        return;
      }
      const mapa = new Map();
      (data || []).forEach((it) => {
        if (it.categoria) mapa.set(it.categoria, (mapa.get(it.categoria) || 0) + 1);
      });
      setUsoPorValor(mapa);
      setCarregandoUso(false);
    }

    carregarUso();
    return () => {
      efeitoAtivo = false;
    };
  }, [aberto, usoTick]);

  function aoAlterar() {
    onAtualizar();
    setUsoTick((tick) => tick + 1);
  }

  async function criar(e) {
    e.preventDefault();
    setErro('');
    const valor = normalizarCategoria(novoValor);
    if (!valor) {
      setErro('Informe o valor da categoria.');
      return;
    }
    if (valor.length > MAX_LEN) {
      setErro(`O valor da categoria não pode ultrapassar ${MAX_LEN} caracteres.`);
      return;
    }
    setSalvandoNovo(true);
    const supabase = createClient();
    const { error } = await supabase.from('agenda_categorias').insert({ valor });
    setSalvandoNovo(false);
    if (error) {
      setErro(mensagemErroCategoria(error));
      return;
    }
    setNovoValor('');
    aoAlterar();
  }

  function iniciarEdicao(item) {
    setErro('');
    setEditando(item.valor);
    setValorEditado(item.valor);
  }

  function cancelarEdicao() {
    setEditando(null);
    setValorEditado('');
  }

  async function executarRenomear(valorOriginal, novo) {
    setSalvandoEdicao(true);
    const supabase = createClient();
    const { error } = await supabase.from('agenda_categorias').update({ valor: novo }).eq('valor', valorOriginal);
    setSalvandoEdicao(false);
    return error || null;
  }

  async function salvarEdicao(valorOriginal) {
    setErro('');
    const novo = normalizarCategoria(valorEditado);
    if (!novo) {
      setErro('O valor da categoria não pode ficar em branco.');
      return;
    }
    if (novo.length > MAX_LEN) {
      setErro(`O valor da categoria não pode ultrapassar ${MAX_LEN} caracteres.`);
      return;
    }
    if (novo === valorOriginal) {
      cancelarEdicao();
      return;
    }
    if (carregandoUso) {
      setErro('Aguarde o carregamento das informações de uso antes de renomear.');
      return;
    }

    const usoQtd = usoPorValor.get(valorOriginal) || 0;
    if (usoQtd > 0) {
      setAcaoPendente({ tipo: 'renomear', valorOriginal, valorNovo: novo, usoQtd });
      return;
    }

    const error = await executarRenomear(valorOriginal, novo);
    if (error) {
      setErro(mensagemErroCategoria(error));
      return;
    }
    cancelarEdicao();
    aoAlterar();
  }

  async function executarAlternarAtivo(valor, novoAtivo) {
    setAlternandoAtivo(valor);
    const supabase = createClient();
    const { error } = await supabase.from('agenda_categorias').update({ ativo: novoAtivo }).eq('valor', valor);
    setAlternandoAtivo(null);
    return error || null;
  }

  async function alternarAtivo(item) {
    setErro('');
    if (item.ativo) {
      if (carregandoUso) {
        setErro('Aguarde o carregamento das informações de uso antes de inativar.');
        return;
      }
      const usoQtd = usoPorValor.get(item.valor) || 0;
      if (usoQtd > 0) {
        setAcaoPendente({ tipo: 'inativar', valor: item.valor, usoQtd });
        return;
      }
    }
    const error = await executarAlternarAtivo(item.valor, !item.ativo);
    if (error) {
      setErro(mensagemErroCategoria(error));
      return;
    }
    aoAlterar();
  }

  function cancelarAcaoPendente() {
    setAcaoPendente(null);
    setErroConfirmacao('');
  }

  async function confirmarAcaoPendente() {
    if (!acaoPendente) return;
    setConfirmando(true);
    setErroConfirmacao('');

    const error =
      acaoPendente.tipo === 'renomear'
        ? await executarRenomear(acaoPendente.valorOriginal, acaoPendente.valorNovo)
        : await executarAlternarAtivo(acaoPendente.valor, false);

    setConfirmando(false);
    if (error) {
      setErroConfirmacao(mensagemErroCategoria(error));
      return;
    }
    setAcaoPendente(null);
    if (acaoPendente.tipo === 'renomear') cancelarEdicao();
    aoAlterar();
  }

  if (!aberto) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onFechar}
    >
      <div
        style={{ background: '#fff', borderRadius: 8, padding: 20, width: 420, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Gerenciar categorias</h2>
          <button type="button" onClick={onFechar} style={{ fontSize: 13 }}>Fechar</button>
        </div>

        {carregandoUso && <p style={{ fontSize: 11, color: '#888', marginTop: 0 }}>Carregando informações de uso...</p>}

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px 0' }}>
          {categorias.length === 0 && <li style={{ color: '#888', fontSize: 13, padding: '4px 0' }}>Nenhuma cadastrada.</li>}
          {categorias.map((item) => {
            const emEdicao = editando === item.valor;
            const usoQtd = usoPorValor.get(item.valor) || 0;
            return (
              <li key={item.valor} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eee' }}>
                {emEdicao ? (
                  <>
                    <input
                      type="text"
                      value={valorEditado}
                      maxLength={MAX_LEN}
                      onChange={(e) => setValorEditado(e.target.value)}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
                      autoFocus
                    />
                    <button type="button" onClick={() => salvarEdicao(item.valor)} disabled={salvandoEdicao || carregandoUso} style={{ fontSize: 12 }}>
                      Salvar
                    </button>
                    <button type="button" onClick={cancelarEdicao} style={{ fontSize: 12 }}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontSize: 13, color: item.ativo ? '#111' : '#999', textDecoration: item.ativo ? 'none' : 'line-through' }}>
                      {item.valor}
                    </span>
                    <span
                      style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 4,
                        background: item.ativo ? '#e6f4ea' : '#f1f1f1', color: item.ativo ? '#1e7e34' : '#777',
                      }}
                    >
                      {item.ativo ? 'Ativa' : 'Inativa'}
                    </span>
                    {usoQtd > 0 && <span style={{ fontSize: 11, color: '#888' }}>{usoQtd} em uso</span>}
                    {podeGerenciar && (
                      <>
                        <button type="button" onClick={() => iniciarEdicao(item)} style={{ fontSize: 12 }}>Renomear</button>
                        <button
                          type="button"
                          onClick={() => alternarAtivo(item)}
                          disabled={alternandoAtivo === item.valor || carregandoUso}
                          style={{ fontSize: 12 }}
                        >
                          {item.ativo ? 'Inativar' : 'Ativar'}
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>

        {podeGerenciar && (
          <form onSubmit={criar} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Nova categoria"
              value={novoValor}
              maxLength={MAX_LEN}
              onChange={(e) => setNovoValor(e.target.value)}
              style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
            />
            <button type="submit" disabled={salvandoNovo} style={{ fontSize: 12 }}>Adicionar</button>
          </form>
        )}

        {erro && <p style={{ color: '#c0392b', fontSize: 12, marginTop: 6 }}>{erro}</p>}

        <p style={{ fontSize: 11, color: '#888', marginTop: 12 }}>
          Não é possível excluir categorias — apenas inativá-las. Uma categoria inativa continua aparecendo nos
          itens já cadastrados, mas deixa de ser oferecida para itens novos.
        </p>

        {acaoPendente && (
          <ConfirmarAcaoModal
            titulo={acaoPendente.tipo === 'renomear' ? 'Renomear categoria' : 'Inativar categoria'}
            mensagem={
              acaoPendente.tipo === 'renomear' ? (
                <>
                  Esta categoria está sendo utilizada por <strong>{textoQtdItens(acaoPendente.usoQtd)}</strong>. Ao
                  renomeá-la, a categoria será atualizada {acaoPendente.usoQtd === 1 ? 'nesse item' : 'nesses itens'}.
                  Deseja continuar?
                </>
              ) : (
                <>
                  Esta categoria está sendo utilizada por <strong>{textoQtdItens(acaoPendente.usoQtd)}</strong>. Ela
                  continuará vinculada, mas não ficará disponível para itens novos. Deseja inativar?
                </>
              )
            }
            textoConfirmar={acaoPendente.tipo === 'renomear' ? 'Renomear' : 'Inativar'}
            confirmando={confirmando}
            erro={erroConfirmacao}
            onConfirmar={confirmarAcaoPendente}
            onCancelar={cancelarAcaoPendente}
          />
        )}
      </div>
    </div>
  );
}
