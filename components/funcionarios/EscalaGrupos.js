import { useMemo } from 'react';
import Checkbox from '../ui/Checkbox';
import IndicadorVinculo from './IndicadorVinculo';
import {
  agruparPorCargo,
  rotuloQuantidadeFuncionarias,
  estadoSelecaoGrupo,
  alternarSelecaoGrupo,
} from '../../lib/funcionarios/escalaGrupos';
import estilos from './escala.module.css';

// Título de um grupo por cargo (Semanal desktop e calendários compactos):
// nome do cargo + quantidade, hierarquia discreta -- não é cabeçalho de
// relatório. `como` permite o nível de título adequado ao lugar.
export function TituloGrupoEscala({ grupo, como: Tag = 'h4' }) {
  return (
    <Tag className={estilos.tituloGrupo}>
      <span className={estilos.tituloGrupoNome}>{grupo.nome}</span>
      <span className={estilos.tituloGrupoContagem}>{rotuloQuantidadeFuncionarias(grupo.funcionarios.length)}</span>
    </Tag>
  );
}

// Seções (título + conteúdo) por cargo, uma após a outra, com rolagem da
// própria página -- Semanal desktop (uma tabela por cargo) e os calendários
// compactos (<= 900px) de Semanal/Mensal.
export function SecoesPorCargo({ grupos, children }) {
  return (
    <div className={estilos.secoesGrupos}>
      {grupos.map((grupo) => (
        <section key={grupo.chave} className={estilos.secaoGrupo} aria-label={grupo.nome}>
          <TituloGrupoEscala grupo={grupo} />
          {children(grupo)}
        </section>
      ))}
    </div>
  );
}

// Checklist de funcionárias dos modais "Aplicar em lote" e "Preencher pela
// Escala Padrão", agrupado por cargo. "Marcar/Desmarcar todas deste cargo"
// é só ATALHO de seleção: nada vem marcado, e quem decide o escopo da ação
// continua sendo a lista final de selecionadas (a equipe toda está
// disponível, como antes).
export function SelecaoFuncionariasPorCargo({ funcionarios, selecionados, onAlterar }) {
  const grupos = useMemo(() => agruparPorCargo(funcionarios), [funcionarios]);

  function alternarUma(id) {
    onAlterar(selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id]);
  }

  return (
    <div className={estilos.selecaoFuncionarios}>
      {grupos.map((grupo) => {
        const ids = grupo.funcionarios.map((f) => f.id);
        const todasMarcadas = estadoSelecaoGrupo(ids, selecionados) === 'todas';
        return (
          <div key={grupo.chave} className={estilos.selecaoGrupo} role="group" aria-label={grupo.nome}>
            <div className={estilos.selecaoGrupoTopo}>
              <span className={estilos.selecaoGrupoNome}>
                {grupo.nome} <span className={estilos.tituloGrupoContagem}>{rotuloQuantidadeFuncionarias(ids.length)}</span>
              </span>
              <button
                type="button"
                className={estilos.botaoMarcarGrupo}
                onClick={() => onAlterar(alternarSelecaoGrupo(ids, selecionados))}
                aria-label={`${todasMarcadas ? 'Desmarcar' : 'Marcar'} todas do cargo ${grupo.nome}`}
              >
                {todasMarcadas ? 'Desmarcar todas deste cargo' : 'Marcar todas deste cargo'}
              </button>
            </div>
            {grupo.funcionarios.map((f) => (
              <Checkbox
                key={f.id}
                rotulo={<>{f.nome}<IndicadorVinculo tipoVinculo={f.tipo_vinculo} /></>}
                checked={selecionados.includes(f.id)}
                onChange={() => alternarUma(f.id)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
