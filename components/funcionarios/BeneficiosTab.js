import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';

const PERIODICIDADE_LABEL = {
  diaria: 'Diária',
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
};

function estadoInicialForm() {
  return { tipo_id: '', valor: '', periodicidade: '', data_inicio: '', data_fim: '', observacoes: '' };
}

function montarPayload(form) {
  return {
    tipo_id: form.tipo_id,
    valor: form.valor !== '' ? Number(form.valor) : null,
    periodicidade: form.periodicidade || null,
    data_inicio: form.data_inicio || null,
    data_fim: form.data_fim || null,
    observacoes: form.observacoes || null,
  };
}

function mensagemErro(error) {
  if (!error) return '';
  if (error.code === '23503') return 'O tipo de benefício selecionado não existe mais — atualize a página.';
  console.error('Erro ao salvar benefício:', error);
  return 'Não foi possível salvar o benefício. Tente novamente ou avise um administrador.';
}

const campoEstilo = { width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box', fontSize: '13px' };

export default function BeneficiosTab({ funcionarioId, corPrimaria = '#8B4513', podeEditar }) {
  const [beneficios, setBeneficios] = useState([]);
  const [tipos, setTipos] = useState([]);
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
    const [{ data: beneficiosData, error: erroBeneficios }, { data: tiposData }] = await Promise.all([
      supabase.from('funcionarios_beneficios').select('*, funcionarios_beneficios_tipos(nome)').eq('funcionario_id', funcionarioId).order('criado_em'),
      supabase.from('funcionarios_beneficios_tipos').select('id, nome, ativo').order('nome'),
    ]);
    if (erroBeneficios) {
      console.error('Erro ao carregar benefícios:', erroBeneficios);
      setErro('Não foi possível carregar os benefícios.');
    } else {
      setBeneficios(beneficiosData || []);
    }
    setTipos(tiposData || []);
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

  function abrirEdicao(ben) {
    setEditandoId(ben.id);
    setForm({
      tipo_id: ben.tipo_id,
      valor: ben.valor ?? '',
      periodicidade: ben.periodicidade || '',
      data_inicio: ben.data_inicio || '',
      data_fim: ben.data_fim || '',
      observacoes: ben.observacoes || '',
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
    if (!form.tipo_id) {
      setErroForm('Selecione o tipo de benefício.');
      return;
    }
    setSalvando(true);
    setErroForm('');
    const supabase = createClient();
    const payload = montarPayload(form);

    if (editandoId) {
      const { error } = await supabase.from('funcionarios_beneficios').update(payload).eq('id', editandoId);
      setSalvando(false);
      if (error) {
        setErroForm(mensagemErro(error));
        return;
      }
      registrarAuditoria({ entidade: 'funcionario_beneficio', registroId: editandoId, acao: 'editou' });
    } else {
      const { data, error } = await supabase
        .from('funcionarios_beneficios')
        .insert({ ...payload, funcionario_id: funcionarioId })
        .select('id')
        .single();
      setSalvando(false);
      if (error) {
        setErroForm(mensagemErro(error));
        return;
      }
      registrarAuditoria({ entidade: 'funcionario_beneficio', registroId: data.id, acao: 'criou' });
    }

    fecharForm();
    carregar();
  }

  async function alternarAtivo(ben) {
    const supabase = createClient();
    const { error } = await supabase.from('funcionarios_beneficios').update({ ativo: !ben.ativo }).eq('id', ben.id);
    if (error) {
      console.error('Erro ao ativar/inativar benefício:', error);
      setErro('Não foi possível atualizar o benefício.');
      return;
    }
    registrarAuditoria({ entidade: 'funcionario_beneficio', registroId: ben.id, acao: ben.ativo ? 'inativou' : 'reativou' });
    carregar();
  }

  if (carregando) return <p style={{ color: '#999', fontSize: '13px' }}>Carregando benefícios...</p>;
  if (erro) return <p style={{ color: '#f44336', fontSize: '13px' }}>{erro}</p>;

  return (
    <div>
      {beneficios.length === 0 && !mostrarForm && (
        <p style={{ color: '#666', fontSize: '13px' }}>Este funcionário ainda não possui benefícios/condições recorrentes cadastradas.</p>
      )}

      {beneficios.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {beneficios.map((ben) => (
            <div
              key={ben.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '5px',
                backgroundColor: ben.ativo ? '#f9f9f9' : '#f1f1f1', opacity: ben.ativo ? 1 : 0.7,
              }}
            >
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: '14px' }}>{ben.funcionarios_beneficios_tipos?.nome || '—'}</strong>{' '}
                <span style={{ fontSize: '12px', color: '#666' }}>
                  {ben.valor != null ? ` · R$ ${Number(ben.valor).toFixed(2)}` : ''}
                  {ben.periodicidade ? ` · ${PERIODICIDADE_LABEL[ben.periodicidade] || ben.periodicidade}` : ''}
                </span>
                {!ben.ativo && <span style={{ fontSize: '11px', color: '#999', marginLeft: '6px' }}>(inativo)</span>}
              </div>
              {podeEditar && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" onClick={() => abrirEdicao(ben)} style={{ fontSize: '12px' }}>Editar</button>
                  <button type="button" onClick={() => alternarAtivo(ben)} style={{ fontSize: '12px' }}>
                    {ben.ativo ? 'Encerrar' : 'Reativar'}
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
          + Adicionar benefício
        </button>
      )}

      {mostrarForm && (
        <form onSubmit={salvar} style={{ border: '1px solid #eee', borderRadius: '5px', padding: '14px', marginTop: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Tipo *</label>
              <select value={form.tipo_id} onChange={(e) => setForm((f) => ({ ...f, tipo_id: e.target.value }))} style={campoEstilo}>
                <option value="">—</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id} disabled={!t.ativo}>{t.nome}{!t.ativo ? ' (inativo)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Valor (R$)</label>
              <input type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} style={campoEstilo} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Periodicidade</label>
              <select value={form.periodicidade} onChange={(e) => setForm((f) => ({ ...f, periodicidade: e.target.value }))} style={campoEstilo}>
                <option value="">—</option>
                {Object.entries(PERIODICIDADE_LABEL).map(([valor, label]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Início</label>
              <input type="date" value={form.data_inicio} onChange={(e) => setForm((f) => ({ ...f, data_inicio: e.target.value }))} style={campoEstilo} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Fim</label>
              <input type="date" value={form.data_fim} onChange={(e) => setForm((f) => ({ ...f, data_fim: e.target.value }))} style={campoEstilo} />
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Observações</label>
            <textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} style={{ ...campoEstilo, resize: 'vertical' }} />
          </div>

          {erroForm && <p style={{ color: '#f44336', fontSize: '12px' }}>{erroForm}</p>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" disabled={salvando} style={{ padding: '7px 16px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
              {salvando ? 'Salvando...' : 'Salvar benefício'}
            </button>
            <button type="button" onClick={fecharForm} style={{ padding: '7px 16px', fontSize: '13px' }}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
