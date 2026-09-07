-- 0045_pedidos_exclusao_com_solicitacoes.sql
--
-- Evolução da frente de Solicitações (0043): permite excluir um Pedido
-- que tenha Solicitações vinculadas (pedidos_solicitacoes.pedido_id),
-- desvinculando-as ATOMICAMENTE antes da exclusão -- nunca apaga a
-- Solicitação, nunca deixa pedido_id órfão, nunca deixa alteração
-- parcial se a exclusão falhar.
--
-- ============================================================
-- REVISÃO DESTA RODADA -- POR QUE NÃO HÁ MAIS NENHUM GUC/SESSION FLAG
-- ============================================================
-- A primeira versão deste arquivo usava um GUC de sessão
-- (pedidos_solicitacoes.permitir_desvinculo) + current_user<>session_user
-- como gate do bypass na trigger. Essa versão foi REJEITADA nesta revisão
-- -- não por ter sido explorada com sucesso, mas porque o projeto já tem
-- um precedente estrutural estritamente melhor para o MESMO problema
-- ("como uma trigger reconhece com segurança que só uma RPC SECURITY
-- DEFINER específica pode acionar uma exceção estreita"), já auditado,
-- aprovado e EXECUTADO: migration 0027 (public.pedidos_protecao /
-- public.pedido_itens_protecao, reabertura de recebimento). O gate usado
-- lá -- e agora reaproveitado aqui, mesma lógica -- é:
--
--   coalesce((select rolbypassrls from pg_roles where rolname = current_user), false)
--
-- Por que isto NÃO é um GUC e é estruturalmente mais forte:
--   * rolbypassrls é um atributo de CATÁLOGO do papel (pg_roles), não uma
--     variável de sessão setável por set_config/current_setting -- nenhum
--     cliente authenticated/anon jamais consegue alterá-lo, e ele não
--     "vaza" nem precisa ser revertido manualmente (ao contrário de um
--     GUC, que precisa ser desligado explicitamente após o uso, e cujo
--     esquecimento deixaria estado privilegiado ativo);
--   * current_user, dentro de uma função SECURITY DEFINER, é PELA
--     DURAÇÃO DA CHAMADA o OWNER da função (fato estrutural do Postgres,
--     não uma convenção) -- e essa mudança de current_user vale também
--     DENTRO de triggers disparadas por statements executados dentro
--     dela (SECURITY INVOKER na trigger só significa "não mude o papel
--     de novo": ela herda o papel já elevado do contexto que a disparou).
--     Logo, rolbypassrls(current_user) só é verdadeiro quando a chamada
--     está rodando dentro do contexto elevado de ALGUMA função SECURITY
--     DEFINER cujo owner tenha rolbypassrls (hoje, o mesmo owner
--     postgres/superuser de toda RPC deste projeto) -- nunca para
--     authenticated/anon executando um UPDATE direto via PostgREST, com
--     NENHUMA combinação de permissões/policies;
--   * has_permissao('pedidos.excluir') continua sendo checada também,
--     como segunda camada redundante (mesmo padrão da 0027) -- reduz
--     ainda mais a chance de colisão futura, mas rolbypassrls é o que
--     realmente fecha a porta para authenticated/anon.
--
-- PRECISÃO (mesma ressalva já registrada na 0027, reafirmada aqui):
-- rolbypassrls identifica "este UPDATE roda sob o contexto elevado de
-- ALGUMA função SECURITY DEFINER com este owner" -- não identifica
-- exclusivamente excluir_pedido_com_solicitacoes(). A afirmação "hoje só
-- esta RPC alcança este ramo" é um FATO AUDITADO (inventário abaixo), não
-- uma garantia automática permanente -- precisa ser reconferida sempre
-- que uma nova função SECURITY DEFINER tocar pedidos_solicitacoes.
--
-- ============================================================
-- INVENTÁRIO -- as 5 RPCs de pedidos_solicitacoes já existentes (0043)
-- não alcançam o novo ramo (mesma disciplina de auditoria da 0027)
-- ============================================================
--   criar_solicitacao_pedido (0043) -- só INSERT. SEM RISCO.
--   editar_solicitacao_pedido (0043) -- UPDATE, mas com
--     "where status='pendente'" explícito -- nunca toca uma linha
--     old.status='realizada'. SEM RISCO.
--   excluir_solicitacao_pendente (0043) -- DELETE, não UPDATE, e só em
--     pendente. SEM RISCO.
--   marcar_solicitacao_realizada (0043) -- UPDATE pendente->realizada
--     (direção oposta à do novo ramo: nunca produz
--     old.status='realizada' AND new.status='pendente'). SEM RISCO.
--   concluir_solicitacao_com_pedido (0043) -- UPDATE pendente->realizada
--     com pedido_id preenchido (mesma direção oposta); o caminho
--     idempotente (já realizada com o mesmo pedido_id) é SOMENTE LEITURA,
--     nunca emite UPDATE. SEM RISCO.
--
-- CONCLUSÃO: nenhuma das 5 RPCs hoje versionadas em pedidos_solicitacoes
-- emite um UPDATE que bata com o novo ramo (realizada->pendente,
-- pedido_id->NULL). Só excluir_pedido_com_solicitacoes (seção 2 abaixo)
-- o faz. CHECKLIST para manter essa invariante: qualquer NOVA função
-- SECURITY DEFINER que emitir
-- "UPDATE pedidos_solicitacoes SET status='pendente', pedido_id=NULL ..."
-- a partir de uma linha old.status='realizada' precisa do MESMO nível de
-- auditoria/justificativa desta migration.
--
-- NÃO toca em:
--   - public.excluir_pedido(uuid) -- reaproveitada INTEIRA via `perform`,
--     zero linha de lógica crítica duplicada;
--   - public.reabrir_recebimento_pedido(uuid) -- 100% reaproveitável como
--     está: nunca tocou em pedidos_solicitacoes (não existia quando foi
--     escrita, migration 0027), então reabrir o RECEBIMENTO de um pedido
--     nunca mexe na Solicitação vinculada -- exatamente a regra de
--     negócio pedida. Nenhuma mudança de backend necessária para essa
--     parte -- só frontend.
--   - nenhuma tabela/RPC da frente Sacos Fechados/Estoque (0041/0042/0044).
-- NÃO altera o arquivo da migration 0043 -- só substitui (CREATE OR
-- REPLACE, mesma assinatura) a função de trigger que ela definiu,
-- exatamente como a 0039 fez com as triggers de proteção da 0038 da
-- Agenda, e como esta própria 0027 fez com pedidos_protecao/
-- pedido_itens_protecao (0022) -- padrão já estabelecido neste projeto.

-- ============================================================
-- 1. pedidos_solicitacoes_protecao() -- ATUALIZADA (bypass estreito,
--    gate rolbypassrls + has_permissao -- SEM GUC)
-- ============================================================
-- Corpo idêntico ao da 0043 em tudo, EXCETO o bloco "old.status =
-- 'realizada'", que ganha um ramo novo e estreito: permite SOMENTE a
-- transição status->pendente + pedido_id->NULL (preservando TODO o resto
-- do conteúdo -- produto_id/descricao/unidade/quantidade/
-- data_solicitacao/observacao intactos), e SOMENTE quando (a) o formato
-- exato do UPDATE bate com essa transição E (b) rolbypassrls(current_user)
-- E (c) has_permissao('pedidos.excluir') -- ver justificativa completa
-- no cabeçalho desta migration.
create or replace function public.pedidos_solicitacoes_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    new.status := 'pendente';
    new.realizado_em := null;
    new.realizado_por := null;
    new.pedido_id := null;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id then
    raise exception 'pedidos_solicitacoes: id e imutavel.';
  end if;
  if new.criado_por is distinct from old.criado_por then
    raise exception 'pedidos_solicitacoes: criado_por e imutavel.';
  end if;
  if new.criado_em is distinct from old.criado_em then
    raise exception 'pedidos_solicitacoes: criado_em e imutavel.';
  end if;

  new.atualizado_em := now();

  if old.status = 'realizada' then
    -- NOVO (0045): ramo estreito de desvinculo por exclusao do pedido
    -- vinculado -- ver cabecalho desta migration para a justificativa
    -- completa (mesmo gate estrutural rolbypassrls+has_permissao ja
    -- aprovado e executado na 0027, nenhum GUC/session flag).
    if old.pedido_id is not null
      and new.status = 'pendente'
      and new.pedido_id is null
      and new.realizado_em is null
      and new.realizado_por is null
      and new.observacao_realizacao is null
      and new.produto_id is not distinct from old.produto_id
      and new.descricao is not distinct from old.descricao
      and new.unidade is not distinct from old.unidade
      and new.quantidade is not distinct from old.quantidade
      and new.data_solicitacao is not distinct from old.data_solicitacao
      and new.observacao is not distinct from old.observacao
    then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedidos_solicitacoes: desvinculo por exclusao de pedido so pode ser feito via excluir_pedido_com_solicitacoes().';
      end if;
      if not (select public.has_permissao('pedidos.excluir')) then
        raise exception 'pedidos_solicitacoes: desvinculo por exclusao de pedido requer a permissao pedidos.excluir.';
      end if;

      return new;
    end if;

    -- Caminho normal: solicitacao realizada e terminal, nenhum outro
    -- UPDATE prossegue -- inalterado desde a 0043.
    raise exception 'pedidos_solicitacoes: solicitacao % ja esta realizada, nao pode ser alterada.', old.id;
  end if;

  if new.status <> old.status then
    if not (select public.has_permissao('pedidos_solicitacoes.realizar')) then
      raise exception 'pedidos_solicitacoes: marcar como realizada requer a permissao pedidos_solicitacoes.realizar.';
    end if;

    new.realizado_em := now();
    new.realizado_por := auth.uid();

    if new.produto_id is distinct from old.produto_id
      or new.descricao is distinct from old.descricao
      or new.unidade is distinct from old.unidade
      or new.quantidade is distinct from old.quantidade
      or new.data_solicitacao is distinct from old.data_solicitacao
      or new.observacao is distinct from old.observacao
    then
      raise exception 'pedidos_solicitacoes: a transicao para realizada nao pode alterar o conteudo original da solicitacao %.', old.id;
    end if;
  else
    if not (select public.has_permissao('pedidos_solicitacoes.editar')) then
      raise exception 'pedidos_solicitacoes: editar requer a permissao pedidos_solicitacoes.editar.';
    end if;

    if new.realizado_em is distinct from old.realizado_em
      or new.realizado_por is distinct from old.realizado_por
      or new.pedido_id is distinct from old.pedido_id
      or new.observacao_realizacao is distinct from old.observacao_realizacao
    then
      raise exception 'pedidos_solicitacoes: edicao comum nao pode alterar campos de realizacao.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.pedidos_solicitacoes_protecao() is
  '[0043, com 1 mudanca da 0045] BEFORE INSERT/UPDATE em pedidos_solicitacoes. INSERT: forca criado_por/criado_em/atualizado_em e garante que a linha nunca nasce realizada. UPDATE: id/criado_por/criado_em imutaveis; uma solicitacao realizada e terminal para qualquer UPDATE comum -- EXCETO (0045) um ramo estreito que permite EXCLUSIVAMENTE a transicao status->pendente + pedido_id->NULL (preservando todo o resto do conteudo), liberado somente quando o papel efetivo tem rolbypassrls (identifica contexto elevado de alguma funcao SECURITY DEFINER -- hoje, comprovadamente so excluir_pedido_com_solicitacoes() emite um UPDATE compativel, ver auditoria no cabecalho da 0045; mesmo gate ja aprovado/executado em pedidos_protecao/pedido_itens_protecao, migration 0027) e a permissao pedidos.excluir -- usado quando o Pedido vinculado e excluido, para a Solicitacao voltar a pendente em vez de apontar para um pedido_id que deixou de existir. Fora desse ramo: a transicao pendente->realizada exige pedidos_solicitacoes.realizar, forca realizado_em=now()/realizado_por=auth.uid() e nao pode alterar o conteudo original; uma edicao comum (permanece pendente) exige pedidos_solicitacoes.editar e nao pode tocar nos campos de realizacao. Defesa em profundidade -- a tabela nao tem NENHUMA policy de INSERT/UPDATE/DELETE para authenticated.';

revoke execute on function public.pedidos_solicitacoes_protecao() from public;
revoke execute on function public.pedidos_solicitacoes_protecao() from anon;
revoke execute on function public.pedidos_solicitacoes_protecao() from authenticated;
revoke execute on function public.pedidos_solicitacoes_protecao() from service_role;


-- ============================================================
-- 2. excluir_pedido_com_solicitacoes(uuid) -- NOVA RPC
-- ============================================================
-- Exige a MESMA permissao de excluir_pedido (pedidos.excluir) -- checada
-- aqui explicitamente ANTES de tocar em qualquer solicitacao, E TAMBEM
-- reconfirmada dentro do proprio excluir_pedido() (defesa em profundidade,
-- nunca confia so na checagem externa). Zero logica critica de exclusao
-- duplicada -- todo o trabalho de excluir o pedido em si continua 100%
-- dentro de excluir_pedido(), reaproveitada via `perform` sem nenhuma
-- modificacao. Tudo ou nada: se excluir_pedido() falhar por qualquer
-- motivo, a excecao propaga e desfaz TAMBEM os desvinculos de
-- solicitacoes feitos antes.
--
-- CONCORRENCIA: trava o PEDIDO primeiro (FOR UPDATE), ANTES de sequer
-- olhar para pedidos_solicitacoes -- fecha a janela entre "levantar as
-- solicitacoes vinculadas" e "excluir o pedido": enquanto esta funcao
-- segura esse lock, qualquer concluir_solicitacao_com_pedido() concorrente
-- que tente vincular uma NOVA solicitacao a este mesmo pedido precisa de
-- um lock FOR KEY SHARE no pedido (exigido pela propria FK
-- pedidos_solicitacoes.pedido_id -> pedidos.id, validada no momento do
-- UPDATE) -- FOR KEY SHARE conflita com FOR UPDATE, entao essa chamada
-- concorrente fica bloqueada ate esta transacao terminar. Se esta
-- transacao COMMITAR (pedido excluido), a chamada concorrente falha por
-- violacao de FK (pedido nao existe mais) -- nunca cria um vinculo orfao.
-- Se esta transacao REVERTER, a chamada concorrente prossegue
-- normalmente contra um pedido que continua existindo. Em nenhum dos dois
-- casos surge um vinculo novo entre o levantamento das solicitacoes e a
-- exclusao do pedido. O lock do pedido tomado aqui e o MESMO que
-- excluir_pedido() toma de novo logo em seguida (reentrante dentro da
-- mesma transacao/sessao -- sem custo extra, sem risco de autodeadlock).
create or replace function public.excluir_pedido_com_solicitacoes(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solicitacao public.pedidos_solicitacoes;
begin
  if auth.uid() is null then
    raise exception 'excluir_pedido_com_solicitacoes: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.excluir')) then
    raise exception using errcode = '42501',
      message = 'excluir_pedido_com_solicitacoes: requer a permissao pedidos.excluir.';
  end if;

  -- Trava o pedido ANTES de tocar em qualquer solicitacao (ver nota de
  -- concorrencia acima). Se o pedido nao existir, este SELECT so nao
  -- encontra nada (sem erro aqui) -- excluir_pedido(), mais abaixo, e
  -- quem ja levanta e formata o erro "pedido nao encontrado", sem
  -- duplicar essa logica aqui.
  perform 1 from public.pedidos where id = p_pedido_id for update;

  -- Trava (FOR UPDATE) e desvincula CADA solicitacao vinculada a este
  -- pedido -- funciona identicamente para 0, 1 ou N solicitacoes (nao ha
  -- limite de quantidade; se nenhuma estiver vinculada, o loop nao itera
  -- nenhuma vez e a funcao se comporta exatamente como uma chamada direta
  -- a excluir_pedido()).
  for v_solicitacao in
    select * from public.pedidos_solicitacoes
    where pedido_id = p_pedido_id
    for update
  loop
    update public.pedidos_solicitacoes
    set status = 'pendente',
        pedido_id = null,
        realizado_em = null,
        realizado_por = null,
        observacao_realizacao = null
    where id = v_solicitacao.id;

    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido_solicitacao', v_solicitacao.id::text, 'desvinculou_pedido_excluido', 'status', 'realizada', 'pendente');

    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido_solicitacao', v_solicitacao.id::text, 'desvinculou_pedido_excluido', 'pedido_id', v_solicitacao.pedido_id::text, null);
  end loop;

  perform public.excluir_pedido(p_pedido_id);
end;
$$;

comment on function public.excluir_pedido_com_solicitacoes(uuid) is
  'Exclui definitivamente um pedido, desvinculando ANTES (na mesma transacao) toda solicitacao interna de compra vinculada a ele (pedidos_solicitacoes.pedido_id) -- cada uma volta para status=pendente, pedido_id=NULL, realizado_em/realizado_por/observacao_realizacao=NULL, preservando produto_id/descricao/unidade/quantidade/data_solicitacao/observacao/criado_por/criado_em intactos. NUNCA apaga a solicitacao. Trava o pedido (FOR UPDATE) ANTES de tocar em qualquer solicitacao, fechando a janela de corrida com um vinculo concorrente (ver comentario de codigo). Depois, chama public.excluir_pedido() SEM NENHUMA modificacao -- reaproveita 100% da logica critica ja auditada (mesma permissao pedidos.excluir, mesmo FOR UPDATE, mesmo snapshot em logs_auditoria, mesma regra de so aceitar status=aguardando_entrega). Se excluir_pedido() falhar por qualquer motivo, a transacao inteira desfaz, inclusive os desvinculos. O desvinculo em si so e permitido pela trigger pedidos_solicitacoes_protecao sob o gate estrutural rolbypassrls(current_user)+has_permissao(pedidos.excluir) -- SEM GUC/session flag, mesmo padrao ja aprovado/executado na migration 0027. SECURITY DEFINER -- mesma exigencia de permissao de excluir_pedido, verificada aqui explicitamente ANTES de tocar em qualquer solicitacao. Funciona identicamente para 0, 1 ou N solicitacoes vinculadas ao mesmo pedido.';

revoke execute on function public.excluir_pedido_com_solicitacoes(uuid) from public;
revoke execute on function public.excluir_pedido_com_solicitacoes(uuid) from anon;
revoke execute on function public.excluir_pedido_com_solicitacoes(uuid) from service_role;
grant execute on function public.excluir_pedido_com_solicitacoes(uuid) to authenticated;
