import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { normalizarMaiusculas } from '../../lib/funcionarios/normalizacao';
import { calcularIdade } from '../../lib/funcionarios/aniversarios';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';

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

const campoEstilo = { width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box', fontSize: '13px' };

export default function DependentesTab({ funcionarioId, corPrimaria = '#8B4513', podeEditar }) {
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

  if (carregando) return <p style={{ color: '#999', fontSize: '13px' }}>Carregando dependentes...</p>;
  if (erro) return <p style={{ color: '#f44336', fontSize: '13px' }}>{erro}</p>;

  return (
    <div>
      {dependentes.length === 0 && !mostrarForm && (
        <p style={{ color: '#666', fontSize: '13px' }}>Este funcionário ainda não possui dependentes cadastrados.</p>
      )}

      {dependentes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {dependentes.map((dep) => (
            <div
              key={dep.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '5px',
                backgroundColor: dep.ativo ? '#f9f9f9' : '#f1f1f1', opacity: dep.ativo ? 1 : 0.7,
              }}
            >
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: '14px' }}>{dep.nome}</strong>{' '}
                <span style={{ fontSize: '12px', color: '#666' }}>
                  {dep.parentesco ? `· ${dep.parentesco}` : ''}
                  {dep.data_nascimento ? ` · ${calcularIdade(dep.data_nascimento)} anos` : ''}
                  {dep.possui_pensao ? ' · possui pensão' : ''}
                </span>
                {!dep.ativo && <span style={{ fontSize: '11px', color: '#999', marginLeft: '6px' }}>(inativo)</span>}
              </div>
              {podeEditar && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" onClick={() => abrirEdicao(dep)} style={{ fontSize: '12px' }}>Editar</button>
                  <button type="button" onClick={() => alternarAtivo(dep)} style={{ fontSize: '12px' }}>
                    {dep.ativo ? 'Inativar' : 'Reativar'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {podeEditar && !mostrarForm && (
        <button
          type="button"
          onClick={abrirNovo}
          style={{ padding: '8px 16px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
        >
          + Adicionar dependente
        </button>
      )}

      {mostrarForm && (
        <form onSubmit={salvar} style={{ border: '1px solid #eee', borderRadius: '5px', padding: '14px', marginTop: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Nome *</label>
              <input type="text" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} style={campoEstilo} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Data de nascimento</label>
              <input type="date" value={form.data_nascimento} onChange={(e) => setForm((f) => ({ ...f, data_nascimento: e.target.value }))} style={campoEstilo} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Parentesco</label>
              <input type="text" value={form.parentesco} onChange={(e) => setForm((f) => ({ ...f, parentesco: e.target.value }))} style={campoEstilo} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', marginBottom: '4px' }}>
            <input
              type="checkbox"
              checked={form.possui_pensao}
              onChange={(e) => setForm((f) => ({ ...f, possui_pensao: e.target.checked, valor_pensao: e.target.checked ? f.valor_pensao : '' }))}
            />
            Há pensão (alimentícia ou outra) vinculada a este dependente
          </label>
          <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px 22px' }}>
            Indica uma obrigação de pensão associada a este dependente, para referência do futuro cálculo de FOPAG —
            não significa que o dependente já recebe algum valor através deste sistema.
          </p>

          {form.possui_pensao && (
            <div style={{ marginBottom: '10px', maxWidth: '200px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Valor da pensão (R$)</label>
              <input type="number" step="0.01" min="0" value={form.valor_pensao} onChange={(e) => setForm((f) => ({ ...f, valor_pensao: e.target.value }))} style={campoEstilo} />
            </div>
          )}

          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Observações</label>
            <textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} style={{ ...campoEstilo, resize: 'vertical' }} />
          </div>

          {erroForm && <p style={{ color: '#f44336', fontSize: '12px' }}>{erroForm}</p>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" disabled={salvando} style={{ padding: '7px 16px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
              {salvando ? 'Salvando...' : 'Salvar dependente'}
            </button>
            <button type="button" onClick={fecharForm} style={{ padding: '7px 16px', fontSize: '13px' }}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
