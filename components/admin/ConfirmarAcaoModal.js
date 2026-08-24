// Modal de confirmação genérico, reutilizado por qualquer ação
// administrativa sensível (desativar usuário, promover a proprietario_admin
// etc.) — mesmo padrão visual dos modais de produção (ver
// components/producao/ReaberturaModal.js), sem RPC própria: quem chama
// decide o que acontece em onConfirmar.
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
  zIndex: 1100,
  padding: '20px',
};

const caixaEstilo = {
  backgroundColor: 'white',
  padding: '25px',
  borderRadius: '10px',
  maxWidth: '440px',
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

export default function ConfirmarAcaoModal({
  titulo,
  mensagem,
  corPrimaria = '#8B4513',
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigo = false,
  confirmando = false,
  erro = '',
  onConfirmar,
  onCancelar,
}) {
  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: perigo ? '#f44336' : corPrimaria, marginTop: 0 }}>{titulo}</h3>

        <div style={{ color: '#444', fontSize: '14px', lineHeight: '1.6' }}>{mensagem}</div>

        {erro && <p style={{ color: '#f44336', marginTop: '15px', fontSize: '14px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onCancelar}
            disabled={confirmando}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: confirmando ? 'not-allowed' : 'pointer',
            }}
          >
            {textoCancelar}
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={confirmando}
            style={{
              padding: '10px 20px',
              backgroundColor: perigo ? '#f44336' : corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: confirmando ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {confirmando ? 'Aguarde...' : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
