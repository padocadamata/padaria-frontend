import { useEffect, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { descricaoEvento, formatarData, formatarDataHora, mensagemErroPonto } from '../../lib/ponto/apresentacao';
import estilos from './ponto.module.css';

function resumoAtestado(d) {
  if (!d) return '';
  const periodo = d.data_inicio === d.data_fim ? formatarData(d.data_inicio) : `${formatarData(d.data_inicio)} a ${formatarData(d.data_fim)}`;
  const horario = d.hora_inicio ? ` ${d.hora_inicio}–${d.hora_fim}` : '';
  return `${periodo}${horario}${d.descricao ? ` — ${d.descricao}` : ''}`;
}

// Histórico (somente leitura) de um cartão ou de um atestado -- os eventos
// são imutáveis no banco (folha_ponto_eventos).
export default function HistoricoModal({ titulo, carregar, onFechar }) {
  const [eventos, setEventos] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    carregar()
      .then((lista) => { if (ativo) setEventos(lista); })
      .catch((e) => { if (ativo) setErro(mensagemErroPonto(e)); });
    return () => { ativo = false; };
  }, [carregar]);

  return (
    <Modal titulo={titulo} onFechar={onFechar} largura="md" fecharAoClicarFora>
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
      {!erro && eventos === null && <p role="status">Carregando…</p>}
      {eventos && eventos.length === 0 && <p className={estilos.aux}>Nenhum registro.</p>}
      {eventos && eventos.length > 0 && (
        <ol className={estilos.historico}>
          {eventos.map((e) => (
            <li key={e.id}>
              <strong>{descricaoEvento(e)}</strong>
              <div className={estilos.aux}>{formatarDataHora(e.criado_em)}{e.criado_por_nome ? ` · ${e.criado_por_nome}` : ''}</div>
              {e.motivo && <div>Motivo: {e.motivo}</div>}
              {e.dados?.antes && <div className={estilos.aux}>Antes: {resumoAtestado(e.dados.antes)}</div>}
              {e.dados?.depois && <div className={estilos.aux}>{e.dados.antes ? 'Depois' : 'Registrado'}: {resumoAtestado(e.dados.depois)}</div>}
            </li>
          ))}
        </ol>
      )}
      <div className={estilos.rodapeModal}>
        <Button variante="secondary" onClick={onFechar}>Fechar</Button>
      </div>
    </Modal>
  );
}
