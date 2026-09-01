-- 0029_catalogo_exclusao_produto.sql
-- Exclusao definitiva, auditavel e SOMENTE VIA RPC, de um produto do
-- Catalogo (public.produtos), restrita a produtos SEM NENHUMA utilizacao
-- conhecida no sistema. Produto com qualquer vinculo deve ser inativado
-- (ativo=false, ja suportado hoje pela tela /catalogo), nunca excluido.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita. Gerado em scratchpad/raiz para
-- revisao estatica, SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0028 ja aplicadas. 0028 (classificacoes de
-- secao/categoria) esta encerrada em producao. Numeracao 0029 confirmada
-- livre: nenhuma 0029 publicada ainda em supabase/migrations/.
--
-- ============================================================
-- BASE DA AUDITORIA -- 0029_pre_auditoria_EXECUTAR.sql, rodada
-- manualmente pelo usuario no SQL Editor do Supabase. Resultados reais:
-- ============================================================
--   * 5 FKs apontam para public.produtos.id (nenhuma outra encontrada):
--       - public.cotacoes.produto_id                    ON DELETE NO ACTION
--       - public.pedido_itens.produto_id                ON DELETE SET NULL
--       - public.produto_fornecedores.produto_id         ON DELETE RESTRICT
--       - public.produtos_historico_compras.produto_id   ON DELETE RESTRICT
--       - public.receita_ingredientes.produto_id          ON DELETE RESTRICT
--     public.cotacoes NAO tinha sido mapeada pela auditoria de codigo
--     original (tabela legada, sem migration propria no repositorio,
--     mesma situacao de public.produtos) -- so apareceu porque o Bloco 1
--     descobre FKs dinamicamente via pg_constraint, sem depender de busca
--     de texto nas migrations. As 5 tabelas SAO TODAS verificadas
--     explicitamente nesta RPC, nao so as que tem RESTRICT.
--   * PRODUTO TESTE CATALOGO (id 551b632c-c924-4460-8d6a-153bfb153a67):
--     ativo=false, sem receita_ingredientes, sem produto_fornecedores,
--     sem produtos_historico_compras, sem pedido_itens. cotacoes ainda
--     precisa ser conferido pelo usuario (Bloco 1/6 nao cobriam cotacoes
--     explicitamente na 1a rodada). NAO excluido nesta migration nem em
--     nenhum passo manual -- permanece intocado.
--   * REVISADO -- Bloco 4 real da pre-auditoria (information_schema.
--     columns), colado pelo usuario: public.produtos tem EXATAMENTE 14
--     colunas -- id, codigo_barras, nome, secao, categoria,
--     unidade_medida, preco_unitario, estoque_minimo, ativo, criado_em,
--     atualizado_em, codigo_g3, secao_id, categoria_id. A 1a versao desta
--     migration tinha usado, por engano, a lista de campos do formulario
--     components/catalogo/DadosProdutoForm.js (que so mostra os campos
--     editaveis na tela, nao o schema real da tabela) como fonte para o
--     snapshot -- isso omitiu criado_em/atualizado_em, que EXISTEM na
--     tabela mas nao aparecem em nenhum formulario. CORRIGIDO: o snapshot
--     na secao 3 abaixo agora cobre as 14 colunas MENOS id (justificativa
--     na propria secao 3 -- id ja fica gravado em logs_auditoria.
--     registro_id, registra-lo de novo como 'campo' seria redundante,
--     mesmo padrao das 4 RPCs de exclusao anteriores do projeto, nenhuma
--     das quais duplica o proprio id como uma linha de campo).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * 1 codigo de permissao novo: catalogo_produtos.excluir, SEPARADO de
--     catalogo_produtos.editar, concedido SOMENTE a proprietario_admin --
--     mesmo padrao de pedidos.excluir (migration 0025). catalogo_produtos
--     .editar e .visualizar NAO sao alterados (nem o codigo, nem quem os
--     possui);
--   * public.excluir_produto_catalogo(uuid) -- SECURITY DEFINER, RPC-only,
--     sem nenhuma policy de DELETE nova em public.produtos (continua sem
--     nenhuma, exatamente como desde a migration 0023).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em nenhuma FK (nem CASCADE, nem SET NULL como
--     estrategia, nem RESTRICT->outra coisa) -- as 5 FKs listadas acima
--     permanecem byte-a-byte como estao hoje;
--   * nenhuma policy de DELETE em public.produtos;
--   * nenhuma alteracao em catalogo_produtos.editar/.visualizar (codigo
--     nem concessoes);
--   * nenhum DELETE automatico/em cascata de receita_ingredientes,
--     produto_fornecedores, produtos_historico_compras, pedido_itens ou
--     cotacoes -- se qualquer uma tiver vinculo, a exclusao e BLOQUEADA,
--     nunca "limpa o caminho" apagando o vinculo;
--   * nenhuma alteracao de frontend (fica para rodada futura: icone de
--     lixeira, ConfirmarAcaoModal, chamada a esta RPC);
--   * nenhuma concessao de catalogo_produtos.excluir a nenhum perfil alem
--     de proprietario_admin;
--   * nenhum uso de GUC customizada;
--   * nenhuma exclusao real de PRODUTO TESTE CATALOGO nem de qualquer
--     outro produto -- esta migration so CRIA a RPC, nao a executa.

BEGIN;

-- ============================================================
-- 1. SEED -- novo codigo de permissao catalogo_produtos.excluir
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('catalogo_produtos.excluir', 'catalogo_produtos', 'excluir',
   'Excluir definitivamente um produto do Catalogo, via excluir_produto_catalogo(). SOMENTE permitido quando o produto nao tem nenhum vinculo em cotacoes, pedido_itens, produto_fornecedores, produtos_historico_compras ou receita_ingredientes -- caso contrario a RPC bloqueia e o produto deve ser inativado (ativo=false) em vez de excluido. Acao irreversivel, registrada em logs_auditoria. Separada de catalogo_produtos.editar por ser mais destrutiva (mesmo raciocinio de pedidos.excluir vs. pedidos.editar).');

-- proprietario_admin preserva "acesso total": concede o codigo novo
-- explicitamente, mesmo padrao ja usado em 0016/0018/0022/0023/0025/0028.
-- catalogo_produtos.editar/.visualizar NAO sao tocadas por este INSERT --
-- suas concessoes atuais (tambem so proprietario_admin, confirmado pelo
-- Bloco 9 da pre-auditoria) permanecem exatamente como estao.
insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo = 'catalogo_produtos.excluir';


-- ============================================================
-- 2. public.excluir_produto_catalogo -- SECURITY DEFINER, RPC-only
-- ============================================================
-- Owner: nenhum ALTER FUNCTION ... OWNER TO nesta migration -- mesmo
-- padrao implicito de TODAS as RPCs administrativas do projeto
-- (excluir_pedido, excluir_catalogo_secao/categoria,
-- excluir_produto_fornecedor, excluir_historico_compra_manual): o owner
-- fica sendo quem executar esta migration no SQL Editor do Supabase
-- (o mesmo role/superuser de sempre), sem nenhuma migration do projeto
-- jamais ter setado owner explicitamente numa RPC.
--
-- CONCORRENCIA -- ver explicacao completa na resposta desta rodada, aqui
-- so o resumo aplicado ao codigo: a mesma tecnica ja usada e comentada em
-- excluir_pedido (migration 0025, linhas 386-392) se aplica aqui SEM
-- PRECISAR DE NENHUM MECANISMO ADICIONAL (nem lock de tabela, nem lock
-- advisory): "select ... for update" na linha do produto, ANTES de
-- checar qualquer vinculo, toma um lock FOR UPDATE nessa linha. QUALQUER
-- INSERT/UPDATE concorrente em QUALQUER uma das 5 tabelas filhas
-- (cotacoes, pedido_itens, produto_fornecedores,
-- produtos_historico_compras, receita_ingredientes) que referencie este
-- produto_id precisa, por mecanismo INTERNO do Postgres (gatilho
-- RI_FKey_check, disparado pela FK em si, independente do ON DELETE
-- escolhido -- vale IGUALMENTE para RESTRICT, NO ACTION e SET NULL),
-- tomar um lock FOR KEY SHARE na linha referenciada de produtos ANTES de
-- confirmar seu proprio INSERT/UPDATE. FOR UPDATE conflita com FOR KEY
-- SHARE (matriz de locks do Postgres, secao 13.3.1 da documentacao) --
-- logo, enquanto esta funcao segura o FOR UPDATE, nenhuma transacao
-- concorrente consegue inserir/atualizar uma linha filha apontando para
-- este produto_id: ela fica bloqueada ate esta funcao terminar (commit
-- ou rollback). Se esta funcao COMMITAR o DELETE, a transacao concorrente
-- (agora liberada) tenta validar a FK contra um produto que ja nao
-- existe e e REJEITADA pelo proprio Postgres com violacao de FK -- nao
-- ha janela em que um vinculo novo possa ser criado entre a checagem e o
-- DELETE. Isso vale para pedido_itens exatamente como vale para as
-- demais, PORQUE o lock FOR KEY SHARE no INSERT/UPDATE do filho e
-- disparado pela EXISTENCIA da FK, nao pela clausula ON DELETE dela --
-- ON DELETE SET NULL so muda o que aconteceria no lado do PAI se o
-- DELETE nao fosse bloqueado antes; nao muda o lock que o filho toma ao
-- ser inserido. Por isso nenhum mecanismo adicional (advisory lock,
-- LOCK TABLE, coluna de flag) e necessario aqui.
create or replace function public.excluir_produto_catalogo(p_produto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produto record;
begin
  if auth.uid() is null then
    raise exception 'excluir_produto_catalogo: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.excluir')) then
    raise exception using errcode = '42501',
      message = 'excluir_produto_catalogo: requer a permissao catalogo_produtos.excluir.';
  end if;

  -- Bloqueia a linha do produto ANTES de checar qualquer vinculo -- ver
  -- explicacao de concorrencia acima. select * (nao uma lista fixa de
  -- colunas) para o record se adaptar ao schema real de public.produtos,
  -- que e legado e nao tem migration de CREATE TABLE propria.
  select * into v_produto
  from public.produtos
  where id = p_produto_id
  for update;

  if v_produto.id is null then
    raise exception 'excluir_produto_catalogo: produto % nao encontrado.', p_produto_id;
  end if;

  -- Nao importa se o produto esta ativo ou inativo -- o criterio e
  -- ausencia TOTAL de utilizacao, nao o status. As 5 tabelas descobertas
  -- pelo Bloco 1 da pre-auditoria (0029_pre_auditoria_EXECUTAR.sql) sao
  -- TODAS verificadas aqui, mesmo as que ja tem RESTRICT/NO ACTION (o
  -- banco ja bloquearia sozinho, mas a checagem explicita entrega uma
  -- mensagem funcional e amigavel em vez de estourar um erro cru de FK)
  -- e MESMO a que tem SET NULL (pedido_itens -- ali a checagem explicita
  -- e a UNICA coisa que impede a exclusao, ja que o banco sozinho deixaria
  -- passar e so orfanizaria o vinculo).
  if exists (select 1 from public.cotacoes where produto_id = p_produto_id)
    or exists (select 1 from public.pedido_itens where produto_id = p_produto_id)
    or exists (select 1 from public.produto_fornecedores where produto_id = p_produto_id)
    or exists (select 1 from public.produtos_historico_compras where produto_id = p_produto_id)
    or exists (select 1 from public.receita_ingredientes where produto_id = p_produto_id)
  then
    raise exception
      'Este produto ja possui utilizacao no sistema e nao pode ser excluido. Deixe-o Inativo caso nao seja mais utilizado.';
  end if;

  -- Snapshot coluna-a-coluna em logs_auditoria, ANTES do DELETE, mesma
  -- transacao -- mesmo padrao de excluir_produto_fornecedor/
  -- excluir_historico_compra_manual/excluir_catalogo_secao/categoria
  -- (0025/0028). Lista de colunas: as 14 colunas REAIS de public.produtos
  -- confirmadas pelo Bloco 4 da pre-auditoria (information_schema.columns,
  -- colado pelo usuario), MENOS 1:
  --   * id -- OMITIDA de proposito: ja fica gravada em
  --     logs_auditoria.registro_id (preenchido logo abaixo com
  --     p_produto_id::text) -- repeti-la como uma linha de 'campo'
  --     seria puramente redundante, e nenhuma das 4 RPCs de exclusao
  --     anteriores do projeto (produto_fornecedor, historico_compra,
  --     catalogo_secao, catalogo_categoria) duplica o proprio id assim.
  -- As outras 13 -- codigo_barras, nome, secao, categoria, unidade_medida,
  -- preco_unitario, estoque_minimo, ativo, criado_em, atualizado_em,
  -- codigo_g3, secao_id, categoria_id -- estao TODAS presentes abaixo,
  -- incluindo criado_em/atualizado_em (ausentes na 1a versao desta
  -- migration por terem sido tiradas, por engano, do formulario do
  -- frontend em vez do schema real da tabela).
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('produto', p_produto_id::text, 'excluiu', 'codigo_barras', v_produto.codigo_barras, null),
    ('produto', p_produto_id::text, 'excluiu', 'nome', v_produto.nome, null),
    ('produto', p_produto_id::text, 'excluiu', 'secao', v_produto.secao, null),
    ('produto', p_produto_id::text, 'excluiu', 'categoria', v_produto.categoria, null),
    ('produto', p_produto_id::text, 'excluiu', 'unidade_medida', v_produto.unidade_medida, null),
    ('produto', p_produto_id::text, 'excluiu', 'preco_unitario', v_produto.preco_unitario::text, null),
    ('produto', p_produto_id::text, 'excluiu', 'estoque_minimo', v_produto.estoque_minimo::text, null),
    ('produto', p_produto_id::text, 'excluiu', 'ativo', v_produto.ativo::text, null),
    ('produto', p_produto_id::text, 'excluiu', 'criado_em', v_produto.criado_em::text, null),
    ('produto', p_produto_id::text, 'excluiu', 'atualizado_em', v_produto.atualizado_em::text, null),
    ('produto', p_produto_id::text, 'excluiu', 'codigo_g3', v_produto.codigo_g3, null),
    ('produto', p_produto_id::text, 'excluiu', 'secao_id', v_produto.secao_id::text, null),
    ('produto', p_produto_id::text, 'excluiu', 'categoria_id', v_produto.categoria_id::text, null);

  delete from public.produtos where id = p_produto_id;
end;
$$;

comment on function public.excluir_produto_catalogo(uuid) is
  'Exclui definitivamente um produto do Catalogo, SOMENTE se nao houver nenhum vinculo em cotacoes, pedido_itens, produto_fornecedores, produtos_historico_compras ou receita_ingredientes -- verificado explicitamente no corpo da funcao (nao so via FK, ja que pedido_itens.produto_id e ON DELETE SET NULL e nao bloquearia sozinho). Status ativo/inativo do produto NAO influencia a decisao. RPC-only por desenho: NENHUMA policy de DELETE existe em public.produtos. Exige sessao autenticada + catalogo_produtos.excluir (permissao separada de catalogo_produtos.editar, mesmo raciocinio de pedidos.excluir). Bloqueia a linha do produto (FOR UPDATE) antes de checar vinculos -- combinado com o lock FOR KEY SHARE que o Postgres ja toma automaticamente em qualquer INSERT/UPDATE de linha filha nas 5 tabelas (efeito colateral da FK em si, independente do ON DELETE escolhido), impede a corrida entre a checagem e o DELETE sem precisar de nenhum mecanismo adicional. Snapshot coluna-a-coluna completo em logs_auditoria antes do DELETE (13 das 14 colunas reais de produtos -- todas exceto id, ja coberta por registro_id), mesma transacao. Sem CASCADE, sem SET NULL como estrategia, sem exclusao automatica de nenhuma dependencia -- produto com vinculo deve ser inativado (ativo=false), nunca excluido.';

revoke execute on function public.excluir_produto_catalogo(uuid) from public;
revoke execute on function public.excluir_produto_catalogo(uuid) from anon;
grant execute on function public.excluir_produto_catalogo(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro para rodar mesmo depois de a RPC ter sido usada (nenhuma FK,
-- policy ou coluna e alterada por esta migration -- so a funcao e a
-- permissao sao revertidas). ATENCAO: qualquer produto ja excluido via
-- esta RPC antes do rollback NAO volta (DELETE e definitivo) -- o
-- snapshot em logs_auditoria e a UNICA forma de recuperar o que foi
-- excluido, sempre manual.
-- BEGIN;
--
--   revoke execute on function public.excluir_produto_catalogo(uuid) from authenticated;
--   drop function if exists public.excluir_produto_catalogo(uuid);
--
--   delete from public.perfil_permissoes where permissao = 'catalogo_produtos.excluir';
--   delete from public.permissoes where codigo = 'catalogo_produtos.excluir';
--
-- COMMIT;
