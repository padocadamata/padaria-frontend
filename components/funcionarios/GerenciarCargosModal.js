import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { normalizarMaiusculas } from '../../lib/funcionarios/normalizacao';

const MAX_LEN = 80;

// Gerenciamento de public.funcionarios_cargos -- mesmo ciclo (criar/
// renomear/ativar/inativar, SEM exclusão física) já usado por
// GerenciarCategoriasAgendaModal.js para agenda_categorias, mas com
// chave primária `id` (não `valor`) -- cargo_id é FK real em
// funcionarios.cargo_id, então renomear aqui já reflete automaticamente
// em qualquer lugar que exiba o nome via join, sem precisar de nenhuma
// cascata manual (diferente de agenda_categorias, que copia texto).
function mensagemErroCargo(error) {
  if (error?.code === '23505') return 'Já existe um cargo com este nome.';
  if (error?.code === '23514') return 'O nome do cargo não pode ficar em branco.';
  console.error('Erro ao salvar cargo:', error);
  return 'Não foi possível salvar o cargo. Tente novamente ou avise um administrador.';
}

export default function GerenciarCargosModal({ aberto, onFechar, cargos, podeGerenciar, corPrimaria = '#8B4513', onAtualizar }) {
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');

  const [idEmEdicao, setIdEmEdicao] = useState(null);
  const [nomeEditado, setNomeEditado] = useState('');
  const [salvandoId, setSalvandoId] = useState(null);
  const [erroPorId, setErroPorId] = useState({});
  const [alternandoId, setAlternandoId] = useState(null);

  if (!aberto) return null;

  async function criar(e) {
    e.preventDefault();
    const nome = normalizarMaiusculas(novoNome);
    if (!nome) {
      setErroCriar('Informe o nome do cargo.');
      return;
    }
    if (nome.length > MAX_LEN) {
      setErroCriar(`O nome do cargo não pode ultrapassar ${MAX_LEN} caracteres.`);
      return;
    }

    setCriando(true);
    setErroCriar('');
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios_cargos').insert({ nome }).select('id, nome, ativo').single();
    setCriando(false);

    if (error) {
      setErroCriar(mensagemErroCargo(error));
      return;
    }
    setNovoNome('');
    onAtualizar([...cargos, data].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })));
  }

  function iniciarEdicao(cargo) {
    setIdEmEdicao(cargo.id);
    setNomeEditado(cargo.nome);
    setErroPorId((atual) => {
      const { [cargo.id]: _removido, ...resto } = atual;
      return resto;
    });
  }

  function cancelarEdicao() {
    setIdEmEdicao(null);
    setNomeEditado('');
  }

  async function salvarEdicao(id) {
    const nome = normalizarMaiusculas(nomeEditado);
    if (!nome) {
      setErroPorId((atual) => ({ ...atual, [id]: 'O nome do cargo não pode ficar em branco.' }));
      return;
    }

    setSalvandoId(id);
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios_cargos').update({ nome }).eq('id', id).select('id, nome, ativo').single();
    setSalvandoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [id]: mensagemErroCargo(error) }));
      return;
    }
    onAtualizar(cargos.map((c) => (c.id === id ? data : c)));
    cancelarEdicao();
  }

  async function alternarAtivo(cargo) {
    setAlternandoId(cargo.id);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('funcionarios_cargos')
      .update({ ativo: !cargo.ativo })
      .eq('id', cargo.id)
      .select('id, nome, ativo')
      .single();
    setAlternandoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [cargo.id]: mensagemErroCargo(error) }));
      return;
    }
    onAtualizar(cargos.map((c) => (c.id === cargo.id ? data : c)));
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
      onClick={onFechar}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, padding: 25, width: 460, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: corPrimaria }}>Gerenciar cargos/funções</h3>
          <button
            type="button"
            onClick={onFechar}
            style={{ padding: '6px 14px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Fechar
          </button>
        </div>

        {!podeGerenciar && (
          <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
            Você pode visualizar os cargos existentes. Criar, renomear ou inativar exige permissão de edição de Funcionários.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto', marginBottom: '14px' }}>
          {cargos.length === 0 && <p style={{ color: '#888', fontSize: '13px' }}>Nenhum cargo cadastrado.</p>}
          {cargos.map((cargo) => {
            const emEdicao = idEmEdicao === cargo.id;
            const erroItem = erroPorId[cargo.id];
            return (
              <div key={cargo.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', backgroundColor: emEdicao ? '#fff8e1' : '#f9f9f9', borderRadius: '5px' }}>
                  {emEdicao ? (
                    <input
                      type="text"
                      value={nomeEditado}
                      maxLength={MAX_LEN}
                      onChange={(e) => setNomeEditado(e.target.value)}
                      style={{ flex: 1, padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
                      autoFocus
                    />
                  ) : (
                    <span style={{ flex: 1, fontSize: '14px', color: cargo.ativo ? '#111' : '#999', textDecoration: cargo.ativo ? 'none' : 'line-through' }}>
                      {cargo.nome}
                    </span>
                  )}

                  {!emEdicao && (
                    <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: 4, background: cargo.ativo ? '#e6f4ea' : '#f1f1f1', color: cargo.ativo ? '#1e7e34' : '#777' }}>
                      {cargo.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  )}

                  {podeGerenciar && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {emEdicao ? (
                        <>
                          <button type="button" onClick={() => salvarEdicao(cargo.id)} disabled={salvandoId === cargo.id} style={{ fontSize: '12px' }}>
                            Salvar
                          </button>
                          <button type="button" onClick={cancelarEdicao} style={{ fontSize: '12px' }}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => iniciarEdicao(cargo)} style={{ fontSize: '12px' }}>Renomear</button>
                          <button
                            type="button"
                            onClick={() => alternarAtivo(cargo)}
                            disabled={alternandoId === cargo.id}
                            style={{ fontSize: '12px' }}
                          >
                            {cargo.ativo ? 'Inativar' : 'Ativar'}
                          </button>
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

        {podeGerenciar && (
          <form onSubmit={criar} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Novo cargo"
              value={novoNome}
              maxLength={MAX_LEN}
              onChange={(e) => setNovoNome(e.target.value)}
              style={{ flex: 1, padding: '7px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '13px' }}
            />
            <button
              type="submit"
              disabled={criando}
              style={{ padding: '7px 12px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: criando ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold' }}
            >
              {criando ? 'Aguarde...' : '+ Novo'}
            </button>
          </form>
        )}
        {erroCriar && <p style={{ color: '#f44336', fontSize: '13px', marginTop: '8px' }}>{erroCriar}</p>}

        <p style={{ fontSize: '11px', color: '#888', marginTop: '14px' }}>
          Não é possível excluir cargos — apenas inativá-los. Um cargo inativo continua aparecendo nos funcionários já
          cadastrados, mas deixa de ser oferecido para cadastros novos.
        </p>
      </div>
    </div>
  );
}
