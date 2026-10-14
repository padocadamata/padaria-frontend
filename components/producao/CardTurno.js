import { useState } from 'react';
import MarcadorFalta from './MarcadorFalta';
import { permissoesTurno, acoesDoTurno, ModalTurno } from './turnoProducao';
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
// aberto. Permissões, ações e modais vêm de ./turnoProducao (os mesmos da
// tabela do desktop, TabelaHoje).
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

  const perms = permissoesTurno({ registro, permissoes, perfilUsuario });
  const acoes = acoesDoTurno(registro, perms);
  const botoes =
    acoes.length > 0 ? (
      <div className={styles.acoes}>
        {acoes.map((a) => (
          <Button key={a.acao} variante={a.variante} onClick={() => setAcaoAberta(a.acao)}>
            {a.rotulo}
          </Button>
        ))}
      </div>
    ) : null;

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
          {botoes}
        </>
      )}

      {registro?.status === 'aberto' && (
        <>
          <div className={styles.quantidade}>
            <span className={styles.quantidadeRotulo}>Produzido</span>
            <strong className={styles.quantidadeValor}>{registro.quantidade_produzida}</strong>
          </div>
          {botoes}
        </>
      )}

      {registro?.status === 'fechado' && (
        <>
          <ResumoFechadoCompacto registro={registro} />
          {botoes}
          <div className={styles.falta}>
            <MarcadorFalta registro={registro} podeEditar={perms.podeEditar} onAtualizado={onAtualizado} />
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
          {botoes}
        </>
      )}

      <ModalTurno
        acaoAberta={acaoAberta}
        registro={registro}
        data={data}
        turno={turno}
        receitaId={receitaId}
        receitaNome={receitaNome}
        label={label}
        corPrimaria={corPrimaria}
        onConcluido={concluido}
        onFechar={fechar}
      />
    </article>
  );
}
