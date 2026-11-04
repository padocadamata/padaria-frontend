import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Checkbox from '../ui/Checkbox';
import { formatarDataHora, rotuloAtestado } from '../../lib/ponto/apresentacao';
import { cx } from '../../lib/design/cx';
import estilos from './ponto.module.css';

// Atestados da funcionária (documentos próprios, um registro por atestado,
// de qualquer competência). Ações só com folha_ponto.lancar; o banco recusa
// o que atinge competência fechada (só a ponta aberta muda).
export default function AtestadosPainel({ atestados, carregando, erro, mostrarCancelados, onMostrarCancelados, podeLancar, onRegistrar, onEditar, onCancelar, onHistorico }) {
  return (
    <Card
      titulo="Atestados"
      subtitulo="Um registro cobre todos os dias do período, em qualquer competência."
      acao={podeLancar && <Button tamanho="sm" icone="plus" onClick={onRegistrar}>Registrar atestado</Button>}
    >
      <div className={estilos.formulario}>
        <Checkbox rotulo="Mostrar cancelados" checked={mostrarCancelados} onChange={(e) => onMostrarCancelados(e.target.checked)} />
        {erro && <p className={estilos.erroLinha}>{erro}</p>}
        {carregando && <p role="status" className={estilos.aux}>Carregando…</p>}
        {!carregando && !erro && atestados.length === 0 && <p className={estilos.aux}>Nenhum atestado registrado.</p>}
        {atestados.length > 0 && (
          <ul className={estilos.lista}>
            {atestados.map((a) => {
              const cancelado = a.status === 'cancelado';
              return (
                <li key={a.id} className={cx(estilos.itemLista, cancelado && estilos.itemCancelado)}>
                  <div className={estilos.itemTexto}>
                    <span>
                      <strong>{rotuloAtestado(a)}</strong> {cancelado && <Badge tom="neutral">Cancelado</Badge>}
                    </span>
                    {a.descricao && <span>{a.descricao}</span>}
                    <span className={estilos.aux}>
                      Registrado {formatarDataHora(a.criado_em)}{a.criado_por_nome ? ` por ${a.criado_por_nome}` : ''}
                      {a.atualizado_em ? ` · alterado ${formatarDataHora(a.atualizado_em)}${a.atualizado_por_nome ? ` por ${a.atualizado_por_nome}` : ''}` : ''}
                      {cancelado ? ` · cancelado ${formatarDataHora(a.cancelado_em)}: ${a.motivo_cancelamento}` : ''}
                    </span>
                  </div>
                  <div className={estilos.acoes}>
                    <Button variante="ghost" tamanho="sm" onClick={() => onHistorico(a)}>Histórico</Button>
                    {podeLancar && !cancelado && <Button variante="secondary" tamanho="sm" icone="pencil" onClick={() => onEditar(a)}>Alterar</Button>}
                    {podeLancar && !cancelado && <Button variante="dangerOutline" tamanho="sm" onClick={() => onCancelar(a)}>Cancelar</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
