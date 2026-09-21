import { useState } from 'react';
import FechamentoTurnoForm from './FechamentoTurnoForm';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import Button from '../ui/Button';
import Icon from '../ui/Icon';
import styles from './BannerPendencias.module.css';

const rotuloTurno = { manha: 'Manhã', tarde: 'Tarde' };

function formatarDataBR(data) {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Destaque de registros abertos/reabertos de dias anteriores — a única
// regra é status IN ('aberto','reaberto') AND data < hoje. Nunca usar
// data <> hoje, para não confundir "pendência antiga" com "ainda não
// mexi no turno de hoje".
export default function BannerPendencias({ pendencias, receitaNomePorId, corPrimaria, permissoes, onAtualizado }) {
  const [registroSelecionado, setRegistroSelecionado] = useState(null);

  if (!pendencias || pendencias.length === 0) {
    return null;
  }

  const podeEditar = hasPermissao(permissoes, PERMISSOES.PRODUCAO_EDITAR);

  return (
    <section className={styles.raiz} aria-label="Pendências de fechamento">
      <h2 className={styles.titulo}>
        <Icon nome="alert" tamanho={20} />
        {pendencias.length === 1 ? '1 pendência de fechamento' : `${pendencias.length} pendências de fechamento`}
      </h2>

      <ul className={styles.lista}>
        {pendencias.map((p) => (
          <li key={p.id} className={styles.item}>
            <span className={styles.descricao}>
              <strong>{formatarDataBR(p.data)}</strong> — {receitaNomePorId[p.receita_id] || p.receita_id} ({rotuloTurno[p.turno] || p.turno})
              {p.status === 'reaberto' && <em className={styles.correcao}>em correção</em>}
            </span>
            {podeEditar && (
              <Button tamanho="sm" onClick={() => setRegistroSelecionado(p)}>
                {p.status === 'reaberto' ? 'Corrigir e fechar' : 'Fechar agora'}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {registroSelecionado && (
        <FechamentoTurnoForm
          registro={registroSelecionado}
          receitaNome={receitaNomePorId[registroSelecionado.receita_id] || registroSelecionado.receita_id}
          turnoLabel={rotuloTurno[registroSelecionado.turno] || registroSelecionado.turno}
          corPrimaria={corPrimaria}
          onFechado={() => {
            setRegistroSelecionado(null);
            onAtualizado();
          }}
          onCancelar={() => setRegistroSelecionado(null)}
        />
      )}
    </section>
  );
}
