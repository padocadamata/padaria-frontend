-- 0027_pedidos_reabrir_recebimento.sql
-- Reabertura administrativa de recebimento: desfaz atomicamente um
-- recebimento lancado errado (migration 0026), devolvendo o pedido para
-- aguardando_entrega -- sem editar diretamente um pedido fechado, sem
-- deixar historico orfao no Catalogo, sem abrir nenhuma brecha de
-- UPDATE/DELETE direto para o frontend comum.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita, e ate a pre-auditoria real
-- confirmar as premissas abaixo. Gerado em scratchpad para revisao
-- estatica, SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0026 ja aplicadas. Numeracao confirmada livre:
-- 0026 e a ultima migration em supabase/migrations/ no momento em que
-- este arquivo foi gerado (confirmado por `ls`), nenhuma 0027 publicada
-- ainda.
--
-- ============================================================
-- O PROBLEMA CENTRAL DESTE DESENHO (leia antes do resto):
-- ============================================================
-- pedidos_protecao (0022) hoje bloqueia INCONDICIONALMENTE qualquer
-- UPDATE em um pedido com status<>aguardando_entrega -- e
-- pedido_itens_protecao (0022) bloqueia INCONDICIONALMENTE qualquer
-- UPDATE/DELETE em item de um pedido que nao esteja aguardando_entrega.
-- A reabertura PRECISA violar as duas coisas de forma controlada (mudar
-- pedidos.status de recebido para aguardando_entrega; limpar 3 campos de
-- pedido_itens enquanto o pedido AINDA e recebido).
--
-- A pergunta de seguranca real nao e "quem tem a permissao
-- pedidos.reabrir_recebimento" -- e "como garantir que SOMENTE a RPC
-- reabrir_recebimento_pedido() consegue abrir essa excecao, mesmo para
-- um usuario que tambem tenha pedidos.editar/receber/cancelar (o que
-- proprietario_admin, unico perfil previsto para reabrir_recebimento,
-- quase certamente tem)". Um `if not has_permissao('pedidos.
-- reabrir_recebimento')` SOZINHO dentro da trigger NAO resolve isso: um
-- UPDATE direto `.from('pedidos').update({status:'aguardando_entrega'})`
-- feito por esse mesmo usuario, via REST comum, satisfaria a policy de
-- UPDATE existente (pedidos_update ja libera para quem tem editar/
-- receber/cancelar) E satisfaria essa checagem de permissao dentro da
-- trigger -- e chegaria ao banco alterando SOMENTE pedidos.status, sem
-- nunca limpar pedido_itens nem excluir o historico do Catalogo. Isso e
-- EXATAMENTE o "historico orfao / dados parcialmente limpos" que a
-- secao 2 do pedido do usuario proibe.
--
-- SOLUCAO ESCOLHIDA: o gate real nao e uma permissao de aplicacao, e a
-- CAPACIDADE ESTRUTURAL do papel que esta executando o UPDATE no exato
-- momento em que a trigger roda -- `(select rolbypassrls from pg_roles
-- where rolname = current_user)`. authenticated e anon NUNCA tem
-- rolbypassrls (confirmado na pre-auditoria da 0026, itens 50/51, e
-- reconfirmado nesta). Uma funcao SECURITY DEFINER cujo owner tenha
-- rolbypassrls (mesmo owner de receber_pedido/excluir_pedido/etc.) faz
-- `current_user` mudar para esse owner PELA DURACAO da chamada,
-- INCLUSIVE dentro de triggers disparadas por statements executados
-- dentro dela (SECURITY INVOKER na trigger so significa "nao mude o
-- papel de novo" -- ela herda o papel JA elevado do contexto que a
-- disparou). Isso NAO e um GUC (nao e nenhum set_config/current_setting
-- customizado, nao pode ser forjado por nenhum papel authenticated/anon
-- via PostgREST) -- e um fato estrutural permanente do papel, o MESMO
-- mecanismo que ja explica por que toda RPC SECURITY DEFINER deste
-- projeto consegue escrever apesar de RLS restritiva. Por isso: SOMENTE
-- uma funcao SECURITY DEFINER alcanca esse ramo da trigger -- nenhum
-- UPDATE direto via REST, de nenhum usuario, com nenhuma combinacao de
-- permissoes, alcanca. has_permissao('pedidos.reabrir_recebimento')
-- continua sendo checada TAMBEM dentro da trigger, como segunda camada
-- redundante (mesmo padrao ja usado em excluir_producao_registro, 0020)
-- -- mas o gate que realmente fecha a brecha e o rolbypassrls.
--
-- Isso responde diretamente a secao 7 do pedido do usuario ("Evite GUC
-- improvisado, bypass geral ou relaxamento permanente"): rolbypassrls
-- nao e um GUC, nao e um bypass geral (so libera esta transicao exata,
-- old.status=recebido -> new.status=aguardando_entrega, e simetricamente
-- so libera limpar os 3 campos de recebimento em pedido_itens quando o
-- pedido-pai ainda e recebido), e nao e permanente (continua bloqueado
-- para todo mundo fora desse contexto exato, para sempre).
--
-- PRECISAO IMPORTANTE (revisao pos-aprovacao conceitual): rolbypassrls
-- identifica "esta chamada roda sob o contexto elevado de ALGUMA funcao
-- SECURITY DEFINER cujo owner tenha rolbypassrls" -- NAO identifica
-- exclusivamente reabrir_recebimento_pedido(). Qualquer OUTRA funcao
-- SECURITY DEFINER com o MESMO owner que um dia emitisse um UPDATE
-- compativel com um dos dois ramos novos tambem passaria por este
-- teste. A frase "SOMENTE uma funcao SECURITY DEFINER alcanca esse
-- ramo" (acima) e verdadeira e continua sendo o gate real -- mas "esse
-- ramo so e alcancavel por reabrir_recebimento_pedido()" e uma
-- afirmacao mais forte, que so vale porque foi AUDITADA e confirmada
-- para o conjunto de funcoes que existe HOJE (ver inventario abaixo),
-- nao porque o mecanismo garanta isso para sempre, automaticamente.
--
-- ============================================================
-- INVENTARIO DE FUNCOES SECURITY DEFINER (auditoria estatica, 0001..0026)
-- ============================================================
-- Toda funcao SECURITY DEFINER versionada ate a 0026, o que ela altera,
-- e se poderia produzir um dos dois UPDATEs que os novos ramos liberam
-- (recebido->aguardando_entrega em pedidos; limpar unidade_recebida/
-- quantidade_recebida/valor_unitario_recebido para NULL em pedido_itens
-- enquanto o pedido-pai ainda e recebido):
--
--   registrar_acesso() (0002) -- altera logs_acessos/usuarios. Nao toca
--     pedidos/pedido_itens. SEM RISCO.
--   is_admin(), has_permissao(perm) (0003/0016) -- somente leitura,
--     nenhum INSERT/UPDATE/DELETE. SEM RISCO.
--   logs_auditoria_preencher_usuario() (0004) -- trigger BEFORE INSERT
--     de logs_auditoria, so seta 3 colunas dessa mesma tabela. Nao toca
--     pedidos/pedido_itens. SEM RISCO.
--   producao_registros_protecao() (0010/0015/0019) -- trigger de
--     producao_registros. Nao toca pedidos/pedido_itens. SEM RISCO.
--   usuarios_protecao_ultimo_admin() (0016) -- trigger de usuarios. Nao
--     toca pedidos/pedido_itens. SEM RISCO.
--   dashboard_lembretes_preencher_usuario() (0021) -- trigger de
--     dashboard_lembretes. Nao toca pedidos/pedido_itens. SEM RISCO.
--   pedido_itens_protecao() (0022, alterada nesta 0027) -- e a PROPRIA
--     trigger que contem um dos ramos -- so LE pedidos.status (select),
--     nunca emite UPDATE/DELETE nela mesma. Nao e uma funcao que
--     "chama" outra coisa -- e o alvo da auditoria, nao um candidato a
--     colisao.
--   pedido_itens_impedir_pedido_vazio() (0022/0025) -- constraint
--     trigger AFTER DELETE em pedido_itens, so valida contagem, nunca
--     emite UPDATE em pedidos nem em pedido_itens. SEM RISCO.
--   criar_pedido(...) (0022) -- SOMENTE INSERT em pedidos/pedido_itens
--     (linhas novas). Nunca UPDATE de status nem dos campos de
--     recebimento de uma linha existente. SEM RISCO.
--   excluir_pedido(uuid) (0025) -- SOMENTE DELETE em pedidos/
--     pedido_itens (via SET CONSTRAINTS, ja auditado na propria 0025).
--     Nunca UPDATE. SEM RISCO.
--   excluir_produto_fornecedor(uuid), excluir_historico_compra_manual(uuid)
--     (0025) -- alteram produto_fornecedores/produtos_historico_compras
--     (so origem=manual). Nao tocam pedidos/pedido_itens. SEM RISCO.
--   receber_pedido(uuid,date,jsonb) (0026) -- UPDATE em pedido_itens
--     (mas so SETA valores nao-nulos, nunca limpa para NULL, e so roda
--     enquanto o pedido ainda e aguardando_entrega -- pedido_itens_
--     protecao ja bloquearia de qualquer forma se o pedido fosse
--     recebido); UPDATE em pedidos SET status='recebido' (unica direcao
--     -- aguardando_entrega->recebido -- NUNCA recebido->
--     aguardando_entrega). Nenhum dos dois UPDATEs desta funcao bate
--     com nenhum dos dois ramos novos. SEM RISCO, confirmado por leitura
--     linha a linha do corpo real (0026, secoes 1 e 5 da RPC).
--
-- CONCLUSAO DA AUDITORIA: nenhuma funcao SECURITY DEFINER hoje
-- versionada, alem de reabrir_recebimento_pedido() (esta migration),
-- emite um UPDATE que bata com qualquer um dos dois ramos novos. A
-- afirmacao "so reabrir_recebimento_pedido() alcanca esses ramos" e
-- verdadeira HOJE, como FATO AUDITADO -- nao como propriedade
-- estrutural automatica.
--
-- CHECKLIST PARA MANTER ESSA INVARIANTE (aplicar sempre que uma NOVA
-- funcao SECURITY DEFINER for criada, tocando pedidos ou pedido_itens):
--   1. Ela emite `UPDATE pedidos SET status = 'aguardando_entrega' ...`
--      a partir de uma linha com status ANTERIOR = 'recebido'? Se sim,
--      precisa do MESMO nivel de auditoria/justificativa que esta RPC.
--   2. Ela emite `UPDATE pedido_itens SET unidade_recebida = null,
--      quantidade_recebida = null, valor_unitario_recebido = null ...`
--      (ou qualquer subconjunto que zere esses campos) enquanto o
--      pedido-pai ainda e 'recebido'? Mesma exigencia.
--   3. Se nenhuma das duas, nenhuma acao adicional e necessaria -- os
--      dois ramos novos permanecem inalcancaveis por ela.
--
-- ============================================================
-- ALTERNATIVAS AVALIADAS PARA O GATE (risco x complexidade)
-- ============================================================
--   A) rolbypassrls(current_user) + has_permissao(...) -- ESCOLHIDA.
--      Custo: zero infraestrutura nova (usa um fato de catalogo ja
--      existente, mesmo mecanismo queja sustenta TODA RPC SECURITY
--      DEFINER deste projeto). Risco residual: colisao com uma FUTURA
--      funcao SECURITY DEFINER de mesmo owner que emita, por acidente
--      ou displicencia, um UPDATE compativel -- mitigado por (i)
--      has_permissao() como segunda camada, (ii) o escopo de coluna
--      extremamente estreito dos dois ramos (so essa transicao exata;
--      so esses 3 campos indo para NULL, nada mais), tornando uma
--      colisao ACIDENTAL improvavel na pratica, e (iii) o checklist
--      acima, que transforma o risco remanescente em disciplina de
--      revisao (ja em uso neste projeto para toda RPC SECURITY DEFINER
--      nova, ver o proprio processo desta conversa).
--   B) Owner/papel dedicado exclusivo para reabrir_recebimento_pedido()
--      (CREATE ROLE novo, ALTER ROLE ... BYPASSRLS, ALTER FUNCTION ...
--      OWNER TO ...; gate vira `current_user = 'papel_dedicado'`,
--      genuinamente exclusivo hoje). REJEITADA nesta rodada: introduz
--      um NOVO conceito operacional permanente (mais um papel para
--      criar/proteger/lembrar de recriar em qualquer ambiente novo do
--      Supabase, distinto do unico owner elevado que todo o resto do
--      projeto ja usa) por um ganho marginal -- a exclusividade so vale
--      enquanto NENHUMA outra funcao futura for deliberadamente
--      atribuida a esse MESMO papel dedicado, ou seja, o mesmo tipo de
--      disciplina de revisao (checklist acima) continua sendo
--      necessaria, so que agora sobre um papel a mais em vez de sobre
--      "funcoes que tocam pedidos". Complexidade real, sem eliminar a
--      categoria de risco, so reduzir a superficie atual (que ja e
--      zero, por auditoria).
--   C) Mecanismo transacional mais especifico (ex.: advisory lock
--      tomado pela RPC e conferido pela trigger via pg_locks, com uma
--      chave especifica por pedido/operacao). Tecnicamente possivel e
--      nao seria um GUC -- mas adiciona uma categoria de bug nova
--      (colisao de chave de lock, timing, necessidade de liberar o
--      lock em toda saida da funcao) para um ganho de seguranca
--      equivalente ao que rolbypassrls ja da (nenhuma das duas formas
--      e alcancavel por um cliente authenticated/anon via REST comum --
--      a diferenca entre A e C so aparece no cenario ja fora de escopo
--      de "outra funcao SECURITY DEFINER escrita displicentemente",
--      onde C tampouco e imune: bastaria essa outra funcao tomar o
--      MESMO advisory lock). REJEITADA: mais complexidade, sem reduzir
--      o risco residual real de forma proporcional.
--
-- DECISAO: mantida a alternativa A, com a documentacao acima corrigida
-- para nao afirmar exclusividade estrutural onde so ha exclusividade
-- auditada -- exatamente o pedido desta rodada de revisao.
--
-- ============================================================
-- 1) O QUE E DESFEITO NA REABERTURA (RPC reabrir_recebimento_pedido):
-- ============================================================
-- Uma unica transacao (a propria chamada da funcao):
--   a) localiza e BLOQUEIA o pedido (FOR UPDATE);
--   b) valida sessao autenticada + permissao pedidos.reabrir_recebimento;
--   c) valida status=recebido;
--   d) monta o SNAPSHOT completo (pedido + itens + historicos que serao
--      removidos) e grava em logs_auditoria ANTES de qualquer exclusao/
--      limpeza (secao 4 abaixo);
--   e) exclui de produtos_historico_compras todo registro
--      origem='recebimento_pedido' vinculado a QUALQUER pedido_item_id
--      deste pedido (nunca toca em origem='manual', nunca toca em
--      historico de outro pedido -- o filtro e sempre por
--      pedido_item_id, nunca por produto_id/fornecedor_id sozinhos);
--   f) limpa em pedido_itens, SOMENTE para os itens deste pedido:
--      unidade_recebida/quantidade_recebida/valor_unitario_recebido =
--      NULL (valor_total_recebido, coluna GENERATED, volta a NULL
--      automaticamente -- nunca e tocado diretamente, estruturalmente
--      impossivel divergir);
--   g) transiciona pedidos.status de recebido para aguardando_entrega,
--      com recebido_em limpo (NULL) pela propria trigger
--      pedidos_protecao (nunca setado explicitamente pela RPC).
-- Qualquer falha em qualquer etapa desfaz a transacao inteira (mesma
-- garantia de receber_pedido/excluir_pedido -- uma unica chamada de
-- funcao plpgsql e uma unica transacao no Postgres).
--
-- ============================================================
-- 2) HISTORICO DO CATALOGO -- exclusao cirurgica
-- ============================================================
-- Filtro: `pedido_item_id = any(v_ids_itens) and origem =
-- 'recebimento_pedido'`. v_ids_itens vem de `select array_agg(id) from
-- pedido_itens where pedido_id = p_pedido_id` -- ou seja, o vinculo e
-- SEMPRE por pedido_item_id (nunca por produto_id/fornecedor_id
-- isolados), que so pode apontar para itens DESTE pedido especifico.
-- Historico origem='manual' nunca tem pedido_item_id preenchido (CHECK
-- produtos_historico_compras_origem_pedido_item_coerente_check, 0026) --
-- estruturalmente fora do escopo do DELETE, sem precisar de nenhum
-- filtro adicional por origem alem do ja presente. Historico de OUTRO
-- pedido nunca compartilha pedido_item_id com este (FK para
-- pedido_itens(id), chave unica por natureza) -- estruturalmente
-- impossivel de atingir por engano.
--
-- Apos a exclusao, o indice unico parcial
-- produtos_historico_compras_pedido_item_id_unico_idx (0026) deixa de
-- ter qualquer linha para aqueles pedido_item_id -- um receber_pedido()
-- futuro para o MESMO item (apos reaberto, editado se necessario, e
-- recebido de novo) insere uma linha NOVA sem nenhum conflito de
-- unicidade, exatamente como antes do primeiro recebimento. Verificado
-- por leitura direta da definicao do indice (0026) -- nao presumido.
--
-- Nenhuma DELETE POLICY nova e criada em produtos_historico_compras.
-- Confirmado por leitura direta da 0023: a tabela so tem policies de
-- SELECT/INSERT/UPDATE -- NENHUMA de DELETE existe hoje, e
-- produtos_historico_compras_protecao (trigger) so trata tg_op IN
-- ('INSERT','UPDATE') -- DELETE nunca passou por ela. Com RLS habilitada
-- e zero policy de DELETE, `authenticated` nao consegue apagar NENHUMA
-- linha por SQL direto, independente de qualquer GRANT de tabela
-- (RLS filtra para zero linhas visiveis/afetaveis) -- exclusao
-- permanece RPC-only por construcao, mesmo padrao ja aprovado para
-- excluir_produto_fornecedor/excluir_historico_compra_manual (0025).
-- Esta migration NAO adiciona nenhuma policy de DELETE a esta tabela.
--
-- ============================================================
-- 3) AUDITORIA -- evento pedido_recebimento_reaberto
-- ============================================================
-- logs_auditoria (0004): id, usuario_id/usuario_nome/usuario_email
-- (auto-preenchidos pela trigger logs_auditoria_preencher_usuario,
-- SECURITY DEFINER, ignora qualquer valor enviado -- por isso a RPC
-- nunca tenta setar usuario_id manualmente), data_hora (default now()),
-- entidade, registro_id, acao, campo, valor_anterior/valor_novo (text).
-- Mesmo padrao ja usado por excluir_pedido (0025): UM registro,
-- entidade='pedido', registro_id=p_pedido_id, acao=
-- 'pedido_recebimento_reaberto', valor_anterior = snapshot JSON
-- serializado como text (cast ::text -- a coluna e text, nao jsonb).
--
-- Snapshot contem, montado ANTES de qualquer DELETE/UPDATE destrutivo:
--   * pedido: linha completa de public.pedidos no momento da reabertura
--     (inclui status='recebido', recebido_em ainda preenchido);
--   * itens: todas as linhas de pedido_itens deste pedido, com os dados
--     efetivos AINDA presentes (unidade_recebida/quantidade_recebida/
--     valor_unitario_recebido/valor_total_recebido);
--   * historicos_removidos: todas as linhas de
--     produtos_historico_compras que estao prestes a ser excluidas
--     (origem='recebimento_pedido' vinculadas a este pedido);
--   * usuario: auth.uid() explicito dentro do JSON, ALEM do usuario_id
--     ja automatico da tabela (redundante de proposito -- fica visivel
--     mesmo so lendo valor_anterior, sem precisar de outra coluna);
--   * reaberto_em: now() explicito dentro do JSON (redundante com
--     data_hora da propria linha, mesma razao acima).
--
-- QUANDO O INSERT EFETIVAMENTE ACONTECE (revisao pos-aprovacao
-- conceitual): o `insert into logs_auditoria` roda logo apos as duas
-- SELECT que montam o snapshot, e ANTES do DELETE em
-- produtos_historico_compras e dos dois UPDATE (pedido_itens, pedidos)
-- -- mesma ordem ja usada e aprovada em excluir_pedido (0025: "Snapshot
-- AGREGADO... em UM registro de logs_auditoria... antes de qualquer
-- DELETE"). Isso NAO enfraquece a garantia pedida ("se a RPC falhar
-- posteriormente, o proprio rollback deve tambem desfazer o log"): toda
-- a funcao roda dentro de UMA UNICA transacao (a propria chamada RPC) --
-- um RAISE EXCEPTION em QUALQUER ponto posterior (DELETE, UPDATE de
-- pedido_itens, UPDATE de pedidos, ou mesmo uma falha inesperada dentro
-- de uma das triggers disparadas por esses UPDATEs) desfaz TUDO que ja
-- rodou antes dele na mesma transacao, o INSERT em logs_auditoria
-- incluido -- independente de o INSERT estar antes ou depois das
-- operacoes destrutivas no CORPO da funcao. A garantia vem da semantica
-- de transacao do Postgres, nao da ordem dos statements; a ordem
-- escolhida (log logo apos montar o snapshot) e so por consistencia com
-- o precedente ja aprovado da 0025, e porque monta o JSON exatamente
-- uma vez, no ponto em que os dados originais ainda estao disponiveis
-- nas variaveis locais (nao precisa reler nada do banco depois).
-- Sem essa riqueza NAO seria possivel provar depois o que exatamente foi
-- desfeito -- exatamente o que a secao 4 do pedido do usuario exige
-- ("nao registrar apenas mensagem generica").
--
-- ============================================================
-- 4) PERMISSAO NOVA -- pedidos.reabrir_recebimento
-- ============================================================
-- Decisao: SIM, permissao nova (nao reutilizar pedidos.receber).
-- Justificativa: desfazer um recebimento ja confirmado (com historico
-- real de compra ja gerado no Catalogo) e uma operacao objetivamente
-- mais sensivel e menos frequente que simplesmente receber -- mesma
-- logica ja aplicada para separar pedidos.excluir de pedidos.editar na
-- 0025 (excluir e mais sensivel que editar, apesar de tocar a mesma
-- tabela). Reutilizar pedidos.receber faria qualquer pessoa autorizada a
-- RECEBER pedidos tambem poder DESFAZER recebimentos alheios -- papeis
-- operacionais diferentes na pratica (quem recebe mercadoria no dia a
-- dia normalmente nao deveria poder apagar historico de compra ja
-- lancado). Seedada apenas para proprietario_admin nesta migration,
-- grantavel para outros perfis no futuro via perfil_permissoes (mesmo
-- padrao de pedidos.excluir, 0025) -- nenhuma mudanca de schema
-- necessaria para isso depois.
--
-- ============================================================
-- 5) PEDIDO LEGADO (recebido antes da 0026, sem dados detalhados)
-- ============================================================
-- reabrir_recebimento_pedido() NAO exige nenhum dado de recebimento
-- preexistente. v_ids_itens sempre existe (pedido_itens_impedir_pedido_
-- vazio_trigger, 0022, garante >=1 item por pedido, sempre). O DELETE em
-- produtos_historico_compras filtrado por pedido_item_id simplesmente
-- afeta 0 linhas quando nao ha nenhum historico origem=recebimento_pedido
-- vinculado (caso de um pedido legado, ou de um pedido cujos itens nunca
-- tinham produto_id) -- nao e erro, nao precisa de nenhum IF especial. O
-- UPDATE que limpa unidade_recebida/quantidade_recebida/
-- valor_unitario_recebido para NULL tambem e seguro quando esses campos
-- JA sao NULL (idempotente, nenhuma mudanca real, nenhum erro). Nenhuma
-- logica especifica de pedido/caso e necessaria -- o desenho e uniforme
-- por construcao.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * public.pedidos_protecao(): CREATE OR REPLACE -- adiciona UM ramo
--     novo (transicao recebido -> aguardando_entrega, gate rolbypassrls
--     + has_permissao), posicionado ANTES do bloqueio geral de pedido
--     finalizado; resto da funcao byte-a-byte identico;
--   * public.pedido_itens_protecao(): CREATE OR REPLACE -- adiciona UM
--     ramo novo (limpeza dos 3 campos de recebimento quando o
--     pedido-pai ainda e recebido, mesmo gate); resto identico;
--   * public.permissoes: 1 linha nova (pedidos.reabrir_recebimento);
--   * public.perfil_permissoes: 1 linha nova (proprietario_admin ->
--     pedidos.reabrir_recebimento);
--   * public.reabrir_recebimento_pedido(uuid) -- NOVA, SECURITY DEFINER.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma policy de UPDATE/DELETE nova em pedidos/pedido_itens/
--     produtos_historico_compras (a RPC e SECURITY DEFINER, bypassa RLS
--     para suas proprias escritas; nenhuma policy adicional e
--     necessaria nem desejada);
--   * NAO adiciona pedidos.reabrir_recebimento a pedidos_update (a
--     policy de UPDATE existente) -- deliberado, ver secao "problema
--     central" acima;
--   * nenhuma alteracao em produtos_historico_compras_protecao (DELETE
--     nunca passou por ela, nada muda);
--   * nenhuma alteracao em receber_pedido, marcar_pedido_recebido,
--     cancelar_pedido, criar_pedido, excluir_pedido,
--     pedido_itens_impedir_pedido_vazio;
--   * nenhuma migration 0028 (a remocao/revogacao futura de
--     marcar_pedido_recebido continua para depois, sem relacao tecnica
--     com esta migration -- nao ha motivo para misturar);
--   * nenhuma logica especifica de um pedido/id particular;
--   * nenhuma alteracao de frontend.

BEGIN;

-- ============================================================
-- 1. public.pedidos_protecao() -- CREATE OR REPLACE: novo ramo de
--    reabertura, gate estrutural rolbypassrls + has_permissao
-- ============================================================
create or replace function public.pedidos_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mudou_status boolean;
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'pedidos: id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'pedidos: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'pedidos: criado_em e imutavel.';
    end if;

    new.atualizado_em := now();

    -- REABERTURA (recebido -> aguardando_entrega) -- UNICA excecao ao
    -- bloqueio de pedido finalizado abaixo. O gate rolbypassrls abaixo
    -- identifica "esta chamada roda sob o contexto elevado de ALGUMA
    -- funcao SECURITY DEFINER cujo owner tenha rolbypassrls" -- NAO
    -- identifica exclusivamente reabrir_recebimento_pedido() (qualquer
    -- outra funcao SECURITY DEFINER com o MESMO owner tambem passaria
    -- por este teste, se algum dia emitisse um UPDATE compativel).
    -- Auditado em 0027 (secao "INVENTARIO DE FUNCOES SECURITY DEFINER"
    -- no cabecalho desta migration): NENHUMA outra funcao deste schema
    -- emite hoje um UPDATE que bata com esta transicao exata -- isso e
    -- um FATO verificado por auditoria estatica, nao uma garantia
    -- estrutural automatica, e precisa ser reconferido sempre que uma
    -- nova funcao SECURITY DEFINER tocar pedidos/pedido_itens (ver
    -- checklist no cabecalho). has_permissao() aqui e segunda camada
    -- redundante -- reduz ainda mais a chance de colisao futura, mas
    -- nao e o que torna este ramo inalcancavel por REST comum (isso e
    -- rolbypassrls, unico fator que nenhum papel authenticated/anon
    -- jamais satisfaz).
    if old.status = 'recebido' and new.status = 'aguardando_entrega' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedidos: reabertura de recebimento so pode ser feita via reabrir_recebimento_pedido().';
      end if;
      if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
        raise exception 'pedidos: reabrir recebimento requer a permissao pedidos.reabrir_recebimento.';
      end if;

      new.recebido_em := null;

      if new.fornecedor_id is distinct from old.fornecedor_id
        or new.data_pedido is distinct from old.data_pedido
        or new.previsao_entrega is distinct from old.previsao_entrega
        or new.observacoes is distinct from old.observacoes
        or new.cancelado_em is distinct from old.cancelado_em
        or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
        raise exception 'pedidos: reabertura deve alterar somente status/recebido_em.';
      end if;

      -- Sem insert em logs_auditoria aqui de proposito -- o snapshot
      -- rico (pedido+itens+historicos removidos) e responsabilidade
      -- exclusiva de reabrir_recebimento_pedido(), que ja tem toda essa
      -- informacao em mãos ANTES de chegar a este UPDATE (mesmo
      -- raciocinio de excluir_pedido, 0025, que tambem loga a partir da
      -- propria RPC em vez de deixar para uma trigger generica).
      return new;
    end if;

    -- Pedido finalizado (recebido ou cancelado) e imutavel -- nenhum
    -- UPDATE passa daqui pra frente, nem para "so corrigir uma
    -- observacao". Bloqueia tanto receber->cancelar/cancelar->receber
    -- quanto qualquer edicao comum de um pedido ja finalizado. O ramo de
    -- reabertura acima e a UNICA excecao, e so alcancavel como descrito.
    if old.status <> 'aguardando_entrega' then
      raise exception 'pedidos: pedido % ja esta finalizado (status=%), nao pode ser alterado.', old.id, old.status;
    end if;

    v_mudou_status := new.status <> old.status;

    if v_mudou_status then
      if new.status = 'recebido' then
        if not (select public.has_permissao('pedidos.receber')) then
          raise exception 'pedidos: marcar como recebido requer a permissao pedidos.receber.';
        end if;

        new.recebido_em := now();

        if new.fornecedor_id is distinct from old.fornecedor_id
          or new.data_pedido is distinct from old.data_pedido
          or new.previsao_entrega is distinct from old.previsao_entrega
          or new.observacoes is distinct from old.observacoes
          or new.cancelado_em is distinct from old.cancelado_em
          or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
          raise exception 'pedidos: recebimento deve alterar somente status/recebido_em.';
        end if;

        insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
        values ('pedido', new.id::text, 'recebeu', 'recebido_em=' || new.recebido_em::text);

      elsif new.status = 'cancelado' then
        if not (select public.has_permissao('pedidos.cancelar')) then
          raise exception 'pedidos: cancelar requer a permissao pedidos.cancelar.';
        end if;
        if new.motivo_cancelamento is null or btrim(new.motivo_cancelamento) = '' then
          raise exception 'pedidos: motivo do cancelamento e obrigatorio.';
        end if;

        new.cancelado_em := now();
        new.motivo_cancelamento := btrim(new.motivo_cancelamento);

        if new.fornecedor_id is distinct from old.fornecedor_id
          or new.data_pedido is distinct from old.data_pedido
          or new.previsao_entrega is distinct from old.previsao_entrega
          or new.observacoes is distinct from old.observacoes
          or new.recebido_em is distinct from old.recebido_em then
          raise exception 'pedidos: cancelamento deve alterar somente status/cancelado_em/motivo_cancelamento.';
        end if;

        insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
        values ('pedido', new.id::text, 'cancelou', new.motivo_cancelamento);

      else
        raise exception 'pedidos: transicao de status invalida (% -> %).', old.status, new.status;
      end if;

    else
      if not (select public.has_permissao('pedidos.editar')) then
        raise exception 'pedidos: editar requer a permissao pedidos.editar.';
      end if;
      if new.recebido_em is distinct from old.recebido_em
        or new.cancelado_em is distinct from old.cancelado_em
        or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
        raise exception 'pedidos: estes campos so mudam via marcar_pedido_recebido/cancelar_pedido.';
      end if;
    end if;

    return new;
  end if;

  return null;
end;
$$;

comment on function public.pedidos_protecao() is
  'BEFORE INSERT/UPDATE em pedidos. INSERT: forca criado_por/criado_em/atualizado_em. UPDATE: bloqueia id/criado_por/criado_em imutaveis, forca atualizado_em, bloqueia qualquer alteracao de pedido finalizado (status<>aguardando_entrega) -- EXCETO a transicao recebido->aguardando_entrega, liberada somente quando o papel efetivo tem rolbypassrls (identifica contexto elevado de alguma funcao SECURITY DEFINER -- hoje, comprovadamente so reabrir_recebimento_pedido() emite um UPDATE compativel, ver auditoria no cabecalho da 0027; reconferir a cada nova funcao SECURITY DEFINER que toque pedidos) e a permissao pedidos.reabrir_recebimento; exige pedidos.receber/pedidos.cancelar para as respectivas transicoes normais (forcando recebido_em/cancelado_em e gravando a auditoria correspondente em logs_auditoria dentro desta mesma trigger); exige pedidos.editar para edicao comum e bloqueia essa edicao de tocar em recebido_em/cancelado_em/motivo_cancelamento fora de uma transicao formal.';

-- Trigger em si (nome, evento, timing) NAO muda -- so o CORPO da funcao.


-- ============================================================
-- 2. public.pedido_itens_protecao() -- CREATE OR REPLACE: novo ramo,
--    limpeza estreita dos 3 campos de recebimento durante a reabertura
-- ============================================================
create or replace function public.pedido_itens_protecao()
returns trigger
language plpgsql
security definer  -- le public.pedidos independente de quem chama ter
                   -- pedidos.visualizar; mesmo motivo de
                   -- logs_auditoria_preencher_usuario precisar ler auth.users
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.atualizado_em := now();

    select status into v_status from public.pedidos where id = new.pedido_id;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel inserir item em pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return new;

  elsif tg_op = 'UPDATE' then
    if new.pedido_id is distinct from old.pedido_id then
      raise exception 'pedido_itens: pedido_id e imutavel -- um item nao pode ser movido entre pedidos.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'pedido_itens: criado_em e imutavel.';
    end if;

    new.atualizado_em := now();

    select status into v_status from public.pedidos where id = old.pedido_id;

    -- REABERTURA: excecao estreita -- permite limpar SOMENTE os 3
    -- campos de recebimento de um item cujo pedido-pai AINDA esta
    -- status=recebido (a transicao do pedido em si so acontece DEPOIS,
    -- ver reabrir_recebimento_pedido()). Mesmo gate estrutural de
    -- pedidos_protecao -- rolbypassrls identifica "contexto elevado de
    -- ALGUMA funcao SECURITY DEFINER", nao exclusivamente esta RPC (ver
    -- nota completa no ramo equivalente de pedidos_protecao, acima
    -- nesta mesma migration, e o inventario no cabecalho). Qualquer
    -- outro campo mudando, ou os campos de recebimento sendo setados
    -- para NAO-NULL nesta janela, e rejeitado -- essa excecao so serve
    -- para LIMPAR, nunca para editar.
    if v_status = 'recebido' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
      end if;
      if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
        raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
      end if;
      if new.produto_id is distinct from old.produto_id
        or new.descricao is distinct from old.descricao
        or new.quantidade_pedida is distinct from old.quantidade_pedida
        or new.unidade is distinct from old.unidade
        or new.valor_unitario is distinct from old.valor_unitario
        or new.observacao is distinct from old.observacao then
        raise exception 'pedido_itens: reabertura de recebimento so pode limpar os campos de recebimento.';
      end if;
      if new.unidade_recebida is not null or new.quantidade_recebida is not null or new.valor_unitario_recebido is not null then
        raise exception 'pedido_itens: reabertura de recebimento deve limpar os campos de recebimento (definir como NULL).';
      end if;
      return new;
    end if;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    select status into v_status from public.pedidos where id = old.pedido_id;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return old;
  end if;

  return null;
end;
$$;

comment on function public.pedido_itens_protecao() is
  'BEFORE INSERT/UPDATE/DELETE em pedido_itens, TG_OP explicito. Forca criado_em/atualizado_em; bloqueia pedido_id e criado_em imutaveis; bloqueia qualquer INSERT/UPDATE/DELETE quando o pedido-pai (public.pedidos.status) nao esta aguardando_entrega -- EXCETO um UPDATE que limpa SOMENTE unidade_recebida/quantidade_recebida/valor_unitario_recebido (para NULL) enquanto o pedido-pai ainda e recebido, liberado apenas quando o papel efetivo tem rolbypassrls (identifica contexto elevado de alguma funcao SECURITY DEFINER -- hoje, comprovadamente so reabrir_recebimento_pedido() emite um UPDATE compativel, ver auditoria no cabecalho da 0027) e a permissao pedidos.reabrir_recebimento. SECURITY DEFINER para ler pedidos.status independente da RLS de SELECT de pedidos do chamador.';

revoke execute on function public.pedido_itens_protecao() from public;

-- Trigger em si (nome, evento, timing) NAO muda -- so o CORPO da funcao.


-- ============================================================
-- 3. Permissao nova: pedidos.reabrir_recebimento
-- ============================================================
-- ON CONFLICT DO NOTHING nos dois INSERTs abaixo -- torna o seed
-- idempotente (seguro reexecutar a migration inteira sem erro). Nota
-- honesta: o precedente literal da 0025 (seed de pedidos.excluir) NAO
-- tinha ON CONFLICT -- dependia so da disciplina de aplicar cada
-- migration exatamente uma vez. Aqui e um reforco deliberado, estritamente
-- mais seguro (protege contra uma reexecucao acidental sem mudar o
-- resultado de uma aplicacao normal), nao uma mudanca de comportamento.
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('pedidos.reabrir_recebimento', 'pedidos', 'reabrir_recebimento',
   'Desfazer atomicamente o recebimento de um pedido (via reabrir_recebimento_pedido()), removendo o historico de compra gerado no Catalogo e devolvendo o pedido para aguardando_entrega. Acao sensivel -- desfaz compra real ja registrada -- separada de pedidos.receber de proposito.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo = 'pedidos.reabrir_recebimento'
on conflict do nothing;


-- ============================================================
-- 4. RPC reabrir_recebimento_pedido -- desfazimento atomico do
--    recebimento
-- ============================================================
-- SECURITY DEFINER -- necessario tanto para a escrita em si (nenhuma
-- policy de UPDATE/DELETE cobre este fluxo com pedidos.
-- reabrir_recebimento sozinho) quanto para SER o mecanismo que faz
-- current_user ter rolbypassrls dentro das trigger disparadas por suas
-- proprias escritas (ver "O PROBLEMA CENTRAL DESTE DESENHO" no
-- cabecalho). RISCO DOCUMENTADO (mesmo aviso ja registrado para as
-- demais RPCs SECURITY DEFINER deste projeto): se o OWNER desta funcao
-- for alterado para um papel sem rolbypassrls, toda chamada passa a
-- falhar (tanto pela propria RLS quanto pelo gate das triggers acima),
-- sem nenhuma mudanca de codigo visivel.
create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido               public.pedidos%rowtype;
  v_ids_itens            uuid[];
  v_snapshot_itens       jsonb;
  v_snapshot_historicos  jsonb;
begin
  -- 1) sessao autenticada + permissao -- portao explicito de aplicacao
  --    (redundante com o gate estrutural das triggers, defesa em
  --    profundidade, mesmo padrao das demais RPCs deste modulo).
  if auth.uid() is null then
    raise exception 'reabrir_recebimento_pedido: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
    raise exception using errcode = '42501',
      message = 'reabrir_recebimento_pedido: requer a permissao pedidos.reabrir_recebimento.';
  end if;

  -- 2) localiza e BLOQUEIA o pedido -- mesma razao de receber_pedido/
  --    excluir_pedido: impede duas reaberturas concorrentes do mesmo
  --    pedido, ou uma reabertura concorrente com qualquer outra
  --    transicao. Uma segunda chamada so prossegue apos a primeira
  --    commitar (ou reverter) -- e ai encontra status<>recebido e falha
  --    no proximo passo, nunca reprocessando o mesmo pedido.
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'reabrir_recebimento_pedido: pedido % nao encontrado.', p_pedido_id;
  end if;

  if v_pedido.status <> 'recebido' then
    raise exception 'reabrir_recebimento_pedido: pedido % tem status=%, somente pedidos recebidos podem ter o recebimento reaberto.',
      p_pedido_id, v_pedido.status;
  end if;

  select array_agg(id) into v_ids_itens
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  -- 3) SNAPSHOT completo -- ANTES de qualquer exclusao/limpeza (secao 3
  --    do cabecalho desta migration: pedido, itens com os dados
  --    efetivos ainda presentes, e os proprios registros de historico
  --    que serao removidos).
  select jsonb_agg(to_jsonb(pi.*)) into v_snapshot_itens
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(phc.*)) into v_snapshot_historicos
  from public.produtos_historico_compras phc
  where phc.pedido_item_id = any(v_ids_itens)
    and phc.origem = 'recebimento_pedido';

  insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior)
  values (
    'pedido',
    p_pedido_id::text,
    'pedido_recebimento_reaberto',
    jsonb_build_object(
      'pedido', to_jsonb(v_pedido.*),
      'itens', coalesce(v_snapshot_itens, '[]'::jsonb),
      'historicos_removidos', coalesce(v_snapshot_historicos, '[]'::jsonb),
      'usuario', auth.uid(),
      'reaberto_em', now()
    )::text
  );

  -- 4) exclui SOMENTE historico origem=recebimento_pedido vinculado a
  --    itens DESTE pedido -- ver secao 2 do cabecalho para a prova de
  --    que isso nunca atinge historico manual nem de outro pedido.
  delete from public.produtos_historico_compras
  where pedido_item_id = any(v_ids_itens)
    and origem = 'recebimento_pedido';

  -- 5) limpa os campos de recebimento -- roda ENQUANTO o pedido ainda e
  --    recebido (a transicao de status so acontece no passo 6);
  --    pedido_itens_protecao (ramo novo desta migration) permite esta
  --    UPDATE especifica e SO esta.
  update public.pedido_itens
  set unidade_recebida = null,
      quantidade_recebida = null,
      valor_unitario_recebido = null
  where pedido_id = p_pedido_id;

  -- 6) transicao formal -- pedidos_protecao (ramo novo desta migration)
  --    libera esta UPDATE especifica, forca recebido_em=null.
  update public.pedidos
  set status = 'aguardando_entrega'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.reabrir_recebimento_pedido(uuid) is
  'Desfaz atomicamente o recebimento de um pedido: grava snapshot completo (pedido+itens+historicos removidos) em logs_auditoria (acao=pedido_recebimento_reaberto), exclui de produtos_historico_compras todo registro origem=recebimento_pedido vinculado a itens deste pedido, limpa unidade_recebida/quantidade_recebida/valor_unitario_recebido em pedido_itens, e transiciona pedidos.status de recebido para aguardando_entrega (recebido_em limpo pela propria trigger pedidos_protecao). Exige sessao autenticada + pedidos.reabrir_recebimento. Bloqueia a linha do pedido (FOR UPDATE). SECURITY DEFINER: necessario tanto para a escrita quanto para satisfazer o gate rolbypassrls das triggers pedidos_protecao/pedido_itens_protecao -- hoje a UNICA funcao deste schema que emite um UPDATE compativel com esses ramos, auditado explicitamente (ver cabecalho da migration 0027); nao uma exclusividade estrutural automatica, reconferir a cada nova funcao SECURITY DEFINER que toque pedidos/pedido_itens. Qualquer falha em qualquer etapa desfaz a transacao inteira. Pedidos legados (recebidos antes da 0026, sem dados detalhados/historico) sao suportados sem nenhuma logica especial -- DELETE e UPDATE de limpeza simplesmente nao encontram nada a fazer.';

revoke execute on function public.reabrir_recebimento_pedido(uuid) from public;
revoke execute on function public.reabrir_recebimento_pedido(uuid) from anon;
grant execute on function public.reabrir_recebimento_pedido(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: qualquer reabertura ja realizada via reabrir_recebimento_pedido()
-- antes do rollback NAO tem seus efeitos desfeitos por este rollback --
-- pedido_itens ja limpos e historico ja excluido permanecem como estao
-- (o snapshot em logs_auditoria e a unica forma de recuperar o que foi
-- perdido, manualmente).
-- BEGIN;
--
--   revoke execute on function public.reabrir_recebimento_pedido(uuid) from authenticated;
--   drop function if exists public.reabrir_recebimento_pedido(uuid);
--
--   delete from public.perfil_permissoes where permissao = 'pedidos.reabrir_recebimento';
--   delete from public.permissoes where codigo = 'pedidos.reabrir_recebimento';
--
--   -- Restaura pedido_itens_protecao para o corpo da 0022 (sem o ramo de
--   -- reabertura).
--   create or replace function public.pedido_itens_protecao()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_status text;
--   begin
--     if tg_op = 'INSERT' then
--       new.criado_em := now();
--       new.atualizado_em := now();
--       select status into v_status from public.pedidos where id = new.pedido_id;
--       if v_status is distinct from 'aguardando_entrega' then
--         raise exception 'pedido_itens: nao e possivel inserir item em pedido com status=%.', coalesce(v_status, 'inexistente');
--       end if;
--       return new;
--     elsif tg_op = 'UPDATE' then
--       if new.pedido_id is distinct from old.pedido_id then
--         raise exception 'pedido_itens: pedido_id e imutavel -- um item nao pode ser movido entre pedidos.';
--       end if;
--       if new.criado_em is distinct from old.criado_em then
--         raise exception 'pedido_itens: criado_em e imutavel.';
--       end if;
--       new.atualizado_em := now();
--       select status into v_status from public.pedidos where id = old.pedido_id;
--       if v_status is distinct from 'aguardando_entrega' then
--         raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', coalesce(v_status, 'inexistente');
--       end if;
--       return new;
--     elsif tg_op = 'DELETE' then
--       select status into v_status from public.pedidos where id = old.pedido_id;
--       if v_status is distinct from 'aguardando_entrega' then
--         raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', coalesce(v_status, 'inexistente');
--       end if;
--       return old;
--     end if;
--     return null;
--   end;
--   $$;
--   revoke execute on function public.pedido_itens_protecao() from public;
--
--   -- Restaura pedidos_protecao para o corpo da 0022 (sem o ramo de
--   -- reabertura).
--   create or replace function public.pedidos_protecao()
--   returns trigger
--   language plpgsql
--   security invoker
--   set search_path = ''
--   as $$
--   declare
--     v_mudou_status boolean;
--   begin
--     if tg_op = 'INSERT' then
--       new.criado_por := auth.uid();
--       new.criado_em := now();
--       new.atualizado_em := now();
--       return new;
--     elsif tg_op = 'UPDATE' then
--       if new.id is distinct from old.id then
--         raise exception 'pedidos: id e imutavel.';
--       end if;
--       if new.criado_por is distinct from old.criado_por then
--         raise exception 'pedidos: criado_por e imutavel.';
--       end if;
--       if new.criado_em is distinct from old.criado_em then
--         raise exception 'pedidos: criado_em e imutavel.';
--       end if;
--       new.atualizado_em := now();
--       if old.status <> 'aguardando_entrega' then
--         raise exception 'pedidos: pedido % ja esta finalizado (status=%), nao pode ser alterado.', old.id, old.status;
--       end if;
--       v_mudou_status := new.status <> old.status;
--       if v_mudou_status then
--         if new.status = 'recebido' then
--           if not (select public.has_permissao('pedidos.receber')) then
--             raise exception 'pedidos: marcar como recebido requer a permissao pedidos.receber.';
--           end if;
--           new.recebido_em := now();
--           if new.fornecedor_id is distinct from old.fornecedor_id
--             or new.data_pedido is distinct from old.data_pedido
--             or new.previsao_entrega is distinct from old.previsao_entrega
--             or new.observacoes is distinct from old.observacoes
--             or new.cancelado_em is distinct from old.cancelado_em
--             or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
--             raise exception 'pedidos: recebimento deve alterar somente status/recebido_em.';
--           end if;
--           insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
--           values ('pedido', new.id::text, 'recebeu', 'recebido_em=' || new.recebido_em::text);
--         elsif new.status = 'cancelado' then
--           if not (select public.has_permissao('pedidos.cancelar')) then
--             raise exception 'pedidos: cancelar requer a permissao pedidos.cancelar.';
--           end if;
--           if new.motivo_cancelamento is null or btrim(new.motivo_cancelamento) = '' then
--             raise exception 'pedidos: motivo do cancelamento e obrigatorio.';
--           end if;
--           new.cancelado_em := now();
--           new.motivo_cancelamento := btrim(new.motivo_cancelamento);
--           if new.fornecedor_id is distinct from old.fornecedor_id
--             or new.data_pedido is distinct from old.data_pedido
--             or new.previsao_entrega is distinct from old.previsao_entrega
--             or new.observacoes is distinct from old.observacoes
--             or new.recebido_em is distinct from old.recebido_em then
--             raise exception 'pedidos: cancelamento deve alterar somente status/cancelado_em/motivo_cancelamento.';
--           end if;
--           insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
--           values ('pedido', new.id::text, 'cancelou', new.motivo_cancelamento);
--         else
--           raise exception 'pedidos: transicao de status invalida (% -> %).', old.status, new.status;
--         end if;
--       else
--         if not (select public.has_permissao('pedidos.editar')) then
--           raise exception 'pedidos: editar requer a permissao pedidos.editar.';
--         end if;
--         if new.recebido_em is distinct from old.recebido_em
--           or new.cancelado_em is distinct from old.cancelado_em
--           or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
--           raise exception 'pedidos: estes campos so mudam via marcar_pedido_recebido/cancelar_pedido.';
--         end if;
--       end if;
--       return new;
--     end if;
--     return null;
--   end;
--   $$;
--
-- COMMIT;
