-- 0074_sacos_ajuste_estoque.sql
-- AJUSTE DE ESTOQUE em Sacos Fechados -- movimentacao explicita,
-- auditavel e atomica que leva o saldo do sistema ao estoque fisico
-- contado, sem apagar/editar historico e sem abertura ficticia.
--
-- Numeracao: origin/main termina em 0072 (bc77591). 0073 esta reservada
-- pela frente Financeiro > Contas a Pagar (ainda nao aplicada) -- 0074 e
-- o proximo numero livre. Esta migration NAO depende da 0073 e nao toca
-- em nenhum objeto dela (receber_pedido/editar_compra_presencial/
-- reabrir_recebimento_pedido/contas_pagar* ficam intocados).
--
-- ============================================================
-- DIAGNOSTICO (antes do desenho)
-- ============================================================
--   * Estoque real hoje = DOIS livros-razao espelhados, ambos so por
--     soma (nenhum saldo armazenado):
--       - sacos_fechados_movimentacoes (0042): saldo de SACOS por
--         configuracao comercial (produto_fornecedor_id) =
--         SUM(quantidade_sacos);
--       - estoque_movimentacoes (0041): saldo em KG por produto_id =
--         SUM(quantidade). Toda linha hoje nasce de uma linha de sacos
--         (origem_id = sacos_fechados_movimentacoes.id), com quantidade
--         = quantidade_sacos * peso_por_saco_kg_snapshot.
--   * Escritores: registrar_abertura_saco (0042, abertura -> origem
--     sacos_fechados_abertura), registrar_saldo_inicial_sacos (0044/0047,
--     -> sacos_fechados_saldo_inicial), receber_pedido (0051, entrada ->
--     sacos_fechados_recebimento_pedido), editar_movimentacao_saco (0046),
--     excluir_movimentacao_saco (0050), reabrir_recebimento_pedido (0052).
--   * tipo='ajuste_manual'/origem='ajuste_manual' JA existem nos CHECKs
--     de sacos_fechados_movimentacoes desde a 0042, reservados para "uma
--     RPC de lancamento manual futura" -- mas NENHUMA RPC os cria (ver
--     investigacao registrada na 0046). A 0046/0050 deixaram explicito:
--     "quando a RPC de lancamento manual for desenhada, a convencao de
--     origem de estoque de ajuste_manual sera decidida junto dela". Esta
--     migration e esse momento.
--
-- ============================================================
-- DESENHO
-- ============================================================
--   1) O ajuste REUTILIZA tipo='ajuste_manual'/origem='ajuste_manual'
--      (dominio ja existente -- nenhum CHECK de tipo/origem muda) e
--      ganha sua convencao de estoque: origem
--      'sacos_fechados_ajuste' em estoque_movimentacoes, mesmo
--      espelhamento 1:1 (origem, origem_id) das demais.
--   2) Nova RPC registrar_ajuste_sacos: o cliente informa o ESTOQUE
--      FISICO CORRETO (nunca o delta) e o saldo que estava vendo; o
--      banco trava a configuracao (FOR UPDATE, mesma ordem de lock das
--      demais RPCs de Sacos), recalcula o saldo real, ABORTA se ele
--      mudou desde a tela (concorrencia -- nunca calcula sobre saldo
--      antigo), e grava ajuste = fisico - saldo_atual. Idempotente via
--      operacao_id (mesmo padrao de abertura/saldo inicial).
--   3) 2 colunas novas em sacos_fechados_movimentacoes, so para ajuste:
--        motivo               -- obrigatorio no ajuste;
--        saldo_anterior_sacos -- saldo no instante do ajuste.
--      saldo_anterior NAO e redundante: o saldo "antes" de uma linha nao
--      e reconstruivel com confianca pela soma corrida, porque linhas
--      ANTERIORES podem ser editadas/excluidas depois (0046/0050) e
--      entradas podem sumir numa reabertura de recebimento (0052) -- a
--      soma corrida passaria a mostrar um "saldo anterior" que nunca
--      existiu. O snapshot e o unico registro fiel do que foi conferido.
--      Novo saldo = saldo_anterior_sacos + quantidade_sacos (derivado,
--      nao armazenado). CHECK amarra: ajuste <=> motivo + saldo_anterior
--      + operacao_id preenchidos; demais tipos sempre com os dois NULL;
--      novo saldo >= 0.
--   4) AJUSTE E IMUTAVEL: editar_movimentacao_saco e
--      excluir_movimentacao_saco passam a REJEITAR tipo='ajuste_manual'
--      (antes aceitavam por "compatibilidade futura", sem tocar estoque
--      -- com a nova convencao isso dessincronizaria sacos x estoque).
--      Ajuste errado se corrige com um NOVO ajuste -- o historico fica
--      inteiro. A trigger de protecao tambem passa a bloquear UPDATE de
--      qualquer campo de uma linha de ajuste (defesa em profundidade) e
--      a imutabilidade de motivo/saldo_anterior_sacos em todas.
--   5) Permissao NOVA producao_sacos.ajustar (mesmo padrao da 0050 para
--      .excluir: codigo dedicado, nao reaproveita .operar/.editar --
--      ajuste altera o saldo sem fato fisico de entrada/abertura e e mais
--      sensivel que ambos). Concedida so a proprietario_admin; overrides
--      individuais continuam via usuario_permissoes/has_permissao (0016).
--   6) logs_auditoria: 1 linha por ajuste (entidade
--      sacos_fechados_movimentacao, acao ajustou_estoque, campo
--      saldo_sacos, valor_anterior = saldo antes, valor_novo = estoque
--      fisico). usuario/data via trigger da 0004.
--
-- Esta migration NAO faz:
--   * nenhum INSERT/UPDATE/DELETE em dados de movimentacao (nenhum
--     ajuste real e gravado aqui -- o do Pao Frances/Gold sera feito
--     depois, pela tela);
--   * nenhuma alteracao de CHECK de tipo/origem, de receber_pedido,
--     reabrir_recebimento_pedido, registrar_abertura_saco,
--     registrar_saldo_inicial_sacos ou listar_sacos_fechados_configuracoes.
--
-- Pre-requisitos: 0041, 0042, 0044, 0046, 0047, 0050, 0051, 0052 aplicadas.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente -- aborta sem criar nada se o banco nao for o
--    esperado.
-- ============================================================
DO $$
declare
  v_md5 text;
begin
  if to_regclass('public.sacos_fechados_movimentacoes') is null
     or to_regclass('public.estoque_movimentacoes') is null
     or to_regclass('public.produto_fornecedores') is null
     or to_regclass('public.produtos') is null
     or to_regclass('public.logs_auditoria') is null
     or to_regclass('public.permissoes') is null
     or to_regclass('public.perfil_permissoes') is null
     or to_regprocedure('public.has_permissao(text)') is null then
    raise exception '0074 abortada: objetos base (sacos_fechados_movimentacoes/estoque_movimentacoes/produto_fornecedores/produtos/logs_auditoria/permissoes/perfil_permissoes/has_permissao) nao encontrados.';
  end if;

  if not exists (select 1 from public.perfis where nome = 'proprietario_admin') then
    raise exception '0074 abortada: perfil proprietario_admin nao encontrado.';
  end if;

  if exists (select 1 from pg_attribute
       where attrelid = 'public.sacos_fechados_movimentacoes'::regclass
         and attname in ('motivo', 'saldo_anterior_sacos') and not attisdropped)
     or to_regprocedure('public.registrar_ajuste_sacos(uuid,integer,integer,text,uuid,text)') is not null
     or exists (select 1 from public.permissoes where codigo = 'producao_sacos.ajustar') then
    raise exception '0074 abortada: objetos de ajuste de estoque ja existem -- migration ja parece aplicada.';
  end if;

  -- Nenhuma RPC cria ajuste_manual ate aqui (0046) -- se existir alguma
  -- linha, foi gravada fora do repositorio e a nova CHECK a rejeitaria.
  if exists (select 1 from public.sacos_fechados_movimentacoes where tipo = 'ajuste_manual')
     or exists (select 1 from public.estoque_movimentacoes where origem = 'sacos_fechados_ajuste') then
    raise exception '0074 abortada: ja existem linhas de ajuste_manual/sacos_fechados_ajuste -- investigar antes de aplicar.';
  end if;

  -- As 3 funcoes redefinidas abaixo precisam estar EXATAMENTE na versao
  -- publicada (md5 do corpo com espacos normalizados) -- se alguem
  -- corrigiu algo fora do repositorio, aborta em vez de sobrescrever.
  select md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'))) into v_md5
  from pg_proc where oid = to_regprocedure('public.editar_movimentacao_saco(uuid,integer,text)');
  if v_md5 is distinct from '2026027004589ff04ae4b6731f27762b' then
    raise exception '0074 abortada: editar_movimentacao_saco nao esta na versao da 0046 (md5 %).', coalesce(v_md5, 'ausente');
  end if;

  select md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'))) into v_md5
  from pg_proc where oid = to_regprocedure('public.excluir_movimentacao_saco(uuid,text)');
  if v_md5 is distinct from '71d2706ddf2ef5b75f3c6ebf4d138a30' then
    raise exception '0074 abortada: excluir_movimentacao_saco nao esta na versao da 0050 (md5 %).', coalesce(v_md5, 'ausente');
  end if;

  select md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'))) into v_md5
  from pg_proc where oid = to_regprocedure('public.sacos_fechados_movimentacoes_protecao()');
  if v_md5 is distinct from 'bd0adc780369f2d29b98da686799aacc' then
    raise exception '0074 abortada: sacos_fechados_movimentacoes_protecao nao esta na versao da 0042 (md5 %).', coalesce(v_md5, 'ausente');
  end if;
end $$;


-- ============================================================
-- 1. sacos_fechados_movimentacoes -- 2 colunas novas (so ajuste)
-- ============================================================
alter table public.sacos_fechados_movimentacoes
  add column motivo text,
  add column saldo_anterior_sacos integer;

alter table public.sacos_fechados_movimentacoes
  add constraint sacos_fechados_movimentacoes_ajuste_coerente_check
  check (
    (tipo = 'ajuste_manual'
      and motivo is not null and btrim(motivo) <> ''
      and saldo_anterior_sacos is not null
      and saldo_anterior_sacos + quantidade_sacos >= 0
      and operacao_id is not null)
    or (tipo <> 'ajuste_manual' and motivo is null and saldo_anterior_sacos is null)
  );

comment on column public.sacos_fechados_movimentacoes.motivo is
  'Motivo OBRIGATORIO de um ajuste de estoque (tipo=ajuste_manual, 0074). Sempre NULL nos demais tipos (a observacao livre continua em observacao). Imutavel.';

comment on column public.sacos_fechados_movimentacoes.saldo_anterior_sacos is
  'Snapshot do saldo de sacos da configuracao NO INSTANTE do ajuste (tipo=ajuste_manual, 0074), lido sob FOR UPDATE da configuracao. Novo saldo = saldo_anterior_sacos + quantidade_sacos. Nao reconstruivel pela soma corrida (linhas anteriores podem ser editadas/excluidas/removidas por reabertura depois) -- por isso armazenado. Sempre NULL nos demais tipos. Imutavel.';

comment on column public.sacos_fechados_movimentacoes.quantidade_sacos is
  'Inteiro assinado -- positivo em entrada, negativo em abertura. ajuste_manual (= estoque fisico - saldo anterior, calculado no banco por registrar_ajuste_sacos, 0074) e saldo_inicial podem ser qualquer sinal nao-zero. NUNCA numeric -- sacos sao sempre contados em unidades inteiras.';


-- ============================================================
-- 2. Trigger de protecao -- CREATE OR REPLACE (corpo da 0042 + 2 regras)
-- ============================================================
create or replace function public.sacos_fechados_movimentacoes_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    -- NOVO (0074): ajuste de estoque e imutavel por inteiro -- corrige-se
    -- com um novo ajuste, nunca editando o registrado.
    if old.tipo = 'ajuste_manual' then
      raise exception 'sacos_fechados_movimentacoes: ajuste de estoque e imutavel -- registre um novo ajuste.';
    end if;
    if new.produto_fornecedor_id is distinct from old.produto_fornecedor_id then
      raise exception 'sacos_fechados_movimentacoes: produto_fornecedor_id e imutavel.';
    end if;
    if new.peso_por_saco_kg_snapshot is distinct from old.peso_por_saco_kg_snapshot then
      raise exception 'sacos_fechados_movimentacoes: peso_por_saco_kg_snapshot e imutavel.';
    end if;
    if new.tipo is distinct from old.tipo then
      raise exception 'sacos_fechados_movimentacoes: tipo e imutavel.';
    end if;
    if new.origem is distinct from old.origem then
      raise exception 'sacos_fechados_movimentacoes: origem e imutavel.';
    end if;
    if new.pedido_item_id is distinct from old.pedido_item_id then
      raise exception 'sacos_fechados_movimentacoes: pedido_item_id e imutavel.';
    end if;
    if new.operacao_id is distinct from old.operacao_id then
      raise exception 'sacos_fechados_movimentacoes: operacao_id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'sacos_fechados_movimentacoes: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'sacos_fechados_movimentacoes: criado_em e imutavel.';
    end if;
    -- NOVO (0074).
    if new.motivo is distinct from old.motivo then
      raise exception 'sacos_fechados_movimentacoes: motivo e imutavel.';
    end if;
    if new.saldo_anterior_sacos is distinct from old.saldo_anterior_sacos then
      raise exception 'sacos_fechados_movimentacoes: saldo_anterior_sacos e imutavel.';
    end if;

    -- quantidade_sacos e observacao PODEM mudar -- e exatamente o que
    -- editar_movimentacao_saco() corrige (aberturas/saldos iniciais).
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.sacos_fechados_movimentacoes_protecao() is
  'BEFORE INSERT/UPDATE em sacos_fechados_movimentacoes. INSERT: forca criado_por/criado_em/atualizado_por/atualizado_em. UPDATE: rejeita qualquer UPDATE de linha tipo=ajuste_manual (ajuste de estoque e imutavel, 0074); bloqueia produto_fornecedor_id/peso_por_saco_kg_snapshot/tipo/origem/pedido_item_id/operacao_id/criado_por/criado_em/motivo/saldo_anterior_sacos imutaveis -- so quantidade_sacos/observacao podem mudar (via editar_movimentacao_saco), forca atualizado_por/atualizado_em mesmo numa correcao.';

revoke execute on function public.sacos_fechados_movimentacoes_protecao() from public;


-- ============================================================
-- 3. Nova permissao -- producao_sacos.ajustar
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('producao_sacos.ajustar', 'producao_sacos', 'ajustar',
   'Registrar AJUSTE DE ESTOQUE em Sacos Fechados via registrar_ajuste_sacos: informa o estoque fisico correto e o banco grava a diferenca como movimentacao propria (tipo ajuste_manual), com motivo obrigatorio, snapshot do saldo anterior e auditoria. Codigo dedicado -- mais sensivel que .operar/.editar (altera o saldo sem fato fisico de entrada/abertura). Concedida inicialmente so a proprietario_admin no banco (0074).')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', 'producao_sacos.ajustar'
on conflict do nothing;


-- ============================================================
-- 4. RPC registrar_ajuste_sacos -- unico caminho de ajuste de estoque
-- ============================================================
create or replace function public.registrar_ajuste_sacos(
  p_produto_fornecedor_id uuid,
  p_estoque_fisico_sacos  integer,
  p_saldo_esperado_sacos  integer,
  p_motivo                text,
  p_operacao_id           uuid,
  p_observacao            text default null
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config          public.produto_fornecedores%rowtype;
  v_existente       public.sacos_fechados_movimentacoes%rowtype;
  v_movimentacao    public.sacos_fechados_movimentacoes%rowtype;
  v_unidade_produto text;
  v_saldo_atual     integer;
  v_ajuste          integer;
  v_motivo          text;
  v_observacao      text;
begin
  if auth.uid() is null then
    raise exception 'registrar_ajuste_sacos: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.ajustar')) then
    raise exception using errcode = '42501',
      message = 'registrar_ajuste_sacos: requer a permissao producao_sacos.ajustar.';
  end if;

  if p_produto_fornecedor_id is null then
    raise exception 'registrar_ajuste_sacos: produto_fornecedor_id e obrigatorio.';
  end if;

  if p_estoque_fisico_sacos is null or p_estoque_fisico_sacos < 0 then
    raise exception 'registrar_ajuste_sacos: estoque fisico deve ser um inteiro maior ou igual a zero.';
  end if;

  if p_saldo_esperado_sacos is null then
    raise exception 'registrar_ajuste_sacos: saldo esperado e obrigatorio.';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'registrar_ajuste_sacos: motivo e obrigatorio.';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'registrar_ajuste_sacos: motivo excede 500 caracteres.';
  end if;

  v_observacao := nullif(btrim(coalesce(p_observacao, '')), '');

  if p_operacao_id is null then
    raise exception 'registrar_ajuste_sacos: operacao_id e obrigatorio (idempotencia -- gere um uuid novo no cliente antes de chamar esta funcao).';
  end if;

  -- Idempotencia (mesmo padrao de registrar_abertura_saco): reenviar a
  -- MESMA chamada devolve o ajuste ja gravado -- verificado ANTES da
  -- checagem de saldo esperado, que falharia no retry porque o primeiro
  -- envio ja mudou o saldo. Um operacao_id ja usado por OUTRA coisa e
  -- erro, nunca um retorno silencioso de linha alheia.
  select * into v_existente
  from public.sacos_fechados_movimentacoes
  where operacao_id = p_operacao_id;

  if found then
    if v_existente.tipo <> 'ajuste_manual' or v_existente.produto_fornecedor_id <> p_produto_fornecedor_id then
      raise exception 'registrar_ajuste_sacos: operacao_id ja utilizado por outra movimentacao.';
    end if;
    return v_existente;
  end if;

  -- Trava a CONFIGURACAO antes de somar (mesma ordem de lock de todas as
  -- RPCs de escrita de Sacos -- evita deadlock e serializa contra
  -- abertura/recebimento/edicao/exclusao/outro ajuste concorrentes).
  select * into v_config
  from public.produto_fornecedores
  where id = p_produto_fornecedor_id
  for update;

  if v_config.id is null then
    raise exception 'registrar_ajuste_sacos: configuracao comercial % nao encontrada.', p_produto_fornecedor_id;
  end if;

  if not v_config.ativo then
    raise exception 'registrar_ajuste_sacos: configuracao comercial % esta inativa.', p_produto_fornecedor_id;
  end if;

  if not v_config.controla_sacos_fechados then
    raise exception 'registrar_ajuste_sacos: configuracao comercial % nao esta marcada para controle de sacos fechados.', p_produto_fornecedor_id;
  end if;

  if v_config.peso_por_saco_kg is null or v_config.peso_por_saco_kg <= 0 then
    raise exception 'registrar_ajuste_sacos: configuracao comercial % nao tem peso_por_saco_kg valido cadastrado.', p_produto_fornecedor_id;
  end if;

  select unidade_medida into v_unidade_produto
  from public.produtos
  where id = v_config.produto_id;

  if upper(btrim(coalesce(v_unidade_produto, ''))) <> 'KG' then
    raise exception 'registrar_ajuste_sacos: produto % tem unidade_medida=%, mas Sacos Fechados so opera sobre produtos cuja unidade-base seja KG.',
      v_config.produto_id, v_unidade_produto;
  end if;

  select coalesce(sum(quantidade_sacos), 0) into v_saldo_atual
  from public.sacos_fechados_movimentacoes
  where produto_fornecedor_id = p_produto_fornecedor_id;

  -- Concorrencia: o ajuste so vale sobre o saldo que a pessoa conferiu.
  -- Se qualquer movimentacao entrou/saiu desde que a tela foi carregada,
  -- aborta -- nunca calcula a diferenca sobre um saldo que ela nao viu.
  if v_saldo_atual <> p_saldo_esperado_sacos then
    raise exception 'registrar_ajuste_sacos: o saldo mudou desde que a tela foi carregada (esperado: % sacos, atual: % sacos) -- revise o ajuste.',
      p_saldo_esperado_sacos, v_saldo_atual;
  end if;

  v_ajuste := p_estoque_fisico_sacos - v_saldo_atual;

  if v_ajuste = 0 then
    raise exception 'registrar_ajuste_sacos: nenhum ajuste necessario -- o estoque fisico informado e igual ao saldo atual (% sacos).', v_saldo_atual;
  end if;

  insert into public.sacos_fechados_movimentacoes (
    produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot,
    tipo, origem, operacao_id, observacao, motivo, saldo_anterior_sacos
  ) values (
    p_produto_fornecedor_id, v_ajuste, v_config.peso_por_saco_kg,
    'ajuste_manual', 'ajuste_manual', p_operacao_id, v_observacao, v_motivo, v_saldo_atual
  )
  returning * into v_movimentacao;

  insert into public.estoque_movimentacoes (
    produto_id, quantidade, unidade, origem, origem_id, observacao
  ) values (
    v_config.produto_id,
    v_ajuste::numeric * v_config.peso_por_saco_kg,
    v_unidade_produto,
    'sacos_fechados_ajuste',
    v_movimentacao.id,
    v_motivo
  );

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('sacos_fechados_movimentacao', v_movimentacao.id::text, 'ajustou_estoque', 'saldo_sacos',
          v_saldo_atual::text, p_estoque_fisico_sacos::text);

  return v_movimentacao;
end;
$$;

comment on function public.registrar_ajuste_sacos(uuid, integer, integer, text, uuid, text) is
  'Unico caminho de AJUSTE DE ESTOQUE de Sacos Fechados (0074). Recebe o ESTOQUE FISICO correto (nunca o delta) e o saldo que a tela exibia; exige producao_sacos.ajustar e motivo. Trava produto_fornecedores (FOR UPDATE) antes de somar, ABORTA se o saldo real mudou desde a tela (concorrencia), rejeita ajuste zero, e grava ATOMICAMENTE: sacos_fechados_movimentacoes (tipo/origem ajuste_manual, quantidade = fisico - saldo, motivo, saldo_anterior_sacos), estoque_movimentacoes (origem sacos_fechados_ajuste, kg = ajuste * peso atual, origem_id = linha de sacos) e logs_auditoria (ajustou_estoque, saldo anterior -> fisico). Idempotente via operacao_id. Ajuste e imutavel (editar/excluir_movimentacao_saco o rejeitam). SECURITY DEFINER: nenhuma policy de escrita existe nestas tabelas.';

revoke execute on function public.registrar_ajuste_sacos(uuid, integer, integer, text, uuid, text) from public;
revoke execute on function public.registrar_ajuste_sacos(uuid, integer, integer, text, uuid, text) from anon;
revoke execute on function public.registrar_ajuste_sacos(uuid, integer, integer, text, uuid, text) from service_role;
grant execute on function public.registrar_ajuste_sacos(uuid, integer, integer, text, uuid, text) to authenticated;


-- ============================================================
-- 5. editar_movimentacao_saco -- CREATE OR REPLACE (corpo da 0046;
--    ajuste_manual passa a ser rejeitado)
-- ============================================================
create or replace function public.editar_movimentacao_saco(
  p_movimentacao_id       uuid,
  p_nova_quantidade_sacos integer,
  p_observacao            text default null
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movimentacao            public.sacos_fechados_movimentacoes%rowtype;
  v_saldo_outros            integer;
  v_saldo_resultante        integer;
  v_valor_anterior          text;
  v_origem_estoque_esperada text;
  v_qtd_estoque_vinculado   integer;
begin
  if auth.uid() is null then
    raise exception 'editar_movimentacao_saco: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.editar')) then
    raise exception using errcode = '42501',
      message = 'editar_movimentacao_saco: requer a permissao producao_sacos.editar.';
  end if;

  if p_movimentacao_id is null then
    raise exception 'editar_movimentacao_saco: movimentacao_id e obrigatorio.';
  end if;

  if p_nova_quantidade_sacos is null or p_nova_quantidade_sacos = 0 then
    raise exception 'editar_movimentacao_saco: nova quantidade nao pode ser zero.';
  end if;

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  if v_movimentacao.id is null then
    raise exception 'editar_movimentacao_saco: movimentacao % nao encontrada.', p_movimentacao_id;
  end if;

  -- NOVO (0074): ajuste de estoque e imutavel -- corrige-se com novo ajuste.
  if v_movimentacao.tipo = 'ajuste_manual' then
    raise exception 'editar_movimentacao_saco: movimentacao % e um ajuste de estoque -- ajustes nao podem ser editados; registre um novo ajuste.', p_movimentacao_id;
  end if;

  if v_movimentacao.tipo not in ('abertura', 'saldo_inicial') then
    raise exception 'editar_movimentacao_saco: movimentacao % tem tipo=%, somente aberturas e saldos iniciais podem ser corrigidos por esta funcao.',
      p_movimentacao_id, v_movimentacao.tipo;
  end if;

  if v_movimentacao.tipo = 'abertura' and p_nova_quantidade_sacos >= 0 then
    raise exception 'editar_movimentacao_saco: uma movimentacao do tipo abertura precisa continuar negativa (recebido: %).', p_nova_quantidade_sacos;
  end if;

  if v_movimentacao.tipo = 'saldo_inicial' and p_nova_quantidade_sacos <= 0 then
    raise exception 'editar_movimentacao_saco: uma movimentacao do tipo saldo_inicial precisa continuar positiva (recebido: %).', p_nova_quantidade_sacos;
  end if;

  -- Trava a CONFIGURACAO (mesma ordem de lock das demais RPCs de Sacos).
  perform 1 from public.produto_fornecedores
  where id = v_movimentacao.produto_fornecedor_id
  for update;

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id
  for update;

  v_saldo_outros := (
    select coalesce(sum(quantidade_sacos), 0)
    from public.sacos_fechados_movimentacoes
    where produto_fornecedor_id = v_movimentacao.produto_fornecedor_id
      and id <> p_movimentacao_id
  );

  v_saldo_resultante := v_saldo_outros + p_nova_quantidade_sacos;

  if v_saldo_resultante < 0 then
    raise exception 'editar_movimentacao_saco: esta correcao deixaria o saldo negativo (resultante: % sacos).', v_saldo_resultante;
  end if;

  v_origem_estoque_esperada := case v_movimentacao.tipo
    when 'abertura' then 'sacos_fechados_abertura'
    when 'saldo_inicial' then 'sacos_fechados_saldo_inicial'
  end;

  select count(*) into v_qtd_estoque_vinculado
  from public.estoque_movimentacoes
  where origem = v_origem_estoque_esperada
    and origem_id = p_movimentacao_id;

  if v_qtd_estoque_vinculado <> 1 then
    raise exception 'editar_movimentacao_saco: esperada exatamente 1 movimentacao de estoque vinculada (origem=%, origem_id=%), encontrada(s) % -- abortando para nao dessincronizar silenciosamente.',
      v_origem_estoque_esperada, p_movimentacao_id, v_qtd_estoque_vinculado;
  end if;

  v_valor_anterior := v_movimentacao.quantidade_sacos::text;

  update public.sacos_fechados_movimentacoes
  set quantidade_sacos = p_nova_quantidade_sacos,
      observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao)
  where id = p_movimentacao_id;

  update public.estoque_movimentacoes
  set quantidade = p_nova_quantidade_sacos::numeric * v_movimentacao.peso_por_saco_kg_snapshot
  where origem = v_origem_estoque_esperada
    and origem_id = p_movimentacao_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('sacos_fechados_movimentacao', p_movimentacao_id::text, 'editou', 'quantidade_sacos', v_valor_anterior, p_nova_quantidade_sacos::text);

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  return v_movimentacao;
end;
$$;

comment on function public.editar_movimentacao_saco(uuid, integer, text) is
  'Corrige uma movimentacao de sacos MANUAL ja registrada (tipo abertura ou saldo_inicial -- nunca entrada automatica de pedido; ajuste de estoque/ajuste_manual e imutavel desde a 0074 e e rejeitado). Trava a configuracao (FOR UPDATE, mesma ordem das demais RPCs de Sacos) e a propria movimentacao antes de recalcular o saldo excluindo a linha em edicao; impede saldo negativo. Origem de estoque esperada pelo tipo (abertura->sacos_fechados_abertura, saldo_inicial->sacos_fechados_saldo_inicial) e exige EXATAMENTE 1 linha vinculada antes de escrever. UPDATE transacional direto: corrige quantidade_sacos + estoque vinculado na MESMA transacao, preservando peso_por_saco_kg_snapshot e ids. Registra valor anterior/novo em logs_auditoria. Exige producao_sacos.editar. SECURITY DEFINER.';

revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from public;
revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from anon;
revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from service_role;
grant execute on function public.editar_movimentacao_saco(uuid, integer, text) to authenticated;


-- ============================================================
-- 6. excluir_movimentacao_saco -- CREATE OR REPLACE (corpo da 0050;
--    ajuste_manual passa a ser rejeitado)
-- ============================================================
create or replace function public.excluir_movimentacao_saco(
  p_movimentacao_id uuid,
  p_motivo          text
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movimentacao            public.sacos_fechados_movimentacoes%rowtype;
  v_saldo_outros            integer;
  v_origem_estoque_esperada text;
  v_qtd_estoque_vinculado   integer;
  v_motivo                  text;
begin
  if auth.uid() is null then
    raise exception 'excluir_movimentacao_saco: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.excluir')) then
    raise exception using errcode = '42501',
      message = 'excluir_movimentacao_saco: requer a permissao producao_sacos.excluir.';
  end if;

  if p_movimentacao_id is null then
    raise exception 'excluir_movimentacao_saco: movimentacao_id e obrigatorio.';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'excluir_movimentacao_saco: motivo e obrigatorio.';
  end if;

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  if v_movimentacao.id is null then
    raise exception 'excluir_movimentacao_saco: movimentacao % nao encontrada.', p_movimentacao_id;
  end if;

  -- NOVO (0074): ajuste de estoque nunca e apagado -- corrige-se com novo ajuste.
  if v_movimentacao.tipo = 'ajuste_manual' then
    raise exception 'excluir_movimentacao_saco: movimentacao % e um ajuste de estoque -- ajustes nao podem ser excluidos; registre um novo ajuste.', p_movimentacao_id;
  end if;

  if v_movimentacao.tipo not in ('abertura', 'saldo_inicial') then
    raise exception 'excluir_movimentacao_saco: movimentacao % tem tipo=%, somente aberturas e saldos iniciais podem ser excluidos por esta funcao.',
      p_movimentacao_id, v_movimentacao.tipo;
  end if;

  perform 1 from public.produto_fornecedores
  where id = v_movimentacao.produto_fornecedor_id
  for update;

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id
  for update;

  if v_movimentacao.id is null then
    return null;
  end if;

  v_saldo_outros := (
    select coalesce(sum(quantidade_sacos), 0)
    from public.sacos_fechados_movimentacoes
    where produto_fornecedor_id = v_movimentacao.produto_fornecedor_id
      and id <> p_movimentacao_id
  );

  if v_saldo_outros < 0 then
    raise exception 'excluir_movimentacao_saco: excluir esta movimentacao deixaria o saldo de sacos fechados negativo (resultante: % sacos). Exclua primeiro as outras movimentacoes na ordem correta.', v_saldo_outros;
  end if;

  v_origem_estoque_esperada := case v_movimentacao.tipo
    when 'abertura' then 'sacos_fechados_abertura'
    when 'saldo_inicial' then 'sacos_fechados_saldo_inicial'
  end;

  select count(*) into v_qtd_estoque_vinculado
  from public.estoque_movimentacoes
  where origem = v_origem_estoque_esperada
    and origem_id = p_movimentacao_id;

  if v_qtd_estoque_vinculado <> 1 then
    raise exception 'excluir_movimentacao_saco: esperada exatamente 1 movimentacao de estoque vinculada (origem=%, origem_id=%), encontrada(s) % -- abortando para nao dessincronizar silenciosamente.',
      v_origem_estoque_esperada, p_movimentacao_id, v_qtd_estoque_vinculado;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'sacos_fechados_movimentacao',
    p_movimentacao_id::text,
    'excluiu',
    null,
    format(
      'produto_fornecedor_id=%s; tipo=%s; origem=%s; quantidade_sacos=%s; peso_por_saco_kg_snapshot=%s; pedido_item_id=%s; operacao_id=%s; observacao=%s; criado_por=%s; criado_em=%s',
      v_movimentacao.produto_fornecedor_id, v_movimentacao.tipo, v_movimentacao.origem,
      v_movimentacao.quantidade_sacos, v_movimentacao.peso_por_saco_kg_snapshot,
      v_movimentacao.pedido_item_id, v_movimentacao.operacao_id,
      coalesce(v_movimentacao.observacao, ''), v_movimentacao.criado_por, v_movimentacao.criado_em
    ),
    v_motivo
  );

  delete from public.estoque_movimentacoes
  where origem = v_origem_estoque_esperada
    and origem_id = p_movimentacao_id;

  delete from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  return v_movimentacao;
end;
$$;

comment on function public.excluir_movimentacao_saco(uuid, text) is
  'Exclusao FISICA de uma movimentacao MANUAL de sacos fechados (abertura ou saldo_inicial -- nunca entrada automatica de pedido; ajuste de estoque/ajuste_manual e imutavel desde a 0074 e e rejeitado). Exige producao_sacos.excluir e motivo. Trava a configuracao (FOR UPDATE, mesma ordem das demais RPCs de Sacos) e a propria movimentacao antes de simular o saldo; impede saldo negativo. Origem de estoque esperada pelo tipo e EXATAMENTE 1 linha vinculada exigida antes de apagar. Grava snapshot completo + motivo em logs_auditoria ANTES da remocao fisica; remove estoque vinculado e a movimentacao na MESMA transacao. Idempotente para corrida real. SECURITY DEFINER.';

revoke execute on function public.excluir_movimentacao_saco(uuid, text) from public;
revoke execute on function public.excluir_movimentacao_saco(uuid, text) from anon;
revoke execute on function public.excluir_movimentacao_saco(uuid, text) from service_role;
grant execute on function public.excluir_movimentacao_saco(uuid, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro SOMENTE enquanto nenhum ajuste real tiver sido gravado. Depois
-- do primeiro ajuste, NAO reverter: remover as colunas apagaria motivo/
-- saldo anterior de movimentacoes reais (e a CHECK antiga deixaria as
-- linhas ajuste_manual editaveis/excluiveis sem sincronizar estoque).
-- Para desfazer: restaurar editar_movimentacao_saco (corpo da 0046),
-- excluir_movimentacao_saco (corpo da 0050) e
-- sacos_fechados_movimentacoes_protecao (corpo da 0042) a partir desses
-- arquivos, e entao:
-- BEGIN;
--   drop function if exists public.registrar_ajuste_sacos(uuid, integer, integer, text, uuid, text);
--   delete from public.usuario_permissoes where permissao = 'producao_sacos.ajustar';
--   delete from public.perfil_permissoes where permissao = 'producao_sacos.ajustar';
--   delete from public.permissoes where codigo = 'producao_sacos.ajustar';
--   alter table public.sacos_fechados_movimentacoes drop constraint if exists sacos_fechados_movimentacoes_ajuste_coerente_check;
--   alter table public.sacos_fechados_movimentacoes drop column if exists saldo_anterior_sacos;
--   alter table public.sacos_fechados_movimentacoes drop column if exists motivo;
-- COMMIT;
