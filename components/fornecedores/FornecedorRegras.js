import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import FornecedorRegraForm from './FornecedorRegraForm';

const DIAS_SEMANA_LABEL = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};

function descreverPedido(diaPedido) {
  return diaPedido ? DIAS_SEMANA_LABEL[diaPedido] : 'Diário';
}

function descreverEntrega(regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return `D+${regra.dias_prazo}`;
  }

  return `Entrega ${DIAS_SEMANA_LABEL[regra.dia_entrega]}`;
}

function formatarHorario(horarioLimite) {
  if (!horarioLimite) {
    return null;
  }

  return horarioLimite.slice(0, 5);
}

export default function FornecedorRegras({ fornecedorId, permissoes }) {
  const [regras, setRegras] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mostrarInativas, setMostrarInativas] = useState(false);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [regraEmEdicao, setRegraEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarRegras() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      const { data, error } = await supabase
        .from('fornecedor_regras_pedido')
        .select(
          'id, dia_pedido, horario_limite, tipo_entrega, dias_prazo, dia_entrega, observacao, ativo'
        )
        .eq('fornecedor_id', fornecedorId)
        .order('dia_pedido', { ascending: true, nullsFirst: true });

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error('Erro ao carregar regras:', error);
        setErro('Não foi possível carregar as regras de pedido e entrega.');
        setRegras([]);
      } else {
        setRegras(data || []);
      }

      setCarregando(false);
    }

    carregarRegras();

    return () => {
      efeitoAtivo = false;
    };
  }, [fornecedorId, recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);

    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  function abrirNovaRegra() {
    setRegraEmEdicao(null);
    setModalRegraAberto(true);
  }

  function abrirEdicaoRegra(regra) {
    setRegraEmEdicao(regra);
    setModalRegraAberto(true);
  }

  function fecharModalRegra() {
    setModalRegraAberto(false);
    setRegraEmEdicao(null);
  }

  function aoSalvarRegra() {
    const estaEditando = regraEmEdicao != null;

    fecharModalRegra();

    setMensagemSucesso(
      estaEditando ? 'Regra atualizada com sucesso.' : 'Regra cadastrada com sucesso.'
    );

    setRecarregarTick((tick) => tick + 1);
  }

  if (!hasPermissao(permissoes, PERMISSOES.FORNECEDORES_VISUALIZAR)) {
    return null;
  }

  const regrasVisiveis = mostrarInativas ? regras : regras.filter((regra) => regra.ativo);

  return (
    <div
      style={{
        marginTop: '20px',
        paddingTop: '20px',
        borderTop: '1px solid #ddd',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '10px',
        }}
      >
        <h4 style={{ margin: 0 }}>Regras de pedido e entrega</h4>

        {hasPermissao(permissoes, PERMISSOES.FORNECEDORES_INSERIR) && (
          <button
            type="button"
            onClick={abrirNovaRegra}
            style={{
              padding: '8px 16px',
              backgroundColor: '#8B4513',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
            }}
          >
            + Nova regra
          </button>
        )}
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '10px',
          fontSize: '14px',
        }}
      >
        <input
          type="checkbox"
          checked={mostrarInativas}
          onChange={(e) => setMostrarInativas(e.target.checked)}
        />
        Mostrar regras inativas
      </label>

      {mensagemSucesso && (
        <p style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>
          {mensagemSucesso}
        </p>
      )}

      {carregando ? (
        <p>Carregando regras...</p>
      ) : erro ? (
        <p style={{ color: '#f44336' }}>{erro}</p>
      ) : regrasVisiveis.length === 0 ? (
        <p style={{ color: '#666' }}>Nenhuma regra ativa cadastrada.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {regrasVisiveis.map((regra) => (
            <div
              key={regra.id}
              style={{
                backgroundColor: '#f9f9f9',
                padding: '10px 15px',
                borderRadius: '5px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold' }}>
                  {descreverPedido(regra.dia_pedido)} → {descreverEntrega(regra)}
                  {!regra.ativo && (
                    <span
                      style={{
                        marginLeft: '8px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        color: 'white',
                        backgroundColor: '#9e9e9e',
                      }}
                    >
                      Inativa
                    </span>
                  )}
                </div>

                {formatarHorario(regra.horario_limite) && (
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    Pedido até {formatarHorario(regra.horario_limite)}
                  </div>
                )}

                {regra.observacao && (
                  <div style={{ fontSize: '13px', color: '#666', fontStyle: 'italic' }}>
                    {regra.observacao}
                  </div>
                )}
              </div>

              {hasPermissao(permissoes, PERMISSOES.FORNECEDORES_EDITAR) && (
                <button
                  type="button"
                  onClick={() => abrirEdicaoRegra(regra)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#2196F3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Editar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modalRegraAberto && (
        <FornecedorRegraForm
          fornecedorId={fornecedorId}
          regra={regraEmEdicao}
          permissoes={permissoes}
          onFechar={fecharModalRegra}
          onSalvo={aoSalvarRegra}
        />
      )}
    </div>
  );
}
