import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import FornecedorRegras from './FornecedorRegras';

// Duplicado intencionalmente de pages/fornecedores.js: é uma função de
// 1 linha, e criar um módulo compartilhado só para isso seria mais
// complexidade do que a duplicação em si.
function apenasDigitos(valor) {
  return (valor || '').replace(/\D/g, '');
}

function estadoInicial(fornecedor) {
  return {
    nome_fantasia: fornecedor?.nome_fantasia || '',
    razao_social: fornecedor?.razao_social || '',
    tipo_documento: fornecedor?.tipo_documento || '',
    documento: fornecedor?.documento || '',
    contato_nome: fornecedor?.contato_nome || '',
    telefone: fornecedor?.telefone || '',
    whatsapp: fornecedor?.whatsapp || '',
    email: fornecedor?.email || '',
    endereco: fornecedor?.endereco || '',
    forma_pagamento: fornecedor?.forma_pagamento || '',
    modalidade_compra: fornecedor?.modalidade_compra || 'pedido_com_entrega',
    observacoes: fornecedor?.observacoes || '',
    ativo: fornecedor ? !!fornecedor.ativo : true,
  };
}

function validar(dados, estaEditando) {
  const nomeFantasia = dados.nome_fantasia.trim();
  const razaoSocial = dados.razao_social.trim();
  const documentoDigitos = apenasDigitos(dados.documento);

  if (dados.ativo && !nomeFantasia && !razaoSocial) {
    return 'Informe nome fantasia ou razão social.';
  }

  if (!estaEditando && !documentoDigitos) {
    return 'Documento é obrigatório para cadastrar um novo fornecedor.';
  }

  if (!estaEditando && !dados.tipo_documento) {
    return 'Selecione o tipo de documento (CNPJ ou CPF) para cadastrar um novo fornecedor.';
  }

  if (documentoDigitos && !dados.tipo_documento) {
    return 'Selecione o tipo de documento (CNPJ ou CPF).';
  }

  if (!documentoDigitos && dados.tipo_documento) {
    return 'Informe o documento ou deixe o tipo de documento em branco.';
  }

  if (documentoDigitos && dados.tipo_documento === 'CNPJ' && documentoDigitos.length !== 14) {
    return 'CNPJ deve ter exatamente 14 dígitos.';
  }

  if (documentoDigitos && dados.tipo_documento === 'CPF' && documentoDigitos.length !== 11) {
    return 'CPF deve ter exatamente 11 dígitos.';
  }

  return null;
}

function montarPayload(dados) {
  const nomeFantasia = dados.nome_fantasia.trim() || null;
  const razaoSocial = dados.razao_social.trim() || null;
  const nomeDerivado = nomeFantasia || razaoSocial;
  const documentoDigitos = apenasDigitos(dados.documento);

  const payload = {
    nome_fantasia: nomeFantasia,
    razao_social: razaoSocial,
    tipo_documento: dados.tipo_documento || null,
    contato_nome: dados.contato_nome.trim() || null,
    telefone: dados.telefone.trim() || null,
    whatsapp: dados.whatsapp.trim() || null,
    email: dados.email.trim() || null,
    endereco: dados.endereco.trim() || null,
    forma_pagamento: dados.forma_pagamento.trim() || null,
    modalidade_compra: dados.modalidade_compra,
    observacoes: dados.observacoes.trim() || null,
    ativo: dados.ativo,
  };

  // nome (legado, NOT NULL): só entra no payload quando há valor derivado.
  // Em edição de um fornecedor inativo sem nome_fantasia/razao_social,
  // omitir preserva o nome legado já existente, em vez de gravar null.
  if (nomeDerivado) {
    payload.nome = nomeDerivado;
  }

  // cnpj/documento (cnpj é legado, NOT NULL): só sincronizados quando o
  // usuário informou um documento. Se ficar vazio, nenhum dos dois é
  // tocado — nunca gravamos cnpj como null, nunca inventamos documento.
  if (documentoDigitos) {
    payload.documento = documentoDigitos;
    payload.cnpj = documentoDigitos;
  }

  return payload;
}

const rotuloEstilo = {
  fontWeight: 'bold',
  display: 'block',
  marginBottom: '5px',
  fontSize: '14px',
};

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

export default function FornecedorForm({ fornecedor, onFechar, onSalvo, permissoes }) {
  const estaEditando = fornecedor != null;
  const [dados, setDados] = useState(() => estadoInicial(fornecedor));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const permitido = hasPermissao(
    permissoes,
    estaEditando ? PERMISSOES.FORNECEDORES_EDITAR : PERMISSOES.FORNECEDORES_INSERIR
  );

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar() {
    if (!permitido) {
      setErro('Você não tem permissão para esta ação.');
      return;
    }

    const mensagemValidacao = validar(dados, estaEditando);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();

    // Decisão D: troca de pedido_com_entrega para compra_presencial exige
    // verificar regras ativas e confirmar com o usuário antes de qualquer
    // escrita, pois vamos inativar (nunca apagar) as regras em seguida.
    const trocandoParaCompraPresencial =
      estaEditando &&
      fornecedor.modalidade_compra === 'pedido_com_entrega' &&
      dados.modalidade_compra === 'compra_presencial';

    let precisaInativarRegras = false;
    let quantidadeRegrasAtivas = 0;

    if (trocandoParaCompraPresencial) {
      const { data: regrasAtivas, error: erroConsulta } = await supabase
        .from('fornecedor_regras_pedido')
        .select('id')
        .eq('fornecedor_id', fornecedor.id)
        .eq('ativo', true);

      if (erroConsulta) {
        console.error('Erro ao verificar regras ativas:', erroConsulta);
        setSalvando(false);
        setErro('Não foi possível verificar as regras ativas deste fornecedor.');
        return;
      }

      quantidadeRegrasAtivas = (regrasAtivas || []).length;

      if (quantidadeRegrasAtivas > 0) {
        setSalvando(false);

        const confirmou = window.confirm(
          `Este fornecedor possui ${quantidadeRegrasAtivas} regra(s) de pedido ativa(s).\n` +
            'Ao mudar para compra presencial, essas regras serão inativadas, mas permanecerão no histórico.\n' +
            'Deseja continuar?'
        );

        if (!confirmou) {
          return;
        }

        setSalvando(true);
        precisaInativarRegras = true;
      }
    }

    const payload = montarPayload(dados);

    const resultado = estaEditando
      ? await supabase.from('fornecedores').update(payload).eq('id', fornecedor.id)
      : await supabase.from('fornecedores').insert({ ...payload, ativo: true });

    if (resultado.error) {
      setSalvando(false);

      if (resultado.error.code === '23505') {
        setErro('Já existe um fornecedor com este documento.');
      } else if (resultado.error.code === '23514') {
        setErro('Fornecedor ativo precisa ter nome fantasia ou razão social.');
      } else {
        console.error('Erro ao salvar fornecedor:', resultado.error);
        setErro('Não foi possível salvar o fornecedor.');
      }
      return;
    }

    if (precisaInativarRegras) {
      const { data: regrasAtualizadas, error: erroRegras } = await supabase
        .from('fornecedor_regras_pedido')
        .update({ ativo: false })
        .eq('fornecedor_id', fornecedor.id)
        .eq('ativo', true)
        .select('id');

      setSalvando(false);

      const quantidadeAtualizada = (regrasAtualizadas || []).length;

      // Falha parcial real: o fornecedor já foi salvo como
      // compra_presencial, mas as regras não puderam ser inativadas — seja
      // por erro explícito, seja porque a quantidade efetivamente afetada
      // pelo UPDATE não bate com a quantidade encontrada na consulta
      // prévia. Não mostramos sucesso nem fechamos o modal silenciosamente,
      // nem tentamos nenhum rollback — deixamos o erro explícito para
      // revisão manual.
      if (erroRegras || quantidadeAtualizada !== quantidadeRegrasAtivas) {
        if (erroRegras) {
          console.error('Erro ao inativar regras após troca de modalidade:', erroRegras);
        } else {
          console.error(
            'Divergência ao inativar regras após troca de modalidade: esperado ' +
              quantidadeRegrasAtivas +
              ', efetivamente atualizado ' +
              quantidadeAtualizada
          );
        }

        setErro(
          'A modalidade do fornecedor foi alterada, mas não foi possível inativar todas as regras de pedido. Revise o fornecedor antes de continuar.'
        );
        return;
      }

      onSalvo();
      return;
    }

    setSalvando(false);
    onSalvo();
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          maxWidth: '700px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          {estaEditando ? 'Editar fornecedor' : 'Novo fornecedor'}
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '15px',
            marginBottom: '15px',
          }}
        >
          <div>
            <label style={rotuloEstilo}>Nome fantasia</label>
            <input
              type="text"
              value={dados.nome_fantasia}
              onChange={(e) => atualizarCampo('nome_fantasia', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Razão social</label>
            <input
              type="text"
              value={dados.razao_social}
              onChange={(e) => atualizarCampo('razao_social', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Tipo de documento</label>
            <select
              value={dados.tipo_documento}
              onChange={(e) => atualizarCampo('tipo_documento', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Selecione</option>
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
            </select>
          </div>

          <div>
            <label style={rotuloEstilo}>
              Documento {!estaEditando && '*'}
            </label>
            <input
              type="text"
              value={dados.documento}
              onChange={(e) => atualizarCampo('documento', apenasDigitos(e.target.value))}
              placeholder="Somente números"
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Nome do contato</label>
            <input
              type="text"
              value={dados.contato_nome}
              onChange={(e) => atualizarCampo('contato_nome', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Telefone</label>
            <input
              type="text"
              value={dados.telefone}
              onChange={(e) => atualizarCampo('telefone', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>WhatsApp</label>
            <input
              type="text"
              value={dados.whatsapp}
              onChange={(e) => atualizarCampo('whatsapp', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>E-mail</label>
            <input
              type="email"
              value={dados.email}
              onChange={(e) => atualizarCampo('email', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Forma de pagamento</label>
            <input
              type="text"
              value={dados.forma_pagamento}
              onChange={(e) => atualizarCampo('forma_pagamento', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Modalidade de compra</label>
            <select
              value={dados.modalidade_compra}
              onChange={(e) => atualizarCampo('modalidade_compra', e.target.value)}
              style={campoEstilo}
            >
              <option value="pedido_com_entrega">Pedido com entrega</option>
              <option value="compra_presencial">Compra presencial</option>
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={rotuloEstilo}>Endereço</label>
            <input
              type="text"
              value={dados.endereco}
              onChange={(e) => atualizarCampo('endereco', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={rotuloEstilo}>Observações</label>
            <textarea
              value={dados.observacoes}
              onChange={(e) => atualizarCampo('observacoes', e.target.value)}
              style={{ ...campoEstilo, minHeight: '70px', fontFamily: 'Arial' }}
            />
          </div>
        </div>

        {estaEditando && dados.modalidade_compra === 'pedido_com_entrega' && (
          <FornecedorRegras
            fornecedorId={fornecedor.id}
            permissoes={permissoes}
          />
        )}

        {dados.modalidade_compra === 'compra_presencial' && (
          <p style={{ color: '#666', fontSize: '13px', fontStyle: 'italic', marginBottom: '15px' }}>
            Compra presencial — sem pedido programado.
          </p>
        )}

        {estaEditando && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={dados.ativo}
                onChange={(e) => atualizarCampo('ativo', e.target.checked)}
              />
              Fornecedor ativo
            </label>
          </div>
        )}

        {erro && (
          <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !permitido}
            style={{
              padding: '10px 20px',
              backgroundColor: '#8B4513',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando || !permitido ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
