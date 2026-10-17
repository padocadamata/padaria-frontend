import { compararTexto } from '../ordenacao/comparadores';

// Agrupamento da Escala por CARGO -- só APRESENTAÇÃO (substitui os antigos
// filtros Cargo/Funcionária nas visões Semanal, Mensal e Cobertura). Nunca
// é escopo de escrita nem regra nova: ações em lote/cópia continuam sobre a
// equipe toda, e o cálculo de cobertura por cargo usa o mesmo motor
// (escalaCobertura.js), só com a lista do grupo.
//
// Fonte: a MESMA lista `funcionarios` da página (ativos, com cargo_id e
// funcionarios_cargos.nome) -- os grupos saem das próprias funcionárias,
// então nunca existe grupo vazio, e um cargo inativo continua aparecendo
// enquanto tiver funcionária ativa vinculada.

export const CHAVE_SEM_CARGO = 'sem-cargo';
export const ROTULO_SEM_CARGO = 'Sem cargo definido';
export const ROTULO_CARGO_SEM_NOME = 'Cargo sem nome';

// Ordem dos grupos: cargos com nome em ordem alfabética pt-BR (mesmo
// comparador das opções nominais do sistema, lib/ordenacao/opcoes.js),
// desempate por cargo_id; depois cargos cujo nome não veio (cargo_id sem
// nome legível -- a funcionária nunca some); "Sem cargo definido" sempre
// por último. Dentro do grupo, a ordem RECEBIDA é preservada (a página
// aplica a ordenação escolhida pelo usuário com ordenarDentroDosGrupos).
//
// Devolve [{ chave, cargoId, nome, funcionarios }].
export function agruparPorCargo(funcionarios) {
  const porChave = new Map();
  for (const f of funcionarios || []) {
    const cargoId = f.cargo_id || null;
    const chave = cargoId || CHAVE_SEM_CARGO;
    if (!porChave.has(chave)) {
      const nomeBruto = (f.funcionarios_cargos?.nome || '').trim();
      porChave.set(chave, {
        chave,
        cargoId,
        nome: !cargoId ? ROTULO_SEM_CARGO : nomeBruto || ROTULO_CARGO_SEM_NOME,
        semNome: !!cargoId && !nomeBruto,
        funcionarios: [],
      });
    }
    porChave.get(chave).funcionarios.push(f);
  }

  const grupos = Array.from(porChave.values());
  const peso = (g) => (!g.cargoId ? 2 : g.semNome ? 1 : 0);
  grupos.sort((a, b) => peso(a) - peso(b) || compararTexto(a.nome, b.nome) || compararTexto(a.chave, b.chave));
  return grupos.map(({ semNome, ...grupo }) => grupo);
}

// Aplica a MESMA ordenação (função da página, ex.: useOrdenacao().ordenar
// já com as colunas) dentro de cada grupo -- a ordem dos cargos não muda.
export function ordenarDentroDosGrupos(grupos, ordenar) {
  return grupos.map((g) => ({ ...g, funcionarios: ordenar(g.funcionarios) }));
}

// Todas as funcionárias na ordem da tela (grupo a grupo) -- exportação e
// contagens.
export function funcionariasDosGrupos(grupos) {
  return grupos.flatMap((g) => g.funcionarios);
}

export function rotuloQuantidadeFuncionarias(quantidade) {
  return `${quantidade} ${quantidade === 1 ? 'funcionária' : 'funcionárias'}`;
}

// Atalho "Marcar/Desmarcar todas deste cargo" dos checklists (Aplicar em
// lote / Preencher pela Escala Padrão) -- só SELEÇÃO, nunca escopo de ação.
// 'todas' quando todas do grupo já estão marcadas (o atalho vira
// "Desmarcar"); senão 'nenhuma'/'parcial' (o atalho marca as que faltam).
export function estadoSelecaoGrupo(idsDoGrupo, selecionados) {
  const marcadas = idsDoGrupo.filter((id) => selecionados.includes(id)).length;
  if (idsDoGrupo.length > 0 && marcadas === idsDoGrupo.length) return 'todas';
  return marcadas === 0 ? 'nenhuma' : 'parcial';
}

// Nova lista de selecionados após o atalho do grupo: desmarca o grupo
// inteiro se ele já estava todo marcado; senão acrescenta as que faltam
// (sem duplicar e sem mexer na seleção dos outros grupos).
export function alternarSelecaoGrupo(idsDoGrupo, selecionados) {
  if (estadoSelecaoGrupo(idsDoGrupo, selecionados) === 'todas') {
    const doGrupo = new Set(idsDoGrupo);
    return selecionados.filter((id) => !doGrupo.has(id));
  }
  return [...selecionados, ...idsDoGrupo.filter((id) => !selecionados.includes(id))];
}
