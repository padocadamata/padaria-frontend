import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { mensagemErroSacos } from '../../lib/producao/mensagensSacos';
import { LIMITE_MOTIVO_AJUSTE, calcularAjusteEstoque, formatarComSinal } from '../../lib/producao/ajusteEstoque';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import estilos from './sacos.module.css';

// Ajuste de Estoque (migration 0074) -- único caminho é a RPC
// registrar_ajuste_sacos (SECURITY DEFINER). A pessoa informa o ESTOQUE
// FÍSICO correto; a diferença (física − saldo) aparece aqui só como prévia
// e é recalculada pelo banco sob lock. O saldo exibido vai junto
// (p_saldo_esperado_sacos): se mudou no meio-tempo, o banco recusa em vez
// de ajustar sobre um saldo que ninguém conferiu. operacaoId gerado UMA vez
// no mount -- retry da mesma submissão não grava um segundo ajuste.
function formatarNumero(valor) {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function sacos(n) {
  return `${formatarNumero(n)} ${Math.abs(n) === 1 ? 'saco' : 'sacos'}`;
}

export default function AjustarEstoqueModal({ configuracao, onSalvo, onCancelar }) {
  const [operacaoId] = useState(() => crypto.randomUUID());
  const [fisico, setFisico] = useState('');
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const { saldoSacos, pesoPorSacoKg } = configuracao;
  const previa = calcularAjusteEstoque(saldoSacos, fisico, pesoPorSacoKg);
  const motivoValido = motivo.trim() !== '';
  const podeConfirmar = previa.valido && motivoValido && !salvando;

  async function confirmar() {
    if (!previa.valido) {
      setErro(previa.erro || 'Informe o estoque físico correto.');
      return;
    }
    if (!motivoValido) {
      setErro('Informe o motivo do ajuste.');
      return;
    }

    setSalvando(true);
    setErro('');

    const { error } = await createClient().rpc('registrar_ajuste_sacos', {
      p_produto_fornecedor_id: configuracao.id,
      p_estoque_fisico_sacos: previa.fisico,
      p_saldo_esperado_sacos: saldoSacos,
      p_motivo: motivo.trim(),
      p_operacao_id: operacaoId,
      p_observacao: observacao.trim() || null,
    });

    setSalvando(false);

    if (error) {
      setErro(mensagemErroSacos(error));
      return;
    }

    onSalvo();
  }

  return (
    <Modal titulo="Ajustar estoque" onFechar={salvando ? undefined : onCancelar} largura="md">
      <dl className={estilos.dadosProduto}>
        <div>
          <dt>Produto</dt>
          <dd>{configuracao.produtoNome}</dd>
        </div>
        <div>
          <dt>Fornecedor</dt>
          <dd>{configuracao.fornecedorNome}</dd>
        </div>
        <div>
          <dt>Saldo atual no sistema</dt>
          <dd>
            <strong>{sacos(saldoSacos)}</strong> · {formatarNumero(saldoSacos * pesoPorSacoKg)} kg
            <span className={estilos.textoAux}> ({formatarNumero(pesoPorSacoKg)} kg/saco)</span>
          </dd>
        </div>
      </dl>

      <Field
        label="Estoque físico correto (sacos fechados) *"
        dica="Conte os sacos fechados e informe o total real. O sistema calcula o ajuste."
        erro={previa.fisico === undefined && previa.erro ? previa.erro : undefined}
      >
        <Input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          autoFocus
          value={fisico}
          onChange={(e) => setFisico(e.target.value)}
          disabled={salvando}
        />
      </Field>

      <Field label="Motivo do ajuste *" dica={`${motivo.length}/${LIMITE_MOTIVO_AJUSTE}`}>
        <Input
          type="text"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={LIMITE_MOTIVO_AJUSTE}
          placeholder="Ex.: correção de estoque — baixas lançadas por engano"
          disabled={salvando}
        />
      </Field>

      <Field label="Observação">
        <Textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional"
          rows={2}
          disabled={salvando}
        />
      </Field>

      {Number.isInteger(previa.fisico) && (
        <div className={estilos.resumoAjuste} aria-live="polite">
          <div className={estilos.resumoLinha}>
            <span>Saldo atual</span>
            <span>{sacos(saldoSacos)} · {formatarNumero(saldoSacos * pesoPorSacoKg)} kg</span>
          </div>
          <div className={estilos.resumoLinha}>
            <span>Estoque físico informado</span>
            <span>{sacos(previa.fisico)} · {formatarNumero(previa.novoSaldoKg)} kg</span>
          </div>
          <div className={estilos.resumoLinha}>
            <span>Ajuste</span>
            <strong className={previa.ajuste > 0 ? estilos.positivo : previa.ajuste < 0 ? estilos.negativo : undefined}>
              {formatarComSinal(previa.ajuste, (v) => sacos(v))} · {formatarComSinal(previa.ajusteKg, formatarNumero)} kg
            </strong>
          </div>
          <div className={estilos.resumoLinha}>
            <span>Novo saldo</span>
            <strong>{sacos(previa.novoSaldo)} · {formatarNumero(previa.novoSaldoKg)} kg</strong>
          </div>
          {previa.ajuste === 0 && <p className={estilos.textoAux}>{previa.erro}</p>}
        </div>
      )}

      <p className={estilos.textoAux}>
        O ajuste fica registrado no histórico como &quot;Ajuste de estoque&quot;, com seu usuário, data e motivo, e não
        pode ser editado nem excluído. Se precisar corrigir, registre um novo ajuste.
      </p>

      {erro && <Alert tom="danger">{erro}</Alert>}

      <div className={estilos.rodape}>
        <Button variante="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button onClick={confirmar} disabled={!podeConfirmar}>
          {salvando ? 'Registrando...' : 'Confirmar ajuste'}
        </Button>
      </div>
    </Modal>
  );
}
