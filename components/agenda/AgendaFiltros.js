// Filtros V1 da Agenda: categoria, tipo (evento/tarefa) e status
// (pendente/concluída — só relevante para tarefa, mas não desabilitado
// quando "evento" está selecionado, para manter o controle simples).
export default function AgendaFiltros({ categorias, filtro, onMudarFiltro }) {
  return (
    <div
      style={{
        backgroundColor: '#f9f9f9',
        padding: '15px',
        borderRadius: '5px',
        marginBottom: '20px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '15px',
      }}
    >
      <div>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Categoria</label>
        <select
          value={filtro.categoria}
          onChange={(e) => onMudarFiltro({ ...filtro, categoria: e.target.value })}
          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
        >
          <option value="todas">Todas</option>
          {categorias.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.valor}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Tipo</label>
        <select
          value={filtro.tipo}
          onChange={(e) => onMudarFiltro({ ...filtro, tipo: e.target.value })}
          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
        >
          <option value="todos">Todos</option>
          <option value="evento">Evento</option>
          <option value="tarefa">Tarefa</option>
          <option value="aniversario">Aniversário</option>
        </select>
      </div>

      <div>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Status</label>
        <select
          value={filtro.status}
          onChange={(e) => onMudarFiltro({ ...filtro, status: e.target.value })}
          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
        >
          <option value="todos">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="concluida">Concluída</option>
        </select>
      </div>
    </div>
  );
}
