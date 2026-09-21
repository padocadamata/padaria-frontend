import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { registrarAuditoria } from '../../lib/audit/registrarAuditoria';
import { cx } from '../../lib/design/cx';
import styles from './MarcadorFalta.module.css';

// Marcador compacto de "houve falta de produto" (migration 0031,
// producao_registros.houve_falta), reutilizado por Hoje (CardTurno) e
// Histórico (historico.js) — mesmo comportamento nos dois lugares, sem
// duplicar lógica. Clique direto alterna true/false via UPDATE direto em
// producao_registros (mesma arquitetura já usada por
// FechamentoTurnoForm.js para fechar turno) — sem modal, sem RPC nova: a
// policy producao_registros_update (has_permissao('producao.editar')) já
// cobre esta coluna, e a trigger producao_registros_protecao não bloqueia
// houve_falta em nenhum status (não é campo de lançamento estrutural,
// mesmo tratamento de observacoes).
//
// Nunca mostra um valor que o banco não confirmou: enquanto salva, o
// próprio marcador fica desabilitado/esmaecido, e só reflete o novo
// estado depois que o UPDATE responde com sucesso e o chamador recarrega
// os dados via onAtualizado(). Se o UPDATE falhar, nada muda visualmente
// (o valor exibido continua sendo o de `registro`, nunca diverge do
// banco) e uma mensagem curta aparece ao lado.
//
// Antes do fechamento do lançamento (quantidade_vendida ainda null) o
// marcador fica desabilitado — marcar falta não faz sentido sem uma venda
// real para servir de base ao +25.
export default function MarcadorFalta({ registro, podeEditar, onAtualizado }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const houveFalta = !!registro.houve_falta;
  const vendaConhecida = registro.quantidade_vendida != null;
  const habilitado = podeEditar && vendaConhecida && !salvando;

  async function alternar() {
    if (!habilitado) {
      return;
    }

    setSalvando(true);
    setErro('');

    const novoValor = !houveFalta;
    const supabase = createClient();
    const { error } = await supabase
      .from('producao_registros')
      .update({ houve_falta: novoValor, atualizado_em: new Date().toISOString() })
      .eq('id', registro.id);

    if (error) {
      console.error('Erro ao marcar/desmarcar falta de produto:', error);
      setSalvando(false);
      setErro('Não foi possível salvar. Tente novamente.');
      return;
    }

    // Auditoria best-effort (mesmo padrão de FechamentoTurnoForm.js): se
    // falhar, a marcação já feita não é desfeita.
    registrarAuditoria({
      entidade: 'producao',
      registroId: registro.id,
      acao: novoValor ? 'marcou_falta' : 'desmarcou_falta',
      campo: 'houve_falta',
      valorAnterior: String(houveFalta),
      valorNovo: String(novoValor),
    });

    setSalvando(false);
    onAtualizado();
  }

  let titulo;
  if (!vendaConhecida) {
    titulo = 'Disponível após o fechamento do lançamento (venda ainda não registrada).';
  } else if (houveFalta) {
    titulo =
      'Houve falta — planejamento considera +25 unidades sobre a venda real deste lançamento. Clique para desmarcar.';
  } else {
    titulo =
      'Marcar houve falta de produto — planejamento considera +25 unidades sobre a venda real deste lançamento.';
  }

  return (
    <span className={styles.raiz}>
      <button
        type="button"
        onClick={alternar}
        disabled={!habilitado}
        title={titulo}
        aria-label="Houve falta de produto"
        aria-pressed={houveFalta}
        className={cx(
          styles.botao,
          houveFalta && styles.ativo,
          podeEditar && vendaConhecida && styles.pode,
          !vendaConhecida ? styles.bloqueado : salvando && styles.salvando
        )}
      >
        {houveFalta ? '⚠' : ''}
      </button>
      {erro && <span className={styles.erro}>{erro}</span>}
    </span>
  );
}
