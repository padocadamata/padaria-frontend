import { useState } from 'react';
import { PERMISSOES, hasPermissao, isAdmin } from '../../lib/auth/permissoes';
import IniciarProducaoForm from './IniciarProducaoForm';
import AdicionarProducaoForm from './AdicionarProducaoForm';
import FechamentoTurnoForm from './FechamentoTurnoForm';
import ReaberturaModal from './ReaberturaModal';

function Badge({ texto, cor }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: cor,
        whiteSpace: 'nowrap',
      }}
    >
      {texto}
    </span>
  );
}

const cardEstilo = {
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
  padding: '18px',
  flex: 1,
  minWidth: '260px',
};

const botaoEstilo = (cor) => ({
  padding: '8px 14px',
  backgroundColor: cor,
  color: 'white',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
});

const linhaResumoEstilo = { display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '3px 0' };

// Um cartão = um turno (manhã ou tarde) de um produto, para a data
// operacional atual. Suporta os 4 estados: sem registro, aberto, fechado,
// reaberto. Todas as ações (iniciar/adicionar/fechar/reabrir/corrigir)
// abrem um modal dedicado e, ao terminar com sucesso, chamam
// onAtualizado() para o componente pai recarregar os dados do banco — o
// card nunca guarda estado de negócio próprio além de qual modal está
// aberto.
export default function CardTurno({
  turno,
  label,
  registro,
  receitaId,
  receitaNome,
  data,
  corPrimaria,
  permissoes,
  perfilUsuario,
  onAtualizado,
}) {
  const [acaoAberta, setAcaoAberta] = useState(null); // 'iniciar' | 'adicionar' | 'fechar' | 'reabrir' | 'corrigir' | null

  function fechar() {
    setAcaoAberta(null);
  }

  function concluido() {
    setAcaoAberta(null);
    onAtualizado();
  }

  const podeInserir = hasPermissao(permissoes, PERMISSOES.PRODUCAO_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EDITAR);
  const podeReabrir = registro
    ? registro.origem === 'historico'
      ? isAdmin(perfilUsuario)
      : hasPermissao(permissoes, PERMISSOES.PRODUCAO_CANCELAR)
    : false;

  return (
    <div style={cardEstilo}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h4 style={{ margin: 0, color: corPrimaria }}>{label}</h4>
        {registro?.status === 'aberto' && <Badge texto="Em produção" cor="#FF9800" />}
        {registro?.status === 'fechado' && <Badge texto="Fechado" cor="#4CAF50" />}
        {registro?.status === 'reaberto' && <Badge texto="Em correção" cor="#f44336" />}
      </div>

      {!registro && (
        <>
          <p style={{ color: '#999', fontSize: '14px' }}>Nenhuma produção lançada</p>
          {podeInserir && (
            <button style={botaoEstilo(corPrimaria)} onClick={() => setAcaoAberta('iniciar')}>
              Iniciar produção
            </button>
          )}
        </>
      )}

      {registro?.status === 'aberto' && (
        <>
          <div style={linhaResumoEstilo}>
            <span>Produzido</span>
            <strong>{registro.quantidade_produzida}</strong>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            {podeEditar && (
              <button style={botaoEstilo('#2196F3')} onClick={() => setAcaoAberta('adicionar')}>
                + Adicionar produção
              </button>
            )}
            {podeEditar && (
              <button style={botaoEstilo(corPrimaria)} onClick={() => setAcaoAberta('fechar')}>
                Fechar turno
              </button>
            )}
          </div>
        </>
      )}

      {registro?.status === 'fechado' && (
        <>
          <div style={linhaResumoEstilo}><span>Produzido</span><strong>{registro.quantidade_produzida}</strong></div>
          <div style={linhaResumoEstilo}><span>Vendido</span><strong>{registro.quantidade_vendida}</strong></div>
          <div style={linhaResumoEstilo}><span>Sobra total</span><strong>{registro.sobra_total}</strong></div>
          <div style={linhaResumoEstilo}><span>Sobra aproveitável</span><strong>{registro.sobra_aproveitavel}</strong></div>
          <div style={linhaResumoEstilo}><span>Perda/descarte</span><strong>{registro.perda_descarte}</strong></div>
          {registro.observacoes && (
            <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', fontStyle: 'italic' }}>{registro.observacoes}</p>
          )}
          {podeReabrir && (
            <button style={{ ...botaoEstilo('#9e9e9e'), marginTop: '12px' }} onClick={() => setAcaoAberta('reabrir')}>
              Reabrir
            </button>
          )}
        </>
      )}

      {registro?.status === 'reaberto' && (
        <>
          <p style={{ color: '#f44336', fontSize: '13px', fontWeight: 'bold' }}>Em correção — os valores antigos foram preservados.</p>
          <div style={linhaResumoEstilo}><span>Produzido (atual)</span><strong>{registro.quantidade_produzida}</strong></div>
          <div style={linhaResumoEstilo}><span>Sobra aproveitável (atual)</span><strong>{registro.sobra_aproveitavel}</strong></div>
          <div style={linhaResumoEstilo}><span>Perda/descarte (atual)</span><strong>{registro.perda_descarte}</strong></div>
          {podeEditar && (
            <button style={{ ...botaoEstilo(corPrimaria), marginTop: '12px' }} onClick={() => setAcaoAberta('corrigir')}>
              Corrigir e fechar
            </button>
          )}
        </>
      )}

      {acaoAberta === 'iniciar' && (
        <IniciarProducaoForm
          data={data}
          turno={turno}
          receitaId={receitaId}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onCriado={concluido}
          onCancelar={fechar}
        />
      )}

      {acaoAberta === 'adicionar' && registro && (
        <AdicionarProducaoForm
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onAdicionado={concluido}
          onCancelar={fechar}
        />
      )}

      {(acaoAberta === 'fechar' || acaoAberta === 'corrigir') && registro && (
        <FechamentoTurnoForm
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onFechado={concluido}
          onCancelar={fechar}
        />
      )}

      {acaoAberta === 'reabrir' && registro && (
        <ReaberturaModal
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onReaberto={concluido}
          onCancelar={fechar}
        />
      )}
    </div>
  );
}
