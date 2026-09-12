import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import {
  normalizarMaiusculas,
  normalizarEmail,
  normalizarCpf,
  formatarCpf,
  cpfValido,
  UNIDADES_FEDERATIVAS,
} from '../../lib/funcionarios/normalizacao';

// Mesmo componente para /funcionarios/novo (funcionario=null) e para a
// aba "Dados pessoais/profissionais" de /funcionarios/[id] (funcionario
// preenchido) -- mesmo padrão de components/catalogo/DadosProdutoForm.js.
// validar/montarPayload/mensagemErro exportadas para eventual reuso (ex.:
// edição inline numa lista futura), mesmo princípio de nunca duplicar a
// mesma regra em dois lugares.
function estadoInicial(funcionario) {
  return {
    nome: funcionario?.nome || '',
    cpf: funcionario?.cpf ? formatarCpf(funcionario.cpf) : '',
    rg: funcionario?.rg || '',
    data_nascimento: funcionario?.data_nascimento || '',
    telefone: funcionario?.telefone || '',
    email: funcionario?.email || '',
    observacoes: funcionario?.observacoes || '',
    cep: funcionario?.cep || '',
    logradouro: funcionario?.logradouro || '',
    numero: funcionario?.numero || '',
    complemento: funcionario?.complemento || '',
    bairro: funcionario?.bairro || '',
    cidade: funcionario?.cidade || '',
    estado: funcionario?.estado || '',
    nome_contato_emergencia: funcionario?.nome_contato_emergencia || '',
    telefone_contato_emergencia: funcionario?.telefone_contato_emergencia || '',
    parentesco_contato_emergencia: funcionario?.parentesco_contato_emergencia || '',
    cargo_id: funcionario?.cargo_id || '',
    data_admissao: funcionario?.data_admissao || '',
    data_demissao: funcionario?.data_demissao || '',
    ativo: funcionario ? !!funcionario.ativo : true,
    usuario_id: funcionario?.usuario_id || '',
  };
}

export function validar(dados) {
  if (!dados.nome.trim()) {
    return 'Informe o nome do funcionário.';
  }
  const cpfDigitos = normalizarCpf(dados.cpf);
  if (cpfDigitos && !cpfValido(cpfDigitos)) {
    return 'CPF inválido — confira os dígitos informados.';
  }
  if (dados.estado && !/^[A-Z]{2}$/.test(dados.estado)) {
    return 'Estado (UF) inválido.';
  }
  return null;
}

// data_demissao preenchida implica ativo=false -- espelha aqui, do lado
// do frontend, o mesmo invariante que o trigger funcionarios_aplicar_invariantes
// (migration 0054) impõe no banco, para o estado local já refletir o que
// será persistido de fato (nunca fingir que ficou ativo quando o banco
// vai forçar false).
export function montarPayload(dados) {
  const dataDemissao = dados.data_demissao || null;
  return {
    nome: normalizarMaiusculas(dados.nome),
    cpf: normalizarCpf(dados.cpf),
    rg: dados.rg.trim() || null,
    data_nascimento: dados.data_nascimento || null,
    telefone: dados.telefone.trim() || null,
    email: normalizarEmail(dados.email),
    observacoes: dados.observacoes || null,
    cep: dados.cep.trim() || null,
    logradouro: normalizarMaiusculas(dados.logradouro) || null,
    numero: normalizarMaiusculas(dados.numero) || null,
    complemento: normalizarMaiusculas(dados.complemento) || null,
    bairro: normalizarMaiusculas(dados.bairro) || null,
    cidade: normalizarMaiusculas(dados.cidade) || null,
    estado: dados.estado || null,
    nome_contato_emergencia: normalizarMaiusculas(dados.nome_contato_emergencia) || null,
    telefone_contato_emergencia: dados.telefone_contato_emergencia.trim() || null,
    parentesco_contato_emergencia: normalizarMaiusculas(dados.parentesco_contato_emergencia) || null,
    cargo_id: dados.cargo_id || null,
    data_admissao: dados.data_admissao || null,
    data_demissao: dataDemissao,
    ativo: dataDemissao ? false : dados.ativo,
    usuario_id: dados.usuario_id || null,
  };
}

export function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (error.code === '23505') {
    if (msg.includes('funcionarios_cpf_idx')) return 'Já existe um funcionário cadastrado com este CPF.';
    if (msg.includes('usuario_id')) return 'Este usuário do sistema já está vinculado a outro funcionário.';
    return 'Já existe um funcionário com um dos dados informados.';
  }
  if (error.code === '23514') {
    if (msg.includes('estado')) return 'Estado (UF) inválido.';
    return 'O nome não pode ficar em branco.';
  }
  if (error.code === '23503') {
    return 'O cargo ou o usuário selecionado não existe mais — atualize a página e tente novamente.';
  }

  console.error('Erro ao salvar funcionário:', error);
  return 'Não foi possível salvar o funcionário. Tente novamente ou avise um administrador.';
}

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '13px', color: '#444' };
const campoEstilo = { width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box', fontSize: '14px' };
const linhaEstilo = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '14px' };

function Campo({ label, children }) {
  return (
    <div>
      <label style={rotuloEstilo}>{label}</label>
      {children}
    </div>
  );
}

function Secao({ titulo, corPrimaria, children }) {
  return (
    <div style={{ marginBottom: '22px' }}>
      <h4 style={{ color: corPrimaria, fontSize: '14px', margin: '0 0 10px 0', borderBottom: `1px solid ${corPrimaria}33`, paddingBottom: '4px' }}>
        {titulo}
      </h4>
      {children}
    </div>
  );
}

export default function DadosFuncionarioForm({ funcionario, corPrimaria = '#8B4513', podeEditar, onCriado, onSalvo }) {
  const estaEditando = funcionario != null;
  const [dados, setDados] = useState(() => estadoInicial(funcionario));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const [cargos, setCargos] = useState([]);
  const [usuariosDisponiveis, setUsuariosDisponiveis] = useState([]);
  const [carregandoAuxiliares, setCarregandoAuxiliares] = useState(true);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarAuxiliares() {
      const supabase = createClient();
      const [{ data: cargosData }, { data: usuariosData }, { data: vinculosData }] = await Promise.all([
        supabase.from('funcionarios_cargos').select('id, nome, ativo').order('nome'),
        supabase.from('usuarios').select('id, nome, email').eq('ativo', true).order('nome'),
        supabase.from('funcionarios').select('usuario_id').not('usuario_id', 'is', null),
      ]);
      if (!efeitoAtivo) return;

      setCargos(cargosData || []);

      const vinculados = new Set((vinculosData || []).map((v) => v.usuario_id));
      // O próprio usuário já vinculado a ESTE funcionário continua
      // disponível na lista (senão o <select> perderia a seleção atual).
      const disponiveis = (usuariosData || []).filter(
        (u) => !vinculados.has(u.id) || u.id === funcionario?.usuario_id
      );
      setUsuariosDisponiveis(disponiveis);
      setCarregandoAuxiliares(false);
    }

    carregarAuxiliares();
    return () => {
      efeitoAtivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionario?.usuario_id]);

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar(e) {
    e.preventDefault();
    setErro('');

    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setSalvando(true);
    const supabase = createClient();
    const payload = montarPayload(dados);

    if (estaEditando) {
      const { data, error } = await supabase.from('funcionarios').update(payload).eq('id', funcionario.id).select().single();
      setSalvando(false);
      if (error) {
        setErro(mensagemErro(error));
        return;
      }
      onSalvo?.(data);
    } else {
      const { data, error } = await supabase.from('funcionarios').insert(payload).select().single();
      setSalvando(false);
      if (error) {
        setErro(mensagemErro(error));
        return;
      }
      onCriado?.(data.id);
    }
  }

  return (
    <form onSubmit={salvar}>
      <Secao titulo="Identificação" corPrimaria={corPrimaria}>
        <div style={linhaEstilo}>
          <Campo label="Nome *">
            <input type="text" value={dados.nome} disabled={!podeEditar} onChange={(e) => atualizarCampo('nome', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="CPF">
            <input type="text" value={dados.cpf} disabled={!podeEditar} placeholder="000.000.000-00" onChange={(e) => atualizarCampo('cpf', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="RG / Documento">
            <input type="text" value={dados.rg} disabled={!podeEditar} onChange={(e) => atualizarCampo('rg', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Data de nascimento">
            <input type="date" value={dados.data_nascimento} disabled={!podeEditar} onChange={(e) => atualizarCampo('data_nascimento', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Telefone">
            <input type="text" value={dados.telefone} disabled={!podeEditar} onChange={(e) => atualizarCampo('telefone', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="E-mail">
            <input type="email" value={dados.email} disabled={!podeEditar} onChange={(e) => atualizarCampo('email', e.target.value)} style={campoEstilo} />
          </Campo>
        </div>
        <Campo label="Observações">
          <textarea value={dados.observacoes} disabled={!podeEditar} onChange={(e) => atualizarCampo('observacoes', e.target.value)} rows={2} style={{ ...campoEstilo, resize: 'vertical' }} />
        </Campo>
      </Secao>

      <Secao titulo="Endereço" corPrimaria={corPrimaria}>
        <div style={linhaEstilo}>
          <Campo label="CEP">
            <input type="text" value={dados.cep} disabled={!podeEditar} onChange={(e) => atualizarCampo('cep', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Logradouro">
            <input type="text" value={dados.logradouro} disabled={!podeEditar} onChange={(e) => atualizarCampo('logradouro', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Número">
            <input type="text" value={dados.numero} disabled={!podeEditar} onChange={(e) => atualizarCampo('numero', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Complemento">
            <input type="text" value={dados.complemento} disabled={!podeEditar} onChange={(e) => atualizarCampo('complemento', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Bairro">
            <input type="text" value={dados.bairro} disabled={!podeEditar} onChange={(e) => atualizarCampo('bairro', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Cidade">
            <input type="text" value={dados.cidade} disabled={!podeEditar} onChange={(e) => atualizarCampo('cidade', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Estado (UF)">
            <select value={dados.estado} disabled={!podeEditar} onChange={(e) => atualizarCampo('estado', e.target.value)} style={campoEstilo}>
              <option value="">—</option>
              {UNIDADES_FEDERATIVAS.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Contato de emergência" corPrimaria={corPrimaria}>
        <div style={linhaEstilo}>
          <Campo label="Nome">
            <input type="text" value={dados.nome_contato_emergencia} disabled={!podeEditar} onChange={(e) => atualizarCampo('nome_contato_emergencia', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Telefone">
            <input type="text" value={dados.telefone_contato_emergencia} disabled={!podeEditar} onChange={(e) => atualizarCampo('telefone_contato_emergencia', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Parentesco">
            <input type="text" value={dados.parentesco_contato_emergencia} disabled={!podeEditar} onChange={(e) => atualizarCampo('parentesco_contato_emergencia', e.target.value)} style={campoEstilo} />
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Dados profissionais" corPrimaria={corPrimaria}>
        <div style={linhaEstilo}>
          <Campo label="Cargo/Função">
            <select value={dados.cargo_id} disabled={!podeEditar} onChange={(e) => atualizarCampo('cargo_id', e.target.value)} style={campoEstilo}>
              <option value="">—</option>
              {cargos.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.ativo}>
                  {c.nome}{!c.ativo ? ' (inativo)' : ''}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Data de admissão">
            <input type="date" value={dados.data_admissao} disabled={!podeEditar} onChange={(e) => atualizarCampo('data_admissao', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Data de demissão">
            <input type="date" value={dados.data_demissao} disabled={!podeEditar} onChange={(e) => atualizarCampo('data_demissao', e.target.value)} style={campoEstilo} />
          </Campo>
          <Campo label="Usuário do sistema vinculado (opcional)">
            <select
              value={dados.usuario_id}
              disabled={!podeEditar || carregandoAuxiliares}
              onChange={(e) => atualizarCampo('usuario_id', e.target.value)}
              style={campoEstilo}
            >
              <option value="">— Sem login no sistema —</option>
              {usuariosDisponiveis.map((u) => (
                <option key={u.id} value={u.id}>{u.nome} ({u.email})</option>
              ))}
            </select>
          </Campo>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: dados.data_demissao ? '#999' : '#333', fontSize: '14px' }}>
          <input
            type="checkbox"
            checked={dados.data_demissao ? false : dados.ativo}
            disabled={!podeEditar || !!dados.data_demissao}
            onChange={(e) => atualizarCampo('ativo', e.target.checked)}
          />
          Funcionário ativo
        </label>
        {dados.data_demissao && (
          <p style={{ fontSize: '12px', color: '#b26a00', margin: '4px 0 0 24px', fontWeight: 'bold' }}>
            Enquanto a data de demissão estiver preenchida, o funcionário fica inativo e esta caixa fica bloqueada
            — o banco força isso automaticamente, mesmo que você tente marcar. Para reativar: (1) limpe a data de
            demissão acima e (2) marque "Funcionário ativo" manualmente.
          </p>
        )}
      </Secao>

      {erro && <p style={{ color: '#f44336', fontSize: '14px' }}>{erro}</p>}

      {podeEditar && (
        <button
          type="submit"
          disabled={salvando}
          style={{ padding: '10px 24px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: salvando ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >
          {salvando ? 'Salvando...' : estaEditando ? 'Salvar alterações' : 'Cadastrar funcionário'}
        </button>
      )}
    </form>
  );
}
