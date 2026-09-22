import { useEffect, useState } from 'react';
import ConfirmarAcaoModal from './ConfirmarAcaoModal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Select from '../ui/Select';
import estilos from './usuarios.module.css';

// Troca o perfil-base de um usuário via RPC public.alterar_perfil_usuario
// (migration 0018) — nunca um UPDATE direto em usuarios, porque a RPC já
// valida perfil ativo, evita UPDATE/auditoria quando o valor não muda, e
// deixa a trigger usuarios_protecao_ultimo_admin_trigger (0016) bloquear
// rebaixar o último proprietario_admin ativo. Promover para
// proprietario_admin exige confirmação forte aqui, antes de chamar a RPC —
// a RPC em si não distingue "promover a admin" de qualquer outra troca de
// perfil, essa é uma decisão de UX, não de segurança (quem já não é admin
// nunca chega a esta tela — RequireAuth + RLS cuidam disso).
export default function SeletorPerfilBase({ nomeUsuario, perfilAtual, perfis, salvando, erro, onAlterar }) {
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
      <div className={estilos.linhaPerfil}>
        <Field label="Perfil-base">
          <Select value={selecionado} disabled={salvando} onChange={(e) => setSelecionado(e.target.value)}>
            {perfis.map((p) => (
              <option key={p.nome} value={p.nome}>
                {p.nome}
                {p.descricao ? ` — ${p.descricao}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Button onClick={pedirSalvar} disabled={!alterado || salvando}>
          {salvando ? 'Salvando...' : 'Salvar perfil'}
        </Button>
      </div>

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

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
          perigo
          textoConfirmar="Sim, tornar administrador"
          confirmando={salvando}
          onConfirmar={confirmarPromocaoAdmin}
          onCancelar={() => setConfirmandoAdmin(false)}
          modalDS
        />
      )}
    </div>
  );
}
