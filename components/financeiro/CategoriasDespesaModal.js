import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import { normalizarNomeCurto } from '../../lib/financeiro/contasPagarRegras';
import { definirCategoriaAtiva, salvarCategoria } from '../../lib/financeiro/contasPagar';
import estilos from './financeiro.module.css';

// Categorias de despesa (migration 0073) -- mesmo ciclo das categorias da
// Agenda (criar / renomear / inativar / reativar, sem exclusão física), mas
// toda escrita passa pelas RPCs (auditadas). Nome em MAIÚSCULAS.
export default function CategoriasDespesaModal({ categorias, podeEditar, onFechar, onAlterado }) {
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState(null);
  const [nomeEditado, setNomeEditado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function executar(promessa) {
    setErro('');
    setOcupado(true);
    const { erro: erroRpc } = await promessa;
    setOcupado(false);
    if (erroRpc) {
      setErro(erroRpc);
      return false;
    }
    onAlterado();
    return true;
  }

  async function criar(e) {
    e.preventDefault();
    if (!normalizarNomeCurto(novo)) return setErro('Informe o nome da categoria.');
    if (await executar(salvarCategoria(null, novo))) setNovo('');
  }

  async function renomear(id) {
    if (!normalizarNomeCurto(nomeEditado)) return setErro('Informe o nome da categoria.');
    if (await executar(salvarCategoria(id, nomeEditado))) setEditando(null);
  }

  return (
    <Modal titulo="Categorias de despesa" onFechar={ocupado ? undefined : onFechar} largura="md">
      <div className={estilos.modalCorpo}>
        {podeEditar && (
          <form className={estilos.novaCategoria} onSubmit={criar}>
            <Field label="Nova categoria" dica={novo ? `Será gravada como: ${normalizarNomeCurto(novo)}` : undefined}>
              <Input value={novo} maxLength={60} onChange={(e) => setNovo(e.target.value)} />
            </Field>
            <Button type="submit" disabled={ocupado}>Adicionar</Button>
          </form>
        )}
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div>
          {categorias.map((c) => (
            <div key={c.id} className={estilos.categoriaLinha}>
              {editando === c.id ? (
                <>
                  <Input aria-label={`Novo nome para ${c.nome}`} value={nomeEditado} maxLength={60} onChange={(e) => setNomeEditado(e.target.value)} />
                  <div className={estilos.acoes}>
                    <Button tamanho="sm" variante="secondary" onClick={() => setEditando(null)} disabled={ocupado}>Cancelar</Button>
                    <Button tamanho="sm" onClick={() => renomear(c.id)} disabled={ocupado}>Salvar</Button>
                  </div>
                </>
              ) : (
                <>
                  <span>
                    {c.nome} {!c.ativo && <Badge tom="neutral">Inativa</Badge>}
                  </span>
                  {podeEditar && (
                    <div className={estilos.acoes}>
                      <Button tamanho="sm" variante="ghost" onClick={() => { setEditando(c.id); setNomeEditado(c.nome); }} disabled={ocupado}>Renomear</Button>
                      <Button tamanho="sm" variante="secondary" onClick={() => executar(definirCategoriaAtiva(c.id, !c.ativo))} disabled={ocupado}>
                        {c.ativo ? 'Inativar' : 'Reativar'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <p className={estilos.dica}>Inativar só tira a categoria das novas despesas; as já lançadas continuam com ela.</p>
      </div>
    </Modal>
  );
}
