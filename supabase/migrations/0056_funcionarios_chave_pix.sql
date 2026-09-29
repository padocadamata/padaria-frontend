-- 0056_funcionarios_chave_pix.sql
-- FOLHA DE PAGAMENTO > CADASTRO E PARAMETRIZACOES -- Etapa A, Parte 1.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   2 colunas aditivas em public.funcionarios: tipo_chave_pix e
--   chave_pix, ambas nullable. Nenhuma tabela nova (auditoria da rodada
--   anterior confirmou: e 1:1 com o funcionario, mesmo raciocinio ja usado
--   para tipo_vinculo na migration 0055 -- nunca uma tabela separada para
--   um dado que so existe em funcao do funcionario).
--
-- Esta migration NAO faz, e nao deve fazer (decisao explicita do usuario):
--   * nenhuma UNIQUE em chave_pix (duas pessoas podem legitimamente
--     compartilhar uma chave em cenarios raros de conta conjunta/erro de
--     digitacao -- nao e uma verdade de negocio a impor no banco);
--   * nenhuma permissao nova -- a protecao continua por funcionarios.editar
--     (RLS/policy funcionarios_update, ja publicada na migration 0054,
--     cobre qualquer UPDATE em funcionarios, incluindo estas 2 colunas
--     novas, sem precisar de nenhuma alteracao de policy);
--   * nenhuma alteracao em Escala (0055), Beneficios, Dependentes, Cargos,
--     Agenda, Pedidos, Fornecedores, Catalogo, Dashboard, autenticacao ou
--     Gerenciar Acessos.
--
-- Validacao de FORMATO por tipo (CPF/CNPJ/celular/email/chave aleatoria)
-- fica inteiramente no FRONTEND (lib/funcionarios/normalizacao.js) -- mesmo
-- contrato ja usado para CPF em funcionarios.cpf desde a migration 0054:
-- o banco so garante a COERENCIA estrutural (tipo e chave sempre juntos ou
-- ambos nulos), nunca o formato do valor.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao.

BEGIN;

alter table public.funcionarios
  add column if not exists tipo_chave_pix text,
  add column if not exists chave_pix text;

do $$
begin
  alter table public.funcionarios
    add constraint funcionarios_tipo_chave_pix_valido
    check (tipo_chave_pix is null or tipo_chave_pix in ('cpf', 'cnpj', 'celular', 'email', 'aleatoria'));
exception
  when duplicate_object then null;
end $$;

-- Coerencia: tipo preenchido sem chave, ou chave preenchida sem tipo, nunca
-- e um estado valido -- ou os dois estao nulos (sem PIX cadastrado) ou os
-- dois estao preenchidos (PIX completo). (tipo_chave_pix is null) =
-- (chave_pix is null) e verdadeiro exatamente quando ambos sao nulos ou
-- ambos sao nao-nulos.
do $$
begin
  alter table public.funcionarios
    add constraint funcionarios_chave_pix_coerente
    check ((tipo_chave_pix is null) = (chave_pix is null));
exception
  when duplicate_object then null;
end $$;

comment on column public.funcionarios.tipo_chave_pix is
  'Adicionada na migration 0056 (Folha de Pagamento > Cadastro e Parametrizacoes, Etapa A). Tipo da chave PIX para pagamento do funcionario -- cpf, cnpj, celular, email ou aleatoria. Nullable: funcionario pode nao ter PIX cadastrado. Sempre preenchida junto com chave_pix (ver CHECK funcionarios_chave_pix_coerente) -- nunca um sem o outro.';

comment on column public.funcionarios.chave_pix is
  'Adicionada na migration 0056. Valor da chave PIX, formato livre (o significado depende de tipo_chave_pix). SEM UNIQUE -- decisao explicita: duas pessoas podem legitimamente compartilhar uma chave (conta conjunta, erro de digitacao a corrigir depois) sem que isso deva travar o cadastro. Validacao de FORMATO por tipo e responsabilidade do frontend (lib/funcionarios/normalizacao.js), nunca do banco -- mesmo contrato ja usado para CPF desde a migration 0054.';

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: apaga qualquer chave PIX ja cadastrada nos funcionarios ate o
-- momento do rollback. So use antes de haver dado real relevante.
-- BEGIN;
-- alter table public.funcionarios drop constraint if exists funcionarios_chave_pix_coerente;
-- alter table public.funcionarios drop constraint if exists funcionarios_tipo_chave_pix_valido;
-- alter table public.funcionarios drop column if exists chave_pix;
-- alter table public.funcionarios drop column if exists tipo_chave_pix;
-- COMMIT;
