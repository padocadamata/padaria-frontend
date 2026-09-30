import FilterBar from '../ui/FilterBar';
import Field from '../ui/Field';
import Select from '../ui/Select';
import { FILTROS_PADRAO, SITUACOES, contarFiltrosAtivos } from '../../lib/tarefas/calendario';

// Filtros VISUAIS do calendário de Tarefas -- nunca alteram programação.
export default function TarefasFiltros({ filtros, onMudar, opcoesResponsavel, categorias }) {
  const atualizar = (campo) => (e) => onMudar({ ...filtros, [campo]: e.target.value });

  return (
    <FilterBar ativos={contarFiltrosAtivos(filtros)} onLimpar={() => onMudar(FILTROS_PADRAO)}>
      <Field label="Responsável">
        <Select value={filtros.responsavel} onChange={atualizar('responsavel')}>
          <option value="">Todos</option>
          {opcoesResponsavel.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </Select>
      </Field>
      <Field label="Situação">
        <Select value={filtros.situacao} onChange={atualizar('situacao')}>
          <option value={SITUACOES.TODAS}>Todas</option>
          <option value={SITUACOES.PENDENTES}>Pendentes</option>
          <option value={SITUACOES.CONCLUIDAS}>Concluídas</option>
        </Select>
      </Field>
      <Field label="Categoria">
        <Select value={filtros.categoria} onChange={atualizar('categoria')}>
          <option value="">Todas</option>
          {categorias.map((c) => (
            <option key={c.valor} value={c.valor}>{c.valor.charAt(0) + c.valor.slice(1).toLowerCase()}</option>
          ))}
        </Select>
      </Field>
    </FilterBar>
  );
}
