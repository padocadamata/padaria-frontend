import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { normalizarMaiusculas } from '../../lib/funcionarios/normalizacao';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { cx } from '../../lib/design/cx';
import estilos from './funcionarios.module.css';

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

export default function GerenciarCargosModal({ aberto, onFechar, cargos, podeGerenciar, onAtualizar }) {
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
    <Modal titulo="Gerenciar cargos/funções" onFechar={onFechar} largura="sm">
      {!podeGerenciar && (
        <p className={estilos.nota}>
          Você pode visualizar os cargos existentes. Criar, renomear ou inativar exige permissão de edição de Funcionários.
        </p>
      )}

      <div className={estilos.listaCargos}>
        {cargos.length === 0 && <p className={estilos.vazio}>Nenhum cargo cadastrado.</p>}
        {cargos.map((cargo) => {
          const emEdicao = idEmEdicao === cargo.id;
          const erroItem = erroPorId[cargo.id];
          return (
            <div key={cargo.id}>
              <div className={cx(estilos.itemCargo, emEdicao && estilos.itemCargoEmEdicao)}>
                {emEdicao ? (
                  <Input
                    type="text"
                    value={nomeEditado}
                    maxLength={MAX_LEN}
                    onChange={(e) => setNomeEditado(e.target.value)}
                    className={estilos.itemCargoNome}
                    aria-label="Renomear cargo"
                    autoFocus
                  />
                ) : (
                  <span className={cx(estilos.itemCargoNome, !cargo.ativo && estilos.itemCargoInativo)}>
                    {cargo.nome}
                  </span>
                )}

                {!emEdicao && <Badge tom={cargo.ativo ? 'success' : 'neutral'}>{cargo.ativo ? 'Ativo' : 'Inativo'}</Badge>}

                {podeGerenciar && (
                  <div className={estilos.itemAcoes}>
                    {emEdicao ? (
                      <>
                        <Button tamanho="sm" onClick={() => salvarEdicao(cargo.id)} disabled={salvandoId === cargo.id}>Salvar</Button>
                        <Button tamanho="sm" variante="secondary" onClick={cancelarEdicao}>Cancelar</Button>
                      </>
                    ) : (
                      <>
                        <Button tamanho="sm" variante="secondary" onClick={() => iniciarEdicao(cargo)}>Renomear</Button>
                        <Button tamanho="sm" variante="secondary" onClick={() => alternarAtivo(cargo)} disabled={alternandoId === cargo.id}>
                          {cargo.ativo ? 'Inativar' : 'Ativar'}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {erroItem && <p className={estilos.itemDetalhe} style={{ color: 'var(--ds-danger, #b3261e)' }}>{erroItem}</p>}
            </div>
          );
        })}
      </div>

      {podeGerenciar && (
        <form onSubmit={criar} className={estilos.criarCargo}>
          <Input
            type="text"
            placeholder="Novo cargo"
            value={novoNome}
            maxLength={MAX_LEN}
            onChange={(e) => setNovoNome(e.target.value)}
            aria-label="Novo cargo"
          />
          <Button type="submit" disabled={criando}>{criando ? 'Aguarde...' : '+ Novo'}</Button>
        </form>
      )}
      {erroCriar && <p className={estilos.itemDetalhe} style={{ color: 'var(--ds-danger, #b3261e)', marginTop: 'var(--ds-sp-2)' }}>{erroCriar}</p>}

      <p className={estilos.nota} style={{ marginTop: 'var(--ds-sp-4)' }}>
        Não é possível excluir cargos — apenas inativá-los. Um cargo inativo continua aparecendo nos funcionários já
        cadastrados, mas deixa de ser oferecido para cadastros novos.
      </p>
    </Modal>
  );
}
