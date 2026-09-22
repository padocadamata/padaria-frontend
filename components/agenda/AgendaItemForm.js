import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { cx } from '../../lib/design/cx';
import estilos from './agenda.module.css';

const DIAS_SEMANA_OPCOES = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';
  if (msg.includes('nao e uma ocorrencia valida')) {
    return 'A data escolhida não é uma ocorrência válida desta série.';
  }
  if (msg.includes('ja e uma ocorrencia normal desta serie')) {
    return 'Essa data já é uma ocorrência normal desta série — escolha outra data.';
  }
  return 'Não foi possível salvar. Confira os campos e tente novamente.';
}

// Formulário único de criar/editar evento ou tarefa. modo:
//   'criar'               -- INSERT simples em agenda_itens;
//   'editar_serie'        -- UPDATE simples (toda a série/o item avulso);
//   'editar_esta_e_proximas' -- chama a RPC de split, recebe dataCorte
//     (a data_ocorrencia ORIGINAL da instância clicada -- nunca uma data
//     arbitrária, ver lib/agenda/expandirRecorrencia.js).
// Recorrência só mostra os campos adicionais quando "Repetir" está
// marcado -- e fica sempre oculta em editar_esta_e_proximas (a
// frequência da nova série é herdada/editável, mas a interface aqui
// simplifica para V1: mesma frequência da série original).
//
// Sem Esc (fecharComEsc=false): formulário com dados digitados, mesmo
// padrão adotado nas fases anteriores para não perder o que já foi
// preenchido com uma tecla acidental.
export default function AgendaItemForm({
  modo,
  item,
  dataCorte,
  dataInicialSugerida,
  categorias,
  onSalvo,
  onCancelar,
}) {
  const ehCriacao = modo === 'criar';
  const ehEstaEProximas = modo === 'editar_esta_e_proximas';

  const [tipo, setTipo] = useState(item?.tipo || 'evento');
  const [titulo, setTitulo] = useState(item?.titulo || '');
  const [descricao, setDescricao] = useState(item?.descricao || '');
  const [categoria, setCategoria] = useState(item?.categoria || categorias[0]?.valor || 'OUTROS');
  const [dataInicio, setDataInicio] = useState(
    ehEstaEProximas ? dataCorte : item?.data_inicio || dataInicialSugerida || ''
  );
  const [dataFim, setDataFim] = useState(item?.data_fim || '');
  const [diaInteiro, setDiaInteiro] = useState(item?.dia_inteiro ?? true);
  const [horaInicio, setHoraInicio] = useState(item?.hora_inicio || '');
  const [horaFim, setHoraFim] = useState(item?.hora_fim || '');

  const [repetir, setRepetir] = useState(!!item && item.tipo_recorrencia !== 'nenhuma');
  const [tipoRecorrencia, setTipoRecorrencia] = useState(
    item?.tipo_recorrencia && item.tipo_recorrencia !== 'nenhuma' ? item.tipo_recorrencia : 'semanal'
  );
  const [intervalo, setIntervalo] = useState(String(item?.recorrencia_intervalo || 1));
  const [diasSemana, setDiasSemana] = useState(new Set(item?.recorrencia_dias_semana || []));
  const [dataFimSerie, setDataFimSerie] = useState(item?.recorrencia_data_fim || '');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const podeMudarTipo = ehCriacao;
  const podeMudarRepeticao = ehCriacao || modo === 'editar_serie';

  function alternarDiaSemana(valor) {
    setDiasSemana((atual) => {
      const novo = new Set(atual);
      if (novo.has(valor)) novo.delete(valor);
      else novo.add(valor);
      return novo;
    });
  }

  function validar() {
    if (!titulo.trim()) return 'Informe um título.';
    if (!dataInicio) return 'Informe a data.';
    if (!diaInteiro && !horaInicio) return 'Informe ao menos a hora de início.';
    if (repetir && diasSemana.size === 0 && tipoRecorrencia === 'semanal') {
      return 'Selecione ao menos um dia da semana.';
    }
    if (repetir && (!intervalo || parseInt(intervalo, 10) <= 0)) {
      return 'O intervalo de repetição deve ser maior que zero.';
    }
    return '';
  }

  async function confirmar() {
    const erroValidacao = validar();
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }

    setSalvando(true);
    setErro('');
    const supabase = createClient();

    const payloadBase = {
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      categoria,
      hora_inicio: diaInteiro ? null : horaInicio || null,
      hora_fim: diaInteiro ? null : horaFim || null,
      dia_inteiro: diaInteiro,
      tipo_recorrencia: repetir ? tipoRecorrencia : 'nenhuma',
      recorrencia_intervalo: repetir ? parseInt(intervalo, 10) : null,
      recorrencia_dias_semana: repetir && tipoRecorrencia === 'semanal' ? Array.from(diasSemana) : null,
      recorrencia_data_fim: repetir ? dataFimSerie || null : null,
    };

    if (ehEstaEProximas) {
      const { error } = await supabase.rpc('editar_serie_agenda_esta_e_proximas', {
        p_agenda_item_id: item.id,
        p_data_corte: dataCorte,
        p_titulo: payloadBase.titulo,
        p_descricao: payloadBase.descricao,
        p_categoria: payloadBase.categoria,
        p_hora_inicio: payloadBase.hora_inicio,
        p_hora_fim: payloadBase.hora_fim,
        p_dia_inteiro: payloadBase.dia_inteiro,
        p_tipo_recorrencia: item.tipo_recorrencia,
        p_recorrencia_intervalo: item.recorrencia_intervalo,
        p_recorrencia_dias_semana: item.recorrencia_dias_semana,
        p_recorrencia_data_fim: item.recorrencia_data_fim,
      });
      setSalvando(false);
      if (error) {
        setErro(mensagemErro(error));
        return;
      }
      onSalvo();
      return;
    }

    const payload = {
      ...payloadBase,
      data_inicio: dataInicio,
      data_fim: tipo === 'evento' && !repetir ? dataFim || null : null,
    };

    let error;
    if (ehCriacao) {
      ({ error } = await supabase.from('agenda_itens').insert(payload));
    } else {
      ({ error } = await supabase.from('agenda_itens').update(payload).eq('id', item.id));
    }

    setSalvando(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }
    onSalvo();
  }

  return (
    <Modal
      titulo={ehCriacao ? 'Novo item da Agenda' : ehEstaEProximas ? 'Editar esta e as próximas' : 'Editar item'}
      onFechar={salvando ? undefined : onCancelar}
      largura="md"
      fecharComEsc={false}
    >
      {podeMudarTipo && (
        <div className={estilos.tipoRadios}>
          <label className={estilos.tipoRadio}>
            <input type="radio" checked={tipo === 'evento'} onChange={() => setTipo('evento')} /> Evento
          </label>
          <label className={estilos.tipoRadio}>
            <input type="radio" checked={tipo === 'tarefa'} onChange={() => setTipo('tarefa')} /> Tarefa
          </label>
        </div>
      )}

      <div className={cx(estilos.grade, estilos.secao)}>
        <Field label="Título *" className={estilos.larguraTotal}>
          <Input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>

        <Field label="Descrição" className={estilos.larguraTotal}>
          <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
        </Field>

        <Field label="Categoria">
          <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {categorias.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.valor}
                {!c.ativo ? ' (inativa)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`${repetir ? 'A partir de' : 'Data'} *`}>
          <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} disabled={ehEstaEProximas} />
        </Field>

        {tipo === 'evento' && !repetir && (
          <Field label="Data final (evento de vários dias — opcional)">
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </Field>
        )}

        <Field className={estilos.larguraTotal}>
          <Checkbox rotulo="Dia inteiro" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} />
        </Field>

        {!diaInteiro && (
          <>
            <Field label="Hora início *">
              <Input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </Field>
            <Field label="Hora fim">
              <Input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
            </Field>
          </>
        )}
      </div>

      {podeMudarRepeticao && (
        <div className={estilos.secao}>
          <Checkbox rotulo="Repetir" checked={repetir} onChange={(e) => setRepetir(e.target.checked)} />
        </div>
      )}

      {repetir && podeMudarRepeticao && (
        <div className={estilos.recorrenciaBloco}>
          <div className={estilos.grade}>
            <Field label="Frequência">
              <Select value={tipoRecorrencia} onChange={(e) => setTipoRecorrencia(e.target.value)}>
                <option value="diaria">Diária</option>
                <option value="semanal">Semanal</option>
                <option value="mensal">Mensal</option>
                <option value="anual">Anual</option>
              </Select>
            </Field>

            <Field label="A cada">
              <Input type="number" min="1" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
            </Field>
          </div>

          {tipoRecorrencia === 'semanal' && (
            <div style={{ marginTop: 'var(--ds-sp-3)' }}>
              <span className={estilos.tituloSecao} style={{ border: 'none', padding: 0, fontSize: 'var(--ds-fs-label)' }}>
                Dias da semana
              </span>
              <div className={estilos.diasSemana}>
                {DIAS_SEMANA_OPCOES.map((d) => (
                  <label key={d.value} className={cx(estilos.diaChip, diasSemana.has(d.value) && estilos.diaChipAtivo)}>
                    <input
                      type="checkbox"
                      className={estilos.diaChipInput}
                      checked={diasSemana.has(d.value)}
                      onChange={() => alternarDiaSemana(d.value)}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <Field label="Termina em (opcional)" className={estilos.larguraTotal}>
            <Input type="date" value={dataFimSerie} onChange={(e) => setDataFimSerie(e.target.value)} />
          </Field>
        </div>
      )}

      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <div className={estilos.rodape}>
        <Button variante="secondary" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={confirmar} disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </Modal>
  );
}
