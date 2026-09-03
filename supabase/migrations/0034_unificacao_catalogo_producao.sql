-- 0034_unificacao_catalogo_producao.sql
-- Primeira migration estrutural da unificacao Catalogo x Producao.
-- Adiciona public.receitas.catalogo_produto_id (nullable, UNIQUE, FK
-- para public.produtos(id) ON DELETE RESTRICT) e faz o backfill
-- determinístico das 30 receitas existentes para os 30 produtos
-- correspondentes, usando o criterio ESTRITO pedido (nome + codigo_g3
-- literais, sem normalizacao). NAO aplica NOT NULL. NAO cria RPC. NAO
-- altera excluir_produto_catalogo. NAO altera frontend. NAO toca em
-- nenhuma FK historica de receitas.id.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita. Numeracao 0034 confirmada livre
-- (ultima migration publicada e 0033_saneamento_catalogo_producao.sql).
--
-- ============================================================
-- BASE DA AUDITORIA -- resultado real colado pelo usuario apos rodar
-- 0034_pre_auditoria_unificacao_catalogo_producao_EXECUTAR.sql:
-- ============================================================
--   * total_produtos = 395, total_receitas = 30, receitas_ativas = 30,
--     receitas_inativas = 0.
--   * Correspondencia por nome normalizado: 30 com 1 match, 0 sem
--     match, 0 com multiplos match, 30 produtos distintos.
--   * Nos 30 pares: nomes literalmente iguais = 30 (nao so
--     normalizados); codigo_g3 iguais = 30; codigo_g3 diferentes = 0;
--     codigo_g3 NULL de um lado = 0; ambos NULL = 0.
--   * unidade_medida_saida = NULL nas 30 receitas; produtos.
--     unidade_medida preenchida nos 30 -- por isso NENHUMA acao sobre
--     unidade de medida nesta migration (nao preencher, nao
--     sincronizar, nao fundir).
--   * Schema de receitas confirmado com 18 colunas (information_schema,
--     bloco A da pre-auditoria).
--   * producao_diaria confirmada: receita_id uuid NOT NULL, FK
--     producao_diaria_receita_id_fkey -> receitas(id),
--     UNIQUE(data, receita_id), indice em receita_id. 0 linhas hoje,
--     mas a FK e real e faz parte das dependencias historicas de
--     receitas.id, preservada intocada por esta migration.
--   * Todas as FKs historicas de receitas.id reconfirmadas intactas:
--     planejamento_producao.receita_id, producao_diaria.receita_id,
--     producao_registros.receita_id, receita_ingredientes.receita_id.
--   * Exemplos reais de dependencia (fotografia, nao alterada por esta
--     migration): PAO FRANCES com 142 producao_registros e 24
--     planejamento_producao; BOLO FATIA CAMADAS com 1 producao_registro
--     e 1 lote de expositor indireto.
--
-- ============================================================
-- CRITERIO DE VINCULO -- DECISAO DO USUARIO (mais restritivo que a
-- correspondencia por nome normalizado usada na auditoria):
-- ============================================================
-- produtos.nome = receitas.nome AND produtos.codigo_g3 = receitas.
-- codigo_g3, comparacao LITERAL (sem normalizacao, sem UPPER, sem
-- btrim). Como a auditoria real confirmou os 30 pares com nome
-- literalmente igual E codigo_g3 literalmente igual (nenhum NULL),
-- este criterio produz o MESMO conjunto de 30 pares que a
-- correspondencia por nome normalizado, mas de forma mais restritiva e
-- mais segura para uma migration one-time (2 colunas concordando,
-- nao 1). A guarda 4 abaixo confirma isso explicitamente ANTES do
-- UPDATE, nao so assume.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * 1 ALTER TABLE ADD COLUMN (receitas.catalogo_produto_id uuid,
--     nullable, sem default);
--   * 1 ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY (nomeada
--     receitas_catalogo_produto_id_fkey, ON DELETE RESTRICT);
--   * 1 ALTER TABLE ADD CONSTRAINT ... UNIQUE (nomeada
--     receitas_catalogo_produto_id_key);
--   * 1 UPDATE, SOMENTE da coluna catalogo_produto_id, SOMENTE nas 30
--     receitas existentes, pelo criterio estrito acima.
--
-- Esta e a UNICA operacao de escrita desta migration -- nenhum outro
-- UPDATE, nenhum INSERT, nenhum DELETE, em nenhuma tabela, em nenhum
-- ponto do arquivo. Isso e verificavel por leitura direta do arquivo
-- (grep por "insert into\|delete from\|update " fora do UPDATE acima
-- deve retornar vazio) e e usado como parte da prova de integridade
-- nas pos-condicoes (secao 6).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * NOT NULL em catalogo_produto_id (fica para migration futura,
--     separada, so depois que o frontend parar de criar receitas sem
--     produto);
--   * nenhuma alteracao em receitas.nome, receitas.codigo_g3,
--     receitas.unidade_medida_saida, receitas.ativo ou qualquer outro
--     campo operacional -- todos preservados byte a byte;
--   * nenhuma alteracao em receitas.id (nunca e lido para escrita,
--     nunca aparece do lado esquerdo de um SET);
--   * nenhuma alteracao em nenhuma linha de public.produtos (a tabela
--     so e LIDA, via "from public.produtos p" no UPDATE -- nenhum
--     INSERT/UPDATE/DELETE a tem como alvo em nenhum ponto do arquivo);
--   * nenhuma alteracao em producao_registros, planejamento_producao,
--     producao_diaria, receita_ingredientes, producao_expositor_lotes
--     -- nenhuma dessas tabelas e sequer referenciada neste arquivo;
--   * nenhuma RPC nova, nenhuma alteracao em excluir_produto_catalogo,
--     nenhuma alteracao de frontend, nenhuma normalizacao UPPER.
--
-- IRREVERSIVEL PARCIALMENTE: a ALTER TABLE (coluna + constraints) e
-- reversivel via DROP (ver ROLLBACK no final, comentado, nao
-- executado). O UPDATE do backfill tambem e reversivel (basta voltar
-- catalogo_produto_id para NULL) -- ao contrario de um DELETE, nao ha
-- perda de dado nem em teoria.

BEGIN;

-- ============================================================
-- PASSO 1 -- GUARDAS PREVIAS (somente leitura, nenhuma escrita ainda).
-- Qualquer falha aqui aborta a transacao inteira antes de qualquer
-- ALTER TABLE ou UPDATE.
-- ============================================================
do $$
declare
  v_total_receitas              int;
  v_total_produtos               int;
  v_qtd_1_match_norm              int;
  v_qtd_0_match_norm               int;
  v_qtd_multi_match_norm            int;
  v_qtd_produtos_distintos_norm      int;
  v_qtd_nomes_literais_iguais         int;
  v_qtd_g3_iguais                      int;
  v_qtd_g3_divergente                   int;
  v_qtd_pares_estritos                   int;
  v_qtd_produtos_distintos_estrito        int;
  v_qtd_receitas_distintas_estrito         int;
begin
  -- Guarda 0: as duas tabelas existem.
  if to_regclass('public.receitas') is null then
    raise exception 'unificacao: tabela public.receitas nao existe -- abortando.';
  end if;
  if to_regclass('public.produtos') is null then
    raise exception 'unificacao: tabela public.produtos nao existe -- abortando.';
  end if;

  -- Guarda 1: a coluna ainda NAO existe (evita reexecucao acidental
  -- desta migration sobre um banco onde ela ja foi aplicada).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'receitas'
      and column_name = 'catalogo_produto_id'
  ) then
    raise exception 'unificacao: receitas.catalogo_produto_id ja existe -- abortando, esta migration ja pode ter sido aplicada.';
  end if;

  -- Guarda 2: totais objetivos confirmados pela pre-auditoria real.
  select count(*) into v_total_receitas from public.receitas;
  if v_total_receitas <> 30 then
    raise exception 'unificacao: total de receitas e %, esperado exatamente 30 -- abortando, situacao mudou desde a pre-auditoria.', v_total_receitas;
  end if;

  select count(*) into v_total_produtos from public.produtos;
  if v_total_produtos <> 395 then
    raise exception 'unificacao: total de produtos e %, esperado exatamente 395 -- abortando, situacao mudou desde a pre-auditoria.', v_total_produtos;
  end if;

  -- Guarda 3: reconfirma a correspondencia por NOME NORMALIZADO (a
  -- mesma checagem da pre-auditoria), agora no momento real da
  -- migration -- nao reaproveita cegamente o resultado ja colado.
  with receitas_norm as (
    select id, lower(btrim(nome)) as chave from public.receitas
  ),
  produtos_norm as (
    select id, lower(btrim(nome)) as chave from public.produtos
  ),
  correspondencia as (
    select r.id, count(p.id) as qtd
    from receitas_norm r
    left join produtos_norm p on p.chave = r.chave
    group by r.id
  )
  select
    count(*) filter (where qtd = 1),
    count(*) filter (where qtd = 0),
    count(*) filter (where qtd > 1)
  into v_qtd_1_match_norm, v_qtd_0_match_norm, v_qtd_multi_match_norm
  from correspondencia;

  if v_qtd_1_match_norm <> 30 or v_qtd_0_match_norm <> 0 or v_qtd_multi_match_norm <> 0 then
    raise exception 'unificacao: correspondencia por nome normalizado mudou (1_match=%, 0_match=%, multi_match=%), esperado (30,0,0) -- abortando.',
      v_qtd_1_match_norm, v_qtd_0_match_norm, v_qtd_multi_match_norm;
  end if;

  select count(distinct p.id) into v_qtd_produtos_distintos_norm
  from public.receitas r
  join public.produtos p on lower(btrim(p.nome)) = lower(btrim(r.nome));
  if v_qtd_produtos_distintos_norm <> 30 then
    raise exception 'unificacao: produtos distintos correspondentes (nome normalizado) = %, esperado exatamente 30 -- abortando.', v_qtd_produtos_distintos_norm;
  end if;

  -- Guarda 3b: reconfirma nome literal e codigo_g3 nos 30 pares
  -- (mesma checagem da Auditoria E da pre-auditoria).
  select
    count(*) filter (where r.nome = p.nome),
    count(*) filter (where r.codigo_g3 is not null and p.codigo_g3 is not null and r.codigo_g3 = p.codigo_g3),
    count(*) filter (where (r.codigo_g3 is null) <> (p.codigo_g3 is null) or (r.codigo_g3 is not null and p.codigo_g3 is not null and r.codigo_g3 <> p.codigo_g3))
  into v_qtd_nomes_literais_iguais, v_qtd_g3_iguais, v_qtd_g3_divergente
  from public.receitas r
  join public.produtos p on lower(btrim(p.nome)) = lower(btrim(r.nome));

  if v_qtd_nomes_literais_iguais <> 30 then
    raise exception 'unificacao: nomes literalmente iguais = %, esperado exatamente 30 -- abortando.', v_qtd_nomes_literais_iguais;
  end if;
  if v_qtd_g3_iguais <> 30 then
    raise exception 'unificacao: codigo_g3 literalmente iguais = %, esperado exatamente 30 -- abortando.', v_qtd_g3_iguais;
  end if;
  if v_qtd_g3_divergente <> 0 then
    raise exception 'unificacao: % par(es) com codigo_g3 divergente ou NULL de um lado -- abortando.', v_qtd_g3_divergente;
  end if;

  -- Guarda 4: o CRITERIO ESTRITO que sera usado no UPDATE (nome +
  -- codigo_g3, literal) produz, JA AGORA, exatamente 30 pares, 30
  -- produtos distintos e 30 receitas distintas -- validado ANTES de
  -- qualquer escrita, nao apos.
  with pares_estritos as (
    select r.id as receita_id, p.id as produto_id
    from public.receitas r
    join public.produtos p on p.nome = r.nome and p.codigo_g3 = r.codigo_g3
  )
  select count(*), count(distinct produto_id), count(distinct receita_id)
  into v_qtd_pares_estritos, v_qtd_produtos_distintos_estrito, v_qtd_receitas_distintas_estrito
  from pares_estritos;

  if v_qtd_pares_estritos <> 30 then
    raise exception 'unificacao: criterio estrito (nome+codigo_g3) produziu % par(es), esperado exatamente 30 -- abortando.', v_qtd_pares_estritos;
  end if;
  if v_qtd_produtos_distintos_estrito <> 30 then
    raise exception 'unificacao: criterio estrito produziu % produto(s) distinto(s), esperado exatamente 30 (indica produto correspondendo a mais de uma receita) -- abortando.', v_qtd_produtos_distintos_estrito;
  end if;
  if v_qtd_receitas_distintas_estrito <> 30 then
    raise exception 'unificacao: criterio estrito produziu % receita(s) distinta(s), esperado exatamente 30 (indica receita correspondendo a mais de um produto) -- abortando.', v_qtd_receitas_distintas_estrito;
  end if;

  raise notice 'unificacao: todas as guardas previas passaram (receitas=30, produtos=395, correspondencia normalizada 30/0/0, nomes/codigo_g3 30/30/0 divergentes, criterio estrito 30 pares/30/30 distintos). Prosseguindo com a alteracao estrutural.';
end $$;


-- ============================================================
-- PASSO 2 -- ALTERACAO ESTRUTURAL. DDL simples, fora de bloco PL/pgSQL
-- (evita qualquer ambiguidade de suporte a DDL dentro de DO). Se
-- qualquer um destes 3 comandos falhar, a transacao inteira aborta e
-- nenhum dos posteriores roda -- comportamento padrao de BEGIN/COMMIT.
-- ============================================================

alter table public.receitas
  add column catalogo_produto_id uuid;

alter table public.receitas
  add constraint receitas_catalogo_produto_id_fkey
  foreign key (catalogo_produto_id)
  references public.produtos(id)
  on delete restrict;

alter table public.receitas
  add constraint receitas_catalogo_produto_id_key
  unique (catalogo_produto_id);


-- ============================================================
-- PASSO 3 -- BACKFILL determinístico das 30 receitas + assert de
-- linhas afetadas.
-- ============================================================
do $$
declare
  v_atualizado int;
begin
  update public.receitas r
  set catalogo_produto_id = p.id
  from public.produtos p
  where p.nome = r.nome
    and p.codigo_g3 = r.codigo_g3;

  get diagnostics v_atualizado = row_count;

  if v_atualizado <> 30 then
    raise exception 'unificacao: backfill atualizou % linha(s), esperado exatamente 30 -- abortando.', v_atualizado;
  end if;

  raise notice 'unificacao: backfill atualizou exatamente 30 receitas.';
end $$;


-- ============================================================
-- PASSO 4 -- POS-CONDICOES DURAS. Qualquer falha aqui aborta a
-- transacao inteira (o ALTER TABLE e o UPDATE do backfill sao
-- desfeitos junto, nao ficam parcialmente aplicados).
-- ============================================================
do $$
declare
  v_total_receitas_depois     int;
  v_total_produtos_depois      int;
  v_qtd_preenchidas             int;
  v_qtd_null                     int;
  v_qtd_distintos                 int;
  v_qtd_orfa                       int;
  v_qtd_mismatch                    int;
begin
  select count(*) into v_total_receitas_depois from public.receitas;
  if v_total_receitas_depois <> 30 then
    raise exception 'unificacao: total de receitas apos a migration e %, esperado 30 (nenhuma linha deveria ter sido criada/excluida -- esta migration nao contem nenhum INSERT/DELETE em receitas) -- abortando.', v_total_receitas_depois;
  end if;

  select count(*) into v_total_produtos_depois from public.produtos;
  if v_total_produtos_depois <> 395 then
    raise exception 'unificacao: total de produtos apos a migration e %, esperado 395 (esta migration nao contem nenhum INSERT/UPDATE/DELETE em produtos) -- abortando.', v_total_produtos_depois;
  end if;

  select count(*) filter (where catalogo_produto_id is not null),
         count(*) filter (where catalogo_produto_id is null),
         count(distinct catalogo_produto_id) filter (where catalogo_produto_id is not null)
  into v_qtd_preenchidas, v_qtd_null, v_qtd_distintos
  from public.receitas;

  if v_qtd_preenchidas <> 30 then
    raise exception 'unificacao: % receita(s) com catalogo_produto_id preenchido, esperado exatamente 30 -- abortando.', v_qtd_preenchidas;
  end if;
  if v_qtd_null <> 0 then
    raise exception 'unificacao: % receita(s) ainda com catalogo_produto_id NULL, esperado 0 -- abortando.', v_qtd_null;
  end if;
  if v_qtd_distintos <> 30 then
    raise exception 'unificacao: catalogo_produto_id distintos = %, esperado exatamente 30 (nenhuma duplicidade de vinculo) -- abortando.', v_qtd_distintos;
  end if;

  -- Defesa extra (o FK ja garante isto estruturalmente -- checagem
  -- explicita, mesmo padrao de reverificacao ja usado no saneamento
  -- 0033): nenhum catalogo_produto_id aponta para um produto
  -- inexistente.
  select count(*) into v_qtd_orfa
  from public.receitas r
  where r.catalogo_produto_id is not null
    and not exists (select 1 from public.produtos p where p.id = r.catalogo_produto_id);
  if v_qtd_orfa <> 0 then
    raise exception 'unificacao: % catalogo_produto_id nao referenciam nenhum produto existente -- abortando (nao deveria ser possivel dado o FK RESTRICT).', v_qtd_orfa;
  end if;

  -- Reverificacao explicita: para as 30 vinculadas, nome e codigo_g3
  -- continuam batendo (redundante com o WHERE do UPDATE, mas
  -- reverificado explicitamente, mesmo espirito do saneamento 0033).
  select count(*) into v_qtd_mismatch
  from public.receitas r
  join public.produtos p on p.id = r.catalogo_produto_id
  where r.nome is distinct from p.nome
     or r.codigo_g3 is distinct from p.codigo_g3;
  if v_qtd_mismatch <> 0 then
    raise exception 'unificacao: % receita(s) vinculada(s) a um produto com nome/codigo_g3 diferente -- abortando.', v_qtd_mismatch;
  end if;

  raise notice 'unificacao concluida e validada: 30 receitas, 30 catalogo_produto_id preenchidos, 30 distintos, zero NULL, zero orfa, zero mismatch. 395 produtos inalterados.';
end $$;

COMMIT;

-- ============================================================
-- ROLLBACK (NAO EXECUTAR -- documentado para referencia futura)
-- ============================================================
-- Esta migration e ADITIVA + 1 UPDATE reversivel (nunca um DELETE) --
-- ao contrario do saneamento 0033, ela PODE ser desfeita por SQL:
--
-- BEGIN;
--
--   -- desfaz o backfill primeiro (senao a UNIQUE/FK impediriam o
--   -- DROP COLUMN de qualquer forma, mas por clareza o backfill e
--   -- desfeito antes das constraints):
--   update public.receitas set catalogo_produto_id = null;
--
--   alter table public.receitas drop constraint if exists receitas_catalogo_produto_id_key;
--   alter table public.receitas drop constraint if exists receitas_catalogo_produto_id_fkey;
--   alter table public.receitas drop column if exists catalogo_produto_id;
--
-- COMMIT;
--
-- Seguro mesmo depois de a coluna ja estar em uso por frontend/RPCs
-- futuras -- SOMENTE se nenhuma dessas RPCs/telas ainda tiver sido
-- publicada (este rollback nao existe nesta rodada, e so referencia
-- documentada; nao remove nenhuma FK historica de receitas.id, nem
-- toca em producao_registros/planejamento_producao/producao_diaria/
-- receita_ingredientes/producao_expositor_lotes -- nenhuma delas e
-- tocada por esta migration em nenhum sentido).
