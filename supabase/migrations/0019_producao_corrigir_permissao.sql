-- 0019_producao_corrigir_permissao.sql
-- Introduz o codigo de permissao producao.corrigir: autoriza corrigir
-- quantidade_produzida (+ sobra/venda consequente) de um registro
-- manual/retroativo ja fechado ou reaberto, pelo fluxo editar_producao_
-- registro, SEM nunca provocar fechado->reaberto e SEM nunca alterar a
-- identidade estrutural do registro (receita_id/data/turno/origem/
-- custo_producao) -- essas garantias sao da propria trigger, nao apenas
-- da RPC ou do frontend.
--
-- Fecha tambem uma lacuna real encontrada em auditoria: a transicao
-- reaberto->fechado, usada pela propria editar_producao_registro (0017),
-- nao tinha ATE AGORA nenhuma branch de protecao na trigger contra
-- alterar campos protegidos -- um UPDATE direto (fora da RPC) por
-- qualquer usuario com so producao.editar conseguiria corrigir
-- quantidade_produzida/receita/data/turno/custo de um registro reaberto
-- sem precisar de producao.cancelar. Essa lacuna e fechada aqui porque a
-- nova branch de producao.corrigir precisa exatamente deste ponto.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Escrita do zero no scratchpad a partir
-- do desenho aprovado nesta conversa (com o refinamento de identidade
-- estrutural pedido na ultima rodada) -- nao reaproveita texto de
-- nenhuma resposta anterior sem reconferir contra o arquivo fisico.
--
-- Pre-requisitos reais (dependencias de SQL, todas ja aplicadas ao vivo):
--   * public.producao_registros e sua trigger producao_registros_protecao
--     -- versao hoje ao vivo e a da 0015 (a 0017 NAO redefiniu a trigger,
--     conferido lendo o arquivo fisico 0015_producao_registros_gestao_
--     sobras.sql, que e o texto ainda vigente). Esta migration REDEFINE
--     essa funcao (CREATE OR REPLACE, mesma trigger ja instalada, nao
--     recriada).
--   * public.editar_producao_registro -- definida na 0017 (aplicada ao
--     vivo, ainda nao versionada como arquivo fisico em
--     supabase/migrations/, mas confirmada aplicada por voce apos a
--     consulta de pos-execucao daquela migration). Esta migration
--     REDEFINE essa funcao (CREATE OR REPLACE, mesma assinatura).
--   * public.has_permissao(text) e public.is_admin() -- 0003/0016, ja
--     aplicadas (0016 ja e arquivo fisico presente em
--     supabase/migrations/).
--   * public.reabrir_producao_registro -- 0011, ja aplicada e ja
--     versionada. Reaproveitada sem alteracao.
--
-- ESCOPO -- SOMENTE:
--   * 1 INSERT no catalogo public.permissoes (producao.corrigir) --
--     NENHUM insert em perfil_permissoes (nenhum perfil recebe por
--     padrao, mesma decisao conservadora da 0016 para codigos novos;
--     concessao e so via usuario_permissoes, bootstrap manual e
--     separado, feito depois da validacao desta migration);
--   * redefinicao de producao_registros_protecao() (2 branches
--     alteradas -- fechado->fechado e a nova reaberto->fechado; a
--     branch fechado->reaberto permanece BYTE-A-BYTE identica);
--   * redefinicao de editar_producao_registro() (permissao ampliada
--     para cancelar OU corrigir; decide se chama reabrir_producao_
--     registro conforme o tier do chamador).
-- Esta migration NAO faz: nenhuma tabela nova, nenhuma coluna nova,
-- nenhuma alteracao em RLS/policies, nenhuma alteracao em
-- lancar_producao_retroativa/completar_producao_retroativa/gerenciar_
-- sobras_producao_registro, nenhuma alteracao em receitas/
-- receita_ingredientes/planejamento_producao/usuarios/perfil_permissoes/
-- usuario_permissoes, nenhum arquivo da frente paralela de Usuarios e
-- Acessos (matriz de permissoes ainda nao existe neste working tree --
-- coordenacao fica para depois).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao e
-- CREATE OR REPLACE FUNCTION.

BEGIN;

-- ============================================================
-- 1. SEED -- novo codigo no catalogo de permissoes
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('producao.corrigir', 'producao', 'corrigir',
   'Corrige quantidade_produzida (+ sobra/venda consequente) de um registro manual/retroativo ja fechado ou reaberto, via editar_producao_registro. Nunca provoca fechado->reaberto (nao concede reabertura). Nunca altera receita_id/data/turno/origem/custo_producao -- so producao.editar + esta permissao, sem producao.cancelar.')
on conflict (codigo) do nothing;

-- Nenhum perfil recebe por padrao (mesma decisao conservadora da 0016
-- para codigos novos). Concessao e individual, via usuario_permissoes,
-- feita manualmente depois da validacao desta migration -- fora de
-- escopo aqui.


-- ============================================================
-- 2. producao_registros_protecao() -- redefinida
-- ============================================================
-- Alteracoes reais frente ao texto hoje ao vivo (0015):
--   a) branch fechado->fechado ganha uma excecao estreita: producao.
--      corrigir permite corrigir quantidade_produzida SEM reabertura,
--      SE E SOMENTE SE receita_id/data/turno/origem/custo_producao
--      permanecerem exatamente iguais (checado linha a linha contra o
--      valor anterior);
--   b) nova branch reaberto->fechado (lacuna fechada): historico exige
--      is_admin(); manual/retroativo exigem producao.cancelar OU
--      producao.corrigir; em QUALQUER dos casos (inclusive is_admin()),
--      receita_id/data/turno/origem/custo_producao tem que permanecer
--      exatamente iguais -- nem cancelar nem is_admin() autorizam trocar
--      a identidade estrutural do registro nesta transicao.
-- A branch fechado->reaberto (reabertura classica) NAO MUDA UMA LINHA --
-- producao.corrigir nunca e consultado nela, textualmente.

create or replace function public.producao_registros_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campos_protegidos_alterados boolean;
  v_campos_sobra_alterados boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'reaberto' then
      raise exception
        'producao_registros: nao e permitido inserir um registro diretamente com status = reaberto.';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' a partir daqui.

  if new.origem <> old.origem then
    raise exception
      'producao_registros: origem e imutavel apos o INSERT (registro %).', old.id;
  end if;

  if new.status = 'aberto' and old.status <> 'aberto' then
    raise exception
      'producao_registros: nao e permitido voltar o registro % para o status aberto.', old.id;
  end if;

  if new.status = 'reaberto' and old.status not in ('fechado', 'reaberto') then
    raise exception
      'producao_registros: so e possivel reabrir um registro que esteja fechado (registro %).', old.id;
  end if;

  -- campos protegidos: só mudam via reabertura formal (producao.cancelar)
  -- ou via a excecao estreita de producao.corrigir (nunca junto com
  -- receita/data/turno/origem/custo -- ver checagens de identidade
  -- estrutural abaixo, em cada branch que consulta producao.corrigir).
  v_campos_protegidos_alterados :=
    new.quantidade_produzida <> old.quantidade_produzida
    or new.receita_id <> old.receita_id
    or new.data <> old.data
    or new.turno <> old.turno
    or new.custo_producao is distinct from old.custo_producao;

  -- campos de sobra: podem mudar com o registro fechado, via a ação
  -- "gerenciar sobras" (gate de permissão feito mais abaixo).
  v_campos_sobra_alterados :=
    new.quantidade_vendida is distinct from old.quantidade_vendida
    or new.sobra_total is distinct from old.sobra_total
    or new.sobra_aproveitavel is distinct from old.sobra_aproveitavel
    or new.perda_descarte is distinct from old.perda_descarte;

  -- ============================================================
  -- fechado -> reaberto (reabertura classica) -- INTOCADA pela 0019.
  -- producao.corrigir nao aparece aqui, textualmente.
  -- ============================================================
  if old.status = 'fechado' and new.status = 'reaberto' then
    if new.origem = 'historico' then
      if not (select public.is_admin()) then
        raise exception
          'producao_registros: reabertura de registro historico (%) requer administrador (procedimento extraordinario).', old.id;
      end if;
    else
      if not (select public.has_permissao('producao.cancelar')) then
        raise exception
          'producao_registros: reabertura do registro % requer a permissao producao.cancelar.', old.id;
      end if;
    end if;

    -- separacao atomica: o UPDATE de reabertura em si nao corrige dado
    -- nenhum (nem estrutural, nem de sobra), so muda o status (e, se
    -- quiser, atualizado_em/observacoes).
    if v_campos_protegidos_alterados or v_campos_sobra_alterados then
      raise exception
        'producao_registros: a reabertura do registro % deve alterar somente o status (e atualizado_em); corrija os demais campos em um UPDATE separado, feito depois, com o registro ja em status = reaberto.', old.id;
    end if;
  end if;

  -- ============================================================
  -- fechado -> fechado
  -- ============================================================
  if old.status = 'fechado' and new.status = 'fechado' then
    if v_campos_protegidos_alterados then
      -- (0019) excecao estreita: producao.corrigir permite corrigir
      -- quantidade_produzida SEM passar por reabertura, desde que a
      -- identidade estrutural do registro permaneça EXATAMENTE igual --
      -- checado linha a linha contra old.*, nunca confiado do chamador.
      if new.origem <> 'historico'
         and (select public.has_permissao('producao.corrigir'))
         and new.receita_id = old.receita_id
         and new.data = old.data
         and new.turno = old.turno
         and new.origem = old.origem
         and new.custo_producao is not distinct from old.custo_producao
      then
        null; -- autorizado: so quantidade_produzida (e sobra/venda consequentes) mudou
      else
        raise exception
          'producao_registros: registro % esta fechado; reabra-o (producao.cancelar ou administrador, conforme a origem) antes de editar quantidade_produzida/receita/data/turno/custo — ou use producao.corrigir para alterar somente quantidade_produzida sem reabrir.', old.id;
      end if;
    end if;

    if v_campos_sobra_alterados and new.origem = 'historico' then
      if not (select public.is_admin()) then
        raise exception
          'producao_registros: gerenciar sobras de um registro historico (%) fechado requer administrador.', old.id;
      end if;
    end if;
  end if;

  -- ============================================================
  -- reaberto -> fechado (0019: NOVA branch -- fecha a lacuna encontrada
  -- em auditoria; ate aqui esta transicao nao tinha NENHUMA protecao).
  -- Historico exige is_admin(); manual/retroativo exigem producao.
  -- cancelar OU producao.corrigir. Em QUALQUER caso (inclusive is_admin()
  -- para historico), a identidade estrutural do registro tem que
  -- permanecer EXATAMENTE igual -- nem cancelar nem is_admin() autorizam
  -- trocar receita/data/turno/origem/custo durante o fechamento; so
  -- quantidade_produzida e os campos de sobra/venda podem mudar.
  -- ============================================================
  if old.status = 'reaberto' and new.status = 'fechado' then
    if v_campos_protegidos_alterados then
      if new.origem = 'historico' then
        if not (select public.is_admin()) then
          raise exception
            'producao_registros: corrigir dados estruturais de registro historico (%) requer administrador.', old.id;
        end if;
      else
        if not (
          (select public.has_permissao('producao.cancelar'))
          or (select public.has_permissao('producao.corrigir'))
        ) then
          raise exception
            'producao_registros: corrigir dados estruturais do registro % requer producao.cancelar ou producao.corrigir.', old.id;
        end if;
      end if;

      -- identidade estrutural protegida SEMPRE nesta transicao,
      -- independente de qual autorizacao acima foi usada.
      if new.receita_id <> old.receita_id
         or new.data <> old.data
         or new.turno <> old.turno
         or new.origem <> old.origem
         or new.custo_producao is distinct from old.custo_producao then
        raise exception
          'producao_registros: a correcao do registro % (reaberto->fechado) nao pode alterar receita_id/data/turno/origem/custo_producao — somente quantidade_produzida e os campos de sobra/venda.', old.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.producao_registros_protecao() is
  'BEFORE INSERT/UPDATE trigger de producao_registros. [0010/0015, inalterado] Bloqueia INSERT direto com status=reaberto; torna origem imutavel; restringe transicoes de status; fechado->reaberto exige producao.cancelar (manual/retroativo) ou is_admin() (historico), alterando so status/atualizado_em; fechado->fechado bloqueia campos protegidos (exceto excecao 0019 abaixo) e exige is_admin() extra para sobra de historico. (0019) fechado->fechado ganha excecao estreita: producao.corrigir corrige quantidade_produzida sem reabertura, somente se receita_id/data/turno/origem/custo_producao permanecerem identicos. (0019) NOVA branch reaberto->fechado: historico exige is_admin(), manual/retroativo exigem producao.cancelar OU producao.corrigir — em ambos os casos, receita_id/data/turno/origem/custo_producao tem que permanecer identicos, checado linha a linha contra o valor anterior. producao.corrigir nunca autoriza fechado->reaberto (branch classica inalterada).';


-- ============================================================
-- 3. editar_producao_registro() -- redefinida
-- ============================================================
-- Alteracao real frente ao texto hoje ao vivo (0017): a checagem de
-- permissao para origem<>'historico' passa de "somente producao.
-- cancelar" para "producao.cancelar OU producao.corrigir". A decisao de
-- chamar (ou nao) reabrir_producao_registro quando o registro esta
-- fechado passa a depender de QUAL das duas o chamador tem: com
-- producao.cancelar, mantem o mecanismo classico (reabre, depois
-- corrige e fecha -- 2 UPDATEs, com o log "reabriu" de
-- reabrir_producao_registro no meio); com producao.corrigir apenas (sem
-- cancelar), pula a reabertura -- o UPDATE final vai direto
-- fechado->fechado, que a nova excecao da trigger permite (e so permite)
-- porque esta funcao nunca envia receita_id/data/turno/custo_producao —
-- a garantia de identidade estrutural e' da trigger, nao desta funcao.
-- Todo o resto (validacoes de sobra, calculo de vendida, auditoria dos
-- campos que mudaram) e' IDENTICO a 0017.

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
  v_tem_cancelar boolean;
  v_tem_corrigir boolean;
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
    v_tem_cancelar := (select public.has_permissao('producao.cancelar'));
    v_tem_corrigir := (select public.has_permissao('producao.corrigir'));

    if not (v_tem_cancelar or v_tem_corrigir) then
      raise exception
        'editar_producao_registro: editar producao do registro % requer a permissao producao.cancelar ou producao.corrigir.', p_registro_id;
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

  -- (0019) Transicao tecnica invisivel, condicionada ao tier do
  -- chamador: historico e producao.cancelar mantem o mecanismo classico
  -- (reabre via reabrir_producao_registro -- sua propria checagem de
  -- permissao e seu proprio log "reabriu" acontecem aqui, com o mesmo
  -- motivo). Quem so tem producao.corrigir (sem cancelar) NUNCA chama
  -- reabrir_producao_registro -- o UPDATE final abaixo vai direto
  -- fechado->fechado, autorizado pela nova excecao estreita da trigger
  -- (que exige, ela mesma, que receita/data/turno/origem/custo nao
  -- mudem -- garantidos aqui porque esta funcao nunca os envia).
  if v_antes.status = 'fechado' then
    if v_antes.origem = 'historico' or v_tem_cancelar then
      perform public.reabrir_producao_registro(p_registro_id, p_motivo);
    end if;
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
  '[0017, inalterado, exceto:] (0019) origem<>historico aceita producao.cancelar OU producao.corrigir (nao mais so cancelar). Com cancelar (ou is_admin para historico), mantem o mecanismo classico de reabertura interna via reabrir_producao_registro. Com apenas corrigir, pula a reabertura -- UPDATE final vai direto fechado->fechado, autorizado pela excecao estreita da trigger (0019), que garante receita_id/data/turno/origem/custo_producao inalterados. produto/data/turno continuam IMUTAVEIS por esta funcao (nao sao parametros). Motivo obrigatorio. Audita apenas os campos que de fato mudaram.';

revoke execute on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) from public;
revoke execute on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) from anon;
grant execute on function public.editar_producao_registro(uuid, integer, integer, integer, integer, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Mecanicamente executavel, MAS reverter producao_registros_protecao()
-- para o texto exato de 0015 e editar_producao_registro() para o texto
-- exato de 0017 exige colar esses corpos de volta -- nao reescrever de
-- memoria. Reverter NAO apaga nenhuma correcao ja feita via
-- producao.corrigir (os dados ja gravados permanecem); so o codigo de
-- permissao e as funcoes deixam de existir/voltam ao comportamento
-- anterior. Confirmar que nao ha usuario dependendo de producao.corrigir
-- antes de rodar.
--
-- BEGIN;
--
--   -- Restaura producao_registros_protecao() para o texto exato de
--   -- 0015_producao_registros_gestao_sobras.sql (linhas 113-205) --
--   -- copiar dali, nao reescrever de memoria.
--
--   -- Restaura editar_producao_registro() para o texto exato do
--   -- scratchpad 0017_producao_registros_retroativo_e_correcao.sql
--   -- (linhas 532-673) -- copiar dali, nao reescrever de memoria.
--
--   delete from public.usuario_permissoes where permissao = 'producao.corrigir';
--   delete from public.perfil_permissoes where permissao = 'producao.corrigir';
--   delete from public.permissoes where codigo = 'producao.corrigir';
--
-- COMMIT;
