-- 0031_producao_houve_falta.sql
-- Marcador estrutural de falta de produto em public.producao_registros,
-- para uso exclusivo do motor de sugestao do Planejamento
-- (lib/producao/sugestaoProducao.js): quando houve_falta=true, a demanda
-- considerada para aquele lancamento passa a ser
-- quantidade_vendida + 25 (nunca quantidade_produzida + 25), sem alterar
-- nenhum dado real de producao/venda.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rodar manualmente no SQL Editor do
-- Supabase, depois de rodar e conferir 0031_pre_auditoria_falta_producao_
-- EXECUTAR.sql.
--
-- IMPORTANTE -- numeracao: existe outra frente de trabalho (outro chat)
-- usando o numero de migration 0030 para Controle de Expositores, ainda
-- nao commitada em supabase/migrations (so os arquivos soltos
-- 0030_*_EXECUTAR.sql existem hoje). Por isso esta migration usa 0031,
-- confirmado livre pelo bloco 1 da pre-auditoria. Esta migration NAO
-- depende de nada da 0030 e nao toca em nenhum objeto relacionado a
-- Expositores.
--
-- Pre-requisitos reais (dependencias de SQL, todas ja aplicadas):
--   * public.producao_registros -- 0010, ja aplicada. Esta migration
--     ADICIONA 1 coluna (houve_falta). NAO altera nenhuma constraint,
--     nenhuma policy de RLS, nenhuma trigger existente.
--   * public.excluir_producao_registro -- 0020, ja aplicada. Esta
--     migration REDEFINE essa funcao (CREATE OR REPLACE, mesma
--     assinatura), so para incluir houve_falta no snapshot de auditoria
--     gravado antes do DELETE -- mesma logica, mesma seguranca
--     (SECURITY INVOKER, is_admin() explicito + policy de DELETE),
--     nenhuma outra linha do corpo muda.
--
-- ESCOPO -- SOMENTE:
--   * 1 ALTER TABLE (coluna nova houve_falta boolean not null default
--     false, com comentario);
--   * 1 CREATE OR REPLACE FUNCTION (excluir_producao_registro, so para
--     acrescentar 1 linha no INSERT de auditoria pre-DELETE).
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhum backfill -- todo registro (historico, manual, retroativo,
--     antigo ou novo) nasce/permanece com houve_falta=false ate que
--     alguem marque manualmente pela tela Hoje ou Historico;
--   * nenhuma alteracao em nenhuma CHECK constraint existente;
--   * nenhuma alteracao na trigger producao_registros_protecao (ver nota
--     abaixo -- nao e necessaria);
--   * nenhuma alteracao em nenhuma policy de RLS (a policy de UPDATE ja
--     existente cobre qualquer coluna da linha, RLS e sempre por linha,
--     nunca por coluna -- ja e suficiente para permitir UPDATE de
--     houve_falta a quem tem producao.editar, exatamente como ja
--     acontece hoje com observacoes);
--   * nenhuma RPC nova -- marcar/desmarcar falta e feito por UPDATE
--     direto no frontend (mesmo padrao ja usado por
--     FechamentoTurnoForm.js para fechar turno), protegido pela RLS
--     existente;
--   * nenhuma alteracao em planejamento_producao, receitas, ou qualquer
--     outra tabela;
--   * nenhum codigo de frontend (preparado separadamente, nesta mesma
--     rodada, mas fora deste arquivo SQL).
--
-- Por que a trigger producao_registros_protecao NAO precisa de nenhuma
-- alteracao: a variavel v_campos_lancamento_alterados (que bloqueia
-- edicao de campos de lancamento enquanto o registro esta fechado, exceto
-- via reabertura) e uma lista EXPLICITA de comparacoes
-- (quantidade_produzida, quantidade_vendida, sobra_total,
-- sobra_aproveitavel, perda_descarte, receita_id, data, turno,
-- custo_producao). houve_falta nao entra nessa lista -- exatamente como
-- observacoes ja nao entra hoje. Logo, marcar/desmarcar houve_falta e
-- sempre permitido (para quem tem producao.editar), em qualquer status
-- (aberto/fechado/reaberto) e em qualquer origem (manual/retroativo/
-- historico), sem precisar reabrir o registro -- e uma correcao
-- operacional simples, no mesmo espirito de uma observacao, nunca uma
-- correcao estrutural de quantidade/data/turno/produto.
--
-- Por que nao ha risco de a coluna nova quebrar nenhuma CHECK constraint
-- existente: nenhuma constraint hoje faz referencia a colunas por
-- SELECT *, nem reconstroi a linha inteira -- todas sao CHECK explicitas
-- sobre colunas nomeadas. Uma coluna nova, com DEFAULT fixo (false), nao
-- e avaliada por nenhuma delas.
--
-- Custo/lock: ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT <constante>
-- e uma operacao so de catalogo (sem reescrita de tabela) desde
-- PostgreSQL 11 -- segura mesmo com a tabela em uso, sem lock prolongado,
-- independente do volume atual de linhas.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao e
-- CREATE OR REPLACE FUNCTION.

BEGIN;

-- ============================================================
-- 1. public.producao_registros -- coluna nova houve_falta
-- ============================================================

alter table public.producao_registros
  add column if not exists houve_falta boolean not null default false;

comment on column public.producao_registros.houve_falta is
  'Marca se houve falta de produto (demanda nao atendida porque o produto acabou) neste lancamento data+turno+receita. Estruturalmente independente de quantidade_produzida/quantidade_vendida, que permanecem sempre reais e nunca sao alterados por causa desta marcacao -- o historico real nunca ganha +25. Usado exclusivamente por lib/producao/sugestaoProducao.js: quando true, a demanda considerada pelo motor de sugestao do Planejamento para aquele lancamento e quantidade_vendida + 25 (constante BONUS_FALTA_UNIDADES, nao persistida em nenhuma coluna -- calculo derivado em memoria a cada execucao), nunca quantidade_produzida + 25. Nao relacionado ao futuro Controle de Expositores (quebra/consumo interno/validade/produto retirado/perda) -- representa apenas demanda reprimida por falta de produto. Editavel livremente (marcar/desmarcar, em qualquer status e origem) da mesma forma que observacoes -- nao e um campo de lancamento estrutural, por isso a trigger producao_registros_protecao (0010) nao precisa de nenhuma alteracao: v_campos_lancamento_alterados nao inclui esta coluna. Registros existentes antes desta migration permanecem com o default false -- nenhum backfill artificial foi feito sobre o passado.';


-- ============================================================
-- 2. public.excluir_producao_registro (0020) -- redefinida
-- ============================================================
-- Unico ponto alterado: o snapshot de auditoria gravado ANTES do DELETE
-- ganha mais uma linha para houve_falta, seguindo a mesma convencao ja
-- usada para as demais colunas (valor_anterior = o que existia,
-- valor_novo = null). Todo o resto do corpo abaixo -- comentarios
-- internos inclusive -- e reproducao byte-a-byte do texto ja aplicado em
-- 0020 (conferido linha a linha contra supabase/migrations/
-- 0020_producao_registros_exclusao_admin.sql antes de escrever este
-- arquivo): mesma checagem de is_admin(), mesmo motivo obrigatorio,
-- mesma busca do registro, mesma ordem das 11 colunas ja auditadas
-- (confirmadas pela pre-auditoria: motivo, data, turno, receita_id,
-- origem, status, quantidade_produzida, quantidade_vendida, sobra_total,
-- sobra_aproveitavel, perda_descarte), mesma transacao implicita. A unica
-- diferenca textual e a virgula (antes ';') apos a linha de
-- perda_descarte e a 12a linha nova de houve_falta, ao final do VALUES.
--
-- Assinatura (uuid, text), owner, LANGUAGE plpgsql, SECURITY INVOKER e
-- SET search_path = '' permanecem identicos -- CREATE OR REPLACE FUNCTION
-- com a MESMA assinatura nunca muda o OID nem o owner do objeto. Os
-- GRANTs tambem nao sao resetados por CREATE OR REPLACE: o REVOKE/GRANT
-- ao final desta secao so reafirma public/anon revogados e authenticated
-- concedido (identico ao ja existente em 0020) -- os grantees adicionais
-- confirmados pela pre-auditoria (postgres, dono da funcao;
-- service_role, papel administrativo do Supabase) nao sao tocados por
-- este bloco e permanecem exatamente como estao hoje.

create or replace function public.excluir_producao_registro(
  p_registro_id uuid,
  p_motivo text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro public.producao_registros;
begin
  if not (select public.is_admin()) then
    raise exception
      'excluir_producao_registro: exclusao definitiva de producao requer administrador.';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception
      'excluir_producao_registro: motivo e obrigatorio.';
  end if;

  select * into v_registro
  from public.producao_registros
  where id = p_registro_id;

  if v_registro.id is null then
    raise exception
      'excluir_producao_registro: registro % nao encontrado.', p_registro_id;
  end if;

  -- usuario_id/usuario_nome/usuario_email/data_hora sao preenchidos
  -- automaticamente pelo trigger logs_auditoria_preencher_usuario
  -- (migration 0004), que tambem ja lanca excecao se nao houver sessao
  -- autenticada — nao duplicamos essa checagem aqui. Se qualquer um
  -- destes INSERTs falhar, a excecao propaga e o DELETE abaixo nunca
  -- executa, pois estao na mesma transacao implicita desta chamada.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('producao', p_registro_id::text, 'excluiu', 'motivo',
      null, p_motivo),
    ('producao', p_registro_id::text, 'excluiu', 'data',
      v_registro.data::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'turno',
      v_registro.turno, null),
    ('producao', p_registro_id::text, 'excluiu', 'receita_id',
      v_registro.receita_id::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'origem',
      v_registro.origem, null),
    ('producao', p_registro_id::text, 'excluiu', 'status',
      v_registro.status, null),
    ('producao', p_registro_id::text, 'excluiu', 'quantidade_produzida',
      v_registro.quantidade_produzida::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'quantidade_vendida',
      v_registro.quantidade_vendida::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'sobra_total',
      v_registro.sobra_total::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'sobra_aproveitavel',
      v_registro.sobra_aproveitavel::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'perda_descarte',
      v_registro.perda_descarte::text, null),
    ('producao', p_registro_id::text, 'excluiu', 'houve_falta',
      v_registro.houve_falta::text, null);

  delete from public.producao_registros where id = p_registro_id;
end;
$$;

comment on function public.excluir_producao_registro(uuid, text) is
  '[0020, inalterado, exceto:] (0031) o snapshot de auditoria gravado antes do DELETE agora inclui tambem houve_falta, mesma convencao das demais colunas (valor_anterior = valor que existia, valor_novo = null). Nenhuma outra parte do corpo, da checagem de permissao ou da transacao mudou.';

revoke execute on function public.excluir_producao_registro(uuid, text) from public;
revoke execute on function public.excluir_producao_registro(uuid, text) from anon;
grant execute on function public.excluir_producao_registro(uuid, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro enquanto o frontend novo (Hoje/Historico/Planejamento) ainda nao
-- foi implantado em producao: nenhuma linha real depende de houve_falta
-- para nada alem do calculo de sugestao, que volta a se comportar
-- exatamente como antes assim que a coluna e a alteracao de
-- excluir_producao_registro forem revertidas (o codigo velho de
-- sugestaoProducao.js nunca leu essa coluna). Apos o frontend novo estar
-- em uso real, reverter apaga permanentemente qualquer marcacao de falta
-- ja feita pelos usuarios -- confirmar que nao ha uso real antes de rodar.
-- BEGIN;
--
--   -- Restaura excluir_producao_registro para o texto exato de 0020
--   -- (sem a linha de houve_falta) -- copiar o CREATE OR REPLACE de
--   -- 0020_producao_registros_exclusao_admin.sql linhas 112-176 aqui,
--   -- sem reescrever de memoria.
--
--   alter table public.producao_registros drop column if exists houve_falta;
--
-- COMMIT;
