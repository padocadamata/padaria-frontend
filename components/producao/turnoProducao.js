import { PERMISSOES, hasPermissao, isAdmin } from '../../lib/auth/permissoes';
import IniciarProducaoForm from './IniciarProducaoForm';
import AdicionarProducaoForm from './AdicionarProducaoForm';
import FechamentoTurnoForm from './FechamentoTurnoForm';
import ReaberturaModal from './ReaberturaModal';
import GerenciarSobrasModal from './GerenciarSobrasModal';

// Regras de UM turno (manhã/tarde) de um produto na Tela Hoje, usadas pelas
// DUAS apresentações -- o cartão (celular/tablet, CardTurno) e a linha da
// tabela (desktop, TabelaHoje): mesmas permissões, mesmas ações, mesmos
// modais e os mesmos callbacks. Nenhuma das duas escreve no banco: quem
// grava são os modais (as mesmas RPCs/consultas de sempre).

// Permissões de tela do turno (a RLS/RPC continuam sendo a proteção real).
export function permissoesTurno({ registro, permissoes, perfilUsuario }) {
  const podeInserir = hasPermissao(permissoes, PERMISSOES.PRODUCAO_INSERIR);
  const podeEditar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EDITAR);
  const podeReabrir = registro
    ? registro.origem === 'historico'
      ? isAdmin(perfilUsuario)
      : hasPermissao(permissoes, PERMISSOES.PRODUCAO_CANCELAR)
    : false;
  // Gerenciar sobras: mesma distinção manual/histórico da reabertura, mas
  // usando producao.editar (não producao.cancelar) para manual — é uma
  // ação operacional (destinar sobra), não uma correção estrutural
  // sensível. Continua exigindo admin para histórico (RPC + trigger
  // 0015 reforçam isso no backend, independente deste cálculo de UI).
  const podeGerenciarSobras = registro
    ? registro.origem === 'historico'
      ? isAdmin(perfilUsuario)
      : podeEditar
    : false;
  return { podeInserir, podeEditar, podeReabrir, podeGerenciarSobras };
}

// Ações disponíveis para o estado atual do turno, na ordem de exibição.
// `acao` = qual modal abre (o mesmo valor de acaoAberta de sempre).
export function acoesDoTurno(registro, { podeInserir, podeEditar, podeReabrir, podeGerenciarSobras }) {
  if (!registro) {
    return podeInserir ? [{ acao: 'iniciar', rotulo: 'Iniciar produção', variante: 'primary' }] : [];
  }
  if (registro.status === 'aberto') {
    return [
      podeEditar && { acao: 'adicionar', rotulo: '+ Adicionar produção', variante: 'secondary' },
      podeEditar && { acao: 'fechar', rotulo: 'Fechar turno', variante: 'primary' },
    ].filter(Boolean);
  }
  if (registro.status === 'fechado') {
    return [
      podeGerenciarSobras && { acao: 'sobras', rotulo: 'Gerenciar sobras', variante: 'secondary' },
      podeReabrir && { acao: 'reabrir', rotulo: 'Reabrir', variante: 'ghost' },
    ].filter(Boolean);
  }
  if (registro.status === 'reaberto') {
    return podeEditar ? [{ acao: 'corrigir', rotulo: 'Corrigir e fechar', variante: 'primary' }] : [];
  }
  return [];
}

// Modal da ação aberta (ou nada). Exatamente os mesmos componentes e props
// que o cartão sempre usou.
export function ModalTurno({ acaoAberta, registro, data, turno, receitaId, receitaNome, label, corPrimaria, onConcluido, onFechar }) {
  if (acaoAberta === 'iniciar') {
    return (
      <IniciarProducaoForm
        data={data}
        turno={turno}
        receitaId={receitaId}
        receitaNome={receitaNome}
        turnoLabel={label}
        corPrimaria={corPrimaria}
        onCriado={onConcluido}
        onCancelar={onFechar}
      />
    );
  }
  if (!registro) return null;
  if (acaoAberta === 'adicionar') {
    return (
      <AdicionarProducaoForm
        registro={registro}
        receitaNome={receitaNome}
        turnoLabel={label}
        corPrimaria={corPrimaria}
        onAdicionado={onConcluido}
        onCancelar={onFechar}
      />
    );
  }
  if (acaoAberta === 'fechar' || acaoAberta === 'corrigir') {
    return (
      <FechamentoTurnoForm
        registro={registro}
        receitaNome={receitaNome}
        turnoLabel={label}
        corPrimaria={corPrimaria}
        onFechado={onConcluido}
        onCancelar={onFechar}
      />
    );
  }
  if (acaoAberta === 'reabrir') {
    return (
      <ReaberturaModal
        registro={registro}
        receitaNome={receitaNome}
        turnoLabel={label}
        corPrimaria={corPrimaria}
        onReaberto={onConcluido}
        onCancelar={onFechar}
      />
    );
  }
  if (acaoAberta === 'sobras') {
    return (
      <GerenciarSobrasModal
        registro={registro}
        receitaNome={receitaNome}
        turnoLabel={label}
        corPrimaria={corPrimaria}
        onAtualizado={onConcluido}
        onCancelar={onFechar}
      />
    );
  }
  return null;
}
