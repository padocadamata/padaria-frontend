import Badge from '../ui/Badge';
import Input from '../ui/Input';
import { formatarDataCurta, formatarHora } from '../../lib/funcionarios/escala';
import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import { chaveJornada, resolverValorAPagar } from '../../lib/funcionarios/pagamentosCalculo';
import estilosPagamentos from './pagamentos.module.css';

// Conferência, nos modais de confirmação, das jornadas/extras selecionados:
// valor calculado x valor a pagar, com observação OPCIONAL só nas linhas
// ajustadas manualmente (migration 0068).
export default function ItensComAjuste({ itens, digitados, observacoes, onObservacao, prefixo = '', historico = false }) {
  return (
    <ul className={estilosPagamentos.listaJornadas}>
      {itens.map((item) => {
        const chave = chaveJornada(item);
        const r = resolverValorAPagar(item.valor ?? null, digitados[chave]);
        const temCalculo = item.valor !== null && item.valor !== undefined;
        return (
          <li key={chave} className={estilosPagamentos.itemConferencia}>
            <span>
              {prefixo}
              {formatarDataCurta(item.data)} {formatarHora(item.hora_inicio)}–{formatarHora(item.hora_fim)} ({item.duracao_minutos}min) — calculado{' '}
              {temCalculo ? formatarMoeda(item.valor) : 'não disponível'} · <strong>a pagar {r.valor === null ? '—' : formatarMoeda(r.valor)}</strong>{' '}
              {historico ? <Badge tom="warning">regularização histórica</Badge> : r.manual && <Badge tom="info">ajustado</Badge>}
            </span>
            {r.manual && (
              <Input
                placeholder="Observação do ajuste (opcional)"
                aria-label={`Observação do ajuste de ${formatarDataCurta(item.data)}`}
                value={observacoes[chave] || ''}
                onChange={(e) => onObservacao({ ...observacoes, [chave]: e.target.value })}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
