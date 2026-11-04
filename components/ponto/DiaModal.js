import { useMemo, useState } from 'react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import PeriodosCampos from './PeriodosCampos';
import { ROTULO_SITUACAO, SITUACOES_AJUSTE, atestadosDoDia } from '../../lib/ponto/apuracao';
import { LIMITES, colunasPrincipais, igualAoPrevisto, periodosDasColunas, validarItemDia } from '../../lib/ponto/lancamento';
import {
  formatarData, itemDoRascunho, rotuloAtestado, rotuloDia, seloSituacao, situacaoBaseDoDia, textoPendencias, textoPrevisto,
} from '../../lib/ponto/apresentacao';
import estilos from './ponto.module.css';

// Um dia do cartão: ajuste de situação (com motivo), observação e TODOS os
// períodos (a grade mostra só os 2 primeiros). Não grava: "Aplicar" devolve
// o rascunho e a gravação acontece no lote ("Salvar alterações"), com a
// versão do cartão. Validação = validarItemDia (mesma regra do banco).
export default function DiaModal({ diaBase, diaApurado, rascunho, base, editavel, podeLancarAtestado, onAplicar, onRegistrarAtestado, onFechar }) {
  const situacaoEscala = situacaoBaseDoDia(diaBase);
  const [situacao, setSituacao] = useState(rascunho.situacao ?? '');
  const [motivo, setMotivo] = useState(rascunho.motivo || '');
  const [observacao, setObservacao] = useState(rascunho.observacao || '');
  const [periodos, setPeriodos] = useState(() => periodosDasColunas(rascunho));
  const [erro, setErro] = useState('');
  const selo = seloSituacao(diaApurado);
  const atestadosDia = useMemo(
    () => (base.atestados || []).filter((a) => a.data_inicio <= diaBase.data && a.data_fim >= diaBase.data),
    [base.atestados, diaBase.data],
  );
  const integral = atestadosDoDia(base.atestados, diaBase.data).integral;
  const ajuste = situacao && situacao !== situacaoEscala;
  const situacaoFinal = ajuste ? situacao : situacaoEscala;

  function aplicar(evento) {
    evento.preventDefault();
    // Fora de dia de trabalho (ou com atestado integral) os horários saem.
    const preenchidos = editavel.horarios && situacaoFinal === 'trabalho' ? periodos.filter((p) => p.entrada || p.saida) : [];
    const novo = {
      situacao: ajuste ? situacao : null,
      motivo: ajuste ? motivo : '',
      observacao,
      ...colunasPrincipais(preenchidos.map((p) => ({ entrada: p.entrada || '', saida: p.saida || '' }))),
    };
    const r = validarItemDia(itemDoRascunho(diaBase.data, novo), {
      dia: diaBase, funcionario: base.funcionario, hoje: base.hoje, atestados: base.atestados || [],
    });
    if (r.erro) {
      setErro(r.erro.mensagem);
      return;
    }
    onAplicar(novo);
  }

  return (
    <Modal titulo={`${rotuloDia(diaApurado)} · ${formatarData(diaBase.data)}`} onFechar={onFechar} largura="md" fecharComEsc={false}>
      <form className={estilos.formulario} onSubmit={aplicar}>
        <div className={estilos.acoes}>
          <span><strong>Escala:</strong> {textoPrevisto(diaBase.escala)}</span>
          {diaApurado.feriado && <Badge tom="info">Feriado: {diaApurado.feriado}</Badge>}
          <Badge tom={selo.tom}>{selo.rotulo}</Badge>
          {selo.origem && <span className={estilos.aux}>{selo.origem}</span>}
        </div>
        {diaBase.escala?.observacao && <p className={estilos.aux}>Observação da Escala: {diaBase.escala.observacao}</p>}
        {diaApurado.pendencias.length > 0 && (
          <Alert tom="warning" className={estilos.mensagem}>
            <ul className={estilos.pendencias}>{textoPendencias(diaApurado).map((t) => <li key={t}>{t}</li>)}</ul>
          </Alert>
        )}

        {editavel.ajuste && (
          <div className={estilos.linhaCampos}>
            <Field label="Situação no cartão" dica="Atestado é registrado em “Registrar atestado”.">
              <Select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
                <option value="">Segue a Escala ({ROTULO_SITUACAO[situacaoEscala]})</option>
                {SITUACOES_AJUSTE.filter((s) => s !== situacaoEscala).map((s) => (
                  <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>
                ))}
              </Select>
            </Field>
            {ajuste && (
              <Field label="Motivo do ajuste" dica="Obrigatório. Fica no histórico.">
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={LIMITES.motivo} rows={2} />
              </Field>
            )}
          </div>
        )}

        {editavel.horarios && situacaoFinal === 'trabalho' ? (
          <>
            <div className={estilos.acoes}>
              <strong>Horários trabalhados</strong>
              {diaBase.escala?.tipo === 'trabalho' && (
                <Button variante="ghost" tamanho="sm" onClick={() => setPeriodos(igualAoPrevisto(diaBase.escala))}>Igual ao previsto</Button>
              )}
            </div>
            <PeriodosCampos periodos={periodos} onAlterar={setPeriodos} />
          </>
        ) : (
          <p className={estilos.aux}>
            {integral ? 'Dia coberto por atestado integral: sem horários. Para registrar trabalho, troque por atestado parcial.'
              : !editavel.ajuste ? 'Este dia não pode ser editado.'
                : `Horários só em dia de trabalho (situação: ${ROTULO_SITUACAO[situacaoFinal]}).`}
          </p>
        )}

        {editavel.ajuste && (
          <Field label="Observação (opcional)">
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={LIMITES.observacao} rows={2} />
          </Field>
        )}

        <div>
          <strong>Atestados neste dia</strong>
          {atestadosDia.length === 0 ? (
            <p className={estilos.aux}>Nenhum.</p>
          ) : (
            <ul className={estilos.lista}>{atestadosDia.map((a) => <li key={a.id} className={estilos.aux}>{rotuloAtestado(a)}{a.descricao ? ` — ${a.descricao}` : ''}</li>)}</ul>
          )}
          {podeLancarAtestado && !diaApurado.fora_vinculo && (
            <Button variante="ghost" tamanho="sm" icone="plus" onClick={() => onRegistrarAtestado(diaBase.data)}>Registrar atestado neste dia</Button>
          )}
        </div>

        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar}>{editavel.ajuste ? 'Cancelar' : 'Fechar'}</Button>
          {editavel.ajuste && <Button type="submit">Aplicar</Button>}
        </div>
        {editavel.ajuste && <p className={estilos.aux}>“Aplicar” leva a mudança para a grade; ela é gravada em “Salvar alterações”.</p>}
      </form>
    </Modal>
  );
}
