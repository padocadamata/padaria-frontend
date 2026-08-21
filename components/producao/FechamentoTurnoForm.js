import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';

function mensagemErro(error) {
  if (!error) return '';
  return 'Não foi possível fechar o turno. Confira os valores informados ou avise um administrador.';
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
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '420px',
  width: '90%',
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

// Modal único para as duas situações que terminam em status='fechado':
//   - fechar um turno 'aberto' pela primeira vez (quantidade_produzida
//     fica fixa, só leitura);
//   - salvar a correção de um turno 'reaberto' (quantidade_produzida
//     também fica editável, porque a correção pode incluir refazer a
//     contagem de produção, não só a sobra).
// O operador só informa sobra_aproveitavel e perda_descarte — sobra_total
// e quantidade_vendida são sempre calculadas, nunca digitadas.
export default function FechamentoTurnoForm({ registro, receitaNome, turnoLabel, corPrimaria, onFechado, onCancelar }) {
  const permiteEditarProduzida = registro.status === 'reaberto';

  const [quantidadeProduzida, setQuantidadeProduzida] = useState(String(registro.quantidade_produzida));
  const [sobraAproveitavel, setSobraAproveitavel] = useState(
    registro.sobra_aproveitavel != null ? String(registro.sobra_aproveitavel) : ''
  );
  const [perdaDescarte, setPerdaDescarte] = useState(
    registro.perda_descarte != null ? String(registro.perda_descarte) : ''
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const produzidaNum = parseInt(quantidadeProduzida, 10);
  const aproveitavelNum = sobraAproveitavel === '' ? 0 : parseInt(sobraAproveitavel, 10);
  const perdaNum = perdaDescarte === '' ? 0 : parseInt(perdaDescarte, 10);

  const valoresValidos =
    Number.isInteger(produzidaNum) && produzidaNum > 0 &&
    Number.isInteger(aproveitavelNum) && aproveitavelNum >= 0 &&
    Number.isInteger(perdaNum) && perdaNum >= 0;

  const sobraTotal = valoresValidos ? aproveitavelNum + perdaNum : null;
  const quantidadeVendida = valoresValidos ? produzidaNum - sobraTotal : null;
  const sobraMaiorQueProduzida = valoresValidos && sobraTotal > produzidaNum;

  async function confirmar() {
    if (!valoresValidos) {
      setErro('Preencha os valores com números válidos (0 ou maior).');
      return;
    }
    if (sobraMaiorQueProduzida) {
      setErro(`A soma da sobra (${sobraTotal}) não pode ser maior que a quantidade produzida (${produzidaNum}).`);
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const payload = {
      status: 'fechado',
      quantidade_vendida: quantidadeVendida,
      sobra_total: sobraTotal,
      sobra_aproveitavel: aproveitavelNum,
      perda_descarte: perdaNum,
    };
    if (permiteEditarProduzida) {
      payload.quantidade_produzida = produzidaNum;
    }

    const { error } = await supabase
      .from('producao_registros')
      .update(payload)
      .eq('id', registro.id);

    setSalvando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    // Auditoria best-effort: se falhar, o fechamento já feito não é desfeito.
    registrarAuditoria({
      entidade: 'producao',
      registroId: registro.id,
      acao: 'fechou',
      valorNovo: `vendida=${quantidadeVendida}, sobra_aproveitavel=${aproveitavelNum}, perda_descarte=${perdaNum}`,
    });

    onFechado();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          {permiteEditarProduzida ? 'Corrigir e fechar' : 'Fechar turno'} — {receitaNome} ({turnoLabel})
        </h3>

        <label style={rotuloEstilo}>Quantidade produzida</label>
        {permiteEditarProduzida ? (
          <input
            type="number"
            min="1"
            value={quantidadeProduzida}
            onChange={(e) => setQuantidadeProduzida(e.target.value)}
            style={{ ...campoEstilo, marginBottom: '15px' }}
          />
        ) : (
          <input type="number" value={quantidadeProduzida} readOnly disabled style={{ ...campoCalculadoEstilo, marginBottom: '15px' }} />
        )}

        <label style={rotuloEstilo}>Sobra aproveitável</label>
        <input
          type="number"
          min="0"
          autoFocus
          value={sobraAproveitavel}
          onChange={(e) => setSobraAproveitavel(e.target.value)}
          placeholder="0"
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Perda / descarte</label>
        <input
          type="number"
          min="0"
          value={perdaDescarte}
          onChange={(e) => setPerdaDescarte(e.target.value)}
          placeholder="0"
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          <div>
            <label style={rotuloEstilo}>Sobra total (calculada)</label>
            <input type="text" readOnly disabled value={sobraTotal ?? '—'} style={campoCalculadoEstilo} />
          </div>
          <div>
            <label style={rotuloEstilo}>Quantidade vendida (calculada)</label>
            <input
              type="text"
              readOnly
              disabled
              value={quantidadeVendida ?? '—'}
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
            disabled={salvando || sobraMaiorQueProduzida}
            style={{ padding: '10px 20px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', opacity: sobraMaiorQueProduzida ? 0.6 : 1 }}
          >
            {salvando ? 'Salvando...' : permiteEditarProduzida ? 'Salvar correção e fechar' : 'Fechar turno'}
          </button>
        </div>
      </div>
    </div>
  );
}
