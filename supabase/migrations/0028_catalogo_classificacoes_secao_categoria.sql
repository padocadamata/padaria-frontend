-- 0028_catalogo_classificacoes_secao_categoria.sql
-- Introduz cadastro estruturado para Secao e Categoria do Catalogo de
-- Produtos (public.produtos.secao/categoria sao hoje texto livre, sem
-- nenhuma tabela/enum por tras -- confirmado por auditoria das migrations
-- 0023/0024 e do frontend: DadosProdutoForm.js so usa <datalist> como
-- sugestao, nunca trava o usuario a uma lista fixa).
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita, E ate a pre-auditoria
-- (0028_pre_auditoria.sql, rodada manualmente pelo usuario) ser revisada.
--
-- NUMERACAO: 0027 esta RESERVADA por outra conversa em andamento
-- (reabertura de recebimento de Pedidos -- confirmado pela presenca de
-- "0027_pre_auditoria_EXECUTAR.sql" na raiz do repo, untracked, nao
-- pertencente a este trabalho). Por isso esta migration usa 0028, mesmo
-- 0027 ainda nao estando em supabase/migrations/ -- evita colisao de
-- numero entre as duas frentes de trabalho independentes. Pre-requisitos:
-- 0001..0026 ja aplicadas (a ultima migration hoje em
-- supabase/migrations/ e 0026_pedidos_recebimento_detalhado.sql). Se
-- 0027 (Pedidos) for aplicada primeiro, esta migration nao depende de
-- nada nela -- nenhuma tabela/coluna em comum.
--
-- ============================================================
-- ARQUITETURA -- decisao funcional confirmada pelo usuario
-- ============================================================
--   * Secoes e Categorias sao DOIS CADASTROS INDEPENDENTES -- SEM
--     hierarquia. Categoria NAO pertence a uma Secao nesta fase. Um
--     produto escolhe uma Secao e uma Categoria de forma independente
--     (ex.: Secao "Bebidas" + Categoria "Sucos"; Secao "Mercearia" +
--     Categoria "Sucos" tambem seria valido -- a mesma Categoria pode
--     conviver com mais de uma Secao, por design, nao por lacuna);
--   * ESTADO FINAL pretendido (apos o frontend ser adaptado, FORA do
--     escopo desta migration): produtos.secao_id/categoria_id passam a
--     ser a UNICA fonte que o frontend LE e ESCREVE -- os nomes exibidos
--     vem sempre de catalogo_secoes.nome/catalogo_categorias.nome via
--     join, nunca mais das colunas de texto livre. Isso elimina a
--     "segunda fonte de verdade concorrente" que o usuario apontou como
--     risco;
--   * TRANSICAO em 3 passos, dos quais esta migration e SOMENTE o
--     primeiro:
--       1. (ESTA MIGRATION) cria catalogo_secoes/catalogo_categorias +
--          RLS + RPCs de exclusao segura + colunas produtos.secao_id/
--          categoria_id (nullable, FK) + backfill determinístico a
--          partir das colunas de texto atuais. As colunas de texto
--          produtos.secao/produtos.categoria NAO SAO REMOVIDAS nem
--          alteradas -- continuam existindo, byte a byte, como estao
--          hoje, exclusivamente para SEGURANCA/ROLLBACK durante a
--          transicao (nao como fonte que o frontend volte a escrever);
--       2. (FRONTEND, sessao futura) telas passam a LER e ESCREVER
--          secao_id/categoria_id -- param de enviar produtos.secao/
--          categoria em qualquer payload de insert/update a partir desse
--          ponto. Esta migration NAO impoe isso via trigger/constraint no
--          banco (nenhum bloqueio de escrita foi pedido nas colunas de
--          texto) -- e um contrato de disciplina no frontend, o mesmo
--          padrao ja usado no projeto para "RLS e a autorizacao real, UI
--          e so UX", aqui invertido: a coluna de texto continua
--          gravavel no banco, mas o frontend, por contrato, para de
--          escrever nela;
--       3. (MIGRATION FUTURA, depois de validar producao) DROP de
--          produtos.secao/produtos.categoria, quando comprovadamente
--          seguro -- fora do escopo desta migration, so mencionado aqui
--          para registrar o plano.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * public.catalogo_secoes (nova) -- id, nome, timestamps. UNIQUE
--     funcional case-insensitive (lower(btrim(nome))), mesmo padrao ja
--     usado em produtos.codigo_g3 (0023) e receitas.codigo_g3 (0013);
--   * public.catalogo_categorias (nova) -- mesma estrutura, SEM NENHUMA
--     FK para catalogo_secoes -- decisao explicita, nao uma omissao;
--   * RLS + policies nas duas tabelas novas, reaproveitando EXATAMENTE os
--     codigos de permissao ja existentes (catalogo_produtos.visualizar
--     para SELECT, catalogo_produtos.editar para INSERT/UPDATE) -- NENHUM
--     codigo de permissao novo e criado;
--   * ZERO policy de DELETE nas duas tabelas novas -- mesmo padrao ja
--     estabelecido em produtos/produto_fornecedores/
--     produtos_historico_compras: exclusao SOMENTE via RPC SECURITY
--     DEFINER, nunca por supabase.from(...).delete() direto;
--   * backfill DETERMINISTICO de canonical casing: para cada valor
--     distinto (por lower(btrim(...))) hoje presente em
--     produtos.secao/categoria, cria UMA linha usando a grafia de maior
--     ocorrencia entre os produtos existentes (empate resolvido
--     alfabeticamente) -- variacoes que diferem SO por caixa/espaco de
--     borda sao consolidadas (ex.: "Bebidas"/"bebidas"/"BEBIDAS" viram
--     uma linha so); valores semanticamente diferentes (ex.: "Bebidas" x
--     "Refrigerantes") NUNCA sao fundidos -- cada chave lower(btrim(...))
--     distinta gera sua propria linha. Calculado inteiramente em SQL
--     nesta migration, sem precisar conhecer os valores reais de
--     antemao -- a pre-auditoria (0028_pre_auditoria.sql) mostra
--     exatamente o resultado esperado ANTES da execucao, para revisao;
--   * public.produtos.secao_id / categoria_id -- 2 colunas NOVAS,
--     NULLABLE, FK para as tabelas novas, ADICIONADAS AO LADO das
--     colunas de texto livre secao/categoria (que NAO sao removidas nem
--     alteradas nesta migration -- ver "ARQUITETURA" acima) -- mesmo
--     padrao conservador ja usado no projeto (nunca dropar coluna legada
--     na mesma migration que introduz a estrutura nova). Preenchidas por
--     backfill casando lower(btrim(produtos.secao)) =
--     lower(btrim(catalogo_secoes.nome)); indices simples em cada uma
--     (uso: filtro/checagem de "em uso" nas RPCs de exclusao, join ao
--     carregar a tabela do Catalogo -- adicao de baixo risco, pratica
--     padrao para colunas de FK);
--   * public.excluir_catalogo_secao(uuid) / excluir_catalogo_categoria(uuid)
--     -- RPCs SECURITY DEFINER, mesmo padrao de
--     excluir_produto_fornecedor/excluir_historico_compra_manual (0025):
--     exige sessao autenticada + catalogo_produtos.editar, bloqueia
--     exclusao se houver produto usando aquela secao_id/categoria_id
--     (informando a contagem exata na mensagem de erro, formato "Nao e
--     possivel excluir esta secao. Ela esta vinculada a N produto(s)."),
--     snapshot completo em logs_auditoria ANTES do DELETE, tudo na mesma
--     transacao. SEM CASCADE em nenhuma FK -- excluir uma secao/categoria
--     em uso e sempre bloqueado, NUNCA coloca produtos.secao_id em NULL
--     automaticamente;
--   * RENOMEAR (UPDATE catalogo_secoes.nome/catalogo_categorias.nome) e
--     uma operacao comum, ja coberta pela policy de UPDATE acima -- NAO
--     precisa de RPC dedicada. Como produtos.secao_id e uma FK (nao uma
--     copia do texto), um UPDATE do nome em catalogo_secoes reflete
--     IMEDIATAMENTE em qualquer SELECT futuro que faca join (ex.: "select
--     p.*, cs.nome as secao from produtos p join catalogo_secoes cs...")
--     sem tocar em nenhuma linha de produtos -- e exatamente a garantia
--     que elimina o problema de "atualizar produto por produto" ao
--     renomear.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma remocao/alteracao das colunas de texto livre
--     produtos.secao/produtos.categoria -- continuam existindo,
--     exatamente como estao, sem trim/normalizacao automatica nelas.
--     Remocao fica para uma migration FUTURA, depois de validar producao
--     (passo 3 do plano de transicao acima);
--   * nenhum trigger/constraint que bloqueie escrita nas colunas de texto
--     -- a garantia de "nao escrever mais" e um contrato de frontend
--     (passo 2 do plano), nao um mecanismo de banco nesta migration. Ver
--     "RISCO" no relatorio de entrega para essa troca explicita;
--   * nenhum UPDATE que altere secao_id/categoria_id de um produto para
--     um valor diferente do que o backfill calcular -- reclassificacao
--     manual fica para a UI futura (fora de escopo desta migration);
--   * nenhuma FK entre catalogo_secoes e catalogo_categorias -- decisao
--     explicita do usuario, nao uma hierarquia por suposicao;
--   * nenhum NOT NULL em produtos.secao_id/categoria_id -- ambos ficam
--     NULL para qualquer produto cujo secao/categoria atual seja NULL ou
--     vazio, e permanecem NULL mesmo apos o backfill se, por qualquer
--     motivo, nenhuma linha correspondente for encontrada;
--   * nenhum ON DELETE CASCADE nem ON DELETE SET NULL nas FKs
--     secao_id/categoria_id -- a unica forma de excluir uma
--     secao/categoria em uso e bloqueada pela RPC, e a FK por padrao
--     (ON DELETE NO ACTION/RESTRICT implicito) reforca isso mesmo se
--     algo tentasse um DELETE direto (que ja nao teria policy que
--     autorize);
--   * nenhuma alteracao de frontend -- a UI de "Gerenciar classificacoes"
--     (modal), a conversao dos inputs de Secao/Categoria para selects
--     governados (edicao inline, cadastro, /catalogo/[id]) ficam para
--     depois desta migration ser executada e revisada, nao fazem parte
--     deste arquivo;
--   * nenhum cadastro estruturado de unidade-base -- fora de escopo
--     deste round, por pedido explicito;
--   * nenhuma alteracao em nenhuma outra tabela/policy/trigger/RPC do
--     projeto, nenhum codigo de permissao novo.

BEGIN;

-- ============================================================
-- 1. public.catalogo_secoes (nova)
-- ============================================================
create table if not exists public.catalogo_secoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  alter table public.catalogo_secoes
    add constraint catalogo_secoes_nome_nao_vazio_check
    check (btrim(nome) <> '');
exception
  when duplicate_object then null;
end $$;

create unique index if not exists catalogo_secoes_nome_normalizado_idx
  on public.catalogo_secoes (lower(btrim(nome)));

comment on table public.catalogo_secoes is
  'Cadastro estruturado de Secoes do Catalogo de Produtos (migration 0028). Independente de catalogo_categorias -- nenhuma FK entre elas, decisao explicita de nao ter hierarquia Secao->Categoria. Nome unico case-insensitive (lower(btrim(nome))), mesmo padrao de produtos.codigo_g3. Fonte de verdade pretendida para produtos.secao_id -- produtos.secao (texto livre) e mantida apenas como legado transitorio, ver comentario na coluna.';

alter table public.catalogo_secoes enable row level security;

create policy catalogo_secoes_select on public.catalogo_secoes
  for select to authenticated
  using ((select public.has_permissao('catalogo_produtos.visualizar')));

create policy catalogo_secoes_insert on public.catalogo_secoes
  for insert to authenticated
  with check ((select public.has_permissao('catalogo_produtos.editar')));

create policy catalogo_secoes_update on public.catalogo_secoes
  for update to authenticated
  using ((select public.has_permissao('catalogo_produtos.editar')))
  with check ((select public.has_permissao('catalogo_produtos.editar')));

-- Zero policy de DELETE -- exclusao SOMENTE via excluir_catalogo_secao()
-- (secao 6 abaixo), mesmo padrao de produtos/produto_fornecedores.


-- ============================================================
-- 2. public.catalogo_categorias (nova)
-- ============================================================
create table if not exists public.catalogo_categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  alter table public.catalogo_categorias
    add constraint catalogo_categorias_nome_nao_vazio_check
    check (btrim(nome) <> '');
exception
  when duplicate_object then null;
end $$;

create unique index if not exists catalogo_categorias_nome_normalizado_idx
  on public.catalogo_categorias (lower(btrim(nome)));

comment on table public.catalogo_categorias is
  'Cadastro estruturado de Categorias do Catalogo de Produtos (migration 0028). Independente de catalogo_secoes -- ver comentario em catalogo_secoes. Nome unico case-insensitive (lower(btrim(nome))). Uma Categoria NAO pertence a uma Secao especifica -- pode coexistir com produtos de qualquer Secao.';

alter table public.catalogo_categorias enable row level security;

create policy catalogo_categorias_select on public.catalogo_categorias
  for select to authenticated
  using ((select public.has_permissao('catalogo_produtos.visualizar')));

create policy catalogo_categorias_insert on public.catalogo_categorias
  for insert to authenticated
  with check ((select public.has_permissao('catalogo_produtos.editar')));

create policy catalogo_categorias_update on public.catalogo_categorias
  for update to authenticated
  using ((select public.has_permissao('catalogo_produtos.editar')))
  with check ((select public.has_permissao('catalogo_produtos.editar')));

-- Zero policy de DELETE -- exclusao SOMENTE via excluir_catalogo_categoria().


-- ============================================================
-- 3. Backfill deterministico de canonical casing -- catalogo_secoes
-- ============================================================
-- Para cada valor distinto (por lower(btrim(...))) hoje em produtos.secao,
-- usa a grafia de maior ocorrencia entre os produtos existentes; empate
-- resolvido alfabeticamente (ordem determinista, sem depender de qual
-- linha o Postgres visitar primeiro). Chaves lower(btrim(...))
-- DIFERENTES nunca sao fundidas -- cada uma vira sua propria linha,
-- mesmo que pareçam relacionadas (ex.: "Bebida" e "Bebidas" ficam
-- SEPARADAS, por serem chaves distintas -- so caixa/espaco de borda e
-- tratado como equivalente, nunca variacao de palavra).
with contagens as (
  select btrim(secao) as valor, lower(btrim(secao)) as chave, count(*) as qtd
  from public.produtos
  where secao is not null and btrim(secao) <> ''
  group by btrim(secao)
),
ranqueado as (
  select chave, valor,
         row_number() over (partition by chave order by qtd desc, valor asc) as rn
  from contagens
)
insert into public.catalogo_secoes (nome)
select valor from ranqueado where rn = 1
on conflict do nothing;


-- ============================================================
-- 4. Backfill deterministico de canonical casing -- catalogo_categorias
-- ============================================================
with contagens as (
  select btrim(categoria) as valor, lower(btrim(categoria)) as chave, count(*) as qtd
  from public.produtos
  where categoria is not null and btrim(categoria) <> ''
  group by btrim(categoria)
),
ranqueado as (
  select chave, valor,
         row_number() over (partition by chave order by qtd desc, valor asc) as rn
  from contagens
)
insert into public.catalogo_categorias (nome)
select valor from ranqueado where rn = 1
on conflict do nothing;


-- ============================================================
-- 5. public.produtos -- novas colunas secao_id/categoria_id (nullable,
--    ao lado das colunas de texto livre existentes, que NAO mudam)
-- ============================================================
alter table public.produtos
  add column if not exists secao_id uuid references public.catalogo_secoes(id),
  add column if not exists categoria_id uuid references public.catalogo_categorias(id);

comment on column public.produtos.secao_id is
  'FK opcional para catalogo_secoes (migration 0028) -- fonte de verdade pretendida para a Secao do produto a partir do momento em que o frontend for adaptado para le-la/escreve-la. Preenchida por backfill casando lower(btrim(secao)) no momento desta migration -- NAO mantida automaticamente sincronizada com produtos.secao depois disso (nenhum trigger). ON DELETE padrao (RESTRICT/NO ACTION) -- nunca vira NULL automaticamente por exclusao de uma secao (a RPC de exclusao ja bloqueia isso antes).';

comment on column public.produtos.categoria_id is
  'FK opcional para catalogo_categorias (migration 0028). Mesmo mecanismo de backfill e mesma ressalva de secao_id.';

comment on column public.produtos.secao is
  'LEGADO -- texto livre pre-migration 0028, mantido apenas para seguranca/rollback durante a transicao para secao_id. Por contrato de frontend (nao por bloqueio de banco), deixa de ser escrita a partir do momento em que a tela do Catalogo passar a usar secao_id -- ver plano de transicao no cabecalho da migration 0028. Candidata a DROP em uma migration futura, apos validacao em producao.';

comment on column public.produtos.categoria is
  'LEGADO -- mesma situacao de produtos.secao, ver comentario la. Candidata a DROP em uma migration futura, apos validacao em producao.';

create index if not exists produtos_secao_id_idx on public.produtos (secao_id);
create index if not exists produtos_categoria_id_idx on public.produtos (categoria_id);

update public.produtos p
set secao_id = cs.id
from public.catalogo_secoes cs
where p.secao_id is null
  and p.secao is not null
  and lower(btrim(p.secao)) = lower(btrim(cs.nome));

update public.produtos p
set categoria_id = cc.id
from public.catalogo_categorias cc
where p.categoria_id is null
  and p.categoria is not null
  and lower(btrim(p.categoria)) = lower(btrim(cc.nome));


-- ============================================================
-- 6. RPCs de exclusao segura -- mesmo padrao de excluir_produto_fornecedor/
--    excluir_historico_compra_manual (migration 0025). SEM CASCADE, NUNCA
--    coloca produtos.secao_id/categoria_id em NULL automaticamente --
--    bloqueia a exclusao enquanto houver produto vinculado.
-- ============================================================
create or replace function public.excluir_catalogo_secao(p_secao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro public.catalogo_secoes;
  v_em_uso integer;
begin
  if auth.uid() is null then
    raise exception 'excluir_catalogo_secao: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.editar')) then
    raise exception
      'excluir_catalogo_secao: requer a permissao catalogo_produtos.editar.';
  end if;

  select * into v_registro
  from public.catalogo_secoes
  where id = p_secao_id;

  if v_registro.id is null then
    raise exception 'excluir_catalogo_secao: secao % nao encontrada.', p_secao_id;
  end if;

  select count(*) into v_em_uso
  from public.produtos
  where secao_id = p_secao_id;

  if v_em_uso > 0 then
    raise exception
      'Nao e possivel excluir esta secao. Ela esta vinculada a % produto(s).',
      v_em_uso;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('catalogo_secao', p_secao_id::text, 'excluiu', 'nome', v_registro.nome, null),
    ('catalogo_secao', p_secao_id::text, 'excluiu', 'criado_em', v_registro.criado_em::text, null);

  delete from public.catalogo_secoes where id = p_secao_id;
end;
$$;

comment on function public.excluir_catalogo_secao(uuid) is
  'Exclui definitivamente uma Secao do catalogo estruturado, SOMENTE se nenhum produto a estiver usando (produtos.secao_id) -- bloqueia informando a contagem exata caso contrario, sem CASCADE e sem colocar produtos.secao_id em NULL. RPC-only por desenho: NENHUMA policy de DELETE existe em catalogo_secoes. Exige sessao autenticada + catalogo_produtos.editar. Snapshot completo em logs_auditoria antes do DELETE, mesma transacao. Nao mexe na coluna de texto livre produtos.secao de nenhum produto.';

revoke execute on function public.excluir_catalogo_secao(uuid) from public;
revoke execute on function public.excluir_catalogo_secao(uuid) from anon;
grant execute on function public.excluir_catalogo_secao(uuid) to authenticated;


create or replace function public.excluir_catalogo_categoria(p_categoria_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro public.catalogo_categorias;
  v_em_uso integer;
begin
  if auth.uid() is null then
    raise exception 'excluir_catalogo_categoria: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.editar')) then
    raise exception
      'excluir_catalogo_categoria: requer a permissao catalogo_produtos.editar.';
  end if;

  select * into v_registro
  from public.catalogo_categorias
  where id = p_categoria_id;

  if v_registro.id is null then
    raise exception 'excluir_catalogo_categoria: categoria % nao encontrada.', p_categoria_id;
  end if;

  select count(*) into v_em_uso
  from public.produtos
  where categoria_id = p_categoria_id;

  if v_em_uso > 0 then
    raise exception
      'Nao e possivel excluir esta categoria. Ela esta vinculada a % produto(s).',
      v_em_uso;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('catalogo_categoria', p_categoria_id::text, 'excluiu', 'nome', v_registro.nome, null),
    ('catalogo_categoria', p_categoria_id::text, 'excluiu', 'criado_em', v_registro.criado_em::text, null);

  delete from public.catalogo_categorias where id = p_categoria_id;
end;
$$;

comment on function public.excluir_catalogo_categoria(uuid) is
  'Exclui definitivamente uma Categoria do catalogo estruturado, SOMENTE se nenhum produto a estiver usando (produtos.categoria_id). Mesmo padrao de excluir_catalogo_secao -- sem CASCADE, sem NULL automatico.';

revoke execute on function public.excluir_catalogo_categoria(uuid) from public;
revoke execute on function public.excluir_catalogo_categoria(uuid) from anon;
grant execute on function public.excluir_catalogo_categoria(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro para rodar mesmo depois de produtos novos terem sido cadastrados
-- com secao_id/categoria_id preenchidos -- as colunas voltam a nao
-- existir, mas as colunas de texto livre secao/categoria (nunca tocadas
-- por esta migration) preservam a informacao original.
-- BEGIN;
--
--   revoke execute on function public.excluir_catalogo_categoria(uuid) from authenticated;
--   drop function if exists public.excluir_catalogo_categoria(uuid);
--
--   revoke execute on function public.excluir_catalogo_secao(uuid) from authenticated;
--   drop function if exists public.excluir_catalogo_secao(uuid);
--
--   drop index if exists public.produtos_categoria_id_idx;
--   drop index if exists public.produtos_secao_id_idx;
--
--   alter table public.produtos drop column if exists categoria_id;
--   alter table public.produtos drop column if exists secao_id;
--
--   drop table if exists public.catalogo_categorias;
--   drop table if exists public.catalogo_secoes;
--
-- COMMIT;
