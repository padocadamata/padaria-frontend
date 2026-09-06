import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

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

const overlayEstilo = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000, padding: '20px',
};

const caixaEstilo = {
  backgroundColor: 'white', padding: '25px', borderRadius: '10px',
  maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '13px' };
const campoEstilo = {
  width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px',
  boxSizing: 'border-box', fontSize: '14px', marginBottom: '15px',
};

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
export default function AgendaItemForm({
  modo,
  item,
  dataCorte,
  dataInicialSugerida,
  categorias,
  corPrimaria,
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
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>
          {ehCriacao ? 'Novo item da Agenda' : ehEstaEProximas ? 'Editar esta e as próximas' : 'Editar item'}
        </h3>

        {podeMudarTipo && (
          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
            <label style={{ fontSize: '14px' }}>
              <input type="radio" checked={tipo === 'evento'} onChange={() => setTipo('evento')} /> Evento
            </label>
            <label style={{ fontSize: '14px' }}>
              <input type="radio" checked={tipo === 'tarefa'} onChange={() => setTipo('tarefa')} /> Tarefa
            </label>
          </div>
        )}

        <label style={rotuloEstilo}>Título *</label>
        <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} style={campoEstilo} autoFocus />

        <label style={rotuloEstilo}>Descrição</label>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          style={{ ...campoEstilo, minHeight: '60px', fontFamily: 'Arial' }}
        />

        <label style={rotuloEstilo}>Categoria</label>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={campoEstilo}>
          {categorias.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.valor}
              {!c.ativo ? ' (inativa)' : ''}
            </option>
          ))}
        </select>

        <label style={rotuloEstilo}>{repetir ? 'A partir de' : 'Data'} *</label>
        <input
          type="date"
          value={dataInicio}
          onChange={(e) => setDataInicio(e.target.value)}
          disabled={ehEstaEProximas}
          style={campoEstilo}
        />

        {tipo === 'evento' && !repetir && (
          <>
            <label style={rotuloEstilo}>Data final (evento de vários dias — opcional)</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={campoEstilo} />
          </>
        )}

        <label style={{ ...rotuloEstilo, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} /> Dia inteiro
        </label>

        {!diaInteiro && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={rotuloEstilo}>Hora início *</label>
              <input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} style={campoEstilo} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={rotuloEstilo}>Hora fim</label>
              <input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} style={campoEstilo} />
            </div>
          </div>
        )}

        {podeMudarRepeticao && (
          <label style={{ ...rotuloEstilo, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={repetir} onChange={(e) => setRepetir(e.target.checked)} /> Repetir
          </label>
        )}

        {repetir && podeMudarRepeticao && (
          <div style={{ backgroundColor: '#f9f9f9', padding: '12px', borderRadius: '5px', marginBottom: '15px' }}>
            <label style={rotuloEstilo}>Frequência</label>
            <select
              value={tipoRecorrencia}
              onChange={(e) => setTipoRecorrencia(e.target.value)}
              style={campoEstilo}
            >
              <option value="diaria">Diária</option>
              <option value="semanal">Semanal</option>
              <option value="mensal">Mensal</option>
              <option value="anual">Anual</option>
            </select>

            <label style={rotuloEstilo}>A cada</label>
            <input
              type="number"
              min="1"
              value={intervalo}
              onChange={(e) => setIntervalo(e.target.value)}
              style={campoEstilo}
            />

            {tipoRecorrencia === 'semanal' && (
              <>
                <label style={rotuloEstilo}>Dias da semana</label>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '15px', flexWrap: 'wrap' }}>
                  {DIAS_SEMANA_OPCOES.map((d) => (
                    <label
                      key={d.value}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid #ddd',
                        borderRadius: '5px',
                        fontSize: '12px',
                        backgroundColor: diasSemana.has(d.value) ? corPrimaria : 'white',
                        color: diasSemana.has(d.value) ? 'white' : '#333',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={diasSemana.has(d.value)}
                        onChange={() => alternarDiaSemana(d.value)}
                        style={{ display: 'none' }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </>
            )}

            <label style={rotuloEstilo}>Termina em (opcional)</label>
            <input
              type="date"
              value={dataFimSerie}
              onChange={(e) => setDataFimSerie(e.target.value)}
              style={{ ...campoEstilo, marginBottom: 0 }}
            />
          </div>
        )}

        {erro && <p style={{ color: '#f44336', marginTop: '5px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onCancelar}
            disabled={salvando}
            style={{ padding: '10px 20px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={salvando}
            style={{ padding: '10px 20px', backgroundColor: corPrimaria, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
