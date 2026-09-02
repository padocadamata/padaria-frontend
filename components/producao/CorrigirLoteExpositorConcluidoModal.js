import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { mensagemErroLoteExpositor } from '../../lib/producao/mensagensExpositor';

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
  maxWidth: '460px',
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
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

// Correção ADMINISTRATIVA de um lote JÁ CONCLUÍDO -- via RPC
// corrigir_lote_expositor_concluido (migration 0030, exige
// producao_expositores.editar + motivo obrigatorio + auditoria). Nunca
// altera concluido_em -- a retirada em si permanece um fato histórico
// definitivo, só os números (enviada/retirada) são corrigíveis.
export default function CorrigirLoteExpositorConcluidoModal({ lote, produtoNome, corPrimaria, onCorrigido, onCancelar }) {
  const [quantidadeEnviada, setQuantidadeEnviada] = useState(String(lote.quantidade_enviada));
  const [quantidadeRetirada, setQuantidadeRetirada] = useState(String(lote.quantidade_retirada));
  const [observacao, setObservacao] = useState(lote.observacao || '');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const enviadaNum = quantidadeEnviada !== '' ? parseInt(quantidadeEnviada, 10) : null;
  const retiradaNum = quantidadeRetirada !== '' ? parseInt(quantidadeRetirada, 10) : null;
  const numerosValidos =
    Number.isInteger(enviadaNum) && enviadaNum > 0 && Number.isInteger(retiradaNum) && retiradaNum >= 0;
  const retiradaExcedeEnviada = numerosValidos && retiradaNum > enviadaNum;
  const faltaMotivo = !motivo.trim();
  const bloqueado = !numerosValidos || retiradaExcedeEnviada || faltaMotivo;

  async function confirmar() {
    if (faltaMotivo) {
      setErro('Informe o motivo da correção.');
      return;
    }
    if (!numerosValidos) {
      setErro('Preencha valores válidos (enviada maior que zero; retirada zero ou maior).');
      return;
    }
    if (retiradaExcedeEnviada) {
      setErro('A quantidade retirada não pode ser maior que a quantidade enviada.');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    // observacao (dado operacional do lote) e motivo (justificativa de
    // auditoria da correção) são conceitos DIFERENTES -- nunca um
    // substitui o outro, os dois são enviados separadamente.
    const { error } = await supabase.rpc('corrigir_lote_expositor_concluido', {
      p_lote_id: lote.lote_id,
      p_quantidade_enviada: enviadaNum,
      p_quantidade_retirada: retiradaNum,
      p_motivo: motivo.trim(),
      p_observacao: observacao.trim() || null,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErroLoteExpositor(error));
      return;
    }

    onCorrigido();
  }

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>Correção administrativa -- {produtoNome}</h3>

        <p
          style={{
            backgroundColor: '#fff8e1',
            color: '#8a6d00',
            padding: '10px 12px',
            borderRadius: '5px',
            fontSize: '13px',
            marginBottom: '15px',
          }}
        >
          Este lote já foi concluído. A data/hora da conclusão não muda -- só os números de quantidade enviada e
          retirada podem ser corrigidos, com motivo obrigatório e registro em auditoria.
        </p>

        <label style={rotuloEstilo}>Quantidade enviada *</label>
        <input
          type="number"
          min="1"
          value={quantidadeEnviada}
          onChange={(e) => setQuantidadeEnviada(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Quantidade retirada *</label>
        <input
          type="number"
          min="0"
          value={quantidadeRetirada}
          onChange={(e) => setQuantidadeRetirada(e.target.value)}
          style={{ ...campoEstilo, marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Observação</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional -- anotação operacional sobre este lote (diferente do motivo da correção abaixo)."
          style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial', marginBottom: '15px' }}
        />

        <label style={rotuloEstilo}>Motivo da correção *</label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: quantidade retirada lançada errada, corrigir de 3 para 5."
          style={{ ...campoEstilo, minHeight: '70px', fontFamily: 'Arial' }}
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
            style={{
              padding: '10px 20px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
              opacity: salvando || bloqueado ? 0.6 : 1,
            }}
          >
            {salvando ? 'Salvando...' : 'Salvar correção'}
          </button>
        </div>
      </div>
    </div>
  );
}
