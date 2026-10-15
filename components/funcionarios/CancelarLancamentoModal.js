import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Textarea from '../ui/Textarea';
import { cancelarLancamento } from '../../lib/funcionarios/lancamentos';
import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import { rotuloNatureza } from '../../lib/funcionarios/lancamentosCalculo';
import estilosEscala from './escala.module.css';

// Cancelamento LÓGICO de um lançamento pendente (migration 0076): motivo
// obrigatório; o lançamento continua registrado (cancelado), nunca apagado.
export default function CancelarLancamentoModal({ lancamento, nomeFuncionaria, onFechar, onCancelado }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    setErro('');
    if (!motivo.trim()) {
      setErro('Informe o motivo do cancelamento.');
      return;
    }
    setSalvando(true);
    const { erro: erroRpc } = await cancelarLancamento(lancamento.id, motivo.trim());
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onCancelado();
  }

  return (
    <Modal titulo="Cancelar lançamento" onFechar={salvando ? undefined : onFechar} largura="sm">
      <div className={estilosEscala.modalCorpo}>
        <p>
          {rotuloNatureza(lancamento.natureza)} de {formatarMoeda(lancamento.valor)} ({lancamento.tipo_nome}){nomeFuncionaria ? ` — ${nomeFuncionaria}` : ''}. O lançamento deixa de estar pendente e não
          poderá mais entrar em pagamento.
        </p>
        <Field label="Motivo do cancelamento (obrigatório)">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
        </Field>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilosEscala.rodapePlanejamento}>
          <Button type="button" variante="secondary" onClick={onFechar} disabled={salvando}>
            Voltar
          </Button>
          <Button type="button" variante="danger" onClick={confirmar} disabled={salvando}>
            {salvando ? 'Cancelando...' : 'Cancelar lançamento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
