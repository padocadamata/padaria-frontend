import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';
import Modal from '../ui/Modal';

function mensagemErro(error) {
  if (!error) return '';
  return 'Não foi possível fechar o turno. Confira os valores informados ou avise um administrador.';
}

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
//
// Regra de sobras (revisão 2026-08-23): sobra_total é digitável
// diretamente; se deixada em branco e houver classificação (aproveitável
// e/ou perda), sobra_total é derivada da soma. Aproveitável/perda em
// branco viram NULL (não classificado ainda) — só viram 0 quando o
// operador digita "0" explicitamente. Fechar exige, no mínimo, a sobra
// total (direta ou derivada); classificação completa não é mais
// obrigatória no momento do fechamento.
export default function FechamentoTurnoForm({ registro, receitaNome, turnoLabel, corPrimaria, onFechado, onCancelar }) {
  const permiteEditarProduzida = registro.status === 'reaberto';

  const [quantidadeProduzida, setQuantidadeProduzida] = useState(String(registro.quantidade_produzida));
  const [sobraTotalInput, setSobraTotalInput] = useState(
    registro.sobra_total != null ? String(registro.sobra_total) : ''
  );
  const [sobraAproveitavel, setSobraAproveitavel] = useState(
    registro.sobra_aproveitavel != null ? String(registro.sobra_aproveitavel) : ''
  );
  const [perdaDescarte, setPerdaDescarte] = useState(
    registro.perda_descarte != null ? String(registro.perda_descarte) : ''
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const produzidaNum = parseInt(quantidadeProduzida, 10);

  const totalPreenchido = sobraTotalInput !== '';
  const aproveitavelPreenchido = sobraAproveitavel !== '';
  const perdaPreenchido = perdaDescarte !== '';

  const sobraTotalDigitado = totalPreenchido ? parseInt(sobraTotalInput, 10) : null;
  const aproveitavelNum = aproveitavelPreenchido ? parseInt(sobraAproveitavel, 10) : null;
  const perdaNum = perdaPreenchido ? parseInt(perdaDescarte, 10) : null;

  const somaClassificacao = (aproveitavelNum ?? 0) + (perdaNum ?? 0);

  // sobra_total: usa o que foi digitado diretamente; se vazio e houver
  // classificação, deriva da soma; se nada foi preenchido, fica null (e o
  // fechamento é bloqueado, ver faltaSobraTotal abaixo).
  const sobraTotalNum = totalPreenchido
    ? sobraTotalDigitado
    : aproveitavelPreenchido || perdaPreenchido
      ? somaClassificacao
      : null;

  const numerosValidos =
    Number.isInteger(produzidaNum) && produzidaNum > 0 &&
    (!totalPreenchido || (Number.isInteger(sobraTotalDigitado) && sobraTotalDigitado >= 0)) &&
    (!aproveitavelPreenchido || (Number.isInteger(aproveitavelNum) && aproveitavelNum >= 0)) &&
    (!perdaPreenchido || (Number.isInteger(perdaNum) && perdaNum >= 0));

  const faltaSobraTotal = numerosValidos && sobraTotalNum === null;
  const somaExcedeTotal = numerosValidos && sobraTotalNum != null && somaClassificacao > sobraTotalNum;
  const sobraMaiorQueProduzida = numerosValidos && sobraTotalNum != null && sobraTotalNum > produzidaNum;

  const bloqueado = !numerosValidos || faltaSobraTotal || somaExcedeTotal || sobraMaiorQueProduzida;

  const sobraNaoClassificada =
    numerosValidos && sobraTotalNum != null ? sobraTotalNum - somaClassificacao : null;
  const quantidadeVendida =
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
    const payload = {
      status: 'fechado',
      quantidade_vendida: quantidadeVendida,
      sobra_total: sobraTotalNum,
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
      valorNovo: `vendida=${quantidadeVendida}, sobra_total=${sobraTotalNum}, sobra_aproveitavel=${aproveitavelNum}, perda_descarte=${perdaNum}`,
    });

    onFechado();
  }

  return (
    <Modal onFechar={onCancelar} largura="sm" legado>
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

        <label style={rotuloEstilo}>Sobra total</label>
        <input
          type="number"
          min="0"
          autoFocus
          value={sobraTotalInput}
          onChange={(e) => setSobraTotalInput(e.target.value)}
          placeholder={
            !totalPreenchido && (aproveitavelPreenchido || perdaPreenchido)
              ? `${somaClassificacao} (calculado pela classificação)`
              : 'Deixe em branco para calcular pela classificação'
          }
          style={{ ...campoEstilo, marginBottom: totalPreenchido || aproveitavelPreenchido || perdaPreenchido ? '5px' : '15px' }}
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
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
            disabled={salvando || bloqueado}
            style={{ padding: '10px 20px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', opacity: bloqueado ? 0.6 : 1 }}
          >
            {salvando ? 'Salvando...' : permiteEditarProduzida ? 'Salvar correção e fechar' : 'Fechar turno'}
          </button>
        </div>
    </Modal>
  );
}
