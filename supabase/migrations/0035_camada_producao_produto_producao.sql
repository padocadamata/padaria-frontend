-- 0035_camada_producao_produto_producao.sql
-- Camada de banco para o conceito "Produto de Producao" (checkbox
-- futuro no Catalogo), construida sobre receitas.catalogo_produto_id
-- (migration 0034). Cria 2 RPCs novas (marcar/desmarcar) e atualiza
-- excluir_produto_catalogo para bloquear exclusao de produto com
-- extensao de Producao vinculada. NENHUMA alteracao estrutural de
-- tabela, NENHUM NOT NULL, NENHUMA alteracao de FK, NENHUM UPDATE nos
-- 30 vinculos existentes, NENHUMA normalizacao UPPER, NENHUMA
-- alteracao de frontend.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita. Numeracao 0035 confirmada livre
-- (ultima migration publicada e 0034_unificacao_catalogo_producao.sql).
--
-- ============================================================
-- INVESTIGACAO REALIZADA ANTES DE ESCREVER ESTA MIGRATION (codigo real,
-- nao presumido):
-- ============================================================
--   * excluir_produto_catalogo (migration 0029): SECURITY DEFINER,
--     search_path='', exige auth.uid() + has_permissao(
--     'catalogo_produtos.excluir'), toma FOR UPDATE na linha do produto
--     ANTES de checar dependencia (mesma tecnica de concorrencia
--     reaproveitada aqui), checa 5 tabelas via EXISTS combinado num
--     unico IF, snapshot coluna-a-coluna em logs_auditoria ANTES do
--     DELETE, DELETE, revoke/grant explicitos ao final. Mensagem de
--     bloqueio exata: 'Este produto ja possui utilizacao no sistema e
--     nao pode ser excluido. Deixe-o Inativo caso nao seja mais
--     utilizado.' -- o frontend (pages/catalogo.js,
--     mensagemErroExclusaoProduto) casa por SUBSTRING dessa mensagem
--     ('ja possui utilizacao no sistema') para mostrar texto amigavel.
--     Adicionar o 6o check DENTRO do mesmo IF combinado, reaproveitando
--     a MESMA mensagem, e a unica forma de bloquear produto vinculado a
--     Producao sem exigir nenhuma mudanca de frontend nesta rodada --
--     "possui vinculo com Producao" e "ja possui utilizacao no sistema"
--     sao semanticamente a mesma coisa, e o texto ja orienta corretamente
--     ("Deixe-o Inativo").
--   * Padrao de SECURITY DEFINER vs INVOKER no projeto (reconfirmado por
--     leitura de 0017 e 0030, nao por memoria): RPCs que escrevem numa
--     tabela para a qual o CALLER ja tem policy de RLS de escrita usam
--     SECURITY INVOKER + set search_path='' (editar_producao_registro,
--     criar_lote_expositor, editar_lote_expositor,
--     concluir_retirada_expositor, corrigir_lote_expositor_concluido,
--     excluir_lote_expositor -- todas INVOKER). SECURITY DEFINER e
--     reservado para quando a RLS estruturalmente BLOQUEIA o caller
--     (zero policy de DELETE em produtos/catalogo_secoes/categorias,
--     caso de excluir_produto_catalogo/secao/categoria) ou quando a
--     funcao precisa ler alem do que a RLS do caller permitiria (trigger
--     de soma do expositor). receitas JA TEM policy de INSERT/UPDATE
--     para produtos_producao.editar (receitas_insert_admin/
--     receitas_update_admin, migration 0016, RLS reconfirmada no bloco
--     H desta pre-auditoria) -- logo marcar/desmarcar_produto_producao
--     seguem o padrao INVOKER, nao DEFINER (decisao explicada abaixo).
--   * search_path='' presente em TODAS as funcoes lidas, INVOKER ou
--     DEFINER -- aplicado aqui tambem, sem excecao.
--   * logs_auditoria (migration 0004): trigger BEFORE INSERT exige
--     auth.uid() nao nulo (aborta senao) e preenche usuario_id/nome/
--     email server-side -- funciona identico sob INVOKER ou DEFINER,
--     pois auth.uid() sempre reflete o caller real, nunca o dono da
--     funcao. Padrao de linhas: 1 linha por CAMPO alterado (nao 1 linha
--     por acao), acao em passado ('editou_producao',
--     'lancou_retroativo', 'corrigiu_concluido', 'excluiu'),
--     valor_anterior/valor_novo em texto, null no lado que nao se
--     aplica (criacao: anterior=null; exclusao: novo=null).
--   * RLS atual (reconfirmado, nao presumido): produtos_select_
--     authenticated permite SELECT a qualquer authenticated (using
--     true) -- leitura de produtos dentro das novas RPCs nao precisa de
--     nenhum privilegio elevado. receitas_insert_admin/receitas_update_
--     admin exigem produtos_producao.editar (0016).
--   * codigo_g3 de receitas tem indice UNICO FUNCIONAL parcial
--     (receitas_codigo_g3_unico_idx, migration 0013): unique sobre
--     lower(btrim(codigo_g3)) where codigo_g3 is not null. Copiar
--     produtos.codigo_g3 ao criar uma extensao nova PRECISA checar esse
--     indice antes -- se colidir com outra receita (case-insensitive,
--     btrim), a funcao ABORTA com mensagem especifica de conflito de
--     cadastro (ver RPC 1, CASO 3) -- NUNCA grava NULL para contornar a
--     colisao em silencio. Decisao explicita desta rodada: uma
--     inconsistencia de dado (2 codigo_g3 iguais em Producao) deve ser
--     visivel e bloqueante, nao mascarada.
--   * Schema real de public.receitas reconfirmado via information_schema
--     (Auditoria A, colada pelo usuario): id uuid NOT NULL DEFAULT
--     gen_random_uuid(); nome varchar NOT NULL SEM default (por isso o
--     INSERT do CASO 3 sempre fornece nome, nunca deixa a cargo de um
--     default); controlado_producao boolean NOT NULL DEFAULT false;
--     controlar_expositor boolean NOT NULL DEFAULT false; demais
--     colunas necessarias a criacao minima sao nullable ou tem default
--     -- confirma que o INSERT minimo (catalogo_produto_id, nome,
--     codigo_g3, ativo) e estruturalmente valido, sem violar nenhum
--     NOT NULL nao coberto.
--   * Inativacao de produto no Catalogo HOJE e um UPDATE DIRETO do
--     frontend (components/catalogo/DadosProdutoForm.js, linha
--     ".from('produtos').update(payload)", payload.ativo vindo de um
--     simples toggle no formulario) -- NAO passa por nenhuma RPC. Ver
--     secao "PRODUTO MESTRE INATIVO -- DECISAO REGISTRADA, NAO
--     IMPLEMENTADA" logo abaixo do escopo.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * CREATE OR REPLACE FUNCTION public.marcar_produto_producao(uuid)
--     -- nova;
--   * CREATE OR REPLACE FUNCTION public.desmarcar_produto_producao(uuid)
--     -- nova;
--   * CREATE OR REPLACE FUNCTION public.excluir_produto_catalogo(uuid)
--     -- mesma assinatura de antes (CREATE OR REPLACE simples, sem
--     DROP -- nao muda parametros nem tipo de retorno, logo os grants
--     existentes NAO sao resetados; mesmo assim os grants sao
--     re-declarados abaixo, explicitos, por clareza e para bater com o
--     padrao ja usado em toda alteracao de RPC deste projeto);
--   * revoke/grant explicitos para as 3 funcoes.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhum ALTER TABLE, nenhuma coluna nova, nenhum NOT NULL, nenhuma
--     alteracao de FK/UNIQUE/indice;
--   * nenhum UPDATE nos 30 vinculos ja criados pela 0034;
--   * nenhuma alteracao de frontend;
--   * nenhuma normalizacao UPPER;
--   * nenhuma alteracao em permissoes/perfil_permissoes (os 2 codigos
--     exigidos -- catalogo_produtos.editar e produtos_producao.editar
--     -- ja existem, ja concedidos; nenhum INSERT novo em permissoes).
--
-- ============================================================
-- PRODUTO MESTRE INATIVO -- DECISAO REGISTRADA, NAO IMPLEMENTADA NESTA
-- MIGRATION (nenhum trigger, nenhuma mudanca de frontend/RPC aqui --
-- so documentacao da decisao para a proxima etapa).
-- ============================================================
-- Hoje, inativar um produto no Catalogo e um UPDATE DIRETO do frontend
-- em public.produtos (DadosProdutoForm.js), sem nenhum hook de
-- backend. Isso permite o estado produtos.ativo=false com uma receita
-- vinculada ainda ativo=true -- nao e um bug de integridade (nenhuma
-- FK/constraint e violada), mas precisa de uma decisao de PRODUTO
-- explicita sobre o que deve acontecer.
--
-- Decisao (para implementar numa etapa futura, junto da mudanca de
-- frontend que ainda nao existe -- NAO usar so uma regra de leitura
-- "produto.ativo=true AND receita.ativo=true" como UNICA defesa,
-- porque isso permitiria reativacao IMPLICITA indesejada: produto
-- inativado -> receita permanece ativo=true (nunca tocada) -> produto
-- reativado depois -> volta sozinho a aparecer em Producao, sem
-- nenhuma decisao explicita do usuario naquele momento):
--
--   1. INATIVAR produto mestre: se existir extensao (receitas) ATIVA
--      vinculada, o fluxo futuro deve chamar explicitamente
--      desmarcar_produto_producao(produto_id) (a mesma RPC criada
--      nesta migration, ja preserva receitas.id e todo o historico --
--      nenhuma RPC nova precisara ser criada so para isso) ANTES ou
--      junto do UPDATE de ativo=false em produtos.
--   2. REATIVAR produto mestre: NAO reativar a extensao de Producao
--      automaticamente. O usuario precisa marcar "Produto de Producao"
--      de novo, de proposito, se quiser retomar -- essa e a decisao
--      explicita que substitui a reativacao implicita indesejada.
--   3. Defesa em profundidade nas consultas de Producao (Tela Hoje,
--      listagens, etc.), ALEM do passo 1: sempre filtrar por
--      produtos.ativo=true E receitas.ativo=true juntos, nunca so o
--      segundo -- assim, mesmo que algum caminho externo deixe o
--      estado inconsistente (produto inativo + receita ativa) por
--      qualquer motivo, um produto mestre inativo NUNCA aparece como
--      Producao ativa na leitura, independente do passo 1 ter rodado.
--
-- Esta migration nao implementa nenhum dos 3 passos -- fica registrado
-- aqui para a etapa de frontend que ainda vai vincular o UPDATE de
-- produtos.ativo ao desmarcar_produto_producao.

BEGIN;

-- ============================================================
-- RPC 1 -- marcar_produto_producao: cria ou reativa a extensao de
-- Producao de um produto do Catalogo. SECURITY INVOKER (ver
-- justificativa no cabecalho) -- depende da RLS de receitas
-- (produtos_producao.editar) + checagem explicita adicional de
-- catalogo_produtos.editar, as DUAS exigidas simultaneamente.
--
-- CONCORRENCIA: "select ... for update" na linha de produtos ANTES de
-- checar/escrever a extensao serializa chamadas concorrentes para o
-- MESMO produto_id -- qualquer INSERT/UPDATE de receitas.
-- catalogo_produto_id apontando para este produto precisa, por
-- mecanismo interno do Postgres (RI_FKey_check disparado pela FK em
-- si), tomar um lock FOR KEY SHARE na linha de produtos referenciada
-- ANTES de confirmar seu proprio INSERT/UPDATE -- FOR UPDATE conflita
-- com FOR KEY SHARE, entao duas chamadas simultaneas para o mesmo
-- produto_id sao serializadas pelo proprio banco: a segunda so ve o
-- resultado da primeira depois que ela commitar, e entao cai natural-
-- mente no CASO 1 (ja_ativa) em vez de tentar duplicar o vinculo e
-- esbarrar na UNIQUE. Mesma tecnica ja documentada e usada em
-- excluir_produto_catalogo (migration 0029).
-- ============================================================
create or replace function public.marcar_produto_producao(p_produto_id uuid)
returns table (produto_id uuid, receita_id uuid, ativo boolean, acao text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_produto        public.produtos;
  v_receita        public.receitas;
  v_nova_receita_id uuid;
begin
  if auth.uid() is null then
    raise exception 'marcar_produto_producao: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.editar')) then
    raise exception using errcode = '42501',
      message = 'marcar_produto_producao: requer a permissao catalogo_produtos.editar.';
  end if;

  if not (select public.has_permissao('produtos_producao.editar')) then
    raise exception using errcode = '42501',
      message = 'marcar_produto_producao: requer a permissao produtos_producao.editar.';
  end if;

  if p_produto_id is null then
    raise exception 'marcar_produto_producao: p_produto_id e obrigatorio.';
  end if;

  select * into v_produto from public.produtos where id = p_produto_id for update;
  if v_produto.id is null then
    raise exception 'marcar_produto_producao: produto % nao encontrado.', p_produto_id;
  end if;

  -- Decisao do usuario: produto mestre inativo nao pode ser marcado.
  if v_produto.ativo is distinct from true then
    raise exception 'marcar_produto_producao: produto esta inativo no Catalogo e nao pode ser marcado como Produto de Producao. Ative o produto primeiro.';
  end if;

  select * into v_receita from public.receitas where catalogo_produto_id = p_produto_id;

  -- CASO 1: ja existe extensao ativa -- idempotente. Nenhuma escrita,
  -- nenhum log (nao houve alteracao nenhuma de estado).
  if v_receita.id is not null and v_receita.ativo = true then
    return query select v_produto.id, v_receita.id, true, 'ja_ativa'::text;
    return;
  end if;

  -- CASO 2: ja existe extensao, mas inativa -- REATIVA a MESMA linha
  -- (mesma receitas.id), nunca cria uma segunda. Nao toca em nenhum
  -- outro campo (ficha tecnica, parametros, historico preservados).
  if v_receita.id is not null then
    update public.receitas set ativo = true where id = v_receita.id;

    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('receita', v_receita.id::text, 'reativou_producao', 'ativo', 'false', 'true');

    return query select v_produto.id, v_receita.id, true, 'reativada'::text;
    return;
  end if;

  -- CASO 3: nao existe nenhuma extensao -- cria uma nova, com o MINIMO
  -- necessario. tipo/grupo/temperaturas/tempos/descricao/rendimento/
  -- unidade_medida_saida/controlado_producao/controlar_expositor/
  -- prazo_expositor_dias ficam com o default da coluna (NULL/false,
  -- conforme o caso) -- preenchidos depois, manualmente, em Producao ->
  -- Produtos.
  --
  -- codigo_g3: se o produto tiver codigo_g3 preenchido, PRECISA bater
  -- com o indice unico funcional receitas_codigo_g3_unico_idx (0013:
  -- unique sobre lower(btrim(codigo_g3)), ignora NULL). NAO mascara
  -- colisao gravando NULL -- se ja existir OUTRA receita com o mesmo
  -- codigo (case-insensitive, ignorando espacos de borda, exatamente a
  -- semantica do indice), a funcao ABORTA com mensagem especifica: e
  -- uma inconsistencia de cadastro (2 codigo_g3 iguais em Producao)
  -- que precisa ser corrigida manualmente, nao contornada em silencio.
  -- Se nao houver conflito, copia normalmente. Se o produto nao tiver
  -- codigo_g3, a receita fica com codigo_g3 NULL (nada a copiar).
  if v_produto.codigo_g3 is not null and exists (
    select 1 from public.receitas r
    where lower(btrim(r.codigo_g3)) = lower(btrim(v_produto.codigo_g3))
  ) then
    raise exception 'marcar_produto_producao: ja existe outra receita em Produtos de Producao com o mesmo Codigo G3 (%) deste produto -- corrija o conflito de cadastro antes de vincular.', v_produto.codigo_g3;
  end if;

  insert into public.receitas (catalogo_produto_id, nome, codigo_g3, ativo)
  values (
    p_produto_id,
    v_produto.nome,
    v_produto.codigo_g3,
    true
  )
  returning id into v_nova_receita_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('receita', v_nova_receita_id::text, 'vinculou_producao', 'catalogo_produto_id', null, p_produto_id::text),
    ('receita', v_nova_receita_id::text, 'vinculou_producao', 'nome', null, v_produto.nome),
    ('receita', v_nova_receita_id::text, 'vinculou_producao', 'ativo', null, 'true');

  return query select v_produto.id, v_nova_receita_id, true, 'criada'::text;
end;
$$;

comment on function public.marcar_produto_producao(uuid) is
  'Cria ou reativa a extensao de Producao (public.receitas) de um produto do Catalogo, ligando por catalogo_produto_id. Idempotente: se ja existe extensao ativa, retorna acao=ja_ativa sem escrever nada. Se existe mas inativa, REATIVA a mesma receitas.id (nunca cria uma segunda) e loga reativou_producao. Se nao existe, cria uma extensao minima (nome/codigo_g3 copiados do produto como snapshot inicial; ativo=true; demais campos operacionais ficam com o default da coluna) e loga vinculou_producao. codigo_g3: se o produto tiver codigo_g3 preenchido e ja existir OUTRA receita com o mesmo codigo (case-insensitive, ignorando espacos de borda -- semantica identica ao indice unico funcional receitas_codigo_g3_unico_idx, migration 0013), a funcao ABORTA com mensagem especifica de conflito de cadastro -- NUNCA grava NULL para contornar a colisao em silencio. Exige sessao autenticada + AS DUAS permissoes catalogo_produtos.editar E produtos_producao.editar. Bloqueia se o produto mestre estiver inativo (ativo=false). SECURITY INVOKER: depende das policies de RLS de public.receitas (produtos_producao.editar, migration 0016) e public.produtos (SELECT aberto a authenticated); a checagem dupla de permissao acima e adicional, mais restritiva que a RLS sozinha. FOR UPDATE na linha de produtos serializa chamadas concorrentes para o mesmo produto_id (mesma tecnica de excluir_produto_catalogo, 0029) -- nao ha janela de corrida que produza violacao de UNIQUE(catalogo_produto_id).';

revoke execute on function public.marcar_produto_producao(uuid) from public;
revoke execute on function public.marcar_produto_producao(uuid) from anon;
grant execute on function public.marcar_produto_producao(uuid) to authenticated;


-- ============================================================
-- RPC 2 -- desmarcar_produto_producao: desativa a extensao de
-- Producao de um produto (ativo=false). NUNCA DELETE. Mesmo padrao de
-- seguranca/concorrencia da RPC 1.
-- ============================================================
create or replace function public.desmarcar_produto_producao(p_produto_id uuid)
returns table (produto_id uuid, receita_id uuid, ativo boolean, acao text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_produto public.produtos;
  v_receita public.receitas;
begin
  if auth.uid() is null then
    raise exception 'desmarcar_produto_producao: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.editar')) then
    raise exception using errcode = '42501',
      message = 'desmarcar_produto_producao: requer a permissao catalogo_produtos.editar.';
  end if;

  if not (select public.has_permissao('produtos_producao.editar')) then
    raise exception using errcode = '42501',
      message = 'desmarcar_produto_producao: requer a permissao produtos_producao.editar.';
  end if;

  if p_produto_id is null then
    raise exception 'desmarcar_produto_producao: p_produto_id e obrigatorio.';
  end if;

  select * into v_produto from public.produtos where id = p_produto_id for update;
  if v_produto.id is null then
    raise exception 'desmarcar_produto_producao: produto % nao encontrado.', p_produto_id;
  end if;

  select * into v_receita from public.receitas where catalogo_produto_id = p_produto_id;

  -- Nao existe nenhuma extensao -- idempotente. Nenhuma escrita, nenhum log.
  if v_receita.id is null then
    return query select v_produto.id, null::uuid, false, 'ja_desmarcado'::text;
    return;
  end if;

  -- Ja inativa -- idempotente. Nenhuma escrita, nenhum log.
  if v_receita.ativo = false then
    return query select v_produto.id, v_receita.id, false, 'ja_desmarcado'::text;
    return;
  end if;

  -- Ativa -- desativa. NUNCA DELETE. catalogo_produto_id, receitas.id,
  -- nome, codigo_g3, ficha tecnica, parametros e todo o historico
  -- (producao_registros, planejamento_producao, producao_diaria,
  -- receita_ingredientes, producao_expositor_lotes) permanecem
  -- intocados -- esta funcao so altera a coluna ativo.
  update public.receitas set ativo = false where id = v_receita.id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('receita', v_receita.id::text, 'desativou_producao', 'ativo', 'true', 'false');

  return query select v_produto.id, v_receita.id, false, 'desativada'::text;
end;
$$;

comment on function public.desmarcar_produto_producao(uuid) is
  'Desativa (ativo=false) a extensao de Producao de um produto do Catalogo, identificada por catalogo_produto_id. NUNCA faz DELETE -- historico (producao_registros, planejamento_producao, producao_diaria, receita_ingredientes, producao_expositor_lotes indireto) permanece integro. Idempotente: se nao existe extensao, ou ja esta inativa, retorna acao=ja_desmarcado sem escrever nada nem logar. Exige sessao autenticada + AS DUAS permissoes catalogo_produtos.editar E produtos_producao.editar. SECURITY INVOKER, mesmo padrao de marcar_produto_producao. FOR UPDATE na linha de produtos para concorrencia previsivel.';

revoke execute on function public.desmarcar_produto_producao(uuid) from public;
revoke execute on function public.desmarcar_produto_producao(uuid) from anon;
grant execute on function public.desmarcar_produto_producao(uuid) to authenticated;


-- ============================================================
-- ATUALIZACAO -- excluir_produto_catalogo (migration 0029): adiciona
-- 1 checagem nova (receitas.catalogo_produto_id, ativa OU inativa) ao
-- MESMO IF combinado que ja existe, reaproveitando a MESMA mensagem de
-- erro ('ja possui utilizacao no sistema') -- o frontend
-- (mensagemErroExclusaoProduto) ja mapeia essa substring para texto
-- amigavel, entao NENHUMA mudanca de frontend e necessaria. CREATE OR
-- REPLACE simples (mesma assinatura p_produto_id uuid, mesmo retorno
-- void) -- nao reseta grants existentes, mas revoke/grant sao
-- re-declarados abaixo por clareza, mesmo padrao ja usado em toda
-- alteracao de RPC deste projeto. TODO o resto da funcao permanece
-- byte a byte identico a 0029: SECURITY DEFINER, search_path='',
-- auth.uid()+catalogo_produtos.excluir, FOR UPDATE antes da checagem,
-- snapshot completo em logs_auditoria antes do DELETE, DELETE.
-- ============================================================
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

  select * into v_produto
  from public.produtos
  where id = p_produto_id
  for update;

  if v_produto.id is null then
    raise exception 'excluir_produto_catalogo: produto % nao encontrado.', p_produto_id;
  end if;

  -- 6 tabelas verificadas explicitamente (era 5 ate a 0029; adicionada
  -- receitas.catalogo_produto_id nesta migration, 0035) -- QUALQUER
  -- receita vinculada, ativa OU inativa, bloqueia a exclusao fisica do
  -- produto mestre. A FK receitas_catalogo_produto_id_fkey (ON DELETE
  -- RESTRICT, migration 0034) ja garante isso a nivel de banco -- esta
  -- checagem explicita e so para dar mensagem amigavel em vez de deixar
  -- o erro cru de FK estourar, mesmo raciocinio das outras 5.
  if exists (select 1 from public.cotacoes where produto_id = p_produto_id)
    or exists (select 1 from public.pedido_itens where produto_id = p_produto_id)
    or exists (select 1 from public.produto_fornecedores where produto_id = p_produto_id)
    or exists (select 1 from public.produtos_historico_compras where produto_id = p_produto_id)
    or exists (select 1 from public.receita_ingredientes where produto_id = p_produto_id)
    or exists (select 1 from public.receitas where catalogo_produto_id = p_produto_id)
  then
    raise exception
      'Este produto ja possui utilizacao no sistema e nao pode ser excluido. Deixe-o Inativo caso nao seja mais utilizado.';
  end if;

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
  'Exclui definitivamente um produto do Catalogo, SOMENTE se nao houver nenhum vinculo em cotacoes, pedido_itens, produto_fornecedores, produtos_historico_compras, receita_ingredientes OU receitas (catalogo_produto_id, adicionado na 0035 -- ativa ou inativa, ambas bloqueiam) -- verificado explicitamente no corpo da funcao (nao so via FK, ja que pedido_itens.produto_id e ON DELETE SET NULL e nao bloquearia sozinho). Status ativo/inativo do produto NAO influencia a decisao. RPC-only por desenho: NENHUMA policy de DELETE existe em public.produtos. Exige sessao autenticada + catalogo_produtos.excluir (permissao separada de catalogo_produtos.editar, mesmo raciocinio de pedidos.excluir). Bloqueia a linha do produto (FOR UPDATE) antes de checar vinculos. Snapshot coluna-a-coluna completo em logs_auditoria antes do DELETE (13 das 14 colunas reais de produtos -- todas exceto id, ja coberta por registro_id), mesma transacao. Sem CASCADE, sem SET NULL como estrategia, sem exclusao automatica de nenhuma dependencia -- produto com vinculo deve ser inativado (ativo=false), nunca excluido.';

revoke execute on function public.excluir_produto_catalogo(uuid) from public;
revoke execute on function public.excluir_produto_catalogo(uuid) from anon;
grant execute on function public.excluir_produto_catalogo(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (NAO EXECUTAR -- documentado para referencia futura)
-- ============================================================
-- Reversivel: nenhuma linha de dado e alterada por este arquivo em si
-- (as 2 RPCs novas so escrevem quando efetivamente chamadas depois; a
-- alteracao em excluir_produto_catalogo so muda o COMPORTAMENTO da
-- funcao, nao dado existente). Reverter para o estado da 0029 exige
-- copiar de volta o corpo EXATO da 0029 (sem o 6o EXISTS) via outro
-- CREATE OR REPLACE, e fazer DROP FUNCTION das 2 RPCs novas:
--
-- BEGIN;
--   revoke execute on function public.marcar_produto_producao(uuid) from authenticated;
--   drop function if exists public.marcar_produto_producao(uuid);
--
--   revoke execute on function public.desmarcar_produto_producao(uuid) from authenticated;
--   drop function if exists public.desmarcar_produto_producao(uuid);
--
--   -- excluir_produto_catalogo: recriar com o corpo da 0029 (5 checks,
--   -- sem o 6o de receitas) -- ver supabase/migrations/0029_catalogo_
--   -- exclusao_produto.sql para o texto exato a colar aqui.
-- COMMIT;
--
-- ATENCAO: se qualquer chamada real a marcar_produto_producao ja tiver
-- criado uma extensao (receita) antes do rollback, essa linha de
-- receitas NAO e removida por este rollback (dropar a funcao nao
-- apaga dado ja gravado) -- avaliar caso a caso se deve ser mantida ou
-- removida manualmente.
