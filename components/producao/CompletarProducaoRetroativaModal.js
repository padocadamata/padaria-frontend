import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (msg.includes('esta operacao so se aplica a um lancamento retroativo ainda pendente')) {
    return 'Este lançamento não está mais pendente — atualize a página.';
  }
  if (msg.includes('nao encontrado')) {
    return 'Este registro não está mais disponível — atualize a página.';
  }
  if (msg.includes('informe ao menos a sobra total')) {
    return 'Informe ao menos a sobra total.';
  }
  if (msg.includes('nao pode ser negativa')) {
    return 'Os valores de sobra não podem ser negativos.';
  }
  if (msg.includes('nao pode ultrapassar sobra_total')) {
    return 'Sobra aproveitável + perda/descarte não pode ultrapassar a sobra total.';
  }
  if (msg.includes('invalida para a quantidade_produzida')) {
    return 'A sobra total não pode ser maior que a quantidade produzida.';
  }
  if (msg.includes('producao.editar')) {
    return 'Você não tem permissão para completar este lançamento.';
  }
  return 'Não foi possível completar o lançamento. Tente novamente ou avise um administrador.';
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
  maxWidth: '450px',
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px' };

const campoEstilo = {
  width: '100%',
  padding: '10px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
  fontSize: '16px',
};

const campoCalculadoEstilo = {
  ...campoEstilo,
  backgroundColor: '#f5f5f5',
  color: '#333',
  fontWeight: 'bold',
};

// Completa e fecha um lançamento retroativo que nasceu sem sobra
// conhecida (origem='retroativo', status='aberto') — via RPC
// completar_producao_retroativa, exclusiva para essa combinação. Não tem
// campo de motivo (é a primeira consolidação normal do dado, não uma
// correção) e não altera quantidade_produzida — só sobra_total/
// sobra_aproveitavel/perda_descarte, fechando o registro. Mesma
// distinção vazio=NULL / "0"=zero já usada em GerenciarSobrasModal/
// FechamentoTurnoForm.
export default function CompletarProducaoRetroativaModal({ registro, receitaNome, turnoLabel, corPrimaria, onCompletado, onCancelar }) {
  const [sobraTotalInput, setSobraTotalInput] = useState('');
  const [sobraAproveitavel, setSobraAproveitavel] = useState('');
  const [perdaDescarte, setPerdaDescarte] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const produzidaNum = registro.quantidade_produzida;

  const totalPreenchido = sobraTotalInput !== '';
  const aproveitavelPreenchido = sobraAproveitavel !== '';
  const perdaPreenchido = perdaDescarte !== '';

  const sobraTotalDigitado = totalPreenchido ? parseInt(sobraTotalInput, 10) : null;
  const aproveitavelNum = aproveitavelPreenchido ? parseInt(sobraAproveitavel, 10) : null;
  const perdaNum = perdaPreenchido ? parseInt(perdaDescarte, 10) : null;

  const somaClassificacao = (aproveitavelNum ?? 0) + (perdaNum ?? 0);

  const sobraTotalNum = totalPreenchido
    ? sobraTotalDigitado
    : aproveitavelPreenchido || perdaPreenchido
      ? somaClassificacao
      : null;

  const numerosValidos =
    (!totalPreenchido || (Number.isInteger(sobraTotalDigitado) && sobraTotalDigitado >= 0)) &&
    (!aproveitavelPreenchido || (Number.isInteger(aproveitavelNum) && aproveitavelNum >= 0)) &&
    (!perdaPreenchido || (Number.isInteger(perdaNum) && perdaNum >= 0));

  const faltaSobraTotal = numerosValidos && sobraTotalNum === null;
  const somaExcedeTotal = numerosValidos && sobraTotalNum != null && somaClassificacao > sobraTotalNum;
  const sobraMaiorQueProduzida = numerosValidos && sobraTotalNum != null && sobraTotalNum > produzidaNum;

  const bloqueado = !numerosValidos || faltaSobraTotal || somaExcedeTotal || sobraMaiorQueProduzida;

  const sobraNaoClassificada =
    numerosValidos && sobraTotalNum != null ? sobraTotalNum - somaClassificacao : null;
  const vendidaPrevista =
    numerosValidos && sobraTotalNum != null ? produzidaNum - sobraTotalNum : null;

  async function confirmar() {
    if (!numerosValidos) {
      setErro('Preencha os valores com números válidos (0 ou maior).');
      return;
    }
    if (faltaSobraTotal) {
      setErro('Informe ao menos a sobra total.');
      return;
    }
    if (somaExcedeTotal) {
      setErro(
        `Sobra aproveitável + perda/descarte (${somaClassificacao}) não pode ultrapassar a sobra total (${sobraTotalNum}).`
      );
      return;
    }
    if (sobraMaiorQueProduzida) {
      setErro(`A sobra total (${sobraTotalNum}) não pode ser maior que a quantidade produzida (${produzidaNum}).`);
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const { error } = await supabase.rpc('completar_producao_retroativa', {
      p_registro_id: registro.id,
      p_sobra_total: sobraTotalNum,
      p_sobra_aproveitavel: aproveitavelNum,
      p_perda_descarte: perdaNum,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    onCompletado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          Completar lançamento — {receitaNome} ({turnoLabel})
        </h3>

        <p style={{ color: '#666', fontSize: '13px' }}>
          Este lançamento retroativo foi criado sem sobra conhecida. Informe a sobra agora para fechá-lo — ele deixa
          de aparecer como Pendência.
        </p>

        <label style={rotuloEstilo}>Produzido</label>
        <input type="text" readOnly disabled value={produzidaNum} style={{ ...campoCalculadoEstilo, marginBottom: '15px' }} />

        <label style={rotuloEstilo}>Sobra total *</label>
        <input
          type="number"
          min="0"
          autoFocus
          value={sobraTotalInput}
          onChange={(e) => setSobraTotalInput(e.target.value)}
          placeholder={
            !totalPreenchido && (aproveitavelPreenchido || perdaPreenchido)
              ? `${somaClassificacao} (calculado pela classificação)`
              : 'Obrigatório — direto ou via aproveitável/descarte abaixo'
          }
          style={{ ...campoEstilo, marginBottom: '5px' }}
        />

        {(totalPreenchido || aproveitavelPreenchido || perdaPreenchido) && (
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 15px 0' }}>
            {totalPreenchido
              ? 'Total informado manualmente.'
              : `Sobra total calculada: ${somaClassificacao}`}
          </p>
        )}

        <label style={rotuloEstilo}>Sobra aproveitável</label>
        <input
          type="number"
          min="0"
          value={sobraAproveitavel}
          onChange={(e) => setSobraAproveitavel(e.target.value)}
          placeholder="Não classificado"
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Perda / descarte</label>
        <input
          type="number"
          min="0"
          value={perdaDescarte}
          onChange={(e) => setPerdaDescarte(e.target.value)}
          placeholder="Não classificado"
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div>
            <label style={rotuloEstilo}>Sobra não classificada</label>
            <input
              type="text"
              readOnly
              disabled
              value={sobraNaoClassificada ?? '—'}
              style={{
                ...campoCalculadoEstilo,
                color: sobraNaoClassificada != null && sobraNaoClassificada < 0 ? '#f44336' : campoCalculadoEstilo.color,
              }}
            />
          </div>
          <div>
            <label style={rotuloEstilo}>Vendido calculado</label>
            <input
              type="text"
              readOnly
              disabled
              value={vendidaPrevista ?? '—'}
              style={{
                ...campoCalculadoEstilo,
                color: sobraMaiorQueProduzida ? '#f44336' : campoCalculadoEstilo.color,
              }}
            />
          </div>
        </div>

        {erro && <p style={{ color: '#f44336', marginTop: '15px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onCancelar}
            disabled={salvando}
            style={{ padding: '10px 20px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={salvando || bloqueado}
            style={{ padding: '10px 20px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', opacity: bloqueado ? 0.6 : 1 }}
          >
            {salvando ? 'Salvando...' : 'Completar e fechar'}
          </button>
        </div>
      </div>
    </div>
  );
}
