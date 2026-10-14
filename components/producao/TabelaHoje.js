import { Fragment, useState } from 'react';
import MarcadorFalta from './MarcadorFalta';
import { permissoesTurno, acoesDoTurno, ModalTurno } from './turnoProducao';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { cx } from '../../lib/design/cx';
import styles from './TabelaHoje.module.css';

// Tela Hoje no DESKTOP: uma linha por produto, Manhã e Tarde lado a lado
// (Situação | Quantidades | Ações de cada turno). Só apresentação -- as
// permissões, as ações, os modais e os callbacks são EXATAMENTE os do
// cartão (./turnoProducao, também usado por CardTurno). Nenhum campo é
// editado na tabela: toda operação continua abrindo o modal de sempre.
export default function TabelaHoje({ blocos, turnos, registroDoBloco, data, corPrimaria, permissoes, perfilUsuario, onAtualizado }) {
  return (
    <div className={styles.envolucro}>
      <table className={styles.tabela} aria-label="Produção de hoje por produto e turno">
        <colgroup>
          <col className={styles.colProduto} />
          {turnos.map((t) => (
            <Fragment key={t.chave}>
              <col className={styles.colSituacao} />
              <col className={styles.colQuantidades} />
              <col className={styles.colAcoes} />
            </Fragment>
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className={styles.thProduto}>
              Produto
            </th>
            {turnos.map((t) => (
              <th key={t.chave} scope="colgroup" colSpan={3} className={styles.thTurno}>
                {t.label}
              </th>
            ))}
          </tr>
          <tr>
            {turnos.map((t) => (
              <Fragment key={t.chave}>
                <th scope="col" className={styles.inicioTurno}>Situação</th>
                <th scope="col">Quantidades</th>
                <th scope="col">Ações</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocos.map((bloco) => (
            <tr key={bloco.receitaId}>
              <th scope="row" className={styles.produto}>
                {bloco.receitaNome}
              </th>
              {turnos.map((t) => (
                <CelulasTurno
                  key={t.chave}
                  turno={t.chave}
                  label={t.label}
                  registro={registroDoBloco(bloco.receitaId, t.chave)}
                  receitaId={bloco.receitaId}
                  receitaNome={bloco.receitaNome}
                  data={data}
                  corPrimaria={corPrimaria}
                  permissoes={permissoes}
                  perfilUsuario={perfilUsuario}
                  onAtualizado={onAtualizado}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SITUACAO = {
  aberto: { tom: 'warning', rotulo: 'Em produção' },
  fechado: { tom: 'success', rotulo: 'Fechado' },
  reaberto: { tom: 'danger', rotulo: 'Em correção' },
};

// Os mesmos valores que o cartão mostra em cada estado (nenhum novo).
// `curto` = rótulo da tabela (coluna estreita); o completo vai no tooltip.
function quantidadesDoTurno(registro) {
  if (!registro) return [];
  if (registro.status === 'aberto') return [{ rotulo: 'Produzido', curto: 'Produz.', valor: registro.quantidade_produzida }];
  if (registro.status === 'fechado') {
    return [
      { rotulo: 'Produzido', curto: 'Produz.', valor: registro.quantidade_produzida },
      { rotulo: 'Vendido', curto: 'Vendido', valor: registro.quantidade_vendida },
      { rotulo: 'Sobra total', curto: 'Sobra', valor: registro.sobra_total },
      { rotulo: 'Aproveitável', curto: 'Aproveit.', valor: registro.sobra_aproveitavel },
      { rotulo: 'Perda/descarte', curto: 'Perda', valor: registro.perda_descarte },
    ];
  }
  if (registro.status === 'reaberto') {
    return [
      { rotulo: 'Produzido (atual)', curto: 'Produz.', valor: registro.quantidade_produzida },
      { rotulo: 'Sobra aproveitável (atual)', curto: 'Aproveit.', valor: registro.sobra_aproveitavel },
      { rotulo: 'Perda/descarte (atual)', curto: 'Perda', valor: registro.perda_descarte },
    ];
  }
  return [];
}

// As 3 células de um turno. Cada turno guarda só qual modal está aberto
// (como o cartão); o modal fica dentro da célula de ações (overlay fixo).
function CelulasTurno({ turno, label, registro, receitaId, receitaNome, data, corPrimaria, permissoes, perfilUsuario, onAtualizado }) {
  const [acaoAberta, setAcaoAberta] = useState(null);
  const perms = permissoesTurno({ registro, permissoes, perfilUsuario });
  const acoes = acoesDoTurno(registro, perms);
  const situacao = registro ? SITUACAO[registro.status] : null;
  const quantidades = quantidadesDoTurno(registro);

  function fechar() {
    setAcaoAberta(null);
  }

  function concluido() {
    setAcaoAberta(null);
    onAtualizado();
  }

  return (
    <>
      <td className={cx(styles.inicioTurno, !registro && styles.semRegistro)}>
        {situacao ? <Badge tom={situacao.tom}>{situacao.rotulo}</Badge> : <span className={styles.vazio}>Nenhuma produção lançada</span>}
        {registro?.status === 'reaberto' && <p className={styles.nota}>Valores antigos preservados; quantidades atuais ao lado.</p>}
        {registro?.status === 'fechado' && (
          <div className={styles.falta}>
            <MarcadorFalta registro={registro} podeEditar={perms.podeEditar} onAtualizado={onAtualizado} />
            <span>Houve falta</span>
          </div>
        )}
        {registro?.status === 'fechado' && registro.observacoes && (
          <p className={styles.observacoes} title={registro.observacoes}>
            {registro.observacoes}
          </p>
        )}
      </td>
      <td>
        {quantidades.length === 0 ? (
          <span className={styles.vazio}>—</span>
        ) : (
          <dl className={styles.quantidades}>
            {quantidades.map((q) => (
              <div key={q.rotulo} className={styles.quantidade}>
                <dt title={q.rotulo}>{q.curto}</dt>
                <dd>{q.valor ?? '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </td>
      <td>
        {acoes.length > 0 && (
          <div className={styles.acoes}>
            {acoes.map((a) => (
              <Button
                key={a.acao}
                tamanho="sm"
                variante={a.variante}
                onClick={() => setAcaoAberta(a.acao)}
                aria-label={`${a.rotulo.replace(/^\+ /, '')} — ${receitaNome}, ${label}`}
              >
                {a.rotulo}
              </Button>
            ))}
          </div>
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
      </td>
    </>
  );
}
