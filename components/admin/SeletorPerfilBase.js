import { useEffect, useState } from 'react';
import ConfirmarAcaoModal from './ConfirmarAcaoModal';

// Troca o perfil-base de um usuário via RPC public.alterar_perfil_usuario
// (migration 0018) — nunca um UPDATE direto em usuarios, porque a RPC já
// valida perfil ativo, evita UPDATE/auditoria quando o valor não muda, e
// deixa a trigger usuarios_protecao_ultimo_admin_trigger (0016) bloquear
// rebaixar o último proprietario_admin ativo. Promover para
// proprietario_admin exige confirmação forte aqui, antes de chamar a RPC —
// a RPC em si não distingue "promover a admin" de qualquer outra troca de
// perfil, essa é uma decisão de UX, não de segurança (quem já não é admin
// nunca chega a esta tela — RequireAuth + RLS cuidam disso).
export default function SeletorPerfilBase({ nomeUsuario, perfilAtual, perfis, corPrimaria, salvando, erro, onAlterar }) {
  const [selecionado, setSelecionado] = useState(perfilAtual);
  const [confirmandoAdmin, setConfirmandoAdmin] = useState(false);

  useEffect(() => {
    setSelecionado(perfilAtual);
  }, [perfilAtual]);

  const alterado = selecionado !== perfilAtual;

  function pedirSalvar() {
    if (!alterado) return;

    if (selecionado === 'proprietario_admin') {
      setConfirmandoAdmin(true);
      return;
    }

    onAlterar(selecionado);
  }

  function confirmarPromocaoAdmin() {
    setConfirmandoAdmin(false);
    onAlterar(selecionado);
  }

  return (
    <div>
      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Perfil-base</label>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selecionado}
          onChange={(e) => setSelecionado(e.target.value)}
          disabled={salvando}
          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '5px', minWidth: '220px' }}
        >
          {perfis.map((p) => (
            <option key={p.nome} value={p.nome}>
              {p.nome}
              {p.descricao ? ` — ${p.descricao}` : ''}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={pedirSalvar}
          disabled={!alterado || salvando}
          style={{
            padding: '8px 16px',
            backgroundColor: alterado ? corPrimaria : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: alterado && !salvando ? 'pointer' : 'not-allowed',
            fontWeight: 'bold',
          }}
        >
          {salvando ? 'Salvando...' : 'Salvar perfil'}
        </button>
      </div>

      {erro && <p style={{ color: '#f44336', marginTop: '10px', fontSize: '14px' }}>{erro}</p>}

      {confirmandoAdmin && (
        <ConfirmarAcaoModal
          titulo="Conceder acesso total"
          mensagem={
            <>
              Isso vai tornar <strong>{nomeUsuario}</strong> um <strong>proprietário/administrador</strong>, com
              acesso total ao sistema — incluindo gerenciar outros usuários, permissões e configurações
              administrativas. Esta ação não pode ser desfeita automaticamente e exige outro administrador para
              reverter depois. Tem certeza?
            </>
          }
          corPrimaria={corPrimaria}
          perigo
          textoConfirmar="Sim, tornar administrador"
          confirmando={salvando}
          onConfirmar={confirmarPromocaoAdmin}
          onCancelar={() => setConfirmandoAdmin(false)}
        />
      )}
    </div>
  );
}
