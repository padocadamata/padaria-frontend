import { useEffect, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';

// Categorias são dados mestres persistidos em MAIÚSCULAS (regra global
// do projeto) — chaves aqui espelham exatamente o que fica gravado em
// agenda_categorias.valor/agenda_itens.categoria.
const CORES_CATEGORIA = {
  ADMINISTRATIVO: '#607D8B',
  PRODUÇÃO: '#8B4513',
  COMPRAS: '#2196F3',
  FINANCEIRO: '#4CAF50',
  MANUTENÇÃO: '#FF9800',
  OUTROS: '#9E9E9E',
};

function somarUmDia(dataYYYYMMDD) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  data.setDate(data.getDate() + 1);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Wrapper client-only do FullCalendar (importado via next/dynamic com
// ssr:false em pages/agenda.js). Recebe só ocorrências JÁ expandidas e
// resolvidas (lib/agenda/expandirRecorrencia.js) — nunca a regra de
// recorrência: o plugin @fullcalendar/rrule NÃO é usado de propósito
// (decisão aprovada — recorrência é sempre controlada pela nossa
// modelagem/lógica, nunca pela lib de calendário).
export default function AgendaCalendario({ visao, ocorrencias, onMudarJanela, onClicarOcorrencia, onClicarData, onClicarCheckboxTarefa }) {
  const calendarioRef = useRef(null);

  const eventos = useMemo(
    () =>
      ocorrencias.map((oc) => {
        const cor = CORES_CATEGORIA[oc.item.categoria] || '#9E9E9E';
        const evento = {
          id: oc.idOcorrencia,
          title: oc.cancelada ? `${oc.titulo} (cancelado)` : oc.titulo,
          allDay: oc.diaInteiro,
          backgroundColor: oc.cancelada ? '#bbb' : cor,
          borderColor: oc.cancelada ? '#bbb' : cor,
          classNames: oc.concluida ? ['agenda-ocorrencia-concluida'] : [],
          // extendedProps (seção 12 da evolução aprovada) -- só o
          // essencial para o eventContent decidir se/como desenhar o
          // checkbox sem precisar reconstruir a ocorrência inteira ali.
          // A ocorrência completa (para abrir o modal) ainda é buscada
          // por idOcorrencia no array `ocorrencias`, mesma técnica já
          // usada em aoClicarEvento.
          extendedProps: {
            tipo: oc.item.tipo,
            concluida: oc.concluida,
            observacaoConclusao: oc.observacaoConclusao,
            recorrente: oc.item.tipo_recorrencia !== 'nenhuma',
            agendaItemId: oc.item.id,
            dataOcorrencia: oc.dataOcorrencia,
          },
        };

        if (oc.diaInteiro) {
          evento.start = oc.dataExibicao;
          if (oc.item.tipo === 'evento' && oc.item.data_fim) {
            // FullCalendar trata `end` de evento allDay como EXCLUSIVO.
            evento.end = somarUmDia(oc.item.data_fim);
          }
        } else {
          evento.start = `${oc.dataExibicao}T${oc.horaInicio}`;
          if (oc.horaFim) {
            evento.end = `${oc.dataExibicao}T${oc.horaFim}`;
          }
        }

        return evento;
      }),
    [ocorrencias]
  );

  // initialView só se aplica na montagem — troca de visão pelos botões
  // de NavegacaoAgenda.js precisa comandar a API do calendário
  // diretamente.
  useEffect(() => {
    const api = calendarioRef.current?.getApi();
    if (api && api.view.type !== visao) {
      api.changeView(visao);
    }
  }, [visao]);

  function aoClicarEvento(info) {
    const ocorrencia = ocorrencias.find((oc) => oc.idOcorrencia === info.event.id);
    if (ocorrencia) {
      onClicarOcorrencia(ocorrencia);
    }
  }

  // Checkbox só em tarefa (nunca evento), nas 3 views -- mesmo
  // eventContent vale para dayGrid/timeGrid (mês/semana/dia), sem
  // nenhuma implementação duplicada. stopPropagation + preventDefault no
  // clique impedem que o eventClick (abrir detalhes) também dispare --
  // o estado marcado/desmarcado é sempre controlado pelos dados vindos
  // do backend (nunca otimista), então preventDefault não deixa nenhuma
  // marcação visual "solta" antes da confirmação.
  function renderizarConteudoEvento(arg) {
    const { tipo, concluida } = arg.event.extendedProps;

    if (tipo !== 'tarefa') {
      return <div className="fc-event-title">{arg.event.title}</div>;
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', width: '100%' }}>
        <input
          type="checkbox"
          checked={concluida}
          readOnly
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const ocorrencia = ocorrencias.find((oc) => oc.idOcorrencia === arg.event.id);
            if (ocorrencia) onClicarCheckboxTarefa(ocorrencia);
          }}
          style={{ flexShrink: 0, cursor: 'pointer', margin: 0 }}
        />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: concluida ? 'line-through' : 'none',
            opacity: concluida ? 0.65 : 1,
          }}
        >
          {arg.event.title}
        </span>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .agenda-ocorrencia-concluida { opacity: 0.55; }
      `}</style>
      <FullCalendar
        ref={calendarioRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={visao}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        locale={ptBrLocale}
        height="auto"
        selectable
        events={eventos}
        eventContent={renderizarConteudoEvento}
        eventClick={aoClicarEvento}
        dateClick={(info) => onClicarData(info.dateStr)}
        select={(info) => onClicarData(info.startStr)}
        datesSet={(info) => onMudarJanela(info.startStr.slice(0, 10), info.endStr.slice(0, 10))}
      />
    </>
  );
}
