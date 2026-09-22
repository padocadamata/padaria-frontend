import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import estilos from './fornecedores.module.css';

// rotuloEstilo/campoEstilo duplicados intencionalmente de FornecedorForm.js
// (e DIAS_SEMANA é específico deste arquivo) — mesmo raciocínio de
// apenasDigitos em FornecedorForm.js: são poucas linhas, e um módulo
// compartilhado só para isso seria mais complexidade do que vale a pena.

const DIAS_SEMANA = [
  { valor: '1', rotulo: 'Segunda-feira' },
  { valor: '2', rotulo: 'Terça-feira' },
  { valor: '3', rotulo: 'Quarta-feira' },
  { valor: '4', rotulo: 'Quinta-feira' },
  { valor: '5', rotulo: 'Sexta-feira' },
  { valor: '6', rotulo: 'Sábado' },
  { valor: '7', rotulo: 'Domingo' },
];

function estadoInicial(regra) {
  return {
    dia_pedido: regra?.dia_pedido != null ? String(regra.dia_pedido) : '',
    horario_limite: regra?.horario_limite ? regra.horario_limite.slice(0, 5) : '',
    tipo_entrega: regra?.tipo_entrega || 'prazo_dias',
    dias_prazo: regra?.dias_prazo != null ? String(regra.dias_prazo) : '',
    dia_entrega: regra?.dia_entrega != null ? String(regra.dia_entrega) : '',
    observacao: regra?.observacao || '',
    ativo: regra ? !!regra.ativo : true,
  };
}

function validar(dados) {
  if (dados.tipo_entrega === 'prazo_dias') {
    if (dados.dias_prazo === '') {
      return 'Informe a quantidade de dias (D+N).';
    }

    if (Number(dados.dias_prazo) < 0) {
      return 'Dias de prazo não pode ser negativo.';
    }
  }

  if (dados.tipo_entrega === 'dia_fixo' && !dados.dia_entrega) {
    return 'Selecione o dia fixo de entrega.';
  }

  return null;
}

function montarPayload(dados, fornecedorId, estaEditando) {
  const payload = {
    dia_pedido: dados.dia_pedido === '' ? null : Number(dados.dia_pedido),
    horario_limite: dados.horario_limite || null,
    tipo_entrega: dados.tipo_entrega,
    dias_prazo: dados.tipo_entrega === 'prazo_dias' ? Number(dados.dias_prazo) : null,
    dia_entrega: dados.tipo_entrega === 'dia_fixo' ? Number(dados.dia_entrega) : null,
    observacao: dados.observacao.trim() || null,
    ativo: dados.ativo,
  };

  // fornecedor_id só é enviado na criação: no UPDATE não faz sentido
  // (nem deveria) trocar de qual fornecedor a regra pertence.
  if (!estaEditando) {
    payload.fornecedor_id = fornecedorId;
  }

  return payload;
}

export default function FornecedorRegraForm({ regra, fornecedorId, onFechar, onSalvo, permissoes }) {
  const estaEditando = regra != null;
  const [dados, setDados] = useState(() => estadoInicial(regra));
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

    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();
    const payload = montarPayload(dados, fornecedorId, estaEditando);

    const resultado = estaEditando
      ? await supabase.from('fornecedor_regras_pedido').update(payload).eq('id', regra.id)
      : await supabase.from('fornecedor_regras_pedido').insert(payload);

    setSalvando(false);

    if (resultado.error) {
      console.error('Erro ao salvar regra:', resultado.error);
      setErro('Não foi possível salvar a regra.');
      return;
    }

    onSalvo();
  }

  return (
    <Modal titulo={estaEditando ? 'Editar regra' : 'Nova regra'} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilos.grade}>
        <Field label="Dia do pedido">
          <Select value={dados.dia_pedido} onChange={(e) => atualizarCampo('dia_pedido', e.target.value)}>
            <option value="">Diário</option>
            {DIAS_SEMANA.map((dia) => (
              <option key={dia.valor} value={dia.valor}>
                {dia.rotulo}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tipo de entrega">
          <Select value={dados.tipo_entrega} onChange={(e) => atualizarCampo('tipo_entrega', e.target.value)}>
            <option value="prazo_dias">Prazo em dias</option>
            <option value="dia_fixo">Dia fixo</option>
          </Select>
        </Field>

        {dados.tipo_entrega === 'prazo_dias' ? (
          <Field label="Dias de prazo (D+N)">
            <Input
              type="number"
              min="0"
              value={dados.dias_prazo}
              onChange={(e) => atualizarCampo('dias_prazo', e.target.value)}
              placeholder="Ex.: 1"
            />
          </Field>
        ) : (
          <Field label="Dia fixo de entrega">
            <Select value={dados.dia_entrega} onChange={(e) => atualizarCampo('dia_entrega', e.target.value)}>
              <option value="">Selecione</option>
              {DIAS_SEMANA.map((dia) => (
                <option key={dia.valor} value={dia.valor}>
                  {dia.rotulo}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Horário limite do pedido">
          <Input type="time" value={dados.horario_limite} onChange={(e) => atualizarCampo('horario_limite', e.target.value)} />
        </Field>

        <Field label="Observação" className={estilos.larguraTotal}>
          <Textarea value={dados.observacao} onChange={(e) => atualizarCampo('observacao', e.target.value)} rows={2} />
        </Field>

        {estaEditando && (
          <div className={estilos.larguraTotal}>
            <Checkbox rotulo="Regra ativa" checked={dados.ativo} onChange={(e) => atualizarCampo('ativo', e.target.checked)} />
          </div>
        )}
      </div>

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
