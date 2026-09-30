import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../../components/RequireAuth';
import PageShell from '../../../components/shell/PageShell';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import IconButton from '../../../components/ui/IconButton';
import Checkbox from '../../../components/ui/Checkbox';
import ConfirmarAcaoModal from '../../../components/admin/ConfirmarAcaoModal';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import TarefasAbas from '../../../components/tarefas/TarefasAbas';
import TarefaFormModal from '../../../components/tarefas/TarefaFormModal';
import InativarTarefaModal from '../../../components/tarefas/InativarTarefaModal';
import GruposModal from '../../../components/tarefas/GruposModal';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../../lib/auth/permissoes';
import { dataLocalHoje } from '../../../lib/data/dataLocal';
import { dataCurta } from '../../../lib/tarefas/calendario';
import { compararPorFrequencia, descreverRegra, proximaVersao, regraReferencia, regraVigente } from '../../../lib/tarefas/regras';
import { carregarCadastro, excluirTarefa } from '../../../lib/tarefas/consultas';
import { mensagemErro } from '../../../lib/tarefas/erros';
import estilos from '../../../components/tarefas/tarefas.module.css';

// Folha de Pagamento > Tarefas > Cadastro (migration 0061). Regras sempre
// em linguagem humana; o deslocamento da rotação e os grupos de
// distribuição são internos do motor (grupo só aparece no formulário de
// manutenção da regra). Mesma ordem do calendário: menos frequente
// primeiro, diárias por último.

function resumoResultado(r) {
  if (!r?.programacao_alterada && r?.criadas === undefined) return 'Tarefa salva.';
  const partes = [];
  if (r.criadas) partes.push(`${r.criadas} ocorrência(s) criada(s)`);
  if (r.removidas) partes.push(`${r.removidas} removida(s)`);
  return partes.length ? `Tarefa salva: ${partes.join(', ')} nos meses já programados.` : 'Tarefa salva.';
}

function TarefasCadastro() {
  const { permissoes } = useAuth();
  const podeEditar = hasPermissao(permissoes, PERMISSOES.TAREFAS_EDITAR);
  const hoje = dataLocalHoje();

  const [cadastro, setCadastro] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [mostrarInativas, setMostrarInativas] = useState(false);

  const [formulario, setFormulario] = useState(null); // { modo, tarefa }
  const [inativando, setInativando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [excluindoEstado, setExcluindoEstado] = useState({ confirmando: false, erro: '' });
  const [gruposAberto, setGruposAberto] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    carregarCadastro()
      .then((c) => ativo && setCadastro(c))
      .catch((e) => {
        console.error('Erro ao carregar cadastro de Tarefas:', e);
        if (ativo) setErro(`Não foi possível carregar o cadastro: ${mensagemErro(e)}`);
      })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [recarregar]);

  const secoes = useMemo(() => {
    if (!cadastro) return [];
    return cadastro.categorias.map((c) => ({
      categoria: c,
      tarefas: cadastro.tarefas
        .filter((t) => t.categoria === c.valor && (mostrarInativas || t.ativo))
        .map((tarefa) => ({ tarefa, regra: regraReferencia(cadastro.regrasPorTarefa.get(tarefa.id), hoje) }))
        .sort(compararPorFrequencia)
        .map((x) => x.tarefa),
    }));
  }, [cadastro, mostrarInativas, hoje]);

  function concluir(texto) {
    setFormulario(null);
    setInativando(null);
    setMensagem(texto);
    setRecarregar((n) => n + 1);
  }

  async function confirmarExclusao() {
    setExcluindoEstado({ confirmando: true, erro: '' });
    try {
      await excluirTarefa(excluindo.id);
      setExcluindo(null);
      setExcluindoEstado({ confirmando: false, erro: '' });
      concluir('Tarefa excluída.');
    } catch (e) {
      setExcluindoEstado({ confirmando: false, erro: mensagemErro(e) });
    }
  }

  const totalAtivas = cadastro?.tarefas.filter((t) => t.ativo).length ?? 0;

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="tarefas" />
      <PageHeader
        titulo="Tarefas"
        subtitulo={cadastro ? `${totalAtivas} tarefa(s) ativa(s)` : undefined}
        acoes={
          <>
            <Button variante="secondary" onClick={() => setGruposAberto(true)} disabled={!cadastro}>Grupos</Button>
            {podeEditar && (
              <Button icone="plus" onClick={() => setFormulario({ modo: 'novo', tarefa: null })} disabled={!cadastro}>
                Nova tarefa
              </Button>
            )}
          </>
        }
      />
      <TarefasAbas ativo="cadastro" />

      {mensagem && <Alert tom="success" className={estilos.mensagem}>{mensagem}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <Checkbox rotulo="Mostrar tarefas inativas" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} />

      {carregando ? (
        <p role="status">Carregando...</p>
      ) : cadastro && (
        <div className={estilos.envolucro}>
          <table className={estilos.tabelaCadastro}>
            <thead>
              <tr>
                <th scope="col" className={estilos.colCadTarefa}>Tarefa</th>
                <th scope="col" className={estilos.colCadProgramacao}>Programação</th>
                <th scope="col" className={estilos.colCadSituacao}>Situação</th>
                {podeEditar && <th scope="col" className={estilos.colCadAcoes}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {secoes.map((secao) => (
                <SecaoCadastro
                  key={secao.categoria.valor}
                  secao={secao}
                  regrasPorTarefa={cadastro.regrasPorTarefa}
                  hoje={hoje}
                  podeEditar={podeEditar}
                  onEditar={(t) => setFormulario({ modo: 'editar', tarefa: t })}
                  onReativar={(t) => setFormulario({ modo: 'reativar', tarefa: t })}
                  onInativar={setInativando}
                  onExcluir={(t) => {
                    setExcluindo(t);
                    setExcluindoEstado({ confirmando: false, erro: '' });
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formulario && cadastro && (
        <TarefaFormModal
          modo={formulario.modo}
          tarefa={formulario.tarefa}
          regras={formulario.tarefa ? cadastro.regrasPorTarefa.get(formulario.tarefa.id) || [] : []}
          categorias={cadastro.categorias}
          grupos={cadastro.grupos}
          hoje={hoje}
          onFechar={() => setFormulario(null)}
          onSalvo={(r) => concluir(resumoResultado(r))}
        />
      )}

      {inativando && (
        <InativarTarefaModal
          tarefa={inativando}
          regras={cadastro?.regrasPorTarefa.get(inativando.id) || []}
          hoje={hoje}
          onFechar={() => setInativando(null)}
          onSalvo={(r) => concluir(`Tarefa inativada a partir de ${r.aplicar_a_partir_de.split('-').reverse().join('/')}. ${r.removidas} ocorrência(s) futura(s) removida(s).`)}
        />
      )}

      {excluindo && (
        <ConfirmarAcaoModal
          modalDS
          perigo
          titulo="Excluir tarefa"
          mensagem={
            <p>
              Excluir definitivamente <strong>{excluindo.descricao}</strong>? Só é possível se ela nunca apareceu no calendário;
              com histórico, ela é preservada — inativa, já fica fora da programação e do cadastro.
            </p>
          }
          textoConfirmar="Excluir"
          confirmando={excluindoEstado.confirmando}
          erro={excluindoEstado.erro}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
        />
      )}

      {gruposAberto && cadastro && (
        <GruposModal
          grupos={cadastro.grupos}
          podeEditar={podeEditar}
          onFechar={() => setGruposAberto(false)}
          onAlterado={() => setRecarregar((n) => n + 1)}
        />
      )}
    </PageShell>
  );
}

// Texto da programação (regra vigente + mudança agendada) -- o MESMO
// conteúdo de antes; usado na coluna Programação e, em telas estreitas,
// abaixo da descrição (a coluna é ocultada para não gerar rolagem lateral).
function ProgramacaoTexto({ vigente, proxima }) {
  return (
    <>
      <span className={estilos.programacaoRegra}>{vigente ? descreverRegra(vigente) : proxima ? '—' : 'Sem regra'}</span>
      {proxima && (
        <span className={estilos.detalheItemDia}>
          A partir de {dataCurta(proxima.vigente_desde)}/{proxima.vigente_desde.slice(0, 4)}: {descreverRegra(proxima)}
        </span>
      )}
    </>
  );
}

function SecaoCadastro({ secao, regrasPorTarefa, hoje, podeEditar, onEditar, onReativar, onInativar, onExcluir }) {
  if (secao.tarefas.length === 0) return null;
  return (
    <>
      <tr className={estilos.cabecalhoCategoria}>
        <td colSpan={podeEditar ? 4 : 3}>{secao.categoria.valor}</td>
      </tr>
      {secao.tarefas.map((t) => {
        const regras = regrasPorTarefa.get(t.id) || [];
        const vigente = regraVigente(regras, hoje);
        const proxima = proximaVersao(regras, hoje);
        return (
          <tr key={t.id}>
            <td className={estilos.celulaCadTarefa}>
              {t.descricao}
              {t.observacao && <span className={estilos.detalheItemDia}>{t.observacao}</span>}
              <span className={estilos.programacaoNaLinha}>
                <ProgramacaoTexto vigente={vigente} proxima={proxima} />
              </span>
            </td>
            <td className={estilos.celulaCadProgramacao}>
              <ProgramacaoTexto vigente={vigente} proxima={proxima} />
            </td>
            <td className={estilos.celulaCadCompacta}>{t.ativo ? <Badge tom="success">Ativa</Badge> : <Badge tom="neutral">Inativa</Badge>}</td>
            {podeEditar && (
              <td className={estilos.celulaCadCompacta}>
                <div className={estilos.acoesIcones}>
                  {t.ativo ? (
                    <>
                      <IconButton icone="pencil" rotulo="Editar tarefa" onClick={() => onEditar(t)} />
                      <IconButton icone="pause" rotulo="Inativar tarefa" onClick={() => onInativar(t)} />
                    </>
                  ) : (
                    <IconButton icone="play" rotulo="Reativar tarefa" onClick={() => onReativar(t)} />
                  )}
                  <IconButton icone="trash" rotulo="Excluir tarefa" tom="danger" onClick={() => onExcluir(t)} />
                </div>
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}

export default function TarefasCadastroPage() {
  return (
    <RequireAuth permissao={PERMISSOES.TAREFAS_VISUALIZAR}>
      <TarefasCadastro />
    </RequireAuth>
  );
}
