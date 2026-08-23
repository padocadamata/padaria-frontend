-- 0013_receitas_codigo_g3.sql
-- Vínculo opcional entre uma receita e o código correspondente no sistema
-- G3. Texto livre, sem FK (não existe tabela de códigos G3 no projeto) e
-- sem vínculo por nome — a ligação é sempre por este código, nunca por
-- casamento textual de nome de receita.

BEGIN;

alter table public.receitas
  add column if not exists codigo_g3 text;

-- Nullable: receitas antigas ou ainda não cadastradas no G3 continuam sem
-- exigir preenchimento. Quando preenchido, não pode ser string vazia/só
-- espaços (mesmo padrão de receitas_rendimento_unidade_coerentes_check em
-- 0012) — a interface deve normalizar (trim) antes de enviar, mas o CHECK
-- garante a regra também para quem escrever direto no banco.
do $$
begin
  alter table public.receitas
    add constraint receitas_codigo_g3_nao_vazio_check
    check (codigo_g3 is null or btrim(codigo_g3) <> '');
exception
  when duplicate_object then null;
end $$;

-- Único FUNCIONAL parcial: impede duas receitas com o mesmo codigo_g3,
-- tratando maiúscula/minúscula e espaços de borda como equivalentes (ex.:
-- "ABC123", "abc123" e " ABC123 " colidem entre si). NULL é ignorado pela
-- semântica padrão de índice único do Postgres — a cláusula WHERE aqui é
-- redundante com isso, mas deixada explícita por clareza/consistência com
-- o restante do projeto (ex.: receita_ingredientes_unico_ativo_idx em
-- 0012). O CHECK acima já impede string vazia/só-espaços entre os valores
-- não nulos, então o índice não precisa repetir esse predicado.
create unique index if not exists receitas_codigo_g3_unico_idx
  on public.receitas (lower(btrim(codigo_g3)))
  where codigo_g3 is not null;

comment on column public.receitas.codigo_g3 is
  'Código correspondente da receita no sistema G3. Nullable — não obrigatório para receitas antigas ou ainda não cadastradas no G3. Vínculo é só por este código, nunca por nome. Unicidade é case-insensitive e ignora espaços de borda (ver receitas_codigo_g3_unico_idx: lower(btrim(codigo_g3))) — "ABC123" e "abc123" são tratados como o mesmo código.';

comment on index public.receitas_codigo_g3_unico_idx is
  'Único funcional sobre lower(btrim(codigo_g3)), ignorando NULL: impede duas receitas com o mesmo código G3 mesmo com diferença de maiúscula/minúscula ou espaços de borda.';

-- Nenhuma alteração de RLS necessária: receitas_select_authenticated /
-- receitas_insert_admin / receitas_update_admin já cobrem a linha inteira
-- (RLS é por linha, não por coluna) — mesmo raciocínio já registrado em
-- 0012 para as 3 colunas daquela migration.

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto nenhuma receita tiver codigo_g3 preenchido por um
-- usuário. A partir do momento em que a Etapa 2 começar a gravar valores
-- reais, rodar isto DESTRÓI esse dado — auditar antes.
--
-- BEGIN;
-- drop index if exists public.receitas_codigo_g3_unico_idx;
-- alter table public.receitas drop constraint if exists receitas_codigo_g3_nao_vazio_check;
-- alter table public.receitas drop column if exists codigo_g3;
-- COMMIT;
