-- 0032_expositores_integridade_concorrencia.sql
-- Controle de Expositores -- fecha 3 lacunas identificadas em teste
-- funcional da 0030 (ja aplicada, pos-auditada, versionada -- NAO
-- alterada por este arquivo):
--   1) concorrencia: producao_expositor_lotes_protecao() nao travava a
--      linha pai de producao_registros antes de somar os lotes;
--   2) regra operacional: producao com status='reaberto' nao pode
--      receber lote NOVO (mas um lote ja existente, ainda pendente,
--      continua editavel mesmo com a producao pai reaberta);
--   3) campo producao_expositor_lotes.observacao (ja existe desde a
--      0030) nunca era exposto por nenhuma RPC -- passa a ser
--      gravavel na criacao, na edicao pre-conclusao e na correcao
--      administrativa pos-conclusao, com a mesma protecao de permissao
--      da correcao administrativa (nunca confundida com o motivo de
--      auditoria).
--
-- Tambem NAO altera a 0031 (houve_falta), producao_registros_protecao
-- nem producao_registros_expositor_integridade -- ambas permanecem
-- byte-a-byte como estao.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita, E ate
-- 0032_pre_auditoria_expositores_concorrencia_EXECUTAR.sql ser rodada e
-- o Bloco 4 (pg_depend) confirmar ausencia de dependencia real sobre as
-- 3 RPCs alteradas -- se o Bloco 4 mostrar qualquer dependencia alem do
-- trivial, PARAR antes de aplicar esta migration.
--
-- ============================================================
-- DECISAO TECNICA CENTRAL -- por que DROP + CREATE, nao CREATE OR
-- REPLACE, para as 3 RPCs (auditoria pedida explicitamente pelo
-- usuario, correcao de uma premissa errada de uma rodada anterior):
-- ============================================================
-- Em PostgreSQL, a IDENTIDADE de uma funcao para fins de CREATE OR
-- REPLACE e overload e (schema, nome, LISTA COMPLETA DE TIPOS DE
-- PARAMETRO DE ENTRADA, na ordem). "CREATE OR REPLACE FUNCTION" so
-- substitui uma funcao existente quando essa lista de tipos e
-- EXATAMENTE IGUAL a de uma funcao ja existente -- redefinir o CORPO,
-- mudar o valor DEFAULT de um parametro JA EXISTENTE, ou mudar nomes de
-- parametro sao permitidos; ACRESCENTAR um parametro novo NAO E --
-- mesmo com DEFAULT, isso muda a lista de tipos (de 3 para 4 tipos, no
-- caso de criar_lote_expositor/editar_lote_expositor), e o Postgres
-- trata isso como uma funcao DISTINTA (overload novo), preservando a
-- antiga intocada ao lado dela. Se esta migration usasse CREATE OR
-- REPLACE FUNCTION criar_lote_expositor(uuid, date, integer, text
-- default null), o resultado seria DUAS funcoes coexistindo
-- (criar_lote_expositor/3 e criar_lote_expositor/4) -- exatamente o que
-- o usuario pediu para NAO deixar acontecer (um bundle de frontend
-- desatualizado em cache continuaria conseguindo chamar a versao de 3
-- argumentos, sem observacao e sem o gate de status, silenciosamente).
--
-- Estrategia adotada, para cada uma das 3 RPCs: DROP FUNCTION com a
-- assinatura EXATA antiga (confirmada pelo Bloco 1 da pre-auditoria) +
-- CREATE FUNCTION com a assinatura nova + REVOKE/GRANT explicitos +
-- COMMENT ON FUNCTION novo (DROP apaga o comentario antigo junto). Ao
-- final, existe SOMENTE a assinatura nova de cada uma -- a pos-auditoria
-- (Bloco correspondente) prova isso consultando pg_proc diretamente.
--
-- producao_expositor_lotes_protecao() e diferente: e uma funcao de
-- TRIGGER (returns trigger, sem nenhum parametro de entrada -- "()").
-- Sua identidade nunca muda porque nunca ganha parametro novo -- so o
-- CORPO muda. Por isso ela continua sendo CREATE OR REPLACE FUNCTION,
-- normalmente, sem DROP/CREATE TRIGGER (mesmo padrao ja usado em
-- 0015/0017/0019 para producao_registros_protecao).
--
-- ============================================================
-- CONCORRENCIA -- ordem de locks e analise de deadlock (auditoria
-- pedida explicitamente, nao assumir "sem risco" so por nao haver FOR
-- UPDATE explicito na outra ponta):
-- ============================================================
-- producao_expositor_lotes_protecao() passa a fazer
-- "select ... for update" na linha de producao_registros ANTES de somar
-- os lotes -- serializa INSERT/UPDATE concorrentes em
-- producao_expositor_lotes para o MESMO producao_registro_id.
--
-- Cadeia de locks considerada (nao so o FOR UPDATE explicito -- os
-- locks IMPLICITOS de UPDATE/INSERT tambem):
--   * Um UPDATE comum em producao_registros (ex.: adicionar_producao,
--     editar_producao_registro, corrigindo quantidade_produzida) toma,
--     como parte do proprio mecanismo de localizar a linha-alvo (ANTES
--     de qualquer trigger BEFORE ROW disparar), um lock implicito FOR
--     NO KEY UPDATE nela -- automaticamente, sem nenhum SQL explicito.
--     FOR NO KEY UPDATE conflita com FOR UPDATE (matriz de locks do
--     Postgres, secao 13.3.1). Isso significa que o novo FOR UPDATE
--     desta trigger tambem SERIALIZA contra UPDATEs comuns de
--     quantidade_produzida -- nao so contra outros INSERTs de lote --
--     fechando os DOIS lados da invariante (soma nao ultrapassa
--     produzida E producao nao cai abaixo do somado) com o MESMO ponto
--     de lock, sem precisar tocar em producao_registros_expositor_
--     integridade nem em producao_registros_protecao.
--   * producao_registros_expositor_integridade() (trigger BEFORE UPDATE
--     OF quantidade_produzida, INTOCADA por esta migration) faz
--     "select coalesce(sum(...))" em producao_expositor_lotes SEM
--     nenhum FOR UPDATE/FOR SHARE -- um SELECT puro em PostgreSQL NAO
--     adquire NENHUM lock de linha (leitura via snapshot MVCC). Logo,
--     mesmo considerando o lock IMPLICITO que o UPDATE em
--     producao_registros ja segura antes desta trigger rodar, ela
--     NUNCA pede lock nenhum de volta sobre producao_expositor_lotes --
--     nao existe caminho de ida-e-volta entre as duas tabelas.
--   * Nenhuma outra funcao de producao (adicionar_producao,
--     editar_producao_registro, excluir_producao_registro) toca em
--     producao_expositor_lotes dentro da propria transacao.
-- CONCLUSAO: a UNICA direcao em que um lock atravessa as duas tabelas e
-- "escrita em producao_expositor_lotes -> trava producao_registros"
-- (via o FOR UPDATE novo desta trigger, e via o FOR KEY SHARE que a FK
-- ja tomava automaticamente desde a 0030). Nao existe a direcao oposta
-- em nenhum objeto atual -- sem ciclo, sem deadlock plausivel. Duas
-- transacoes concorrentes para o MESMO producao_registro_id apenas
-- SERIALIZAM (uma espera a outra terminar), o que e exatamente o
-- comportamento desejado, nunca um impasse. Nota para manutencao
-- futura: qualquer funcao nova que precise travar as duas tabelas deve
-- preservar esta mesma ordem (producao_expositor_lotes primeiro, depois
-- producao_registros) para nao introduzir um ciclo.
--
-- ============================================================
-- REABERTO -- gate no banco (defesa em profundidade, decisao do
-- usuario): SOMENTE criar_lote_expositor ganha a checagem de status.
-- editar_lote_expositor CONTINUA sem nenhum gate de status da producao
-- pai -- um lote ja existente, ainda pendente, e corrigivel mesmo com a
-- producao pai reaberta (requisito explicito, ja funcionava assim antes
-- desta migration e continua funcionando).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * producao_expositor_lotes_protecao() -- CREATE OR REPLACE (mesma
--     assinatura "()"): + FOR UPDATE na leitura de quantidade_produzida;
--     + observacao entra no gate pos-conclusao (exige
--     producao_expositores.editar, igual a quantidade_enviada/
--     quantidade_retirada);
--   * criar_lote_expositor -- DROP (uuid,date,integer) + CREATE
--     (uuid,date,integer,text default null): +p_observacao
--     (normalizada via nullif(btrim(...),'')); + gate explicito de
--     status (aberto/fechado permitidos, reaberto bloqueado);
--   * editar_lote_expositor -- DROP (uuid,date,integer) + CREATE
--     (uuid,date,integer,text default null): +p_observacao, SEM gate de
--     status;
--   * corrigir_lote_expositor_concluido -- DROP (uuid,integer,integer,
--     text) + CREATE (uuid,integer,integer,text,text default null):
--     +p_observacao (ultimo parametro -- Postgres exige que todo
--     parametro com DEFAULT venha depois de todos os sem default;
--     p_motivo continua sem default, logo p_observacao tem que vir
--     depois dele), com auditoria condicional em logs_auditoria
--     (campo='observacao') se o valor mudar, mesma transacao da
--     correcao.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em producao_registros_protecao() nem em
--     producao_registros_expositor_integridade() -- nenhum CREATE OR
--     REPLACE em nenhuma das duas;
--   * nenhuma alteracao na migration 0030 nem na 0031;
--   * nenhuma coluna nova (observacao ja existe desde a 0030);
--   * nenhuma policy de RLS nova/alterada (RLS continua por linha
--     inteira, via has_permissao, nunca por coluna);
--   * nenhum codigo de permissao novo (reaproveita producao_expositores.
--     operar/editar, ja existentes);
--   * nenhuma alteracao em houve_falta, MarcadorFalta.js,
--     sugestaoProducao.js, historico.js, planejamento.js;
--   * nenhuma alteracao em quantidade_vendida/sobra_total/
--     sobra_aproveitavel/perda_descarte;
--   * gate de status em editar_lote_expositor (explicitamente NAO
--     pedido -- lote pendente e editavel com producao pai em qualquer
--     status, inclusive reaberto);
--   * nenhum INSERT/UPDATE de dado real.

BEGIN;

-- ============================================================
-- 1. producao_expositor_lotes_protecao() -- CREATE OR REPLACE
-- ============================================================
-- Corpo IDENTICO ao da 0030 (confirmar contra o Bloco 6 da
-- pre-auditoria), com 2 mudancas pontuais:
--   a) a leitura de quantidade_produzida ganha "for update" (trava a
--      linha pai ANTES de somar -- fecha a corrida documentada acima);
--   b) o gate pos-conclusao (que hoje so olha quantidade_enviada/
--      quantidade_retirada) passa a olhar TAMBEM observacao.

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

    -- (0032) observacao entra no MESMO gate pos-conclusao de
    -- quantidade_enviada/quantidade_retirada -- fecha o buraco
    -- identificado na auditoria: ate aqui, corrigir observacao de um
    -- lote ja concluido nao exigia producao_expositores.editar.
    if old.concluido_em is not null then
      if (new.quantidade_enviada <> old.quantidade_enviada
          or new.quantidade_retirada is distinct from old.quantidade_retirada
          or new.observacao is distinct from old.observacao)
         and not (select public.has_permissao('producao_expositores.editar'))
      then
        raise exception
          'producao_expositor_lotes: corrigir quantidade_enviada/quantidade_retirada/observacao de um lote ja concluido (%) requer a permissao producao_expositores.editar -- use corrigir_lote_expositor_concluido.', old.id;
      end if;
    end if;
  end if;

  -- (0032) Checagem de soma agora com a linha PAI travada (FOR UPDATE)
  -- ANTES de somar -- serializa INSERT/UPDATE concorrentes para o mesmo
  -- producao_registro_id. Ver analise de locks/deadlock no cabecalho
  -- desta migration.
  select quantidade_produzida into v_quantidade_produzida
  from public.producao_registros
  where id = new.producao_registro_id
  for update;

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
  '[0030] BEFORE INSERT/UPDATE trigger de producao_expositor_lotes. INSERT: forca criado_por/criado_em/atualizado_em, rejeita criacao ja concluida. UPDATE: bloqueia alteracao de producao_registro_id/prazo_dias_snapshot/criado_por/criado_em (sempre imutaveis); bloqueia alteracao de data_entrada/data_prevista_retirada/concluido_em/concluido_por depois de concluido; transicao null->concluido exige producao_expositores.operar e forca concluido_por/concluido_em; correcao de quantidade_enviada/quantidade_retirada/observacao (0032: observacao incluida) de um lote JA concluido exige producao_expositores.editar. (0032) A leitura de quantidade_produzida agora usa FOR UPDATE -- trava a linha pai de producao_registros ANTES de somar, serializando INSERT/UPDATE concorrentes de lotes para o mesmo producao_registro_id (e, como efeito do lock implicito de UPDATE, tambem contra alteracoes concorrentes de quantidade_produzida). Valida que a SOMA de quantidade_enviada de todos os lotes do mesmo producao_registro_id (excluindo a propria linha) mais o valor novo nao ultrapassa producao_registros.quantidade_produzida.';


-- ============================================================
-- 2. public.criar_lote_expositor -- DROP (uuid,date,integer) +
--    CREATE (uuid,date,integer,text default null)
-- ============================================================
-- DROP com a assinatura EXATA confirmada pelo Bloco 1 da pre-auditoria.
-- Ver decisao tecnica central no cabecalho desta migration (por que
-- DROP+CREATE, nao CREATE OR REPLACE).

drop function if exists public.criar_lote_expositor(uuid, date, integer);

create function public.criar_lote_expositor(
  p_registro_id uuid,
  p_data_entrada date,
  p_quantidade_enviada integer,
  p_observacao text default null
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

  -- (0032) Gate explicito de status -- NOVO lote so para producao
  -- aberto/fechado. Producao reaberta (correcao em andamento) nao pode
  -- receber lote novo. NAO se aplica a editar_lote_expositor (lote ja
  -- existente, ainda pendente, continua editavel com a producao pai em
  -- qualquer status -- requisito explicito).
  if v_registro.status not in ('aberto', 'fechado') then
    raise exception
      'criar_lote_expositor: nao e possivel criar um novo lote enquanto o lancamento de producao % estiver com status=% -- somente aberto ou fechado.',
      p_registro_id, v_registro.status;
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
    data_entrada, prazo_dias_snapshot, data_prevista_retirada,
    observacao
  ) values (
    p_registro_id, p_quantidade_enviada,
    p_data_entrada, v_receita.prazo_expositor_dias,
    p_data_entrada + v_receita.prazo_expositor_dias,
    nullif(btrim(p_observacao), '')
  )
  returning * into v_lote;

  return v_lote;
end;
$$;

comment on function public.criar_lote_expositor(uuid, date, integer, text) is
  '[0030, com 2 mudancas da 0032] Cria um lote NOVO de expositor para um lancamento de producao_registros (1:N -- um lancamento pode ter varios lotes). (0032) Exige status IN (aberto, fechado) -- producao reaberta nao pode receber lote novo (mensagem explicita, nao apenas filtro de frontend). Exige receitas.controlar_expositor=true. Valida que a SOMA de quantidade_enviada de todos os lotes ja existentes deste lancamento + esta nova quantidade nao ultrapassa producao_registros.quantidade_produzida. data_entrada e informada pelo chamador. (0032) p_observacao (opcional) e normalizada via nullif(btrim(p_observacao), string vazia) -- ausente/so espacos vira NULL, nunca string vazia. prazo_dias_snapshot/data_prevista_retirada continuam snapshot imutavel. SECURITY INVOKER: RLS (producao_expositores.operar) e a trigger producao_expositor_lotes_protecao continuam valendo. Assinatura NOVA (0032) -- a antiga de 3 parametros (sem observacao, sem gate de status) foi excluida por esta mesma migration, nao coexiste.';

revoke execute on function public.criar_lote_expositor(uuid, date, integer, text) from public;
revoke execute on function public.criar_lote_expositor(uuid, date, integer, text) from anon;
grant execute on function public.criar_lote_expositor(uuid, date, integer, text) to authenticated;
-- (0032) DROP+CREATE cria um objeto NOVO -- nao herda o ACL da funcao
-- antiga. service_role tinha EXECUTE na assinatura anterior (confirmado
-- pela pre-auditoria real) por um mecanismo automatico do Supabase, nao
-- por GRANT explicito em nenhuma migration deste projeto -- nao
-- dependemos disso aqui: concedido explicitamente, preservando o estado
-- conhecido sem confiar em comportamento implicito.
grant execute on function public.criar_lote_expositor(uuid, date, integer, text) to service_role;


-- ============================================================
-- 3. public.editar_lote_expositor -- DROP (uuid,date,integer) +
--    CREATE (uuid,date,integer,text default null)
-- ============================================================
-- SEM gate de status -- lote ja existente, ainda pendente, e editavel
-- com a producao pai em qualquer status (inclusive reaberto).

drop function if exists public.editar_lote_expositor(uuid, date, integer);

create function public.editar_lote_expositor(
  p_lote_id uuid,
  p_data_entrada date,
  p_quantidade_enviada integer,
  p_observacao text default null
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

  -- (0032) Deliberadamente SEM checagem de producao_registros.status
  -- aqui -- um lote pendente e corrigivel com a producao pai em
  -- qualquer status, inclusive reaberto (requisito explicito).
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
      data_prevista_retirada = p_data_entrada + prazo_dias_snapshot,
      observacao = nullif(btrim(p_observacao), '')
  where id = p_lote_id
  returning * into v_lote;

  return v_lote;
end;
$$;

comment on function public.editar_lote_expositor(uuid, date, integer, text) is
  '[0030, com 1 mudanca da 0032] Corrige data_entrada/quantidade_enviada/observacao de um lote EXISTENTE, SOMENTE se ainda nao concluido -- SEM nenhum gate de status da producao pai (edicao de lote pendente e permitida com a producao em aberto/fechado/reaberto). Recalcula data_prevista_retirada = nova data_entrada + prazo_dias_snapshot. Revalida a soma de quantidade_enviada de todos os OUTROS lotes do mesmo lancamento + este novo valor contra quantidade_produzida. (0032) p_observacao (opcional) sempre DEFINE o valor (nullif(btrim(p_observacao), string vazia)) -- nao e merge parcial: o chamador reenvia o valor atual para preservar, ou vazio/NULL para limpar. SECURITY INVOKER. Assinatura NOVA (0032) -- a antiga de 3 parametros foi excluida por esta mesma migration.';

revoke execute on function public.editar_lote_expositor(uuid, date, integer, text) from public;
revoke execute on function public.editar_lote_expositor(uuid, date, integer, text) from anon;
grant execute on function public.editar_lote_expositor(uuid, date, integer, text) to authenticated;
-- (0032) Mesmo raciocinio de criar_lote_expositor acima -- objeto novo,
-- service_role concedido explicitamente, sem depender de mecanismo
-- implicito.
grant execute on function public.editar_lote_expositor(uuid, date, integer, text) to service_role;


-- ============================================================
-- 4. public.corrigir_lote_expositor_concluido -- DROP
--    (uuid,integer,integer,text) + CREATE
--    (uuid,integer,integer,text,text default null)
-- ============================================================
-- p_observacao vai por ULTIMO (depois de p_motivo): Postgres exige que
-- todo parametro com DEFAULT venha depois de todos os parametros sem
-- default -- p_motivo continua sem default (permanece obrigatorio),
-- entao p_observacao (o unico com default nesta funcao) tem que ser o
-- ultimo da lista.

drop function if exists public.corrigir_lote_expositor_concluido(uuid, integer, integer, text);

create function public.corrigir_lote_expositor_concluido(
  p_lote_id uuid,
  p_quantidade_enviada integer,
  p_quantidade_retirada integer,
  p_motivo text,
  p_observacao text default null
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
  v_observacao_normalizada text;
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

  v_observacao_normalizada := nullif(btrim(p_observacao), '');

  update public.producao_expositor_lotes
  set quantidade_enviada = p_quantidade_enviada,
      quantidade_retirada = p_quantidade_retirada,
      observacao = v_observacao_normalizada
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

  -- (0032) Auditoria condicional de observacao, mesmo padrao dos demais
  -- campos -- so grava linha se o valor realmente mudou.
  if v_antes.observacao is distinct from v_depois.observacao then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('producao_expositor_lote', p_lote_id::text, 'corrigiu_concluido', 'observacao',
      v_antes.observacao, v_depois.observacao);
  end if;

  return v_depois;
end;
$$;

comment on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text) is
  '[0030, com 1 mudanca da 0032] Corrige quantidade_enviada/quantidade_retirada/observacao de um lote JA concluido, SEM alterar concluido_em/concluido_por/data_entrada/data_prevista_retirada (imutaveis). SOMENTE se o lote ja estiver concluido. Revalida a soma de quantidade_enviada dos demais lotes do mesmo lancamento + este novo valor contra quantidade_produzida. Exige producao_expositores.editar (RLS + trigger). p_motivo continua obrigatorio (justificativa de auditoria) e SEPARADO de p_observacao (0032, opcional -- dado operacional do lote, normalizada via nullif(btrim(p_observacao), string vazia)) -- nunca um substitui o outro. Snapshot em logs_auditoria (entidade=producao_expositor_lote) antes do UPDATE, incluindo linha condicional para observacao se ela mudou. SECURITY INVOKER. Assinatura NOVA (0032) -- a antiga de 4 parametros (sem observacao) foi excluida por esta mesma migration.';

revoke execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text) from public;
revoke execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text) from anon;
grant execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text) to authenticated;
-- (0032) Mesmo raciocinio das duas RPCs acima -- objeto novo,
-- service_role concedido explicitamente, sem depender de mecanismo
-- implicito.
grant execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text) to service_role;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto nenhum lote real tiver usado observacao nem o gate de
-- status. A partir do uso real, reverter para as assinaturas antigas
-- (sem observacao) DESTROI qualquer observacao ja gravada (a coluna
-- continua existindo -- so a RPC deixa de conseguir gravar/ler -- os
-- dados ja gravados nao somem fisicamente, mas ficam inacessiveis pelas
-- RPCs revertidas). Auditar antes:
-- SELECT count(*) FROM producao_expositor_lotes WHERE observacao IS NOT NULL;
-- BEGIN;
--
--   revoke execute on function public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text) from authenticated;
--   drop function if exists public.corrigir_lote_expositor_concluido(uuid, integer, integer, text, text);
--
--   -- Restaura a assinatura de 4 parametros (texto exato da 0030) --
--   -- copiar de supabase/migrations/0030_producao_expositores.sql,
--   -- secao 9, nao reescrever de memoria.
--
--   revoke execute on function public.editar_lote_expositor(uuid, date, integer, text) from authenticated;
--   drop function if exists public.editar_lote_expositor(uuid, date, integer, text);
--
--   -- Restaura a assinatura de 3 parametros (texto exato da 0030) --
--   -- copiar de supabase/migrations/0030_producao_expositores.sql,
--   -- secao 8.
--
--   revoke execute on function public.criar_lote_expositor(uuid, date, integer, text) from authenticated;
--   drop function if exists public.criar_lote_expositor(uuid, date, integer, text);
--
--   -- Restaura a assinatura de 3 parametros (texto exato da 0030) --
--   -- copiar de supabase/migrations/0030_producao_expositores.sql,
--   -- secao 7.
--
--   -- Restaura producao_expositor_lotes_protecao() para o texto exato
--   -- da 0030 (sem FOR UPDATE, sem observacao no gate pos-conclusao) --
--   -- copiar de supabase/migrations/0030_producao_expositores.sql,
--   -- secao 3.
--
-- COMMIT;
