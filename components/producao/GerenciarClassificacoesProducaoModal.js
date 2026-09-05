import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';

function mensagemErroClassificacaoProducao(error, rotulo, maxLen) {
  const code = error?.code;
  if (code === '23505') {
    return `Já existe um ${rotulo} com este valor.`;
  }
  if (code === '23514') {
    return `O valor do ${rotulo} não pode ficar em branco.`;
  }
  if (code === '22001') {
    return `O valor do ${rotulo} não pode ultrapassar ${maxLen} caracteres.`;
  }
  return error?.message || `Não foi possível salvar o ${rotulo}.`;
}

function textoQtdProdutos(qtd) {
  return qtd === 1 ? '1 produto de produção' : `${qtd} produtos de produção`;
}

function BlocoClassificacaoProducao({
  titulo,
  rotulo,
  tabela,
  maxLen,
  itens,
  usoPorValor,
  carregandoUso,
  podeGerenciar,
  onAlterado,
}) {
  const [novoValor, setNovoValor] = useState('');
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null); // valor original em edição
  const [valorEditado, setValorEditado] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [alternandoAtivo, setAlternandoAtivo] = useState(null);

  // Ação pendente de confirmação (renomear/inativar em uso) -- só existe
  // quando o valor afetado tem uso > 0. Renomear sem uso, inativar sem
  // uso, e ativar (em qualquer caso) nunca passam por aqui.
  const [acaoPendente, setAcaoPendente] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erroConfirmacao, setErroConfirmacao] = useState('');

  async function criar(e) {
    e.preventDefault();
    setErro('');
    const valor = novoValor.trim();
    if (!valor) {
      setErro(`Informe o valor do ${rotulo}.`);
      return;
    }
    if (valor.length > maxLen) {
      setErro(`O valor do ${rotulo} não pode ultrapassar ${maxLen} caracteres.`);
      return;
    }
    setSalvandoNovo(true);
    const supabase = createClient();
    const { error } = await supabase.from(tabela).insert({ valor });
    setSalvandoNovo(false);
    if (error) {
      setErro(mensagemErroClassificacaoProducao(error, rotulo, maxLen));
      return;
    }
    setNovoValor('');
    onAlterado();
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
    const { error } = await supabase.from(tabela).update({ valor: novo }).eq('valor', valorOriginal);
    setSalvandoEdicao(false);
    if (error) {
      return error;
    }
    return null;
  }

  async function salvarEdicao(valorOriginal) {
    setErro('');
    const novo = valorEditado.trim();
    if (!novo) {
      setErro(`O valor do ${rotulo} não pode ficar em branco.`);
      return;
    }
    if (novo.length > maxLen) {
      setErro(`O valor do ${rotulo} não pode ultrapassar ${maxLen} caracteres.`);
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
      // Renomear em uso exige confirmação explícita -- o UPDATE só
      // acontece depois que o usuário confirmar o impacto (ON UPDATE
      // CASCADE propaga para todas as receitas vinculadas).
      setAcaoPendente({ tipo: 'renomear', valorOriginal, valorNovo: novo, usoQtd });
      return;
    }

    const error = await executarRenomear(valorOriginal, novo);
    if (error) {
      setErro(mensagemErroClassificacaoProducao(error, rotulo, maxLen));
      return;
    }
    cancelarEdicao();
    onAlterado();
  }

  async function executarAlternarAtivo(valor, novoAtivo) {
    setAlternandoAtivo(valor);
    const supabase = createClient();
    const { error } = await supabase.from(tabela).update({ ativo: novoAtivo }).eq('valor', valor);
    setAlternandoAtivo(null);
    if (error) {
      return error;
    }
    return null;
  }

  async function alternarAtivo(item) {
    setErro('');

    if (item.ativo) {
      // Inativar: NÃO altera nenhuma receita (a FK não depende de ativo),
      // mas em uso exige confirmação explícita do impacto na disponibilidade
      // para novas escolhas.
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

    // Ativar novamente (item.ativo === false) nunca exige confirmação.
    const error = await executarAlternarAtivo(item.valor, !item.ativo);
    if (error) {
      setErro(mensagemErroClassificacaoProducao(error, rotulo, maxLen));
      return;
    }
    onAlterado();
  }

  function cancelarAcaoPendente() {
    setAcaoPendente(null);
    setErroConfirmacao('');
  }

  async function confirmarAcaoPendente() {
    if (!acaoPendente) return;
    setConfirmando(true);
    setErroConfirmacao('');

    let error;
    if (acaoPendente.tipo === 'renomear') {
      error = await executarRenomear(acaoPendente.valorOriginal, acaoPendente.valorNovo);
    } else {
      error = await executarAlternarAtivo(acaoPendente.valor, false);
    }

    setConfirmando(false);

    if (error) {
      setErroConfirmacao(mensagemErroClassificacaoProducao(error, rotulo, maxLen));
      return;
    }

    setAcaoPendente(null);
    if (acaoPendente.tipo === 'renomear') {
      cancelarEdicao();
    }
    onAlterado();
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{titulo}</h3>
      {carregandoUso && (
        <p style={{ fontSize: 11, color: '#888', marginTop: 0 }}>Carregando informações de uso...</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px 0' }}>
        {itens.length === 0 && (
          <li style={{ color: '#888', fontSize: 13, padding: '4px 0' }}>Nenhum cadastrado.</li>
        )}
        {itens.map((item) => {
          const emEdicao = editando === item.valor;
          const usoQtd = usoPorValor.get(item.valor) || 0;
          return (
            <li
              key={item.valor}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              {emEdicao ? (
                <>
                  <input
                    type="text"
                    value={valorEditado}
                    maxLength={maxLen}
                    onChange={(e) => setValorEditado(e.target.value)}
                    style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => salvarEdicao(item.valor)}
                    disabled={salvandoEdicao || carregandoUso}
                    style={{ fontSize: 12 }}
                  >
                    Salvar
                  </button>
                  <button type="button" onClick={cancelarEdicao} style={{ fontSize: 12 }}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: item.ativo ? '#111' : '#999',
                      textDecoration: item.ativo ? 'none' : 'line-through',
                    }}
                  >
                    {item.valor}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: item.ativo ? '#e6f4ea' : '#f1f1f1',
                      color: item.ativo ? '#1e7e34' : '#777',
                    }}
                  >
                    {item.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                  {usoQtd > 0 && (
                    <span style={{ fontSize: 11, color: '#888' }}>
                      {usoQtd} em uso
                    </span>
                  )}
                  {podeGerenciar && (
                    <>
                      <button
                        type="button"
                        onClick={() => iniciarEdicao(item)}
                        style={{ fontSize: 12 }}
                      >
                        Renomear
                      </button>
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
            placeholder={`Novo ${rotulo}`}
            value={novoValor}
            maxLength={maxLen}
            onChange={(e) => setNovoValor(e.target.value)}
            style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
          />
          <button type="submit" disabled={salvandoNovo} style={{ fontSize: 12 }}>
            Adicionar
          </button>
        </form>
      )}

      {erro && <p style={{ color: '#c0392b', fontSize: 12, marginTop: 6 }}>{erro}</p>}

      {acaoPendente && (
        <ConfirmarAcaoModal
          titulo={acaoPendente.tipo === 'renomear' ? `Renomear ${rotulo}` : `Inativar ${rotulo}`}
          mensagem={
            acaoPendente.tipo === 'renomear' ? (
              <>
                Esta classificação está sendo utilizada por{' '}
                <strong>{textoQtdProdutos(acaoPendente.usoQtd)}</strong>. Ao renomeá-la, a
                classificação será atualizada {acaoPendente.usoQtd === 1 ? 'nesse produto' : 'nesses produtos'}.
                Deseja continuar?
              </>
            ) : (
              <>
                Esta classificação está sendo utilizada por{' '}
                <strong>{textoQtdProdutos(acaoPendente.usoQtd)}</strong>. Ela continuará vinculada a{' '}
                {acaoPendente.usoQtd === 1 ? 'esse produto' : 'esses produtos'}, mas não ficará disponível
                para novas escolhas. Deseja inativar?
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
  );
}

export default function GerenciarClassificacoesProducaoModal({
  aberto,
  onFechar,
  tipos,
  grupos,
  podeGerenciar,
  onAtualizar,
}) {
  // Contagem "em uso" carregada AQUI, direto de receitas.tipo/grupo, sem
  // depender da lista já carregada por pages/producao/produtos.js -- essa
  // lista é hoje completa (sem filtro/paginação server-side), mas uma ação
  // administrativa com ON UPDATE CASCADE não pode ficar refém de uma
  // premissa sobre outra tela que pode mudar no futuro. Consulta simples e
  // seletiva (só as 2 colunas), sem join com produtos -- RLS de receitas já
  // permite SELECT irrestrito para authenticated.
  const [usoPorTipo, setUsoPorTipo] = useState(new Map());
  const [usoPorGrupo, setUsoPorGrupo] = useState(new Map());
  const [carregandoUso, setCarregandoUso] = useState(true);
  const [usoTick, setUsoTick] = useState(0);

  useEffect(() => {
    if (!aberto) {
      return undefined;
    }

    let efeitoAtivo = true;

    async function carregarUso() {
      setCarregandoUso(true);
      const supabase = createClient();
      const { data, error } = await supabase.from('receitas').select('tipo, grupo');

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error('Erro ao carregar uso de classificações de Produção:', error);
        setCarregandoUso(false);
        return;
      }

      const mapaTipo = new Map();
      const mapaGrupo = new Map();
      (data || []).forEach((receita) => {
        if (receita.tipo) {
          mapaTipo.set(receita.tipo, (mapaTipo.get(receita.tipo) || 0) + 1);
        }
        if (receita.grupo) {
          mapaGrupo.set(receita.grupo, (mapaGrupo.get(receita.grupo) || 0) + 1);
        }
      });

      setUsoPorTipo(mapaTipo);
      setUsoPorGrupo(mapaGrupo);
      setCarregandoUso(false);
    }

    carregarUso();

    return () => {
      efeitoAtivo = false;
    };
  }, [aberto, usoTick]);

  function aoAlterarClassificacao() {
    onAtualizar();
    setUsoTick((tick) => tick + 1);
  }

  if (!aberto) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onFechar}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 20,
          width: 420,
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Gerenciar Classificações</h2>
          <button type="button" onClick={onFechar} style={{ fontSize: 13 }}>
            Fechar
          </button>
        </div>

        <BlocoClassificacaoProducao
          titulo="TIPOS DE PRODUÇÃO"
          rotulo="Tipo"
          tabela="producao_tipos"
          maxLen={50}
          itens={tipos}
          usoPorValor={usoPorTipo}
          carregandoUso={carregandoUso}
          podeGerenciar={podeGerenciar}
          onAlterado={aoAlterarClassificacao}
        />

        <BlocoClassificacaoProducao
          titulo="GRUPOS DE PRODUÇÃO"
          rotulo="Grupo"
          tabela="producao_grupos"
          maxLen={10}
          itens={grupos}
          usoPorValor={usoPorGrupo}
          carregandoUso={carregandoUso}
          podeGerenciar={podeGerenciar}
          onAlterado={aoAlterarClassificacao}
        />

        <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          Não é possível excluir Tipos/Grupos — apenas inativá-los. Um valor
          inativo continua disponível nas produções já cadastradas, mas deixa
          de ser oferecido para novas escolhas.
        </p>
      </div>
    </div>
  );
}
