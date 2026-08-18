import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';

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
        zIndex: 1001,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          {estaEditando ? 'Editar regra' : 'Nova regra'}
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Dia do pedido</label>
          <select
            value={dados.dia_pedido}
            onChange={(e) => atualizarCampo('dia_pedido', e.target.value)}
            style={campoEstilo}
          >
            <option value="">Diário</option>
            {DIAS_SEMANA.map((dia) => (
              <option key={dia.valor} value={dia.valor}>
                {dia.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Tipo de entrega</label>
          <select
            value={dados.tipo_entrega}
            onChange={(e) => atualizarCampo('tipo_entrega', e.target.value)}
            style={campoEstilo}
          >
            <option value="prazo_dias">Prazo em dias</option>
            <option value="dia_fixo">Dia fixo</option>
          </select>
        </div>

        {dados.tipo_entrega === 'prazo_dias' ? (
          <div style={{ marginBottom: '15px' }}>
            <label style={rotuloEstilo}>Dias de prazo (D+N)</label>
            <input
              type="number"
              min="0"
              value={dados.dias_prazo}
              onChange={(e) => atualizarCampo('dias_prazo', e.target.value)}
              placeholder="Ex.: 1"
              style={campoEstilo}
            />
          </div>
        ) : (
          <div style={{ marginBottom: '15px' }}>
            <label style={rotuloEstilo}>Dia fixo de entrega</label>
            <select
              value={dados.dia_entrega}
              onChange={(e) => atualizarCampo('dia_entrega', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Selecione</option>
              {DIAS_SEMANA.map((dia) => (
                <option key={dia.valor} value={dia.valor}>
                  {dia.rotulo}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Horário limite do pedido</label>
          <input
            type="time"
            value={dados.horario_limite}
            onChange={(e) => atualizarCampo('horario_limite', e.target.value)}
            style={campoEstilo}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Observação</label>
          <textarea
            value={dados.observacao}
            onChange={(e) => atualizarCampo('observacao', e.target.value)}
            style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial' }}
          />
        </div>

        {estaEditando && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={dados.ativo}
                onChange={(e) => atualizarCampo('ativo', e.target.checked)}
              />
              Regra ativa
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
