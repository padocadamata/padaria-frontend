-- HOMOLOGAÇÃO LOCAL DO CARTÃO-PONTO -- dados 100% FICTÍCIOS.
-- Roda só no banco PGlite em memória do ambiente de homologação local
-- (depois de lib/ponto/__tests__/sql/ambiente.sql e da migration 0078).
-- NUNCA executar no Supabase. Datas relativas a hoje: o cenário vale em
-- qualquer mês.

-- useAuth lê estas colunas (o stub de teste não as tem).
alter table public.usuarios add column if not exists email text;
alter table public.usuarios add column if not exists ultimo_acesso_em timestamptz;
grant select on public.feriados_nacionais to authenticated;

-- Usuários fictícios (o perfil escolhido em /homologacao simula o login).
insert into auth.users values
  ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a2'), ('00000000-0000-4000-8000-0000000000a3');
insert into public.usuarios (id, nome, perfil, ativo, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'Admin Homologação', 'proprietario_admin', true, 'admin@homologacao.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'Lançadora Homologação', 'gestao', true, 'lancadora@homologacao.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'Leitora Homologação', 'gestao', true, 'leitora@homologacao.invalid');
-- Lançadora: ver + lançar (sem conferir/fechar/reabrir). Leitora: só ver.
insert into public.usuario_permissoes values
  ('00000000-0000-4000-8000-0000000000a2', 'folha_ponto.visualizar', 'concede', null),
  ('00000000-0000-4000-8000-0000000000a2', 'folha_ponto.lancar', 'concede', null),
  ('00000000-0000-4000-8000-0000000000a3', 'folha_ponto.visualizar', 'concede', null);

update public.folha_documentos_config
set nome_fantasia = 'Padoca (homologação)', razao_social = 'Empresa Fictícia de Homologação Ltda', cnpj = '00.000.000/0000-00', cidade_uf = 'Cidade/UF';

insert into public.feriados_nacionais values
  ('2026-09-07', 'Independência do Brasil'), ('2026-10-12', 'Nossa Senhora Aparecida'), ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'), ('2026-11-20', 'Dia da Consciência Negra'), ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  -- FICTÍCIO, só para testar nome longo na grade (dia de trabalho que continua de trabalho):
  ('2026-10-28', 'Feriado fictício de homologação com nome bem longo — Dia do Servidor e da Padroeira')
on conflict do nothing;

do $$
declare
  v_mes        date := date_trunc('month', current_date)::date;
  v_inicio     date := (date_trunc('month', current_date) - interval '3 months')::date;
  v_fim        date := (date_trunc('month', current_date) + interval '2 months' - interval '1 day')::date;
  v_atend      uuid;
  v_padeira    uuid;
  v_ana        uuid;
  v_bruna      uuid;
  v_carla      uuid;
  v_demissao   date := (date_trunc('month', current_date) - interval '1 month' + interval '14 days')::date;
  v_d          date;
  v_dia_id     uuid;
  v_falta      date;
  v_atestado   date;
  v_indefinido date;
  v_fechar     date := (date_trunc('month', current_date) - interval '2 months')::date;
  v_cartao     jsonb;
  v_versao     integer;
  v_lote       jsonb;
begin
  insert into public.funcionarios_cargos (nome) values ('Atendente') returning id into v_atend;
  insert into public.funcionarios_cargos (nome) values ('Padeira') returning id into v_padeira;
  insert into public.funcionarios (nome, cargo_id, data_admissao, tipo_vinculo) values ('Ana Fictícia', v_atend, '2024-03-01', 'funcionario') returning id into v_ana;
  insert into public.funcionarios (nome, cargo_id, data_admissao, data_demissao, ativo, tipo_vinculo)
    values ('Bruna Fictícia (desligada)', v_padeira, '2025-02-10', v_demissao, false, 'funcionario') returning id into v_bruna;
  insert into public.funcionarios (nome, cargo_id, data_admissao, tipo_vinculo) values ('Carla Fictícia (freelancer)', v_atend, '2025-06-01', 'freelancer') returning id into v_carla;

  -- Mês passado: uma Falta (2ª terça), um dia SEM Escala (dia 20). Há 2 meses: um Atestado na Escala (3ª quarta).
  v_falta := (date_trunc('month', current_date) - interval '1 month')::date;
  while extract(isodow from v_falta) <> 2 loop v_falta := v_falta + 1; end loop;
  v_falta := v_falta + 7;
  v_indefinido := (date_trunc('month', current_date) - interval '1 month')::date + 19;
  v_atestado := v_fechar;
  while extract(isodow from v_atestado) <> 3 loop v_atestado := v_atestado + 1; end loop;
  v_atestado := v_atestado + 14;

  v_d := v_inicio;
  while v_d <= v_fim loop
    -- Ana: seg-sex 06:00-09:00 + 09:15-12:15; sábado 06:00-10:00; domingo folga.
    if v_d <> v_indefinido then
      insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia)
        values (v_ana, v_d, case when extract(isodow from v_d) = 7 then 'folga' else 'trabalho' end) returning id into v_dia_id;
      if extract(isodow from v_d) between 1 and 5 then
        insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values (v_dia_id, '06:00', '09:00'), (v_dia_id, '09:15', '12:15');
      elsif extract(isodow from v_d) = 6 then
        insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values (v_dia_id, '06:00', '10:00');
      end if;
      if v_d = v_falta then insert into public.funcionarios_escala_ocorrencias (escala_dia_id, tipo) values (v_dia_id, 'falta'); end if;
      if v_d = v_atestado then insert into public.funcionarios_escala_ocorrencias (escala_dia_id, tipo) values (v_dia_id, 'atestado'); end if;
    end if;
    -- Bruna: seg-sex 13:00-19:00 até o desligamento.
    if v_d <= v_demissao then
      insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia)
        values (v_bruna, v_d, case when extract(isodow from v_d) between 1 and 5 then 'trabalho' else 'folga' end) returning id into v_dia_id;
      if extract(isodow from v_d) between 1 and 5 then
        insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values (v_dia_id, '13:00', '19:00');
      end if;
    end if;
    -- Carla (freelancer): tem Escala, mas NÃO entra no Cartão-Ponto.
    if extract(isodow from v_d) = 6 then
      insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia) values (v_carla, v_d, 'trabalho') returning id into v_dia_id;
      insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values (v_dia_id, '07:00', '13:00');
    end if;
    v_d := v_d + 1;
  end loop;

  -- Cartão FECHADO de exemplo (Ana, há 2 meses), pelas próprias RPCs da 0078
  -- como a Admin fictícia: horários iguais ao previsto, um dia com atraso.
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', false);
  v_cartao := public.folha_ponto_cartao_abrir(v_ana, v_fechar);
  select jsonb_agg(jsonb_build_object(
           'data', to_char(ed.data, 'YYYY-MM-DD'),
           'periodos', (select jsonb_agg(jsonb_build_object(
                                 'entrada', case when ed.data = v_fechar + 3 and p.hora_inicio = '06:00' then '06:25' else substr(p.hora_inicio::text, 1, 5) end,
                                 'saida', substr(p.hora_fim::text, 1, 5)) order by p.hora_inicio)
                        from public.funcionarios_escala_periodos p where p.escala_dia_id = ed.id)) order by ed.data)
    into v_lote
  from public.funcionarios_escala_dias ed
  where ed.funcionario_id = v_ana and ed.tipo_dia = 'trabalho'
    and ed.data between v_fechar and (v_fechar + interval '1 month' - interval '1 day')::date
    and not exists (select 1 from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = ed.id);
  v_versao := public.folha_ponto_dias_salvar((v_cartao ->> 'cartao_id')::uuid, (v_cartao ->> 'versao')::integer, v_lote);
  v_versao := public.folha_ponto_cartao_conferir((v_cartao ->> 'cartao_id')::uuid, v_versao);
  v_versao := public.folha_ponto_cartao_fechar((v_cartao ->> 'cartao_id')::uuid, v_versao);
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
