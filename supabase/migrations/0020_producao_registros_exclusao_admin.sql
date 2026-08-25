-- 0020_producao_registros_exclusao_admin.sql
-- Exclusão definitiva de um registro de producao_registros, restrita a
-- administrador (is_admin()), para o caso de lançamento feito por engano
-- em data/turno/produto errado — quando corrigir para zero não é o que
-- se quer, e sim remover a linha (liberando o slot data+turno+receita_id
-- para um novo lançamento correto).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Escrita do zero no scratchpad a partir
-- do desenho aprovado nesta conversa.
--
-- Pré-requisitos reais (dependências de SQL, todas já aplicadas):
--   * public.producao_registros — 0010, já aplicada. Esta migration
--     ADICIONA uma policy de DELETE (hoje inexistente — sem ela, DELETE
--     fica bloqueado para todo mundo por RLS, inclusive admin, mesmo com
--     uma RPC SECURITY INVOKER fazendo a checagem certa). NÃO toca nas
--     policies de SELECT/INSERT/UPDATE (0010), nem na trigger
--     producao_registros_protecao (0010/0015/0017/0019) — essa trigger
--     só dispara em INSERT/UPDATE, nunca em DELETE, e continua assim.
--   * public.is_admin() — 0003, já aplicada.
--   * public.logs_auditoria e o trigger logs_auditoria_preencher_usuario
--     — 0004, já aplicada. usuario_id/usuario_nome/usuario_email/
--     data_hora são preenchidos automaticamente por aquele trigger em
--     qualquer INSERT (deriva de auth.uid() do lado do servidor,
--     ignorando qualquer valor enviado pelo cliente) — a nova função
--     desta migration REAPROVEITA esse mecanismo tal como está, sem
--     duplicar nem reimplementar a identificação do usuário. Nenhuma
--     coluna nova, nenhuma alteração no trigger de 0004.
--
-- Auditoria de FKs/dependências (feita antes de escrever este arquivo):
--   nenhuma tabela tem foreign key apontando para producao_registros.id
--   (producao_registros.receita_id referencia receitas(id), no sentido
--   contrário; planejamento_producao também referencia receitas(id)
--   diretamente, nunca producao_registros). Excluir uma linha não corre
--   nenhum risco de cascata — por isso NENHUM CASCADE é usado ou
--   necessário nesta migration.
--
-- ESCOPO — SOMENTE:
--   * 1 CREATE POLICY nova (producao_registros_delete), restrita a
--     is_admin();
--   * 1 função RPC nova: public.excluir_producao_registro(uuid, text).
-- Esta migration NÃO faz, e não deve fazer:
--   * nenhuma alteração nas policies de SELECT/INSERT/UPDATE de
--     producao_registros (0010) — permanecem exatamente como estão;
--   * nenhuma alteração na trigger producao_registros_protecao nem em
--     nenhuma das RPCs já existentes (adicionar_producao,
--     reabrir_producao_registro, gerenciar_sobras_producao_registro,
--     lancar_producao_retroativa, completar_producao_retroativa,
--     editar_producao_registro);
--   * nenhuma coluna nova, nenhuma tabela nova;
--   * nenhum CASCADE, nenhum DELETE em qualquer outra tabela
--     (receitas, planejamento_producao, logs_auditoria, usuarios);
--   * nenhuma alteração em nenhuma migration anterior (0001..0019).
--
-- Por que SECURITY INVOKER (mesmo padrão de todas as RPCs de produção
-- desde a 0011): o DELETE dentro da função roda com os privilégios e a
-- sessão do usuário que chamou a RPC — a nova policy
-- producao_registros_delete (is_admin()) é avaliada normalmente, exatamente
-- como se o DELETE tivesse sido feito direto pelo cliente. A checagem
-- explícita de is_admin() logo no início da função é uma SEGUNDA barreira,
-- independente da RLS — mesmo se alguém chamasse esta RPC diretamente
-- (bypassando o frontend), as duas camadas têm que concordar: a função
-- rejeita antes de tentar qualquer coisa, e a RLS rejeitaria de qualquer
-- forma se a checagem da função fosse removida ou tivesse algum bug.
--
-- Segurança de EXECUTE: REVOKE de PUBLIC e anon + GRANT só para
-- authenticated, explícitos (mesmo padrão de toda RPC de produção).
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão e
-- CREATE OR REPLACE FUNCTION.

BEGIN;

-- ============================================================
-- 1. producao_registros — nova policy de DELETE (hoje inexistente)
-- ============================================================
-- Sem esta policy, DELETE fica bloqueado por RLS para todo mundo,
-- inclusive is_admin() — a RPC abaixo, sendo SECURITY INVOKER, depende
-- desta policy para conseguir de fato excluir a linha.

drop policy if exists producao_registros_delete on public.producao_registros;
create policy producao_registros_delete on public.producao_registros
  for delete to authenticated
  using ((select public.is_admin()));

comment on policy producao_registros_delete on public.producao_registros is
  'Exclusao definitiva restrita a administrador (is_admin()). Nenhum outro papel/permissao autoriza DELETE nesta tabela — usuarios comuns, mesmo com producao.cancelar/producao.corrigir, nunca conseguem excluir, so corrigir/reabrir.';


-- ============================================================
-- 2. public.excluir_producao_registro — nova
-- ============================================================
-- Exclusão definitiva de UM registro de producao_registros, independente
-- de origem (manual/retroativo/historico) e de status (aberto/fechado/
-- reaberto). Carrega o registro completo ANTES de excluir, grava um
-- snapshot em logs_auditoria (uma linha por campo relevante, valor_anterior
-- = o que existia, valor_novo = null, mais uma linha para o motivo com
-- valor_anterior = null, valor_novo = motivo — mesma convenção já usada
-- por lancar_producao_retroativa para o caso simétrico de criação), e só
-- então executa o DELETE — tudo na mesma transação implícita desta
-- chamada de função: se o INSERT em logs_auditoria falhar por qualquer
-- razão, o DELETE nunca chega a acontecer.
--
-- Identificação de quem excluiu: NÃO é feita por esta função — o trigger
-- logs_auditoria_preencher_usuario (migration 0004, já aplicado) já
-- deriva usuario_id/usuario_nome/usuario_email de auth.uid() em qualquer
-- INSERT em logs_auditoria, ignorando o que o cliente mandar. Esta função
-- só faz o INSERT normal (entidade/registro_id/acao/campo/valor_anterior/
-- valor_novo) e deixa esse trigger preencher o resto, exatamente como
-- todas as outras RPCs de produção já fazem — nenhuma lógica nova de
-- identificação de usuário é criada aqui.

create or replace function public.excluir_producao_registro(
  p_registro_id uuid,
  p_motivo text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro public.producao_registros;
begin
  if not (select public.is_admin()) then
    raise exception
      'excluir_producao_registro: exclusao definitiva de producao requer administrador.';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception
      'excluir_producao_registro: motivo e obrigatorio.';
  end if;

  select * into v_registro
  from public.producao_registros
  where id = p_registro_id;

  if v_registro.id is null then
    raise exception
      'excluir_producao_registro: registro % nao encontrado.', p_registro_id;
  end if;

  -- usuario_id/usuario_nome/usuario_email/data_hora sao preenchidos
  -- automaticamente pelo trigger logs_auditoria_preencher_usuario
  -- (migration 0004), que tambem ja lanca excecao se nao houver sessao
  -- autenticada — nao duplicamos essa checagem aqui. Se qualquer um
  -- destes INSERTs falhar, a excecao propaga e o DELETE abaixo nunca
  -- executa, pois estao na mesma transacao implicita desta chamada.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao', p_registro_id::text, 'excluiu', 'motivo',
      null, p_motivo),
    ('producao', p_registro_id::text, 'excluiu', 'data',
      v_registro.data::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'turno',
      v_registro.turno, null),
    ('producao', p_registro_id::text, 'excluiu', 'receita_id',
      v_registro.receita_id::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'origem',
      v_registro.origem, null),
    ('producao', p_registro_id::text, 'excluiu', 'status',
      v_registro.status, null),
    ('producao', p_registro_id::text, 'excluiu', 'quantidade_produzida',
      v_registro.quantidade_produzida::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'quantidade_vendida',
      v_registro.quantidade_vendida::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'sobra_total',
      v_registro.sobra_total::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'sobra_aproveitavel',
      v_registro.sobra_aproveitavel::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'perda_descarte',
      v_registro.perda_descarte::text, null);

  delete from public.producao_registros where id = p_registro_id;
end;
$$;

comment on function public.excluir_producao_registro(uuid, text) is
  'Exclui definitivamente um registro de producao_registros, independente de origem (manual/retroativo/historico) ou status (aberto/fechado/reaberto). Restrita a administrador: checagem explicita de is_admin() no inicio da funcao (defesa em profundidade), alem da policy producao_registros_delete (tambem is_admin()) que e a garantia real via RLS, ja que esta funcao e SECURITY INVOKER. Motivo obrigatorio. Carrega o registro completo antes de excluir e grava um snapshot em logs_auditoria (uma linha por campo relevante, valor_anterior = valor que existia, valor_novo = null, mais uma linha do motivo) na MESMA transacao do DELETE — qualquer falha no log desfaz tudo, o DELETE nunca fica orfao de auditoria. Identificacao de quem excluiu (usuario_id/usuario_nome/usuario_email/data_hora) e responsabilidade do trigger logs_auditoria_preencher_usuario (migration 0004), reaproveitado sem duplicacao. Sem nenhum CASCADE: nenhuma tabela tem FK para producao_registros.id, confirmado por auditoria antes desta migration.';

revoke execute on function public.excluir_producao_registro(uuid, text) from public;
revoke execute on function public.excluir_producao_registro(uuid, text) from anon;
grant execute on function public.excluir_producao_registro(uuid, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: reverter esta migration NÃO restaura nenhum registro já
-- excluído por excluir_producao_registro — o DELETE já é definitivo por
-- natureza, o rollback só remove a CAPACIDADE de excluir novos registros
-- daqui pra frente (a policy e a função deixam de existir/voltam a
-- bloquear). O snapshot em logs_auditoria de exclusões já feitas
-- continua existindo (logs_auditoria não tem DELETE possível para
-- ninguém, por design da 0004) — é a única forma de recuperar o que foi
-- excluído, e é manual (não há função de "restaurar" nesta migration).
-- BEGIN;
--
--   revoke execute on function public.excluir_producao_registro(uuid, text) from authenticated;
--   drop function if exists public.excluir_producao_registro(uuid, text);
--
--   drop policy if exists producao_registros_delete on public.producao_registros;
--
-- COMMIT;
