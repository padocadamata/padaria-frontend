-- 0077_folha_documentos.sql
-- FOLHA DE PAGAMENTO > COMUNICACAO -- DOCUMENTOS DE RH (nucleo).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria (0077 PREAUDIT). Pre-requisitos:
-- 0003/0016 (has_permissao), 0054 (funcionarios/cargos), 0066 (folha_hoje).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.folha_documentos_config -- LINHA UNICA com os dados
--      institucionais (nome fantasia, razao social, CNPJ, endereco,
--      cidade/UF, responsavel e cargo). Nasce VAZIA (nenhum dado real da
--      empresa nesta migration); preenchida pela tela de configuracao.
--      CNPJ opcional, mas se informado tem de ser VALIDO (digitos
--      verificadores conferidos no banco).
--   2. public.folha_documentos_modelos -- modelos editaveis: titulo
--      impresso, abrangencia individual|geral, corpo com variaveis {{x}},
--      campos configuraveis (JSONB validado), blocos de assinatura manual
--      (empresa, funcionario, 0-2 testemunhas, local/data), versao (+1 a
--      cada alteracao de conteudo), ativo. Nunca apagado. Nome unico
--      ignorando maiusculas, espacos externos e acentos.
--   3. public.folha_documentos -- documento EMITIDO, registro historico
--      oficial: numero anual (2026/0001), conteudo final resolvido +
--      snapshot JSONB autossuficiente e MINIMO (modelo, valores, variaveis
--      efetivamente usadas no texto, funcionario so id + nome,
--      layout_versao) -- CPF/RG so entram se o texto os usa. Imutavel; nunca apagado; status emitido|cancelado
--      (cancelamento logico com motivo obrigatorio).
--   4. public.folha_documentos_numeracao -- contador por ano (interno).
--   5. Funcoes internas de validacao/formatacao/resolucao -- MESMAS regras
--      do nucleo JS lib/documentos/ (testadas com os mesmos casos).
--   6. RPCs: folha_documentos_config_salvar, folha_documento_modelo_salvar,
--      folha_documento_modelo_definir_ativo, folha_documento_emitir,
--      folha_documento_cancelar. Escrita SOMENTE por RPC.
--   7. Guardas (triggers): nada e apagado; documento imutavel exceto a
--      transicao emitido -> cancelado; versao do modelo coerente; contador
--      nunca volta.
--   8. RLS: SELECT por permissao; nenhuma escrita direta.
--   9. 4 permissoes novas, concedidas SOMENTE a proprietario_admin.
--
-- NAO FAZ: Storage/bucket/anexos (fora do MVP, futura 0078); nenhuma
-- assinatura digitalizada; nenhum modelo inicial; nenhum dado real da
-- empresa; nenhuma alteracao em tabelas/funcoes existentes; nenhum
-- acesso novo para perfis alem de proprietario_admin.
--
-- Erros de validacao saem como "folha_documentos: [codigo] mensagem" --
-- o codigo e o mesmo de lib/documentos/ (a tela mostra o texto de la).
--
-- Transacional (BEGIN/COMMIT): aborta sem criar nada se os pressupostos
-- nao forem verdadeiros.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente.
-- ============================================================
do $$
declare
  v_fp text;
begin
  if to_regprocedure('public.has_permissao(text)') is null
     or to_regprocedure('public.folha_hoje()') is null
     or to_regclass('public.funcionarios') is null
     or to_regclass('public.funcionarios_cargos') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.permissoes') is null
     or to_regclass('public.perfil_permissoes') is null then
    raise exception '0077 abortada: dependencias (has_permissao, folha_hoje, funcionarios, usuarios, permissoes) nao encontradas.';
  end if;

  -- translate() com acentos (nome do modelo) e normalize() exigem UTF8.
  if current_setting('server_encoding') <> 'UTF8' then
    raise exception '0077 abortada: banco nao esta em UTF8 (%).', current_setting('server_encoding');
  end if;

  if not exists (select 1 from public.perfis where nome = 'proprietario_admin') then
    raise exception '0077 abortada: perfil proprietario_admin nao encontrado.';
  end if;

  -- folha_hoje (0066) define data_emissao: precisa ser exatamente hoje em
  -- America/Sao_Paulo (mesma impressao digital conferida pela 0076).
  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_hoje()') and prorettype = 'date'::regtype;
  if v_fp is distinct from 'a1f96c34e9488c9cd3a6779bd2b18c1e' then
    raise exception '0077 abortada: folha_hoje() real difere da 0066 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  if to_regclass('public.folha_documentos_config') is not null
     or to_regclass('public.folha_documentos_modelos') is not null
     or to_regclass('public.folha_documentos') is not null
     or to_regclass('public.folha_documentos_numeracao') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'folha\_documento%')
     or exists (select 1 from public.permissoes where codigo like 'folha\_documentos.%') then
    raise exception '0077 abortada: objetos desta migration ja existem -- ela ja parece aplicada.';
  end if;
end $$;

-- ============================================================
-- 1. Funcoes internas -- MESMAS regras de lib/documentos/.
--    Todas IMMUTABLE/STABLE, search_path vazio, sem EXECUTE para
--    ninguem (so as RPCs SECURITY DEFINER abaixo as chamam).
-- ============================================================

-- Erro de validacao com codigo estavel (lib/documentos/erros.js).
-- VOLATILE de proposito: nunca pre-avaliada pelo planejador.
create function public.folha_documentos_falhar(p_codigo text, p_mensagem text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception 'folha_documentos: [%] %', p_codigo, p_mensagem using errcode = 'P0001';
end;
$$;

-- aparar() do JS: so espaco, tab e quebras de linha (btrim padrao so
-- tiraria espaco).
create function public.folha_documentos_aparar(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(p_texto, E' \t\n\r');
$$;

-- Data 'AAAA-MM-DD' real entre 1900 e 2100 (formatacao.js dataValida).
create function public.folha_documentos_data_valida(p_texto text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ano int;
  v_mes int;
  v_dia int;
begin
  if p_texto is null or p_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  v_ano := substr(p_texto, 1, 4)::int;
  v_mes := substr(p_texto, 6, 2)::int;
  v_dia := substr(p_texto, 9, 2)::int;
  if v_ano < 1900 or v_ano > 2100 or v_mes < 1 or v_mes > 12 then
    return false;
  end if;
  return v_dia >= 1
     and v_dia <= extract(day from (make_date(v_ano, v_mes, 1) + interval '1 month - 1 day'))::int;
end;
$$;

-- formatacao.js: formatarData / formatarDataExtenso / formatarCpf /
-- formatarCnpj / formatarNumeroDocumento.
create function public.folha_documentos_formatar_data(p_data date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_data, 'DD/MM/YYYY');
$$;

create function public.folha_documentos_formatar_data_extenso(p_data date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when extract(day from p_data) = 1 then '1º' else extract(day from p_data)::int::text end
    || ' de '
    || (array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
              'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'])[extract(month from p_data)::int]
    || ' de ' || extract(year from p_data)::int::text;
$$;

create function public.folha_documentos_formatar_cpf(p_valor text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(d) = 11
              then substr(d, 1, 3) || '.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-' || substr(d, 10, 2)
              else p_valor end
  from (select regexp_replace(p_valor, '[^0-9]', '', 'g') as d) x;
$$;

create function public.folha_documentos_formatar_cnpj(p_valor text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(d) = 14
              then substr(d, 1, 2) || '.' || substr(d, 3, 3) || '.' || substr(d, 6, 3) || '/' || substr(d, 9, 4) || '-' || substr(d, 13, 2)
              else p_valor end
  from (select regexp_replace(p_valor, '[^0-9]', '', 'g') as d) x;
$$;

create function public.folha_documentos_formatar_numero(p_ano int, p_numero int)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_ano::text || '/' || case when p_numero < 10000 then lpad(p_numero::text, 4, '0') else p_numero::text end;
$$;

-- Chave de unicidade do nome do modelo (modelo.js chaveNomeModelo):
-- aparado, NFC, sem acento e minusculo por uma tabela FIXA (translate) --
-- sem lower() (depende do locale) e sem a extensao unaccent (dependencia
-- desnecessaria; a tabela cobre o portugues). "Advertencia" =
-- "ADVERTENCIA" = " advertência ". Base do indice unico.
create function public.folha_documentos_nome_chave(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(normalize(btrim(p_nome, E' \t\n\r'), NFC),
                   'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿABCDEFGHIJKLMNOPQRSTUVWXYZ',
                   'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccnnyyyabcdefghijklmnopqrstuvwxyz');
$$;

-- CNPJ valido: 14 digitos, nao todos iguais, 2 digitos verificadores
-- (mesmo algoritmo de lib/funcionarios/normalizacao.js cnpjValido).
-- Recebe so digitos (a RPC tira a mascara antes).
create function public.folha_documentos_cnpj_valido(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_soma integer;
  v_dv1  integer;
  v_dv2  integer;
begin
  if p_cnpj is null or p_cnpj !~ '^[0-9]{14}$' or p_cnpj ~ '^([0-9])\1{13}$' then
    return false;
  end if;
  select sum(substr(p_cnpj, i, 1)::int * (array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])[i]) into v_soma
  from generate_series(1, 12) i;
  v_dv1 := case when v_soma % 11 < 2 then 0 else 11 - v_soma % 11 end;
  select sum(substr(p_cnpj, i, 1)::int * (array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])[i]) into v_soma
  from generate_series(1, 13) i;
  v_dv2 := case when v_soma % 11 < 2 then 0 else 11 - v_soma % 11 end;
  return substr(p_cnpj, 13, 1)::int = v_dv1 and substr(p_cnpj, 14, 1)::int = v_dv2;
end;
$$;

-- Catalogo das variaveis automaticas (placeholders.js
-- VARIAVEIS_AUTOMATICAS): nome + so_individual.
create function public.folha_documentos_variaveis_automaticas()
returns table (nome text, so_individual boolean)
language sql
immutable
set search_path = ''
as $$
  values
    ('funcionario.nome', true), ('funcionario.cpf', true), ('funcionario.rg', true),
    ('funcionario.cargo', true), ('funcionario.admissao', true),
    ('empresa.nome', false), ('empresa.razao_social', false), ('empresa.cnpj', false),
    ('empresa.endereco', false), ('empresa.cidade_uf', false), ('empresa.responsavel', false),
    ('empresa.responsavel_cargo', false),
    ('data_emissao', false), ('data_emissao_extenso', false), ('documento.numero', false);
$$;

-- Variaveis {{x}} do texto, cada uma UMA vez na ordem da 1a aparicao
-- (placeholders.js analisarPlaceholders). Levanta placeholder_malformado.
create function public.folha_documentos_placeholders(p_corpo text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nome  text;
  v_nomes text[] := array[]::text[];
  v_ruim  boolean;
begin
  v_ruim := regexp_replace(coalesce(p_corpo, ''), '\{\{[^{}]*\}\}', '', 'g') ~ '\{\{|\}\}';
  for v_nome in
    select m[1] from regexp_matches(coalesce(p_corpo, ''), '\{\{([^{}]*)\}\}', 'g') with ordinality as t(m, ordem) order by ordem
  loop
    if v_nome !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$' then
      v_ruim := true;
    elsif not (v_nome = any(v_nomes)) then
      v_nomes := v_nomes || v_nome;
    end if;
  end loop;
  if v_ruim then
    perform public.folha_documentos_falhar('placeholder_malformado',
      'variavel mal escrita: use {{nome}} sem espacos, so letras minusculas, numeros e _.');
  end if;
  return v_nomes;
end;
$$;

-- Troca cada {{x}} pelo valor em p_variaveis numa UNICA passada
-- (placeholders.js resolverTemplate): corta o texto nos tokens e intercala
-- os valores. Variavel sem valor -> dado_automatico_ausente.
create function public.folha_documentos_resolver(p_corpo text, p_variaveis jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_partes text[];
  v_nome   text;
  v_valor  text;
  v_saida  text;
  v_i      int := 1;
begin
  v_partes := regexp_split_to_array(p_corpo, '\{\{[^{}]*\}\}');
  v_saida := v_partes[1];
  for v_nome in
    select m[1] from regexp_matches(p_corpo, '\{\{([^{}]*)\}\}', 'g') with ordinality as t(m, ordem) order by ordem
  loop
    v_i := v_i + 1;
    v_valor := p_variaveis ->> v_nome;
    if v_valor is null then
      perform public.folha_documentos_falhar('dado_automatico_ausente', format('{{%s}} nao tem valor cadastrado.', v_nome));
    end if;
    v_saida := v_saida || v_valor || v_partes[v_i];
  end loop;
  return v_saida;
end;
$$;

-- Definicao dos campos (campos.js validarCampos) -- MESMA ordem de
-- verificacao; para no 1o erro.
create function public.folha_documentos_campos_validar(p_campos jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_campo        jsonb;
  v_n            int := 0;
  v_chave        text;
  v_tipo         text;
  v_tipo_valido  boolean;
  v_papel        text;
  v_rotulo       text;
  v_opcao        jsonb;
  v_opcoes_ok    boolean;
  v_vistas       text[];
  v_chaves       text[] := array[]::text[];
  v_papeis       text[] := array[]::text[];
begin
  if p_campos is null or jsonb_typeof(p_campos) <> 'array' then
    perform public.folha_documentos_falhar('campos_formato', 'lista de campos invalida.');
  end if;
  if jsonb_array_length(p_campos) > 30 then
    perform public.folha_documentos_falhar('campos_quantidade', 'no maximo 30 campos.');
  end if;

  for v_campo in select value from jsonb_array_elements(p_campos) with ordinality as t(value, ordem) order by ordem loop
    v_n := v_n + 1;
    if jsonb_typeof(v_campo) <> 'object' then
      perform public.folha_documentos_falhar('campo_formato', format('campo %s: definicao invalida.', v_n));
    end if;
    if exists (select 1 from jsonb_object_keys(v_campo) k
               where k not in ('chave', 'rotulo', 'tipo', 'obrigatorio', 'opcoes', 'dica', 'papel')) then
      perform public.folha_documentos_falhar('campo_propriedade_desconhecida', format('campo %s: propriedade desconhecida.', v_n));
    end if;

    v_chave := case when jsonb_typeof(v_campo -> 'chave') = 'string' then v_campo ->> 'chave' end;
    if v_chave is null or v_chave !~ '^[a-z][a-z0-9_]{0,39}$' then
      perform public.folha_documentos_falhar('campo_chave_invalida', format('campo %s: chave invalida.', v_n));
    elsif v_chave in ('funcionario', 'empresa', 'documento', 'data_emissao', 'data_emissao_extenso') then
      perform public.folha_documentos_falhar('campo_chave_reservada', format('campo %s: chave "%s" reservada.', v_n, v_chave));
    elsif v_chave = any(v_chaves) then
      perform public.folha_documentos_falhar('campo_chave_duplicada', format('campo %s: chave "%s" repetida.', v_n, v_chave));
    end if;
    v_chaves := v_chaves || v_chave;

    v_rotulo := case when jsonb_typeof(v_campo -> 'rotulo') = 'string' then public.folha_documentos_aparar(v_campo ->> 'rotulo') end;
    if v_rotulo is null or v_rotulo = '' or char_length(v_rotulo) > 80 then
      perform public.folha_documentos_falhar('campo_rotulo_invalido', format('campo %s: rotulo obrigatorio (ate 80).', v_n));
    end if;

    v_tipo := case when jsonb_typeof(v_campo -> 'tipo') = 'string' then v_campo ->> 'tipo' end;
    v_tipo_valido := v_tipo is not null and v_tipo in ('texto', 'texto_longo', 'data', 'selecao', 'numero');
    if not v_tipo_valido then
      perform public.folha_documentos_falhar('campo_tipo_invalido', format('campo %s: tipo invalido.', v_n));
    end if;
    if coalesce(jsonb_typeof(v_campo -> 'obrigatorio'), '') <> 'boolean' then
      perform public.folha_documentos_falhar('campo_obrigatorio_invalido', format('campo %s: obrigatorio deve ser true/false.', v_n));
    end if;
    if coalesce(jsonb_typeof(v_campo -> 'dica'), 'null') <> 'null'
       and (jsonb_typeof(v_campo -> 'dica') <> 'string'
            or char_length(public.folha_documentos_aparar(v_campo ->> 'dica')) > 200) then
      perform public.folha_documentos_falhar('campo_dica_invalida', format('campo %s: dica ate 200 caracteres.', v_n));
    end if;

    if v_tipo = 'selecao' then
      v_opcoes_ok := jsonb_typeof(v_campo -> 'opcoes') = 'array'
                     and jsonb_array_length(v_campo -> 'opcoes') between 1 and 50;
      v_vistas := array[]::text[];
      if v_opcoes_ok then
        for v_opcao in select value from jsonb_array_elements(v_campo -> 'opcoes') loop
          if jsonb_typeof(v_opcao) <> 'string'
             or public.folha_documentos_aparar(v_opcao #>> '{}') = ''
             or char_length(public.folha_documentos_aparar(v_opcao #>> '{}')) > 100
             or public.folha_documentos_aparar(v_opcao #>> '{}') = any(v_vistas) then
            v_opcoes_ok := false;
            exit;
          end if;
          v_vistas := v_vistas || public.folha_documentos_aparar(v_opcao #>> '{}');
        end loop;
      end if;
      if not coalesce(v_opcoes_ok, false) then
        perform public.folha_documentos_falhar('campo_opcoes_invalidas', format('campo %s: selecao precisa de 1 a 50 opcoes validas e distintas.', v_n));
      end if;
    elsif coalesce(jsonb_typeof(v_campo -> 'opcoes'), 'null') <> 'null' then
      perform public.folha_documentos_falhar('campo_opcoes_indevidas', format('campo %s: so selecao tem opcoes.', v_n));
    end if;

    if coalesce(jsonb_typeof(v_campo -> 'papel'), 'null') <> 'null' then
      v_papel := case when jsonb_typeof(v_campo -> 'papel') = 'string' then v_campo ->> 'papel' end;
      if v_papel is null or v_papel not in ('assunto', 'data_ocorrencia') then
        perform public.folha_documentos_falhar('campo_papel_invalido', format('campo %s: papel invalido.', v_n));
      elsif v_tipo_valido
            and ((v_papel = 'assunto' and v_tipo not in ('texto', 'selecao'))
                 or (v_papel = 'data_ocorrencia' and v_tipo <> 'data')) then
        perform public.folha_documentos_falhar('campo_papel_incompativel', format('campo %s: papel %s incompativel com o tipo %s.', v_n, v_papel, v_tipo));
      elsif v_papel = any(v_papeis) then
        perform public.folha_documentos_falhar('campo_papel_repetido', format('campo %s: papel %s repetido.', v_n, v_papel));
      end if;
      v_papeis := v_papeis || v_papel;
    end if;
  end loop;
end;
$$;

-- Forma canonica (campos.js normalizarCampos). Pressupoe campos validos.
create function public.folha_documentos_campos_normalizar(p_campos jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'chave', c ->> 'chave',
             'rotulo', public.folha_documentos_aparar(c ->> 'rotulo'),
             'tipo', c ->> 'tipo',
             'obrigatorio', (c -> 'obrigatorio')
           )
           || case when c ->> 'tipo' = 'selecao'
                   then jsonb_build_object('opcoes', (select jsonb_agg(public.folha_documentos_aparar(o #>> '{}') order by i)
                                                      from jsonb_array_elements(c -> 'opcoes') with ordinality as x(o, i)))
                   else '{}'::jsonb end
           || case when jsonb_typeof(c -> 'dica') = 'string' and public.folha_documentos_aparar(c ->> 'dica') <> ''
                   then jsonb_build_object('dica', public.folha_documentos_aparar(c ->> 'dica'))
                   else '{}'::jsonb end
           || case when jsonb_typeof(c -> 'papel') = 'string'
                   then jsonb_build_object('papel', c ->> 'papel')
                   else '{}'::jsonb end
           order by ordem), '[]'::jsonb)
  from jsonb_array_elements(p_campos) with ordinality as t(c, ordem);
$$;

-- Modelo completo (modelo.js validarModelo) -- textos JA normalizados.
create function public.folha_documentos_modelo_validar(
  p_nome                   text,
  p_titulo                 text,
  p_descricao              text,
  p_abrangencia            text,
  p_corpo                  text,
  p_campos                 jsonb,
  p_assinatura_funcionario boolean,
  p_testemunhas            int
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nomes text[];
  v_nome  text;
  v_auto  record;
  v_chaves text[];
begin
  if p_abrangencia is null or p_abrangencia not in ('individual', 'geral') then
    perform public.folha_documentos_falhar('modelo_abrangencia_invalida', 'abrangencia deve ser individual ou geral.');
  end if;
  if p_nome = '' or char_length(p_nome) > 80 then
    perform public.folha_documentos_falhar('modelo_nome_invalido', 'nome obrigatorio (ate 80).');
  end if;
  if p_titulo = '' or char_length(p_titulo) > 120 then
    perform public.folha_documentos_falhar('modelo_titulo_invalido', 'titulo impresso obrigatorio (ate 120).');
  end if;
  if p_descricao is not null and char_length(p_descricao) > 300 then
    perform public.folha_documentos_falhar('modelo_descricao_invalida', 'descricao ate 300.');
  end if;
  if p_corpo = '' then
    perform public.folha_documentos_falhar('modelo_corpo_vazio', 'texto do documento obrigatorio.');
  elsif char_length(p_corpo) > 20000 then
    perform public.folha_documentos_falhar('modelo_corpo_longo', 'texto ate 20000 caracteres.');
  end if;
  if p_testemunhas is null or p_testemunhas < 0 or p_testemunhas > 2 then
    perform public.folha_documentos_falhar('modelo_testemunhas_invalidas', 'testemunhas: 0, 1 ou 2.');
  end if;
  if p_assinatura_funcionario and p_abrangencia = 'geral' then
    perform public.folha_documentos_falhar('modelo_assinatura_funcionario_geral', 'documento geral nao tem assinatura de funcionario.');
  end if;

  perform public.folha_documentos_campos_validar(p_campos);
  select coalesce(array_agg(c ->> 'chave'), array[]::text[]) into v_chaves from jsonb_array_elements(p_campos) c;

  v_nomes := public.folha_documentos_placeholders(p_corpo);
  foreach v_nome in array v_nomes loop
    select a.nome, a.so_individual into v_auto from public.folha_documentos_variaveis_automaticas() a where a.nome = v_nome;
    if found then
      if p_abrangencia = 'geral' and v_auto.so_individual then
        perform public.folha_documentos_falhar('placeholder_funcionario_em_geral', format('{{%s}} so pode ser usada em documento individual.', v_nome));
      end if;
    elsif not (v_nome = any(v_chaves)) then
      perform public.folha_documentos_falhar('placeholder_desconhecido', format('{{%s}} nao e variavel automatica nem campo do modelo.', v_nome));
    end if;
  end loop;

  select c ->> 'chave' into v_nome
  from jsonb_array_elements(p_campos) with ordinality as t(c, ordem)
  where coalesce(jsonb_typeof(c -> 'papel'), 'null') = 'null' and not ((c ->> 'chave') = any(v_nomes))
  order by ordem limit 1;
  if v_nome is not null then
    perform public.folha_documentos_falhar('campo_nao_utilizado', format('o campo "%s" nao aparece no texto.', v_nome));
  end if;
end;
$$;

-- Valores da emissao (campos.js validarValores) -> {chave: canonico}.
create function public.folha_documentos_valores_normalizar(p_campos jsonb, p_valores jsonb, p_hoje date)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_campo  jsonb;
  v_chave  text;
  v_tipo   text;
  v_rotulo text;
  v_bruto  jsonb;
  v_valor  text;
  v_saida  jsonb := '{}'::jsonb;
begin
  if p_valores is null or jsonb_typeof(p_valores) <> 'object' then
    perform public.folha_documentos_falhar('valores_formato', 'valores do formulario invalidos.');
  end if;
  if exists (select 1 from jsonb_object_keys(p_valores) k
             where not exists (select 1 from jsonb_array_elements(p_campos) c where c ->> 'chave' = k)) then
    perform public.folha_documentos_falhar('valor_campo_desconhecido', 'o formulario enviou um campo que nao existe neste modelo.');
  end if;

  for v_campo in select value from jsonb_array_elements(p_campos) with ordinality as t(value, ordem) order by ordem loop
    v_chave := v_campo ->> 'chave';
    v_tipo := v_campo ->> 'tipo';
    v_rotulo := v_campo ->> 'rotulo';
    v_bruto := p_valores -> v_chave;
    if coalesce(jsonb_typeof(v_bruto), 'null') not in ('null', 'string') then
      perform public.folha_documentos_falhar('valor_tipo_invalido', format('%s: valor invalido.', v_rotulo));
    end if;
    v_valor := coalesce(v_bruto #>> '{}', '');
    if v_tipo = 'texto_longo' then
      v_valor := replace(replace(v_valor, E'\r\n', E'\n'), E'\r', E'\n');
    end if;
    v_valor := public.folha_documentos_aparar(v_valor);

    if v_valor <> '' then
      if v_tipo = 'texto' then
        if strpos(v_valor, E'\n') > 0 or strpos(v_valor, E'\r') > 0 then
          perform public.folha_documentos_falhar('valor_texto_quebra_linha', format('%s: use uma unica linha.', v_rotulo));
        elsif char_length(v_valor) > 200 then
          perform public.folha_documentos_falhar('valor_longo', format('%s: ate 200 caracteres.', v_rotulo));
        end if;
      elsif v_tipo = 'texto_longo' then
        if char_length(v_valor) > 4000 then
          perform public.folha_documentos_falhar('valor_longo', format('%s: ate 4000 caracteres.', v_rotulo));
        end if;
      elsif v_tipo = 'data' then
        if not public.folha_documentos_data_valida(v_valor) then
          perform public.folha_documentos_falhar('valor_data_invalida', format('%s: data invalida.', v_rotulo));
        elsif v_campo ->> 'papel' = 'data_ocorrencia' and v_valor::date > p_hoje then
          perform public.folha_documentos_falhar('valor_data_futura', format('%s: a data da ocorrencia nao pode ser no futuro.', v_rotulo));
        end if;
      elsif v_tipo = 'selecao' then
        if not exists (select 1 from jsonb_array_elements_text(v_campo -> 'opcoes') o where o = v_valor) then
          perform public.folha_documentos_falhar('valor_opcao_invalida', format('%s: escolha uma das opcoes.', v_rotulo));
        end if;
      elsif v_tipo = 'numero' then
        if v_valor !~ '^-?[0-9]{1,12}([.,][0-9]{1,4})?$' then
          perform public.folha_documentos_falhar('valor_numero_invalido', format('%s: numero invalido.', v_rotulo));
        end if;
        v_valor := regexp_replace(replace(v_valor, ',', '.'), '^(-?)0+(?=[0-9])', '\1');
      end if;
    end if;
    if v_valor = '' and (v_campo -> 'obrigatorio') = 'true'::jsonb then
      perform public.folha_documentos_falhar('valor_obrigatorio', format('%s: preenchimento obrigatorio.', v_rotulo));
    end if;
    v_saida := v_saida || jsonb_build_object(v_chave, v_valor);
  end loop;
  return v_saida;
end;
$$;

-- ============================================================
-- 2. public.folha_documentos_config -- linha unica, nasce vazia.
-- ============================================================
create table public.folha_documentos_config (
  id                   boolean primary key default true,
  nome_fantasia        text,
  razao_social         text,
  cnpj                 text,
  endereco             text,
  cidade_uf            text,
  responsavel_nome     text,
  responsavel_cargo    text,
  atualizado_em        timestamptz,
  atualizado_por       uuid references auth.users(id) on delete set null,
  atualizado_por_nome  text,

  constraint folha_documentos_config_linha_unica check (id),
  constraint folha_documentos_config_cnpj_valido check (cnpj is null or public.folha_documentos_cnpj_valido(cnpj)),
  constraint folha_documentos_config_textos_validos check (
    (nome_fantasia is null or (btrim(nome_fantasia) <> '' and char_length(nome_fantasia) <= 120))
    and (razao_social is null or (btrim(razao_social) <> '' and char_length(razao_social) <= 160))
    and (endereco is null or (btrim(endereco) <> '' and char_length(endereco) <= 300))
    and (cidade_uf is null or (btrim(cidade_uf) <> '' and char_length(cidade_uf) <= 120))
    and (responsavel_nome is null or (btrim(responsavel_nome) <> '' and char_length(responsavel_nome) <= 120))
    and (responsavel_cargo is null or (btrim(responsavel_cargo) <> '' and char_length(responsavel_cargo) <= 120))
  )
);

insert into public.folha_documentos_config (id) values (true);

comment on table public.folha_documentos_config is
  'Migration 0077. Dados institucionais dos documentos de RH -- LINHA UNICA (id = true), criada vazia (nenhum dado real na migration). Tudo opcional no banco (CNPJ, se informado, 14 digitos VALIDOS); a EMISSAO exige o que o documento usa (razao social sempre; cidade/UF com local e data; responsavel com assinatura da empresa; e cada {{empresa.x}} usado). Escrita somente por folha_documentos_config_salvar. Copiada para o snapshot de cada documento emitido -- alterar aqui nunca muda documento antigo.';

-- ============================================================
-- 3. public.folha_documentos_modelos.
-- ============================================================
create table public.folha_documentos_modelos (
  id                      uuid primary key default gen_random_uuid(),
  nome                    text not null,
  descricao               text,
  titulo_impresso         text not null,
  abrangencia             text not null,
  corpo                   text not null,
  campos                  jsonb not null default '[]'::jsonb,
  assinatura_empresa      boolean not null default true,
  assinatura_funcionario  boolean not null default false,
  testemunhas             smallint not null default 0,
  local_data              boolean not null default true,
  versao                  integer not null default 1,
  ativo                   boolean not null default true,

  criado_em               timestamptz not null default now(),
  criado_por              uuid references auth.users(id) on delete set null,
  criado_por_nome         text,
  atualizado_em           timestamptz,
  atualizado_por          uuid references auth.users(id) on delete set null,
  atualizado_por_nome     text,

  constraint folha_documentos_modelos_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 80),
  constraint folha_documentos_modelos_titulo_valido check (btrim(titulo_impresso) <> '' and char_length(titulo_impresso) <= 120),
  constraint folha_documentos_modelos_descricao_valida check (descricao is null or (btrim(descricao) <> '' and char_length(descricao) <= 300)),
  constraint folha_documentos_modelos_abrangencia_valida check (abrangencia in ('individual', 'geral')),
  constraint folha_documentos_modelos_corpo_valido check (btrim(corpo) <> '' and char_length(corpo) <= 20000),
  constraint folha_documentos_modelos_campos_array check (jsonb_typeof(campos) = 'array'),
  constraint folha_documentos_modelos_testemunhas_validas check (testemunhas between 0 and 2),
  constraint folha_documentos_modelos_assinatura_coerente check (abrangencia = 'individual' or not assinatura_funcionario),
  constraint folha_documentos_modelos_versao_valida check (versao >= 1)
);

-- Nome unico ignorando maiusculas, espacos externos e acentos.
create unique index folha_documentos_modelos_nome_idx on public.folha_documentos_modelos (public.folha_documentos_nome_chave(nome));

comment on table public.folha_documentos_modelos is
  'Migration 0077. Modelo EDITAVEL de documento de RH (advertencia, comunicado, termo, politica...). corpo usa variaveis {{x}} (automaticas do catalogo folha_documentos_variaveis_automaticas ou chaves de campos); campos = JSONB validado por folha_documentos_campos_validar. versao +1 a cada alteracao de conteudo (garantido pelo trigger); ativar/inativar nao muda a versao. Nunca apagado (so inativado). Nome unico por folha_documentos_nome_chave (sem diferenca de maiusculas, espacos externos ou acentos). Escrita somente por folha_documento_modelo_salvar / _definir_ativo. Documentos emitidos guardam o modelo no snapshot -- editar o modelo nunca altera o historico.';
comment on column public.folha_documentos_modelos.campos is
  'Array ordenado (ordem = ordem do formulario) de {chave, rotulo, tipo: texto|texto_longo|data|selecao|numero, obrigatorio, opcoes? (so selecao), dica?, papel?: assunto|data_ocorrencia}. Forma canonica gravada por folha_documentos_campos_normalizar.';

-- ============================================================
-- 4. public.folha_documentos_numeracao -- contador por ano (interno).
--    UPSERT com trava de linha: duas emissoes simultaneas nunca recebem
--    o mesmo numero; numero de documento cancelado nunca e reutilizado
--    (o contador so sobe).
-- ============================================================
create table public.folha_documentos_numeracao (
  ano     integer primary key,
  ultimo  integer not null,
  constraint folha_documentos_numeracao_ultimo_valido check (ultimo >= 1)
);

comment on table public.folha_documentos_numeracao is
  'Migration 0077 (interna). Ultimo numero emitido por ano. So folha_documento_emitir escreve (UPSERT atomico). Trigger impede apagar ou diminuir.';

-- ============================================================
-- 5. public.folha_documentos -- documento EMITIDO (historico oficial).
-- ============================================================
create table public.folha_documentos (
  id                   uuid primary key default gen_random_uuid(),
  ano                  integer not null,
  numero               integer not null,
  numero_formatado     text generated always as (
                         ano::text || '/' || case when numero < 10000 then lpad(numero::text, 4, '0') else numero::text end
                       ) stored,

  modelo_id            uuid not null references public.folha_documentos_modelos(id),
  modelo_versao        integer not null,
  abrangencia          text not null,
  funcionario_id       uuid references public.funcionarios(id),

  titulo               text not null,
  assunto              text,
  data_ocorrencia      date,
  data_emissao         date not null,

  conteudo             text not null,
  snapshot             jsonb not null,

  status               text not null default 'emitido',
  criado_em            timestamptz not null default now(),
  criado_por           uuid references auth.users(id) on delete set null,
  criado_por_nome      text,
  cancelado_em         timestamptz,
  cancelado_por        uuid references auth.users(id) on delete set null,
  cancelado_por_nome   text,
  motivo_cancelamento  text,

  constraint folha_documentos_numero_unico unique (ano, numero),
  constraint folha_documentos_numero_valido check (numero >= 1 and ano between 2000 and 2999),
  constraint folha_documentos_ano_coerente check (ano = extract(year from data_emissao)::int),
  constraint folha_documentos_modelo_versao_valida check (modelo_versao >= 1),
  constraint folha_documentos_abrangencia_valida check (abrangencia in ('individual', 'geral')),
  constraint folha_documentos_funcionario_coerente check ((abrangencia = 'individual') = (funcionario_id is not null)),
  constraint folha_documentos_snapshot_valido check (jsonb_typeof(snapshot) = 'object' and snapshot ? 'layout_versao'),
  constraint folha_documentos_status_valido check (status in ('emitido', 'cancelado')),
  constraint folha_documentos_estado_coerente check (
    (status = 'emitido' and cancelado_em is null and cancelado_por is null and cancelado_por_nome is null and motivo_cancelamento is null)
    or (status = 'cancelado' and cancelado_em is not null and motivo_cancelamento is not null and btrim(motivo_cancelamento) <> '')
  )
);

-- Ficha do funcionario (aba Documentos) e historico central por periodo/
-- modelo. (ano, numero) ja tem indice pela UNIQUE. Sem indice de status:
-- 2 valores, tabela pequena, sempre filtrada junto com periodo.
create index folha_documentos_funcionario_idx on public.folha_documentos (funcionario_id, data_emissao desc) where funcionario_id is not null;
create index folha_documentos_data_emissao_idx on public.folha_documentos (data_emissao desc);
create index folha_documentos_modelo_idx on public.folha_documentos (modelo_id);

comment on table public.folha_documentos is
  'Migration 0077. Documento de RH EMITIDO -- registro historico oficial. conteudo = texto final resolvido; snapshot = o necessario para reconstruir o documento SEM consultar o modelo atual nem o cadastro (layout_versao, documento, modelo, funcionario {id, nome}, empresa, valores, variaveis usadas no corpo) -- dado pessoal (CPF, RG...) so entra se o texto o usa. Imutavel (trigger): so a transicao emitido -> cancelado (motivo obrigatorio) e permitida. Nunca apagado. data_emissao = folha_hoje() no momento da emissao. Numero anual (ano, numero) do contador folha_documentos_numeracao -- nunca reutilizado. Escrita somente por folha_documento_emitir / folha_documento_cancelar.';
comment on column public.folha_documentos.assunto is
  'Valor do campo com papel assunto (copiado na emissao, para o historico); null se o modelo nao tem o papel ou o campo ficou vazio.';
comment on column public.folha_documentos.data_ocorrencia is
  'Valor do campo com papel data_ocorrencia (nunca futura); null se ausente.';

-- ============================================================
-- 6. Guardas.
-- ============================================================
create function public.folha_documentos_bloquear_exclusao_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '%: registros nunca sao apagados.', tg_table_name;
end;
$$;

create trigger folha_documentos_config_sem_exclusao
  before delete on public.folha_documentos_config
  for each row execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_config_sem_truncate
  before truncate on public.folha_documentos_config
  for each statement execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_modelos_sem_exclusao
  before delete on public.folha_documentos_modelos
  for each row execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_modelos_sem_truncate
  before truncate on public.folha_documentos_modelos
  for each statement execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_numeracao_sem_exclusao
  before delete on public.folha_documentos_numeracao
  for each row execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_numeracao_sem_truncate
  before truncate on public.folha_documentos_numeracao
  for each statement execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_sem_exclusao
  before delete on public.folha_documentos
  for each row execute function public.folha_documentos_bloquear_exclusao_fn();
create trigger folha_documentos_sem_truncate
  before truncate on public.folha_documentos
  for each statement execute function public.folha_documentos_bloquear_exclusao_fn();

-- Modelo: nasce na versao 1; autoria de criacao imutavel; conteudo
-- alterado => versao exatamente +1; sem alteracao de conteudo => mesma
-- versao (ativar/inativar nao muda versao).
create function public.folha_documentos_modelos_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conteudo_igual boolean;
begin
  if tg_op = 'INSERT' then
    if new.versao <> 1 then
      raise exception 'folha_documentos_modelos: modelo sempre nasce na versao 1.';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.criado_em <> old.criado_em
     or new.criado_por is distinct from old.criado_por or new.criado_por_nome is distinct from old.criado_por_nome then
    raise exception 'folha_documentos_modelos: identificacao e autoria de criacao sao imutaveis.';
  end if;

  v_conteudo_igual := (new.nome, new.descricao, new.titulo_impresso, new.abrangencia, new.corpo, new.campos,
                       new.assinatura_empresa, new.assinatura_funcionario, new.testemunhas, new.local_data)
                      is not distinct from
                      (old.nome, old.descricao, old.titulo_impresso, old.abrangencia, old.corpo, old.campos,
                       old.assinatura_empresa, old.assinatura_funcionario, old.testemunhas, old.local_data);
  if v_conteudo_igual and new.versao <> old.versao then
    raise exception 'folha_documentos_modelos: versao so muda quando o conteudo muda.';
  end if;
  if not v_conteudo_igual and new.versao <> old.versao + 1 then
    raise exception 'folha_documentos_modelos: alteracao de conteudo exige versao % (recebida %).', old.versao + 1, new.versao;
  end if;
  return new;
end;
$$;

create trigger folha_documentos_modelos_guarda
  before insert or update on public.folha_documentos_modelos
  for each row execute function public.folha_documentos_modelos_guarda_fn();

-- Contador nunca volta.
create function public.folha_documentos_numeracao_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ano <> old.ano or new.ultimo <= old.ultimo then
    raise exception 'folha_documentos_numeracao: o contador so avanca (numero nunca e reutilizado).';
  end if;
  return new;
end;
$$;

create trigger folha_documentos_numeracao_guarda
  before update on public.folha_documentos_numeracao
  for each row execute function public.folha_documentos_numeracao_guarda_fn();

-- Documento: nasce emitido e com data de hoje; tudo imutavel, exceto a
-- transicao emitido -> cancelado (dados do cancelamento). Cancelado e
-- final.
create function public.folha_documentos_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'emitido' then
      raise exception 'folha_documentos: documento sempre nasce emitido.';
    end if;
    if new.data_emissao <> public.folha_hoje() then
      raise exception 'folha_documentos: data de emissao deve ser hoje (%), recebida %.', public.folha_hoje(), new.data_emissao;
    end if;
    return new;
  end if;

  if (new.id, new.ano, new.numero, new.modelo_id, new.modelo_versao, new.abrangencia, new.funcionario_id,
      new.titulo, new.assunto, new.data_ocorrencia, new.data_emissao, new.conteudo, new.snapshot,
      new.criado_em, new.criado_por, new.criado_por_nome)
     is distinct from
     (old.id, old.ano, old.numero, old.modelo_id, old.modelo_versao, old.abrangencia, old.funcionario_id,
      old.titulo, old.assunto, old.data_ocorrencia, old.data_emissao, old.conteudo, old.snapshot,
      old.criado_em, old.criado_por, old.criado_por_nome) then
    raise exception 'folha_documentos: documento emitido e imutavel -- cancele e emita outro.';
  end if;

  if old.status = 'cancelado' then
    raise exception 'folha_documentos: documento cancelado e final.';
  end if;
  return new;
end;
$$;

create trigger folha_documentos_guarda
  before insert or update on public.folha_documentos
  for each row execute function public.folha_documentos_guarda_fn();

-- ============================================================
-- 7. RPCs (escrita somente por RPC; autoria do servidor).
-- ============================================================

-- Dados da empresa -- folha_documentos.modelos. Texto vazio vira NULL;
-- CNPJ aceito com ou sem mascara (so . / - e espaco sao descartados),
-- gravado com os 14 digitos e recusado se os verificadores nao batem
-- (config.js normalizarCnpjConfig).
create function public.folha_documentos_config_salvar(
  p_nome_fantasia      text,
  p_razao_social       text,
  p_cnpj               text,
  p_endereco           text,
  p_cidade_uf          text,
  p_responsavel_nome   text,
  p_responsavel_cargo  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnpj text;
begin
  if not (select public.has_permissao('folha_documentos.modelos')) then
    raise exception using errcode = '42501',
      message = 'folha_documentos_config_salvar: requer a permissao folha_documentos.modelos.';
  end if;

  v_cnpj := nullif(public.folha_documentos_aparar(coalesce(p_cnpj, '')), '');
  if v_cnpj is not null then
    v_cnpj := regexp_replace(v_cnpj, '[./ -]', '', 'g');
    if not public.folha_documentos_cnpj_valido(v_cnpj) then
      perform public.folha_documentos_falhar('config_cnpj_invalido', 'CNPJ invalido -- confira os numeros.');
    end if;
  end if;

  begin
    update public.folha_documentos_config
    set nome_fantasia = nullif(public.folha_documentos_aparar(coalesce(p_nome_fantasia, '')), ''),
        razao_social = nullif(public.folha_documentos_aparar(coalesce(p_razao_social, '')), ''),
        cnpj = v_cnpj,
        endereco = nullif(public.folha_documentos_aparar(coalesce(p_endereco, '')), ''),
        cidade_uf = nullif(public.folha_documentos_aparar(coalesce(p_cidade_uf, '')), ''),
        responsavel_nome = nullif(public.folha_documentos_aparar(coalesce(p_responsavel_nome, '')), ''),
        responsavel_cargo = nullif(public.folha_documentos_aparar(coalesce(p_responsavel_cargo, '')), ''),
        atualizado_em = now(), atualizado_por = auth.uid(),
        atualizado_por_nome = (select u.nome from public.usuarios u where u.id = auth.uid())
    where id;
  exception
    when check_violation then
      perform public.folha_documentos_falhar('config_texto_invalido', 'algum dado da empresa excede o tamanho maximo.');
  end;
  if not found then
    raise exception 'folha_documentos_config_salvar: linha de configuracao ausente (0077 incompleta).';
  end if;
end;
$$;

comment on function public.folha_documentos_config_salvar(text, text, text, text, text, text, text) is
  'Migration 0077. Atualiza a linha unica de dados institucionais (texto vazio = NULL; CNPJ com ou sem mascara, gravado com 14 digitos e digitos verificadores conferidos). Autoria = auth.uid(). Nao afeta documentos ja emitidos (snapshot). Requer folha_documentos.modelos.';

-- Modelo -- folha_documentos.modelos. p_modelo_id NULL = novo.
-- p_versao_esperada (edicao): versao que a tela abriu; diferente da atual
-- = alguem salvou antes (recusa em vez de sobrescrever).
create function public.folha_documento_modelo_salvar(
  p_modelo_id               uuid,
  p_versao_esperada         integer,
  p_nome                    text,
  p_descricao               text,
  p_titulo_impresso         text,
  p_abrangencia             text,
  p_corpo                   text,
  p_campos                  jsonb,
  p_assinatura_empresa      boolean,
  p_assinatura_funcionario  boolean,
  p_testemunhas             integer,
  p_local_data              boolean,
  p_ativo                   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome       text;
  v_descricao  text;
  v_titulo     text;
  v_corpo      text;
  v_campos     jsonb;
  v_atual      public.folha_documentos_modelos%rowtype;
  v_igual      boolean;
  v_id         uuid;
  v_versao     integer;
  v_usuario    text;
begin
  if not (select public.has_permissao('folha_documentos.modelos')) then
    raise exception using errcode = '42501',
      message = 'folha_documento_modelo_salvar: requer a permissao folha_documentos.modelos.';
  end if;

  v_nome := public.folha_documentos_aparar(coalesce(p_nome, ''));
  v_titulo := public.folha_documentos_aparar(coalesce(p_titulo_impresso, ''));
  v_descricao := nullif(public.folha_documentos_aparar(coalesce(p_descricao, '')), '');
  v_corpo := public.folha_documentos_aparar(replace(replace(coalesce(p_corpo, ''), E'\r\n', E'\n'), E'\r', E'\n'));

  perform public.folha_documentos_modelo_validar(
    v_nome, v_titulo, v_descricao, p_abrangencia, v_corpo, p_campos,
    coalesce(p_assinatura_funcionario, false), p_testemunhas);
  v_campos := public.folha_documentos_campos_normalizar(p_campos);
  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());

  begin
    if p_modelo_id is null then
      insert into public.folha_documentos_modelos (
        nome, descricao, titulo_impresso, abrangencia, corpo, campos,
        assinatura_empresa, assinatura_funcionario, testemunhas, local_data, versao, ativo,
        criado_por, criado_por_nome
      ) values (
        v_nome, v_descricao, v_titulo, p_abrangencia, v_corpo, v_campos,
        coalesce(p_assinatura_empresa, false), coalesce(p_assinatura_funcionario, false), p_testemunhas,
        coalesce(p_local_data, false), 1, coalesce(p_ativo, true),
        auth.uid(), v_usuario
      )
      returning id, versao into v_id, v_versao;
    else
      select * into v_atual from public.folha_documentos_modelos where id = p_modelo_id for update;
      if not found then
        perform public.folha_documentos_falhar('modelo_inexistente', 'modelo nao encontrado.');
      end if;
      if p_versao_esperada is distinct from v_atual.versao then
        perform public.folha_documentos_falhar('modelo_alterado',
          format('o modelo foi alterado por outra pessoa (versao %s, a tela abriu a %s). Recarregue antes de salvar.', v_atual.versao, coalesce(p_versao_esperada::text, '-')));
      end if;

      v_igual := (v_nome, v_descricao, v_titulo, p_abrangencia, v_corpo, v_campos,
                  coalesce(p_assinatura_empresa, false), coalesce(p_assinatura_funcionario, false),
                  p_testemunhas::smallint, coalesce(p_local_data, false))
                 is not distinct from
                 (v_atual.nome, v_atual.descricao, v_atual.titulo_impresso, v_atual.abrangencia, v_atual.corpo, v_atual.campos,
                  v_atual.assinatura_empresa, v_atual.assinatura_funcionario, v_atual.testemunhas, v_atual.local_data);

      update public.folha_documentos_modelos
      set nome = v_nome, descricao = v_descricao, titulo_impresso = v_titulo, abrangencia = p_abrangencia,
          corpo = v_corpo, campos = v_campos,
          assinatura_empresa = coalesce(p_assinatura_empresa, false),
          assinatura_funcionario = coalesce(p_assinatura_funcionario, false),
          testemunhas = p_testemunhas, local_data = coalesce(p_local_data, false),
          versao = case when v_igual then versao else versao + 1 end,
          ativo = coalesce(p_ativo, ativo),
          atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = v_usuario
      where id = p_modelo_id
      returning id, versao into v_id, v_versao;
    end if;
  exception
    when unique_violation then
      perform public.folha_documentos_falhar('modelo_nome_duplicado', 'ja existe um modelo com este nome.');
  end;

  return jsonb_build_object('id', v_id, 'versao', v_versao);
end;
$$;

comment on function public.folha_documento_modelo_salvar(uuid, integer, text, text, text, text, text, jsonb, boolean, boolean, integer, boolean, boolean) is
  'Migration 0077. Cria (p_modelo_id NULL) ou altera um modelo: valida tudo (folha_documentos_modelo_validar -- mesmas regras de lib/documentos/modelo.js), grava campos na forma canonica, versao +1 quando o conteudo muda, recusa edicao concorrente (p_versao_esperada). Nunca apaga. Devolve {id, versao}. Requer folha_documentos.modelos.';

-- Ativar/inativar sem reenviar o modelo (nao muda a versao).
create function public.folha_documento_modelo_definir_ativo(p_modelo_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('folha_documentos.modelos')) then
    raise exception using errcode = '42501',
      message = 'folha_documento_modelo_definir_ativo: requer a permissao folha_documentos.modelos.';
  end if;
  if p_ativo is null then
    raise exception 'folha_documento_modelo_definir_ativo: informe ativo (true/false).';
  end if;

  update public.folha_documentos_modelos
  set ativo = p_ativo, atualizado_em = now(), atualizado_por = auth.uid(),
      atualizado_por_nome = (select u.nome from public.usuarios u where u.id = auth.uid())
  where id = p_modelo_id;
  if not found then
    perform public.folha_documentos_falhar('modelo_inexistente', 'modelo nao encontrado.');
  end if;
end;
$$;

comment on function public.folha_documento_modelo_definir_ativo(uuid, boolean) is
  'Migration 0077. Ativa/inativa um modelo (modelo inativo nao emite). Nao altera a versao nem documentos emitidos. Requer folha_documentos.modelos.';

-- Emissao AUTORITATIVA -- folha_documentos.emitir. O navegador envia so
-- modelo + versao vista na previa + funcionario + valores digitados; o
-- banco relê modelo/funcionario/empresa, valida, numera, resolve o texto e
-- grava conteudo + snapshot. Mesmo calculo de lib/documentos/emissao.js
-- (montarEmissao).
create function public.folha_documento_emitir(
  p_modelo_id       uuid,
  p_modelo_versao   integer,
  p_funcionario_id  uuid,
  p_valores         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modelo     public.folha_documentos_modelos%rowtype;
  v_hoje       date;
  v_ano        integer;
  v_numero     integer;
  v_numero_fmt text;
  v_valores    jsonb;
  v_func       jsonb := null;
  v_empresa    jsonb;
  v_variaveis  jsonb;
  v_conteudo   text;
  v_nome       text;
  v_assunto    text;
  v_ocorrencia text;
  v_id         uuid;
begin
  if not (select public.has_permissao('folha_documentos.emitir')) then
    raise exception using errcode = '42501',
      message = 'folha_documento_emitir: requer a permissao folha_documentos.emitir.';
  end if;

  -- FOR SHARE: o modelo nao muda ate o fim desta emissao.
  select * into v_modelo from public.folha_documentos_modelos where id = p_modelo_id for share;
  if not found then
    perform public.folha_documentos_falhar('emissao_modelo_inexistente', 'modelo nao encontrado.');
  end if;
  if not v_modelo.ativo then
    perform public.folha_documentos_falhar('emissao_modelo_inativo', 'modelo inativo -- reative o modelo para emitir.');
  end if;
  if p_modelo_versao is distinct from v_modelo.versao then
    perform public.folha_documentos_falhar('emissao_modelo_alterado',
      format('o modelo mudou depois da previa (versao %s, previa da %s). Gere uma nova previa.', v_modelo.versao, coalesce(p_modelo_versao::text, '-')));
  end if;

  if v_modelo.abrangencia = 'individual' and p_funcionario_id is null then
    perform public.folha_documentos_falhar('emissao_funcionario_obrigatorio', 'escolha o funcionario deste documento.');
  end if;
  if v_modelo.abrangencia = 'geral' and p_funcionario_id is not null then
    perform public.folha_documentos_falhar('emissao_funcionario_indevido', 'documento geral nao tem funcionario.');
  end if;
  if p_funcionario_id is not null then
    -- Dados crus relevantes (emissao.js dadosFuncionario), aparados. So
    -- para calcular as variaveis -- o snapshot guarda id + nome.
    select jsonb_build_object(
             'id', f.id,
             'nome', nullif(public.folha_documentos_aparar(f.nome), ''),
             'cpf', nullif(public.folha_documentos_aparar(f.cpf), ''),
             'rg', nullif(public.folha_documentos_aparar(f.rg), ''),
             'cargo', nullif(public.folha_documentos_aparar(c.nome), ''),
             'admissao', to_char(f.data_admissao, 'YYYY-MM-DD'))
      into v_func
    from public.funcionarios f
    left join public.funcionarios_cargos c on c.id = f.cargo_id
    where f.id = p_funcionario_id;
    if v_func is null then
      perform public.folha_documentos_falhar('emissao_funcionario_inexistente', 'funcionario nao encontrado.');
    end if;
  end if;

  v_hoje := public.folha_hoje();
  v_valores := public.folha_documentos_valores_normalizar(v_modelo.campos, p_valores, v_hoje);

  select jsonb_build_object(
           'nome', nullif(public.folha_documentos_aparar(c.nome_fantasia), ''),
           'razao_social', nullif(public.folha_documentos_aparar(c.razao_social), ''),
           'cnpj', nullif(public.folha_documentos_aparar(c.cnpj), ''),
           'endereco', nullif(public.folha_documentos_aparar(c.endereco), ''),
           'cidade_uf', nullif(public.folha_documentos_aparar(c.cidade_uf), ''),
           'responsavel', nullif(public.folha_documentos_aparar(c.responsavel_nome), ''),
           'responsavel_cargo', nullif(public.folha_documentos_aparar(c.responsavel_cargo), ''))
    into v_empresa
  from public.folha_documentos_config c where c.id;
  if v_empresa is null then
    raise exception 'folha_documento_emitir: linha de configuracao ausente (0077 incompleta).';
  end if;

  -- Variaveis do escopo, formatadas (emissao.js montarVariaveis).
  v_variaveis := jsonb_build_object(
    'empresa.nome', v_empresa -> 'nome',
    'empresa.razao_social', v_empresa -> 'razao_social',
    'empresa.cnpj', to_jsonb(public.folha_documentos_formatar_cnpj(v_empresa ->> 'cnpj')),
    'empresa.endereco', v_empresa -> 'endereco',
    'empresa.cidade_uf', v_empresa -> 'cidade_uf',
    'empresa.responsavel', v_empresa -> 'responsavel',
    'empresa.responsavel_cargo', v_empresa -> 'responsavel_cargo',
    'data_emissao', public.folha_documentos_formatar_data(v_hoje),
    'data_emissao_extenso', public.folha_documentos_formatar_data_extenso(v_hoje),
    'documento.numero', null);
  if v_func is not null then
    v_variaveis := v_variaveis || jsonb_build_object(
      'funcionario.nome', v_func -> 'nome',
      'funcionario.cpf', to_jsonb(public.folha_documentos_formatar_cpf(v_func ->> 'cpf')),
      'funcionario.rg', v_func -> 'rg',
      'funcionario.cargo', v_func -> 'cargo',
      'funcionario.admissao', to_jsonb(public.folha_documentos_formatar_data((v_func ->> 'admissao')::date)));
  end if;
  v_variaveis := v_variaveis || coalesce((
    select jsonb_object_agg(
             c ->> 'chave',
             case when v_valores ->> (c ->> 'chave') = '' then ''
                  when c ->> 'tipo' = 'data' then public.folha_documentos_formatar_data((v_valores ->> (c ->> 'chave'))::date)
                  when c ->> 'tipo' = 'numero' then replace(v_valores ->> (c ->> 'chave'), '.', ',')
                  else v_valores ->> (c ->> 'chave') end)
    from jsonb_array_elements(v_modelo.campos) c), '{}'::jsonb);

  -- Dados exigidos (emissao.js pendenciasDeDados), na mesma ordem.
  if v_empresa ->> 'razao_social' is null then
    perform public.folha_documentos_falhar('config_razao_social_ausente', 'cadastre a razao social da empresa.');
  end if;
  if v_modelo.local_data and v_empresa ->> 'cidade_uf' is null then
    perform public.folha_documentos_falhar('config_cidade_uf_ausente', 'cadastre a cidade/UF da empresa (local e data).');
  end if;
  if v_modelo.assinatura_empresa and v_empresa ->> 'responsavel' is null then
    perform public.folha_documentos_falhar('config_responsavel_ausente', 'cadastre o responsavel da empresa (assinatura institucional).');
  end if;
  foreach v_nome in array public.folha_documentos_placeholders(v_modelo.corpo) loop
    if v_nome <> 'documento.numero' and v_variaveis ->> v_nome is null then
      perform public.folha_documentos_falhar('dado_automatico_ausente', format('{{%s}} nao tem valor cadastrado.', v_nome));
    end if;
  end loop;

  -- Numero anual: UPSERT atomico (trava a linha do ano ate o COMMIT).
  v_ano := extract(year from v_hoje)::int;
  insert into public.folha_documentos_numeracao as n (ano, ultimo) values (v_ano, 1)
  on conflict (ano) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_numero;
  v_numero_fmt := public.folha_documentos_formatar_numero(v_ano, v_numero);
  v_variaveis := v_variaveis || jsonb_build_object('documento.numero', v_numero_fmt);

  v_conteudo := public.folha_documentos_resolver(v_modelo.corpo, v_variaveis);

  select nullif(v_valores ->> (c ->> 'chave'), '') into v_assunto
  from jsonb_array_elements(v_modelo.campos) c where c ->> 'papel' = 'assunto';
  select nullif(v_valores ->> (c ->> 'chave'), '') into v_ocorrencia
  from jsonb_array_elements(v_modelo.campos) c where c ->> 'papel' = 'data_ocorrencia';

  insert into public.folha_documentos (
    ano, numero, modelo_id, modelo_versao, abrangencia, funcionario_id,
    titulo, assunto, data_ocorrencia, data_emissao, conteudo, snapshot,
    criado_por, criado_por_nome
  ) values (
    v_ano, v_numero, v_modelo.id, v_modelo.versao, v_modelo.abrangencia, p_funcionario_id,
    v_modelo.titulo_impresso, v_assunto, v_ocorrencia::date, v_hoje, v_conteudo,
    -- Snapshot layout 1 (emissao.js montarEmissao) -- autossuficiente.
    jsonb_build_object(
      'layout_versao', 1,
      'documento', jsonb_build_object(
        'ano', v_ano, 'numero', v_numero, 'numero_formatado', v_numero_fmt,
        'data_emissao', to_char(v_hoje, 'YYYY-MM-DD')),
      'modelo', jsonb_build_object(
        'id', v_modelo.id, 'nome', v_modelo.nome, 'versao', v_modelo.versao,
        'titulo', v_modelo.titulo_impresso, 'abrangencia', v_modelo.abrangencia,
        'corpo', v_modelo.corpo, 'campos', v_modelo.campos,
        'assinaturas', jsonb_build_object(
          'empresa', v_modelo.assinatura_empresa, 'funcionario', v_modelo.assinatura_funcionario,
          'testemunhas', v_modelo.testemunhas, 'local_data', v_modelo.local_data)),
      -- Minimo (emissao.js snapshotFuncionario / variaveisUsadas): CPF, RG
      -- etc. so entram como variavel usada pelo corpo. Responsavel e cargo
      -- da empresa so com assinatura da empresa (emissao.js snapshotEmpresa).
      'funcionario', case when v_func is null then null
                          else jsonb_build_object('id', v_func -> 'id', 'nome', v_func -> 'nome') end,
      'empresa', case when v_modelo.assinatura_empresa then v_empresa
                      else v_empresa - 'responsavel' - 'responsavel_cargo' end,
      'valores', v_valores,
      'variaveis', (select coalesce(jsonb_object_agg(n, v_variaveis -> n), '{}'::jsonb)
                    from unnest(public.folha_documentos_placeholders(v_modelo.corpo)) n)),
    auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.folha_documento_emitir(uuid, integer, uuid, jsonb) is
  'Migration 0077. Emite um documento: modelo ativo e NA VERSAO DA PREVIA (senao emissao_modelo_alterado), funcionario obrigatorio se individual e proibido se geral, valores validados/normalizados, dados da empresa exigidos pelo documento, numero anual atomico, data_emissao = folha_hoje(), texto resolvido no banco, snapshot autossuficiente e minimo (layout 1: funcionario so id + nome; variaveis so as usadas no corpo). Autoria = auth.uid(). Mesmo calculo de lib/documentos/emissao.js. Requer folha_documentos.emitir.';

-- Cancelamento logico -- folha_documentos.cancelar. So emitido; motivo
-- obrigatorio; conteudo e snapshot intocados; final.
create function public.folha_documento_cancelar(p_documento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_motivo text;
begin
  if not (select public.has_permissao('folha_documentos.cancelar')) then
    raise exception using errcode = '42501',
      message = 'folha_documento_cancelar: requer a permissao folha_documentos.cancelar.';
  end if;

  v_motivo := nullif(public.folha_documentos_aparar(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    perform public.folha_documentos_falhar('cancelamento_motivo_obrigatorio', 'o motivo do cancelamento e obrigatorio.');
  end if;
  if char_length(v_motivo) > 500 then
    perform public.folha_documentos_falhar('cancelamento_motivo_longo', 'motivo ate 500 caracteres.');
  end if;

  select d.status into v_status from public.folha_documentos d where d.id = p_documento_id for update;
  if not found then
    perform public.folha_documentos_falhar('documento_inexistente', 'documento nao encontrado.');
  end if;
  if v_status <> 'emitido' then
    perform public.folha_documentos_falhar('documento_ja_cancelado', 'este documento ja esta cancelado.');
  end if;

  update public.folha_documentos
  set status = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
      cancelado_por_nome = (select u.nome from public.usuarios u where u.id = auth.uid()),
      motivo_cancelamento = v_motivo
  where id = p_documento_id;
end;
$$;

comment on function public.folha_documento_cancelar(uuid, text) is
  'Migration 0077. Cancela LOGICAMENTE um documento emitido (motivo obrigatorio, ate 500; quem/quando do servidor). Conteudo, snapshot e numero permanecem; o documento continua consultavel. Cancelado e final. Requer folha_documentos.cancelar.';

-- ============================================================
-- 8. EXECUTE -- internas para ninguem; RPCs so para authenticated.
-- ============================================================
revoke execute on function public.folha_documentos_falhar(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_aparar(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_data_valida(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_formatar_data(date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_formatar_data_extenso(date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_formatar_cpf(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_formatar_cnpj(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_formatar_numero(integer, integer) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_nome_chave(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_cnpj_valido(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_variaveis_automaticas() from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_placeholders(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_resolver(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_campos_validar(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_campos_normalizar(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_modelo_validar(text, text, text, text, text, jsonb, boolean, integer) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_valores_normalizar(jsonb, jsonb, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_bloquear_exclusao_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_modelos_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_numeracao_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_documentos_guarda_fn() from public, anon, authenticated, service_role;

revoke execute on function public.folha_documentos_config_salvar(text, text, text, text, text, text, text) from public, anon, service_role;
revoke execute on function public.folha_documento_modelo_salvar(uuid, integer, text, text, text, text, text, jsonb, boolean, boolean, integer, boolean, boolean) from public, anon, service_role;
revoke execute on function public.folha_documento_modelo_definir_ativo(uuid, boolean) from public, anon, service_role;
revoke execute on function public.folha_documento_emitir(uuid, integer, uuid, jsonb) from public, anon, service_role;
revoke execute on function public.folha_documento_cancelar(uuid, text) from public, anon, service_role;
grant execute on function public.folha_documentos_config_salvar(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.folha_documento_modelo_salvar(uuid, integer, text, text, text, text, text, jsonb, boolean, boolean, integer, boolean, boolean) to authenticated;
grant execute on function public.folha_documento_modelo_definir_ativo(uuid, boolean) to authenticated;
grant execute on function public.folha_documento_emitir(uuid, integer, uuid, jsonb) to authenticated;
grant execute on function public.folha_documento_cancelar(uuid, text) to authenticated;

-- ============================================================
-- 9. Permissoes -- 4 codigos, SOMENTE proprietario_admin.
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('folha_documentos.visualizar', 'folha_documentos', 'visualizar', 'Ver documentos de RH emitidos (historico central e ficha do funcionario), modelos e dados da empresa; baixar/imprimir.'),
  ('folha_documentos.emitir',     'folha_documentos', 'emitir',     'Emitir documento de RH a partir de um modelo ativo.'),
  ('folha_documentos.cancelar',   'folha_documentos', 'cancelar',   'Cancelar (logicamente, com motivo) um documento de RH emitido.'),
  ('folha_documentos.modelos',    'folha_documentos', 'modelos',    'Criar/editar/ativar/inativar modelos de documento e os dados institucionais da empresa.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'folha_documentos.visualizar'),
  ('proprietario_admin', 'folha_documentos.emitir'),
  ('proprietario_admin', 'folha_documentos.cancelar'),
  ('proprietario_admin', 'folha_documentos.modelos')
on conflict do nothing;

-- ============================================================
-- 10. RLS e grants -- SOMENTE leitura para authenticated.
-- ============================================================
alter table public.folha_documentos_config enable row level security;
alter table public.folha_documentos_modelos enable row level security;
alter table public.folha_documentos_numeracao enable row level security;
alter table public.folha_documentos enable row level security;

-- Modelos e dados da empresa: quem ve, emite (previa) ou administra.
create policy folha_documentos_config_select on public.folha_documentos_config
  for select to authenticated
  using ((select public.has_permissao('folha_documentos.visualizar'))
         or (select public.has_permissao('folha_documentos.emitir'))
         or (select public.has_permissao('folha_documentos.modelos')));
create policy folha_documentos_modelos_select on public.folha_documentos_modelos
  for select to authenticated
  using ((select public.has_permissao('folha_documentos.visualizar'))
         or (select public.has_permissao('folha_documentos.emitir'))
         or (select public.has_permissao('folha_documentos.modelos')));
-- Documentos emitidos: so quem visualiza.
create policy folha_documentos_select on public.folha_documentos
  for select to authenticated
  using ((select public.has_permissao('folha_documentos.visualizar')));
-- folha_documentos_numeracao: SEM policy (RLS ligada = ninguem le).

comment on policy folha_documentos_config_select on public.folha_documentos_config is 'Quem ve, emite ou administra documentos le os dados da empresa. Escrita so por RPC.';
comment on policy folha_documentos_modelos_select on public.folha_documentos_modelos is 'Quem ve, emite ou administra documentos le os modelos. Escrita so por RPC.';
comment on policy folha_documentos_select on public.folha_documentos is 'Documentos de RH emitidos: somente folha_documentos.visualizar. Escrita so por RPC.';

revoke all on public.folha_documentos_config, public.folha_documentos_modelos, public.folha_documentos_numeracao, public.folha_documentos from public, anon;
revoke all on public.folha_documentos_config, public.folha_documentos_modelos, public.folha_documentos_numeracao, public.folha_documentos from authenticated;
grant select on public.folha_documentos_config, public.folha_documentos_modelos, public.folha_documentos to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, SO antes de existir documento real emitido -- os
-- triggers de guarda impedem apagar linhas; drop table remove tudo):
-- BEGIN;
-- drop function if exists public.folha_documento_cancelar(uuid, text);
-- drop function if exists public.folha_documento_emitir(uuid, integer, uuid, jsonb);
-- drop function if exists public.folha_documento_modelo_definir_ativo(uuid, boolean);
-- drop function if exists public.folha_documento_modelo_salvar(uuid, integer, text, text, text, text, text, jsonb, boolean, boolean, integer, boolean, boolean);
-- drop function if exists public.folha_documentos_config_salvar(text, text, text, text, text, text, text);
-- drop table if exists public.folha_documentos;
-- drop table if exists public.folha_documentos_numeracao;
-- drop table if exists public.folha_documentos_modelos;
-- drop table if exists public.folha_documentos_config;
-- drop function if exists public.folha_documentos_guarda_fn();
-- drop function if exists public.folha_documentos_numeracao_guarda_fn();
-- drop function if exists public.folha_documentos_modelos_guarda_fn();
-- drop function if exists public.folha_documentos_bloquear_exclusao_fn();
-- drop function if exists public.folha_documentos_valores_normalizar(jsonb, jsonb, date);
-- drop function if exists public.folha_documentos_modelo_validar(text, text, text, text, text, jsonb, boolean, integer);
-- drop function if exists public.folha_documentos_campos_normalizar(jsonb);
-- drop function if exists public.folha_documentos_campos_validar(jsonb);
-- drop function if exists public.folha_documentos_resolver(text, jsonb);
-- drop function if exists public.folha_documentos_placeholders(text);
-- drop function if exists public.folha_documentos_variaveis_automaticas();
-- drop function if exists public.folha_documentos_cnpj_valido(text);
-- drop function if exists public.folha_documentos_nome_chave(text);
-- drop function if exists public.folha_documentos_formatar_numero(integer, integer);
-- drop function if exists public.folha_documentos_formatar_cnpj(text);
-- drop function if exists public.folha_documentos_formatar_cpf(text);
-- drop function if exists public.folha_documentos_formatar_data_extenso(date);
-- drop function if exists public.folha_documentos_formatar_data(date);
-- drop function if exists public.folha_documentos_data_valida(text);
-- drop function if exists public.folha_documentos_aparar(text);
-- drop function if exists public.folha_documentos_falhar(text, text);
-- delete from public.perfil_permissoes where permissao like 'folha\_documentos.%';
-- delete from public.usuario_permissoes where permissao like 'folha\_documentos.%';
-- delete from public.permissoes where codigo like 'folha\_documentos.%';
-- COMMIT;
-- ============================================================
