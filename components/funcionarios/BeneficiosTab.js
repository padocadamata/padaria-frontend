import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { cx } from '../../lib/design/cx';
import estilos from './funcionarios.module.css';

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

export default function BeneficiosTab({ funcionarioId, podeEditar }) {
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

  if (carregando) return <p className={estilos.vazio}>Carregando benefícios...</p>;
  if (erro) return <Alert tom="danger">{erro}</Alert>;

  return (
    <div>
      {beneficios.length === 0 ? (
        <p className={estilos.vazio}>Este funcionário ainda não possui benefícios/condições recorrentes cadastradas.</p>
      ) : (
        <div className={estilos.listaItens}>
          {beneficios.map((ben) => (
            <div key={ben.id} className={cx(estilos.item, !ben.ativo && estilos.itemInativo)}>
              <div style={{ flex: 1 }}>
                <span className={estilos.itemTitulo}>{ben.funcionarios_beneficios_tipos?.nome || '—'}</span>{' '}
                <span className={estilos.itemDetalhe}>
                  {ben.valor != null ? `· R$ ${Number(ben.valor).toFixed(2)}` : ''}
                  {ben.periodicidade ? ` · ${PERIODICIDADE_LABEL[ben.periodicidade] || ben.periodicidade}` : ''}
                </span>{' '}
                <Badge tom={ben.ativo ? 'success' : 'neutral'}>{ben.ativo ? 'Ativo' : 'Inativo'}</Badge>
              </div>
              {podeEditar && (
                <div className={estilos.itemAcoes}>
                  <Button tamanho="sm" variante="secondary" onClick={() => abrirEdicao(ben)}>Editar</Button>
                  <Button tamanho="sm" variante="secondary" onClick={() => alternarAtivo(ben)}>
                    {ben.ativo ? 'Encerrar' : 'Reativar'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {podeEditar && (
        <Button tamanho="sm" icone="plus" onClick={abrirNovo}>Adicionar benefício</Button>
      )}

      {mostrarForm && (
        <Modal titulo={editandoId ? 'Editar benefício' : 'Novo benefício'} onFechar={salvando ? undefined : fecharForm} largura="sm" fecharComEsc={false}>
          <form onSubmit={salvar}>
            <div className={cx(estilos.grade, estilos.secao)}>
              <Field label="Tipo *">
                <Select value={form.tipo_id} onChange={(e) => setForm((f) => ({ ...f, tipo_id: e.target.value }))}>
                  <option value="">—</option>
                  {tipos.map((t) => (
                    <option key={t.id} value={t.id} disabled={!t.ativo}>{t.nome}{!t.ativo ? ' (inativo)' : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Valor (R$)">
                <Input type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} />
              </Field>
              <Field label="Periodicidade">
                <Select value={form.periodicidade} onChange={(e) => setForm((f) => ({ ...f, periodicidade: e.target.value }))}>
                  <option value="">—</option>
                  {Object.entries(PERIODICIDADE_LABEL).map(([valor, label]) => (
                    <option key={valor} value={valor}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Início">
                <Input type="date" value={form.data_inicio} onChange={(e) => setForm((f) => ({ ...f, data_inicio: e.target.value }))} />
              </Field>
              <Field label="Fim">
                <Input type="date" value={form.data_fim} onChange={(e) => setForm((f) => ({ ...f, data_fim: e.target.value }))} />
              </Field>
            </div>

            <Field label="Observações" className={estilos.secao}>
              <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} />
            </Field>

            {erroForm && <Alert tom="danger" className={estilos.mensagem}>{erroForm}</Alert>}

            <div className={estilos.rodape}>
              <Button type="button" variante="secondary" onClick={fecharForm} disabled={salvando}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar benefício'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
