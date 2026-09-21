import { useState } from 'react';
import { PERMISSOES, hasPermissao, isAdmin } from '../../lib/auth/permissoes';
import IniciarProducaoForm from './IniciarProducaoForm';
import AdicionarProducaoForm from './AdicionarProducaoForm';
import FechamentoTurnoForm from './FechamentoTurnoForm';
import ReaberturaModal from './ReaberturaModal';
import GerenciarSobrasModal from './GerenciarSobrasModal';
import MarcadorFalta from './MarcadorFalta';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { cx } from '../../lib/design/cx';
import styles from './CardTurno.module.css';

// Resumo numérico do turno FECHADO: os mesmos 5 valores de antes, em grade
// responsiva (nenhum cálculo novo, nenhum campo novo). Só o branch
// status==='fechado' usa; aberto/reaberto mostram linhas simples.
function ResumoFechadoCompacto({ registro }) {
  const indicadores = [
    { label: 'Produzido', valor: registro.quantidade_produzida },
    { label: 'Vendido', valor: registro.quantidade_vendida },
    { label: 'Sobra total', valor: registro.sobra_total },
    { label: 'Aproveitável', valor: registro.sobra_aproveitavel },
    { label: 'Perda/descarte', valor: registro.perda_descarte },
  ];

  return (
    <dl className={styles.indicadores}>
      {indicadores.map((item) => (
        <div key={item.label} className={styles.indicador}>
          <dt>{item.label}</dt>
          <dd>{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

// Um cartão = um turno (manhã ou tarde) de um produto, para a data
// operacional atual. Suporta os 4 estados: sem registro, aberto, fechado,
// reaberto. Todas as ações (iniciar/adicionar/fechar/reabrir/corrigir)
// abrem um modal dedicado e, ao terminar com sucesso, chamam
// onAtualizado() para o componente pai recarregar os dados do banco — o
// card nunca guarda estado de negócio próprio além de qual modal está
// aberto.
export default function CardTurno({
  turno,
  label,
  registro,
  receitaId,
  receitaNome,
  data,
  corPrimaria,
  permissoes,
  perfilUsuario,
  onAtualizado,
}) {
  const [acaoAberta, setAcaoAberta] = useState(null); // 'iniciar' | 'adicionar' | 'fechar' | 'reabrir' | 'corrigir' | 'sobras' | null

  function fechar() {
    setAcaoAberta(null);
  }

  function concluido() {
    setAcaoAberta(null);
    onAtualizado();
  }

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

  const classeEstado = !registro ? styles.semRegistro : styles[registro.status];

  return (
    <article className={cx(styles.card, classeEstado)} aria-label={`${label} — ${receitaNome}`}>
      <div className={styles.topo}>
        <h3 className={styles.turno}>{label}</h3>
        {registro?.status === 'aberto' && <Badge tom="warning">Em produção</Badge>}
        {registro?.status === 'fechado' && <Badge tom="success">Fechado</Badge>}
        {registro?.status === 'reaberto' && <Badge tom="danger">Em correção</Badge>}
      </div>

      {!registro && (
        <>
          <p className={styles.vazio}>Nenhuma produção lançada</p>
          {podeInserir && (
            <div className={styles.acoes}>
              <Button onClick={() => setAcaoAberta('iniciar')}>Iniciar produção</Button>
            </div>
          )}
        </>
      )}

      {registro?.status === 'aberto' && (
        <>
          <div className={styles.quantidade}>
            <span className={styles.quantidadeRotulo}>Produzido</span>
            <strong className={styles.quantidadeValor}>{registro.quantidade_produzida}</strong>
          </div>
          <div className={styles.acoes}>
            {podeEditar && (
              <Button variante="secondary" onClick={() => setAcaoAberta('adicionar')}>
                + Adicionar produção
              </Button>
            )}
            {podeEditar && <Button onClick={() => setAcaoAberta('fechar')}>Fechar turno</Button>}
          </div>
        </>
      )}

      {registro?.status === 'fechado' && (
        <>
          <ResumoFechadoCompacto registro={registro} />
          <div className={styles.acoes}>
            {podeGerenciarSobras && (
              <Button variante="secondary" onClick={() => setAcaoAberta('sobras')}>
                Gerenciar sobras
              </Button>
            )}
            {podeReabrir && (
              <Button variante="ghost" onClick={() => setAcaoAberta('reabrir')}>
                Reabrir
              </Button>
            )}
          </div>
          <div className={styles.falta}>
            <MarcadorFalta registro={registro} podeEditar={podeEditar} onAtualizado={onAtualizado} />
            <span>Houve falta de produto</span>
          </div>
          {registro.observacoes && <p className={styles.observacoes}>{registro.observacoes}</p>}
        </>
      )}

      {registro?.status === 'reaberto' && (
        <>
          <Alert tom="danger">Em correção — os valores antigos foram preservados.</Alert>
          <div className={styles.linhaResumo}><span>Produzido (atual)</span><strong>{registro.quantidade_produzida}</strong></div>
          <div className={styles.linhaResumo}><span>Sobra aproveitável (atual)</span><strong>{registro.sobra_aproveitavel}</strong></div>
          <div className={styles.linhaResumo}><span>Perda/descarte (atual)</span><strong>{registro.perda_descarte}</strong></div>
          {podeEditar && (
            <div className={styles.acoes}>
              <Button onClick={() => setAcaoAberta('corrigir')}>Corrigir e fechar</Button>
            </div>
          )}
        </>
      )}

      {acaoAberta === 'iniciar' && (
        <IniciarProducaoForm
          data={data}
          turno={turno}
          receitaId={receitaId}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onCriado={concluido}
          onCancelar={fechar}
        />
      )}

      {acaoAberta === 'adicionar' && registro && (
        <AdicionarProducaoForm
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onAdicionado={concluido}
          onCancelar={fechar}
        />
      )}

      {(acaoAberta === 'fechar' || acaoAberta === 'corrigir') && registro && (
        <FechamentoTurnoForm
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onFechado={concluido}
          onCancelar={fechar}
        />
      )}

      {acaoAberta === 'reabrir' && registro && (
        <ReaberturaModal
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onReaberto={concluido}
          onCancelar={fechar}
        />
      )}

      {acaoAberta === 'sobras' && registro && (
        <GerenciarSobrasModal
          registro={registro}
          receitaNome={receitaNome}
          turnoLabel={label}
          corPrimaria={corPrimaria}
          onAtualizado={concluido}
          onCancelar={fechar}
        />
      )}
    </article>
  );
}
