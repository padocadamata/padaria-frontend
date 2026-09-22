import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { normalizarMaiusculas } from '../../lib/funcionarios/normalizacao';
import { calcularIdade } from '../../lib/funcionarios/aniversarios';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import { cx } from '../../lib/design/cx';
import estilos from './funcionarios.module.css';

function estadoInicialForm() {
  return { nome: '', data_nascimento: '', parentesco: '', possui_pensao: false, valor_pensao: '', observacoes: '' };
}

function montarPayload(form) {
  return {
    nome: normalizarMaiusculas(form.nome),
    data_nascimento: form.data_nascimento || null,
    parentesco: normalizarMaiusculas(form.parentesco) || null,
    possui_pensao: form.possui_pensao,
    valor_pensao: form.possui_pensao && form.valor_pensao !== '' ? Number(form.valor_pensao) : null,
    observacoes: form.observacoes || null,
  };
}

function mensagemErro(error) {
  if (!error) return '';
  if (error.code === '23514') return 'Confira os dados informados (nome vazio ou valor de pensão preenchido sem marcar "Há pensão vinculada").';
  console.error('Erro ao salvar dependente:', error);
  return 'Não foi possível salvar o dependente. Tente novamente ou avise um administrador.';
}

export default function DependentesTab({ funcionarioId, podeEditar }) {
  const [dependentes, setDependentes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(estadoInicialForm());
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  async function carregar() {
    setCarregando(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('funcionarios_dependentes')
      .select('*')
      .eq('funcionario_id', funcionarioId)
      .order('nome');
    if (error) {
      console.error('Erro ao carregar dependentes:', error);
      setErro('Não foi possível carregar os dependentes.');
    } else {
      setDependentes(data || []);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionarioId]);

  function abrirNovo() {
    setEditandoId(null);
    setForm(estadoInicialForm());
    setErroForm('');
    setMostrarForm(true);
  }

  function abrirEdicao(dep) {
    setEditandoId(dep.id);
    setForm({
      nome: dep.nome,
      data_nascimento: dep.data_nascimento || '',
      parentesco: dep.parentesco || '',
      possui_pensao: dep.possui_pensao,
      valor_pensao: dep.valor_pensao ?? '',
      observacoes: dep.observacoes || '',
    });
    setErroForm('');
    setMostrarForm(true);
  }

  function fecharForm() {
    setMostrarForm(false);
    setEditandoId(null);
  }

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) {
      setErroForm('Informe o nome do dependente.');
      return;
    }
    setSalvando(true);
    setErroForm('');
    const supabase = createClient();
    const payload = montarPayload(form);

    if (editandoId) {
      const { error } = await supabase.from('funcionarios_dependentes').update(payload).eq('id', editandoId);
      setSalvando(false);
      if (error) {
        setErroForm(mensagemErro(error));
        return;
      }
      registrarAuditoria({ entidade: 'funcionario_dependente', registroId: editandoId, acao: 'editou' });
    } else {
      const { data, error } = await supabase
        .from('funcionarios_dependentes')
        .insert({ ...payload, funcionario_id: funcionarioId })
        .select('id')
        .single();
      setSalvando(false);
      if (error) {
        setErroForm(mensagemErro(error));
        return;
      }
      registrarAuditoria({ entidade: 'funcionario_dependente', registroId: data.id, acao: 'criou' });
    }

    fecharForm();
    carregar();
  }

  async function alternarAtivo(dep) {
    const supabase = createClient();
    const { error } = await supabase.from('funcionarios_dependentes').update({ ativo: !dep.ativo }).eq('id', dep.id);
    if (error) {
      console.error('Erro ao ativar/inativar dependente:', error);
      setErro('Não foi possível atualizar o dependente.');
      return;
    }
    registrarAuditoria({ entidade: 'funcionario_dependente', registroId: dep.id, acao: dep.ativo ? 'inativou' : 'reativou' });
    carregar();
  }

  if (carregando) return <p className={estilos.vazio}>Carregando dependentes...</p>;
  if (erro) return <Alert tom="danger">{erro}</Alert>;

  return (
    <div>
      {dependentes.length === 0 ? (
        <p className={estilos.vazio}>Este funcionário ainda não possui dependentes cadastrados.</p>
      ) : (
        <div className={estilos.listaItens}>
          {dependentes.map((dep) => (
            <div key={dep.id} className={cx(estilos.item, !dep.ativo && estilos.itemInativo)}>
              <div style={{ flex: 1 }}>
                <span className={estilos.itemTitulo}>{dep.nome}</span>{' '}
                <span className={estilos.itemDetalhe}>
                  {dep.parentesco ? `· ${dep.parentesco}` : ''}
                  {dep.data_nascimento ? ` · ${calcularIdade(dep.data_nascimento)} anos` : ''}
                  {dep.possui_pensao ? ' · possui pensão' : ''}
                </span>{' '}
                <Badge tom={dep.ativo ? 'success' : 'neutral'}>{dep.ativo ? 'Ativo' : 'Inativo'}</Badge>
              </div>
              {podeEditar && (
                <div className={estilos.itemAcoes}>
                  <Button tamanho="sm" variante="secondary" onClick={() => abrirEdicao(dep)}>Editar</Button>
                  <Button tamanho="sm" variante="secondary" onClick={() => alternarAtivo(dep)}>
                    {dep.ativo ? 'Inativar' : 'Reativar'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {podeEditar && (
        <Button tamanho="sm" icone="plus" onClick={abrirNovo}>Adicionar dependente</Button>
      )}

      {mostrarForm && (
        <Modal titulo={editandoId ? 'Editar dependente' : 'Novo dependente'} onFechar={salvando ? undefined : fecharForm} largura="sm" fecharComEsc={false}>
          <form onSubmit={salvar}>
            <div className={cx(estilos.grade, estilos.secao)}>
              <Field label="Nome *">
                <Input type="text" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
              </Field>
              <Field label="Data de nascimento">
                <Input type="date" value={form.data_nascimento} onChange={(e) => setForm((f) => ({ ...f, data_nascimento: e.target.value }))} />
              </Field>
              <Field label="Parentesco">
                <Input type="text" value={form.parentesco} onChange={(e) => setForm((f) => ({ ...f, parentesco: e.target.value }))} />
              </Field>
            </div>

            <Checkbox
              rotulo="Há pensão (alimentícia ou outra) vinculada a este dependente"
              checked={form.possui_pensao}
              onChange={(e) => setForm((f) => ({ ...f, possui_pensao: e.target.checked, valor_pensao: e.target.checked ? f.valor_pensao : '' }))}
            />
            <p className={estilos.nota}>
              Indica uma obrigação de pensão associada a este dependente, para referência do futuro cálculo de FOPAG —
              não significa que o dependente já recebe algum valor através deste sistema.
            </p>

            {form.possui_pensao && (
              <Field label="Valor da pensão (R$)" className={estilos.secao}>
                <Input type="number" step="0.01" min="0" value={form.valor_pensao} onChange={(e) => setForm((f) => ({ ...f, valor_pensao: e.target.value }))} style={{ maxWidth: '200px' }} />
              </Field>
            )}

            <Field label="Observações" className={estilos.secao}>
              <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} />
            </Field>

            {erroForm && <Alert tom="danger" className={estilos.mensagem}>{erroForm}</Alert>}

            <div className={estilos.rodape}>
              <Button type="button" variante="secondary" onClick={fecharForm} disabled={salvando}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar dependente'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
