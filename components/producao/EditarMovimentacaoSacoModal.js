import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { mensagemErroSacos, TIPO_MOVIMENTO_LABEL } from '../../lib/producao/mensagensSacos';

// Corrige uma movimentação MANUAL já registrada (abertura ou ajuste
// manual -- entradas automáticas de pedido nunca chegam aqui, a própria
// RPC editar_movimentacao_saco rejeita). Único caminho é a RPC (SECURITY
// DEFINER) -- nunca UPDATE direto em sacos_fechados_movimentacoes (sem
// policy de UPDATE de propósito). A RPC corrige atomicamente a
// movimentação de sacos E a movimentação de estoque vinculada, usando o
// peso snapshot original -- nenhuma baixa nova é criada, o resultado
// líquido fica correto.
//
// UX: para tipo='abertura' o usuário sempre vê/informa um número
// POSITIVO ("quantos sacos foram abertos"), mesmo que no banco
// quantidade_sacos seja negativo -- a conversão de sinal acontece aqui,
// nunca exposta ao usuário. Para tipo='saldo_inicial' o valor no banco já
// é positivo (é sempre uma entrada), então mostra/envia direto, só
// bloqueando um valor <= 0. Para ajuste_manual (nenhuma RPC ainda cria
// esse tipo nesta V1 -- ver lacuna reportada -- mas o campo já existe no
// domínio, então o modal já suporta) o valor mostrado/editado é o próprio
// valor assinado.
export default function EditarMovimentacaoSacoModal({ movimentacao, corPrimaria = '#8B4513', onSalvo, onCancelar }) {
  const ehAbertura = movimentacao.tipo === 'abertura';
  const ehSaldoInicial = movimentacao.tipo === 'saldo_inicial';
  const exigePositivo = ehAbertura || ehSaldoInicial;

  const [quantidade, setQuantidade] = useState(() =>
    exigePositivo ? String(Math.abs(movimentacao.quantidade_sacos)) : String(movimentacao.quantidade_sacos)
  );
  const [observacao, setObservacao] = useState(movimentacao.observacao || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const quantidadeNum = quantidade !== '' && quantidade !== '-' ? parseInt(quantidade, 10) : null;
  const valido =
    Number.isInteger(quantidadeNum) &&
    quantidadeNum !== 0 &&
    String(quantidadeNum) === quantidade.trim() &&
    (!exigePositivo || quantidadeNum > 0);

  const kgCalculado =
    Number.isInteger(quantidadeNum) && movimentacao.peso_por_saco_kg_snapshot
      ? (Math.abs(quantidadeNum) * movimentacao.peso_por_saco_kg_snapshot).toLocaleString('pt-BR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
        })
      : null;

  async function confirmar() {
    if (!valido) {
      setErro(exigePositivo ? 'Informe uma quantidade de sacos maior que zero.' : 'Informe uma quantidade diferente de zero.');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const novaQuantidadeAssinada = ehAbertura ? -quantidadeNum : quantidadeNum;

    const { error } = await supabase.rpc('editar_movimentacao_saco', {
      p_movimentacao_id: movimentacao.id,
      p_nova_quantidade_sacos: novaQuantidadeAssinada,
      p_observacao: observacao.trim() || null,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErroSacos(error));
      return;
    }

    onSalvo();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          Editar movimentação -- {TIPO_MOVIMENTO_LABEL[movimentacao.tipo] || movimentacao.tipo}
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <div style={rotuloEstilo}>Produto / fornecedor</div>
          <p style={{ margin: 0 }}>
            {movimentacao.produtoNome} — {movimentacao.fornecedorNome}
          </p>
        </div>

        <label style={rotuloEstilo}>
          {ehAbertura
            ? 'Quantidade de sacos abertos *'
            : ehSaldoInicial
              ? 'Quantidade de sacos (saldo inicial) *'
              : 'Quantidade (positiva ou negativa) *'}
        </label>
        <input
          type="number"
          step="1"
          min={exigePositivo ? '1' : undefined}
          autoFocus
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '5px' }}
        />
        {kgCalculado && (
          <p style={{ fontSize: '12px', color: '#666', marginTop: 0, marginBottom: '15px' }}>
            Equivale a {kgCalculado} kg (peso do saco no momento desta movimentação: {movimentacao.peso_por_saco_kg_snapshot} kg/saco).
          </p>
        )}

        <label style={rotuloEstilo}>Observação</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional"
          style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial', marginBottom: '15px' }}
        />

        <p style={{ fontSize: '12px', color: '#999', marginTop: '-8px', marginBottom: '15px' }}>
          A movimentação de estoque vinculada é corrigida automaticamente junto com esta edição.
        </p>

        {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancelar}
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
            onClick={confirmar}
            disabled={salvando || !valido}
            style={{
              padding: '10px 20px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando || !valido ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              opacity: salvando || !valido ? 0.6 : 1,
            }}
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayEstilo = {
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
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '420px',
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' };

const campoEstilo = {
  width: '100%',
  padding: '10px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '16px',
};
