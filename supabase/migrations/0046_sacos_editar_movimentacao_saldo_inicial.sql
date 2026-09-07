-- 0046_sacos_editar_movimentacao_saldo_inicial.sql
-- Numeracao confirmada em disco antes de nomear este arquivo: 0044 e a
-- ultima migration de Sacos Fechados aplicada; 0045
-- (0045_pedidos_exclusao_com_solicitacoes.sql) ja foi aplicada pela
-- frente Pedidos/Solicitacoes -- 0046 e o proximo numero realmente
-- livre.
--
-- Estende public.editar_movimentacao_saco() (0042) para tambem aceitar
-- tipo='saldo_inicial' (criado por registrar_saldo_inicial_sacos, 0044),
-- que hoje e rejeitado explicitamente. Corrige, ao mesmo tempo, um
-- segundo bloqueio independente encontrado na mesma revisao: o UPDATE de
-- estoque_movimentacoes estava hardcoded para
-- origem='sacos_fechados_abertura', o que NUNCA bateria com
-- 'sacos_fechados_saldo_inicial' mesmo que o primeiro bloqueio fosse
-- removido -- deixaria sacos e estoque dessincronizados silenciosamente
-- (0 linhas afetadas pelo UPDATE, sem erro nenhum).
--
-- ============================================================
-- INVESTIGACAO OBRIGATORIA -- ajuste_manual (antes de decidir o desenho)
-- ============================================================
-- Buscado em TODO o historico de migrations (0042, 0044): NENHUMA RPC
-- deste projeto cria uma linha com tipo='ajuste_manual'. O tipo existe
-- SOMENTE no dominio da CHECK constraint (sacos_fechados_movimentacoes_
-- tipo_check), na constraint de sinal (sinal_coerente_check, que aceita
-- qualquer sinal nao-zero para esse tipo) e na constraint de coerencia
-- tipo<->origem (tipo_origem_coerente_check: 'ajuste_manual' <->
-- origem='ajuste_manual') -- tudo preparado de proposito para uma RPC de
-- "lancamento manual" FUTURA, que ainda nao existe (mesmo padrao ja
-- usado para saldo_inicial/carga_inicial antes da 0044 preencher esse
-- gap). CONCLUSAO: hoje e ESTRUTURALMENTE IMPOSSIVEL existir qualquer
-- linha real com tipo='ajuste_manual') no banco -- editar_movimentacao_saco
-- aceitar esse tipo desde a 0042 e codigo alcancavel apenas em teoria,
-- nunca na pratica (nao e um bug ativo, so uma branch morta ate a RPC de
-- lancamento manual existir). NAO e alterado o comportamento dela aqui:
-- continua na lista de tipos editaveis (compatibilidade futura), mas
-- SEM exigir nem tocar em nenhuma movimentacao de estoque vinculada --
-- inventar uma convencao de origem para um tipo sem nenhum precedente
-- real seria arbitrario, entao esta migration deliberadamente NAO cria
-- uma. Quando a RPC de lancamento manual for desenhada, a convencao de
-- origem de estoque de ajuste_manual (se houver) sera decidida junto
-- dela, com o caso de uso real em maos.
--
-- ============================================================
-- DESENHO DA CORRECAO
-- ============================================================
--   1) tipo editavel passa a incluir 'saldo_inicial':
--      tipo not in ('abertura', 'ajuste_manual', 'saldo_inicial').
--   2) Nova regra de sinal simetrica a de abertura: para
--      tipo='saldo_inicial', p_nova_quantidade_sacos precisa continuar
--      POSITIVO (mesma logica de "abertura precisa continuar negativo",
--      espelhada).
--   3) Origem de estoque ESPERADA determinada EXPLICITAMENTE pelo tipo
--      da movimentacao (nunca por origem_id isolado -- a protecao 1:1
--      real desta arquitetura e o PAR (origem, origem_id), nao
--      origem_id sozinho, ver 0041):
--        tipo='abertura'     -> origem esperada='sacos_fechados_abertura'
--        tipo='saldo_inicial'-> origem esperada='sacos_fechados_saldo_inicial'
--        tipo='ajuste_manual'-> nenhuma origem esperada (ver investigacao
--                                acima) -- edita so sacos, nunca toca
--                                estoque_movimentacoes.
--   4) Quando existe uma origem esperada, a funcao agora EXIGE
--      encontrar EXATAMENTE 1 movimentacao de estoque com
--      (origem, origem_id=p_movimentacao_id) ANTES de escrever qualquer
--      coisa -- 0 ou mais de 1 aborta a transacao inteira com erro
--      explicito, nunca dessincroniza silenciosamente (correcao do
--      bloqueio 2, que tambem beneficia 'abertura': antes, um UPDATE
--      que batesse 0 linhas simplesmente nao fazia nada, sem erro).
--   5) Nada mais muda: lock da configuracao ANTES da propria
--      movimentacao (mesma ordem de registrar_abertura_saco/
--      registrar_saldo_inicial_sacos -- evita deadlock entre as tres
--      RPCs), recalculo de saldo excluindo a linha em edicao, bloqueio
--      de saldo final negativo, UPDATE direto (nunca gera linha nova),
--      preserva peso_por_saco_kg_snapshot original, preserva o mesmo id
--      da movimentacao de sacos E da movimentacao de estoque (nenhuma
--      delas e recriada), grava logs_auditoria, exige
--      producao_sacos.editar, SECURITY DEFINER, search_path=''.
--
-- ============================================================
-- IDEMPOTENCIA APOS EDICAO (investigado, nao alterado)
-- ============================================================
-- registrar_saldo_inicial_sacos() (0044) resolve idempotencia por
-- operacao_id ANTES de qualquer outra coisa: `select * where
-- operacao_id = p_operacao_id; if found then return v_existente; end
-- if;`. operacao_id e IMUTAVEL na linha (protegido por
-- sacos_fechados_movimentacoes_protecao, 0042) -- editar_movimentacao_saco
-- nunca altera operacao_id, so quantidade_sacos/observacao. Logo, um
-- retry de registrar_saldo_inicial_sacos com o MESMO operacao_id, feito
-- DEPOIS de uma edicao, encontra a MESMA linha (agora com o valor JA
-- CORRIGIDO) e devolve exatamente essa linha, sem reinserir nem reverter
-- nada -- comportamento correto de idempotencia (o retry ecoa o estado
-- ATUAL do recurso, nunca o payload original da criacao). Nenhuma
-- mudanca necessaria nesta funcao para isso continuar valendo.
--
-- ESCOPO -- SOMENTE:
--   1) public.editar_movimentacao_saco() -- CREATE OR REPLACE (mesmo
--      corpo de 0042 + as mudancas do DESENHO DA CORRECAO acima).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em 0041, 0042 (produto_fornecedores/
--     sacos_fechados_movimentacoes/registrar_abertura_saco), 0044
--     (registrar_saldo_inicial_sacos/listar_sacos_fechados_configuracoes)
--     alem da unica funcao listada acima;
--   * nenhuma alteracao em 0043/0045 (Pedidos/Solicitacoes) nem em
--     Agenda;
--   * nenhuma constraint/coluna/tabela nova;
--   * nenhuma RPC de lancamento manual (ajuste_manual continua sem
--     nenhum caminho de criacao -- fora de escopo desta correcao);
--   * nenhuma carga real de dados.
--
-- Pre-requisitos: 0001..0045 ja aplicadas.

BEGIN;

create or replace function public.editar_movimentacao_saco(
  p_movimentacao_id       uuid,
  p_nova_quantidade_sacos integer,
  p_observacao            text default null
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movimentacao            public.sacos_fechados_movimentacoes%rowtype;
  v_saldo_outros            integer;
  v_saldo_resultante        integer;
  v_valor_anterior          text;
  v_origem_estoque_esperada text;
  v_qtd_estoque_vinculado   integer;
begin
  if auth.uid() is null then
    raise exception 'editar_movimentacao_saco: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.editar')) then
    raise exception using errcode = '42501',
      message = 'editar_movimentacao_saco: requer a permissao producao_sacos.editar.';
  end if;

  if p_movimentacao_id is null then
    raise exception 'editar_movimentacao_saco: movimentacao_id e obrigatorio.';
  end if;

  if p_nova_quantidade_sacos is null or p_nova_quantidade_sacos = 0 then
    raise exception 'editar_movimentacao_saco: nova quantidade nao pode ser zero.';
  end if;

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  if v_movimentacao.id is null then
    raise exception 'editar_movimentacao_saco: movimentacao % nao encontrada.', p_movimentacao_id;
  end if;

  -- 'saldo_inicial' adicionado nesta migration (0046). 'ajuste_manual'
  -- continua aceito por compatibilidade futura, mesmo sem nenhuma RPC
  -- que o crie hoje (ver investigacao no cabecalho desta migration).
  if v_movimentacao.tipo not in ('abertura', 'ajuste_manual', 'saldo_inicial') then
    raise exception 'editar_movimentacao_saco: movimentacao % tem tipo=%, somente aberturas, ajustes manuais e saldos iniciais podem ser corrigidos por esta funcao.',
      p_movimentacao_id, v_movimentacao.tipo;
  end if;

  if v_movimentacao.tipo = 'abertura' and p_nova_quantidade_sacos >= 0 then
    raise exception 'editar_movimentacao_saco: uma movimentacao do tipo abertura precisa continuar negativa (recebido: %).', p_nova_quantidade_sacos;
  end if;

  -- Regra simetrica, nova nesta migration: saldo_inicial precisa
  -- continuar positivo (e sempre uma ENTRADA).
  if v_movimentacao.tipo = 'saldo_inicial' and p_nova_quantidade_sacos <= 0 then
    raise exception 'editar_movimentacao_saco: uma movimentacao do tipo saldo_inicial precisa continuar positiva (recebido: %).', p_nova_quantidade_sacos;
  end if;

  -- Trava a CONFIGURACAO (mesma ordem de lock de registrar_abertura_saco/
  -- registrar_saldo_inicial_sacos -- configuracao primeiro -- evita
  -- deadlock entre as tres RPCs) antes de recalcular o saldo, para que
  -- nenhuma abertura/saldo inicial concorrente na mesma configuracao
  -- possa correr entre o calculo do saldo e o UPDATE abaixo.
  perform 1 from public.produto_fornecedores
  where id = v_movimentacao.produto_fornecedor_id
  for update;

  -- Trava tambem a propria linha da movimentacao, e recarrega -- fecha a
  -- janela entre o primeiro SELECT (antes do lock da configuracao) e
  -- agora, caso outra transacao tenha alterado esta mesma linha nesse
  -- meio-tempo.
  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id
  for update;

  v_saldo_outros := (
    select coalesce(sum(quantidade_sacos), 0)
    from public.sacos_fechados_movimentacoes
    where produto_fornecedor_id = v_movimentacao.produto_fornecedor_id
      and id <> p_movimentacao_id
  );

  v_saldo_resultante := v_saldo_outros + p_nova_quantidade_sacos;

  if v_saldo_resultante < 0 then
    raise exception 'editar_movimentacao_saco: esta correcao deixaria o saldo negativo (resultante: % sacos).', v_saldo_resultante;
  end if;

  -- Origem de estoque ESPERADA, determinada EXPLICITAMENTE pelo tipo --
  -- nunca por origem_id sozinho (a protecao 1:1 real desta arquitetura e
  -- o PAR (origem, origem_id), ver indice unico de 0041). 'ajuste_manual'
  -- fica sem origem esperada -- nenhuma RPC cria esse tipo hoje, entao
  -- nao existe nenhuma convencao real de vinculo com estoque para ele
  -- (ver investigacao no cabecalho desta migration) -- inventar uma
  -- agora seria arbitrario.
  v_origem_estoque_esperada := case v_movimentacao.tipo
    when 'abertura' then 'sacos_fechados_abertura'
    when 'saldo_inicial' then 'sacos_fechados_saldo_inicial'
    else null
  end;

  if v_origem_estoque_esperada is not null then
    select count(*) into v_qtd_estoque_vinculado
    from public.estoque_movimentacoes
    where origem = v_origem_estoque_esperada
      and origem_id = p_movimentacao_id;

    if v_qtd_estoque_vinculado <> 1 then
      raise exception 'editar_movimentacao_saco: esperada exatamente 1 movimentacao de estoque vinculada (origem=%, origem_id=%), encontrada(s) % -- abortando para nao dessincronizar silenciosamente.',
        v_origem_estoque_esperada, p_movimentacao_id, v_qtd_estoque_vinculado;
    end if;
  end if;

  v_valor_anterior := v_movimentacao.quantidade_sacos::text;

  update public.sacos_fechados_movimentacoes
  set quantidade_sacos = p_nova_quantidade_sacos,
      observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao)
  where id = p_movimentacao_id;

  -- So executa quando existe uma origem esperada (abertura/saldo_inicial)
  -- -- ja confirmada como EXATAMENTE 1 linha acima. Mesmo
  -- peso_por_saco_kg_snapshot da movimentacao original, nunca o peso
  -- ATUAL da configuracao. Mesma linha de estoque de sempre (id
  -- preservado) -- nunca uma linha nova.
  if v_origem_estoque_esperada is not null then
    update public.estoque_movimentacoes
    set quantidade = p_nova_quantidade_sacos::numeric * v_movimentacao.peso_por_saco_kg_snapshot
    where origem = v_origem_estoque_esperada
      and origem_id = p_movimentacao_id;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('sacos_fechados_movimentacao', p_movimentacao_id::text, 'editou', 'quantidade_sacos', v_valor_anterior, p_nova_quantidade_sacos::text);

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  return v_movimentacao;
end;
$$;

comment on function public.editar_movimentacao_saco(uuid, integer, text) is
  'Corrige uma movimentacao de sacos MANUAL ja registrada (tipo abertura, saldo_inicial ou ajuste_manual -- nunca entrada automatica de pedido). Trava a configuracao (FOR UPDATE, mesma ordem de registrar_abertura_saco/registrar_saldo_inicial_sacos -- evita deadlock) e a propria movimentacao antes de recalcular o saldo excluindo a linha em edicao; impede que a correcao deixe o saldo negativo. Determina a origem de estoque ESPERADA explicitamente pelo tipo (abertura->sacos_fechados_abertura, saldo_inicial->sacos_fechados_saldo_inicial, ajuste_manual->nenhuma, sem RPC de criacao ainda) e exige encontrar EXATAMENTE 1 linha vinculada antes de escrever, abortando com erro caso contrario (0046) -- nunca dessincroniza silenciosamente. UPDATE transacional direto (nao gera linha nova): corrige quantidade_sacos + a movimentacao de estoque vinculada (quando aplicavel) na MESMA transacao, preservando peso_por_saco_kg_snapshot original e os ids existentes. Registra valor anterior/novo em logs_auditoria. Exige producao_sacos.editar. SECURITY DEFINER: mesma razao de registrar_abertura_saco.';

revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from public;
revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from anon;
revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from service_role;
grant execute on function public.editar_movimentacao_saco(uuid, integer, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Restaura editar_movimentacao_saco() para o corpo EXATO de 0042 (so
-- abertura/ajuste_manual editaveis, origem hardcoded para
-- 'sacos_fechados_abertura', sem checagem de exatamente-1-linha). Seguro
-- enquanto nenhuma edicao de saldo_inicial real tiver sido feita ainda
-- -- se ja tiver, o rollback nao desfaz o efeito, so impede NOVAS
-- edicoes de saldo_inicial a partir dali.
-- BEGIN;
--   create or replace function public.editar_movimentacao_saco(
--     p_movimentacao_id       uuid,
--     p_nova_quantidade_sacos integer,
--     p_observacao            text default null
--   )
--   returns public.sacos_fechados_movimentacoes
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_movimentacao     public.sacos_fechados_movimentacoes%rowtype;
--     v_saldo_outros     integer;
--     v_saldo_resultante integer;
--     v_valor_anterior   text;
--   begin
--     if auth.uid() is null then
--       raise exception 'editar_movimentacao_saco: requer sessao autenticada.';
--     end if;
--     if not (select public.has_permissao('producao_sacos.editar')) then
--       raise exception using errcode = '42501',
--         message = 'editar_movimentacao_saco: requer a permissao producao_sacos.editar.';
--     end if;
--     if p_movimentacao_id is null then
--       raise exception 'editar_movimentacao_saco: movimentacao_id e obrigatorio.';
--     end if;
--     if p_nova_quantidade_sacos is null or p_nova_quantidade_sacos = 0 then
--       raise exception 'editar_movimentacao_saco: nova quantidade nao pode ser zero.';
--     end if;
--     select * into v_movimentacao from public.sacos_fechados_movimentacoes where id = p_movimentacao_id;
--     if v_movimentacao.id is null then
--       raise exception 'editar_movimentacao_saco: movimentacao % nao encontrada.', p_movimentacao_id;
--     end if;
--     if v_movimentacao.tipo not in ('abertura', 'ajuste_manual') then
--       raise exception 'editar_movimentacao_saco: movimentacao % tem tipo=%, somente aberturas e ajustes manuais podem ser corrigidos por esta funcao.',
--         p_movimentacao_id, v_movimentacao.tipo;
--     end if;
--     if v_movimentacao.tipo = 'abertura' and p_nova_quantidade_sacos >= 0 then
--       raise exception 'editar_movimentacao_saco: uma movimentacao do tipo abertura precisa continuar negativa (recebido: %).', p_nova_quantidade_sacos;
--     end if;
--     perform 1 from public.produto_fornecedores where id = v_movimentacao.produto_fornecedor_id for update;
--     select * into v_movimentacao from public.sacos_fechados_movimentacoes where id = p_movimentacao_id for update;
--     v_saldo_outros := (select coalesce(sum(quantidade_sacos), 0) from public.sacos_fechados_movimentacoes where produto_fornecedor_id = v_movimentacao.produto_fornecedor_id and id <> p_movimentacao_id);
--     v_saldo_resultante := v_saldo_outros + p_nova_quantidade_sacos;
--     if v_saldo_resultante < 0 then
--       raise exception 'editar_movimentacao_saco: esta correcao deixaria o saldo negativo (resultante: % sacos).', v_saldo_resultante;
--     end if;
--     v_valor_anterior := v_movimentacao.quantidade_sacos::text;
--     update public.sacos_fechados_movimentacoes set quantidade_sacos = p_nova_quantidade_sacos, observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao) where id = p_movimentacao_id;
--     update public.estoque_movimentacoes set quantidade = p_nova_quantidade_sacos::numeric * v_movimentacao.peso_por_saco_kg_snapshot where origem = 'sacos_fechados_abertura' and origem_id = p_movimentacao_id;
--     insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo) values ('sacos_fechados_movimentacao', p_movimentacao_id::text, 'editou', 'quantidade_sacos', v_valor_anterior, p_nova_quantidade_sacos::text);
--     select * into v_movimentacao from public.sacos_fechados_movimentacoes where id = p_movimentacao_id;
--     return v_movimentacao;
--   end;
--   $$;
--   revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from public;
--   revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from anon;
--   revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from service_role;
--   grant execute on function public.editar_movimentacao_saco(uuid, integer, text) to authenticated;
-- COMMIT;
