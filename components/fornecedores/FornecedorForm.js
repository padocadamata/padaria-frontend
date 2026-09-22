import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import FornecedorRegras from './FornecedorRegras';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import estilos from './fornecedores.module.css';

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
    // Sem Esc: é um formulário longo (dados digitados se perderiam). O X do
    // cabeçalho some enquanto salva -- mesmo comportamento do "Cancelar".
    <Modal
      titulo={estaEditando ? 'Editar fornecedor' : 'Novo fornecedor'}
      onFechar={salvando ? undefined : onFechar}
      largura="lg"
      fecharComEsc={false}
    >
      <section className={estilos.secao} aria-label="Identificação">
        <h3 className={estilos.tituloSecao}>Identificação</h3>
        <div className={estilos.grade}>
          <Field label="Nome fantasia">
            <Input type="text" value={dados.nome_fantasia} onChange={(e) => atualizarCampo('nome_fantasia', e.target.value)} />
          </Field>

          <Field label="Razão social">
            <Input type="text" value={dados.razao_social} onChange={(e) => atualizarCampo('razao_social', e.target.value)} />
          </Field>

          <Field label="Tipo de documento">
            <Select value={dados.tipo_documento} onChange={(e) => atualizarCampo('tipo_documento', e.target.value)}>
              <option value="">Selecione</option>
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
            </Select>
          </Field>

          <Field label={`Documento ${!estaEditando ? '*' : ''}`.trim()}>
            <Input
              type="text"
              inputMode="numeric"
              value={dados.documento}
              onChange={(e) => atualizarCampo('documento', apenasDigitos(e.target.value))}
              placeholder="Somente números"
            />
          </Field>
        </div>
      </section>

      <section className={estilos.secao} aria-label="Contato">
        <h3 className={estilos.tituloSecao}>Contato</h3>
        <div className={estilos.grade}>
          <Field label="Nome do contato">
            <Input type="text" value={dados.contato_nome} onChange={(e) => atualizarCampo('contato_nome', e.target.value)} />
          </Field>

          <Field label="Telefone">
            <Input type="text" value={dados.telefone} onChange={(e) => atualizarCampo('telefone', e.target.value)} />
          </Field>

          <Field label="WhatsApp">
            <Input type="text" value={dados.whatsapp} onChange={(e) => atualizarCampo('whatsapp', e.target.value)} />
          </Field>

          <Field label="E-mail">
            <Input type="email" value={dados.email} onChange={(e) => atualizarCampo('email', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className={estilos.secao} aria-label="Compra e pagamento">
        <h3 className={estilos.tituloSecao}>Compra e pagamento</h3>
        <div className={estilos.grade}>
          <Field label="Forma de pagamento">
            <Input type="text" value={dados.forma_pagamento} onChange={(e) => atualizarCampo('forma_pagamento', e.target.value)} />
          </Field>

          <Field label="Modalidade de compra">
            <Select value={dados.modalidade_compra} onChange={(e) => atualizarCampo('modalidade_compra', e.target.value)}>
              <option value="pedido_com_entrega">Pedido com entrega</option>
              <option value="compra_presencial">Compra presencial</option>
            </Select>
          </Field>
        </div>
      </section>

      <section className={estilos.secao} aria-label="Endereço e observações">
        <h3 className={estilos.tituloSecao}>Endereço e observações</h3>
        <div className={estilos.grade}>
          <Field label="Endereço" className={estilos.larguraTotal}>
            <Input type="text" value={dados.endereco} onChange={(e) => atualizarCampo('endereco', e.target.value)} />
          </Field>

          <Field label="Observações" className={estilos.larguraTotal}>
            <Textarea value={dados.observacoes} onChange={(e) => atualizarCampo('observacoes', e.target.value)} rows={3} />
          </Field>
        </div>
      </section>

      {estaEditando && dados.modalidade_compra === 'pedido_com_entrega' && (
        <FornecedorRegras fornecedorId={fornecedor.id} permissoes={permissoes} />
      )}

      {dados.modalidade_compra === 'compra_presencial' && (
        <p className={estilos.nota}>Compra presencial — sem pedido programado.</p>
      )}

      {estaEditando && (
        <div className={estilos.secao}>
          <Checkbox
            rotulo="Fornecedor ativo"
            checked={dados.ativo}
            onChange={(e) => atualizarCampo('ativo', e.target.checked)}
          />
        </div>
      )}

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <div className={estilos.rodape}>
        <Button variante="secondary" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={salvando || !permitido}>
          {salvando ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </Modal>
  );
}
