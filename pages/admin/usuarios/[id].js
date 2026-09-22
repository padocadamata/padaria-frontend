import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import RequireAuth from '../../../components/RequireAuth';
import ConfirmarAcaoModal from '../../../components/admin/ConfirmarAcaoModal';
import SeletorPerfilBase from '../../../components/admin/SeletorPerfilBase';
import MatrizPermissoes from '../../../components/admin/MatrizPermissoes';
import PageShell from '../../../components/shell/PageShell';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { PERMISSOES } from '../../../lib/auth/permissoes';
import { isoParaInputDatetimeLocal, inputDatetimeLocalParaIso } from '../../../lib/auth/matrizPermissoes';
import { createClient } from '../../../lib/supabase/client';
import estilos from '../../../components/admin/usuarios.module.css';

// Mensagens de erro conhecidas das RPCs da migration 0018, traduzidas para
// texto amigável. Qualquer erro fora dessa lista cai no genérico —
// preferimos mostrar algo compreensível a expor a mensagem crua do
// Postgres, mas nunca escondemos que algo falhou.
function mensagemErroAmigavel(error, fallback) {
  const msg = error?.message || '';

  if (msg.includes('unico administrador')) {
    return 'Não é possível concluir: este é o único administrador ativo do sistema. Promova outro usuário a proprietário/admin antes de rebaixar ou desativar este.';
  }
  if (msg.includes('requer administrador')) {
    return 'Você não tem permissão de administrador para esta ação.';
  }
  if (msg.includes('nao existe ou nao esta ativo')) {
    return 'Perfil inválido ou inativo.';
  }
  if (msg.includes('nao pode ser nulo')) {
    return 'Status inválido.';
  }
  if (msg.includes('permissao duplicada')) {
    return 'Erro interno: permissão duplicada na lista de alterações. Recarregue a página e tente novamente.';
  }
  if (msg.includes('nao existe no catalogo')) {
    return 'Erro interno: código de permissão desconhecido. Recarregue a página e tente novamente.';
  }
  if (msg.includes('usuario') && msg.includes('nao encontrado')) {
    return 'Usuário não encontrado — pode ter sido alterado por outra sessão. Recarregue a página.';
  }

  return fallback || 'Não foi possível concluir a operação. Tente novamente ou avise outro administrador.';
}

// Converte a linha crua de usuario_permissoes (efeito/expira_em) para a
// forma que os controles da matriz entendem (estado/expiraEm) — mesma
// conversão usada tanto para montar o estado editável inicial quanto para
// recalcular a "linha de base" na hora do diff.
function paraEstadoControle(overrideRow) {
  if (!overrideRow) {
    return { estado: 'herdar', expiraEm: '' };
  }
  return {
    estado: overrideRow.efeito === 'concede' ? 'permitir' : 'bloquear',
    expiraEm: overrideRow.expira_em ? isoParaInputDatetimeLocal(overrideRow.expira_em) : '',
  };
}

function construirEstadoInicial(overridesOriginais) {
  const mapa = new Map();
  for (const [codigo, row] of overridesOriginais.entries()) {
    mapa.set(codigo, paraEstadoControle(row));
  }
  return mapa;
}

// Diff real: compara o estado editado localmente contra a linha de base
// (o que está de fato salvo em usuario_permissoes agora). Só entra no
// payload o que realmente mudou — permissão intocada nunca aparece aqui,
// mesmo que exista uma linha (ex.: um override expirado que o admin não
// tocou continua intocado, sem gerar diff).
function construirDiff(estadoEditado, overridesOriginais) {
  const alteracoes = [];
  const todosCodigos = new Set([...estadoEditado.keys(), ...overridesOriginais.keys()]);

  for (const codigo of todosCodigos) {
    const atual = estadoEditado.get(codigo) || { estado: 'herdar', expiraEm: '' };
    const base = paraEstadoControle(overridesOriginais.get(codigo));

    const mudou = atual.estado !== base.estado
      || (atual.estado !== 'herdar' && atual.expiraEm !== base.expiraEm);

    if (!mudou) continue;

    alteracoes.push({
      permissao: codigo,
      acao: atual.estado === 'permitir' ? 'conceder' : atual.estado === 'bloquear' ? 'negar' : 'herdar',
      expira_em: atual.estado === 'herdar' ? null : inputDatetimeLocalParaIso(atual.expiraEm),
    });
  }

  return alteracoes;
}

function UsuarioDetalheConteudo() {
  const router = useRouter();
  const { id } = router.query;

  const [usuario, setUsuario] = useState(null);
  const [perfis, setPerfis] = useState([]);
  const [permissoesHerdadas, setPermissoesHerdadas] = useState(new Set());
  const [overridesOriginais, setOverridesOriginais] = useState(new Map());
  const [estadoEditado, setEstadoEditado] = useState(new Map());

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');

  const [salvandoPermissoes, setSalvandoPermissoes] = useState(false);
  const [erroPermissoes, setErroPermissoes] = useState('');
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState('');

  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [erroStatus, setErroStatus] = useState('');
  const [confirmandoDesativar, setConfirmandoDesativar] = useState(false);

  async function carregarTudo() {
    if (!id) return;

    setCarregando(true);
    setErroCarga('');

    const supabase = createClient();

    const { data: usuarioRow, error: erroUsuario } = await supabase
      .from('usuarios')
      .select('id, nome, email, perfil, ativo')
      .eq('id', id)
      .single();

    if (erroUsuario || !usuarioRow) {
      setErroCarga('Usuário não encontrado.');
      setCarregando(false);
      return;
    }

    const [{ data: perfisRows }, { data: herdadasRows }, { data: overridesRows }] = await Promise.all([
      supabase.from('perfis').select('nome, descricao').eq('ativo', true).order('nivel', { ascending: false }),
      supabase.from('perfil_permissoes').select('permissao').eq('perfil', usuarioRow.perfil),
      supabase.from('usuario_permissoes').select('permissao, efeito, expira_em').eq('usuario_id', id),
    ]);

    const herdadasSet = new Set((herdadasRows || []).map((r) => r.permissao));

    const overridesMap = new Map();
    for (const row of overridesRows || []) {
      overridesMap.set(row.permissao, row);
    }

    setUsuario(usuarioRow);
    setPerfis(perfisRows || []);
    setPermissoesHerdadas(herdadasSet);
    setOverridesOriginais(overridesMap);
    setEstadoEditado(construirEstadoInicial(overridesMap));
    setCarregando(false);
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function alterarLinha(codigo, patch) {
    setMensagemSucesso('');
    setEstadoEditado((atual) => {
      const novo = new Map(atual);
      const linhaAtual = novo.get(codigo) || { estado: 'herdar', expiraEm: '' };
      novo.set(codigo, { ...linhaAtual, ...patch });
      return novo;
    });
  }

  const diffPendente = construirDiff(estadoEditado, overridesOriginais);
  const temAlteracoesPendentes = diffPendente.length > 0;

  async function salvarPermissoes() {
    if (diffPendente.length === 0) return;

    setSalvandoPermissoes(true);
    setErroPermissoes('');
    setMensagemSucesso('');

    const supabase = createClient();
    const { error } = await supabase.rpc('aplicar_diff_permissoes_usuario', {
      p_usuario_id: id,
      p_alteracoes: diffPendente,
    });

    setSalvandoPermissoes(false);

    if (error) {
      setErroPermissoes(mensagemErroAmigavel(error, 'Não foi possível salvar as permissões.'));
      return;
    }

    await carregarTudo();
    setMensagemSucesso('Permissões atualizadas com sucesso.');
  }

  async function alterarPerfil(novoPerfil) {
    setSalvandoPerfil(true);
    setErroPerfil('');
    setMensagemSucesso('');

    const supabase = createClient();
    const { error } = await supabase.rpc('alterar_perfil_usuario', {
      p_usuario_id: id,
      p_novo_perfil: novoPerfil,
    });

    setSalvandoPerfil(false);

    if (error) {
      setErroPerfil(mensagemErroAmigavel(error, 'Não foi possível alterar o perfil.'));
      return;
    }

    // Perfil mudou -> permissões herdadas mudam junto. Recarrega tudo (isso
    // também rebuild o estado editado a partir dos overrides, que não
    // mudam com a troca de perfil).
    await carregarTudo();
    setMensagemSucesso('Perfil atualizado com sucesso.');
  }

  async function confirmarAlterarStatus(novoAtivo) {
    setSalvandoStatus(true);
    setErroStatus('');
    setMensagemSucesso('');

    const supabase = createClient();
    const { error } = await supabase.rpc('alterar_status_usuario', {
      p_usuario_id: id,
      p_ativo: novoAtivo,
    });

    setSalvandoStatus(false);
    setConfirmandoDesativar(false);

    if (error) {
      setErroStatus(mensagemErroAmigavel(error, 'Não foi possível alterar o status.'));
      return;
    }

    await carregarTudo();
    setMensagemSucesso(novoAtivo ? 'Usuário ativado com sucesso.' : 'Usuário desativado com sucesso.');
  }

  function pedirDesativar() {
    setErroStatus('');
    setConfirmandoDesativar(true);
  }

  if (carregando) {
    return (
      <PageShell titulo="Usuários">
        <p className={estilos.carregando} role="status">Carregando…</p>
      </PageShell>
    );
  }

  if (erroCarga || !usuario) {
    return (
      <PageShell titulo="Usuários">
        <Alert tom="danger" className={estilos.mensagem}>{erroCarga || 'Usuário não encontrado.'}</Alert>
        <Button onClick={() => router.push('/admin/usuarios')}>Voltar</Button>
      </PageShell>
    );
  }

  return (
    <PageShell titulo="Usuários">
      <PageHeader
        titulo={usuario.nome || '(sem nome)'}
        subtitulo={usuario.email}
        acoes={
          <Button variante="secondary" onClick={() => router.push('/admin/usuarios')}>
            ← Voltar para a lista
          </Button>
        }
      />

      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      <div className={estilos.cards}>
        <Card titulo="Dados do usuário">
          <div className={estilos.linhaStatus}>
            <strong>Status:</strong>
            <Badge tom={usuario.ativo ? 'success' : 'neutral'}>{usuario.ativo ? 'Ativo' : 'Inativo'}</Badge>
            {usuario.ativo ? (
              <Button variante="dangerOutline" tamanho="sm" onClick={pedirDesativar} disabled={salvandoStatus}>
                Desativar
              </Button>
            ) : (
              <Button tamanho="sm" onClick={() => confirmarAlterarStatus(true)} disabled={salvandoStatus}>
                {salvandoStatus ? 'Aguarde...' : 'Ativar'}
              </Button>
            )}
          </div>
          {erroStatus && <Alert tom="danger" className={estilos.mensagem}>{erroStatus}</Alert>}

          <div className={estilos.secaoPerfil}>
            <SeletorPerfilBase
              nomeUsuario={usuario.nome || usuario.email}
              perfilAtual={usuario.perfil}
              perfis={perfis}
              salvando={salvandoPerfil}
              erro={erroPerfil}
              onAlterar={alterarPerfil}
            />
          </div>
        </Card>

        <Card titulo="Permissões">
          <p className={estilos.explicacaoPermissoes}>
            <strong>Herdado do perfil</strong>: vem do perfil-base ({usuario.perfil}). <strong>Controle</strong>: override
            individual — Herdar (nenhuma exceção), Permitir ou Bloquear, sempre por cima do perfil. Override expirado
            aparece como informativo; o efetivo já volta a valer o que o perfil concede.
          </p>

          <MatrizPermissoes
            permissoesHerdadas={permissoesHerdadas}
            overridesOriginais={overridesOriginais}
            estado={estadoEditado}
            onAlterarLinha={alterarLinha}
          />

          {erroPermissoes && <Alert tom="danger" className={estilos.mensagem}>{erroPermissoes}</Alert>}

          <div className={estilos.rodapePermissoes}>
            <Button onClick={salvarPermissoes} disabled={!temAlteracoesPendentes || salvandoPermissoes}>
              {salvandoPermissoes
                ? 'Salvando...'
                : temAlteracoesPendentes
                  ? `Salvar alterações (${diffPendente.length})`
                  : 'Salvar alterações'}
            </Button>
          </div>
        </Card>
      </div>

      {confirmandoDesativar && (
        <ConfirmarAcaoModal
          titulo="Desativar usuário"
          mensagem={
            <>
              Tem certeza que deseja desativar <strong>{usuario.nome || usuario.email}</strong>? O acesso é perdido
              imediatamente (login e todas as permissões). O histórico e a auditoria não são apagados, e o usuário
              não é excluído do Supabase Auth — pode ser reativado depois.
            </>
          }
          perigo
          textoConfirmar="Desativar"
          confirmando={salvandoStatus}
          erro={erroStatus}
          onConfirmar={() => confirmarAlterarStatus(false)}
          onCancelar={() => setConfirmandoDesativar(false)}
          modalDS
        />
      )}
    </PageShell>
  );
}

export default function UsuarioDetalhe() {
  return (
    <RequireAuth permissao={PERMISSOES.USUARIOS_ADMINISTRAR}>
      <UsuarioDetalheConteudo />
    </RequireAuth>
  );
}
