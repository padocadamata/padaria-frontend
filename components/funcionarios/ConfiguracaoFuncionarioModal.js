import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import IndicadorVinculo from './IndicadorVinculo';
import { descricaoVinculo } from '../../lib/funcionarios/vinculo';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import {
  buscarFormaRemuneracaoAtual,
  buscarValorMensalBaseAtual,
  buscarPreferenciaPagamento,
  buscarHistoricoConfiguracao,
  inserirFormaRemuneracao,
  inserirRemuneracaoBase,
  salvarPreferenciaPagamento,
  formatarMoeda,
} from '../../lib/funcionarios/pagamentos';
import {
  PERIODICIDADES_PREFERENCIA,
  DIAS_SEMANA,
  TIPOS_REGRA_MENSAL,
  codificarRegraMensal,
  lerRegraMensal,
  descreverPreferencia,
} from '../../lib/funcionarios/pagamentosCalculo';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

function formatarDataCurtaBr(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}


// Configuração de Pagamentos de 1 funcionário (migrations 0065/0066):
// vínculo (só leitura -- vem de Funcionários/Escala), forma de remuneração
// (mensal|por_hora, versionada) + valor mensal-base (só quando mensal,
// também versionado) + preferência operacional (sem vigência, nunca trava
// pagamento). NUNCA presume nada: cada bloco mostra "Não configurado"
// explicitamente quando não há nenhuma linha ainda -- decisão de negócio
// de quem opera a tela, nunca um default silencioso.
export default function ConfiguracaoFuncionarioModal({ funcionario, podeRegras, podeEditar, onFechar, onSalvo }) {
  const [carregando, setCarregando] = useState(true);
  const [formaAtual, setFormaAtual] = useState(null);
  const [valorBaseAtual, setValorBaseAtual] = useState(null);
  const [preferenciaAtual, setPreferenciaAtual] = useState(null);
  const [historico, setHistorico] = useState({ formas: [], bases: [] });

  // Sem pré-seleção: quem não está configurado continua "Não configurado"
  // até alguém escolher explicitamente (nunca presumir mensal/por_hora).
  const [novaForma, setNovaForma] = useState('');
  const [vigenciaForma, setVigenciaForma] = useState(dataLocalHoje());
  const [salvandoForma, setSalvandoForma] = useState(false);
  const [erroForma, setErroForma] = useState('');

  const [novoValorBase, setNovoValorBase] = useState('');
  const [vigenciaValorBase, setVigenciaValorBase] = useState(dataLocalHoje());
  const [salvandoValorBase, setSalvandoValorBase] = useState(false);
  const [erroValorBase, setErroValorBase] = useState('');

  // Preferência: tela amigável; o código abstrato de dia_mes_habitual
  // (dia_util:N / dia_fixo:N / mensal:ultimo_dia) nunca aparece -- ver
  // codificarRegraMensal/lerRegraMensal. Sem pré-seleção de periodicidade.
  const [periodicidade, setPeriodicidade] = useState('');
  const [diaSemanaHabitual, setDiaSemanaHabitual] = useState('');
  const [regraMensalTipo, setRegraMensalTipo] = useState('');
  const [regraMensalDia, setRegraMensalDia] = useState('');
  const [codigoNaoReconhecido, setCodigoNaoReconhecido] = useState('');
  const [salvandoPreferencia, setSalvandoPreferencia] = useState(false);
  const [erroPreferencia, setErroPreferencia] = useState('');

  async function carregar() {
    setCarregando(true);
    const [forma, valorBase, preferencia, hist] = await Promise.all([
      buscarFormaRemuneracaoAtual(funcionario.id),
      buscarValorMensalBaseAtual(funcionario.id),
      buscarPreferenciaPagamento(funcionario.id),
      buscarHistoricoConfiguracao(funcionario.id),
    ]);
    setHistorico(hist);
    setFormaAtual(forma);
    setValorBaseAtual(valorBase);
    setPreferenciaAtual(preferencia);
    if (forma) setNovaForma(forma);
    if (preferencia) {
      setPeriodicidade(preferencia.periodicidade);
      setDiaSemanaHabitual(preferencia.dia_semana_habitual === null || preferencia.dia_semana_habitual === undefined ? '' : String(preferencia.dia_semana_habitual));
      const regra = lerRegraMensal(preferencia.dia_mes_habitual);
      setRegraMensalTipo(regra.tipo);
      setRegraMensalDia(regra.dia);
      setCodigoNaoReconhecido(regra.tipo === 'desconhecido' ? regra.codigo : '');
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionario.id]);

  async function salvarForma() {
    setErroForma('');
    if (!novaForma) {
      setErroForma('Escolha a forma de remuneração.');
      return;
    }
    if (!vigenciaForma) {
      setErroForma('Informe a data de vigência.');
      return;
    }
    setSalvandoForma(true);
    const { erro } = await inserirFormaRemuneracao(funcionario.id, novaForma, vigenciaForma);
    setSalvandoForma(false);
    if (erro) {
      setErroForma(erro);
      return;
    }
    await carregar();
    onSalvo?.();
  }

  async function salvarValorBase() {
    setErroValorBase('');
    const valorNumerico = Number(novoValorBase);
    if (!novoValorBase || valorNumerico <= 0) {
      setErroValorBase('Informe um valor maior que zero.');
      return;
    }
    if (!vigenciaValorBase) {
      setErroValorBase('Informe a data de vigência.');
      return;
    }
    setSalvandoValorBase(true);
    const { erro } = await inserirRemuneracaoBase(funcionario.id, valorNumerico, vigenciaValorBase);
    setSalvandoValorBase(false);
    if (erro) {
      setErroValorBase(erro);
      return;
    }
    setNovoValorBase('');
    await carregar();
    onSalvo?.();
  }

  async function salvarPreferencia() {
    setErroPreferencia('');
    if (!periodicidade) {
      setErroPreferencia('Escolha a periodicidade.');
      return;
    }
    let diaMesHabitual = null;
    if (periodicidade === 'mensal') {
      if (regraMensalTipo === 'desconhecido') {
        // Regra gravada antes num formato que a tela não reconhece:
        // preservada como está, nunca apagada em silêncio.
        diaMesHabitual = codigoNaoReconhecido;
      } else if (regraMensalTipo) {
        diaMesHabitual = codificarRegraMensal({ tipo: regraMensalTipo, dia: regraMensalDia });
        if (!diaMesHabitual) {
          const def = TIPOS_REGRA_MENSAL.find((r) => r.valor === regraMensalTipo);
          setErroPreferencia(`Informe um dia entre ${def.min} e ${def.max}.`);
          return;
        }
      }
    }
    setSalvandoPreferencia(true);
    const { erro } = await salvarPreferenciaPagamento(funcionario.id, {
      periodicidade,
      diaSemanaHabitual: diaSemanaHabitual === '' ? null : Number(diaSemanaHabitual),
      diaMesHabitual,
    });
    setSalvandoPreferencia(false);
    if (erro) {
      setErroPreferencia(erro);
      return;
    }
    await carregar();
    onSalvo?.();
  }

  return (
    <Modal titulo={`Configuração de pagamentos — ${funcionario.nome}`} onFechar={onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        <div className={estilosPagamentos.resumoLinha}>
          <span>Vínculo</span>
          <span>
            <IndicadorVinculo tipoVinculo={funcionario.tipo_vinculo} /> {descricaoVinculo(funcionario.tipo_vinculo)}
          </span>
        </div>

        {carregando ? (
          <p role="status">Carregando...</p>
        ) : (
          <>
            <h4>Forma de remuneração</h4>
            <div className={estilosPagamentos.resumoLinha}>
              <span>Vigente hoje</span>
              {formaAtual ? <Badge tom="info">{formaAtual === 'mensal' ? 'Mensal' : 'Por hora'}</Badge> : <span className={estilosPagamentos.naoConfigurado}>Não configurado</span>}
            </div>
            {podeRegras && (
              <div className={estilosEscala.linhaOcorrencia}>
                <Select value={novaForma} onChange={(e) => setNovaForma(e.target.value)} aria-label="Nova forma de remuneração">
                  <option value="">Selecione…</option>
                  <option value="por_hora">Por hora</option>
                  <option value="mensal">Mensal</option>
                </Select>
                <Input type="date" value={vigenciaForma} onChange={(e) => setVigenciaForma(e.target.value)} aria-label="Vigente desde" />
                <Button type="button" variante="secondary" tamanho="sm" onClick={salvarForma} disabled={salvandoForma}>
                  {salvandoForma ? 'Salvando...' : 'Salvar nova vigência'}
                </Button>
              </div>
            )}
            {erroForma && <Alert tom="danger">{erroForma}</Alert>}
            {historico.formas.length > 0 && (
              <p className={estilosPagamentos.vazio}>
                Vigências: {historico.formas.map((h) => `${h.forma === 'mensal' ? 'Mensal' : 'Por hora'} desde ${formatarDataCurtaBr(h.vigente_desde)}`).join(' · ')}
              </p>
            )}

            {(formaAtual === 'mensal' || novaForma === 'mensal') && (
              <>
                <h4>Remuneração-base mensal</h4>
                <div className={estilosPagamentos.resumoLinha}>
                  <span>Vigente hoje</span>
                  {valorBaseAtual !== null ? <strong>{formatarMoeda(valorBaseAtual)}</strong> : <span className={estilosPagamentos.naoConfigurado}>Não configurado</span>}
                </div>
                {podeRegras && (
                  <div className={estilosEscala.linhaOcorrencia}>
                    <Input type="number" step="0.01" min="0" placeholder="Novo valor" value={novoValorBase} onChange={(e) => setNovoValorBase(e.target.value)} />
                    <Input type="date" value={vigenciaValorBase} onChange={(e) => setVigenciaValorBase(e.target.value)} aria-label="Vigente desde" />
                    <Button type="button" variante="secondary" tamanho="sm" onClick={salvarValorBase} disabled={salvandoValorBase}>
                      {salvandoValorBase ? 'Salvando...' : 'Salvar nova vigência'}
                    </Button>
                  </div>
                )}
                {erroValorBase && <Alert tom="danger">{erroValorBase}</Alert>}
                {historico.bases.length > 0 && (
                  <p className={estilosPagamentos.vazio}>
                    Vigências: {historico.bases.map((h) => `${formatarMoeda(h.valor)} desde ${formatarDataCurtaBr(h.vigente_desde)}`).join(' · ')}
                  </p>
                )}
              </>
            )}

            <h4>Preferência de pagamento (operacional)</h4>
            <p className={estilosPagamentos.vazio}>Só previsão/organização — nunca restringe quando um pagamento pode ser lançado.</p>
            <div className={estilosPagamentos.resumoLinha}>
              <span>Atual</span>
              {preferenciaAtual ? <strong>{descreverPreferencia(preferenciaAtual)}</strong> : <span className={estilosPagamentos.naoConfigurado}>Não configurado</span>}
            </div>
            {podeEditar && (
              <>
                <Field label="Periodicidade habitual">
                  <Select value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
                    <option value="">Selecione…</option>
                    {PERIODICIDADES_PREFERENCIA.map((p) => (
                      <option key={p.valor} value={p.valor}>
                        {p.rotulo}
                      </option>
                    ))}
                  </Select>
                </Field>
                {periodicidade === 'semanal' && (
                  <Field label="Dia da semana">
                    <Select value={diaSemanaHabitual} onChange={(e) => setDiaSemanaHabitual(e.target.value)}>
                      <option value="">Sem dia definido</option>
                      {DIAS_SEMANA.map((rotulo, indice) => (
                        <option key={indice} value={indice}>
                          {rotulo}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {periodicidade === 'mensal' && (
                  <>
                    {regraMensalTipo === 'desconhecido' && (
                      <Alert tom="warning">A regra de dia gravada anteriormente não é reconhecida por esta tela. Ela será mantida, a menos que você escolha outra opção abaixo.</Alert>
                    )}
                    <Field label="Dia do pagamento no mês">
                      <Select
                        value={regraMensalTipo === 'desconhecido' ? '' : regraMensalTipo}
                        onChange={(e) => {
                          setRegraMensalTipo(e.target.value);
                          setCodigoNaoReconhecido('');
                          if (e.target.value && e.target.value !== 'ultimo_dia' && !regraMensalDia) setRegraMensalDia('5');
                        }}
                      >
                        <option value="">Sem dia definido</option>
                        {TIPOS_REGRA_MENSAL.map((r) => (
                          <option key={r.valor} value={r.valor}>
                            {r.rotulo}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {(regraMensalTipo === 'dia_util' || regraMensalTipo === 'dia_fixo') && (
                      <Field label={regraMensalTipo === 'dia_util' ? 'Qual dia útil (ex.: 5 = 5º dia útil)' : 'Dia do mês'}>
                        <Select value={regraMensalDia} onChange={(e) => setRegraMensalDia(e.target.value)}>
                          {Array.from({ length: TIPOS_REGRA_MENSAL.find((r) => r.valor === regraMensalTipo).max }, (_, i) => String(i + 1)).map((n) => (
                            <option key={n} value={n}>
                              {regraMensalTipo === 'dia_util' ? `${n}º dia útil` : `Dia ${n}`}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </>
                )}
                <Button type="button" variante="secondary" tamanho="sm" onClick={salvarPreferencia} disabled={salvandoPreferencia}>
                  {salvandoPreferencia ? 'Salvando...' : 'Salvar preferência'}
                </Button>
                {erroPreferencia && <Alert tom="danger">{erroPreferencia}</Alert>}
              </>
            )}
          </>
        )}

        <div className={estilosEscala.rodapePlanejamento}>
          <Button type="button" variante="secondary" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
