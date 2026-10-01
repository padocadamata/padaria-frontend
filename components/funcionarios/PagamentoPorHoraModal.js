import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import EditorDescontos from './EditorDescontos';
import { formatarDataCurta, formatarHora } from '../../lib/funcionarios/escala';
import { formatarMoeda, criarPagamentoPorHora } from '../../lib/funcionarios/pagamentos';
import { normalizarDescontos, resumirValores, somarValores, chaveJornada } from '../../lib/funcionarios/pagamentosCalculo';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

// Confirma atomicamente 1 pagamento natureza=por_hora (migration 0066) --
// não existe rascunho persistido; este modal só monta o payload e a RPC
// folha_criar_pagamento_por_hora grava cabeçalho + jornadas + descontos
// numa única transação, recalculando tudo no banco.
export default function PagamentoPorHoraModal({ funcionario, jornadas, onFechar, onConfirmado }) {
  const [descontos, setDescontos] = useState([]);
  const [dataEfetiva, setDataEfetiva] = useState(dataLocalHoje());
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const { payload: descontosPayload, erros: errosDescontos } = normalizarDescontos(descontos);
  const valores = resumirValores(somarValores(jornadas), descontosPayload);

  async function confirmar() {
    setErro('');
    if (jornadas.length === 0) {
      setErro('Selecione ao menos 1 jornada.');
      return;
    }
    if (errosDescontos.length > 0) {
      setErro(errosDescontos.join(' '));
      return;
    }
    if (!dataEfetiva) {
      setErro('Informe a data efetiva do pagamento.');
      return;
    }
    if (valores.liquido < 0) {
      setErro('Os descontos ultrapassam o valor bruto do pagamento.');
      return;
    }

    setSalvando(true);
    const { id, erro: erroRpc } = await criarPagamentoPorHora({
      funcionarioId: funcionario.id,
      jornadas: jornadas.map((j) => ({ data: j.data, hora_inicio: j.hora_inicio, hora_fim: j.hora_fim })),
      descontos: descontosPayload,
      dataEfetiva,
      observacao,
    });
    setSalvando(false);

    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onConfirmado(id);
  }

  return (
    <Modal titulo={`Pagamento por hora — ${funcionario.nome}`} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        <ul className={estilosPagamentos.listaJornadas}>
          {jornadas.map((j) => (
            <li key={chaveJornada(j)}>
              {formatarDataCurta(j.data)} {formatarHora(j.hora_inicio)}–{formatarHora(j.hora_fim)} ({j.duracao_minutos}min × {formatarMoeda(j.valor_hora_aplicado)}/h) — {formatarMoeda(j.valor)}
            </li>
          ))}
        </ul>

        <div className={estilosPagamentos.resumoLinha}>
          <strong>Bruto</strong>
          <strong>{formatarMoeda(valores.bruto)}</strong>
        </div>

        <h4>Descontos</h4>
        <EditorDescontos descontos={descontos} onAlterar={setDescontos} />

        <div className={estilosPagamentos.resumoLinha}>
          <span>Descontos</span>
          <span>-{formatarMoeda(valores.descontos)}</span>
        </div>
        <div className={estilosPagamentos.resumoLinha}>
          <strong>Líquido</strong>
          <strong>{formatarMoeda(valores.liquido)}</strong>
        </div>

        <Field label="Data efetiva do pagamento">
          <Input type="date" value={dataEfetiva} onChange={(e) => setDataEfetiva(e.target.value)} />
        </Field>
        <Field label="Observação (opcional)">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        </Field>

        {erro && <Alert tom="danger">{erro}</Alert>}

        <div className={estilosEscala.rodapePlanejamento}>
          <Button type="button" variante="secondary" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirmar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Confirmar pagamento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
