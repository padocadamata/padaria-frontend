import { useState } from 'react';
import Modal from '../ui/Modal';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import { LIMITES, mensagemErroVinculo, validarNovoUsuario, validarVinculo } from '../../lib/admin/criarUsuario';
import { createClient } from '../../lib/supabase/client';
import estilos from './usuarios.module.css';

// Dois modos, mesmo formulário:
//   - 'novo': cria login + vínculo pela rota server-side
//     /api/admin/usuarios/criar (a service_role nunca chega ao navegador);
//   - 'vincular': login já existe no Authentication sem linha em
//     public.usuarios ("Logins sem vínculo") -- chama direto a RPC
//     admin_vincular_usuario_auth (0072) com a sessão do admin; e-mail vem
//     do Authentication, só exibido aqui.
// Escolher proprietario_admin exige confirmação explícita (mesma regra de
// UX do SeletorPerfilBase).
export default function NovoUsuarioModal({ modo = 'novo', login = null, perfis, onFechar, onConcluido }) {
  const vinculando = modo === 'vincular';
  const [dados, setDados] = useState({ nome: '', email: '', perfil: '', senha: '', confirmacao: '' });
  const [confirmaAdmin, setConfirmaAdmin] = useState(false);
  const [erros, setErros] = useState({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  function atualizar(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
    setErros((atual) => ({ ...atual, [campo]: undefined }));
    if (campo === 'perfil') setConfirmaAdmin(false);
  }

  const escolheuAdmin = dados.perfil === 'proprietario_admin';

  async function salvar() {
    setErro('');

    const validacao = vinculando ? validarVinculo(dados) : validarNovoUsuario(dados);
    const novosErros = { ...validacao.erros };
    if (!vinculando && !novosErros.senha && dados.senha !== dados.confirmacao) {
      novosErros.confirmacao = 'As senhas não conferem.';
    }
    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros);
      return;
    }
    if (escolheuAdmin && !confirmaAdmin) {
      setErro('Confirme que este usuário terá acesso total ao sistema.');
      return;
    }

    setSalvando(true);

    if (vinculando) {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('admin_vincular_usuario_auth', {
        p_usuario_id: login.id,
        p_nome: validacao.dados.nome,
        p_perfil: validacao.dados.perfil,
      });
      setSalvando(false);
      if (error) {
        setErro(mensagemErroVinculo(error));
        return;
      }
      onConcluido(data?.id || login.id);
      return;
    }

    let corpo = null;
    try {
      const resposta = await fetch('/api/admin/usuarios/criar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: validacao.dados.nome,
          email: validacao.dados.email,
          perfil: validacao.dados.perfil,
          senha: validacao.dados.senha,
        }),
      });
      corpo = await resposta.json().catch(() => null);
      setSalvando(false);

      if (resposta.ok && corpo?.usuario?.id) {
        onConcluido(corpo.usuario.id);
        return;
      }
    } catch {
      setSalvando(false);
    }

    if (corpo?.erros) setErros(corpo.erros);
    setErro(corpo?.mensagem || 'Não foi possível criar o usuário. Verifique a conexão e tente novamente.');
  }

  return (
    <Modal
      titulo={vinculando ? 'Vincular login existente' : 'Novo usuário'}
      onFechar={salvando ? undefined : onFechar}
      fecharComEsc={!salvando}
      largura="md"
    >
      <div className={estilos.grade}>
        <Field label="Nome" erro={erros.nome} className={estilos.larguraTotal}>
          <Input
            value={dados.nome}
            maxLength={LIMITES.nomeMax}
            autoComplete="off"
            onChange={(e) => atualizar('nome', e.target.value)}
            autoFocus
          />
        </Field>

        {vinculando ? (
          <Field label="E-mail (do Authentication)" className={estilos.larguraTotal}>
            <Input value={login?.email || ''} readOnly disabled />
          </Field>
        ) : (
          <Field label="E-mail" erro={erros.email} className={estilos.larguraTotal}>
            <Input
              type="email"
              value={dados.email}
              maxLength={LIMITES.emailMax}
              autoComplete="off"
              onChange={(e) => atualizar('email', e.target.value)}
            />
          </Field>
        )}

        <Field label="Perfil-base" erro={erros.perfil} className={estilos.larguraTotal}>
          <Select value={dados.perfil} onChange={(e) => atualizar('perfil', e.target.value)}>
            <option value="">Selecione</option>
            {perfis.map((p) => (
              <option key={p.nome} value={p.nome}>
                {p.nome}
                {p.descricao ? ` — ${p.descricao}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        {!vinculando && (
          <>
            <Field
              label="Senha inicial"
              erro={erros.senha}
              dica={`Mínimo de ${LIMITES.senhaMin} caracteres. Entregue à pessoa por um canal seguro.`}
            >
              <Input
                type="password"
                value={dados.senha}
                maxLength={LIMITES.senhaMax}
                autoComplete="new-password"
                onChange={(e) => atualizar('senha', e.target.value)}
              />
            </Field>
            <Field label="Confirmar senha" erro={erros.confirmacao}>
              <Input
                type="password"
                value={dados.confirmacao}
                maxLength={LIMITES.senhaMax}
                autoComplete="new-password"
                onChange={(e) => atualizar('confirmacao', e.target.value)}
              />
            </Field>
          </>
        )}

        {escolheuAdmin && (
          <div className={estilos.larguraTotal}>
            <Alert tom="warning" className={estilos.mensagem}>
              <strong>proprietario_admin</strong> tem acesso total: administra usuários, permissões e configurações.
            </Alert>
            <Checkbox
              rotulo="Confirmo que este usuário terá acesso total ao sistema"
              checked={confirmaAdmin}
              onChange={(e) => setConfirmaAdmin(e.target.checked)}
            />
          </div>
        )}
      </div>

      <p className={estilos.nota}>
        O usuário nasce ativo, com as permissões do perfil escolhido. Permissões individuais podem ser ajustadas em
        seguida, na tela de acessos.
      </p>

      {erro && (
        <Alert tom="danger" className={estilos.mensagem}>
          {erro}
        </Alert>
      )}

      <div className={estilos.rodapeModal}>
        <Button variante="secondary" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando...' : vinculando ? 'Vincular' : 'Criar usuário'}
        </Button>
      </div>
    </Modal>
  );
}
