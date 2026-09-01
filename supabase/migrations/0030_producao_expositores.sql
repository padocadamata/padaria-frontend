-- 0030_producao_expositores.sql
-- Controle de Expositores integrado aos lancamentos de Producao. Um
-- lancamento de producao_registros pode gerar VARIOS lotes de expositor
-- (producao_expositor_lotes), cada um com data_entrada e snapshot de
-- prazo/data prevista PROPRIOS, quantidade enviada SEPARADA da
-- quantidade produzida, e conclusao (retirada) tambem separada, gerando
-- venda_estimada = enviada - retirada por lote, sempre DERIVADA.
--
-- REVISADA (3a rodada) apos o usuario RODAR de fato
-- 0030_pre_auditoria_expositores_EXECUTAR.sql no Supabase e colar os
-- resultados reais. Confirmado ao vivo: producao_registros tem 16
-- colunas (140 registros: 139 fechados, 1 aberto, 0 reaberto, 0 com
-- houve_falta=true), COM houve_falta (0031, commit 70c58e4, ja em
-- main); receitas NAO tem controlar_expositor/prazo_expositor_dias
-- ainda; producao_registros_protecao() e excluir_producao_registro()
-- foram confirmadas ao vivo -- a primeira identica ao texto pos-0019/
-- 0031 (nao trata houve_falta como campo protegido), a segunda ja
-- inclui houve_falta no snapshot de exclusao; zero FKs de outra tabela
-- de negocio para producao_registros.id; timezone da SESSAO do banco =
-- UTC (current_date = 2026-09-01 no momento da consulta).
--
-- DECISAO MANTIDA da 2a rodada: esta migration NAO REDEFINE
-- producao_registros_protecao() NEM excluir_producao_registro() --
-- NENHUMA DAS DUAS. Ambas ficam byte-a-byte como estao hoje (pos-0031),
-- sem nenhum CREATE OR REPLACE. excluir_producao_registro continua
-- bloqueando exclusao de um lancamento com lote vinculado SOMENTE via
-- FK RESTRICT (erro cru do Postgres, sem mensagem amigavel) -- aceito
-- explicitamente pelo usuario nesta rodada.
--
-- MUDANCA desta 3a rodada: o risco residual que a 2a rodada aceitava
-- ("reduzir quantidade_produzida abaixo do ja enviado ao expositor
-- deixa de ser bloqueado pelo banco") FOI REJEITADO pelo usuario e
-- FECHADO por uma SEGUNDA trigger, nova e isolada, exclusiva desta
-- migration: public.producao_registros_expositor_integridade() (secao
-- 5 abaixo) -- NAO uma alteracao de producao_registros_protecao, uma
-- funcao/trigger A MAIS sobre a mesma tabela, com responsabilidade
-- unica (so quantidade_produzida vs. soma de lotes), sem tocar em NEW,
-- sem tratar status/sobra/venda/receita/turno/data/custo/houve_falta,
-- SECURITY DEFINER (necessario para nao depender da RLS/permissao do
-- chamador em producao_expositor_lotes -- ver justificativa completa na
-- secao 5). Com isso, a invariante SUM(quantidade_enviada) <=
-- quantidade_produzida fica protegida pelo banco NOS DOIS SENTIDOS:
-- lado do LOTE (secoes 3/7/9, nao deixa a soma ultrapassar a producao)
-- e lado da PRODUCAO (secao 5, nao deixa a producao cair abaixo da
-- soma).
--
-- NAO toca em lib/producao/sugestaoProducao.js, pages/producao/
-- historico.js, pages/producao/planejamento.js,
-- components/producao/MarcadorFalta.js nem em qualquer logica do
-- marcador de falta -- este arquivo e 100% SQL, e agora nem mesmo a
-- parte SQL toca em qualquer objeto que mencione houve_falta.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita.
--
-- Pre-requisitos: 0001..0029 e 0031 ja aplicadas (0030 NUNCA foi
-- aplicada -- so existe como arquivo solto ate agora). public.receitas,
-- public.producao_registros (COM houve_falta, intocada por esta
-- migration), public.has_permissao()/is_admin() (0003/0016),
-- public.logs_auditoria (0004).
--
-- ============================================================
-- MUDANCAS DESTA RODADA (3a) FRENTE A RODADA ANTERIOR (2a) -- ver
-- relatorio da resposta para o raciocinio completo:
-- ============================================================
--   1) producao_registros_protecao() e excluir_producao_registro()
--      CONTINUAM NAO REDEFINIDAS (mantido da 2a rodada) -- nenhum
--      CREATE OR REPLACE em nenhuma das duas. excluir_producao_registro
--      continua bloqueando exclusao com lote vinculado SOMENTE via FK
--      RESTRICT (erro cru, sem mensagem amigavel) -- aceito.
--   2) NOVO: public.producao_registros_expositor_integridade() -- 2a
--      trigger sobre producao_registros (a 1a e producao_registros_
--      protecao, intocada), BEFORE UPDATE OF quantidade_produzida,
--      responsabilidade unica: bloquear reducao de quantidade_produzida
--      abaixo da SOMA de quantidade_enviada de todos os lotes do
--      registro. Fecha o risco residual que a 2a rodada tinha aceitado
--      -- agora a invariante e protegida nos DOIS sentidos (secao 5).
--   3) Permissoes: as 4 producao_expositores.* concedidas a
--      proprietario_admin nesta propria migration (mantido).
--   4) data_entrada continua independente de producao_registros.data
--      (mantido) -- parametro obrigatorio de criar_lote_expositor.
--   5) Relacao 1:N continua (mantido) -- producao_registro_id NAO e
--      UNIQUE. Validacao de soma no lado do LOTE continua dentro das
--      RPCs/trigger de producao_expositor_lotes; validacao no lado da
--      PRODUCAO agora vive na nova trigger do item 2, nunca dentro de
--      producao_registros_protecao.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * public.receitas -- 2 colunas novas (controlar_expositor,
--     prazo_expositor_dias) + 1 CHECK de coerencia;
--   * public.producao_expositor_lotes -- nova tabela (1:N com
--     producao_registros) + trigger de protecao + indexes + RLS;
--   * public.producao_registros_expositor_integridade() -- NOVA funcao +
--     NOVA trigger (2a trigger sobre producao_registros, ADITIVA,
--     coexiste com producao_registros_protecao sem substitui-la);
--   * public.producao_expositor_detalhado -- nova view (security_invoker);
--   * 5 RPCs novas: criar_lote_expositor, editar_lote_expositor,
--     concluir_retirada_expositor, corrigir_lote_expositor_concluido,
--     excluir_lote_expositor;
--   * 4 codigos novos de permissao (producao_expositores.visualizar/
--     operar/editar/excluir), COM concessao a proprietario_admin.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * NENHUMA alteracao em public.producao_registros_protecao() nem em
--     public.excluir_producao_registro() -- nenhum CREATE OR REPLACE em
--     nenhuma das duas, nenhuma linha nova dentro delas. A NOVA trigger
--     desta migration (secao 5) e um objeto TOTALMENTE SEPARADO -- nao
--     e uma alteracao de nenhuma das duas funcoes existentes;
--   * nenhuma coluna nova em producao_registros (houve_falta ja existe,
--     nao e tocada; nenhuma outra coluna e adicionada);
--   * nenhuma alteracao em houve_falta, MarcadorFalta.js,
--     sugestaoProducao.js, historico.js (marcador de falta) nem
--     planejamento.js;
--   * nenhum CASCADE, nenhum SET NULL como estrategia de exclusao;
--   * nenhuma alteracao em planejamento_producao, receita_ingredientes,
--     produto_fornecedores, produtos_historico_compras, pedidos;
--   * nenhuma renomeacao de tabela/coluna existente;
--   * nenhuma alteracao de frontend;
--   * nenhum INSERT de dado real (nenhum produto marcado
--     controlar_expositor=true por esta migration).

BEGIN;

-- ============================================================
-- 1. public.receitas -- 2 colunas novas
-- ============================================================
alter table public.receitas
  add column if not exists controlar_expositor boolean not null default false;

alter table public.receitas
  add column if not exists prazo_expositor_dias integer;

do $$
begin
  alter table public.receitas
    add constraint receitas_prazo_expositor_coerente_check
    check (
      (controlar_expositor = false and prazo_expositor_dias is null)
      or (controlar_expositor = true and prazo_expositor_dias is not null and prazo_expositor_dias > 0)
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.receitas.controlar_expositor is
  'Se true, este produto participa do Controle de Expositores (0030): a tela Producao > Expositores passa a permitir criar lotes (producao_expositor_lotes) para lancamentos deste produto. Default false -- nenhum produto existente muda de comportamento so por esta coluna existir.';

comment on column public.receitas.prazo_expositor_dias is
  'Prazo em dias no expositor, usado para calcular a data prevista de retirada de um NOVO lote (data_entrada do lote + prazo_expositor_dias, no momento da criacao). Obrigatorio e > 0 quando controlar_expositor=true; sempre NULL quando false. Alterar este valor NAO recalcula lotes ja existentes -- cada lote grava seu proprio snapshot (producao_expositor_lotes.prazo_dias_snapshot).';


-- ============================================================
-- 2. public.producao_expositor_lotes -- nova tabela (1:N)
-- ============================================================
-- producao_registro_id e uma FK comum (NAO UNIQUE): um mesmo lancamento
-- pode originar varios lotes (ex.: producao=100, 1o envio=50 num dia,
-- 2o envio=30 depois -- 2 lotes, mesmo producao_registro_id). "Cada
-- lancamento e um lote independente" (requisito original) continua
-- garantido pela FK -- cada lote sempre aponta para o lancamento exato
-- que o originou, nunca agrupado so por produto -- so deixou de exigir
-- EXATAMENTE 1 lote por lancamento.
--
-- data_entrada e informada pelo operador na criacao (sugestao de
-- dataLocalHoje() e responsabilidade do FRONTEND, nao default de banco
-- -- nenhum DEFAULT current_date aqui, de proposito: current_date
-- reflete o timezone da sessao/banco, nao necessariamente America/
-- Sao_Paulo, ver Bloco 16 da pre-auditoria).
create table if not exists public.producao_expositor_lotes (
  id                      uuid primary key default gen_random_uuid(),

  producao_registro_id    uuid not null
    references public.producao_registros(id) on delete restrict,

  quantidade_enviada      integer not null,

  data_entrada            date not null,
  prazo_dias_snapshot     integer not null,
  data_prevista_retirada  date not null,

  quantidade_retirada     integer,
  concluido_em            timestamptz,
  concluido_por           uuid references auth.users(id) on delete set null,

  observacao              text,

  criado_por              uuid references auth.users(id) on delete set null,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),

  constraint producao_expositor_lotes_quantidade_enviada_positiva_check
    check (quantidade_enviada > 0),

  constraint producao_expositor_lotes_prazo_dias_positivo_check
    check (prazo_dias_snapshot > 0),

  constraint producao_expositor_lotes_data_prevista_coerente_check
    check (data_prevista_retirada = data_entrada + prazo_dias_snapshot),

  constraint producao_expositor_lotes_retirada_nao_negativa_check
    check (quantidade_retirada is null or quantidade_retirada >= 0),

  constraint producao_expositor_lotes_retirada_nao_excede_enviada_check
    check (quantidade_retirada is null or quantidade_retirada <= quantidade_enviada),

  constraint producao_expositor_lotes_conclusao_coerente_check
    check (
      (concluido_em is null and concluido_por is null and quantidade_retirada is null)
      or (concluido_em is not null and concluido_por is not null and quantidade_retirada is not null)
    )
);

comment on table public.producao_expositor_lotes is
  'Controle de Expositores (0030): N linhas possiveis por lancamento de producao_registros (producao_registro_id NAO e UNIQUE -- um lancamento pode gerar varios envios/lotes ao expositor em momentos diferentes). data_entrada e informada pelo operador na criacao (nao herdada de producao_registros.data). prazo_dias_snapshot/data_prevista_retirada sao gravados na criacao e IMUTAVEIS depois de concluido (antes da conclusao, editar_lote_expositor pode corrigir data_entrada, recalculando data_prevista_retirada a partir do MESMO prazo_dias_snapshot). A soma de quantidade_enviada de TODOS os lotes de um mesmo producao_registro_id nunca pode exceder producao_registros.quantidade_produzida (checado na trigger e nas RPCs) -- a diferenca nunca e inferida como venda/perda/sobra. venda_estimada NUNCA e coluna aqui -- sempre derivada por lote (quantidade_enviada - quantidade_retirada), ver view producao_expositor_detalhado. "Situacao" tambem nunca e coluna -- calculada no frontend comparando data_prevista_retirada com dataLocalHoje().';

comment on column public.producao_expositor_lotes.producao_registro_id is
  'FK para o lancamento de producao que originou este lote -- NAO UNIQUE: um mesmo lancamento pode ter varios lotes (envios em momentos diferentes). ON DELETE RESTRICT: por decisao explicita desta rodada, public.excluir_producao_registro NAO E REDEFINIDA por esta migration (fica byte-a-byte como esta hoje, pos-0031) -- logo, tentar excluir um lancamento com lote(s) vinculado(s) e bloqueado SOMENTE pela FK em si, sem mensagem amigavel: o admin recebe o erro padrao do Postgres de violacao de chave estrangeira. A protecao de dado e identica (a exclusao continua fisicamente impedida); so a qualidade da mensagem de erro fica pior. Ver relatorio desta rodada para o trade-off completo.';

comment on column public.producao_expositor_lotes.data_entrada is
  'Data em que este lote entrou no expositor, informada pelo operador na criacao (criar_lote_expositor) -- NAO e derivada de producao_registros.data. O frontend sugere dataLocalHoje() (America/Sao_Paulo) como valor inicial, mas o operador pode informar qualquer outra data.';

comment on column public.producao_expositor_lotes.data_prevista_retirada is
  'Snapshot calculado na criacao (ou reculculado por editar_lote_expositor, enquanto o lote nao estiver concluido) como data_entrada + prazo_dias_snapshot -- aritmetica de date puro, sem nenhuma dependencia de timezone. Depois de concluido, imutavel.';

create index if not exists producao_expositor_lotes_producao_registro_id_idx
  on public.producao_expositor_lotes (producao_registro_id);

create index if not exists producao_expositor_lotes_data_prevista_retirada_idx
  on public.producao_expositor_lotes (data_prevista_retirada);

create index if not exists producao_expositor_lotes_pendentes_idx
  on public.producao_expositor_lotes (data_prevista_retirada)
  where concluido_em is null;

comment on index public.producao_expositor_lotes_pendentes_idx is
  'Parcial, so lotes ainda nao concluidos -- acelera a consulta do painel "Controle de Qualidade -- Retirar hoje" (atrasados + retirar hoje/amanha), que sempre filtra concluido_em is null.';


-- ============================================================
-- 3. Trigger de protecao de producao_expositor_lotes
-- ============================================================
-- Alem da autoria/imutabilidade de snapshot (mesmo espirito de
-- produto_fornecedores_protecao), esta trigger agora TAMBEM valida, em
-- INSERT e em UPDATE, que a SOMA de quantidade_enviada de TODOS os
-- lotes do mesmo producao_registro_id (excluindo a propria linha, no
-- caso de UPDATE) mais o valor novo nao ultrapassa producao_registros.
-- quantidade_produzida -- defesa em profundidade complementar as
-- checagens ja feitas dentro de cada RPC.

create or replace function public.producao_expositor_lotes_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campos_snapshot_alterados boolean;
  v_transicao_para_concluido boolean;
  v_quantidade_produzida integer;
  v_soma_outros_lotes integer;
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();

    if new.concluido_em is not null or new.concluido_por is not null or new.quantidade_retirada is not null then
      raise exception
        'producao_expositor_lotes: um lote nao pode ser criado ja concluido -- use concluir_retirada_expositor depois.';
    end if;
  else
    -- tg_op = 'UPDATE'.
    new.atualizado_em := now();

    v_campos_snapshot_alterados :=
      new.producao_registro_id <> old.producao_registro_id
      or new.prazo_dias_snapshot <> old.prazo_dias_snapshot
      or new.criado_por is distinct from old.criado_por
      or new.criado_em <> old.criado_em;

    if v_campos_snapshot_alterados then
      raise exception
        'producao_expositor_lotes: producao_registro_id/prazo_dias_snapshot/criado_por/criado_em sao imutaveis apos a criacao do lote (%).', old.id;
    end if;

    -- data_entrada/data_prevista_retirada sao corrigiveis ENQUANTO o
    -- lote nao estiver concluido (editar_lote_expositor) -- depois de
    -- concluido, ficam congeladas.
    if old.concluido_em is not null
       and (new.data_entrada <> old.data_entrada or new.data_prevista_retirada <> old.data_prevista_retirada)
    then
      raise exception
        'producao_expositor_lotes: data_entrada/data_prevista_retirada nao podem mais ser alteradas -- lote % ja concluido.', old.id;
    end if;

    if old.concluido_em is not null and new.concluido_em is distinct from old.concluido_em then
      raise exception
        'producao_expositor_lotes: concluido_em e imutavel depois de definido (lote %). Para desfazer uma conclusao registrada por engano, exclua o lote (producao_expositores.excluir).', old.id;
    end if;

    if old.concluido_por is not null and new.concluido_por is distinct from old.concluido_por then
      raise exception
        'producao_expositor_lotes: concluido_por e imutavel depois de definido (lote %).', old.id;
    end if;

    v_transicao_para_concluido := old.concluido_em is null and new.concluido_em is not null;

    if v_transicao_para_concluido then
      if not (select public.has_permissao('producao_expositores.operar')) then
        raise exception
          'producao_expositor_lotes: concluir a retirada do lote % requer a permissao producao_expositores.operar.', old.id;
      end if;

      new.concluido_por := auth.uid();
      new.concluido_em := now();
    end if;

    if old.concluido_em is not null then
      if (new.quantidade_enviada <> old.quantidade_enviada
          or new.quantidade_retirada is distinct from old.quantidade_retirada)
         and not (select public.has_permissao('producao_expositores.editar'))
      then
        raise exception
          'producao_expositor_lotes: corrigir quantidade_enviada/quantidade_retirada de um lote ja concluido (%) requer a permissao producao_expositores.editar -- use corrigir_lote_expositor_concluido.', old.id;
      end if;
    end if;
  end if;

  -- ============================================================
  -- Checagem de soma (INSERT e UPDATE): a soma de quantidade_enviada de
  -- TODOS os lotes deste producao_registro_id (excluindo esta propria
  -- linha, ja existente em caso de UPDATE -- new.id ja esta populado
  -- neste ponto do BEFORE trigger, o DEFAULT gen_random_uuid() ja
  -- rodou) nao pode ultrapassar producao_registros.quantidade_produzida.
  -- ============================================================
  select quantidade_produzida into v_quantidade_produzida
  from public.producao_registros
  where id = new.producao_registro_id;

  select coalesce(sum(quantidade_enviada), 0) into v_soma_outros_lotes
  from public.producao_expositor_lotes
  where producao_registro_id = new.producao_registro_id
    and id <> new.id;

  if v_soma_outros_lotes + new.quantidade_enviada > v_quantidade_produzida then
    raise exception
      'producao_expositor_lotes: a soma de quantidade_enviada dos lotes deste lancamento (% + % = %) nao pode ultrapassar a quantidade_produzida (%).',
      v_soma_outros_lotes, new.quantidade_enviada, v_soma_outros_lotes + new.quantidade_enviada, v_quantidade_produzida;
  end if;

  return new;
end;
$$;

comment on function public.producao_expositor_lotes_protecao() is
  'BEFORE INSERT/UPDATE trigger de producao_expositor_lotes. INSERT: forca criado_por/criado_em/atualizado_em, rejeita criacao ja concluida. UPDATE: bloqueia alteracao de producao_registro_id/prazo_dias_snapshot/criado_por/criado_em (sempre imutaveis); bloqueia alteracao de data_entrada/data_prevista_retirada/concluido_em/concluido_por depois de concluido; transicao null->concluido exige producao_expositores.operar e forca concluido_por/concluido_em; correcao de quantidade_enviada/quantidade_retirada de um lote JA concluido exige producao_expositores.editar. EM AMBOS OS CASOS (INSERT e UPDATE): valida que a SOMA de quantidade_enviada de todos os lotes do mesmo producao_registro_id (excluindo a propria linha) mais o valor novo nao ultrapassa producao_registros.quantidade_produzida -- defesa em profundidade complementar as RPCs.';

revoke execute on function public.producao_expositor_lotes_protecao() from public;

drop trigger if exists producao_expositor_lotes_protecao_trigger on public.producao_expositor_lotes;
create trigger producao_expositor_lotes_protecao_trigger
  before insert or update on public.producao_expositor_lotes
  for each row
  execute function public.producao_expositor_lotes_protecao();


-- ============================================================
-- 4. RLS de producao_expositor_lotes
-- ============================================================
alter table public.producao_expositor_lotes enable row level security;

drop policy if exists producao_expositor_lotes_select on public.producao_expositor_lotes;
create policy producao_expositor_lotes_select on public.producao_expositor_lotes
  for select to authenticated
  using ((select public.has_permissao('producao_expositores.visualizar')));

drop policy if exists producao_expositor_lotes_insert on public.producao_expositor_lotes;
create policy producao_expositor_lotes_insert on public.producao_expositor_lotes
  for insert to authenticated
  with check ((select public.has_permissao('producao_expositores.operar')));

drop policy if exists producao_expositor_lotes_update on public.producao_expositor_lotes;
create policy producao_expositor_lotes_update on public.producao_expositor_lotes
  for update to authenticated
  using (
    (select public.has_permissao('producao_expositores.operar'))
    or (select public.has_permissao('producao_expositores.editar'))
  )
  with check (
    (select public.has_permissao('producao_expositores.operar'))
    or (select public.has_permissao('producao_expositores.editar'))
  );

drop policy if exists producao_expositor_lotes_delete on public.producao_expositor_lotes;
create policy producao_expositor_lotes_delete on public.producao_expositor_lotes
  for delete to authenticated
  using ((select public.has_permissao('producao_expositores.excluir')));


-- ============================================================
-- 5. public.producao_registros_expositor_integridade() -- NOVA funcao +
--    NOVA trigger, SEGUNDA e SEPARADA sobre public.producao_registros
-- ============================================================
-- Fecha o lado que faltava da invariante SUM(producao_expositor_lotes.
-- quantidade_enviada) <= producao_registros.quantidade_produzida: as
-- RPCs/trigger de producao_expositor_lotes (secoes 3/6/7/9) ja impedem
-- a soma ULTRAPASSAR a producao no momento de criar/editar/corrigir um
-- lote; esta funcao/trigger impede o lado inverso -- reduzir
-- quantidade_produzida para um valor menor que a soma ja enviada.
--
-- DESENHO DELIBERADO -- responsabilidade UNICA, aditiva, isolada:
--   * SEGUNDA trigger em producao_registros, NAO uma alteracao da
--     trigger producao_registros_protecao (0010/0015/0019, intocada por
--     esta migration inteira -- ver secao "Esta migration NAO faz" no
--     cabecalho). As duas coexistem sem nenhuma dependencia de ordem:
--     nenhuma das duas modifica NEW (so validam e deixam passar, ou
--     abortam a transacao inteira com RAISE EXCEPTION) -- portanto e
--     indiferente qual das duas o Postgres dispara primeiro (ordem
--     alfabetica de nome de trigger, dentro do mesmo timing BEFORE
--     UPDATE): se qualquer uma rejeitar, a atualizacao inteira e
--     abortada; se as duas passarem, o resultado e identico
--     independente da ordem.
--   * "BEFORE UPDATE OF quantidade_produzida" (nao um BEFORE UPDATE
--     generico): dispara SOMENTE quando quantidade_produzida aparece no
--     SET da instrucao -- nunca em INSERT (nao ha lote possivel ainda:
--     a FK de producao_expositor_lotes exige que a linha de
--     producao_registros ja exista), nunca num UPDATE que nao mexe
--     nessa coluna (ex.: so observacoes, so houve_falta).
--   * NAO toca em NEW -- so leitura + eventual RAISE EXCEPTION. Nao
--     trata status, sobra, venda, receita, turno, data, custo_producao
--     nem houve_falta -- nenhuma dessas colunas e sequer lida aqui.
--   * NAO pode ser contornada por nenhuma RPC de correcao de producao
--     (adicionar_producao, editar_producao_registro, producao.corrigir,
--     ou qualquer futura): todas elas fazem um UPDATE real em
--     producao_registros por baixo, e esta trigger dispara para
--     QUALQUER UPDATE que altere quantidade_produzida, nao importa qual
--     RPC ou permissao a originou -- nao ha "modo confiavel" que pule
--     esta checagem.
--   * SECURITY DEFINER (com search_path='', mesmo padrao do projeto):
--     REALMENTE necessario aqui, nao so por convencao -- esta funcao
--     precisa enxergar TODOS os lotes de producao_expositor_lotes,
--     independente de o usuario que fez o UPDATE em producao_registros
--     ter ou nao producao_expositores.visualizar. Se fosse SECURITY
--     INVOKER, a policy producao_expositor_lotes_select (RLS por linha)
--     filtraria a consulta pela permissao do CHAMADOR -- um usuario com
--     producao.corrigir mas SEM producao_expositores.visualizar
--     enxergaria SUM()=0 mesmo com lotes reais existindo, e a checagem
--     falharia silenciosamente (bypass exatamente do tipo que a regra
--     pede para impedir). SECURITY DEFINER garante que a soma vista
--     aqui e sempre a soma REAL, nunca filtrada pela RLS do chamador.

create or replace function public.producao_registros_expositor_integridade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_soma_enviada integer;
begin
  if new.quantidade_produzida <> old.quantidade_produzida then
    select coalesce(sum(quantidade_enviada), 0) into v_soma_enviada
    from public.producao_expositor_lotes
    where producao_registro_id = old.id;

    if v_soma_enviada > new.quantidade_produzida then
      raise exception
        'producao_registros: quantidade_produzida do registro % nao pode ficar abaixo da quantidade ja enviada ao expositor (% enviados ao todo, % informado). Corrija ou exclua o(s) lote(s) de expositor (producao_expositor_lotes) antes de reduzir a producao.',
        old.id, v_soma_enviada, new.quantidade_produzida;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.producao_registros_expositor_integridade() is
  'SEGUNDA trigger de producao_registros (0030), SEPARADA e ADITIVA a producao_registros_protecao (0010/0015/0019, NAO redefinida por esta migration) -- responsabilidade UNICA: impedir que quantidade_produzida seja reduzida abaixo da SOMA de quantidade_enviada de todos os lotes de producao_expositor_lotes vinculados a este registro. Dispara so em UPDATE OF quantidade_produzida (nunca INSERT, nunca UPDATE que nao toca essa coluna). Nao altera NEW, nao trata status/sobra/venda/receita/turno/data/custo/houve_falta. SECURITY DEFINER necessario para enxergar a soma real de lotes independente da RLS/permissao do chamador (evita bypass da regra). Nenhuma RPC de producao consegue contornar esta checagem -- dispara para qualquer UPDATE que altere quantidade_produzida.';

revoke execute on function public.producao_registros_expositor_integridade() from public;

drop trigger if exists producao_registros_expositor_integridade_trigger on public.producao_registros;
create trigger producao_registros_expositor_integridade_trigger
  before update of quantidade_produzida on public.producao_registros
  for each row
  execute function public.producao_registros_expositor_integridade();


-- ============================================================
-- 6. public.producao_expositor_detalhado -- nova view
-- ============================================================
create or replace view public.producao_expositor_detalhado
with (security_invoker = true) as
select
  l.id as lote_id,
  l.producao_registro_id,
  pr.data as data_producao,
  pr.turno,
  pr.receita_id,
  r.nome as produto_nome,
  pr.quantidade_produzida,
  l.quantidade_enviada,
  l.data_entrada,
  l.prazo_dias_snapshot,
  l.data_prevista_retirada,
  l.quantidade_retirada,
  l.concluido_em,
  l.concluido_por,
  case
    when l.concluido_em is not null then l.quantidade_enviada - l.quantidade_retirada
    else null
  end as venda_estimada,
  l.observacao,
  l.criado_por,
  l.criado_em,
  l.atualizado_em
from public.producao_expositor_lotes l
join public.producao_registros pr on pr.id = l.producao_registro_id
join public.receitas r on r.id = pr.receita_id;

comment on view public.producao_expositor_detalhado is
  'Visao operacional/relatorio do Controle de Expositores: 1 linha por LOTE (um lancamento de producao pode aparecer em varias linhas, uma por lote gerado a partir dele). produto/data/turno/quantidade_produzida resolvidos via producao_registros/receitas. venda_estimada = quantidade_enviada - quantidade_retirada SEMPRE derivada (null antes da conclusao). security_invoker=true. Base tanto para a tela Producao > Expositores quanto para o futuro relatorio de desempenho (agregacao por receita_id/periodo via GROUP BY sobre esta view, sem tabela agregada). Nao expõe "situacao" -- calculada no frontend contra dataLocalHoje().';


-- ============================================================
-- 7. public.criar_lote_expositor -- nova RPC
-- ============================================================
-- Sempre cria um lote NOVO (nunca upsert -- 1:N permite varios lotes
-- por lancamento). Valida controlar_expositor=true e que a SOMA dos
-- lotes ja existentes deste lancamento + esta nova quantidade nao
-- ultrapassa quantidade_produzida.

create or replace function public.criar_lote_expositor(
  p_registro_id uuid,
  p_data_entrada date,
  p_quantidade_enviada integer
)
returns public.producao_expositor_lotes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro public.producao_registros;
  v_receita  public.receitas;
  v_soma_existente integer;
  v_lote public.producao_expositor_lotes;
begin
  if p_data_entrada is null then
    raise exception 'criar_lote_expositor: data_entrada e obrigatoria.';
  end if;

  if p_quantidade_enviada is null or p_quantidade_enviada <= 0 then
    raise exception 'criar_lote_expositor: quantidade_enviada deve ser maior que zero.';
  end if;

  select * into v_registro from public.producao_registros where id = p_registro_id;
  if v_registro.id is null then
    raise exception 'criar_lote_expositor: lancamento de producao % nao encontrado.', p_registro_id;
  end if;

  select * into v_receita from public.receitas where id = v_registro.receita_id;
  if v_receita.id is null or not v_receita.controlar_expositor then
    raise exception
      'criar_lote_expositor: o produto deste lancamento nao tem o Controle de Expositores habilitado.';
  end if;

  select coalesce(sum(quantidade_enviada), 0) into v_soma_existente
  from public.producao_expositor_lotes
  where producao_registro_id = p_registro_id;

  if v_soma_existente + p_quantidade_enviada > v_registro.quantidade_produzida then
    raise exception
      'criar_lote_expositor: quantidade_enviada (%) somada aos lotes ja existentes (%) ultrapassaria a quantidade produzida (%) deste lancamento.',
      p_quantidade_enviada, v_soma_existente, v_registro.quantidade_produzida;
  end if;

  insert into public.producao_expositor_lotes (
    producao_registro_id, quantidade_enviada,
    data_entrada, prazo_dias_snapshot, data_prevista_retirada
  ) values (
    p_registro_id, p_quantidade_enviada,
    p_data_entrada, v_receita.prazo_expositor_dias,
    p_data_entrada + v_receita.prazo_expositor_dias
  )
  returning * into v_lote;

  return v_lote;
end;
$$;

comment on function public.criar_lote_expositor(uuid, date, integer) is
  'Cria um lote NOVO de expositor para um lancamento de producao_registros (1:N -- um lancamento pode ter varios lotes). Exige receitas.controlar_expositor=true. Valida que a SOMA de quantidade_enviada de todos os lotes ja existentes deste lancamento + esta nova quantidade nao ultrapassa producao_registros.quantidade_produzida. data_entrada e informada pelo chamador (frontend sugere dataLocalHoje(), mas aceita qualquer data) -- prazo_dias_snapshot vem de receitas.prazo_expositor_dias NO MOMENTO da criacao, e data_prevista_retirada = data_entrada + prazo_dias_snapshot, ambos gravados como snapshot imutavel. SECURITY INVOKER: RLS (producao_expositores.operar) e a trigger producao_expositor_lotes_protecao continuam valendo.';

revoke execute on function public.criar_lote_expositor(uuid, date, integer) from public;
revoke execute on function public.criar_lote_expositor(uuid, date, integer) from anon;
grant execute on function public.criar_lote_expositor(uuid, date, integer) to authenticated;


-- ============================================================
-- 8. public.editar_lote_expositor -- nova RPC
-- ============================================================
-- Corrige data_entrada e/ou quantidade_enviada de um lote EXISTENTE
-- ainda NAO concluido (correcao coerente pre-conclusao, pedido
-- explicito). Recalcula data_prevista_retirada a partir da (possivel
-- nova) data_entrada + o MESMO prazo_dias_snapshot ja gravado --
-- prazo_dias_snapshot em si nunca muda aqui.

create or replace function public.editar_lote_expositor(
  p_lote_id uuid,
  p_data_entrada date,
  p_quantidade_enviada integer
)
returns public.producao_expositor_lotes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes public.producao_expositor_lotes;
  v_produzida integer;
  v_soma_outros integer;
  v_lote public.producao_expositor_lotes;
begin
  if p_data_entrada is null then
    raise exception 'editar_lote_expositor: data_entrada e obrigatoria.';
  end if;

  if p_quantidade_enviada is null or p_quantidade_enviada <= 0 then
    raise exception 'editar_lote_expositor: quantidade_enviada deve ser maior que zero.';
  end if;

  select * into v_antes from public.producao_expositor_lotes where id = p_lote_id;
  if v_antes.id is null then
    raise exception 'editar_lote_expositor: lote % nao encontrado.', p_lote_id;
  end if;

  if v_antes.concluido_em is not null then
    raise exception
      'editar_lote_expositor: este lote ja foi concluido (retirado) -- use corrigir_lote_expositor_concluido para ajustar.';
  end if;

  select quantidade_produzida into v_produzida
  from public.producao_registros where id = v_antes.producao_registro_id;

  select coalesce(sum(quantidade_enviada), 0) into v_soma_outros
  from public.producao_expositor_lotes
  where producao_registro_id = v_antes.producao_registro_id
    and id <> p_lote_id;

  if v_soma_outros + p_quantidade_enviada > v_produzida then
    raise exception
      'editar_lote_expositor: quantidade_enviada (%) somada aos demais lotes deste lancamento (%) ultrapassaria a quantidade produzida (%).',
      p_quantidade_enviada, v_soma_outros, v_produzida;
  end if;

  update public.producao_expositor_lotes
  set data_entrada = p_data_entrada,
      quantidade_enviada = p_quantidade_enviada,
      data_prevista_retirada = p_data_entrada + prazo_dias_snapshot
  where id = p_lote_id
  returning * into v_lote;

  return v_lote;
end;
$$;

comment on function public.editar_lote_expositor(uuid, date, integer) is
  'Corrige data_entrada/quantidade_enviada de um lote EXISTENTE, SOMENTE se ainda nao concluido. Recalcula data_prevista_retirada = nova data_entrada + prazo_dias_snapshot (o snapshot do prazo em si nunca muda). Revalida a soma de quantidade_enviada de todos os OUTROS lotes do mesmo lancamento + este novo valor contra quantidade_produzida. SECURITY INVOKER.';

revoke execute on function public.editar_lote_expositor(uuid, date, integer) from public;
revoke execute on function public.editar_lote_expositor(uuid, date, integer) from anon;
grant execute on function public.editar_lote_expositor(uuid, date, integer) to authenticated;


-- ============================================================
-- 9. public.concluir_retirada_expositor -- nova RPC
-- ============================================================
create or replace function public.concluir_retirada_expositor(
  p_lote_id uuid,
  p_quantidade_retirada integer
)
returns public.producao_expositor_lotes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lote public.producao_expositor_lotes;
begin
  if p_quantidade_retirada is null or p_quantidade_retirada < 0 then
    raise exception 'concluir_retirada_expositor: quantidade_retirada deve ser zero ou maior.';
  end if;

  select * into v_lote from public.producao_expositor_lotes where id = p_lote_id;
  if v_lote.id is null then
    raise exception 'concluir_retirada_expositor: lote % nao encontrado.', p_lote_id;
  end if;

  if v_lote.concluido_em is not null then
    raise exception 'concluir_retirada_expositor: este lote ja foi concluido.';
  end if;

  if p_quantidade_retirada > v_lote.quantidade_enviada then
    raise exception
      'concluir_retirada_expositor: quantidade_retirada (%) nao pode ser maior que a quantidade enviada ao expositor (%).',
      p_quantidade_retirada, v_lote.quantidade_enviada;
  end if;

  update public.producao_expositor_lotes
  set quantidade_retirada = p_quantidade_retirada,
      concluido_em = now(),
      concluido_por = auth.uid()
  where id = p_lote_id
  returning * into v_lote;

  return v_lote;
end;
$$;

comment on function public.concluir_retirada_expositor(uuid, integer) is
  'Conclui um lote (marca retirada/controle de qualidade), SOMENTE se ainda nao concluido e quantidade_retirada <= quantidade_enviada. concluido_em/concluido_por definidos aqui e reforcados pela trigger (defesa em profundidade), exige producao_expositores.operar. Depois de concluido, rejeita nova chamada -- correcao e via corrigir_lote_expositor_concluido. SECURITY INVOKER.';

revoke execute on function public.concluir_retirada_expositor(uuid, integer) from public;
revoke execute on function public.concluir_retirada_expositor(uuid, integer) from anon;
grant execute on function public.concluir_retirada_expositor(uuid, integer) to authenticated;


-- ============================================================
-- 10. public.corrigir_lote_expositor_concluido -- nova RPC
-- ============================================================
create or replace function public.corrigir_lote_expositor_concluido(
  p_lote_id uuid,
  p_quantidade_enviada integer,
  p_quantidade_retirada integer,
  p_motivo text
)
returns public.producao_expositor_lotes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes  public.producao_expositor_lotes;
  v_depois public.producao_expositor_lotes;
  v_produzida integer;
  v_soma_outros integer;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'corrigir_lote_expositor_concluido: motivo e obrigatorio.';
  end if;

  if p_quantidade_enviada is null or p_quantidade_enviada <= 0 then
    raise exception 'corrigir_lote_expositor_concluido: quantidade_enviada deve ser maior que zero.';
  end if;

  if p_quantidade_retirada is null or p_quantidade_retirada < 0 then
    raise exception 'corrigir_lote_expositor_concluido: quantidade_retirada deve ser zero ou maior.';
  end if;

  if p_quantidade_retirada > p_quantidade_enviada then
    raise exception
      'corrigir_lote_expositor_concluido: quantidade_retirada (%) nao pode ser maior que quantidade_enviada (%).',
      p_quantidade_retirada, p_quantidade_enviada;
  end if;

  select * into v_antes from public.producao_expositor_lotes where id = p_lote_id;
  if v_antes.id is null then
    raise exception 'corrigir_lote_expositor_concluido: lote % nao encontrado.', p_lote_id;
  end if;

  if v_antes.concluido_em is null then
    raise exception
      'corrigir_lote_expositor_concluido: este lote ainda nao foi concluido -- use criar_lote_expositor/editar_lote_expositor/concluir_retirada_expositor.';
  end if;

  select quantidade_produzida into v_produzida
  from public.producao_registros where id = v_antes.producao_registro_id;

  select coalesce(sum(quantidade_enviada), 0) into v_soma_outros
  from public.producao_expositor_lotes
  where producao_registro_id = v_antes.producao_registro_id
    and id <> p_lote_id;

  if v_soma_outros + p_quantidade_enviada > v_produzida then
    raise exception
      'corrigir_lote_expositor_concluido: quantidade_enviada (%) somada aos demais lotes deste lancamento (%) ultrapassaria a quantidade produzida (%).',
      p_quantidade_enviada, v_soma_outros, v_produzida;
  end if;

  update public.producao_expositor_lotes
  set quantidade_enviada = p_quantidade_enviada,
      quantidade_retirada = p_quantidade_retirada
  where id = p_lote_id
  returning * into v_depois;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('producao_expositor_lote', p_lote_id::text, 'corrigiu_concluido', 'motivo', null, p_motivo);

  if v_antes.quantidade_enviada is distinct from v_depois.quantidade_enviada then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao_expositor_lote', p_lote_id::text, 'corrigiu_concluido', 'quantidade_enviada',
      v_antes.quantidade_enviada::text, v_depois.quantidade_enviada::text);
  end if;

  if v_antes.quantidade_retirada is distinct from v_depois.quantidade_retirada then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao_expositor_lote', p_lote_id::text, 'corrigiu_concluido', 'quantidade_retirada',
      v_antes.quantidade_retirada::text, v_depois.quantidade_retirada::text);
  end if;

  return v_depois;
end;
$$;

comment on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text) is
  'Corrige quantidade_enviada/quantidade_retirada de um lote JA concluido, SEM alterar concluido_em/concluido_por/data_entrada/data_prevista_retirada (imutaveis). SOMENTE se o lote ja estiver concluido. Revalida a soma de quantidade_enviada dos demais lotes do mesmo lancamento + este novo valor contra quantidade_produzida. Exige producao_expositores.editar (RLS + trigger). Motivo obrigatorio. Snapshot em logs_auditoria (entidade=producao_expositor_lote) antes do UPDATE. SECURITY INVOKER.';

revoke execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text) from public;
revoke execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text) from anon;
grant execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text) to authenticated;


-- ============================================================
-- 11. public.excluir_lote_expositor -- nova RPC
-- ============================================================
-- Exclusao definitiva, independente de status (concluido ou nao) --
-- protecao real e a permissao restrita (producao_expositores.excluir,
-- concedida so a proprietario_admin nesta migration) + motivo
-- obrigatorio + auditoria atomica antes do DELETE. Fluxo administrativo
-- completamente separado da retirada operacional (concluir_retirada_
-- expositor) -- "nunca usar exclusao para representar retirada" e
-- garantido pelo FRONTEND ter 2 botoes/fluxos distintos.

create or replace function public.excluir_lote_expositor(
  p_lote_id uuid,
  p_motivo text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lote public.producao_expositor_lotes;
begin
  if not (select public.has_permissao('producao_expositores.excluir')) then
    raise exception
      'excluir_lote_expositor: exclusao definitiva de lote de expositor requer a permissao producao_expositores.excluir.';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'excluir_lote_expositor: motivo e obrigatorio.';
  end if;

  select * into v_lote from public.producao_expositor_lotes where id = p_lote_id;
  if v_lote.id is null then
    raise exception 'excluir_lote_expositor: lote % nao encontrado.', p_lote_id;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'motivo', null, p_motivo),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'producao_registro_id', v_lote.producao_registro_id::text, null),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'quantidade_enviada', v_lote.quantidade_enviada::text, null),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'data_entrada', v_lote.data_entrada::text, null),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'prazo_dias_snapshot', v_lote.prazo_dias_snapshot::text, null),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'data_prevista_retirada', v_lote.data_prevista_retirada::text, null),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'quantidade_retirada', v_lote.quantidade_retirada::text, null),
    ('producao_expositor_lote', p_lote_id::text, 'excluiu', 'concluido_em', v_lote.concluido_em::text, null);

  delete from public.producao_expositor_lotes where id = p_lote_id;
end;
$$;

comment on function public.excluir_lote_expositor(uuid, text) is
  'Exclui definitivamente um lote de producao_expositor_lotes, independente de status (concluido ou nao) -- unico caminho de exclusao fisica, restrito a producao_expositores.excluir (checagem explicita + policy DELETE). Motivo obrigatorio. Snapshot completo em logs_auditoria (entidade=producao_expositor_lote) antes do DELETE, mesma transacao. Sem CASCADE: a FK producao_registro_id continua RESTRICT, intocada -- excluir o LOTE nunca exclui o lancamento de producao original.';

revoke execute on function public.excluir_lote_expositor(uuid, text) from public;
revoke execute on function public.excluir_lote_expositor(uuid, text) from anon;
grant execute on function public.excluir_lote_expositor(uuid, text) to authenticated;


-- ============================================================
-- 12. SEED -- 4 codigos novos de permissao (modulo producao_expositores)
-- ============================================================
-- Concedidas a proprietario_admin nesta propria migration -- decisao
-- explicita do usuario, seguindo o padrao dos modulos administrativos
-- mais recentes (catalogo_produtos.excluir, pedidos.excluir).

insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('producao_expositores.visualizar', 'producao_expositores', 'visualizar',
   'Ver a aba Producao > Expositores: painel de retirada e lista de lotes. RLS real de producao_expositor_lotes (SELECT).'),
  ('producao_expositores.operar', 'producao_expositores', 'operar',
   'Operacao rotineira: criar/corrigir lotes de expositor (criar_lote_expositor, editar_lote_expositor) e concluir retirada (concluir_retirada_expositor), enquanto o lote nao estiver concluido.'),
  ('producao_expositores.editar', 'producao_expositores', 'editar',
   'Corrigir quantidade_enviada/quantidade_retirada de um lote JA CONCLUIDO, via corrigir_lote_expositor_concluido. Mais restritiva que .operar -- correcao administrativa de um fato ja fechado.'),
  ('producao_expositores.excluir', 'producao_expositores', 'excluir',
   'Excluir definitivamente um lote de expositor cadastrado por engano, via excluir_lote_expositor. Permitido independente de status (inclusive concluido) -- protecao real e a restricao desta permissao + auditoria, nao o status do lote.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo in (
  'producao_expositores.visualizar', 'producao_expositores.operar',
  'producao_expositores.editar', 'producao_expositores.excluir'
)
on conflict do nothing;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro ENQUANTO nenhum produto tiver sido marcado controlar_expositor
-- =true e nenhum lote real tiver sido criado -- a partir desse momento,
-- rodar isto DESTROI esses dados (o DROP TABLE apaga todos os lotes).
-- Auditar antes (SELECT count(*) FROM producao_expositor_lotes;
-- SELECT count(*) FROM receitas WHERE controlar_expositor).
-- BEGIN;
--
--   delete from public.perfil_permissoes where permissao like 'producao_expositores.%';
--   delete from public.usuario_permissoes where permissao like 'producao_expositores.%';
--   delete from public.permissoes where modulo = 'producao_expositores';
--
--   -- producao_registros_protecao() e excluir_producao_registro() NAO
--   -- foram tocadas por esta migration -- nao ha nada a restaurar nelas.
--
--   -- 2a trigger de producao_registros (secao 5) -- SEPARADA da trigger
--   -- producao_registros_protecao (0010/0015/0019, intocada, permanece
--   -- instalada e funcionando normalmente depois deste DROP).
--   drop trigger if exists producao_registros_expositor_integridade_trigger on public.producao_registros;
--   revoke execute on function public.producao_registros_expositor_integridade() from public;
--   drop function if exists public.producao_registros_expositor_integridade();
--
--   revoke execute on function public.excluir_lote_expositor(uuid, text) from authenticated;
--   drop function if exists public.excluir_lote_expositor(uuid, text);
--
--   revoke execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text) from authenticated;
--   drop function if exists public.corrigir_lote_expositor_concluido(uuid, integer, integer, text);
--
--   revoke execute on function public.concluir_retirada_expositor(uuid, integer) from authenticated;
--   drop function if exists public.concluir_retirada_expositor(uuid, integer);
--
--   revoke execute on function public.editar_lote_expositor(uuid, date, integer) from authenticated;
--   drop function if exists public.editar_lote_expositor(uuid, date, integer);
--
--   revoke execute on function public.criar_lote_expositor(uuid, date, integer) from authenticated;
--   drop function if exists public.criar_lote_expositor(uuid, date, integer);
--
--   drop view if exists public.producao_expositor_detalhado;
--
--   drop policy if exists producao_expositor_lotes_delete on public.producao_expositor_lotes;
--   drop policy if exists producao_expositor_lotes_update on public.producao_expositor_lotes;
--   drop policy if exists producao_expositor_lotes_insert on public.producao_expositor_lotes;
--   drop policy if exists producao_expositor_lotes_select on public.producao_expositor_lotes;
--   alter table public.producao_expositor_lotes disable row level security;
--
--   drop trigger if exists producao_expositor_lotes_protecao_trigger on public.producao_expositor_lotes;
--   drop function if exists public.producao_expositor_lotes_protecao();
--
--   drop table if exists public.producao_expositor_lotes;
--
--   alter table public.receitas drop constraint if exists receitas_prazo_expositor_coerente_check;
--   alter table public.receitas drop column if exists prazo_expositor_dias;
--   alter table public.receitas drop column if exists controlar_expositor;
--
-- COMMIT;
