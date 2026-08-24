-- 0017_producao_registros_retroativo_e_correcao.sql
--
-- Objetivo: fechar a lacuna operacional entre o fim da importação
-- histórica (12/08/2026) e a data atual, permitindo (a) lançar produção
-- real de um dia passado que nunca foi registrada no sistema (origem
-- nova 'retroativo'), inclusive quando ainda não se sabe a sobra
-- naquele momento, e (b) corrigir quantidade_produzida (+ sobra) de um
-- registro já fechado/reaberto de forma atômica e auditada, sem expor
-- ao usuário o estado técnico intermediário 'reaberto'.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Escrita do zero a partir do desenho
-- aprovado nesta conversa (não reaproveita nenhum bloco SQL mostrado
-- anteriormente no chat). Rodar manualmente no SQL Editor do Supabase,
-- depois de 0010, 0011, 0015 (producao_registros) e 0004
-- (logs_auditoria), todas já aplicadas.
--
-- Pré-requisitos reais (dependências de SQL):
--   * public.producao_registros e suas constraints/trigger — 0010, já
--     aplicada. Esta migration ALTERA 3 constraints (ver seção 1) e
--     REDEFINE a função da trigger producao_registros_protecao NÃO É
--     tocada nesta migration — nenhuma transição nova de status precisa
--     de checagem adicional na trigger (ver nota na seção 1).
--   * public.gerenciar_sobras_producao_registro — 0015, já aplicada.
--     Esta migration REDEFINE essa função (CREATE OR REPLACE, mesmo
--     nome/assinatura), mudando só a condição de origem que decide se
--     quantidade_vendida é recalculada.
--   * public.reabrir_producao_registro — 0011, já aplicada. Esta
--     migration REAPROVEITA essa função (chamada interna) dentro de
--     public.editar_producao_registro; não a redefine.
--   * public.logs_auditoria e o trigger logs_auditoria_preencher_usuario
--     — 0004, já aplicada. usuario_id/usuario_nome/usuario_email/
--     data_hora são preenchidos automaticamente por aquele trigger em
--     qualquer INSERT — nenhuma função desta migration seta esses
--     campos manualmente.
--   * public.has_permissao(text) e public.is_admin() — 0003, já
--     aplicadas.
--   * public.receitas.ativo — já existente (usada em pages/producao.js).
--
-- ESCOPO — SOMENTE public.producao_registros e as funções abaixo. Esta
-- migration NÃO faz, e não deve fazer:
--   * nenhuma alteração em planejamento_producao, receitas,
--     receita_ingredientes, usuarios, perfil_permissoes,
--     usuario_permissoes, ou em qualquer policy de RLS dessas tabelas
--     (frente paralela de Acessos/Permissões granulares, migration 0016
--     — já aplicada ao banco, tratada aqui como pré-existente e
--     intocável);
--   * nenhuma coluna nova, nenhum valor novo de status (o ciclo de vida
--     continua aberto/fechado/reaberto — 'aberto' passa a também
--     representar um retroativo ainda sem sobra conhecida, sem precisar
--     de um quarto valor);
--   * nenhuma alteração nas constraints producao_registros_
--     historico_nunca_aberto, producao_registros_vazio_apenas_quando_
--     aberto, producao_registros_soma_sobra, producao_registros_
--     slot_unico — todas as quatro já funcionam corretamente para a
--     origem 'retroativo' tal como estão hoje (auditado nesta conversa
--     antes de escrever este arquivo);
--   * nenhum código novo em lib/producao/sugestaoProducao.js nem em
--     nenhum arquivo de frontend — esta migration é só banco.
--
-- Por que cada função nova é SECURITY INVOKER (mesmo padrão de 0011/
-- 0015): o corpo roda com os privilégios e a sessão de quem chamou a
-- RPC, não do dono da função. As policies de RLS de producao_registros
-- (producao.visualizar/inserir/editar/cancelar) e a trigger
-- producao_registros_protecao continuam sendo avaliadas normalmente
-- para o usuário real — nenhuma função aqui contorna RLS.
--
-- Segurança de EXECUTE: REVOKE de PUBLIC e anon + GRANT só para
-- authenticated, explícitos, para as 3 funções novas e reafirmado (via
-- CREATE OR REPLACE + mesmos REVOKE/GRANT) na função redefinida.
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão e
-- CREATE OR REPLACE FUNCTION.

BEGIN;

-- ============================================================
-- 1. CHECK constraints — 3 alteradas, 4 explicitamente NÃO tocadas
-- ============================================================

-- 1.1 — origem ganha o valor 'retroativo'.
alter table public.producao_registros
  drop constraint if exists producao_registros_origem_check;

alter table public.producao_registros
  add constraint producao_registros_origem_check
  check (origem in ('manual', 'historico', 'retroativo'));

-- 1.2 — fechamento exige quantidade_vendida e sobra_total preenchidos:
-- hoje essa regra só se aplica literalmente a origem='manual'
-- (constraint 0015 herdou o nome "_manual" de 0010 e nunca foi
-- generalizada). Sem esta mudança, um registro retroativo poderia ficar
-- status='fechado' com vendida/sobra_total NULL, sem nenhuma constraint
-- barrando. Passa a valer para manual E retroativo; histórico continua
-- de fora (mantém sua regra própria, sem exigir esses campos).
alter table public.producao_registros
  drop constraint if exists producao_registros_campos_fechamento_obrigatorios_manual;

alter table public.producao_registros
  add constraint producao_registros_campos_fechamento_obrigatorios_manual
  check (
    origem not in ('manual', 'retroativo') or status <> 'fechado'
    or (quantidade_vendida is not null and sobra_total is not null)
  );

-- 1.3 — quantidade_vendida = quantidade_produzida - sobra_total: mesma
-- lacuna da 1.2 (literal origem <> 'manual', não gera erro para
-- 'retroativo' hoje). Passa a valer para manual E retroativo.
alter table public.producao_registros
  drop constraint if exists producao_registros_venda_consistente_manual;

alter table public.producao_registros
  add constraint producao_registros_venda_consistente_manual
  check (
    status <> 'fechado' or origem not in ('manual', 'retroativo')
    or quantidade_vendida is null or sobra_total is null
    or quantidade_vendida = quantidade_produzida - sobra_total
  );

-- 1.4 — NÃO alteradas nesta migration (auditadas e confirmadas
-- corretas para 'retroativo' tal como já estão, sem nenhum ALTER
-- TABLE aqui):
--   * producao_registros_historico_nunca_aberto
--       check (origem <> 'historico' or status in ('fechado','reaberto'))
--     -> só restringe 'historico'; 'manual' e 'retroativo' já ficam
--        livres para status='aberto' sem qualquer mudança.
--   * producao_registros_vazio_apenas_quando_aberto
--       check (status <> 'aberto' or (quantidade_vendida is null and
--         sobra_total is null and sobra_aproveitavel is null and
--         perda_descarte is null))
--     -> já agnóstica de origem; é ela quem garante que um retroativo
--        'aberto' nunca tem sobra/vendida inventada (NULL fica NULL).
--   * producao_registros_soma_sobra
--       check (sobra_total is null or (coalesce(sobra_aproveitavel,0)
--         + coalesce(perda_descarte,0)) <= sobra_total)
--     -> já agnóstica de origem/status.
--   * producao_registros_slot_unico
--       unique (data, turno, receita_id)
--     -> garantia definitiva de duplicidade; nenhuma das 3 funções
--        novas precisa (nem deve) reimplementar essa checagem — o
--        INSERT de lancar_producao_retroativa deixa o erro 23505
--        propagar para o chamador.
--
-- Nota sobre a trigger producao_registros_protecao (0015): nenhuma
-- branch nova é necessária nesta migration. A transição aberto->fechado
-- (usada por completar_producao_retroativa) já não é restringida por
-- nenhuma branch hoje — mesmo comportamento já válido para o primeiro
-- fechamento de um registro manual. As transições fechado->reaberto e
-- reaberto->fechado feitas dentro de editar_producao_registro passam
-- pela função reabrir_producao_registro (0011) e por um UPDATE direto
-- respectivamente; a trigger já protege a primeira (has_permissao(
-- 'producao.cancelar') / is_admin(), conforme origem) e a segunda cai
-- na branch "fechado->fechado" só depois que editar_producao_registro
-- já reabriu o registro — a checagem de permissão para ambas é feita
-- explicitamente dentro da própria função nova (ver seção 4), não
-- depende de nenhuma alteração na trigger.


-- ============================================================
-- 2. gerenciar_sobras_producao_registro (0015) — redefinida
-- ============================================================
-- Único ponto alterado: a condição que decide se quantidade_vendida é
-- recalculada passa de "origem = 'manual'" para "origem in ('manual',
-- 'retroativo')". Todo o resto do corpo é idêntico ao já aplicado em
-- 0015 — mesma normalização de sobra_total, mesmas validações, mesma
-- auditoria. origem='historico' continua no ramo ELSE, preservando
-- quantidade_vendida original, nunca recalculada.

create or replace function public.gerenciar_sobras_producao_registro(
  p_registro_id uuid,
  p_sobra_total integer,
  p_sobra_aproveitavel integer,
  p_perda_descarte integer,
  p_motivo text
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro_antes  public.producao_registros;
  v_registro_depois public.producao_registros;
  v_sobra_total_nova integer;
  v_vendida_nova     integer;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception
      'gerenciar_sobras_producao_registro: motivo e obrigatorio.';
  end if;

  select * into v_registro_antes
  from public.producao_registros
  where id = p_registro_id;

  if v_registro_antes.id is null then
    raise exception
      'gerenciar_sobras_producao_registro: registro % nao encontrado.', p_registro_id;
  end if;

  if p_sobra_total is not null then
    v_sobra_total_nova := p_sobra_total;
  elsif p_sobra_aproveitavel is not null or p_perda_descarte is not null then
    v_sobra_total_nova := coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0);
  else
    raise exception
      'gerenciar_sobras_producao_registro: informe ao menos sobra_total, ou sobra_aproveitavel/perda_descarte para calcula-la automaticamente.';
  end if;

  if v_sobra_total_nova < 0 then
    raise exception
      'gerenciar_sobras_producao_registro: sobra_total nao pode ser negativa.';
  end if;

  if p_sobra_aproveitavel is not null and p_sobra_aproveitavel < 0 then
    raise exception
      'gerenciar_sobras_producao_registro: sobra_aproveitavel nao pode ser negativa.';
  end if;

  if p_perda_descarte is not null and p_perda_descarte < 0 then
    raise exception
      'gerenciar_sobras_producao_registro: perda_descarte nao pode ser negativa.';
  end if;

  if (coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0)) > v_sobra_total_nova then
    raise exception
      'gerenciar_sobras_producao_registro: sobra_aproveitavel + perda_descarte (%) nao pode ultrapassar sobra_total (%).',
      coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0), v_sobra_total_nova;
  end if;

  -- (0017) 'retroativo' passa a ter o MESMO comportamento de 'manual'
  -- nesta função. 'historico' permanece no ramo ELSE, inalterado.
  if v_registro_antes.origem in ('manual', 'retroativo') then
    if v_sobra_total_nova > v_registro_antes.quantidade_produzida then
      raise exception
        'gerenciar_sobras_producao_registro: sobra_total (%) nao pode ser maior que quantidade_produzida (%).',
        v_sobra_total_nova, v_registro_antes.quantidade_produzida;
    end if;

    v_vendida_nova := v_registro_antes.quantidade_produzida - v_sobra_total_nova;
  else
    -- historico: quantidade_vendida preservada como esta, nunca
    -- recalculada — nao reescrevemos artificialmente dado historico real.
    v_vendida_nova := v_registro_antes.quantidade_vendida;
  end if;

  update public.producao_registros
  set sobra_total = v_sobra_total_nova,
      sobra_aproveitavel = p_sobra_aproveitavel,
      perda_descarte = p_perda_descarte,
      quantidade_vendida = v_vendida_nova,
      atualizado_em = current_timestamp
  where id = p_registro_id
  returning * into v_registro_depois;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'motivo',
      null, p_motivo),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'sobra_total',
      v_registro_antes.sobra_total::text, v_registro_depois.sobra_total::text),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'sobra_aproveitavel',
      v_registro_antes.sobra_aproveitavel::text, v_registro_depois.sobra_aproveitavel::text),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'perda_descarte',
      v_registro_antes.perda_descarte::text, v_registro_depois.perda_descarte::text),
    ('producao', p_registro_id::text, 'gerenciou_sobras', 'quantidade_vendida',
      v_registro_antes.quantidade_vendida::text, v_registro_depois.quantidade_vendida::text);

  return v_registro_depois;
end;
$$;

comment on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) is
  '[0015, inalterado, exceto:] (0017) origem in (''manual'',''retroativo'') recalcula quantidade_vendida = quantidade_produzida - sobra_total; origem=''historico'' continua preservando quantidade_vendida original, nunca recalculada.';

revoke execute on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) from public;
revoke execute on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) from anon;
grant execute on function public.gerenciar_sobras_producao_registro(uuid, integer, integer, integer, text) to authenticated;


-- ============================================================
-- 3. public.lancar_producao_retroativa — nova
-- ============================================================
-- Cria um registro producao_registros com origem='retroativo', para uma
-- data estritamente anterior a hoje. Sobra é OPCIONAL: se os 3
-- parâmetros de sobra vierem NULL, o registro nasce status='aberto' com
-- sobra_total/sobra_aproveitavel/perda_descarte/quantidade_vendida
-- todos NULL (nunca inventa 0) — a constraint
-- producao_registros_vazio_apenas_quando_aberto garante isso também no
-- banco. Se houver informação suficiente para determinar sobra_total
-- (diretamente ou via soma de aproveitavel+perda), o registro já nasce
-- status='fechado' com quantidade_vendida calculada.

create or replace function public.lancar_producao_retroativa(
  p_data date,
  p_turno text,
  p_receita_id uuid,
  p_quantidade_produzida integer,
  p_sobra_total integer,
  p_sobra_aproveitavel integer,
  p_perda_descarte integer,
  p_observacao text
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro public.producao_registros;
  v_sobra_total_nova integer;
  v_vendida integer;
  v_status text;
begin
  if p_data is null or p_data >= current_date then
    raise exception
      'lancar_producao_retroativa: producoes do dia atual devem ser lancadas pela Tela Hoje.';
  end if;

  if p_turno not in ('manha', 'tarde') then
    raise exception 'lancar_producao_retroativa: turno invalido.';
  end if;

  if p_receita_id is null or not exists (
    select 1 from public.receitas where id = p_receita_id and ativo = true
  ) then
    raise exception
      'lancar_producao_retroativa: produto % nao existe ou nao esta ativo.', p_receita_id;
  end if;

  if p_quantidade_produzida is null or p_quantidade_produzida <= 0 then
    raise exception 'lancar_producao_retroativa: quantidade_produzida deve ser maior que zero.';
  end if;

  if p_sobra_total is null and p_sobra_aproveitavel is null and p_perda_descarte is null then
    -- nenhuma informacao de sobra ainda disponivel: registro nasce
    -- incompleto, aguardando complementacao futura via
    -- completar_producao_retroativa. Nao inventa sobra_total=0 nem
    -- quantidade_vendida.
    v_sobra_total_nova := null;
    v_vendida := null;
    v_status := 'aberto';
  else
    if p_sobra_total is not null then
      v_sobra_total_nova := p_sobra_total;
    else
      v_sobra_total_nova := coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0);
    end if;

    if v_sobra_total_nova < 0 or v_sobra_total_nova > p_quantidade_produzida then
      raise exception
        'lancar_producao_retroativa: sobra_total invalida para a quantidade_produzida informada.';
    end if;

    if p_sobra_aproveitavel is not null and p_sobra_aproveitavel < 0 then
      raise exception 'lancar_producao_retroativa: sobra_aproveitavel nao pode ser negativa.';
    end if;

    if p_perda_descarte is not null and p_perda_descarte < 0 then
      raise exception 'lancar_producao_retroativa: perda_descarte nao pode ser negativa.';
    end if;

    if (coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0)) > v_sobra_total_nova then
      raise exception
        'lancar_producao_retroativa: sobra_aproveitavel + perda_descarte nao pode ultrapassar sobra_total.';
    end if;

    v_vendida := p_quantidade_produzida - v_sobra_total_nova;
    v_status := 'fechado';
  end if;

  -- producao_registros_slot_unico (data, turno, receita_id) e a unica
  -- protecao de duplicidade — nao reimplementada aqui. Uma violacao
  -- propaga como erro 23505 para o chamador.
  insert into public.producao_registros (
    data, turno, receita_id, origem, status,
    quantidade_produzida, quantidade_vendida,
    sobra_total, sobra_aproveitavel, perda_descarte, observacoes
  ) values (
    p_data, p_turno, p_receita_id, 'retroativo', v_status,
    p_quantidade_produzida, v_vendida,
    v_sobra_total_nova, p_sobra_aproveitavel, p_perda_descarte, p_observacao
  )
  returning * into v_registro;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao', v_registro.id::text, 'lancou_retroativo', 'quantidade_produzida', null, p_quantidade_produzida::text),
    ('producao', v_registro.id::text, 'lancou_retroativo', 'status_inicial', null, v_status);

  if v_status = 'fechado' then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values
      ('producao', v_registro.id::text, 'lancou_retroativo', 'sobra_total', null, v_sobra_total_nova::text),
      ('producao', v_registro.id::text, 'lancou_retroativo', 'quantidade_vendida', null, v_vendida::text);
  end if;

  return v_registro;
end;
$$;

comment on function public.lancar_producao_retroativa(date, text, uuid, integer, integer, integer, integer, text) is
  'Cria um registro producao_registros com origem=retroativo, para uma data estritamente anterior a hoje (producoes do dia atual pertencem a Tela Hoje). Sobra e opcional: se sobra_total/sobra_aproveitavel/perda_descarte vierem todos NULL, o registro nasce status=aberto com esses campos e quantidade_vendida NULL (nunca inventa zero) — completar_producao_retroativa fecha o registro depois. Se houver informacao suficiente de sobra, nasce ja status=fechado com quantidade_vendida = quantidade_produzida - sobra_total. Exige produto ativo. producao_registros_slot_unico (data,turno,receita_id) e a garantia de duplicidade, nao duplicada aqui. SECURITY INVOKER: passa pela policy producao_registros_insert (producao.inserir).';

revoke execute on function public.lancar_producao_retroativa(date, text, uuid, integer, integer, integer, integer, text) from public;
revoke execute on function public.lancar_producao_retroativa(date, text, uuid, integer, integer, integer, integer, text) from anon;
grant execute on function public.lancar_producao_retroativa(date, text, uuid, integer, integer, integer, integer, text) to authenticated;


-- ============================================================
-- 4. public.completar_producao_retroativa — nova
-- ============================================================
-- Completa e fecha um registro retroativo que nasceu sem sobra
-- conhecida (origem='retroativo', status='aberto'). Só essa combinação
-- e aceita — qualquer outro caso e rejeitado, apontando para a funcao
-- correta (gerenciar_sobras_producao_registro para um retroativo ja
-- fechado; editar_producao_registro para correcao estrutural). Exige
-- so producao.editar (via RLS) — nao exige motivo nem producao.
-- cancelar, pois esta e a primeira consolidacao normal do dado, nao uma
-- correcao de algo ja fechado (mesmo padrao ja usado pelo primeiro
-- fechamento de um registro manual, que tambem nao exige motivo).

create or replace function public.completar_producao_retroativa(
  p_registro_id uuid,
  p_sobra_total integer,
  p_sobra_aproveitavel integer,
  p_perda_descarte integer
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes  public.producao_registros;
  v_depois public.producao_registros;
  v_sobra_total_nova integer;
  v_vendida integer;
begin
  select * into v_antes from public.producao_registros where id = p_registro_id;

  if v_antes.id is null then
    raise exception
      'completar_producao_retroativa: registro % nao encontrado.', p_registro_id;
  end if;

  if v_antes.origem <> 'retroativo' or v_antes.status <> 'aberto' then
    raise exception
      'completar_producao_retroativa: esta operacao so se aplica a um lancamento retroativo ainda pendente de sobra (origem=retroativo, status=aberto). Para um registro ja fechado, use gerenciar_sobras_producao_registro (so sobra) ou editar_producao_registro (correcao estrutural).';
  end if;

  if p_sobra_total is not null then
    v_sobra_total_nova := p_sobra_total;
  elsif p_sobra_aproveitavel is not null or p_perda_descarte is not null then
    v_sobra_total_nova := coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0);
  else
    raise exception
      'completar_producao_retroativa: informe ao menos a sobra total, ou sobra_aproveitavel/perda_descarte para calcula-la automaticamente.';
  end if;

  if v_sobra_total_nova < 0 or v_sobra_total_nova > v_antes.quantidade_produzida then
    raise exception
      'completar_producao_retroativa: sobra_total (%) invalida para a quantidade_produzida (%) do registro.',
      v_sobra_total_nova, v_antes.quantidade_produzida;
  end if;

  if p_sobra_aproveitavel is not null and p_sobra_aproveitavel < 0 then
    raise exception 'completar_producao_retroativa: sobra_aproveitavel nao pode ser negativa.';
  end if;

  if p_perda_descarte is not null and p_perda_descarte < 0 then
    raise exception 'completar_producao_retroativa: perda_descarte nao pode ser negativa.';
  end if;

  if (coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0)) > v_sobra_total_nova then
    raise exception
      'completar_producao_retroativa: sobra_aproveitavel + perda_descarte nao pode ultrapassar sobra_total.';
  end if;

  v_vendida := v_antes.quantidade_produzida - v_sobra_total_nova;

  update public.producao_registros
  set sobra_total = v_sobra_total_nova,
      sobra_aproveitavel = p_sobra_aproveitavel,
      perda_descarte = p_perda_descarte,
      quantidade_vendida = v_vendida,
      status = 'fechado',
      atualizado_em = current_timestamp
  where id = p_registro_id
  returning * into v_depois;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao', p_registro_id::text, 'completou_retroativo', 'sobra_total', null, v_sobra_total_nova::text),
    ('producao', p_registro_id::text, 'completou_retroativo', 'sobra_aproveitavel', null, p_sobra_aproveitavel::text),
    ('producao', p_registro_id::text, 'completou_retroativo', 'perda_descarte', null, p_perda_descarte::text),
    ('producao', p_registro_id::text, 'completou_retroativo', 'quantidade_vendida', null, v_vendida::text);

  return v_depois;
end;
$$;

comment on function public.completar_producao_retroativa(uuid, integer, integer, integer) is
  'Completa e fecha um registro origem=retroativo que nasceu sem sobra conhecida (status=aberto): calcula sobra_total (direto ou via soma aproveitavel+perda), calcula quantidade_vendida = quantidade_produzida - sobra_total, muda status para fechado. So aceita origem=retroativo e status=aberto — qualquer outra combinacao e rejeitada com mensagem apontando para a funcao correta. Nao exige motivo nem producao.cancelar (primeira consolidacao normal do dado, nao correcao). SECURITY INVOKER: o UPDATE roda como o usuario chamador, exigindo so has_permissao(producao.editar) via a policy producao_registros_update ja existente.';

revoke execute on function public.completar_producao_retroativa(uuid, integer, integer, integer) from public;
revoke execute on function public.completar_producao_retroativa(uuid, integer, integer, integer) from anon;
grant execute on function public.completar_producao_retroativa(uuid, integer, integer, integer) to authenticated;


-- ============================================================
-- 5. public.editar_producao_registro — nova
-- ============================================================
-- Corrige quantidade_produzida/sobra_total/sobra_aproveitavel/
-- perda_descarte de um registro ja fechado OU ja reaberto,
-- atomicamente, sem expor ao usuario o estado tecnico intermediario
-- 'reaberto'. produto/data/turno permanecem IMUTAVEIS por esta funcao
-- (nao sao parametros — estruturalmente impossivel altera-los aqui).
-- Exige motivo obrigatorio e, para origem<>'historico', has_permissao(
-- 'producao.cancelar'); para origem='historico', is_admin() — checagem
-- explicita e incondicional dentro da propria funcao (a acao "editar
-- producao" e sempre tratada como correcao estrutural, mesmo que o
-- valor final coincida com o anterior). Se o registro estiver
-- 'fechado', reabre internamente reaproveitando reabrir_producao_
-- registro (0011) — sua propria checagem de permissao e seu proprio
-- log de auditoria "reabriu" acontecem normalmente, com o mesmo motivo
-- informado — antes de aplicar a correcao e fechar de novo. Se ja
-- estiver 'reaberto' (ex.: o lancamento pendente de 13/08), aplica a
-- correcao e fecha diretamente. Tudo dentro da mesma transacao
-- implicita da funcao: qualquer excecao no meio desfaz tudo, inclusive
-- a reabertura interna.

create or replace function public.editar_producao_registro(
  p_registro_id uuid,
  p_quantidade_produzida integer,
  p_sobra_total integer,
  p_sobra_aproveitavel integer,
  p_perda_descarte integer,
  p_motivo text
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes  public.producao_registros;
  v_depois public.producao_registros;
  v_sobra_total_nova integer;
  v_vendida integer;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'editar_producao_registro: motivo e obrigatorio.';
  end if;

  select * into v_antes from public.producao_registros where id = p_registro_id;
  if v_antes.id is null then
    raise exception 'editar_producao_registro: registro % nao encontrado.', p_registro_id;
  end if;

  if v_antes.status not in ('fechado', 'reaberto') then
    raise exception
      'editar_producao_registro: registro % esta com status=%; esta operacao so se aplica a um registro fechado ou reaberto.',
      p_registro_id, v_antes.status;
  end if;

  -- Permissao explicita e incondicional: "Editar producao" e sempre
  -- tratada como correcao estrutural. A trigger producao_registros_
  -- protecao tambem valida (defesa em profundidade) quando os UPDATEs
  -- abaixo forem executados, mas esta checagem nao depende dela.
  if v_antes.origem = 'historico' then
    if not (select public.is_admin()) then
      raise exception
        'editar_producao_registro: editar producao de um registro historico (%) requer administrador.', p_registro_id;
    end if;
  else
    if not (select public.has_permissao('producao.cancelar')) then
      raise exception
        'editar_producao_registro: editar producao do registro % requer a permissao producao.cancelar.', p_registro_id;
    end if;
  end if;

  if p_quantidade_produzida is null or p_quantidade_produzida <= 0 then
    raise exception 'editar_producao_registro: quantidade_produzida deve ser maior que zero.';
  end if;

  if p_sobra_total is not null then
    v_sobra_total_nova := p_sobra_total;
  elsif p_sobra_aproveitavel is not null or p_perda_descarte is not null then
    v_sobra_total_nova := coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0);
  else
    raise exception 'editar_producao_registro: informe ao menos a sobra total.';
  end if;

  if v_sobra_total_nova < 0 or v_sobra_total_nova > p_quantidade_produzida then
    raise exception
      'editar_producao_registro: sobra_total invalida para a quantidade_produzida informada.';
  end if;

  if p_sobra_aproveitavel is not null and p_sobra_aproveitavel < 0 then
    raise exception 'editar_producao_registro: sobra_aproveitavel nao pode ser negativa.';
  end if;

  if p_perda_descarte is not null and p_perda_descarte < 0 then
    raise exception 'editar_producao_registro: perda_descarte nao pode ser negativa.';
  end if;

  if (coalesce(p_sobra_aproveitavel, 0) + coalesce(p_perda_descarte, 0)) > v_sobra_total_nova then
    raise exception
      'editar_producao_registro: sobra_aproveitavel + perda_descarte nao pode ultrapassar sobra_total.';
  end if;

  -- Correcao estrutural explicita: quantidade_vendida e sempre
  -- recalculada aqui para as 3 origens (inclusive historico) — o
  -- proprio ato de corrigir quantidade_produzida invalida o vendida
  -- anterior. Diferente de gerenciar_sobras_producao_registro, que so
  -- ajusta sobra de um registro cuja quantidade_produzida nao mudou e
  -- por isso preserva vendida do historico.
  v_vendida := p_quantidade_produzida - v_sobra_total_nova;

  -- Transicao tecnica invisivel: se ja estava fechado, reabre primeiro
  -- (reaproveita a funcao existente — sua propria checagem de permissao
  -- e auditoria "reabriu" acontecem aqui, com o mesmo motivo).
  if v_antes.status = 'fechado' then
    perform public.reabrir_producao_registro(p_registro_id, p_motivo);
  end if;

  update public.producao_registros
  set quantidade_produzida = p_quantidade_produzida,
      quantidade_vendida = v_vendida,
      sobra_total = v_sobra_total_nova,
      sobra_aproveitavel = p_sobra_aproveitavel,
      perda_descarte = p_perda_descarte,
      status = 'fechado',
      atualizado_em = current_timestamp
  where id = p_registro_id
  returning * into v_depois;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('producao', p_registro_id::text, 'editou_producao', 'motivo', null, p_motivo);

  if v_antes.quantidade_produzida is distinct from v_depois.quantidade_produzida then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao', p_registro_id::text, 'editou_producao', 'quantidade_produzida',
      v_antes.quantidade_produzida::text, v_depois.quantidade_produzida::text);
  end if;

  if v_antes.quantidade_vendida is distinct from v_depois.quantidade_vendida then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao', p_registro_id::text, 'editou_producao', 'quantidade_vendida',
      v_antes.quantidade_vendida::text, v_depois.quantidade_vendida::text);
  end if;

  if v_antes.sobra_total is distinct from v_depois.sobra_total then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao', p_registro_id::text, 'editou_producao', 'sobra_total',
      v_antes.sobra_total::text, v_depois.sobra_total::text);
  end if;

  if v_antes.sobra_aproveitavel is distinct from v_depois.sobra_aproveitavel then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao', p_registro_id::text, 'editou_producao', 'sobra_aproveitavel',
      v_antes.sobra_aproveitavel::text, v_depois.sobra_aproveitavel::text);
  end if;

  if v_antes.perda_descarte is distinct from v_depois.perda_descarte then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao', p_registro_id::text, 'editou_producao', 'perda_descarte',
      v_antes.perda_descarte::text, v_depois.perda_descarte::text);
  end if;

  return v_depois;
end;
$$;

comment on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) is
  'Corrige quantidade_produzida/sobra_total/sobra_aproveitavel/perda_descarte de um registro fechado ou reaberto, atomicamente, sem expor o estado intermediario reaberto ao usuario. Recalcula quantidade_vendida sempre (todas as origens, inclusive historico). produto/data/turno IMUTAVEIS por esta funcao (nao sao parametros). Exige is_admin() para origem=historico, producao.cancelar para manual/retroativo — checagem explicita e incondicional, alem da defesa em profundidade ja existente na trigger producao_registros_protecao. Reaproveita reabrir_producao_registro quando o registro ja esta fechado. Motivo obrigatorio. Audita apenas os campos que de fato mudaram.';

revoke execute on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) from public;
revoke execute on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) from anon;
grant execute on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Mecanicamente executavel, MAS deixa de ser seguro do ponto de vista
-- de DADO assim que lancar_producao_retroativa / completar_producao_
-- retroativa / editar_producao_registro comecarem a ser usadas de
-- verdade: reverter as functions/constraints NAO apaga nem desfaz
-- nenhum registro origem='retroativo' ja criado, nem nenhuma correcao
-- ja aplicada por editar_producao_registro — esses dados continuam na
-- tabela, so as funcoes que os criaram deixam de existir. Confirmar que
-- nao ha uso real antes de rodar.
--
-- BEGIN;
--
--   drop function if exists public.editar_producao_registro(uuid, integer, integer, integer, integer, text);
--   drop function if exists public.completar_producao_retroativa(uuid, integer, integer, integer);
--   drop function if exists public.lancar_producao_retroativa(date, text, uuid, integer, integer, integer, integer, text);
--
--   -- Restaura gerenciar_sobras_producao_registro para o texto exato de 0015
--   -- (origem = 'manual' literal) — copiar o CREATE OR REPLACE de
--   -- 0015_producao_registros_gestao_sobras.sql linhas 223-333 aqui, sem
--   -- reescrever de memoria.
--
--   alter table public.producao_registros
--     drop constraint if exists producao_registros_venda_consistente_manual;
--   alter table public.producao_registros
--     add constraint producao_registros_venda_consistente_manual
--     check (
--       status <> 'fechado' or origem <> 'manual'
--       or quantidade_vendida is null or sobra_total is null
--       or quantidade_vendida = quantidade_produzida - sobra_total
--     );
--
--   alter table public.producao_registros
--     drop constraint if exists producao_registros_campos_fechamento_obrigatorios_manual;
--   alter table public.producao_registros
--     add constraint producao_registros_campos_fechamento_obrigatorios_manual
--     check (
--       origem <> 'manual' or status <> 'fechado'
--       or (quantidade_vendida is not null and sobra_total is not null)
--     );
--
--   -- CUIDADO: só reverter a origem_check se NENHUM registro
--   -- origem='retroativo' existir mais na tabela (senão a ALTER falha
--   -- com violação de constraint) — confirmar com
--   -- select count(*) from public.producao_registros where origem = 'retroativo';
--   alter table public.producao_registros
--     drop constraint if exists producao_registros_origem_check;
--   alter table public.producao_registros
--     add constraint producao_registros_origem_check
--     check (origem in ('manual', 'historico'));
--
-- COMMIT;
