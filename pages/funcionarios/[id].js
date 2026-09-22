import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import DadosFuncionarioForm from '../../components/funcionarios/DadosFuncionarioForm';
import DependentesTab from '../../components/funcionarios/DependentesTab';
import BeneficiosTab from '../../components/funcionarios/BeneficiosTab';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';
import { cx } from '../../lib/design/cx';
import estilos from '../../components/funcionarios/funcionarios.module.css';

const ABAS = [
  { chave: 'dados', label: 'Dados pessoais e profissionais' },
  { chave: 'dependentes', label: 'Dependentes' },
  { chave: 'beneficios', label: 'Benefícios' },
];

// Diffs mínimos que valem auditoria dedicada, além do "editou" genérico
// -- ativação/inativação e vínculo/desvínculo de usuário são as ações
// explicitamente exigidas pela Fase 1 (ver relatório desta rodada).
function registrarAuditoriaDiff(anterior, atualizado) {
  registrarAuditoria({ entidade: 'funcionario', registroId: atualizado.id, acao: 'editou' });

  if (anterior.ativo !== atualizado.ativo) {
    registrarAuditoria({
      entidade: 'funcionario',
      registroId: atualizado.id,
      acao: atualizado.ativo ? 'reativou' : 'inativou',
      campo: 'ativo',
      valorAnterior: anterior.ativo,
      valorNovo: atualizado.ativo,
    });
  }

  if (anterior.usuario_id !== atualizado.usuario_id) {
    registrarAuditoria({
      entidade: 'funcionario',
      registroId: atualizado.id,
      acao: atualizado.usuario_id ? 'vinculou_usuario' : 'desvinculou_usuario',
      campo: 'usuario_id',
      valorAnterior: anterior.usuario_id,
      valorNovo: atualizado.usuario_id,
    });
  }
}

function FuncionarioDetalheConteudo() {
  const router = useRouter();
  const { id } = router.query;
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.FUNCIONARIOS_EDITAR);

  const [funcionario, setFuncionario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('dados');

  async function carregar() {
    if (!id) return;
    setCarregando(true);
    setErro('');
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      setErro('Funcionário não encontrado ou você não tem permissão para vê-lo.');
    } else {
      setFuncionario(data);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function aoSalvar(atualizado) {
    if (funcionario) {
      registrarAuditoriaDiff(funcionario, atualizado);
    }
    setFuncionario(atualizado);
  }

  if (carregando) {
    return (
      <PageShell titulo="Folha de Pagamento">
        <p className={estilos.carregando} role="status">Carregando…</p>
      </PageShell>
    );
  }

  if (erro || !funcionario) {
    return (
      <PageShell titulo="Folha de Pagamento">
        <Alert tom="danger" className={estilos.mensagem}>{erro || 'Funcionário não encontrado.'}</Alert>
        <Button onClick={() => router.push('/funcionarios')}>Voltar</Button>
      </PageShell>
    );
  }

  return (
    <PageShell titulo="Folha de Pagamento">
      <PageHeader
        titulo={
          <span className={estilos.cabecalhoDetalhe}>
            {funcionario.nome}
            {!funcionario.ativo && <Badge tom="neutral">Inativo</Badge>}
          </span>
        }
        acoes={
          <Button variante="secondary" onClick={() => router.push('/funcionarios')}>
            ← Voltar para funcionários
          </Button>
        }
      />

      <div className={estilos.abas} role="tablist">
        {ABAS.map((a) => (
          <button
            key={a.chave}
            type="button"
            role="tab"
            aria-selected={aba === a.chave}
            className={cx(estilos.aba, aba === a.chave && estilos.abaAtiva)}
            onClick={() => setAba(a.chave)}
          >
            {a.label}
          </button>
        ))}
      </div>

      <Card>
        {aba === 'dados' && (
          <DadosFuncionarioForm funcionario={funcionario} podeEditar={podeEditar} onSalvo={aoSalvar} />
        )}
        {aba === 'dependentes' && <DependentesTab funcionarioId={funcionario.id} podeEditar={podeEditar} />}
        {aba === 'beneficios' && <BeneficiosTab funcionarioId={funcionario.id} podeEditar={podeEditar} />}
      </Card>
    </PageShell>
  );
}

export default function FuncionarioDetalhe() {
  return (
    <RequireAuth permissao={PERMISSOES.FUNCIONARIOS_VISUALIZAR}>
      <FuncionarioDetalheConteudo />
    </RequireAuth>
  );
}
