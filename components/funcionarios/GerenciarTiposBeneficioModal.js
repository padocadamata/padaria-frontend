import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { normalizarMaiusculas } from '../../lib/funcionarios/normalizacao';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import ConfirmarAcaoModal from '../admin/ConfirmarAcaoModal';
import { cx } from '../../lib/design/cx';
import estilos from './funcionarios.module.css';

const MAX_LEN = 80;

// Gerenciamento de public.funcionarios_beneficios_tipos -- mesmo ciclo
// (criar/renomear/ativar/inativar) de GerenciarCargosModal.js para
// funcionarios_cargos (mesma arquitetura no banco: id/nome/ativo, nome
// único case-insensitive, RLS por funcionarios.editar, migration 0054) --
// clonado de propósito para não inventar um segundo padrão de UI. tipo_id
// é FK real em funcionarios_beneficios.tipo_id, então renomear aqui já
// reflete automaticamente em qualquer lugar que exiba o nome via join.
//
// Layout PRÓPRIO (item em 2 linhas, classes .itemTipoBeneficio* só desta
// tela) -- nunca reaproveita .itemCargo/.itemCargoNome/.itemAcoes de
// GerenciarCargosModal, para o ajuste desta rodada nunca afetar Cargos.
//
// Exclusão permanente (nova nesta rodada): só oferecida para tipos SEM
// nenhum vínculo em funcionarios_beneficios -- a garantia estrutural já
// existe desde a migration 0054 (tipo_id referencia sem CASCADE, Postgres
// recusa o DELETE com 23503 se houver uso), aqui só verificamos com
// antecedência (1 busca em lote, nunca N+1) para nem oferecer o botão
// funcional a um tipo em uso, e ainda tratamos 23503 como rede de segurança
// caso o uso apareça entre o carregamento e o clique.
function mensagemErroTipo(error) {
  if (error?.code === '23505') return 'Já existe um tipo de benefício com este nome.';
  if (error?.code === '23514') return 'O nome do tipo não pode ficar em branco.';
  console.error('Erro ao salvar tipo de benefício:', error);
  return 'Não foi possível salvar o tipo de benefício. Tente novamente ou avise um administrador.';
}

function mensagemErroExclusao(error) {
  if (error?.code === '23503') {
    return 'Este tipo já possui benefícios vinculados a funcionários e não pode ser excluído — inative-o em vez de excluir.';
  }
  console.error('Erro ao excluir tipo de benefício:', error);
  return 'Não foi possível excluir. Tente novamente ou avise um administrador.';
}

export default function GerenciarTiposBeneficioModal({ aberto, onFechar, tipos, podeGerenciar, onAtualizar }) {
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');

  const [idEmEdicao, setIdEmEdicao] = useState(null);
  const [nomeEditado, setNomeEditado] = useState('');
  const [salvandoId, setSalvandoId] = useState(null);
  const [erroPorId, setErroPorId] = useState({});
  const [alternandoId, setAlternandoId] = useState(null);

  // Conjunto de tipo_id com pelo menos 1 vínculo -- 1 busca em lote quando
  // o modal abre, nunca 1 consulta por tipo (mesma disciplina já usada em
  // toda a Escala: buscarEscalaPeriodo etc.).
  const [tiposEmUso, setTiposEmUso] = useState(null); // null = ainda carregando
  const [confirmarExclusao, setConfirmarExclusao] = useState(null); // { id, nome }
  const [excluindoId, setExcluindoId] = useState(null);

  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    async function carregarUso() {
      const supabase = createClient();
      const { data, error } = await supabase.from('funcionarios_beneficios').select('tipo_id');
      if (!ativo) return;
      if (error) {
        console.error('Erro ao verificar uso dos tipos de benefício:', error);
        setTiposEmUso(new Set()); // falha ao verificar: não bloqueia a tela, o 23503 do banco continua como rede de segurança
        return;
      }
      setTiposEmUso(new Set((data || []).map((b) => b.tipo_id)));
    }
    carregarUso();
    return () => {
      ativo = false;
    };
  }, [aberto]);

  if (!aberto) return null;

  async function criar(e) {
    e.preventDefault();
    const nome = normalizarMaiusculas(novoNome);
    if (!nome) {
      setErroCriar('Informe o nome do tipo de benefício.');
      return;
    }
    if (nome.length > MAX_LEN) {
      setErroCriar(`O nome do tipo não pode ultrapassar ${MAX_LEN} caracteres.`);
      return;
    }

    setCriando(true);
    setErroCriar('');
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios_beneficios_tipos').insert({ nome }).select('id, nome, ativo').single();
    setCriando(false);

    if (error) {
      setErroCriar(mensagemErroTipo(error));
      return;
    }
    setNovoNome('');
    onAtualizar([...tipos, data].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })));
  }

  function iniciarEdicao(tipo) {
    setIdEmEdicao(tipo.id);
    setNomeEditado(tipo.nome);
    setErroPorId((atual) => {
      const { [tipo.id]: _removido, ...resto } = atual;
      return resto;
    });
  }

  function cancelarEdicao() {
    setIdEmEdicao(null);
    setNomeEditado('');
  }

  async function salvarEdicao(id) {
    const nome = normalizarMaiusculas(nomeEditado);
    if (!nome) {
      setErroPorId((atual) => ({ ...atual, [id]: 'O nome do tipo não pode ficar em branco.' }));
      return;
    }

    setSalvandoId(id);
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios_beneficios_tipos').update({ nome }).eq('id', id).select('id, nome, ativo').single();
    setSalvandoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [id]: mensagemErroTipo(error) }));
      return;
    }
    onAtualizar(tipos.map((t) => (t.id === id ? data : t)));
    cancelarEdicao();
  }

  async function alternarAtivo(tipo) {
    setAlternandoId(tipo.id);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('funcionarios_beneficios_tipos')
      .update({ ativo: !tipo.ativo })
      .eq('id', tipo.id)
      .select('id, nome, ativo')
      .single();
    setAlternandoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [tipo.id]: mensagemErroTipo(error) }));
      return;
    }
    onAtualizar(tipos.map((t) => (t.id === tipo.id ? data : t)));
  }

  async function confirmarExclusaoTipo() {
    if (!confirmarExclusao) return;
    const { id } = confirmarExclusao;
    setExcluindoId(id);
    const supabase = createClient();
    const { data, error } = await supabase.from('funcionarios_beneficios_tipos').delete().eq('id', id).select('id');
    setExcluindoId(null);

    if (error) {
      setErroPorId((atual) => ({ ...atual, [id]: mensagemErroExclusao(error) }));
      setConfirmarExclusao(null);
      return;
    }
    if (!data || data.length === 0) {
      // RLS bloqueou silenciosamente (nenhuma linha afetada, sem erro
      // explícito) -- cenário esperado até a migration 0057 ser aplicada.
      setErroPorId((atual) => ({
        ...atual,
        [id]: 'Não foi possível excluir — a exclusão de tipos de benefício ainda não está habilitada no banco. Avise um administrador.',
      }));
      setConfirmarExclusao(null);
      return;
    }

    onAtualizar(tipos.filter((t) => t.id !== id));
    setConfirmarExclusao(null);
  }

  return (
    <Modal titulo="Gerenciar tipos de benefício" onFechar={onFechar} largura="md">
      {!podeGerenciar && (
        <p className={estilos.nota}>
          Você pode visualizar os tipos existentes. Criar, renomear, inativar ou excluir exige permissão de edição de Funcionários.
        </p>
      )}

      <div className={estilos.listaCargos}>
        {tipos.length === 0 && <p className={estilos.vazio}>Nenhum tipo de benefício cadastrado.</p>}
        {tipos.map((tipo) => {
          const emEdicao = idEmEdicao === tipo.id;
          const erroItem = erroPorId[tipo.id];
          const emUso = tiposEmUso ? tiposEmUso.has(tipo.id) : true; // enquanto carrega, assume em uso (mais seguro: não oferece Excluir precipitadamente)
          return (
            <div key={tipo.id}>
              <div className={cx(estilos.itemTipoBeneficio, emEdicao && estilos.itemTipoBeneficioEmEdicao)}>
                <div className={estilos.itemTipoBeneficioLinhaSuperior}>
                  {emEdicao ? (
                    <Input
                      type="text"
                      value={nomeEditado}
                      maxLength={MAX_LEN}
                      onChange={(e) => setNomeEditado(e.target.value)}
                      className={estilos.itemTipoBeneficioNome}
                      aria-label="Renomear tipo de benefício"
                      autoFocus
                    />
                  ) : (
                    <span className={cx(estilos.itemTipoBeneficioNome, !tipo.ativo && estilos.itemTipoBeneficioInativo)}>
                      {tipo.nome}
                    </span>
                  )}
                  {!emEdicao && <Badge tom={tipo.ativo ? 'success' : 'neutral'}>{tipo.ativo ? 'Ativo' : 'Inativo'}</Badge>}
                </div>

                {podeGerenciar && (
                  <div className={estilos.itemTipoBeneficioAcoes}>
                    {emEdicao ? (
                      <>
                        <Button tamanho="sm" onClick={() => salvarEdicao(tipo.id)} disabled={salvandoId === tipo.id}>Salvar</Button>
                        <Button tamanho="sm" variante="secondary" onClick={cancelarEdicao}>Cancelar</Button>
                      </>
                    ) : (
                      <>
                        <Button tamanho="sm" variante="secondary" onClick={() => iniciarEdicao(tipo)}>Renomear</Button>
                        <Button tamanho="sm" variante="secondary" onClick={() => alternarAtivo(tipo)} disabled={alternandoId === tipo.id}>
                          {tipo.ativo ? 'Inativar' : 'Ativar'}
                        </Button>
                        {emUso ? (
                          <span className={estilos.itemTipoBeneficioNotaUso}>Em uso — não pode ser excluído</span>
                        ) : (
                          <Button
                            tamanho="sm"
                            variante="secondary"
                            onClick={() => setConfirmarExclusao({ id: tipo.id, nome: tipo.nome })}
                            disabled={excluindoId === tipo.id}
                          >
                            Excluir
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {erroItem && <p className={estilos.itemDetalhe} style={{ color: 'var(--ds-danger, #b3261e)' }}>{erroItem}</p>}
            </div>
          );
        })}
      </div>

      {podeGerenciar && (
        <form onSubmit={criar} className={estilos.criarCargo}>
          <Input
            type="text"
            placeholder="Novo tipo de benefício"
            value={novoNome}
            maxLength={MAX_LEN}
            onChange={(e) => setNovoNome(e.target.value)}
            aria-label="Novo tipo de benefício"
          />
          <Button type="submit" disabled={criando}>{criando ? 'Aguarde...' : '+ Novo'}</Button>
        </form>
      )}
      {erroCriar && <p className={estilos.itemDetalhe} style={{ color: 'var(--ds-danger, #b3261e)', marginTop: 'var(--ds-sp-2)' }}>{erroCriar}</p>}

      <p className={estilos.nota} style={{ marginTop: 'var(--ds-sp-4)' }}>
        Tipos com benefícios já vinculados só podem ser inativados. Só é possível excluir permanentemente um tipo que nunca foi utilizado.
      </p>

      {confirmarExclusao && (
        <ConfirmarAcaoModal
          modalDS
          titulo="Excluir tipo de benefício"
          perigo
          confirmando={excluindoId === confirmarExclusao.id}
          textoConfirmar={excluindoId === confirmarExclusao.id ? 'Excluindo...' : 'Excluir permanentemente'}
          mensagem={
            <p>
              Excluir <strong>{confirmarExclusao.nome}</strong> permanentemente? Esta ação não pode ser desfeita.
            </p>
          }
          onConfirmar={confirmarExclusaoTipo}
          onCancelar={() => setConfirmarExclusao(null)}
        />
      )}
    </Modal>
  );
}
