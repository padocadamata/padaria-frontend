-- 0050_sacos_exclusao_movimentacao_manual.sql
-- Numeracao confirmada em disco/git antes de nomear este arquivo: maior
-- migration em supabase/migrations/ e 0049 (Expositores, ja commitada e
-- publicada em 2e019b9); maior migration de Sacos e 0048 (commitada e
-- publicada em 821b175); nenhum arquivo 0050+ existe em disco em nenhum
-- diretorio do repositorio no momento em que este arquivo foi escrito.
-- 0050 e o proximo numero livre confirmado.
--
-- ============================================================
-- AUDITORIA PREVIA (obrigatoria, feita antes de desenhar esta migration)
-- ============================================================
--   * sacos_fechados_movimentacoes (0042): nenhuma FK de nenhuma outra
--     tabela aponta para ela (grep completo em supabase/migrations/,
--     zero ocorrencias de "references public.sacos_fechados_
--     movimentacoes") -- DELETE fisico e estruturalmente seguro, nao ha
--     nada para violar.
--   * sacos_fechados_movimentacoes_protecao_trigger (0042) e
--     estoque_movimentacoes_protecao_trigger (0041): ambos registrados
--     como `before insert or update`, NUNCA `before delete` -- um DELETE
--     feito por uma funcao SECURITY DEFINER (BYPASSRLS do dono) passa
--     livre por eles, sem exigir nenhuma alteracao de trigger.
--   * RLS de sacos_fechados_movimentacoes: so existe policy de SELECT
--     (producao_sacos.visualizar) -- sem INSERT/UPDATE/DELETE, exatamente
--     como toda a escrita ja documentada desta frente (so via RPC
--     SECURITY DEFINER). RLS de estoque_movimentacoes: nenhuma policy
--     (mesmo raciocinio, mais estrito ainda).
--   * logs_auditoria (0004) ja e a infraestrutura de auditoria do
--     projeto inteiro -- editar_movimentacao_saco (0042/0046) ja grava
--     nela. NAO SE CRIA TABELA NOVA aqui. O schema (entidade,
--     registro_id, acao, campo, valor_anterior, valor_novo) ja preve
--     explicitamente "campo... nulo em ações de criação/exclusão
--     inteiras" (comentario original da 0004) -- e exatamente o caso de
--     uso desta migration: 1 linha de log por exclusao, campo=null,
--     valor_anterior=snapshot serializado de TODOS os campos relevantes
--     da linha excluida (produto_fornecedor_id/tipo/origem/
--     quantidade_sacos/peso_por_saco_kg_snapshot/pedido_item_id/
--     operacao_id/observacao/criado_por/criado_em), valor_novo=motivo
--     informado pelo usuario. usuario_id/usuario_nome/usuario_email/
--     data_hora sao preenchidos automaticamente pelo trigger
--     logs_auditoria_preencher_usuario ja existente -- nenhuma mudanca
--     necessaria em logs_auditoria.
--   * tipos existentes (CHECK sacos_fechados_movimentacoes_tipo_check):
--     'entrada' (automatico, origem in ('recebimento_pedido','retirada',
--     'carga_inicial') -- reservado para integracao futura com Pedidos,
--     AINDA NAO EXISTE nenhuma RPC que crie 'entrada' com essas origens
--     automaticas hoje), 'abertura' (manual, origem='abertura_manual'),
--     'ajuste_manual' (manual, origem='ajuste_manual', SEM nenhuma RPC
--     que o crie ainda -- mesma investigacao ja feita na 0046, branch
--     estruturalmente preparada mas morta na pratica), 'saldo_inicial'
--     (manual, origem='carga_inicial'). CONCLUSAO: os tipos elegiveis
--     para exclusao sao EXATAMENTE os mesmos ja editaveis por
--     editar_movimentacao_saco desde a 0046 -- ('abertura',
--     'ajuste_manual', 'saldo_inicial') -- nunca 'entrada' (automatico).
--   * vinculo abertura/saldo_inicial <-> estoque: mesmo par (origem,
--     origem_id) ja usado por editar_movimentacao_saco (0046) --
--     abertura->sacos_fechados_abertura, saldo_inicial->
--     sacos_fechados_saldo_inicial, ajuste_manual->nenhuma origem
--     esperada (nenhuma RPC cria essa vinculacao hoje).
--   * padrao de permissoes desta frente: 3 codigos dedicados
--     (visualizar/operar/editar, 0042), concedidos so a
--     proprietario_admin via perfil_permissoes. Esta migration segue o
--     MESMO padrao, adicionando producao_sacos.excluir (pedido explicito
--     do usuario -- NAO reaproveita producao_sacos.editar).
--   * padrao de RPCs desta frente: plpgsql, SECURITY DEFINER,
--     search_path='', checagem explicita de permissao logo no inicio,
--     lock FOR UPDATE em produto_fornecedores ANTES de qualquer leitura
--     de saldo (mesma ordem de registrar_abertura_saco/registrar_saldo_
--     inicial_sacos/editar_movimentacao_saco -- evita deadlock entre as
--     quatro RPCs agora), revoke de public/anon/service_role + grant so
--     para authenticated.
--
-- ============================================================
-- DESENHO DA NOVA RPC -- excluir_movimentacao_saco
-- ============================================================
--   1) Exige producao_sacos.excluir (permissao NOVA, nao reaproveita
--      .editar).
--   2) Motivo obrigatorio (trim <> '') -- sem motivo, sem exclusao.
--   3) Tipos elegiveis: EXATAMENTE os mesmos de editar_movimentacao_saco
--      -- ('abertura', 'ajuste_manual', 'saldo_inicial'). Uma
--      movimentacao tipo='entrada' (automatica, reservada para Pedidos)
--      e rejeitada explicitamente.
--   4) Trava a CONFIGURACAO (FOR UPDATE) antes de recalcular o saldo --
--      mesma ordem das outras 3 RPCs de escrita desta frente, evita
--      deadlock. Trava tambem a propria movimentacao (fecha a janela
--      entre o primeiro SELECT e o lock).
--   5) IDEMPOTENCIA/ERRO AMIGAVEL quando o registro ja nao existe (pedido
--      explicito do usuario): o primeiro SELECT (antes de qualquer lock)
--      levanta uma excecao amigavel e ja mapeada no frontend
--      ("movimentacao ... nao encontrada", mesmo texto ja usado por
--      editar_movimentacao_saco desde a 0042/0046, entao
--      mensagensSacos.js ja reconhece sem nenhuma mudanca) -- cobre o
--      caso comum de referencia obsoleta (tela desatualizada). Se a linha
--      sumir espeficicamente ENTRE o primeiro SELECT e o lock (corrida
--      real com outra exclusao concorrente da MESMA linha), a funcao
--      retorna silenciosamente sem erro -- o resultado liquido desejado
--      (a linha nao existe mais) ja foi alcancado pela outra chamada.
--   6) SIMULA o saldo resultante ANTES de apagar -- soma de todas as
--      OUTRAS movimentacoes da mesma configuracao (exclui a que esta
--      sendo removida); aborta com mensagem clara se o resultado for
--      negativo. Isso implementa exatamente o exemplo do pedido: saldo
--      inicial=6 + abertura=-1 -- excluir o saldo_inicial primeiro
--      resultaria em -1 (soma dos outros = -1) e e BLOQUEADO; excluir a
--      abertura primeiro resulta em 6 (soma dos outros = 6) e e permitido
--      -- depois disso, excluir o saldo_inicial resulta em 0 e tambem e
--      permitido.
--   7) Determina a origem de estoque ESPERADA pelo TIPO (nunca por
--      origem_id isolado -- mesmo principio ja usado em editar_
--      movimentacao_saco/0046): abertura->sacos_fechados_abertura,
--      saldo_inicial->sacos_fechados_saldo_inicial, ajuste_manual->
--      nenhuma. Quando ha origem esperada, EXIGE encontrar EXATAMENTE 1
--      linha vinculada antes de apagar qualquer coisa -- 0 ou mais de 1
--      aborta a transacao inteira (mesma protecao anti-dessincronizacao
--      silenciosa da 0046).
--   8) Grava a AUDITORIA (logs_auditoria) ANTES da remocao fisica --
--      exatamente a ordem exigida: trilha completa (snapshot serializado
--      de todos os campos relevantes + motivo) fica registrada mesmo que
--      algo inesperado interrompa o restante da transacao depois (o
--      COMMIT so acontece se TUDO suceder, entao "antes" aqui e sobre a
--      ORDEM DENTRO da transacao, nao sobre sobreviver a um rollback --
--      se a transacao inteira reverter, o log tambem reverte, que e o
--      comportamento correto: nao faz sentido um log de "excluiu X"
--      sobreviver se a exclusao de fato nao aconteceu).
--   9) Remove a movimentacao de estoque vinculada (quando houver) e SO
--      DEPOIS a propria movimentacao de sacos -- mesma transacao,
--      atomica: ou os dois caem, ou nenhum.
--  10) DELETE FISICO real (nao uma reversao artificial criando uma nova
--      movimentacao de sinal oposto) -- pedido explicito do usuario: a
--      tabela principal reflete so movimentacoes efetivas atuais, o
--      historico do que foi excluido fica exclusivamente em
--      logs_auditoria.
--  11) Retorna a linha excluida (snapshot em memoria, capturado antes do
--      DELETE) como public.sacos_fechados_movimentacoes -- mesmo
--      contrato de retorno das outras RPCs de escrita desta frente,
--      permite ao frontend reagir sem precisar de uma segunda consulta.
--
-- ESCOPO -- SOMENTE:
--   1) nova permissao producao_sacos.excluir (seguindo o padrao de
--      producao_sacos.visualizar/operar/editar da 0042);
--   2) nova RPC public.excluir_movimentacao_saco().
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em 0041..0049;
--   * nenhuma alteracao em registrar_abertura_saco,
--     registrar_saldo_inicial_sacos, editar_movimentacao_saco ou
--     listar_sacos_fechados_configuracoes;
--   * nenhuma tabela nova (reaproveita logs_auditoria integralmente);
--   * nenhuma alteracao em Pedidos/Solicitacoes nem Expositores;
--   * nenhuma carga/exclusao real de dados -- os lancamentos de teste
--     reais (PAO FRANCES/GoldPao) NAO sao tocados por esta migration,
--     ficam para o usuario excluir manualmente pela UI depois.
--
-- Pre-requisitos: 0001..0049 ja aplicadas.

BEGIN;

-- ============================================================
-- 1. Nova permissao -- producao_sacos.excluir
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('producao_sacos.excluir', 'producao_sacos', 'excluir',
   'Excluir fisicamente uma movimentacao MANUAL de Sacos Fechados (abertura, ajuste_manual ou saldo_inicial) via excluir_movimentacao_saco -- nunca uma entrada automatica de pedido (tipo=entrada). Mais restritiva que producao_sacos.editar -- remove o registro em vez de so corrigir. Exige motivo obrigatorio; grava auditoria completa em logs_auditoria antes da remocao fisica; bloqueia se deixaria o saldo de sacos negativo. Concedida inicialmente so a proprietario_admin no banco, mesmo padrao das demais permissoes desta frente (0042).')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', 'producao_sacos.excluir'
on conflict do nothing;


-- ============================================================
-- 2. RPC excluir_movimentacao_saco -- exclusao fisica segura de
--    movimentacao manual, com auditoria previa e sincronizacao atomica
--    de estoque
-- ============================================================
create or replace function public.excluir_movimentacao_saco(
  p_movimentacao_id uuid,
  p_motivo          text
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movimentacao            public.sacos_fechados_movimentacoes%rowtype;
  v_saldo_outros            integer;
  v_origem_estoque_esperada text;
  v_qtd_estoque_vinculado   integer;
  v_motivo                  text;
begin
  if auth.uid() is null then
    raise exception 'excluir_movimentacao_saco: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.excluir')) then
    raise exception using errcode = '42501',
      message = 'excluir_movimentacao_saco: requer a permissao producao_sacos.excluir.';
  end if;

  if p_movimentacao_id is null then
    raise exception 'excluir_movimentacao_saco: movimentacao_id e obrigatorio.';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'excluir_movimentacao_saco: motivo e obrigatorio.';
  end if;

  -- Primeiro SELECT (sem lock ainda) -- cobre o caso comum de referencia
  -- obsoleta (tela desatualizada apontando para uma linha que ja nao
  -- existe) com uma mensagem amigavel e ja reconhecida pelo frontend
  -- (mesmo texto de editar_movimentacao_saco).
  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  if v_movimentacao.id is null then
    raise exception 'excluir_movimentacao_saco: movimentacao % nao encontrada.', p_movimentacao_id;
  end if;

  if v_movimentacao.tipo not in ('abertura', 'ajuste_manual', 'saldo_inicial') then
    raise exception 'excluir_movimentacao_saco: movimentacao % tem tipo=%, somente aberturas, ajustes manuais e saldos iniciais podem ser excluidos por esta funcao.',
      p_movimentacao_id, v_movimentacao.tipo;
  end if;

  -- Trava a CONFIGURACAO (mesma ordem de lock das demais 3 RPCs de
  -- escrita desta frente -- configuracao primeiro -- evita deadlock)
  -- antes de recalcular o saldo, para que nenhuma abertura/saldo
  -- inicial/edicao/exclusao concorrente na mesma configuracao possa
  -- correr entre o calculo do saldo e o DELETE abaixo.
  perform 1 from public.produto_fornecedores
  where id = v_movimentacao.produto_fornecedor_id
  for update;

  -- Trava tambem a propria linha da movimentacao, e recarrega -- fecha a
  -- janela entre o primeiro SELECT e agora. Se a linha sumiu neste meio-
  -- tempo (outra exclusao concorrente da MESMA linha ja rodou), o
  -- resultado liquido desejado ja foi alcancado -- retorna sem erro
  -- (idempotencia real, nao so "nao clicar duas vezes").
  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id
  for update;

  if v_movimentacao.id is null then
    return null;
  end if;

  v_saldo_outros := (
    select coalesce(sum(quantidade_sacos), 0)
    from public.sacos_fechados_movimentacoes
    where produto_fornecedor_id = v_movimentacao.produto_fornecedor_id
      and id <> p_movimentacao_id
  );

  if v_saldo_outros < 0 then
    raise exception 'excluir_movimentacao_saco: excluir esta movimentacao deixaria o saldo de sacos fechados negativo (resultante: % sacos). Exclua primeiro as outras movimentacoes na ordem correta.', v_saldo_outros;
  end if;

  -- Origem de estoque ESPERADA, determinada EXPLICITAMENTE pelo tipo --
  -- nunca por origem_id sozinho (mesma protecao 1:1 real desta
  -- arquitetura, ver 0046). 'ajuste_manual' fica sem origem esperada --
  -- nenhuma RPC cria esse tipo hoje, entao nao existe nenhuma convencao
  -- real de vinculo com estoque para ele.
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
      raise exception 'excluir_movimentacao_saco: esperada exatamente 1 movimentacao de estoque vinculada (origem=%, origem_id=%), encontrada(s) % -- abortando para nao dessincronizar silenciosamente.',
        v_origem_estoque_esperada, p_movimentacao_id, v_qtd_estoque_vinculado;
    end if;
  end if;

  -- Auditoria GRAVADA ANTES da remocao fisica (dentro da mesma
  -- transacao -- se algo abaixo falhar, o rollback desfaz o log
  -- tambem, o que e correto: nao deve sobrar um log de "excluiu" sem a
  -- exclusao de fato ter acontecido). Snapshot de TODOS os campos
  -- relevantes da linha (campo=null, mesma convencao ja documentada na
  -- 0004 para "acoes de criacao/exclusao inteiras") + motivo em
  -- valor_novo. usuario_id/usuario_nome/usuario_email/data_hora
  -- preenchidos automaticamente pelo trigger ja existente.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'sacos_fechados_movimentacao',
    p_movimentacao_id::text,
    'excluiu',
    null,
    format(
      'produto_fornecedor_id=%s; tipo=%s; origem=%s; quantidade_sacos=%s; peso_por_saco_kg_snapshot=%s; pedido_item_id=%s; operacao_id=%s; observacao=%s; criado_por=%s; criado_em=%s',
      v_movimentacao.produto_fornecedor_id, v_movimentacao.tipo, v_movimentacao.origem,
      v_movimentacao.quantidade_sacos, v_movimentacao.peso_por_saco_kg_snapshot,
      v_movimentacao.pedido_item_id, v_movimentacao.operacao_id,
      coalesce(v_movimentacao.observacao, ''), v_movimentacao.criado_por, v_movimentacao.criado_em
    ),
    v_motivo
  );

  -- Remove a movimentacao de estoque vinculada primeiro (quando houver),
  -- so depois a propria movimentacao de sacos -- mesma transacao,
  -- atomica: ou os dois caem, ou nenhum.
  if v_origem_estoque_esperada is not null then
    delete from public.estoque_movimentacoes
    where origem = v_origem_estoque_esperada
      and origem_id = p_movimentacao_id;
  end if;

  delete from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  -- v_movimentacao ja foi capturada em memoria acima (antes do DELETE) --
  -- devolvida como snapshot final ao frontend, mesmo contrato de retorno
  -- das outras RPCs de escrita desta frente.
  return v_movimentacao;
end;
$$;

comment on function public.excluir_movimentacao_saco(uuid, text) is
  'Exclusao FISICA de uma movimentacao MANUAL de sacos fechados (abertura, ajuste_manual ou saldo_inicial -- nunca entrada automatica de pedido). Exige producao_sacos.excluir e motivo obrigatorio (trim <> vazio). Trava a configuracao (FOR UPDATE, mesma ordem de registrar_abertura_saco/registrar_saldo_inicial_sacos/editar_movimentacao_saco -- evita deadlock) e a propria movimentacao antes de simular o saldo excluindo a linha; impede que a exclusao deixe o saldo negativo. Determina a origem de estoque ESPERADA pelo tipo (abertura->sacos_fechados_abertura, saldo_inicial->sacos_fechados_saldo_inicial, ajuste_manual->nenhuma) e exige encontrar EXATAMENTE 1 linha vinculada antes de apagar, abortando com erro caso contrario -- nunca dessincroniza silenciosamente. Grava snapshot completo + motivo em logs_auditoria ANTES da remocao fisica (nao uma reversao artificial -- a tabela principal reflete so movimentacoes efetivas atuais, o historico fica em logs_auditoria). Remove a movimentacao de estoque vinculada (quando houver) e a propria movimentacao de sacos na MESMA transacao. Idempotente para corrida real (linha ja removida entre o SELECT e o lock retorna null sem erro); referencia obsoleta antes de qualquer lock levanta erro amigavel ja mapeado no frontend. SECURITY DEFINER: mesma razao das demais RPCs de escrita desta frente.';

revoke execute on function public.excluir_movimentacao_saco(uuid, text) from public;
revoke execute on function public.excluir_movimentacao_saco(uuid, text) from anon;
revoke execute on function public.excluir_movimentacao_saco(uuid, text) from service_role;
grant execute on function public.excluir_movimentacao_saco(uuid, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto nenhuma exclusao real tiver sido feita ainda (a RPC em
-- si nao gravou nenhum dado -- so a definicao existe; os testes reais do
-- usuario ainda nao foram excluidos no momento em que esta migration foi
-- escrita).
-- BEGIN;
--   revoke execute on function public.excluir_movimentacao_saco(uuid, text) from authenticated;
--   drop function if exists public.excluir_movimentacao_saco(uuid, text);
--
--   delete from public.perfil_permissoes where perfil = 'proprietario_admin' and permissao = 'producao_sacos.excluir';
--   delete from public.permissoes where codigo = 'producao_sacos.excluir';
-- COMMIT;
