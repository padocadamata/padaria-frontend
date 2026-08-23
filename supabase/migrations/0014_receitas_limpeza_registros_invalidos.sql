-- 0014_receitas_limpeza_registros_invalidos.sql
-- Remove definitivamente 12 registros de public.receitas já auditados
-- como inválidos/duplicados de importação: nomes literais corrompidos
-- (NaT, nan, A) e gêmeos de "lote 2" sem produto real correspondente
-- (Bengala, Mini Filão, Pão 12 grãos, Pão Frances Crocante Boleado — ver
-- mapeamento fechado que já usa o receita_id do lote 1 para esses 4
-- nomes). Confirmado pelo usuário: nenhum dos 12 tem referência em
-- producao_registros, planejamento_producao ou receita_ingredientes.
--
-- Escopo: DELETE físico restrito a exatamente estes 12 UUIDs, com guardas
-- de pré-condição (existência exata + nome esperado por id + ausência de
-- referência nas 3 tabelas) e pós-condição (exatamente 12 linhas
-- removidas E total de public.receitas = 33 após o DELETE). Nenhum UPDATE
-- nos demais 33 registros. Nenhuma alteração de schema/RLS/policies.
-- Tudo em uma única transação: qualquer guarda que falhe aborta a
-- transação inteira, nada é removido.
--
-- IRREVERSÍVEL: DELETE físico de dado não é desfazível por um bloco de
-- ROLLBACK em SQL (ao contrário das migrations aditivas 0012/0013).
-- Reverter exigiria restaurar as 12 linhas a partir de um backup/snapshot
-- do banco anterior à execução desta migration — não existe "desfazer"
-- automático aqui.

BEGIN;

do $$
declare
  ids_esperados uuid[] := array[
    '2e18193c-d67c-4799-a7b1-0a34cd03a30d',
    'a10c3569-7107-45a4-9cf4-3215576e14ff',
    '30204d40-249e-4850-8d5a-de9d26072103',
    '8537d965-46ab-496f-8b72-6255f8da277a',
    'a5dfdfa3-74c2-4ec8-886b-1ee6c4adb44e',
    '57f77598-44d0-4d2a-b3dd-72b7d7b08a6c',
    '91495d54-bd97-440f-89d8-8a41c68a3fe0',
    'b24dff29-52ca-44e9-a934-fa72d653d46e',
    '483913ed-6b32-45af-8ccb-11aca5f6b55e',
    'f43f726b-1111-48ce-95e4-5ef68797aeff',
    'ae9052fa-21c1-4b7b-b8c3-dcd72dc4a5ef',
    'e9e9ace9-0154-4678-b798-0973f440112a'
  ]::uuid[];

  -- Nomes esperados, na MESMA posição do array acima — confirmados pelo
  -- usuário em 2026-08-23.
  nomes_esperados text[] := array[
    'NaT',
    'NaT',
    'NaT',
    'NaT',
    'A',
    'Bengala',
    'Mini Filão',
    'Pão 12 grãos',
    'Pão Frances Crocante Boleado',
    'nan',
    'nan',
    'nan'
  ]::text[];

  qtd_receitas_antes         int;
  qtd_encontrada              int;
  qtd_nome_divergente         int;
  qtd_ref_producao_registros  int;
  qtd_ref_planejamento        int;
  qtd_ref_ficha_tecnica       int;
  qtd_removida                 int;
  qtd_receitas_depois         int;
begin
  select count(*) into qtd_receitas_antes from public.receitas;

  -- 1) Guarda de existência: os 12 IDs devem existir, nem mais nem menos.
  select count(*) into qtd_encontrada
  from public.receitas
  where id = any(ids_esperados);

  if qtd_encontrada <> 12 then
    raise exception
      'esperado encontrar exatamente 12 receitas para os IDs informados, encontrado %', qtd_encontrada;
  end if;

  -- 2) Guarda de nome esperado: cada id deve corresponder ao nome já
  -- auditado, protege contra UUID errado por transcrição.
  select count(*) into qtd_nome_divergente
  from unnest(ids_esperados, nomes_esperados) as esperado(id, nome)
  join public.receitas r on r.id = esperado.id
  where r.nome is distinct from esperado.nome;

  if qtd_nome_divergente <> 0 then
    raise exception
      '% receita(s) com nome divergente do esperado — abortando antes de qualquer DELETE', qtd_nome_divergente;
  end if;

  -- 3) Guardas de ausência de referência nas 3 tabelas (todas confirmadas
  -- existentes fisicamente no banco — sem fallback condicional).
  select count(*) into qtd_ref_producao_registros
  from public.producao_registros
  where receita_id = any(ids_esperados);

  if qtd_ref_producao_registros <> 0 then
    raise exception
      '% registro(s) em producao_registros referenciam algum dos 12 ids — abortando', qtd_ref_producao_registros;
  end if;

  select count(*) into qtd_ref_planejamento
  from public.planejamento_producao
  where receita_id = any(ids_esperados);

  if qtd_ref_planejamento <> 0 then
    raise exception
      '% registro(s) em planejamento_producao referenciam algum dos 12 ids — abortando', qtd_ref_planejamento;
  end if;

  select count(*) into qtd_ref_ficha_tecnica
  from public.receita_ingredientes
  where receita_id = any(ids_esperados);

  if qtd_ref_ficha_tecnica <> 0 then
    raise exception
      '% registro(s) em receita_ingredientes referenciam algum dos 12 ids — abortando', qtd_ref_ficha_tecnica;
  end if;

  -- 4) DELETE restrito exatamente a estes 12 UUIDs. Nenhum UPDATE em
  -- nenhuma linha — os 33 registros válidos não são tocados.
  delete from public.receitas
  where id = any(ids_esperados);

  get diagnostics qtd_removida = row_count;

  -- 5) Assert de pós-condição: exatamente 12 linhas removidas.
  if qtd_removida <> 12 then
    raise exception
      'esperado remover exatamente 12 linhas, removido % — abortando', qtd_removida;
  end if;

  -- 6) Assert de pós-condição adicional: total de receitas ficou em 33.
  select count(*) into qtd_receitas_depois from public.receitas;

  if qtd_receitas_depois <> 33 then
    raise exception
      'esperado total de 33 receitas após o DELETE (tinha % antes, removido %), encontrado % — abortando',
      qtd_receitas_antes, qtd_removida, qtd_receitas_depois;
  end if;
end $$;

COMMIT;
