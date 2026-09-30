import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import { cx } from '../../lib/design/cx';
import { MAX_EXECUCOES, MAX_NOME_EXECUCAO, dataExtensa, nomeExecucao, nomeVigente, validarNomeExecucao } from '../../lib/tarefas/calendario';
import {
  ajustarOcorrencia,
  cancelarOcorrencia,
  carregarNomesUsuarios,
  desfazerAjuste,
  excluirOcorrenciaAvulsa,
  registrarExecucao,
  removerExecucao,
  renomearExecucao,
  restaurarOcorrencia,
} from '../../lib/tarefas/consultas';
import { mensagemErro } from '../../lib/tarefas/erros';
import estilos from './tarefas.module.css';

function dataHora(valor) {
  if (!valor) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(valor));
}

function EscolhaPosicao({ nome, valor, onMudar, nomes, data, desabilitado }) {
  return (
    <div className={estilos.opcaoPosicao} role="radiogroup" aria-label="Posição">
      {[1, 2, 3].map((p) => {
        const identificado = nomeVigente(nomes, p, data);
        return (
          <label key={p} className={cx(valor === p && estilos[`pos${p}`])}>
            <input type="radio" name={nome} value={p} checked={valor === p} disabled={desabilitado} onChange={() => onMudar(p)} />
            F{p}{identificado ? ` — ${identificado}` : ''}
          </label>
        );
      })}
    </div>
  );
}

// Detalhe de UMA ocorrência. Três blocos independentes:
//  - PROGRAMAÇÃO: posição F1/F2/F3 (+ nome da posição) -- ajuste só desta
//    ocorrência (tarefas.editar); posicao_programada nunca muda;
//  - EXECUÇÃO: quem REALMENTE executou, até 2 nomes livres e OBRIGATÓRIOS
//    (0062, tarefas.concluir). 1ª execução = concluída; a 2ª é opcional.
//    Pode ser registrada antes da data (antecipação). "NÃO INFORMADO" só
//    aparece em conclusões legadas, anteriores à 0062;
//  - CANCELAMENTO (tarefas.editar).
export default function OcorrenciaModal({ ocorrencia, execucoes, tarefa, nomes, podeEditar, podeConcluir, onFechar, onAlterada, onExecucoes, onRemovida }) {
  const o = ocorrencia;
  const [posicao, setPosicao] = useState(o.posicao);
  const [avulso, setAvulso] = useState(o.responsavel_avulso || '');
  const [motivo, setMotivo] = useState('');
  const [nomeExecutor, setNomeExecutor] = useState('');
  const [editando, setEditando] = useState(null); // { id, nome }
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [usuarios, setUsuarios] = useState(new Map());

  useEffect(() => {
    setPosicao(o.posicao);
    setAvulso(o.responsavel_avulso || '');
  }, [o.posicao, o.responsavel_avulso]);

  const idsUsuarios = [o.ajustado_por, o.cancelado_por, ...execucoes.map((e) => e.concluido_por)].join(',');
  useEffect(() => {
    let ativo = true;
    carregarNomesUsuarios(idsUsuarios.split(',')).then((m) => {
      if (ativo) setUsuarios(m);
    });
    return () => {
      ativo = false;
    };
  }, [idsUsuarios]);

  async function executar(acao, aoConcluir) {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await acao();
      aoConcluir(resultado);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const aplicarExecucoes = (r) => {
    setNomeExecutor('');
    setEditando(null);
    onExecucoes(r.ocorrencia, r.execucoes);
  };

  const por = (id) => (id && usuarios.get(id) ? ` por ${usuarios.get(id)}` : '');
  const mudouResponsavel = posicao !== o.posicao || (avulso.trim() || null) !== (o.responsavel_avulso || null);
  const nomeProgramado = o.responsavel_avulso || o.responsavel_nome;
  const cheio = execucoes.length >= MAX_EXECUCOES;

  return (
    <Modal titulo={tarefa?.descricao ?? 'Ocorrência'} onFechar={onFechar} largura="md">
      <div className={estilos.pilha}>
        <p className={estilos.caixaInfo}>
          <strong>{dataExtensa(o.data)}</strong>
          <br />
          Programada para: <span className={cx(estilos.chipPosicao, estilos[`pos${o.posicao}`])}>F{o.posicao}{nomeProgramado ? ` (${nomeProgramado})` : ''}</span>
          {o.ajustado_em && o.posicao !== o.posicao_programada ? ` · originalmente F${o.posicao_programada}` : ''}
          <br />
          {o.cancelada ? <Badge tom="danger">Cancelada</Badge> : o.concluida ? <Badge tom="success">Concluída</Badge> : <Badge tom="neutral">Pendente</Badge>}{' '}
          {o.ajustado_em && <Badge tom="info">Ajustada</Badge>}{' '}
          {o.origem === 'avulsa' && <Badge tom="warning">Avulsa</Badge>}
        </p>

        {erro && <Alert tom="danger">{erro}</Alert>}

        {!o.cancelada && (podeConcluir || execucoes.length > 0) && (
          <section className={estilos.secaoModal} aria-label="Execução">
            <h3 className={estilos.tituloSecaoModal}>Execução (quem realizou)</h3>
            <div className={estilos.pilha}>
              {execucoes.length > 0 && (
                <ul className={estilos.listaExecucoes}>
                  {execucoes.map((e) => (
                    <li key={e.id} className={estilos.itemExecucao}>
                      <span aria-hidden="true">✓</span>
                      {editando?.id === e.id ? (
                        <Input
                          value={editando.nome}
                          maxLength={MAX_NOME_EXECUCAO}
                          onChange={(ev) => setEditando({ ...editando, nome: ev.target.value })}
                          aria-label="Nome de quem executou"
                          disabled={salvando}
                        />
                      ) : (
                        <span className={e.responsavel_nome ? estilos.nomeExecucao : estilos.nomeExecucaoVazio}>{nomeExecucao(e)}</span>
                      )}
                      {podeConcluir && (editando?.id === e.id ? (
                        <>
                          <Button
                            tamanho="sm"
                            disabled={salvando || Boolean(validarNomeExecucao(editando.nome))}
                            onClick={() => executar(() => renomearExecucao(e.id, editando.nome.trim()), aplicarExecucoes)}
                          >
                            Salvar
                          </Button>
                          <Button tamanho="sm" variante="ghost" disabled={salvando} onClick={() => setEditando(null)}>Cancelar</Button>
                        </>
                      ) : (
                        <>
                          <Button tamanho="sm" variante="ghost" disabled={salvando} onClick={() => setEditando({ id: e.id, nome: e.responsavel_nome || '' })}>Editar nome</Button>
                          <Button tamanho="sm" variante="dangerOutline" disabled={salvando} onClick={() => executar(() => removerExecucao(e.id), aplicarExecucoes)}>Remover</Button>
                        </>
                      ))}
                      <span className={estilos.detalheItemDia} style={{ flexBasis: '100%' }}>
                        Registrada em {dataHora(e.concluido_em)}{por(e.concluido_por)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {podeConcluir && !cheio && (
                <div className={estilos.novaExecucao}>
                  <Field label={execucoes.length === 0 ? 'Quem executou? (obrigatório)' : 'Também executada por (outro período, obrigatório)'}>
                    <Input
                      value={nomeExecutor}
                      maxLength={MAX_NOME_EXECUCAO}
                      onChange={(e) => setNomeExecutor(e.target.value)}
                      disabled={salvando}
                      placeholder="Nome de quem executou"
                      autoFocus={execucoes.length === 0}
                    />
                  </Field>
                  <Button
                    disabled={salvando || Boolean(validarNomeExecucao(nomeExecutor))}
                    onClick={() => executar(() => registrarExecucao(o.id, nomeExecutor.trim()), aplicarExecucoes)}
                  >
                    {execucoes.length === 0 ? 'Registrar execução' : 'Adicionar 2ª execução'}
                  </Button>
                </div>
              )}
              <p className={estilos.textoAuxiliar}>
                {cheio
                  ? 'Máximo de 2 execuções registrado. Remova uma para corrigir.'
                  : 'A 1ª execução já conclui a tarefa. Registre uma 2ª só se ela também foi feita em outro período. Pode ser registrada antes da data programada.'}
              </p>
            </div>
          </section>
        )}

        {podeEditar && !o.cancelada && (
          <section className={estilos.secaoModal}>
            <h3 className={estilos.tituloSecaoModal}>Programação desta ocorrência</h3>
            <div className={estilos.pilha}>
              <EscolhaPosicao nome={`pos-${o.id}`} valor={posicao} onMudar={setPosicao} nomes={nomes} data={o.data} desabilitado={salvando} />
              <Field label="Responsável avulso na programação (opcional)" dica="Nome livre só para este dia, por exemplo uma freelancer. Não é o registro de execução.">
                <Input value={avulso} maxLength={60} onChange={(e) => setAvulso(e.target.value)} disabled={salvando} />
              </Field>
              <div className={estilos.rodapeModal}>
                {o.ajustado_em && (
                  <Button variante="ghost" disabled={salvando} onClick={() => executar(() => desfazerAjuste(o.id), onAlterada)}>
                    Voltar ao programado (F{o.posicao_programada})
                  </Button>
                )}
                <Button disabled={salvando || !mudouResponsavel} onClick={() => executar(() => ajustarOcorrencia(o.id, posicao, avulso.trim()), onAlterada)}>
                  Salvar ajuste
                </Button>
              </div>
            </div>
          </section>
        )}

        {podeEditar && (
          <section className={estilos.secaoModal}>
            {o.cancelada ? (
              <>
                <p className={estilos.textoAuxiliar}>Cancelada em {dataHora(o.cancelado_em)}{por(o.cancelado_por)}: {o.cancelado_motivo}</p>
                <div className={estilos.rodapeModal}>
                  <Button variante="secondary" disabled={salvando} onClick={() => executar(() => restaurarOcorrencia(o.id), onAlterada)}>
                    Restaurar ocorrência
                  </Button>
                </div>
              </>
            ) : o.concluida ? (
              <p className={estilos.textoAuxiliar}>Para cancelar, remova antes as execuções registradas.</p>
            ) : (
              <div className={estilos.pilha}>
                <Field label="Cancelar esta ocorrência — motivo">
                  <Textarea value={motivo} rows={2} maxLength={300} onChange={(e) => setMotivo(e.target.value)} disabled={salvando} />
                </Field>
                <div className={estilos.rodapeModal}>
                  {o.origem === 'avulsa' && (
                    <Button
                      variante="ghost"
                      disabled={salvando}
                      onClick={() => executar(() => excluirOcorrenciaAvulsa(o.id), () => { onRemovida(o); onFechar(); })}
                    >
                      Excluir avulsa
                    </Button>
                  )}
                  <Button
                    variante="danger"
                    disabled={salvando || !motivo.trim()}
                    onClick={() => executar(() => cancelarOcorrencia(o.id, motivo.trim()), (nova) => { setMotivo(''); onAlterada(nova); })}
                  >
                    Cancelar ocorrência
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {o.ajustado_em && <p className={estilos.textoAuxiliar}>Programação ajustada em {dataHora(o.ajustado_em)}{por(o.ajustado_por)}.</p>}
      </div>
    </Modal>
  );
}

// Criação de ocorrência avulsa numa célula vazia (ex.: tarefas sem
// programação automática, como lanches naturais).
export function NovaAvulsaModal({ tarefa, data, nomes, onFechar, onCriada, criar }) {
  const [posicao, setPosicao] = useState(1);
  const [avulso, setAvulso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setSalvando(true);
    setErro('');
    try {
      const nova = await criar(tarefa.id, data, posicao, avulso.trim());
      onCriada(nova);
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Adicionar ocorrência avulsa" onFechar={onFechar} largura="md">
      <div className={estilos.pilha}>
        <p className={estilos.caixaInfo}>
          <strong>{tarefa.descricao}</strong>
          <br />
          {dataExtensa(data)}
        </p>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <EscolhaPosicao nome="nova-avulsa" valor={posicao} onMudar={setPosicao} nomes={nomes} data={data} desabilitado={salvando} />
        <Field label="Responsável avulso (opcional)">
          <Input value={avulso} maxLength={60} onChange={(e) => setAvulso(e.target.value)} disabled={salvando} />
        </Field>
        <p className={estilos.textoAuxiliar}>A ocorrência avulsa vale só para este dia e nunca é removida por reprogramações.</p>
        <div className={estilos.rodapeModal}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvando}>Adicionar</Button>
        </div>
      </div>
    </Modal>
  );
}
