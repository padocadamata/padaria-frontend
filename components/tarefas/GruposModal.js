import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Alert from '../ui/Alert';
import { excluirGrupo, salvarGrupo } from '../../lib/tarefas/consultas';
import { mensagemErro } from '../../lib/tarefas/erros';
import estilos from './tarefas.module.css';

// Grupos de distribuição: todas as tarefas do grupo recebem a MESMA
// posição no dia. A rotação (diária/semanal) é fixa depois de criado; a
// posição inicial na rotação é escolhida pelo banco (mais equilibrada).
export default function GruposModal({ grupos, podeEditar, onFechar, onAlterado }) {
  const [editando, setEditando] = useState(null); // { id, nome }
  const [novoNome, setNovoNome] = useState('');
  const [novaRotacao, setNovaRotacao] = useState('diaria');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function executar(acao) {
    setSalvando(true);
    setErro('');
    try {
      await acao();
      setEditando(null);
      setNovoNome('');
      onAlterado();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Grupos de distribuição" onFechar={onFechar} largura="md">
      <div className={estilos.pilha}>
        <p className={estilos.textoAuxiliar}>
          Use grupos para tarefas que precisam ficar com a mesma pessoa no dia (ex.: blocos de fechamento, Tapetes + Lixeiras).
        </p>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <table className={estilos.tabelaCadastro}>
          <thead>
            <tr>
              <th scope="col">Grupo</th>
              <th scope="col">Rotação</th>
              {podeEditar && <th scope="col" aria-label="Ações" />}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.id}>
                <td>
                  {editando?.id === g.id ? (
                    <Input value={editando.nome} maxLength={80} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} aria-label="Nome do grupo" />
                  ) : (
                    g.nome
                  )}
                </td>
                <td>{g.rotacao === 'diaria' ? 'Diária' : 'Semanal'}</td>
                {podeEditar && (
                  <td>
                    <div className={estilos.acoesLinha}>
                      {editando?.id === g.id ? (
                        <>
                          <Button tamanho="sm" disabled={salvando} onClick={() => executar(() => salvarGrupo(g.id, editando.nome))}>Salvar</Button>
                          <Button tamanho="sm" variante="ghost" disabled={salvando} onClick={() => setEditando(null)}>Cancelar</Button>
                        </>
                      ) : (
                        <>
                          <Button tamanho="sm" variante="secondary" disabled={salvando} onClick={() => setEditando({ id: g.id, nome: g.nome })}>Renomear</Button>
                          <Button tamanho="sm" variante="dangerOutline" disabled={salvando} onClick={() => executar(() => excluirGrupo(g.id))}>Excluir</Button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {podeEditar && (
          <section className={estilos.secaoModal}>
            <h3 className={estilos.tituloSecaoModal}>Novo grupo</h3>
            <div className={estilos.linhaCampos}>
              <Field label="Nome">
                <Input value={novoNome} maxLength={80} onChange={(e) => setNovoNome(e.target.value)} disabled={salvando} />
              </Field>
              <Field label="Rotação" dica="Diária: troca de pessoa todo dia. Semanal: troca a cada semana.">
                <Select value={novaRotacao} onChange={(e) => setNovaRotacao(e.target.value)} disabled={salvando}>
                  <option value="diaria">Diária</option>
                  <option value="semanal">Semanal</option>
                </Select>
              </Field>
            </div>
            <div className={estilos.rodapeModal}>
              <Button disabled={salvando || !novoNome.trim()} onClick={() => executar(() => salvarGrupo(null, novoNome, novaRotacao))}>
                Criar grupo
              </Button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
