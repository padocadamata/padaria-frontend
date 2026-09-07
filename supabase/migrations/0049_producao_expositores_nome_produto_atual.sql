-- 0049_producao_expositores_nome_produto_atual.sql
-- Corrige public.producao_expositor_detalhado para resolver produto_nome
-- a partir de produtos.nome (identidade mestre, pós-unificação 0034),
-- com fallback para receitas.nome (snapshot legado) somente quando a
-- receita ainda não tem catalogo_produto_id vinculado -- MESMO padrão já
-- estabelecido e em uso em pages/producao/historico.js
-- ("r.produtos?.nome ?? r.nome").
--
-- ACHADO desta auditoria (frente Produção > Expositores): a view
-- producao_expositor_detalhado (migration 0030) foi escrita ANTES da
-- unificação Catálogo×Produção ter sido desenhada (0033/0034/0035, todas
-- posteriores) -- resolvia produto_nome direto de receitas.nome, sem
-- nenhuma referência a produtos.nome. Se um produto for renomeado no
-- Catálogo DEPOIS de ter sido marcado para Produção (fluxo de 0035, que
-- grava receitas.nome como snapshot na criação e nunca mais sincroniza),
-- a tela Produção > Expositores continuaria mostrando o nome ANTIGO para
-- sempre -- inconsistente com o resto do módulo Produção (historico.js já
-- resolve pelo produto mestre desde a unificação).
--
-- Números 0046/0047 já ocupados pela frente paralela de Sacos Fechados
-- desde o início desta rodada. Esta migration foi ESCRITA originalmente
-- como 0048 -- mas, ainda DURANTE esta mesma rodada, a frente paralela de
-- Sacos também reivindicou 0048 (0048_sacos_listagem_cast_tipos.sql,
-- confirmado por `ls` -- nenhuma das duas foi executada, mas os dois
-- arquivos chegaram a coexistir soltos no working tree). Renumerada aqui
-- para 0049 (reconfirmado livre por `ls` após a colisão) para nunca
-- competir pelo mesmo número -- não fiz nada com o arquivo de Sacos, só
-- renomeei o meu.
--
-- NÃO EXECUTAR sem autorização explícita. Rodar
-- pre_auditoria_expositores_nome_produto_EXECUTAR.sql ANTES.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * CREATE OR REPLACE VIEW public.producao_expositor_detalhado --
--     MESMAS 19 colunas, mesmos nomes, mesma ordem, mesmos tipos (troca
--     SOMENTE a expressão-fonte da coluna produto_nome) -- compatível com
--     CREATE OR REPLACE VIEW (Postgres só rejeita reordenar/remover/
--     retipar colunas existentes; trocar a expressão-fonte de uma coluna
--     já existente, mantendo nome/tipo/posição, é sempre permitido).
--
-- Esta migration NÃO faz, e não deve fazer:
--   * nenhuma alteração em producao_expositor_lotes, producao_registros,
--     receitas, produtos (schema ou dados);
--   * nenhuma alteração em nenhuma RPC (criar_lote_expositor,
--     editar_lote_expositor, concluir_retirada_expositor,
--     corrigir_lote_expositor_concluido, excluir_lote_expositor) --
--     nenhuma delas seleciona/retorna produto_nome, todas continuam
--     byte-a-byte como estão;
--   * nenhuma alteração em RLS/policy/permissão -- security_invoker=true
--     preservado (a view continua rodando com os privilégios/RLS de quem
--     consulta, não do dono);
--   * nenhuma alteração de frontend -- pages/producao/expositores.js
--     consome a coluna produto_nome pelo NOME, que não muda;
--   * nenhum backfill/UPDATE de receitas.nome -- a coluna continua
--     existindo e nunca é apagada, só deixa de ser a ÚNICA fonte do nome
--     exibido enquanto houver um produtos.nome mais atual disponível;
--   * nenhuma alteração em Sacos Fechados/Estoque (0041/0042/0044/0046/
--     0047) nem em Pedidos (0043/0045).

BEGIN;

create or replace view public.producao_expositor_detalhado
with (security_invoker = true) as
select
  l.id as lote_id,
  l.producao_registro_id,
  pr.data as data_producao,
  pr.turno,
  pr.receita_id,
  coalesce(p.nome, r.nome) as produto_nome,
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
join public.receitas r on r.id = pr.receita_id
left join public.produtos p on p.id = r.catalogo_produto_id;

comment on view public.producao_expositor_detalhado is
  'Visao operacional/relatorio do Controle de Expositores: 1 linha por LOTE. produto_nome resolvido via COALESCE(produtos.nome, receitas.nome) (0049) -- produtos e a identidade mestre pos-unificacao (0034), receitas.nome e fallback so para receita ainda sem catalogo_produto_id vinculado (snapshot legado, mesmo padrao ja usado em pages/producao/historico.js). data/turno/quantidade_produzida resolvidos via producao_registros/receitas. venda_estimada = quantidade_enviada - quantidade_retirada SEMPRE derivada (null antes da conclusao). security_invoker=true. Nao expõe "situacao" -- calculada no frontend contra dataLocalHoje().';

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro -- é apenas uma expressão de leitura diferente na view, nenhum
-- dado é alterado por esta migration nem pelo rollback.
-- BEGIN;
--
--   -- Restaura a view para o texto exato da 0030 (produto_nome = r.nome,
--   -- sem join a produtos) -- copiar de
--   -- supabase/migrations/0030_producao_expositores.sql, seção 6.
--
-- COMMIT;
