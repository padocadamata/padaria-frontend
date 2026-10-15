import { useMemo, useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import LancamentoModal from './LancamentoModal';
import CancelarLancamentoModal from './CancelarLancamentoModal';
import { formatarMoeda } from '../../lib/funcionarios/pagamentos';
import { agruparPendentesPorFuncionaria, descreverPendentes, rotuloNatureza, sinalNatureza, totaisLancamentos } from '../../lib/funcionarios/lancamentosCalculo';
import { cx } from '../../lib/design/cx';
import estilosPagamentos from './pagamentos.module.css';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = String(dataYYYYMMDD).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// Painel compacto de LANÇAMENTOS PENDENTES no topo de A Pagar (migration
// 0076): uma linha de resumo + "Novo lançamento"; a lista (agrupada por
// pessoa, com editar/cancelar) só abre quando pedida -- a tela principal
// não vira planilha. Os mesmos pendentes aparecem, para escolha, dentro do
// modal de pagamento de cada pessoa.
export default function LancamentosPendentesPainel({ pendentes, funcionarios, tipos, podeEditar, onAlterado }) {
  const [aberto, setAberto] = useState(false);
  const [modal, setModal] = useState(null); // { tipo: 'novo'|'editar'|'cancelar', lancamento?, funcionarioId? }

  const grupos = useMemo(() => {
    const porPessoa = agruparPendentesPorFuncionaria(pendentes);
    return Array.from(porPessoa.entries())
      .map(([id, resumo]) => ({ id, nome: resumo.lancamentos[0]?.funcionario_nome || '—', inativa: resumo.lancamentos[0]?.funcionario_ativo === false, ...resumo }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [pendentes]);
  const total = totaisLancamentos(pendentes);

  const resumoGeral =
    total.quantidade === 0
      ? 'Nenhum lançamento pendente.'
      : [
          `${total.quantidade} ${total.quantidade === 1 ? 'lançamento' : 'lançamentos'} de ${grupos.length} ${grupos.length === 1 ? 'pessoa' : 'pessoas'}`,
          total.descontos > 0 && `descontos − ${formatarMoeda(total.descontos)}`,
          total.acrescimos > 0 && `acréscimos + ${formatarMoeda(total.acrescimos)}`,
        ]
          .filter(Boolean)
          .join(' · ');

  function aoSalvar() {
    setModal(null);
    onAlterado();
  }

  return (
    <section className={estilosPagamentos.painelLancamentos} aria-labelledby="titulo-lancamentos-pendentes">
      <div className={estilosPagamentos.painelCabecalho}>
        <div className={estilosPagamentos.painelTitulo}>
          <h3 id="titulo-lancamentos-pendentes" className={estilosPagamentos.tituloPainel}>
            Lançamentos pendentes
          </h3>
          <p className={estilosPagamentos.prevista}>{resumoGeral}</p>
        </div>
        <div className={estilosPagamentos.painelAcoes}>
          {total.quantidade > 0 && (
            <Button variante="secondary" tamanho="sm" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls="lista-lancamentos-pendentes">
              {aberto ? 'Ocultar' : 'Ver lançamentos'}
            </Button>
          )}
          {podeEditar && (
            <Button tamanho="sm" icone="plus" onClick={() => setModal({ tipo: 'novo' })}>
              Novo lançamento
            </Button>
          )}
        </div>
      </div>

      {aberto && total.quantidade > 0 && (
        <ul id="lista-lancamentos-pendentes" className={estilosPagamentos.listaPessoasLancamentos}>
          {grupos.map((g) => (
            <li key={g.id} className={estilosPagamentos.pessoaLancamentos}>
              <div className={estilosPagamentos.pessoaLancamentosCabecalho}>
                <strong>{g.nome}</strong>
                {g.inativa && <Badge tom="neutral">inativa</Badge>}
                <span className={estilosPagamentos.prevista}>{descreverPendentes(g)}</span>
              </div>
              <ul className={estilosPagamentos.listaLancamentos}>
                {g.lancamentos.map((l) => (
                  <li key={l.id} className={estilosPagamentos.itemLancamento}>
                    <span className={estilosPagamentos.lancamentoInfo}>
                      <span className={estilosPagamentos.lancamentoLinha}>
                        <Badge tom={l.natureza === 'acrescimo' ? 'info' : 'warning'}>{rotuloNatureza(l.natureza)}</Badge>
                        <strong>{l.tipo_nome}</strong>
                        <span className={estilosPagamentos.prevista}>{formatarData(l.data_lancamento)}</span>
                      </span>
                      {l.observacao && <span className={estilosPagamentos.prevista}>{l.observacao}</span>}
                    </span>
                    <span className={cx(estilosPagamentos.lancamentoValor, l.natureza === 'acrescimo' ? estilosPagamentos.valorAcrescimo : estilosPagamentos.valorDesconto)}>
                      {sinalNatureza(l.natureza)} {formatarMoeda(l.valor)}
                    </span>
                    {podeEditar && (
                      <span className={estilosPagamentos.lancamentoAcoes}>
                        <IconButton icone="pencil" tamanho="sm" rotulo={`Editar lançamento ${l.tipo_nome} de ${g.nome}`} onClick={() => setModal({ tipo: 'editar', lancamento: l })} />
                        <IconButton icone="close" tamanho="sm" tom="danger" rotulo={`Cancelar lançamento ${l.tipo_nome} de ${g.nome}`} onClick={() => setModal({ tipo: 'cancelar', lancamento: l, nome: g.nome })} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {modal?.tipo === 'novo' && <LancamentoModal funcionarios={funcionarios} tipos={tipos} onFechar={() => setModal(null)} onSalvo={aoSalvar} />}
      {modal?.tipo === 'editar' && (
        <LancamentoModal lancamento={modal.lancamento} funcionarios={funcionarios} tipos={tipos} onFechar={() => setModal(null)} onSalvo={aoSalvar} />
      )}
      {modal?.tipo === 'cancelar' && (
        <CancelarLancamentoModal lancamento={modal.lancamento} nomeFuncionaria={modal.nome} onFechar={() => setModal(null)} onCancelado={aoSalvar} />
      )}
    </section>
  );
}
