-- 0038_agenda_calendario.sql
-- Módulo Agenda/Calendário — V1, compartilhada pela empresa (sem
-- usuario_id/responsavel_id/participantes/visibilidade privada — todo
-- usuário com agenda.visualizar vê a mesma Agenda; atribuições
-- individuais ficam para evolução futura, sem antecipar schema para
-- isso agora).
--
-- ============================================================
-- REVISÃO 2 -- correções obrigatórias aplicadas antes da autorização de
-- execução (nenhuma delas muda o escopo geral, só fecha lacunas):
-- ============================================================
--   1) Categorias normalizadas em MAIÚSCULAS (ADMINISTRATIVO/PRODUÇÃO/
--      COMPRAS/FINANCEIRO/MANUTENÇÃO/OUTROS) + CHECK valor=upper(valor)
--      -- regra global do projeto para dados mestres.
--   2) agenda_ocorrencia_e_valida agora SEM NENHUM grant (nem
--      authenticated) -- vira helper 100% interno. Isso forçou
--      concluir_ocorrencia_agenda/cancelar_ocorrencia_agenda/
--      alterar_ocorrencia_agenda/editar_serie_agenda_esta_e_proximas a
--      virarem SECURITY DEFINER (única forma de continuar chamando o
--      helper), cada uma com checagem explícita de agenda.editar
--      substituindo a garantia que a RLS dava sob INVOKER.
--      agenda_array_sem_duplicatas continua com EXECUTE para
--      authenticated -- exceção deliberada e justificada no comentário
--      da própria função (é avaliada dentro de um CHECK disparado por
--      CRUD direto do cliente, não só por RPC). service_role recebe
--      REVOKE explícito em TODAS as 8 funções (sem razão concreta para
--      precisar de nenhuma).
--   3) alterar_ocorrencia_agenda passa a rejeitar também colisão de
--      data_override contra OUTRA exceção da mesma série (não só contra
--      ocorrência normal da regra).
--   4) agenda_itens_protecao ganhou guarda estrutural: com qualquer
--      agenda_ocorrencias existente, uma edição de "toda a série" não
--      pode mudar data_inicio/tipo_recorrencia/recorrencia_intervalo/
--      recorrencia_dias_semana; recorrencia_data_fim só pode encurtar
--      (nunca orfanizando uma exceção existente); dia_inteiro não pode
--      virar true se existir exceção com hora_*_override. Isso também
--      exigiu um mecanismo novo (GUC de sessão local à transação,
--      agenda.permitir_realocacao_ocorrencia) para permitir que
--      editar_serie_agenda_esta_e_proximas continue podendo realocar
--      exceções (agenda_item_id) para a nova série, sem abrir essa
--      permissão para mais ninguém.
--   5) agenda_ocorrencias_protecao agora valida horários EFETIVOS
--      (considerando fallback para hora_inicio/hora_fim do item pai
--      quando só um override foi informado), não só os 2 campos override
--      isolados.
--
-- ============================================================
-- REVISÃO 3 -- 5 pontos de integridade fechados antes da autorização:
-- ============================================================
--   1) agenda_ocorrencias_protecao agora valida NEW.data_ocorrencia
--      contra a regra ATUAL do item pai (agenda_ocorrencia_e_valida) em
--      TODO INSERT/UPDATE, e rejeita item pai com tipo_recorrencia=
--      nenhuma -- CRUD direto (RLS) nunca consegue gravar uma exceção em
--      data arbitrária nem para item não-recorrente, não só as RPCs.
--   2) O bypass de imutabilidade de agenda_item_id agora exige o GUC
--      de sessão E current_user <> session_user (só verdadeiro dentro de
--      SECURITY DEFINER) -- um cliente comum nunca satisfaz as duas
--      condições sozinho, mesmo que de alguma forma setasse o GUC.
--   3) Reconfirmado (sem mudança de comportamento, já corrigido na
--      revisão 2): concluido_em/concluido_por, em agenda_itens E
--      agenda_ocorrencias, são sempre recalculados pelo servidor
--      (now()/auth.uid()) só na transição real de conclusão, e
--      preservados (nunca o valor que o cliente mandou) em qualquer
--      outra edição.
--   4) Novo índice UNIQUE parcial (agenda_item_id, data_override) WHERE
--      data_override IS NOT NULL -- fecha a race condition que a
--      checagem `exists(...)` da RPC sozinha não cobre sob concorrência.
--   5) agenda_categorias ganhou trigger de normalização (upper(btrim(...)))
--      NA PERSISTÊNCIA -- não depende só do frontend mandar a forma
--      certa; CHECK correspondente vira defensivo, não a única garantia.
--
-- ============================================================
-- REVISÃO 4 -- gap de integridade pai->exceção fechado:
-- ============================================================
--   Edição de "toda a série" que só muda hora_inicio/hora_fim/dia_inteiro
--   (ou tipo) do item PAI não toca nenhuma linha de agenda_ocorrencias --
--   logo agenda_ocorrencias_protecao nunca disparava para revalidar as
--   exceções existentes contra o novo estado do pai. agenda_itens_protecao
--   agora valida, quando o item já tem qualquer agenda_ocorrencias:
--     * hora_inicio/hora_fim/dia_inteiro: para CADA exceção existente,
--       horário efetivo (coalesce override, novo valor do item) precisa
--       continuar coerente (dia inteiro sem override de hora; fim
--       efetivo nunca antes do início efetivo) -- rejeita o UPDATE
--       inteiro se qualquer exceção ficaria inválida;
--     * tipo: mudar para 'evento' é rejeitado se existir exceção já
--       concluida=true (só válida para tarefa).
--   O mesmo par de checagens de horário foi replicado como pré-checagem
--   (mensagem amigável) em editar_serie_agenda_esta_e_proximas, com
--   backstop estrutural continuando em agenda_ocorrencias_protecao (que
--   já validava o horário efetivo contra o item pai correto -- inclusive
--   durante o split, contra a série NOVA -- desde a revisão 3).
--
-- ============================================================
-- REVISÃO 5 -- pré-auditoria real do Supabase aprovada; lacuna de
-- auditoria de conclusão/reabertura fechada:
-- ============================================================
--   concluir_ocorrencia_agenda e reabrir_ocorrencia_agenda agora também
--   registram em logs_auditoria (entidade=agenda_ocorrencia, campo=
--   concluida, mesmo padrão de cancelar_ocorrencia_agenda/editar_serie_
--   agenda_esta_e_proximas/excluir_serie_agenda já existente). Concluir
--   só loga quando a ocorrência NÃO estava concluída antes da chamada
--   (captura o estado prévio antes do UPSERT) -- preserva o UPSERT
--   idempotente já existente, nunca um log falso para uma repetição
--   sem efeito. Reabrir loga nos dois caminhos de saída (limpeza por
--   DELETE e UPDATE normal) -- a função já rejeita com exceção qualquer
--   chamada onde a ocorrência não estava concluída, então toda chamada
--   bem-sucedida é sempre uma transição real, sem caminho de no-op a
--   proteger. Nenhuma outra semântica das RPCs foi alterada. FK de
--   criado_por/concluido_por para auth.users(id) reconfirmada como
--   correta pela pré-auditoria real (único padrão usado em TODO o
--   projeto para "quem fez esta ação" -- dashboard_lembretes,
--   produtos_historico_compras, producao_expositor_lotes; public.
--   usuarios(id) é usado só por usuario_permissoes, semântica
--   diferente) -- mantida sem alteração.
--
-- ============================================================
-- REVISÃO 6 -- última lacuna de auditoria fechada (alterar_ocorrencia_agenda):
-- ============================================================
--   alterar_ocorrencia_agenda agora captura o estado ANTES do UPSERT
--   (v_antes) e audita, campo a campo, com IS DISTINCT FROM (null-safe),
--   só os 5 campos que esta função realmente pode alterar --
--   titulo_override, descricao_override, data_override,
--   hora_inicio_override, hora_fim_override (cancelada/concluida/motivo
--   nunca são tocados por ela, confirmado por leitura direta do UPSERT,
--   e por isso nunca entram nesta auditoria). 1 linha de logs_auditoria
--   por campo que de fato mudou (entidade=agenda_ocorrencia,
--   registro_id=item_id|data_ocorrencia ORIGINAL -- nunca data_override
--   --, acao=alterou); nenhuma linha para campo que não mudou; nenhuma
--   linha nenhuma se a chamada não alterar nada. Nenhuma validação de
--   colisão/horário efetivo/recorrência/GUC foi tocada -- só a auditoria
--   foi acrescentada, depois do UPSERT já concluído.
--
-- ============================================================
-- REVISÃO 7 -- último ponto de auditoria fechado (cancelar_ocorrencia_agenda):
-- ============================================================
--   cancelar_ocorrencia_agenda reaproveita a leitura v_existente (já
--   feita para a checagem de concluida) para capturar cancelada/motivo
--   ANTES do UPSERT. Depois: campo=cancelada só loga na transição real
--   false->true (recancelar uma ocorrência já cancelada nunca gera este
--   log de novo -- a RPC continua permitindo recancelar, sem virar
--   erro); campo=motivo só loga quando IS DISTINCT FROM (null-safe)
--   detecta mudança real -- mesmo motivo repetido = zero log; motivo
--   diferente = só o log do motivo, sem repetir o de cancelada. Nenhuma
--   validação/permissão/identidade/proteção existente foi alterada, só
--   a auditoria. Com isso, as 6 RPCs mutáveis da Agenda (concluir/
--   reabrir/cancelar/alterar_ocorrencia_agenda, editar_serie_agenda_
--   esta_e_proximas, excluir_serie_agenda) têm auditoria em
--   logs_auditoria sem nenhum log falso para no-op conhecido.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rodar manualmente no SQL Editor do
-- Supabase, depois de rodar e conferir pre_auditoria_agenda_EXECUTAR.sql
-- (se existir — ver nota de pré-auditoria abaixo) ou, se dispensado,
-- depois de conferir este cabeçalho contra o código/migrations reais.
--
-- IMPORTANTE — numeração: a frente de Pedidos/Compras Presenciais já
-- reservou 0037 (supabase/migrations/0037_pedidos_compras_presenciais.sql
-- e o _EXECUTAR correspondente já existem no working tree, ainda não
-- commitados). Reconfirmado imediatamente antes de escrever este
-- arquivo: HEAD = c292c5e (0036), git status não mostra nenhum 0038 em
-- lugar nenhum — 0038 está livre. Esta migration NÃO depende de nada da
-- 0037 e não toca em nenhum objeto de Pedidos/Compras.
--
-- Pré-requisitos reais (dependências de SQL, todas já aplicadas):
--   * public.has_permissao(text) / public.is_admin() — 0003.
--   * public.logs_auditoria + trigger logs_auditoria_preencher_usuario —
--     0004 (usuario_id/nome/email preenchidos automaticamente, nunca
--     pelo cliente).
--   * auth.users — Supabase Auth, base de FK de criado_por/concluido_por
--     (mesmo alvo de FK já usado por logs_auditoria.usuario_id em 0004).
--   * public.permissoes / public.perfil_permissoes — 0001 (catálogo de
--     permissões + concessão por perfil).
--
-- ESCOPO — SOMENTE:
--   * 3 tabelas novas: agenda_categorias, agenda_itens,
--     agenda_ocorrencias;
--   * 2 funções de trigger de proteção (1 por tabela de dado) +
--     respectivas triggers;
--   * 1 função helper pura (validação de array sem duplicidade) usada
--     em CHECK;
--   * 1 função helper pura (validação de ocorrência contra a regra de
--     recorrência) usada pelas RPCs;
--   * 6 RPCs: concluir_ocorrencia_agenda, reabrir_ocorrencia_agenda,
--     cancelar_ocorrencia_agenda, alterar_ocorrencia_agenda,
--     editar_serie_agenda_esta_e_proximas, excluir_serie_agenda;
--   * 4 códigos novos de permissão (agenda.visualizar/inserir/editar/
--     excluir) + concessão a proprietario_admin (tudo),
--     gestao/operacional/financeiro_administrativo (visualizar/inserir/
--     editar, nunca excluir — mesmo padrão já usado por producao.* em
--     0001, onde só proprietario_admin recebe .excluir).
-- Esta migration NÃO faz, e não deve fazer:
--   * nenhuma coluna usuario_id/responsavel_id/atribuido_a/
--     participantes em agenda_itens/agenda_ocorrencias (decisão V1:
--     Agenda compartilhada, sem atribuição individual);
--   * nenhuma coluna pedido_id/fornecedor_id/produto_id em nenhuma
--     tabela nova (Agenda V1 totalmente desacoplada de Pedidos/Compras/
--     Produção);
--   * nenhuma alteração em pages/pedidos.js, components/pedidos/*,
--     public.pedidos, public.pedido_itens,
--     public.produtos_historico_compras,
--     public.produtos_resumo_compras, fornecedores.modalidade_compra ou
--     qualquer RPC de Pedidos — nenhum desses objetos é sequer
--     referenciado neste arquivo;
--   * nenhuma tabela agenda_recorrencias separada — a regra de
--     recorrência fica embutida em agenda_itens (1:1 sempre, nunca
--     1:N — ver arquitetura aprovada);
--   * nenhuma materialização de ocorrências futuras — agenda_ocorrencias
--     guarda SOMENTE estado/exceção (concluída, cancelada, alterada),
--     nunca uma linha por ocorrência normal;
--   * nenhum uso do FullCalendar como fonte de verdade de recorrência —
--     isso é responsabilidade exclusiva desta migration + de
--     lib/agenda/expandirRecorrencia.js no frontend, nunca do plugin
--     rrule da lib.
--
-- Grants — lição aplicada explicitamente (achado relatado pelo usuário
-- na frente paralela de Pedidos, migration 0037: uma função auxiliar
-- ficou sem REVOKE explícito de PUBLIC, que é o GRANT padrão que o
-- Postgres concede sozinho a qualquer função nova se ninguém revogar).
-- TODA função criada aqui — incluindo os 2 helpers puros — recebe
-- REVOKE explícito de public e anon + GRANT explícito só para
-- authenticated, sem exceção, mesmo padrão já usado em todo o projeto
-- desde a 0003.
--
-- SECURITY INVOKER em TODAS as 6 RPCs e nos 2 helpers (decisão desta
-- migration, caso a caso, não fechada de antemão): toda tabela nova tem
-- policy própria de RLS para o comando relevante (agenda.visualizar/
-- inserir/editar/excluir) — não há nenhum caso aqui em que a RLS
-- estruturalmente bloqueie o chamador (diferente de excluir_produto_
-- catalogo/excluir_catalogo_secao/excluir_catalogo_categoria, que são
-- DEFINER porque aquelas 3 tabelas não têm NENHUMA policy de DELETE).
-- Mesmo raciocínio já usado em editar_producao_registro/
-- excluir_producao_registro (INVOKER, apesar de fazerem DELETE/UPDATE
-- sensível) — a RLS já é a garantia real, a RPC só adiciona atomicidade
-- multi-linha e valores que não podem vir do cliente.
--
-- concluido_por nunca vem do cliente, em NENHUM caminho (RPC OU UPDATE
-- direto): as triggers de proteção (seção 5) sobrescrevem
-- concluido_em/concluido_por sempre que a transição de conclusão
-- acontece, ignorando qualquer valor enviado — isso cobre tanto as RPCs
-- de ocorrência quanto a conclusão de tarefa NÃO recorrente (UPDATE
-- direto via RLS, sem RPC dedicada — a proteção está na trigger, não em
-- mais uma função).
--
-- Envolvida em transação explícita (BEGIN/COMMIT).

BEGIN;

-- ============================================================
-- 1. public.agenda_categorias
-- ============================================================
-- Mesmo padrão de producao_tipos/producao_grupos (0036): chave natural
-- (o próprio texto), sem coluna id separada, sem duplicidade
-- código/nome. Ciclo: criar/renomear/ativar/inativar — sem exclusão
-- física pela interface.

create table if not exists public.agenda_categorias (
  valor         text primary key,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,

  -- Regra global do projeto para dados mestres: persistidos em
  -- MAIÚSCULAS, preservando acentos, sem espaço sobrando (upper() do
  -- Postgres, sob locale UTF-8 padrão do Supabase, converte
  -- corretamente á/ã/ç/õ/ê etc.). Título/descrição de agenda_itens NÃO
  -- seguem esta regra (campos narrativos). Este CHECK é só a garantia
  -- DEFENSIVA -- a normalização de verdade acontece na trigger
  -- agenda_categorias_protecao (seção 1.1 abaixo), que roda ANTES deste
  -- CHECK ser avaliado (BEFORE ROW trigger sempre precede a checagem de
  -- constraint na mesma operação) -- então, na prática, este CHECK nunca
  -- deveria falhar por si só; ele existe para nunca depender só da
  -- trigger continuar existindo/correta no futuro.
  constraint agenda_categorias_valor_normalizado
    check (valor = upper(btrim(valor)) and valor <> '')
);

comment on table public.agenda_categorias is
  'Categorias da Agenda (ADMINISTRATIVO/PRODUÇÃO/COMPRAS/FINANCEIRO/MANUTENÇÃO/OUTROS, seedadas abaixo, em MAIÚSCULAS -- regra global do projeto para dados mestres). valor é a própria chave (sem id separado, mesmo padrão de producao_tipos/producao_grupos, migration 0036) — evita a duplicidade código/nome. ativo controla só se a categoria é oferecida para escolhas NOVAS; uma categoria já usada em agenda_itens continua válida mesmo depois de inativada (a FK checa só existência da linha, nunca o campo ativo). Sem DELETE físico pela interface. Normalização (trim+uppercase) acontece NA PERSISTÊNCIA em dois níveis de defesa: a trigger agenda_categorias_protecao (banco, sempre) e o frontend (GerenciarCategoriasAgendaModal.js, antes mesmo de chamar o banco) -- nenhum dos dois é o único a garantir isso.';

-- ============================================================
-- 1.1 Normalização NA PERSISTÊNCIA (correção obrigatória desta revisão):
-- BEFORE INSERT/UPDATE força trim+uppercase, independente do que o
-- cliente mandar -- o frontend também normaliza antes de chamar o banco
-- (defesa em profundidade), mas a garantia real é aqui.
-- ============================================================

create or replace function public.agenda_categorias_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.valor := upper(btrim(new.valor));

  if new.valor = '' then
    raise exception 'agenda_categorias: valor da categoria nao pode ficar vazio apos normalizacao (trim + uppercase).';
  end if;

  return new;
end;
$$;

comment on function public.agenda_categorias_protecao() is
  'BEFORE INSERT/UPDATE de agenda_categorias. Normaliza NEW.valor := upper(btrim(NEW.valor)), independente do que o cliente enviar -- preserva acentos, remove espaços nas pontas, rejeita resultado vazio. A constraint agenda_categorias_valor_normalizado é a garantia defensiva depois desta trigger, não a única.';

revoke execute on function public.agenda_categorias_protecao() from public;
revoke execute on function public.agenda_categorias_protecao() from anon;
revoke execute on function public.agenda_categorias_protecao() from authenticated;
revoke execute on function public.agenda_categorias_protecao() from service_role;

drop trigger if exists agenda_categorias_protecao_trigger on public.agenda_categorias;
create trigger agenda_categorias_protecao_trigger
  before insert or update on public.agenda_categorias
  for each row
  execute function public.agenda_categorias_protecao();

insert into public.agenda_categorias (valor, ativo) values
  ('ADMINISTRATIVO', true),
  ('PRODUÇÃO', true),
  ('COMPRAS', true),
  ('FINANCEIRO', true),
  ('MANUTENÇÃO', true),
  ('OUTROS', true)
on conflict (valor) do nothing;

alter table public.agenda_categorias enable row level security;

drop policy if exists agenda_categorias_select on public.agenda_categorias;
create policy agenda_categorias_select on public.agenda_categorias
  for select to authenticated using (true);

drop policy if exists agenda_categorias_insert on public.agenda_categorias;
create policy agenda_categorias_insert on public.agenda_categorias
  for insert to authenticated
  with check ((select public.has_permissao('agenda.editar')));

drop policy if exists agenda_categorias_update on public.agenda_categorias;
create policy agenda_categorias_update on public.agenda_categorias
  for update to authenticated
  using ((select public.has_permissao('agenda.editar')))
  with check ((select public.has_permissao('agenda.editar')));

-- Sem policy de DELETE — mesma filosofia de producao_tipos/producao_grupos.


-- ============================================================
-- 2. public.agenda_array_sem_duplicatas — helper puro (usado em CHECK)
-- ============================================================
-- CHECK constraints não podem conter subquery diretamente, mas PODEM
-- chamar uma função IMMUTABLE cujo corpo contenha uma — por isso este
-- helper existe (dedup de recorrencia_dias_semana), em vez de tentar
-- escrever array(select distinct unnest(...)) direto dentro do CHECK.

create or replace function public.agenda_array_sem_duplicatas(p_valores integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_valores is null
    or (select count(*) from unnest(p_valores)) = (select count(distinct v) from unnest(p_valores) as v);
$$;

comment on function public.agenda_array_sem_duplicatas(integer[]) is
  'Helper puro (sem acesso a tabela) usado em CHECK de agenda_itens: true se p_valores for NULL ou não tiver elementos repetidos. IMMUTABLE, sem efeito colateral. EXCEÇÃO DELIBERADA de grant (ver auditoria de grants no cabeçalho do arquivo): authenticated PRECISA de EXECUTE aqui porque este helper é avaliado dentro do CHECK constraint durante qualquer INSERT/UPDATE direto de agenda_itens feito pelo cliente via RLS (criar/editar série) -- revogar de authenticated quebraria essa escrita inteira. Continua revogado de public/anon/service_role. Sem risco real de exposição: função pura, sem side effect, sem leitura de dado sensível.';

revoke execute on function public.agenda_array_sem_duplicatas(integer[]) from public;
revoke execute on function public.agenda_array_sem_duplicatas(integer[]) from anon;
revoke execute on function public.agenda_array_sem_duplicatas(integer[]) from service_role;
grant execute on function public.agenda_array_sem_duplicatas(integer[]) to authenticated;


-- ============================================================
-- 3. public.agenda_itens
-- ============================================================
-- Tabela única para evento E tarefa (coluna tipo) — sem tabelas
-- separadas (decisão aprovada). Recorrência embutida aqui mesmo (sem
-- agenda_recorrencias satélite — relação sempre 1:1). status de tarefa
-- NÃO existe como coluna própria: pendente/concluída é derivado de
-- concluido_em (decisão aprovada, seção 11 da revisão).

create table if not exists public.agenda_itens (
  id                       uuid primary key default gen_random_uuid(),
  tipo                     text not null,
  titulo                   text not null,
  descricao                text,
  categoria                text not null
    references public.agenda_categorias(valor)
    on update cascade on delete restrict,

  -- datas/horas de calendário puro — NUNCA timestamptz (ver comentário
  -- de timezone ao final da seção 4).
  data_inicio              date not null,
  data_fim                 date,          -- só evento avulso multi-dia
  hora_inicio              time,
  hora_fim                 time,
  dia_inteiro              boolean not null default true,

  tipo_recorrencia         text not null default 'nenhuma',
  recorrencia_intervalo    integer,
  recorrencia_dias_semana  integer[],     -- 0=domingo..6=sábado (Date.getDay()/extract(dow))
  recorrencia_data_fim     date,

  -- conclusão de TAREFA NÃO recorrente (recorrente usa agenda_ocorrencias,
  -- nunca estas 2 colunas — ver constraint abaixo).
  concluido_em             timestamptz,
  concluido_por            uuid references auth.users(id),

  criado_por               uuid not null references auth.users(id),
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz,

  constraint agenda_itens_tipo_check
    check (tipo in ('evento','tarefa')),

  constraint agenda_itens_tipo_recorrencia_check
    check (tipo_recorrencia in ('nenhuma','diaria','semanal','mensal','anual')),

  -- intervalo obrigatório (e > 0) quando recorrente, proibido quando não.
  constraint agenda_itens_intervalo_obrigatorio_quando_recorrente
    check (tipo_recorrencia = 'nenhuma' or (recorrencia_intervalo is not null and recorrencia_intervalo > 0)),
  constraint agenda_itens_intervalo_so_recorrente
    check (tipo_recorrencia <> 'nenhuma' or recorrencia_intervalo is null),

  -- dias da semana: presentes SE E SOMENTE SE semanal; valores em 0..6;
  -- sem duplicidade; não vazio quando presente.
  constraint agenda_itens_dias_semana_biconditional
    check ((tipo_recorrencia = 'semanal') = (recorrencia_dias_semana is not null)),
  constraint agenda_itens_dias_semana_validos
    check (
      recorrencia_dias_semana is null
      or (
        recorrencia_dias_semana <@ array[0,1,2,3,4,5,6]
        and cardinality(recorrencia_dias_semana) > 0
        and public.agenda_array_sem_duplicatas(recorrencia_dias_semana)
      )
    ),

  -- fim da SÉRIE só quando recorrente, e nunca antes do início.
  constraint agenda_itens_data_fim_serie_so_recorrente
    check (tipo_recorrencia <> 'nenhuma' or recorrencia_data_fim is null),
  constraint agenda_itens_data_fim_serie_pos_inicio
    check (recorrencia_data_fim is null or recorrencia_data_fim >= data_inicio),

  -- data_fim (duração do EVENTO avulso) só evento, nunca recorrente
  -- (decisão 1: evento recorrente = 1 dia por ocorrência, sem duração
  -- própria), e nunca antes do início.
  constraint agenda_itens_data_fim_so_evento
    check (tipo = 'evento' or data_fim is null),
  constraint agenda_itens_data_fim_so_nao_recorrente
    check (tipo_recorrencia = 'nenhuma' or data_fim is null),
  constraint agenda_itens_data_fim_pos_inicio
    check (data_fim is null or data_fim >= data_inicio),

  -- dia inteiro coerente com horas: dia_inteiro=true exige as 2 horas
  -- nulas; dia_inteiro=false exige ao menos hora_inicio.
  constraint agenda_itens_dia_inteiro_coerente
    check (
      (dia_inteiro = true and hora_inicio is null and hora_fim is null)
      or (dia_inteiro = false and hora_inicio is not null)
    ),
  constraint agenda_itens_horas_coerentes
    check (hora_fim is null or hora_inicio is null or hora_fim >= hora_inicio),

  -- conclusão só em tarefa NÃO recorrente (recorrente usa
  -- agenda_ocorrencias — a série em si nunca é "concluída").
  constraint agenda_itens_conclusao_so_tarefa_nao_recorrente
    check (concluido_em is null or (tipo = 'tarefa' and tipo_recorrencia = 'nenhuma')),
  constraint agenda_itens_conclusao_par
    check ((concluido_em is null) = (concluido_por is null))
);

comment on table public.agenda_itens is
  'Item único de Agenda — evento OU tarefa (coluna tipo), avulso ou série recorrente (tipo_recorrencia). Regra de recorrência embutida nas próprias colunas (sem tabela satélite — relação sempre 1:1). Conclusão de tarefa NÃO recorrente fica em concluido_em/concluido_por aqui mesmo (pendente = concluido_em IS NULL); tarefa recorrente delega a conclusão de cada instância a agenda_ocorrencias. Sem nenhuma coluna de atribuição individual (usuario_id/responsavel_id) — Agenda V1 é compartilhada pela empresa inteira.';

create index if not exists agenda_itens_data_inicio_idx
  on public.agenda_itens (data_inicio);

create index if not exists agenda_itens_recorrente_idx
  on public.agenda_itens (tipo_recorrencia)
  where tipo_recorrencia <> 'nenhuma';

create index if not exists agenda_itens_categoria_idx
  on public.agenda_itens (categoria);

alter table public.agenda_itens enable row level security;

drop policy if exists agenda_itens_select on public.agenda_itens;
create policy agenda_itens_select on public.agenda_itens
  for select to authenticated
  using ((select public.has_permissao('agenda.visualizar')));

drop policy if exists agenda_itens_insert on public.agenda_itens;
create policy agenda_itens_insert on public.agenda_itens
  for insert to authenticated
  with check ((select public.has_permissao('agenda.inserir')));

drop policy if exists agenda_itens_update on public.agenda_itens;
create policy agenda_itens_update on public.agenda_itens
  for update to authenticated
  using ((select public.has_permissao('agenda.editar')))
  with check ((select public.has_permissao('agenda.editar')));

drop policy if exists agenda_itens_delete on public.agenda_itens;
create policy agenda_itens_delete on public.agenda_itens
  for delete to authenticated
  using ((select public.has_permissao('agenda.excluir')));


-- ============================================================
-- 4. public.agenda_ocorrencias
-- ============================================================
-- SOMENTE estado/exceção de uma ocorrência de série recorrente — NUNCA
-- materializa ocorrências normais. cancelada e concluida são flags
-- INDEPENDENTES (não um enum mutuamente exclusivo): uma ocorrência pode
-- ser alterada e depois concluída na mesma linha (decisão aprovada,
-- correção da rodada anterior).
--
-- IDENTIDADE IMUTÁVEL (decisão 4, muito importante): data_ocorrencia é
-- SEMPRE a data original calculada pela regra da série — nunca muda
-- quando a ocorrência é movida visualmente (isso é o papel exclusivo de
-- data_override). UNIQUE(agenda_item_id, data_ocorrencia) continua
-- identificando a ocorrência original mesmo depois de um override de
-- data. Imutabilidade de agenda_item_id/data_ocorrencia após a criação é
-- reforçada pela trigger de proteção (seção 5), não só pela ausência de
-- UPDATE desses campos nas RPCs.
--
-- TIMEZONE (correção incorporada desta rodada — a auditoria anterior
-- errou ao afirmar que o projeto nunca usa timestamptz; 0001, 0004,
-- 0007, 0012, 0016, 0021, 0022, 0023, 0028, 0030, 0036 usam timestamptz
-- para criado_em/atualizado_em/concluido_em — só producao_registros/
-- planejamento_producao, 0010/0011, usam timestamp puro, sendo a
-- exceção legada, não a regra): datas de calendário (data_inicio,
-- data_fim, recorrencia_data_fim, data_ocorrencia, data_override) usam
-- `date` puro; horas civis (hora_inicio, hora_fim, *_override) usam
-- `time` puro; metadados de auditoria (criado_em, atualizado_em,
-- concluido_em) usam `timestamptz` + now(), seguindo o padrão
-- predominante real do banco. America/Sao_Paulo continua sendo a
-- referência para "hoje"/"agora" no FRONTEND (dataLocalHoje(), nunca
-- now()/current_date do Postgres, sessão em UTC) — nunca converter uma
-- data civil YYYY-MM-DD via `new Date('YYYY-MM-DD')` cru (usar sempre o
-- sufixo T12:00:00, mesma técnica de indiceDiaSemana/diaDaSemanaExibicao).

create table if not exists public.agenda_ocorrencias (
  id                    uuid primary key default gen_random_uuid(),
  agenda_item_id        uuid not null references public.agenda_itens(id) on delete cascade,
  data_ocorrencia       date not null,

  cancelada             boolean not null default false,

  titulo_override       text,
  descricao_override    text,
  data_override         date,
  hora_inicio_override  time,
  hora_fim_override     time,

  concluida             boolean not null default false,
  concluido_em          timestamptz,
  concluido_por         uuid references auth.users(id),

  motivo                text,

  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz,

  constraint agenda_ocorrencias_slot_unico
    unique (agenda_item_id, data_ocorrencia),

  constraint agenda_ocorrencias_conclusao_par
    check (
      (concluida and concluido_em is not null and concluido_por is not null)
      or (not concluida and concluido_em is null and concluido_por is null)
    ),

  -- cancelada e concluida NÃO simultâneas (mas cancelada/concluida COM
  -- overrides preenchidos é permitido — "alterada depois concluída").
  constraint agenda_ocorrencias_cancelada_nao_concluida
    check (not (cancelada and concluida)),

  -- a linha nunca fica semanticamente vazia — mesma filosofia de
  -- planejamento_producao_nao_vazio (0010). As RPCs de reabertura usam
  -- isto como guarda: se nada mais sobrar depois de limpar a conclusão,
  -- a RPC precisa apagar a linha em vez de tentar um UPDATE que isto
  -- rejeitaria.
  constraint agenda_ocorrencias_nao_vazia
    check (
      cancelada or concluida
      or titulo_override is not null or descricao_override is not null
      or data_override is not null or hora_inicio_override is not null
      or hora_fim_override is not null
    ),

  constraint agenda_ocorrencias_horas_override_coerentes
    check (hora_fim_override is null or hora_inicio_override is null or hora_fim_override >= hora_inicio_override)
);

comment on table public.agenda_ocorrencias is
  'Estado/exceção de UMA ocorrência de uma série recorrente (agenda_itens.tipo_recorrencia <> nenhuma) — nunca materializa ocorrências normais/sem desvio. data_ocorrencia é a identidade IMUTÁVEL da instância (a data original calculada pela regra da série), protegida por trigger contra alteração após a criação; data_override move só a EXIBIÇÃO. cancelada e concluida são flags independentes (não mutuamente exclusivas entre si e overrides) — só cancelada×concluida juntas são proibidas. Linha nunca fica vazia (constraint agenda_ocorrencias_nao_vazia) — reabertura sem mais nenhum desvio relevante precisa apagar a linha, não deixá-la inerte.';

create index if not exists agenda_ocorrencias_data_idx
  on public.agenda_ocorrencias (data_ocorrencia);

-- Defesa ESTRUTURAL adicional (correção obrigatória desta revisão) contra
-- duas exceções da MESMA série apontando para o mesmo data_override --
-- fecha a race condition que a checagem `exists(...)` dentro de
-- alterar_ocorrencia_agenda sozinha não cobre (2 transações concorrentes
-- passando na checagem antes de qualquer uma commitar). Índice parcial
-- (WHERE data_override IS NOT NULL) porque múltiplas linhas com
-- data_override NULL são normais e não competem por nada. Não substitui
-- as checagens da RPC (que também cobrem colisão contra ocorrência
-- NORMAL da série, algo que este índice não alcança) -- é defesa em
-- profundidade, a RPC continua responsável pela mensagem de erro amigável
-- no caminho feliz; este índice é quem garante a atomicidade real sob
-- concorrência (a segunda transação recebe um erro cru 23505 do Postgres
-- se perder a corrida).
create unique index if not exists agenda_ocorrencias_data_override_unica
  on public.agenda_ocorrencias (agenda_item_id, data_override)
  where data_override is not null;

alter table public.agenda_ocorrencias enable row level security;

drop policy if exists agenda_ocorrencias_select on public.agenda_ocorrencias;
create policy agenda_ocorrencias_select on public.agenda_ocorrencias
  for select to authenticated
  using ((select public.has_permissao('agenda.visualizar')));

drop policy if exists agenda_ocorrencias_insert on public.agenda_ocorrencias;
create policy agenda_ocorrencias_insert on public.agenda_ocorrencias
  for insert to authenticated
  with check ((select public.has_permissao('agenda.editar')));

drop policy if exists agenda_ocorrencias_update on public.agenda_ocorrencias;
create policy agenda_ocorrencias_update on public.agenda_ocorrencias
  for update to authenticated
  using ((select public.has_permissao('agenda.editar')))
  with check ((select public.has_permissao('agenda.editar')));

-- DELETE necessário para a limpeza de reabertura (seção 8, RPC
-- reabrir_ocorrencia_agenda) — mesma permissão de edição, não excluir
-- (concluir/reabrir/cancelar/alterar ocorrência é sempre agenda.editar,
-- nunca agenda.excluir — decisão aprovada, seção 13).
drop policy if exists agenda_ocorrencias_delete on public.agenda_ocorrencias;
create policy agenda_ocorrencias_delete on public.agenda_ocorrencias
  for delete to authenticated
  using ((select public.has_permissao('agenda.editar')));


-- ============================================================
-- 5. Triggers de proteção — agenda_itens e agenda_ocorrencias
-- ============================================================
-- Onde CHECK não alcança (precisa ler outra tabela, ou precisa
-- sobrescrever o que o cliente mandou), a proteção vem daqui — mesmo
-- espírito de producao_registros_protecao (0010)/logs_auditoria_
-- preencher_usuario (0004). SECURITY DEFINER, mesmo padrão das triggers
-- de proteção já existentes no projeto (producao_registros_protecao,
-- producao_expositor_lotes_protecao).

create or replace function public.agenda_itens_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- criado_por NUNCA vem do cliente (mesmo raciocínio de
    -- logs_auditoria_preencher_usuario, 0004) -- sempre o auth.uid() real
    -- da sessão, independente do que o payload de INSERT contiver.
    new.criado_por := auth.uid();
    -- um item nunca nasce já concluído, seja qual for o valor enviado
    -- pelo cliente.
    new.concluido_em := null;
    new.concluido_por := null;
    return new;
  end if;

  -- criado_por é imutável após a criação, qualquer que seja o valor
  -- enviado num UPDATE.
  new.criado_por := old.criado_por;

  -- UPDATE: concluido_por NUNCA vem do cliente. Só recalcula quando a
  -- transição de conclusão (NULL <-> preenchido) realmente acontece
  -- nesta operação; caso contrário preserva o que já estava gravado,
  -- mesmo que o cliente tenha enviado outro valor em concluido_em/
  -- concluido_por junto de uma edição de outro campo (título etc.).
  if (old.concluido_em is null) <> (new.concluido_em is null) then
    if new.concluido_em is not null then
      new.concluido_em := now();
      new.concluido_por := auth.uid();
    else
      new.concluido_por := null;
    end if;
  else
    new.concluido_em := old.concluido_em;
    new.concluido_por := old.concluido_por;
  end if;

  -- ============================================================
  -- Guarda estrutural (correção obrigatória desta revisão): enquanto
  -- existir qualquer agenda_ocorrencias para este item, uma edição de
  -- "toda a série" NÃO pode alterar a fase/frequência da recorrência --
  -- isso deixaria data_ocorrencia de exceções já gravadas sem
  -- correspondência na regra nova. Para mudar a regra a partir de uma
  -- data específica, o caminho correto é "esta e as próximas"
  -- (editar_serie_agenda_esta_e_proximas), nunca esta edição direta.
  -- ============================================================
  if exists (select 1 from public.agenda_ocorrencias where agenda_item_id = old.id) then
    if new.data_inicio <> old.data_inicio
       or new.tipo_recorrencia <> old.tipo_recorrencia
       or new.recorrencia_intervalo is distinct from old.recorrencia_intervalo
       or new.recorrencia_dias_semana is distinct from old.recorrencia_dias_semana
    then
      raise exception 'agenda_itens: item % ja tem ocorrencias/excecoes registradas -- data_inicio/tipo_recorrencia/recorrencia_intervalo/recorrencia_dias_semana nao podem ser alterados enquanto existirem excecoes. Use "esta e as proximas" para mudar a regra a partir de uma data especifica.', old.id;
    end if;

    -- recorrencia_data_fim é a UNICA excecao a essa regra, e só num
    -- sentido: pode ENCURTAR (é exatamente o que o split de série faz
    -- ao fechar a série antiga), nunca alongar/limpar, e nunca pode
    -- cortar antes de uma exceção já existente (orfanizaria essa
    -- exceção -- ela apontaria para uma data que a regra nova não
    -- reconhece mais).
    if new.recorrencia_data_fim is distinct from old.recorrencia_data_fim then
      if old.recorrencia_data_fim is not null
         and (new.recorrencia_data_fim is null or new.recorrencia_data_fim > old.recorrencia_data_fim)
      then
        raise exception 'agenda_itens: item % ja tem ocorrencias/excecoes registradas -- recorrencia_data_fim so pode ser encurtada (nunca alongada ou limpa) enquanto existirem excecoes. Use "esta e as proximas" para uma mudanca de regra mais ampla.', old.id;
      end if;

      if exists (
        select 1 from public.agenda_ocorrencias
        where agenda_item_id = old.id
          and data_ocorrencia > coalesce(new.recorrencia_data_fim, 'infinity'::date)
      ) then
        raise exception 'agenda_itens: essa alteracao de recorrencia_data_fim deixaria excecoes ja existentes do item % fora da regra da serie.', old.id;
      end if;
    end if;

    -- CORREÇÃO OBRIGATÓRIA (gap encontrado após a revisão 3): mudar
    -- hora_inicio/hora_fim/dia_inteiro do item pai NÃO dispara
    -- agenda_ocorrencias_protecao -- a linha da exceção em si não é
    -- tocada por essa edição -- então uma exceção com override parcial
    -- (ex.: só hora_inicio_override) podia ficar com horário EFETIVO
    -- incoerente silenciosamente (fim do item pai passando a ficar antes
    -- do início sobreposto pela exceção, ou o item virando dia inteiro
    -- com uma exceção ainda "tendo hora"). Valida TODAS as exceções
    -- existentes do item contra o estado NOVO antes de aceitar a
    -- mudança -- mesma fórmula de horário efetivo usada em
    -- agenda_ocorrencias_protecao (coalesce(override, valor do item)),
    -- aplicada aqui via EXISTS sobre todas as linhas de uma vez, em vez
    -- de depender de cada linha ser revalidada individualmente (o que só
    -- aconteceria se ALGUÉM tocasse a exceção, que é exatamente o que
    -- não acontece nesta edição).
    if new.hora_inicio is distinct from old.hora_inicio
       or new.hora_fim is distinct from old.hora_fim
       or new.dia_inteiro is distinct from old.dia_inteiro
    then
      if new.dia_inteiro then
        if exists (
          select 1 from public.agenda_ocorrencias
          where agenda_item_id = old.id
            and (hora_inicio_override is not null or hora_fim_override is not null)
        ) then
          raise exception 'agenda_itens: nao e possivel aplicar esta mudanca de horario/dia inteiro ao item % -- existem excecoes com hora_inicio_override/hora_fim_override que ficariam incoerentes (item dia inteiro nao pode ter hora sobreposta). Ajuste/remova esses overrides antes, ou use "esta e as proximas".', old.id;
        end if;
      else
        if exists (
          select 1 from public.agenda_ocorrencias
          where agenda_item_id = old.id
            and coalesce(hora_inicio_override, new.hora_inicio) is not null
            and coalesce(hora_fim_override, new.hora_fim) is not null
            and coalesce(hora_fim_override, new.hora_fim) < coalesce(hora_inicio_override, new.hora_inicio)
        ) then
          raise exception 'agenda_itens: nao e possivel aplicar este novo horario ao item % -- pelo menos uma excecao existente ficaria com horario efetivo invalido (fim antes do inicio, considerando o fallback para o horario do item). Ajuste/remova o override dessa excecao antes, ou use "esta e as proximas" para uma serie nova.', old.id;
        end if;
      end if;
    end if;

    -- CORREÇÃO OBRIGATÓRIA (mesmo gap, outra dimensão encontrada na
    -- revisão estática pedida): mudar tipo de 'tarefa' para 'evento'
    -- também não toca nenhuma linha de agenda_ocorrencias -- uma exceção
    -- já concluida=true (só válida para tarefa, conforme
    -- agenda_ocorrencias_protecao) ficaria incoerente com o item virando
    -- evento. O sentido oposto (evento -> tarefa) nunca invalida nada
    -- (exceção de evento nunca tem concluida=true, já garantido).
    if new.tipo <> old.tipo and new.tipo <> 'tarefa' and exists (
      select 1 from public.agenda_ocorrencias where agenda_item_id = old.id and concluida = true
    ) then
      raise exception 'agenda_itens: nao e possivel mudar o tipo do item % para evento -- existem excecoes ja concluidas (concluida=true), validas somente para tarefa.', old.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.agenda_itens_protecao() is
  'BEFORE INSERT/UPDATE de agenda_itens. INSERT: força criado_por = auth.uid() (nunca o cliente) e concluido_em/concluido_por nulos (item nunca nasce concluído). UPDATE: criado_por é imutável; concluido_por só é recalculado (auth.uid()) quando concluido_em de fato transiciona NULL<->preenchido nesta operação, preservando o valor já gravado em qualquer outra edição. GUARDA ESTRUTURAL (se o item já tiver qualquer agenda_ocorrencias): bloqueia mudar data_inicio/tipo_recorrencia/recorrencia_intervalo/recorrencia_dias_semana; recorrencia_data_fim só pode ser encurtada, nunca alongada/limpa, e nunca cortando antes de uma exceção existente; mudar hora_inicio/hora_fim/dia_inteiro é validado contra o horário EFETIVO (coalesce com override) de TODAS as exceções existentes -- rejeita se alguma ficaria incoerente (dia inteiro com override de hora, ou fim efetivo antes do início efetivo); mudar tipo para evento é rejeitado se existir exceção já concluida=true (só válida para tarefa). Objetivo: nenhuma edição de "toda a série" pode deixar uma exceção já gravada semanticamente órfã/incoerente -- mudanças de regra mais amplas exigem editar_serie_agenda_esta_e_proximas.';

revoke execute on function public.agenda_itens_protecao() from public;
revoke execute on function public.agenda_itens_protecao() from anon;
revoke execute on function public.agenda_itens_protecao() from authenticated;
revoke execute on function public.agenda_itens_protecao() from service_role;

drop trigger if exists agenda_itens_protecao_trigger on public.agenda_itens;
create trigger agenda_itens_protecao_trigger
  before insert or update on public.agenda_itens
  for each row
  execute function public.agenda_itens_protecao();


create or replace function public.agenda_ocorrencias_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo                 text;
  v_dia_inteiro          boolean;
  v_hora_inicio_item     time;
  v_hora_fim_item        time;
  v_hora_inicio_efetiva  time;
  v_hora_fim_efetiva     time;
  v_tipo_recorrencia     text;
  v_data_inicio          date;
  v_intervalo            integer;
  v_dias_semana          integer[];
  v_data_fim_serie       date;
begin
  if tg_op = 'UPDATE' then
    if new.agenda_item_id <> old.agenda_item_id then
      -- Bloqueado por padrão (identidade imutável) -- EXCETO dentro do
      -- fluxo de split de série (editar_serie_agenda_esta_e_proximas).
      -- CORREÇÃO OBRIGATÓRIA desta revisão: o GUC de sessão sozinho NÃO
      -- é mais suficiente -- também exige current_user <> session_user,
      -- ou seja, que a execução esteja de fato DENTRO de uma função
      -- SECURITY DEFINER (a única forma de current_user divergir de
      -- session_user no Postgres). session_user é sempre o papel que
      -- efetivamente autenticou a conexão (authenticated/anon/
      -- service_role, conforme o JWT que o PostgREST usa) e NUNCA muda
      -- durante a sessão; current_user é o papel EFETIVO no ponto atual
      -- de execução, e só diverge de session_user dentro do corpo de
      -- uma função SECURITY DEFINER (onde vira o dono da função -- aqui,
      -- o mesmo dono das 4 RPCs SECURITY DEFINER desta migration). Um
      -- cliente comum via PostgREST (RPC ou REST direto) NUNCA consegue
      -- fazer current_user divergir de session_user por conta própria --
      -- não existe SET ROLE disponível para authenticated, e a única
      -- forma de entrar num contexto SECURITY DEFINER é chamando uma das
      -- RPCs, que já faz sua própria checagem de has_permissao ANTES de
      -- chegar a este ponto. Logo, setar sozinho o GUC (ex.: via alguma
      -- chamada hipotética de SQL bruto) nunca bastaria para satisfazer
      -- também current_user <> session_user.
      if coalesce(current_setting('agenda.permitir_realocacao_ocorrencia', true), 'off') <> 'on'
         or current_user = session_user
      then
        raise exception 'agenda_ocorrencias: agenda_item_id e imutavel (identidade da ocorrencia, registro %) fora do fluxo de split de serie sob execucao privilegiada.', old.id;
      end if;
    end if;
    if new.data_ocorrencia <> old.data_ocorrencia then
      raise exception 'agenda_ocorrencias: data_ocorrencia e imutavel -- representa sempre a data original calculada pela regra da serie, nunca a data apos um override (registro %). Para mover a exibicao, use data_override.', old.id;
    end if;
  end if;

  select tipo, dia_inteiro, hora_inicio, hora_fim,
         tipo_recorrencia, data_inicio, recorrencia_intervalo, recorrencia_dias_semana, recorrencia_data_fim
    into v_tipo, v_dia_inteiro, v_hora_inicio_item, v_hora_fim_item,
         v_tipo_recorrencia, v_data_inicio, v_intervalo, v_dias_semana, v_data_fim_serie
  from public.agenda_itens where id = new.agenda_item_id;

  -- CORREÇÃO OBRIGATÓRIA desta revisão: agenda_ocorrencias só existe
  -- para série RECORRENTE -- nunca para item avulso (tipo_recorrencia=
  -- nenhuma). Isso é checado aqui, na trigger, não só nas RPCs -- CRUD
  -- direto (INSERT/UPDATE) autorizado pela RLS de agenda_ocorrencias
  -- (has_permissao('agenda.editar')) não pode contornar esta regra.
  if v_tipo_recorrencia = 'nenhuma' then
    raise exception 'agenda_ocorrencias: item % nao e uma serie recorrente -- agenda_ocorrencias so representa excecoes de series recorrentes.', new.agenda_item_id;
  end if;

  -- CORREÇÃO OBRIGATÓRIA desta revisão: NEW.data_ocorrencia TEM que ser
  -- uma ocorrência REAL da regra ATUAL do item pai (new.agenda_item_id
  -- -- no split, já é o item NOVO, pois a realocação já aconteceu antes
  -- desta linha ser revalidada). Roda em TODO INSERT e em TODO UPDATE
  -- (não só quando agenda_item_id muda) -- é sempre idempotente/inofensiva
  -- quando nada relevante mudou (a linha já era válida), e é EXATAMENTE
  -- o que faz o split abortar (ver comentário da função
  -- editar_serie_agenda_esta_e_proximas) se uma exceção realocada não
  -- for compatível com a regra da nova série: o UPDATE de realocação do
  -- passo 2 dispara esta mesma checagem, para CADA linha realocada, e
  -- uma falha aqui propaga como exceção, desfazendo TODA a transação do
  -- split (nenhuma exceção incompatível é descartada silenciosamente,
  -- nem fica órfã).
  if not public.agenda_ocorrencia_e_valida(
    v_tipo_recorrencia, v_data_inicio, v_intervalo, v_dias_semana, v_data_fim_serie, new.data_ocorrencia
  ) then
    raise exception 'agenda_ocorrencias: % nao e uma ocorrencia valida da serie % (item_id) pela regra atual -- CRUD direto e RPCs nunca podem gravar uma excecao em data arbitraria, e um split para uma nova regra incompativel com esta excecao deve abortar, nao descarta-la.', new.data_ocorrencia, new.agenda_item_id;
  end if;

  -- só uma ocorrência de TAREFA pode ser concluída (evento nunca).
  if new.concluida and v_tipo <> 'tarefa' then
    raise exception 'agenda_ocorrencias: so uma ocorrencia de tarefa pode ser concluida (item % e evento).', new.agenda_item_id;
  end if;

  -- override de hora só faz sentido se o item pai tiver hora (não é
  -- dia_inteiro) -- checagem cruzada que nenhum CHECK alcançaria.
  if v_dia_inteiro and (new.hora_inicio_override is not null or new.hora_fim_override is not null) then
    raise exception 'agenda_ocorrencias: item % e dia inteiro -- nao faz sentido sobrepor hora_inicio_override/hora_fim_override.', new.agenda_item_id;
  end if;

  -- Horários EFETIVOS (correção obrigatória desta revisão): considera o
  -- fallback para o horário do item pai quando só um dos dois overrides
  -- foi informado -- nunca confia só num CHECK que compare os 2 campos
  -- override isoladamente (isso deixaria passar, por exemplo, um
  -- hora_inicio_override sozinho mais tarde que o hora_fim do item pai).
  if not v_dia_inteiro then
    v_hora_inicio_efetiva := coalesce(new.hora_inicio_override, v_hora_inicio_item);
    v_hora_fim_efetiva := coalesce(new.hora_fim_override, v_hora_fim_item);
    if v_hora_inicio_efetiva is not null and v_hora_fim_efetiva is not null
       and v_hora_fim_efetiva < v_hora_inicio_efetiva
    then
      raise exception 'agenda_ocorrencias: horario efetivo desta ocorrencia (% -- %) e invalido -- fim antes do inicio, considerando o fallback para os horarios do item quando so um dos dois foi sobreposto.', v_hora_inicio_efetiva, v_hora_fim_efetiva;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.concluida then
      new.concluido_em := now();
      new.concluido_por := auth.uid();
    else
      new.concluido_em := null;
      new.concluido_por := null;
    end if;
    return new;
  end if;

  -- UPDATE: mesma lógica anti-falsificação de agenda_itens_protecao,
  -- agora chaveada pela flag concluida em vez da nulidade de concluido_em.
  if old.concluida <> new.concluida then
    if new.concluida then
      new.concluido_em := now();
      new.concluido_por := auth.uid();
    else
      new.concluido_em := null;
      new.concluido_por := null;
    end if;
  else
    new.concluido_em := old.concluido_em;
    new.concluido_por := old.concluido_por;
  end if;

  return new;
end;
$$;

comment on function public.agenda_ocorrencias_protecao() is
  'BEFORE INSERT/UPDATE de agenda_ocorrencias. (1) Torna data_ocorrencia imutável após a criação; agenda_item_id também é imutável, EXCETO dentro do fluxo de split de série -- exige SIMULTANEAMENTE o GUC de sessão agenda.permitir_realocacao_ocorrencia=on E current_user <> session_user (só verdadeiro dentro de uma função SECURITY DEFINER; um cliente comum via PostgREST nunca consegue fazer as duas coisas por conta própria). (2) rejeita item pai com tipo_recorrencia=nenhuma -- agenda_ocorrencias só existe para série recorrente. (3) valida NEW.data_ocorrencia contra a regra ATUAL do item pai via agenda_ocorrencia_e_valida, em TODO INSERT/UPDATE -- garante que CRUD direto (RLS) nunca grava exceção em data arbitrária, e faz o split de série ("esta e as próximas") abortar a transação inteira se uma exceção realocada não for válida na nova regra (nunca descarta silenciosamente, nunca fica órfã). (4) bloqueia concluida=true quando o item pai não é tipo=tarefa. (5) bloqueia hora_*_override quando o item pai é dia_inteiro. (6) valida os horários EFETIVOS (fallback para hora_inicio/hora_fim do item pai quando só um override foi informado) -- fim efetivo nunca antes do início efetivo. (7) garante que concluido_em/concluido_por nunca sejam falsificados pelo cliente: forçados a now()/auth.uid() só na transição para concluida=true, a NULL/NULL só na transição para concluida=false, preservados em qualquer outra edição.';

revoke execute on function public.agenda_ocorrencias_protecao() from public;
revoke execute on function public.agenda_ocorrencias_protecao() from anon;
revoke execute on function public.agenda_ocorrencias_protecao() from authenticated;
revoke execute on function public.agenda_ocorrencias_protecao() from service_role;

drop trigger if exists agenda_ocorrencias_protecao_trigger on public.agenda_ocorrencias;
create trigger agenda_ocorrencias_protecao_trigger
  before insert or update on public.agenda_ocorrencias
  for each row
  execute function public.agenda_ocorrencias_protecao();


-- ============================================================
-- 6. public.agenda_ocorrencia_e_valida — helper puro (validação de data)
-- ============================================================
-- Confirma que p_data_ocorrencia é REALMENTE uma ocorrência que a regra
-- de recorrência informada produziria — usada por TODAS as RPCs que
-- recebem (agenda_item_id, data_ocorrencia), para nunca aceitar uma data
-- arbitrária (ex.: quarta-feira numa série "só segunda-feira"). Espelha
-- exatamente o algoritmo de expansão do frontend
-- (lib/agenda/expandirRecorrencia.js) -- qualquer mudança num dos dois
-- lados precisa ser replicada no outro.
--
-- Pura (sem acesso a tabela, IMMUTABLE) -- os parâmetros da série vêm de
-- quem chama (que já leu a linha de agenda_itens sob a própria RLS).
-- Isso evita qualquer ambiguidade de SECURITY INVOKER/DEFINER aqui: não
-- há tabela para proteger.

create or replace function public.agenda_ocorrencia_e_valida(
  p_tipo_recorrencia text,
  p_data_inicio date,
  p_intervalo integer,
  p_dias_semana integer[],
  p_data_fim_serie date,
  p_data_ocorrencia date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_tipo_recorrencia
    when 'nenhuma' then
      p_data_ocorrencia = p_data_inicio

    when 'diaria' then
      p_data_ocorrencia >= p_data_inicio
      and (p_data_fim_serie is null or p_data_ocorrencia <= p_data_fim_serie)
      and mod(p_data_ocorrencia - p_data_inicio, p_intervalo) = 0

    when 'semanal' then
      p_data_ocorrencia >= p_data_inicio
      and (p_data_fim_serie is null or p_data_ocorrencia <= p_data_fim_serie)
      and extract(dow from p_data_ocorrencia)::integer = any(p_dias_semana)
      and mod(
            (date_trunc('week', p_data_ocorrencia::timestamp)::date
             - date_trunc('week', p_data_inicio::timestamp)::date) / 7,
            p_intervalo
          ) = 0

    when 'mensal' then
      p_data_ocorrencia >= p_data_inicio
      and (p_data_fim_serie is null or p_data_ocorrencia <= p_data_fim_serie)
      and extract(day from p_data_ocorrencia) = extract(day from p_data_inicio)
      and mod(
            (extract(year from p_data_ocorrencia)::integer - extract(year from p_data_inicio)::integer) * 12
            + (extract(month from p_data_ocorrencia)::integer - extract(month from p_data_inicio)::integer),
            p_intervalo
          ) = 0

    when 'anual' then
      p_data_ocorrencia >= p_data_inicio
      and (p_data_fim_serie is null or p_data_ocorrencia <= p_data_fim_serie)
      and extract(month from p_data_ocorrencia) = extract(month from p_data_inicio)
      and extract(day from p_data_ocorrencia) = extract(day from p_data_inicio)
      and mod(
            extract(year from p_data_ocorrencia)::integer - extract(year from p_data_inicio)::integer,
            p_intervalo
          ) = 0

    else false
  end;
$$;

comment on function public.agenda_ocorrencia_e_valida(text, date, integer, integer[], date, date) is
  'Confirma se p_data_ocorrencia é uma ocorrência real da regra de recorrência informada (mesmo algoritmo de lib/agenda/expandirRecorrencia.js). mensal usa o dia-do-mês de p_data_inicio literal -- mês sem esse dia nunca bate (nunca desliza para o último dia); anual usa mês+dia literais -- 29/02 só bate em ano bissexto. HELPER INTERNO, NUNCA uma RPC pública: sem EXECUTE para public/anon/authenticated/service_role -- só o dono (quem aplicou esta migration) pode chamá-la, o que basta porque as 4 RPCs que a usam (concluir_ocorrencia_agenda, cancelar_ocorrencia_agenda, alterar_ocorrencia_agenda, editar_serie_agenda_esta_e_proximas) são SECURITY DEFINER e rodam como o dono por dentro -- authenticated nunca precisa (nem consegue) chamar esta função diretamente.';

revoke execute on function public.agenda_ocorrencia_e_valida(text, date, integer, integer[], date, date) from public;
revoke execute on function public.agenda_ocorrencia_e_valida(text, date, integer, integer[], date, date) from anon;
revoke execute on function public.agenda_ocorrencia_e_valida(text, date, integer, integer[], date, date) from authenticated;
revoke execute on function public.agenda_ocorrencia_e_valida(text, date, integer, integer[], date, date) from service_role;
-- Sem GRANT para ninguém, de propósito -- só o owner (superusuário/postgres,
-- pela forma como as migrations são aplicadas neste projeto) executa,
-- implicitamente, por ser o criador do objeto. As 4 RPCs SECURITY DEFINER
-- que a chamam também são de propriedade do mesmo owner, então a chamada
-- interna delas para este helper roda sob os privilégios do owner, nunca
-- do authenticated que efetivamente invocou a RPC via PostgREST.


-- ============================================================
-- 7. RPCs V1 (6) -- todas SECURITY INVOKER (RLS de agenda_itens/
--    agenda_ocorrencias já cobre o chamador em todos os casos; ver
--    justificativa no cabeçalho do arquivo)
-- ============================================================

-- 7.1 concluir_ocorrencia_agenda -- UPSERT controlado, preserva overrides.
create or replace function public.concluir_ocorrencia_agenda(
  p_agenda_item_id uuid,
  p_data_ocorrencia date
)
returns public.agenda_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item         public.agenda_itens;
  v_ocorrencia   public.agenda_ocorrencias;
  v_ja_concluida boolean;
begin
  -- SECURITY DEFINER (mudança desta revisão): a única razão é permitir
  -- chamar internamente o helper agenda_ocorrencia_e_valida, que fica
  -- deliberadamente sem EXECUTE para authenticated (ver comentário da
  -- função). Por isso a checagem de permissão que a RLS faria é
  -- replicada aqui, explícita e incondicional, como em excluir_produto_
  -- catalogo/excluir_producao_registro.
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'concluir_ocorrencia_agenda: requer a permissao agenda.editar.';
  end if;

  select * into v_item from public.agenda_itens where id = p_agenda_item_id;
  if v_item.id is null then
    raise exception 'concluir_ocorrencia_agenda: item % nao encontrado.', p_agenda_item_id;
  end if;

  if v_item.tipo <> 'tarefa' then
    raise exception 'concluir_ocorrencia_agenda: so tarefas podem ser concluidas (item % e evento).', p_agenda_item_id;
  end if;

  if v_item.tipo_recorrencia = 'nenhuma' then
    raise exception 'concluir_ocorrencia_agenda: item % nao e uma serie recorrente -- conclua diretamente em agenda_itens (UPDATE de concluido_em).', p_agenda_item_id;
  end if;

  if not public.agenda_ocorrencia_e_valida(
    v_item.tipo_recorrencia, v_item.data_inicio, v_item.recorrencia_intervalo,
    v_item.recorrencia_dias_semana, v_item.recorrencia_data_fim, p_data_ocorrencia
  ) then
    raise exception 'concluir_ocorrencia_agenda: % nao e uma ocorrencia valida da serie % pela regra de recorrencia atual.', p_data_ocorrencia, p_agenda_item_id;
  end if;

  -- CORREÇÃO OBRIGATÓRIA desta revisão: captura o estado ANTES do
  -- UPSERT, para só logar em logs_auditoria quando isto for uma
  -- transição REAL false->true -- concluir uma ocorrência já concluída
  -- continua sendo um UPSERT idempotente (mesmo comportamento de
  -- sempre, sem exceção, sem mudança de semântica), só não gera um log
  -- falso de "concluiu de novo". Se não houver linha ainda, o SELECT não
  -- encontra nada e v_ja_concluida permanece NULL -- coalesce trata como
  -- false (nunca esteve concluída).
  select concluida into v_ja_concluida
  from public.agenda_ocorrencias
  where agenda_item_id = p_agenda_item_id and data_ocorrencia = p_data_ocorrencia;
  v_ja_concluida := coalesce(v_ja_concluida, false);

  -- UPSERT só toca `concluida` (+ bookkeeping) -- qualquer override/
  -- cancelamento/motivo já existente na linha permanece intocado. A
  -- trigger agenda_ocorrencias_protecao preenche concluido_em/
  -- concluido_por (nunca esta função diretamente).
  insert into public.agenda_ocorrencias (agenda_item_id, data_ocorrencia, concluida)
  values (p_agenda_item_id, p_data_ocorrencia, true)
  on conflict (agenda_item_id, data_ocorrencia)
  do update set concluida = true, atualizado_em = now()
  returning * into v_ocorrencia;

  if not v_ja_concluida then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values (
      'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
      'concluiu', 'concluida', 'false', 'true'
    );
  end if;

  return v_ocorrencia;
end;
$$;

comment on function public.concluir_ocorrencia_agenda(uuid, date) is
  'Conclui UMA ocorrência de uma tarefa recorrente, via UPSERT que só toca a flag concluida -- preserva qualquer override/cancelamento/motivo já gravado na linha. concluido_em/concluido_por são preenchidos pela trigger agenda_ocorrencias_protecao (nunca pelo cliente). Valida p_data_ocorrencia contra a regra atual da série (agenda_ocorrencia_e_valida) antes de gravar. Registra em logs_auditoria (entidade=agenda_ocorrencia, acao=concluiu, campo=concluida) SOMENTE quando a ocorrência não estava concluída antes desta chamada -- idempotência preservada, nunca um log falso para um no-op. SECURITY DEFINER (checagem explícita de agenda.editar dentro da função) -- necessário só para poder chamar o helper interno agenda_ocorrencia_e_valida, que não tem EXECUTE para authenticated.';

revoke execute on function public.concluir_ocorrencia_agenda(uuid, date) from public;
revoke execute on function public.concluir_ocorrencia_agenda(uuid, date) from anon;
revoke execute on function public.concluir_ocorrencia_agenda(uuid, date) from service_role;
grant execute on function public.concluir_ocorrencia_agenda(uuid, date) to authenticated;


-- 7.2 reabrir_ocorrencia_agenda -- limpa conclusão; remove a linha se
-- ela ficar semanticamente vazia (nunca deixa exceção inerte).
create or replace function public.reabrir_ocorrencia_agenda(
  p_agenda_item_id uuid,
  p_data_ocorrencia date
)
returns public.agenda_ocorrencias
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ocorrencia public.agenda_ocorrencias;
begin
  select * into v_ocorrencia
  from public.agenda_ocorrencias
  where agenda_item_id = p_agenda_item_id and data_ocorrencia = p_data_ocorrencia;

  if v_ocorrencia.id is null then
    raise exception 'reabrir_ocorrencia_agenda: nao ha ocorrencia concluida para % em %.', p_agenda_item_id, p_data_ocorrencia;
  end if;

  if not v_ocorrencia.concluida then
    raise exception 'reabrir_ocorrencia_agenda: esta ocorrencia nao esta concluida.';
  end if;

  -- Decide ANTES de tocar a linha: se, tirando a conclusão, nada mais
  -- restar (sem override/cancelamento), um UPDATE para concluida=false
  -- seria rejeitado pela própria constraint agenda_ocorrencias_nao_vazia
  -- -- por isso a limpeza é DELETE direto, nunca "UPDATE e depois
  -- decide apagar".
  -- CORREÇÃO OBRIGATÓRIA desta revisão: log em logs_auditoria nos DOIS
  -- caminhos de saída -- ambos representam, sempre, uma transição REAL
  -- true->false (a função já rejeitou acima qualquer chamada onde a
  -- ocorrência não estava concluída, então não existe caminho de "no-op"
  -- aqui a proteger contra log falso, ao contrário de concluir_
  -- ocorrencia_agenda, que é um UPSERT sem esse guard prévio).
  if not v_ocorrencia.cancelada
     and v_ocorrencia.titulo_override is null
     and v_ocorrencia.descricao_override is null
     and v_ocorrencia.data_override is null
     and v_ocorrencia.hora_inicio_override is null
     and v_ocorrencia.hora_fim_override is null
  then
    delete from public.agenda_ocorrencias where id = v_ocorrencia.id;

    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values (
      'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
      'reabriu', 'concluida', 'true', 'false'
    );

    return null;
  end if;

  update public.agenda_ocorrencias
  set concluida = false, atualizado_em = now()
  where id = v_ocorrencia.id
  returning * into v_ocorrencia;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
    'reabriu', 'concluida', 'true', 'false'
  );

  return v_ocorrencia;
end;
$$;

comment on function public.reabrir_ocorrencia_agenda(uuid, date) is
  'Reabre (desfaz a conclusão de) uma ocorrência de tarefa recorrente, preservando qualquer override/cancelamento/motivo existente. Se, depois de limpar a conclusão, a linha não carregar mais nenhum desvio relevante, é REMOVIDA (DELETE) em vez de deixada vazia -- decidido antes do UPDATE, para nunca colidir com agenda_ocorrencias_nao_vazia. Registra em logs_auditoria (entidade=agenda_ocorrencia, acao=reabriu, campo=concluida) nos dois caminhos de saída -- a função só chega lá depois de confirmar que a ocorrência estava mesmo concluída, então toda chamada bem-sucedida é uma transição real. SECURITY INVOKER -- não chama nenhum helper interno bloqueado, a RLS de agenda_ocorrencias (agenda.editar) já é a garantia real.';

revoke execute on function public.reabrir_ocorrencia_agenda(uuid, date) from public;
revoke execute on function public.reabrir_ocorrencia_agenda(uuid, date) from anon;
revoke execute on function public.reabrir_ocorrencia_agenda(uuid, date) from service_role;
grant execute on function public.reabrir_ocorrencia_agenda(uuid, date) to authenticated;


-- 7.3 cancelar_ocorrencia_agenda -- rejeita se já concluída (decisão 2:
-- nunca desfaz conclusão silenciosamente).
create or replace function public.cancelar_ocorrencia_agenda(
  p_agenda_item_id uuid,
  p_data_ocorrencia date,
  p_motivo text
)
returns public.agenda_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item          public.agenda_itens;
  v_existente     public.agenda_ocorrencias;
  v_ocorrencia    public.agenda_ocorrencias;
  v_ja_cancelada  boolean;
  v_motivo_antigo text;
  v_registro_id   text;
begin
  -- SECURITY DEFINER pelo mesmo motivo de concluir_ocorrencia_agenda:
  -- precisa chamar agenda_ocorrencia_e_valida (helper interno, sem
  -- EXECUTE para authenticated) -- checagem de permissão replicada aqui.
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'cancelar_ocorrencia_agenda: requer a permissao agenda.editar.';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'cancelar_ocorrencia_agenda: motivo e obrigatorio.';
  end if;

  select * into v_item from public.agenda_itens where id = p_agenda_item_id;
  if v_item.id is null then
    raise exception 'cancelar_ocorrencia_agenda: item % nao encontrado.', p_agenda_item_id;
  end if;

  if v_item.tipo_recorrencia = 'nenhuma' then
    raise exception 'cancelar_ocorrencia_agenda: item % nao e uma serie recorrente.', p_agenda_item_id;
  end if;

  if not public.agenda_ocorrencia_e_valida(
    v_item.tipo_recorrencia, v_item.data_inicio, v_item.recorrencia_intervalo,
    v_item.recorrencia_dias_semana, v_item.recorrencia_data_fim, p_data_ocorrencia
  ) then
    raise exception 'cancelar_ocorrencia_agenda: % nao e uma ocorrencia valida da serie %.', p_data_ocorrencia, p_agenda_item_id;
  end if;

  select * into v_existente
  from public.agenda_ocorrencias
  where agenda_item_id = p_agenda_item_id and data_ocorrencia = p_data_ocorrencia;

  if v_existente.id is not null and v_existente.concluida then
    raise exception 'cancelar_ocorrencia_agenda: esta ocorrencia ja esta concluida -- reabra antes de cancelar (nunca desfeito automaticamente).';
  end if;

  -- CORREÇÃO OBRIGATÓRIA desta revisão: captura o estado ANTES do UPSERT
  -- (v_existente já foi lido acima, para a checagem de concluida --
  -- reaproveitado aqui, sem segunda consulta). Se a linha ainda não
  -- existir, v_existente.cancelada/motivo ficam NULL -- coalesce trata
  -- cancelada como false; motivo permanece NULL (comparação correta
  -- contra p_motivo, que aqui já é garantido NOT NULL pela checagem
  -- anterior).
  v_ja_cancelada := coalesce(v_existente.cancelada, false);
  v_motivo_antigo := v_existente.motivo;
  v_registro_id := p_agenda_item_id::text || '|' || p_data_ocorrencia::text;

  insert into public.agenda_ocorrencias (agenda_item_id, data_ocorrencia, cancelada, motivo)
  values (p_agenda_item_id, p_data_ocorrencia, true, p_motivo)
  on conflict (agenda_item_id, data_ocorrencia)
  do update set cancelada = true, motivo = p_motivo, atualizado_em = now()
  returning * into v_ocorrencia;

  -- (A) cancelada: só loga na transição REAL false->true -- recancelar
  -- uma ocorrência já cancelada (semântica da RPC continua permitindo,
  -- sem virar erro) nunca gera este log de novo.
  if not v_ja_cancelada then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'cancelou', 'cancelada', 'false', 'true');
  end if;

  -- (B) motivo: OLD x NEW null-safe -- só loga se o motivo realmente
  -- mudou. (C) mesmo motivo repetido: nenhum log aqui. (D) motivo
  -- diferente: só este log, sem repetir o de 'cancelada' acima.
  if v_motivo_antigo is distinct from p_motivo then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'cancelou', 'motivo', v_motivo_antigo, p_motivo);
  end if;

  return v_ocorrencia;
end;
$$;

comment on function public.cancelar_ocorrencia_agenda(uuid, date, text) is
  'Cancela UMA ocorrência (evento ou tarefa) via UPSERT, preservando overrides já existentes. Rejeita se a ocorrência já estiver concluida (decisão explícita: nunca desfazer conclusão automaticamente -- reabra antes). Motivo obrigatório. RPC continua permitindo recancelar uma ocorrência já cancelada (nunca vira erro por isso) -- a auditoria em logs_auditoria é que ficou precisa: campo=cancelada só loga na transição real false->true; campo=motivo só loga quando o motivo (IS DISTINCT FROM, null-safe) realmente muda -- recancelar com o mesmo motivo não gera nenhum log, recancelar com motivo diferente gera só o log do motivo. SECURITY DEFINER (checagem explícita de agenda.editar) -- necessário só para chamar o helper interno agenda_ocorrencia_e_valida.';

revoke execute on function public.cancelar_ocorrencia_agenda(uuid, date, text) from public;
revoke execute on function public.cancelar_ocorrencia_agenda(uuid, date, text) from anon;
revoke execute on function public.cancelar_ocorrencia_agenda(uuid, date, text) from service_role;
grant execute on function public.cancelar_ocorrencia_agenda(uuid, date, text) to authenticated;


-- 7.4 alterar_ocorrencia_agenda -- overrides pontuais; detecta conflito
-- de data_override contra outra ocorrência normal da MESMA série.
create or replace function public.alterar_ocorrencia_agenda(
  p_agenda_item_id uuid,
  p_data_ocorrencia date,
  p_titulo_override text,
  p_descricao_override text,
  p_data_override date,
  p_hora_inicio_override time,
  p_hora_fim_override time
)
returns public.agenda_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item        public.agenda_itens;
  v_ocorrencia  public.agenda_ocorrencias;
  v_antes       public.agenda_ocorrencias;
  v_registro_id text;
begin
  -- SECURITY DEFINER pelo mesmo motivo das demais RPCs de ocorrência:
  -- precisa chamar agenda_ocorrencia_e_valida (helper interno, sem
  -- EXECUTE para authenticated).
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'alterar_ocorrencia_agenda: requer a permissao agenda.editar.';
  end if;

  select * into v_item from public.agenda_itens where id = p_agenda_item_id;
  if v_item.id is null then
    raise exception 'alterar_ocorrencia_agenda: item % nao encontrado.', p_agenda_item_id;
  end if;

  if v_item.tipo_recorrencia = 'nenhuma' then
    raise exception 'alterar_ocorrencia_agenda: item % nao e uma serie recorrente -- edite diretamente em agenda_itens.', p_agenda_item_id;
  end if;

  if not public.agenda_ocorrencia_e_valida(
    v_item.tipo_recorrencia, v_item.data_inicio, v_item.recorrencia_intervalo,
    v_item.recorrencia_dias_semana, v_item.recorrencia_data_fim, p_data_ocorrencia
  ) then
    raise exception 'alterar_ocorrencia_agenda: % nao e uma ocorrencia valida da serie %.', p_data_ocorrencia, p_agenda_item_id;
  end if;

  -- Conflito (decisão 16 + correção desta revisão): se p_data_override
  -- apontar para uma data ocupada, rejeita -- nunca duas instâncias da
  -- mesma série no mesmo dia. Cobre os DOIS casos, nunca comparando a
  -- linha contra si mesma (data_ocorrencia <> p_data_ocorrencia exclui a
  -- própria linha, que por UNIQUE(agenda_item_id,data_ocorrencia) é a
  -- única com esse data_ocorrencia):
  --   a) já é uma ocorrência NORMAL da regra atual da série;
  --   b) já é a data de exibição (coalesce(data_override,data_ocorrencia))
  --      de OUTRA exceção desta mesma série.
  if p_data_override is not null and p_data_override <> p_data_ocorrencia then
    if public.agenda_ocorrencia_e_valida(
      v_item.tipo_recorrencia, v_item.data_inicio, v_item.recorrencia_intervalo,
      v_item.recorrencia_dias_semana, v_item.recorrencia_data_fim, p_data_override
    ) then
      raise exception 'alterar_ocorrencia_agenda: % ja e uma ocorrencia normal desta serie -- mover para essa data criaria duas instancias no mesmo dia. Escolha outra data.', p_data_override;
    end if;

    if exists (
      select 1 from public.agenda_ocorrencias
      where agenda_item_id = p_agenda_item_id
        and data_ocorrencia <> p_data_ocorrencia
        and coalesce(data_override, data_ocorrencia) = p_data_override
    ) then
      raise exception 'alterar_ocorrencia_agenda: % ja e a data de exibicao de outra excecao desta mesma serie -- escolha outra data.', p_data_override;
    end if;
  end if;

  -- CORREÇÃO OBRIGATÓRIA desta revisão: captura o estado ANTES do
  -- UPSERT para auditar OLD x NEW campo a campo, null-safe (IS DISTINCT
  -- FROM). Se a linha ainda não existir, o SELECT não encontra nada e
  -- v_antes fica com todos os campos NULL -- IS DISTINCT FROM contra o
  -- valor novo detecta corretamente "mudou de NULL para algo" quando
  -- aplicável, e "não mudou" quando o parâmetro também vier NULL (nunca
  -- log falso pra quem nem informou aquele override).
  select * into v_antes
  from public.agenda_ocorrencias
  where agenda_item_id = p_agenda_item_id and data_ocorrencia = p_data_ocorrencia;

  v_registro_id := p_agenda_item_id::text || '|' || p_data_ocorrencia::text;

  insert into public.agenda_ocorrencias (
    agenda_item_id, data_ocorrencia,
    titulo_override, descricao_override, data_override, hora_inicio_override, hora_fim_override
  )
  values (
    p_agenda_item_id, p_data_ocorrencia,
    p_titulo_override, p_descricao_override, p_data_override, p_hora_inicio_override, p_hora_fim_override
  )
  on conflict (agenda_item_id, data_ocorrencia)
  do update set
    titulo_override = p_titulo_override,
    descricao_override = p_descricao_override,
    data_override = p_data_override,
    hora_inicio_override = p_hora_inicio_override,
    hora_fim_override = p_hora_fim_override,
    atualizado_em = now()
  returning * into v_ocorrencia;

  -- Um registro de logs_auditoria por CAMPO que de fato mudou (mesmo
  -- padrão já usado em editar_producao_registro/editar_serie_agenda_
  -- esta_e_proximas: nunca "1 log genérico por chamada") -- só os 5
  -- campos que esta RPC realmente pode alterar (cancelada/concluida/
  -- motivo nunca são tocados aqui, preservados intactos, e por isso
  -- nunca entram nesta auditoria). Nenhum campo entra no log se não
  -- mudou -- uma chamada que reenvia exatamente os mesmos valores não
  -- gera nenhuma linha em logs_auditoria.
  if v_antes.titulo_override is distinct from v_ocorrencia.titulo_override then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'alterou', 'titulo_override', v_antes.titulo_override, v_ocorrencia.titulo_override);
  end if;

  if v_antes.descricao_override is distinct from v_ocorrencia.descricao_override then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'alterou', 'descricao_override', v_antes.descricao_override, v_ocorrencia.descricao_override);
  end if;

  if v_antes.data_override is distinct from v_ocorrencia.data_override then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'alterou', 'data_override', v_antes.data_override::text, v_ocorrencia.data_override::text);
  end if;

  if v_antes.hora_inicio_override is distinct from v_ocorrencia.hora_inicio_override then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'alterou', 'hora_inicio_override', v_antes.hora_inicio_override::text, v_ocorrencia.hora_inicio_override::text);
  end if;

  if v_antes.hora_fim_override is distinct from v_ocorrencia.hora_fim_override then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_ocorrencia', v_registro_id, 'alterou', 'hora_fim_override', v_antes.hora_fim_override::text, v_ocorrencia.hora_fim_override::text);
  end if;

  return v_ocorrencia;
end;
$$;

comment on function public.alterar_ocorrencia_agenda(uuid, date, text, text, date, time, time) is
  'Sobrepõe título/descrição/data/hora de UMA ocorrência via UPSERT, preservando cancelada/concluida/motivo já existentes (não são tocados). Rejeita se p_data_override coincidir com outra ocorrência normal da mesma série OU com a data de exibição de outra exceção já existente da mesma série (evita duas instâncias no mesmo dia nos dois sentidos). data_ocorrencia (identidade) nunca muda -- só data_override (exibição). Horários efetivos (considerando fallback para o item pai) são validados pela trigger agenda_ocorrencias_protecao, não só por CHECK isolado. Registra em logs_auditoria (entidade=agenda_ocorrencia, acao=alterou) 1 linha por campo que de fato mudou (titulo_override/descricao_override/data_override/hora_inicio_override/hora_fim_override -- os únicos 5 campos que esta função altera), comparando OLD x NEW com IS DISTINCT FROM (null-safe) -- nenhum log para campo que não mudou, nenhuma linha se nada mudou. SECURITY DEFINER (checagem explícita de agenda.editar) -- necessário só para chamar o helper interno agenda_ocorrencia_e_valida.';

revoke execute on function public.alterar_ocorrencia_agenda(uuid, date, text, text, date, time, time) from public;
revoke execute on function public.alterar_ocorrencia_agenda(uuid, date, text, text, date, time, time) from anon;
revoke execute on function public.alterar_ocorrencia_agenda(uuid, date, text, text, date, time, time) from service_role;
grant execute on function public.alterar_ocorrencia_agenda(uuid, date, text, text, date, time, time) to authenticated;


-- 7.5 editar_serie_agenda_esta_e_proximas -- split de série.
create or replace function public.editar_serie_agenda_esta_e_proximas(
  p_agenda_item_id uuid,
  p_data_corte date,
  p_titulo text,
  p_descricao text,
  p_categoria text,
  p_hora_inicio time,
  p_hora_fim time,
  p_dia_inteiro boolean,
  p_tipo_recorrencia text,
  p_recorrencia_intervalo integer,
  p_recorrencia_dias_semana integer[],
  p_recorrencia_data_fim date
)
returns public.agenda_itens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serie_antiga public.agenda_itens;
  v_serie_nova   public.agenda_itens;
begin
  -- SECURITY DEFINER (mudança desta revisão), por DOIS motivos:
  --   1) precisa chamar agenda_ocorrencia_e_valida (helper interno, sem
  --      EXECUTE para authenticated);
  --   2) o passo 3 (realocação de exceções) precisa mudar
  --      agenda_ocorrencias.agenda_item_id, que agenda_ocorrencias_protecao
  --      bloqueia por padrão (identidade imutável) -- só é permitido
  --      dentro desta função via o sinalizador de sessão abaixo.
  -- Checagem única de agenda.editar substitui a antiga exigência de
  -- agenda.editar + agenda.inserir sob RLS (SECURITY INVOKER) -- mais
  -- simples e resolve o acoplamento que a versão anterior tinha.
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'editar_serie_agenda_esta_e_proximas: requer a permissao agenda.editar.';
  end if;

  select * into v_serie_antiga from public.agenda_itens where id = p_agenda_item_id;
  if v_serie_antiga.id is null then
    raise exception 'editar_serie_agenda_esta_e_proximas: item % nao encontrado.', p_agenda_item_id;
  end if;

  if v_serie_antiga.tipo_recorrencia = 'nenhuma' then
    raise exception 'editar_serie_agenda_esta_e_proximas: item % nao e uma serie recorrente.', p_agenda_item_id;
  end if;

  -- p_data_corte TEM que ser uma ocorrência real da série ATUAL -- a
  -- identidade da instância que o usuário clicou. Isso é exatamente o
  -- que evita gerar ocorrência fantasma: a nova série nasce com
  -- data_inicio = p_data_corte, que já é, por construção, um dia válido
  -- da regra (mesma fase/dia-da-semana), então preservar
  -- recorrencia_dias_semana/intervalo tal qual não desloca nada.
  if not public.agenda_ocorrencia_e_valida(
    v_serie_antiga.tipo_recorrencia, v_serie_antiga.data_inicio, v_serie_antiga.recorrencia_intervalo,
    v_serie_antiga.recorrencia_dias_semana, v_serie_antiga.recorrencia_data_fim, p_data_corte
  ) then
    raise exception 'editar_serie_agenda_esta_e_proximas: % nao e uma ocorrencia valida da serie % pela regra atual -- nao e permitido usar uma data arbitraria como corte.', p_data_corte, p_agenda_item_id;
  end if;

  -- CORREÇÃO OBRIGATÓRIA desta revisão: se a NOVA regra (p_tipo_recorrencia/
  -- p_recorrencia_intervalo/p_recorrencia_dias_semana/p_recorrencia_data_fim,
  -- com p_data_corte como novo data_inicio) tornaria alguma exceção já
  -- existente (>= p_data_corte) INVÁLIDA, aborta aqui mesmo, com mensagem
  -- clara, ANTES de qualquer escrita -- nunca descarta a exceção
  -- silenciosamente, nunca a deixa órfã. Isto é só a mensagem amigável;
  -- a garantia estrutural real vem da trigger agenda_ocorrencias_protecao,
  -- que rejeitaria de qualquer forma a realocação do passo 2 abaixo (com
  -- uma mensagem mais genérica) mesmo que esta checagem não existisse.
  if exists (
    select 1 from public.agenda_ocorrencias
    where agenda_item_id = p_agenda_item_id
      and data_ocorrencia >= p_data_corte
      and not public.agenda_ocorrencia_e_valida(
        p_tipo_recorrencia, p_data_corte, p_recorrencia_intervalo,
        p_recorrencia_dias_semana, p_recorrencia_data_fim, data_ocorrencia
      )
  ) then
    raise exception 'editar_serie_agenda_esta_e_proximas: ha excecao(oes) a partir de % que nao seriam validas na nova regra da serie -- ajuste a nova regra ou trate essas excecoes antes de dividir a serie. Nenhuma excecao existente pode ficar orfa.', p_data_corte;
  end if;

  -- CORREÇÃO OBRIGATÓRIA (mesma classe de gap do item 1, aplicada ao
  -- split): a NOVA série já nasce com p_hora_inicio/p_hora_fim/
  -- p_dia_inteiro -- se algum horário EFETIVO de uma exceção realocada
  -- ficasse incoerente sob esses novos valores, aborta aqui com mensagem
  -- clara, ANTES de qualquer escrita. Mesma garantia estrutural de
  -- backstop: mesmo sem este bloco, agenda_ocorrencias_protecao rejeitaria
  -- a realocação do passo 2 (ela lê os horários da série NOVA, pois
  -- new.agenda_item_id já é v_serie_nova.id naquele ponto) -- ver item C
  -- do retorno desta revisão.
  if p_dia_inteiro then
    if exists (
      select 1 from public.agenda_ocorrencias
      where agenda_item_id = p_agenda_item_id
        and data_ocorrencia >= p_data_corte
        and (hora_inicio_override is not null or hora_fim_override is not null)
    ) then
      raise exception 'editar_serie_agenda_esta_e_proximas: ha excecao(oes) com hora sobreposta que ficariam incoerentes com a nova serie marcada como dia inteiro -- ajuste isso antes de dividir a serie.';
    end if;
  else
    if exists (
      select 1 from public.agenda_ocorrencias
      where agenda_item_id = p_agenda_item_id
        and data_ocorrencia >= p_data_corte
        and coalesce(hora_inicio_override, p_hora_inicio) is not null
        and coalesce(hora_fim_override, p_hora_fim) is not null
        and coalesce(hora_fim_override, p_hora_fim) < coalesce(hora_inicio_override, p_hora_inicio)
    ) then
      raise exception 'editar_serie_agenda_esta_e_proximas: ha excecao(oes) cujo horario efetivo ficaria invalido (fim antes do inicio) sob o novo horario da serie -- ajuste isso antes de dividir a serie.';
    end if;
  end if;

  -- ORDEM IMPORTA (correção obrigatória desta revisão): cria a nova
  -- série e realoca as exceções ANTES de encurtar recorrencia_data_fim
  -- da série antiga. Se a ordem fosse a "intuitiva" (encurtar primeiro),
  -- a guarda de agenda_itens_protecao veria, nesse instante, exceções
  -- com data_ocorrencia >= p_data_corte AINDA pertencendo à série antiga
  -- (a realocação só aconteceria depois) e rejeitaria o próprio UPDATE
  -- do split como se fosse uma tentativa de orfanizar exceção -- por
  -- isso a nova série é criada e as exceções realocadas PRIMEIRO; só
  -- então a série antiga é encurtada, já sem nenhuma exceção >= corte
  -- restante para a guarda reclamar.

  -- 1) cria a nova série começando EXATAMENTE em p_data_corte.
  insert into public.agenda_itens (
    tipo, titulo, descricao, categoria,
    data_inicio, hora_inicio, hora_fim, dia_inteiro,
    tipo_recorrencia, recorrencia_intervalo, recorrencia_dias_semana, recorrencia_data_fim,
    criado_por
  ) values (
    v_serie_antiga.tipo, p_titulo, p_descricao, p_categoria,
    p_data_corte, p_hora_inicio, p_hora_fim, p_dia_inteiro,
    p_tipo_recorrencia, p_recorrencia_intervalo, p_recorrencia_dias_semana, p_recorrencia_data_fim,
    auth.uid()
  )
  returning * into v_serie_nova;

  -- 2) realoca exceções futuras (>= corte) para a nova série.
  -- agenda_ocorrencias_protecao bloqueia por padrão qualquer mudança de
  -- agenda_item_id (identidade imutável) -- este é o ÚNICO fluxo
  -- legítimo que precisa mudar isso, então sinalizamos via GUC de
  -- sessão, LOCAL à transação (true no 3º argumento de set_config: some
  -- sozinho no fim desta chamada de função, nunca vaza para outra
  -- statement/conexão reaproveitada por connection pooling).
  perform set_config('agenda.permitir_realocacao_ocorrencia', 'on', true);

  update public.agenda_ocorrencias
  set agenda_item_id = v_serie_nova.id,
      atualizado_em = now()
  where agenda_item_id = p_agenda_item_id
    and data_ocorrencia >= p_data_corte;

  -- 3) só agora fecha a série antiga na véspera do corte -- nenhuma
  -- exceção >= p_data_corte pertence mais a ela neste ponto, então a
  -- guarda de agenda_itens_protecao (nunca orfanizar exceção existente)
  -- passa naturalmente.
  update public.agenda_itens
  set recorrencia_data_fim = p_data_corte - 1,
      atualizado_em = now()
  where id = p_agenda_item_id
  returning * into v_serie_antiga;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('agenda_item', p_agenda_item_id::text, 'dividiu_serie', 'recorrencia_data_fim', null, (p_data_corte - 1)::text),
    ('agenda_item', v_serie_nova.id::text, 'dividiu_serie', 'serie_origem', p_agenda_item_id::text, null);

  return v_serie_nova;
end;
$$;

comment on function public.editar_serie_agenda_esta_e_proximas(uuid, date, text, text, text, time, time, boolean, text, integer, integer[], date) is
  'Split de série ("esta e as próximas"): cria uma nova série a partir de p_data_corte com os novos valores, realoca para ela as exceções (agenda_ocorrencias) com data_ocorrencia >= p_data_corte, e só então fecha a série antiga em recorrencia_data_fim = p_data_corte - 1 (nessa ordem -- ver comentário inline) -- tudo na mesma transação. p_data_corte é obrigatoriamente uma ocorrência real da série ATUAL (validado via agenda_ocorrencia_e_valida) -- nunca uma data arbitrária, o que evita ocorrência fantasma. ABORTA a transação inteira (com mensagem clara, e também via a trigger agenda_ocorrencias_protecao como garantia estrutural) se alguma exceção existente >= p_data_corte não for válida sob a NOVA regra de recorrência OU teria horário efetivo incoerente (fim antes do início, ou hora sobreposta com nova série dia inteiro) sob o novo p_hora_inicio/p_hora_fim/p_dia_inteiro -- nunca descarta silenciosamente, nunca deixa exceção órfã/incoerente. SECURITY DEFINER: checagem explícita e única de agenda.editar; DEFINER também é o que permite chamar agenda_ocorrencia_e_valida (helper interno) e sinalizar via GUC de sessão + contexto privilegiado (current_user<>session_user) a realocação de agenda_item_id (normalmente bloqueada pela trigger).';

revoke execute on function public.editar_serie_agenda_esta_e_proximas(uuid, date, text, text, text, time, time, boolean, text, integer, integer[], date) from public;
revoke execute on function public.editar_serie_agenda_esta_e_proximas(uuid, date, text, text, text, time, time, boolean, text, integer, integer[], date) from anon;
revoke execute on function public.editar_serie_agenda_esta_e_proximas(uuid, date, text, text, text, time, time, boolean, text, integer, integer[], date) from service_role;
grant execute on function public.editar_serie_agenda_esta_e_proximas(uuid, date, text, text, text, time, time, boolean, text, integer, integer[], date) to authenticated;


-- 7.6 excluir_serie_agenda -- exclui item avulso OU série inteira
-- (mesma função para os dois casos -- a diferença é só se existem
-- agenda_ocorrencias vinculadas, removidas via ON DELETE CASCADE).
create or replace function public.excluir_serie_agenda(
  p_agenda_item_id uuid,
  p_motivo text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.agenda_itens;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'excluir_serie_agenda: motivo e obrigatorio.';
  end if;

  select * into v_item from public.agenda_itens where id = p_agenda_item_id;
  if v_item.id is null then
    raise exception 'excluir_serie_agenda: item % nao encontrado.', p_agenda_item_id;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('agenda_item', p_agenda_item_id::text, 'excluiu', 'motivo', null, p_motivo),
    ('agenda_item', p_agenda_item_id::text, 'excluiu', 'tipo', v_item.tipo, null),
    ('agenda_item', p_agenda_item_id::text, 'excluiu', 'titulo', v_item.titulo, null),
    ('agenda_item', p_agenda_item_id::text, 'excluiu', 'data_inicio', v_item.data_inicio::text, null),
    ('agenda_item', p_agenda_item_id::text, 'excluiu', 'tipo_recorrencia', v_item.tipo_recorrencia, null);

  delete from public.agenda_itens where id = p_agenda_item_id;
  -- agenda_ocorrencias vinculadas removidas via ON DELETE CASCADE.
end;
$$;

comment on function public.excluir_serie_agenda(uuid, text) is
  'Exclui definitivamente um item de Agenda (avulso ou série -- mesma função para os dois casos). Snapshot em logs_auditoria antes do DELETE, mesma transação (mesmo padrão de excluir_producao_registro). agenda_ocorrencias vinculadas são removidas via ON DELETE CASCADE. Motivo obrigatório. SECURITY INVOKER -- não chama nenhum helper interno bloqueado; a policy agenda_itens_delete (agenda.excluir) é a garantia real.';

revoke execute on function public.excluir_serie_agenda(uuid, text) from public;
revoke execute on function public.excluir_serie_agenda(uuid, text) from anon;
revoke execute on function public.excluir_serie_agenda(uuid, text) from service_role;
grant execute on function public.excluir_serie_agenda(uuid, text) to authenticated;


-- ============================================================
-- 8. Permissões agenda.* -- catálogo + concessão por perfil
-- ============================================================
-- Mesmo padrão de 0001: só proprietario_admin recebe .excluir
-- (gestao/operacional nunca recebem .excluir de nenhum módulo
-- operacional, nem producao.excluir/fornecedores.excluir o recebem
-- hoje). Concluir/reabrir/cancelar/alterar ocorrência usam
-- agenda.editar (decisão aprovada) -- nenhum código novo para isso.

insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('agenda.visualizar', 'agenda', 'visualizar', 'Ver a Agenda (eventos e tarefas compartilhados da empresa).'),
  ('agenda.inserir',    'agenda', 'inserir',    'Criar novo evento ou tarefa na Agenda (avulso ou série recorrente).'),
  ('agenda.editar',     'agenda', 'editar',     'Editar evento/tarefa existente; concluir/reabrir/cancelar/alterar ocorrências de série recorrente.'),
  ('agenda.excluir',    'agenda', 'excluir',    'Excluir definitivamente um evento/tarefa (avulso ou série inteira) da Agenda.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'agenda.visualizar'),
  ('proprietario_admin', 'agenda.inserir'),
  ('proprietario_admin', 'agenda.editar'),
  ('proprietario_admin', 'agenda.excluir'),
  ('gestao', 'agenda.visualizar'),
  ('gestao', 'agenda.inserir'),
  ('gestao', 'agenda.editar'),
  ('operacional', 'agenda.visualizar'),
  ('operacional', 'agenda.inserir'),
  ('operacional', 'agenda.editar'),
  ('financeiro_administrativo', 'agenda.visualizar'),
  ('financeiro_administrativo', 'agenda.inserir'),
  ('financeiro_administrativo', 'agenda.editar')
on conflict do nothing;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto a Agenda ainda não foi usada de verdade (nenhuma linha
-- real de negócio depende disso além do que esta própria migration
-- semeou em agenda_categorias). Depois de uso real, reverter apaga
-- permanentemente qualquer evento/tarefa já cadastrado.
-- BEGIN;
--
--   delete from public.perfil_permissoes where permissao like 'agenda.%';
--   delete from public.permissoes where codigo like 'agenda.%';
--
--   drop function if exists public.excluir_serie_agenda(uuid, text);
--   drop function if exists public.editar_serie_agenda_esta_e_proximas(uuid, date, text, text, text, time, time, boolean, text, integer, integer[], date);
--   drop function if exists public.alterar_ocorrencia_agenda(uuid, date, text, text, date, time, time);
--   drop function if exists public.cancelar_ocorrencia_agenda(uuid, date, text);
--   drop function if exists public.reabrir_ocorrencia_agenda(uuid, date);
--   drop function if exists public.concluir_ocorrencia_agenda(uuid, date);
--
--   drop function if exists public.agenda_ocorrencia_e_valida(text, date, integer, integer[], date, date);
--
--   drop trigger if exists agenda_ocorrencias_protecao_trigger on public.agenda_ocorrencias;
--   drop function if exists public.agenda_ocorrencias_protecao();
--   drop trigger if exists agenda_itens_protecao_trigger on public.agenda_itens;
--   drop function if exists public.agenda_itens_protecao();
--
--   drop table if exists public.agenda_ocorrencias;
--   drop table if exists public.agenda_itens;
--
--   drop function if exists public.agenda_array_sem_duplicatas(integer[]);
--
--   drop table if exists public.agenda_categorias;
--
-- COMMIT;
