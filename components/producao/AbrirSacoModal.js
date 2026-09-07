import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { mensagemErroSacos } from '../../lib/producao/mensagensSacos';

// Abertura manual de saco fechado (migration 0042) -- único caminho é a
// RPC registrar_abertura_saco (SECURITY DEFINER), nunca INSERT direto em
// sacos_fechados_movimentacoes/estoque_movimentacoes (nenhuma policy de
// escrita existe nessas tabelas de propósito). `operacaoId` é gerado UMA
// VEZ, no mount deste componente (useState com inicializador lazy) -- se
// o usuário clicar "Abrir" de novo depois de um erro de rede (retry da
// MESMA submissão), o mesmo id é reenviado, e a RPC devolve a
// movimentação já criada em vez de duplicar a baixa (idempotência real,
// não só "não clicar duas vezes"). Fechar e reabrir o modal (nova
// intenção do usuário) gera uma nova instância do componente, logo um
// operacao_id novo -- comportamento correto.
export default function AbrirSacoModal({ configuracao, corPrimaria = '#8B4513', onSalvo, onCancelar }) {
  const [operacaoId] = useState(() => crypto.randomUUID());
  const [quantidade, setQuantidade] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const quantidadeNum = quantidade !== '' ? parseInt(quantidade, 10) : null;
  const valido = Number.isInteger(quantidadeNum) && quantidadeNum > 0 && String(quantidadeNum) === quantidade.trim();

  const kgResultante =
    Number.isInteger(quantidadeNum) && quantidadeNum > 0
      ? (quantidadeNum * configuracao.pesoPorSacoKg).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
      : null;

  async function confirmar() {
    if (!valido) {
      setErro('Informe uma quantidade inteira de sacos, maior que zero.');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.rpc('registrar_abertura_saco', {
      p_produto_fornecedor_id: configuracao.id,
      p_quantidade_sacos: quantidadeNum,
      p_operacao_id: operacaoId,
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
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Abrir saco</h3>

        <div style={{ marginBottom: '15px' }}>
          <div style={rotuloEstilo}>Produto</div>
          <p style={{ margin: 0 }}>{configuracao.produtoNome}</p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <div style={rotuloEstilo}>Fornecedor</div>
          <p style={{ margin: 0 }}>{configuracao.fornecedorNome}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div>
            <div style={rotuloEstilo}>Kg/saco</div>
            <p style={{ margin: 0 }}>{configuracao.pesoPorSacoKg} kg</p>
          </div>
          <div>
            <div style={rotuloEstilo}>Saldo atual de sacos</div>
            <p style={{ margin: 0 }}>{configuracao.saldoSacos}</p>
          </div>
        </div>

        <label style={rotuloEstilo}>Quantidade de sacos a abrir *</label>
        <input
          type="number"
          min="1"
          step="1"
          autoFocus
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '5px' }}
        />
        {kgResultante && (
          <p style={{ fontSize: '12px', color: '#666', marginTop: 0, marginBottom: '15px' }}>
            Equivale a {kgResultante} kg de estoque, retirados automaticamente junto com a baixa de sacos.
          </p>
        )}

        <label style={rotuloEstilo}>Observação</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional"
          style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial', marginBottom: '15px' }}
        />

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
            {salvando ? 'Abrindo...' : 'Abrir saco'}
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
