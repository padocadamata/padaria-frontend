import { diaDaSemanaExibicao } from '../../lib/data/dataLocal';

const STATUS_LABEL = { aberto: 'Aberto', fechado: 'Fechado', reaberto: 'Reaberto' };
const ORIGEM_LABEL = { manual: 'Manual', historico: 'Histórico' };

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarPercentualVenda(quantidadeVendida, quantidadeProduzida) {
  if (quantidadeVendida == null || !quantidadeProduzida) {
    return '—';
  }

  const percentual = (quantidadeVendida / quantidadeProduzida) * 100;
  return `${percentual.toFixed(1)}%`;
}

// producao_registros.criado_em/atualizado_em são timestamp SEM fuso —
// exibidos como o horário gravado, sem conversão de timezone adicional.
function formatarDataHora(valor) {
  if (!valor) {
    return '—';
  }

  const data = new Date(valor);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

function BadgeStatus({ status }) {
  const cores = { aberto: '#FF9800', fechado: '#4CAF50', reaberto: '#f44336' };

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: cores[status] || '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function BadgeOrigem({ origem }) {
  const historico = origem === 'historico';

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: historico ? '#795548' : '#2196F3',
        whiteSpace: 'nowrap',
      }}
    >
      {ORIGEM_LABEL[origem] || origem}
    </span>
  );
}

const tituloBlocoEstilo = {
  margin: '20px 0 10px 0',
  paddingTop: '15px',
  borderTop: '1px solid #eee',
  fontSize: '15px',
};

const linhaEstilo = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '14px',
  padding: '4px 0',
};

function Linha({ rotulo, children }) {
  return (
    <div style={linhaEstilo}>
      <span style={{ color: '#666' }}>{rotulo}</span>
      <strong>{children}</strong>
    </div>
  );
}

// Modal somente leitura — nunca escreve em producao_registros. A correção
// de dado (reabrir/fechar/corrigir) é feita pelos modais de ação
// existentes (ReaberturaModal/FechamentoTurnoForm), acionados à parte na
// tela que usa este componente.
export default function VisualizarRegistroModal({ registro, receitaNome, turnoLabel, corPrimaria, onFechar }) {
  return (
    <div
      style={{
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
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ marginTop: 0, color: corPrimaria }}>
          {receitaNome} — {turnoLabel}
        </h3>

        <h4 style={{ ...tituloBlocoEstilo, borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
          Identificação
        </h4>
        <Linha rotulo="Data">{formatarDataExibicao(registro.data)}</Linha>
        <Linha rotulo="Dia da semana">{capitalizar(diaDaSemanaExibicao(registro.data))}</Linha>
        <Linha rotulo="Produto">{receitaNome}</Linha>
        <Linha rotulo="Turno">{turnoLabel}</Linha>
        <Linha rotulo="Origem">
          <BadgeOrigem origem={registro.origem} />
        </Linha>
        <Linha rotulo="Status">
          <BadgeStatus status={registro.status} />
        </Linha>

        <h4 style={tituloBlocoEstilo}>Produção</h4>
        <Linha rotulo="Produzido">{registro.quantidade_produzida}</Linha>
        <Linha rotulo="Vendido">{registro.quantidade_vendida ?? '—'}</Linha>
        <Linha rotulo="% Venda">
          {formatarPercentualVenda(registro.quantidade_vendida, registro.quantidade_produzida)}
        </Linha>
        <Linha rotulo="Sobra total">{registro.sobra_total ?? '—'}</Linha>
        <Linha rotulo="Sobra aproveitável">{registro.sobra_aproveitavel ?? '—'}</Linha>
        <Linha rotulo="Perda/descarte">{registro.perda_descarte ?? '—'}</Linha>

        <h4 style={tituloBlocoEstilo}>Observações</h4>
        <p style={{ fontSize: '14px', whiteSpace: 'pre-wrap', margin: 0, color: registro.observacoes ? '#000' : '#999' }}>
          {registro.observacoes || '—'}
        </p>

        <h4 style={tituloBlocoEstilo}>Auditoria</h4>
        <Linha rotulo="Criado em">{formatarDataHora(registro.criado_em)}</Linha>
        <Linha rotulo="Atualizado em">{formatarDataHora(registro.atualizado_em)}</Linha>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onFechar}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
