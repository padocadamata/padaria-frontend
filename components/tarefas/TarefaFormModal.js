import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import Checkbox from '../ui/Checkbox';
import Alert from '../ui/Alert';
import {
  DIAS_SEMANA,
  SEMANAS_DO_MES,
  TIPOS_REGRA,
  dataReferenciaRegra,
  descreverRegra,
  formularioParaRegra,
  mesmaProgramacao,
  primeiraDataAlteracao,
  proximaVersao,
  regraParaFormulario,
  regraVigente,
  validarFormularioRegra,
} from '../../lib/tarefas/regras';
import { dataCurta } from '../../lib/tarefas/calendario';
import { salvarTarefa } from '../../lib/tarefas/consultas';
import { mensagemErro } from '../../lib/tarefas/erros';
import { PreviaSincronizacao } from './ProgramarMesModal';
import estilos from './tarefas.module.css';

const OPCOES_FREQUENCIA = [
  { valor: TIPOS_REGRA.DIARIA, rotulo: 'Diária (todos os dias)' },
  { valor: TIPOS_REGRA.DIAS_SEMANA, rotulo: 'Em dias da semana (1x, 2x, 3x por semana, fim de semana...)' },
  { valor: TIPOS_REGRA.SEMANAS_DO_MES, rotulo: 'Em semanas do mês (ex.: quinzenal)' },
  { valor: TIPOS_REGRA.SEM_PROGRAMACAO, rotulo: 'Sem programação automática' },
];

function dataBR(iso) {
  return iso ? `${dataCurta(iso)}/${iso.slice(0, 4)}` : '';
}

function alternar(lista, valor) {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}

// Criar / editar / reativar uma tarefa. Descrição, categoria, ordem e
// observação são correções imediatas. Mudança de programação (frequência,
// dias, semanas ou grupo) vira uma nova versão "a partir de" uma data >=
// hoje, com prévia do efeito nas ocorrências futuras ainda não tocadas.
// O deslocamento da rotação nunca aparece: o banco escolhe o mais
// equilibrado.
//
// Data de referência: a edição compara o formulário com a regra que vale em
// `dataReferenciaRegra` (hoje, ou a 1ª versão se a tarefa ainda não
// começou) e manda essa MESMA data ao banco -- assim corrigir só o nome
// não vira mudança de programação. Nova versão: nunca antes da última já
// gravada (`primeiraDataAlteracao`), que o banco recusaria.
export default function TarefaFormModal({ modo, tarefa, regras, categorias, grupos, hoje, onFechar, onSalvo }) {
  const dataMinima = primeiraDataAlteracao(regras, hoje);
  const dataInicial = modo === 'editar' ? dataReferenciaRegra(regras, hoje) : modo === 'reativar' ? dataMinima : hoje;
  const base = modo === 'reativar'
    ? [...(regras || [])].sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde)).find((r) => r.tipo !== TIPOS_REGRA.SEM_PROGRAMACAO) || null
    : regraVigente(regras, dataInicial);

  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '');
  const [categoria, setCategoria] = useState(tarefa?.categoria ?? categorias[0]?.valor ?? '');
  const [observacao, setObservacao] = useState(tarefa?.observacao ?? '');
  const [ordem, setOrdem] = useState(tarefa?.ordem != null ? String(tarefa.ordem) : '');
  const [grupoId, setGrupoId] = useState(base?.grupo_id ?? '');
  const [form, setForm] = useState(() => regraParaFormulario(base));
  const [aPartirDe, setAPartirDe] = useState(dataInicial);
  const [previa, setPrevia] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const regraForm = useMemo(() => ({ ...formularioParaRegra(form), grupo_id: form.tipo === TIPOS_REGRA.SEM_PROGRAMACAO ? null : grupoId || null }), [form, grupoId]);
  const vigenteNaData = regraVigente(regras, aPartirDe || dataInicial);
  const mudouProgramacao = modo !== 'editar' || !mesmaProgramacao(vigenteNaData, regraForm);
  const agendada = modo !== 'novo' ? proximaVersao(regras, aPartirDe || dataInicial) : null;

  function mudarForm(parcial) {
    setForm((f) => ({ ...f, ...parcial }));
    setPrevia(null);
  }

  async function executar(simular) {
    const erroRegra = validarFormularioRegra(form);
    if (!descricao.trim()) return setErro('Informe a descrição da tarefa.');
    if (erroRegra) return setErro(erroRegra);
    if (mudouProgramacao && !aPartirDe) return setErro('Informe a partir de quando a programação vale.');

    setSalvando(true);
    setErro('');
    try {
      const r = await salvarTarefa({
        id: tarefa?.id ?? null,
        descricao,
        categoria,
        ordem: ordem.trim() === '' ? null : Number(ordem),
        observacao,
        ...regraForm,
        // Sempre a data de referência: sem mudança de programação o banco só
        // a usa para achar a regra a comparar (não grava versão nova).
        aplicarAPartirDe: aPartirDe || dataInicial,
        ativo: modo === 'reativar' ? true : null,
      }, simular);
      if (simular) setPrevia(r);
      else onSalvo(r);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const titulo = modo === 'novo' ? 'Nova tarefa' : modo === 'reativar' ? 'Reativar tarefa' : 'Editar tarefa';

  return (
    <Modal titulo={titulo} onFechar={onFechar} largura="lg" fecharComEsc={false}>
      <div className={estilos.pilha}>
        <Field label="Descrição">
          <Textarea value={descricao} rows={2} maxLength={300} onChange={(e) => setDescricao(e.target.value)} disabled={salvando} />
        </Field>
        <div className={estilos.linhaCampos}>
          <Field label="Categoria">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)} disabled={salvando}>
              {categorias.map((c) => (
                <option key={c.valor} value={c.valor}>{c.valor}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ordem na categoria" dica="Opcional. Vazio = no fim.">
            <Input type="number" min={0} value={ordem} onChange={(e) => setOrdem(e.target.value)} disabled={salvando} />
          </Field>
        </div>
        <Field label="Observação (opcional)">
          <Textarea value={observacao} rows={2} maxLength={1000} onChange={(e) => setObservacao(e.target.value)} disabled={salvando} />
        </Field>

        <section className={estilos.secaoModal}>
          <h3 className={estilos.tituloSecaoModal}>Programação</h3>
          <div className={estilos.pilha}>
            <Field label="Frequência">
              <Select value={form.tipo} onChange={(e) => mudarForm({ tipo: e.target.value })} disabled={salvando}>
                {OPCOES_FREQUENCIA.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                ))}
              </Select>
            </Field>

            {(form.tipo === TIPOS_REGRA.DIAS_SEMANA || form.tipo === TIPOS_REGRA.SEMANAS_DO_MES) && (
              <fieldset className={estilos.opcoesDias}>
                <legend className={estilos.textoAuxiliar}>Dias da semana</legend>
                {DIAS_SEMANA.map((d) => (
                  <Checkbox
                    key={d.valor}
                    rotulo={d.curto}
                    checked={form.dias.includes(d.valor)}
                    onChange={() => mudarForm({ dias: alternar(form.dias, d.valor) })}
                    disabled={salvando}
                  />
                ))}
              </fieldset>
            )}

            {form.tipo === TIPOS_REGRA.SEMANAS_DO_MES && (
              <>
                <fieldset className={estilos.opcoesDias}>
                  <legend className={estilos.textoAuxiliar}>Em quais ocorrências desse dia no mês</legend>
                  {SEMANAS_DO_MES.map((s) => (
                    <Checkbox
                      key={s}
                      rotulo={`${s}ª`}
                      checked={form.semanas.includes(s)}
                      onChange={() => mudarForm({ semanas: alternar(form.semanas, s) })}
                      disabled={salvando}
                    />
                  ))}
                </fieldset>
                <div>
                  <Button variante="ghost" tamanho="sm" onClick={() => mudarForm({ semanas: [2, 4] })} disabled={salvando}>
                    Quinzenal (2ª e 4ª)
                  </Button>
                </div>
              </>
            )}

            {form.tipo !== TIPOS_REGRA.SEM_PROGRAMACAO && (
              <Field
                label="Distribuição conjunta (manutenção)"
                dica="Configuração interna do motor: tarefas da mesma distribuição conjunta recebem sempre a mesma posição (F1/F2/F3) no dia. Não aparece no calendário."
              >
                <Select value={grupoId} onChange={(e) => { setGrupoId(e.target.value); setPrevia(null); }} disabled={salvando}>
                  <option value="">Nenhum — distribuída sozinha</option>
                  {grupos.map((g) => (
                    <option key={g.id} value={g.id}>{g.nome}</option>
                  ))}
                </Select>
              </Field>
            )}

            <p className={estilos.caixaInfo}>
              <strong>{descreverRegra(regraForm)}</strong>
            </p>

            {mudouProgramacao && (
              <Field
                label="Vale a partir de"
                dica="Dias anteriores ficam como estão. Só ocorrências futuras ainda não concluídas, ajustadas ou canceladas são reprogramadas."
              >
                <Input type="date" min={dataMinima} value={aPartirDe} onChange={(e) => { setAPartirDe(e.target.value); setPrevia(null); }} disabled={salvando} />
              </Field>
            )}
            {agendada && (
              <Alert tom="warning">
                Já existe uma mudança agendada para {dataBR(agendada.vigente_desde)} ({descreverRegra(agendada)}). Para alterar a programação, use
                uma data a partir dela.
              </Alert>
            )}

            {modo !== 'novo' && regras?.length > 0 && (
              <div>
                <p className={estilos.textoAuxiliar}>Histórico de programação:</p>
                <ul className={estilos.listaVigencias}>
                  {regras.map((r) => (
                    <li key={r.id}>
                      desde {dataBR(r.vigente_desde)}: {descreverRegra(r)}
                      {r.grupo_id ? ` · ${grupos.find((g) => g.id === r.grupo_id)?.nome ?? 'grupo'}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {erro && <Alert tom="danger">{erro}</Alert>}
        {previa && mudouProgramacao && <PreviaSincronizacao resultado={previa} />}
        {previa && mudouProgramacao && previa.criadas === 0 && previa.removidas === 0 && (
          <p className={estilos.textoAuxiliar}>Nenhum mês programado é afetado agora; a nova regra vale para os próximos meses programados.</p>
        )}

        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          {mudouProgramacao && !previa ? (
            <Button onClick={() => executar(true)} disabled={salvando}>Ver prévia</Button>
          ) : (
            <Button onClick={() => executar(false)} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
