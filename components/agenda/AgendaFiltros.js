import Field from '../ui/Field';
import FilterBar from '../ui/FilterBar';
import Select from '../ui/Select';

const FILTRO_PADRAO = { categoria: 'todas', tipo: 'todos', status: 'todos' };

// Filtros V1 da Agenda: categoria, tipo (evento/tarefa/aniversário) e
// status (pendente/concluída — só relevante para tarefa, mas não
// desabilitado quando "evento" está selecionado, para manter o controle
// simples). Mesma semântica de antes -- só a moldura virou FilterBar.
export default function AgendaFiltros({ categorias, filtro, onMudarFiltro }) {
  const ativos = [
    filtro.categoria !== FILTRO_PADRAO.categoria,
    filtro.tipo !== FILTRO_PADRAO.tipo,
    filtro.status !== FILTRO_PADRAO.status,
  ].filter(Boolean).length;

  function limpar() {
    onMudarFiltro({ ...FILTRO_PADRAO });
  }

  return (
    <FilterBar ativos={ativos} onLimpar={limpar}>
      <Field label="Categoria">
        <Select value={filtro.categoria} onChange={(e) => onMudarFiltro({ ...filtro, categoria: e.target.value })}>
          <option value="todas">Todas</option>
          {categorias.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.valor}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Tipo">
        <Select value={filtro.tipo} onChange={(e) => onMudarFiltro({ ...filtro, tipo: e.target.value })}>
          <option value="todos">Todos</option>
          <option value="evento">Evento</option>
          <option value="tarefa">Tarefa</option>
          <option value="aniversario">Aniversário</option>
        </Select>
      </Field>

      <Field label="Status">
        <Select value={filtro.status} onChange={(e) => onMudarFiltro({ ...filtro, status: e.target.value })}>
          <option value="todos">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="concluida">Concluída</option>
        </Select>
      </Field>
    </FilterBar>
  );
}
