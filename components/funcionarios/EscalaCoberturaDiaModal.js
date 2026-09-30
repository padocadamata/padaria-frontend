import { useMemo, useState } from 'react';
import { diaDaSemanaExibicao } from '../../lib/data/dataLocal';
import { calcularCoberturaDia, nomesComDesambiguacao } from '../../lib/funcionarios/escalaCobertura';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import Select from '../ui/Select';
import IndicadorVinculo from './IndicadorVinculo';
import estilos from './escala.module.css';

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

function listaOuTraco(pessoas) {
  return pessoas.length > 0 ? nomesComDesambiguacao(pessoas).join(', ') : '—';
}

// "Visão do Dia": resumo operacional (previsto/efetivo/folgas/faltas/
// atestados, todos com nomes) + cobertura por horário (com nomes e
// ausências) + escala individual, tudo derivado de calcularCoberturaDia --
// motor único de cobertura (lib/funcionarios/escalaCobertura.js). Este
// componente nunca recalcula identidade nem faixas.
export default function EscalaCoberturaDiaModal({ data, funcionarios, mapaEscala, cargos, cargoIdInicial, onFechar }) {
  const [cargoId, setCargoId] = useState(cargoIdInicial || '');

  const cobertura = useMemo(
    () => calcularCoberturaDia({ funcionarios, mapaEscala, data, cargoId: cargoId || null }),
    [funcionarios, mapaEscala, data, cargoId]
  );

  const { resumo, faixas, escalaIndividual } = cobertura;
  const tituloDia = `Cobertura — ${diaDaSemanaExibicao(data)}, ${formatarDataExibicao(data)}`;

  return (
    <Modal titulo={tituloDia} onFechar={onFechar} largura="md">
      <div className={estilos.modalCorpo}>
        {cargos.length > 0 && (
          <Select value={cargoId} onChange={(e) => setCargoId(e.target.value)} aria-label="Filtrar por cargo">
            <option value="">Todos os cargos</option>
            {cargos.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        )}

        <div className={estilos.resumoGrid}>
          <div className={estilos.resumoItem}><strong>{resumo.previstos}</strong><span>Previstos</span></div>
          <div className={estilos.resumoItem}><strong>{resumo.efetivos}</strong><span>Efetivos</span></div>
        </div>

        <div className={estilos.listaFaixas}>
          <div className={estilos.faixaCobertura}>
            <span className={estilos.faixaHorario}>Folgas</span>
            <span className={estilos.faixaPessoas}>{listaOuTraco(resumo.folgas)}</span>
          </div>
          <div className={estilos.faixaCobertura}>
            <span className={estilos.faixaHorario}>Faltas</span>
            <span className={estilos.faixaPessoas}>{listaOuTraco(resumo.faltas)}</span>
          </div>
          <div className={estilos.faixaCobertura}>
            <span className={estilos.faixaHorario}>Atestados</span>
            <span className={estilos.faixaPessoas}>{listaOuTraco(resumo.atestados)}</span>
          </div>
        </div>

        <div className={estilos.secaoOcorrencia}>
          <h4 className={estilos.tituloOcorrencia}>Cobertura por horário</h4>
          {faixas.length === 0 ? (
            <p className={estilos.notaOcorrencia}>Nenhum planejamento neste dia.</p>
          ) : (
            <ul className={estilos.listaFaixas}>
              {faixas.map((faixa, i) => (
                <li key={i} className={estilos.faixaCobertura}>
                  <span className={estilos.faixaHorario}>{faixa.inicio}–{faixa.fim}</span>
                  <span className={estilos.faixaPessoas}>
                    {faixa.efetivos.length} pessoa{faixa.efetivos.length === 1 ? '' : 's'}
                    {faixa.efetivos.length > 0 && ` — ${nomesComDesambiguacao(faixa.efetivos).join(', ')}`}
                    {faixa.ausentes.length > 0 && (
                      <span className={estilos.faixaAusente}>
                        {' '}
                        · Ausente: {faixa.ausentes.map((a) => `${a.primeiro_nome} (${a.ocorrenciaTipo === 'falta' ? 'Falta' : 'Atestado'})`).join(', ')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={estilos.secaoOcorrencia}>
          <h4 className={estilos.tituloOcorrencia}>Escala individual</h4>
          {escalaIndividual.length === 0 ? (
            <p className={estilos.notaOcorrencia}>Nenhum funcionário com escala definida neste dia.</p>
          ) : (
            <ul className={estilos.listaFaixas}>
              {escalaIndividual.map((item) => (
                <li key={item.funcionario.funcionario_id} className={estilos.faixaCobertura}>
                  <span className={estilos.faixaHorario}>
                    {item.funcionario.nome}
                    <IndicadorVinculo tipoVinculo={item.funcionario.tipo_vinculo} />
                  </span>
                  <span className={estilos.faixaPessoas}>
                    {item.tipo === 'folga'
                      ? 'Folga'
                      : item.periodos.map((p) => `${p.hora_inicio.slice(0, 5)}–${p.hora_fim.slice(0, 5)}`).join(', ')}
                    {item.ocorrencia && (
                      <Badge tom={item.ocorrencia.tipo === 'falta' ? 'danger' : 'warning'}>
                        {item.ocorrencia.tipo === 'falta' ? 'Falta' : 'Atestado'}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
