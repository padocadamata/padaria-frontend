import { useMemo, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { ROTULO_ATESTADO, TIPOS_ATESTADO } from '../../lib/ponto/apuracao';
import { LIMITES, alertaAtestado, validarAtestado } from '../../lib/ponto/lancamento';
import { formatarData, horas, impactoDoAtestado, mensagemErroPonto, rotuloCompetencia } from '../../lib/ponto/apresentacao';
import { salvarAtestado } from '../../lib/ponto/consultas';
import estilos from './ponto.module.css';

// Registrar / alterar um atestado (integral de um ou vários dias, inclusive
// futuros e atravessando competências; ou parcial num dia). Um único
// registro cobre todos os dias. Validação = validarAtestado (mesma regra do
// banco); o banco ainda confere vínculo, cartão fechado e trabalho no dia.
// Prévia do impacto só no navegador (apuração do mês aberto na tela).
export default function AtestadoModal({ base, funcionarioId, existente = null, dataInicial, outros, onSalvo, onFechar }) {
  const [form, setForm] = useState(() => ({
    tipo: existente?.tipo || 'atestado_medico',
    abrangencia: existente?.abrangencia || 'integral',
    data_inicio: String(existente?.data_inicio || dataInicial || '').slice(0, 10),
    data_fim: String(existente?.data_fim || dataInicial || '').slice(0, 10),
    hora_inicio: existente?.hora_inicio ? String(existente.hora_inicio).slice(0, 5) : '',
    hora_fim: existente?.hora_fim ? String(existente.hora_fim).slice(0, 5) : '',
    descricao: existente?.descricao || '',
  }));
  const [confirmouDatas, setConfirmouDatas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const definir = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const entrada = useMemo(() => ({
    id: existente?.id || null,
    ...form,
    data_fim: form.abrangencia === 'parcial' ? form.data_inicio : form.data_fim,
  }), [form, existente]);
  const validacao = useMemo(() => validarAtestado(entrada, { outros: outros || [] }), [entrada, outros]);
  const alerta = validacao.atestado ? alertaAtestado(validacao.atestado, { hoje: base.hoje }) : null;
  const impacto = useMemo(
    () => (validacao.atestado ? impactoDoAtestado(base, validacao.atestado, existente?.id || null) : null),
    [base, validacao, existente],
  );
  const foraDoMes = validacao.atestado
    && (validacao.atestado.data_inicio < base.competencia || validacao.atestado.data_fim > base.dias[base.dias.length - 1].data);

  const comTrabalho = impacto?.diasComTrabalho || [];

  async function salvar(evento) {
    evento.preventDefault();
    if (comTrabalho.length > 0) {
      setErro('Há horários trabalhados no período: use atestado parcial nesses dias.');
      return;
    }
    if (validacao.erro) {
      setErro(validacao.erro.mensagem);
      return;
    }
    if (alerta && !confirmouDatas) {
      setErro('Confirme as datas antes de salvar.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await salvarAtestado({ id: existente?.id || null, versao: existente?.versao ?? null, funcionarioId, atestado: validacao.atestado });
      await onSalvo();
    } catch (e) {
      setErro(mensagemErroPonto(e));
      setSalvando(false);
    }
  }

  const mudancasDoMes = impacto?.mudancas || [];
  return (
    <Modal titulo={existente ? 'Alterar atestado' : 'Registrar atestado'} onFechar={salvando ? () => {} : onFechar} largura="md" fecharComEsc={false}>
      <form className={estilos.formulario} onSubmit={salvar}>
        <div className={estilos.linhaCampos}>
          <Field label="Tipo">
            <Select value={form.tipo} onChange={(e) => definir('tipo', e.target.value)}>
              {TIPOS_ATESTADO.map((t) => <option key={t} value={t}>{ROTULO_ATESTADO[t]}</option>)}
            </Select>
          </Field>
          <Field label="Abrangência">
            <Select value={form.abrangencia} onChange={(e) => definir('abrangencia', e.target.value)}>
              <option value="integral">Dia inteiro (um ou vários dias)</option>
              <option value="parcial">Parte do dia (horário)</option>
            </Select>
          </Field>
        </div>

        {form.abrangencia === 'integral' ? (
          <div className={estilos.linhaCampos}>
            <Field label="Primeiro dia">
              <Input type="date" value={form.data_inicio} onChange={(e) => definir('data_inicio', e.target.value)} />
            </Field>
            <Field label="Último dia" dica="Pode ser uma data futura e atravessar meses.">
              <Input type="date" value={form.data_fim} min={form.data_inicio || undefined} onChange={(e) => definir('data_fim', e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className={estilos.linhaCampos}>
            <Field label="Dia">
              <Input type="date" value={form.data_inicio} onChange={(e) => definir('data_inicio', e.target.value)} />
            </Field>
            <Field label="Início">
              <Input type="time" step="60" value={form.hora_inicio} onChange={(e) => definir('hora_inicio', e.target.value)} />
            </Field>
            <Field label="Fim">
              <Input type="time" step="60" value={form.hora_fim} onChange={(e) => definir('hora_fim', e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Descrição (opcional)" dica="Observação administrativa (ex.: entregue em 10/11). Não informe CID nem diagnóstico.">
          <Textarea value={form.descricao} onChange={(e) => definir('descricao', e.target.value)} maxLength={LIMITES.observacao} rows={2} />
        </Field>

        {validacao.erro && (form.data_inicio || form.data_fim) && <Alert tom="warning" className={estilos.mensagem}>{validacao.erro.mensagem}</Alert>}

        {alerta && (
          <Alert tom="warning" className={estilos.mensagem}>
            <div className={estilos.formulario}>
              <span>{alerta.mensagem}</span>
              <Checkbox rotulo="Conferi as datas e quero salvar assim." checked={confirmouDatas} onChange={(e) => setConfirmouDatas(e.target.checked)} />
            </div>
          </Alert>
        )}

        {comTrabalho.length > 0 && (
          <Alert tom="danger" className={estilos.mensagem}>
            Há horários trabalhados em {comTrabalho.map(formatarData).join(', ')}. Atestado de dia inteiro não pode cobrir dia trabalhado:
            ajuste o período ou registre um atestado parcial (com horário) nesses dias.
          </Alert>
        )}

        {impacto && (
          <div className={estilos.impacto} aria-live="polite">
            <strong>Efeito em {rotuloCompetencia(base.competencia)}</strong>
            {mudancasDoMes.length === 0 ? (
              <p className={estilos.mensagem}>Nenhum dia deste mês muda.</p>
            ) : (
              <ul>
                {mudancasDoMes.slice(0, 12).map((m) => (
                  <li key={m.data}>
                    {formatarData(m.data)}: {m.de === m.para ? m.de : `${m.de} → ${m.para}`}
                    {m.atestado_depois !== m.atestado_antes && m.atestado_depois !== null ? ` · atestado ${horas(m.atestado_depois)}` : ''}
                    {m.falta_coberta ? ' · falta justificada' : ''}
                    {m.futuro ? ' · dia futuro' : ''}
                  </li>
                ))}
                {mudancasDoMes.length > 12 && <li>…e mais {mudancasDoMes.length - 12} dia(s).</li>}
              </ul>
            )}
            <p className={estilos.mensagem}>
              Faltas: {impacto.totais.faltas_antes} → {impacto.totais.faltas_depois} · Atestado: {horas(impacto.totais.atestado_antes)} → {horas(impacto.totais.atestado_depois)} · Faltante: {horas(impacto.totais.faltante_antes)} → {horas(impacto.totais.faltante_depois)}
            </p>
            {foraDoMes && <p className={estilos.mensagem}>O atestado também cobre dias de outras competências (o mesmo registro vale para todas).</p>}
            <p className={estilos.mensagem}>Folga coberta continua folga; a Escala nunca é alterada.</p>
          </div>
        )}

        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando || Boolean(validacao.erro) || (alerta && !confirmouDatas) || comTrabalho.length > 0}>
            {salvando ? 'Salvando…' : existente ? 'Salvar alteração' : 'Registrar atestado'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
