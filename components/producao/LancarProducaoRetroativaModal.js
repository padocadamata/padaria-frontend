import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';

function dataLocalOntem() {
  // Mesma técnica segura já usada em diaDaSemanaExibicao (lib/data/dataLocal.js):
  // meio-dia local evita que a subtração de 1 dia seja empurrada para o dia
  // errado por causa de fuso horário.
  const hoje = dataLocalHoje();
  const d = new Date(`${hoje}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function mensagemErro(error) {
  if (!error) return '';
  if (error.code === '23505') {
    return 'Já existe um lançamento para este produto, data e turno. Corrija o lançamento existente em vez de criar um novo.';
  }
  const msg = error.message || '';
  if (msg.includes('producoes do dia atual devem ser lancadas pela Tela Hoje')) {
    return 'Produções do dia atual devem ser lançadas pela Tela Hoje.';
  }
  if (msg.includes('turno invalido')) {
    return 'Selecione um turno válido.';
  }
  if (msg.includes('nao existe ou nao esta ativo')) {
    return 'Selecione um produto válido e ativo.';
  }
  if (msg.includes('quantidade_produzida deve ser maior que zero')) {
    return 'Informe uma quantidade produzida maior que zero.';
  }
  if (msg.includes('sobra_total invalida')) {
    return 'A sobra total informada é inválida para a quantidade produzida.';
  }
  if (msg.includes('nao pode ser negativa')) {
    return 'Os valores de sobra não podem ser negativos.';
  }
  if (msg.includes('nao pode ultrapassar sobra_total')) {
    return 'Sobra aproveitável + perda/descarte não pode ultrapassar a sobra total.';
  }
  if (msg.includes('producao.inserir')) {
    return 'Você não tem permissão para lançar produção retroativa.';
  }
  return 'Não foi possível lançar a produção retroativa. Tente novamente ou avise um administrador.';
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
  maxWidth: '480px',
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
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

// Lança produção real de um dia PASSADO que nunca foi registrada
// (origem='retroativo'). Sobra é opcional: se os 3 campos ficarem vazios,
// o registro nasce status='aberto' (Pendência no Histórico, mesma cor já
// usada para "aberto"/"reaberto"), sem inventar sobra_total=0 nem
// quantidade_vendida — completar depois via "Completar lançamento". Se
// houver informação suficiente de sobra, nasce já status='fechado' com
// quantidade_vendida calculada. Data de hoje/futuro é bloqueada tanto
// aqui (max do input) quanto na RPC (defesa em profundidade).
export default function LancarProducaoRetroativaModal({ produtosAtivos, corPrimaria, onLancado, onCancelar }) {
  const ontem = dataLocalOntem();

  const [data, setData] = useState('');
  const [turno, setTurno] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [quantidadeProduzida, setQuantidadeProduzida] = useState('');
  const [sobraTotalInput, setSobraTotalInput] = useState('');
  const [sobraAproveitavel, setSobraAproveitavel] = useState('');
  const [perdaDescarte, setPerdaDescarte] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const produzidaNum = quantidadeProduzida !== '' ? parseInt(quantidadeProduzida, 10) : null;

  const totalPreenchido = sobraTotalInput !== '';
  const aproveitavelPreenchido = sobraAproveitavel !== '';
  const perdaPreenchido = perdaDescarte !== '';
  const algumaSobraPreenchida = totalPreenchido || aproveitavelPreenchido || perdaPreenchido;

  const sobraTotalDigitado = totalPreenchido ? parseInt(sobraTotalInput, 10) : null;
  const aproveitavelNum = aproveitavelPreenchido ? parseInt(sobraAproveitavel, 10) : null;
  const perdaNum = perdaPreenchido ? parseInt(perdaDescarte, 10) : null;

  const somaClassificacao = (aproveitavelNum ?? 0) + (perdaNum ?? 0);

  const sobraTotalNum = totalPreenchido
    ? sobraTotalDigitado
    : aproveitavelPreenchido || perdaPreenchido
      ? somaClassificacao
      : null;

  const dataValida = data !== '' && data <= ontem;
  const turnoValido = turno === 'manha' || turno === 'tarde';

  const numerosValidos =
    Number.isInteger(produzidaNum) && produzidaNum > 0 &&
    (!totalPreenchido || (Number.isInteger(sobraTotalDigitado) && sobraTotalDigitado >= 0)) &&
    (!aproveitavelPreenchido || (Number.isInteger(aproveitavelNum) && aproveitavelNum >= 0)) &&
    (!perdaPreenchido || (Number.isInteger(perdaNum) && perdaNum >= 0));

  const somaExcedeTotal = algumaSobraPreenchida && numerosValidos && sobraTotalNum != null && somaClassificacao > sobraTotalNum;
  const sobraMaiorQueProduzida = algumaSobraPreenchida && numerosValidos && sobraTotalNum != null && sobraTotalNum > produzidaNum;

  const bloqueado =
    !dataValida || !turnoValido || !produtoId || !numerosValidos || somaExcedeTotal || sobraMaiorQueProduzida;

  const sobraNaoClassificada =
    algumaSobraPreenchida && numerosValidos && sobraTotalNum != null ? sobraTotalNum - somaClassificacao : null;
  const vendidaPrevista =
    algumaSobraPreenchida && numerosValidos && sobraTotalNum != null && produzidaNum != null
      ? produzidaNum - sobraTotalNum
      : null;

  async function confirmar() {
    if (!dataValida) {
      setErro('Informe uma data anterior a hoje. Produções do dia atual devem ser lançadas pela Tela Hoje.');
      return;
    }
    if (!turnoValido) {
      setErro('Selecione o turno.');
      return;
    }
    if (!produtoId) {
      setErro('Selecione o produto.');
      return;
    }
    if (!numerosValidos) {
      setErro('Preencha os valores com números válidos (produzida maior que zero; sobras 0 ou maior).');
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
    const { error } = await supabase.rpc('lancar_producao_retroativa', {
      p_data: data,
      p_turno: turno,
      p_receita_id: produtoId,
      p_quantidade_produzida: produzidaNum,
      p_sobra_total: sobraTotalNum,
      p_sobra_aproveitavel: aproveitavelNum,
      p_perda_descarte: perdaNum,
      p_observacao: observacao.trim() || null,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    onLancado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Lançar produção passada</h3>

        <p style={{ color: '#666', fontSize: '13px' }}>
          Para produção real de um dia que já passou e nunca foi registrada. A sobra pode ficar em branco e ser
          completada depois — o lançamento fica marcado como Pendência até lá.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div>
            <label style={rotuloEstilo}>Data *</label>
            <input
              type="date"
              autoFocus
              max={ontem}
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={campoEstilo}
            />
            {data !== '' && data > ontem && (
              <p style={{ color: '#f44336', fontSize: '12px', margin: '5px 0 0 0' }}>
                Produções do dia atual devem ser lançadas pela Tela Hoje.
              </p>
            )}
          </div>
          <div>
            <label style={rotuloEstilo}>Turno *</label>
            <select value={turno} onChange={(e) => setTurno(e.target.value)} style={campoEstilo}>
              <option value="">Selecione</option>
              <option value="manha">Manhã</option>
              <option value="tarde">Tarde</option>
            </select>
          </div>
        </div>

        <label style={rotuloEstilo}>Produto *</label>
        <select
          value={produtoId}
          onChange={(e) => setProdutoId(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '15px' }}
        >
          <option value="">Selecione</option>
          {(produtosAtivos || []).map((produto) => (
            <option key={produto.id} value={produto.id}>
              {produto.nome}
            </option>
          ))}
        </select>

        <label style={rotuloEstilo}>Quantidade produzida *</label>
        <input
          type="number"
          min="1"
          value={quantidadeProduzida}
          onChange={(e) => setQuantidadeProduzida(e.target.value)}
          placeholder="Ex.: 150"
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Sobra total</label>
        <input
          type="number"
          min="0"
          value={sobraTotalInput}
          onChange={(e) => setSobraTotalInput(e.target.value)}
          placeholder={
            !totalPreenchido && (aproveitavelPreenchido || perdaPreenchido)
              ? `${somaClassificacao} (calculado pela classificação)`
              : 'Deixe em branco se ainda não souber'
          }
          style={{ ...campoEstilo, marginBottom: '5px' }}
        />
        <p style={{ fontSize: '12px', color: '#666', margin: '0 0 15px 0' }}>
          {!algumaSobraPreenchida
            ? 'Nenhuma sobra informada: o lançamento nasce Aberto/Pendente, sem inventar zero — complete depois.'
            : totalPreenchido
              ? 'Total informado manualmente — o lançamento nasce Fechado.'
              : `Sobra total calculada: ${somaClassificacao} — o lançamento nasce Fechado.`}
        </p>

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

        {algumaSobraPreenchida && (
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
        )}

        <label style={rotuloEstilo}>Observação</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional"
          style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial', marginBottom: '5px' }}
        />

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
            {salvando ? 'Salvando...' : 'Lançar produção'}
          </button>
        </div>
      </div>
    </div>
  );
}
