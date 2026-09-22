import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { cx } from '../../lib/design/cx';
import estilos from './agenda.module.css';

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
    <Modal titulo="Gerenciar categorias" onFechar={onFechar} largura="sm">
      {carregandoUso && <p className={estilos.detalheMeta}>Carregando informações de uso...</p>}

      <ul className={estilos.listaCategorias}>
        {categorias.length === 0 && <li className={estilos.detalheMeta}>Nenhuma cadastrada.</li>}
        {categorias.map((item) => {
          const emEdicao = editando === item.valor;
          const usoQtd = usoPorValor.get(item.valor) || 0;
          return (
            <li key={item.valor} className={estilos.itemCategoria}>
              {emEdicao ? (
                <>
                  <Input
                    type="text"
                    value={valorEditado}
                    maxLength={MAX_LEN}
                    onChange={(e) => setValorEditado(e.target.value)}
                    className={estilos.itemCategoriaNome}
                    aria-label="Renomear categoria"
                    autoFocus
                  />
                  <Button tamanho="sm" onClick={() => salvarEdicao(item.valor)} disabled={salvandoEdicao || carregandoUso}>
                    Salvar
                  </Button>
                  <Button tamanho="sm" variante="secondary" onClick={cancelarEdicao}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <span className={cx(estilos.itemCategoriaNome, !item.ativo && estilos.itemCategoriaInativa)}>
                    {item.valor}
                  </span>
                  <Badge tom={item.ativo ? 'success' : 'neutral'}>{item.ativo ? 'Ativa' : 'Inativa'}</Badge>
                  {usoQtd > 0 && <span className={estilos.itemCategoriaUso}>{usoQtd} em uso</span>}
                  {podeGerenciar && (
                    <>
                      <Button tamanho="sm" variante="secondary" onClick={() => iniciarEdicao(item)}>Renomear</Button>
                      <Button
                        tamanho="sm"
                        variante="secondary"
                        onClick={() => alternarAtivo(item)}
                        disabled={alternandoAtivo === item.valor || carregandoUso}
                      >
                        {item.ativo ? 'Inativar' : 'Ativar'}
                      </Button>
                    </>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {podeGerenciar && (
        <form onSubmit={criar} className={estilos.criarCategoria}>
          <Input
            type="text"
            placeholder="Nova categoria"
            value={novoValor}
            maxLength={MAX_LEN}
            onChange={(e) => setNovoValor(e.target.value)}
            aria-label="Nova categoria"
          />
          <Button type="submit" disabled={salvandoNovo}>Adicionar</Button>
        </form>
      )}

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <p className={estilos.notaCategorias}>
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
          modalDS
        />
      )}
    </Modal>
  );
}
