-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 9: Cashea por tienda, cédula, método de pago y cierre de mes
-- Ejecutar TODO en SQL Editor → Run, después de la v8.
-- Es seguro correrlo más de una vez. No borra ventas.
--
-- Qué agrega:
-- - Cada venta Cashea pertenece a una tienda: decocintas, merceria o caracas.
--   Las ventas que ya existían quedan como Mercería de Oriente.
-- - Cédula (V-, E-, J- o G- seguido de números) y método de pago de la inicial.
--   Son obligatorios en las ventas nuevas; las viejas quedan sin llenar.
-- - Cierre de mes: al cerrar un mes se guarda un resumen (archivo) y ese mes deja de
--   aceptar cambios en los datos de sus ventas. Solo se pueden cobrar o anular, y se
--   sigue haciendo la comprobación con Cashea.
--   · Cierre manual: botón "Cerrar mes" en el panel.
--   · Cierre automático: todos los días a las 11:59 p. m. (hora de Caracas) corre un
--     chequeo; si ese día es el último del mes, cierra el mes. Si ya se cerró a mano,
--     el automático no hace nada (el manual tiene prioridad).
--   · Requiere la extensión pg_cron. Si Supabase no la tiene activa, el script avisa
--     y el cierre queda solo manual hasta que la actives (Database → Extensions → pg_cron).
-- =====================================================

-- 1) Tienda de cada venta
alter table public.cashea_ventas add column if not exists tienda text not null default 'merceria';
alter table public.cashea_ventas alter column tienda drop default;

alter table public.cashea_ventas drop constraint if exists cashea_tienda_chk;
alter table public.cashea_ventas add constraint cashea_tienda_chk
  check (tienda in ('decocintas', 'merceria', 'caracas'));

-- 2) Cédula y método de pago de la inicial (obligatorios en las ventas nuevas, vía trigger)
alter table public.cashea_ventas add column if not exists cedula text;
alter table public.cashea_ventas add column if not exists metodo_pago text;

alter table public.cashea_ventas drop constraint if exists cashea_cedula_chk;
alter table public.cashea_ventas add constraint cashea_cedula_chk
  check (cedula is null or cedula ~ '^[VEJG]-[0-9]{5,10}$');

alter table public.cashea_ventas drop constraint if exists cashea_metodo_chk;
alter table public.cashea_ventas add constraint cashea_metodo_chk
  check (metodo_pago is null or metodo_pago in (
    'Efectivo USD', 'Efectivo Bs', 'Pago móvil', 'Transferencia', 'Punto de venta', 'Zelle', 'Otro'
  ));

-- 3) Cierres mensuales (archivo de cada mes cerrado)
create table if not exists public.cierres_mensuales (
  periodo      text primary key check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tipo         text not null check (tipo in ('manual', 'automatico')),
  cerrado_en   timestamptz not null default now(),
  cerrado_por  text not null,
  ventas       integer not null default 0,
  total_usd    numeric(14,2) not null default 0,
  resumen      jsonb not null default '[]'::jsonb
);

alter table public.cierres_mensuales enable row level security;
revoke all on public.cierres_mensuales from anon, authenticated;
grant select on public.cierres_mensuales to authenticated;

drop policy if exists cierres_leer on public.cierres_mensuales;
create policy cierres_leer on public.cierres_mensuales
  for select to authenticated
  using (public.usuaria_actual() is not null);

-- 4) Trigger de ventas: mes cerrado + cédula/método obligatorios + lo de la v8
create or replace function public.tr_cashea()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cerrado_nuevo boolean;
  v_cerrado_viejo boolean := false;
begin
  if tg_op = 'UPDATE' then
    new.actualizado_en := now();
    new.actualizado_por := public.usuaria_actual();
  end if;

  if new.cedula is not null then
    new.cedula := upper(regexp_replace(new.cedula, '\s', '', 'g'));
  end if;

  if tg_op = 'INSERT' and (new.cedula is null or new.metodo_pago is null) then
    raise exception 'Falta la cédula o el método de pago de la inicial';
  end if;

  -- Meses cerrados: no se crean ventas en ellos ni se cambian sus datos.
  -- Sí se pueden cobrar, anular y comprobar (esos campos no están en la lista de abajo).
  v_cerrado_nuevo := exists (
    select 1 from public.cierres_mensuales c where c.periodo = to_char(new.fecha, 'YYYY-MM'));

  if tg_op = 'INSERT' and v_cerrado_nuevo then
    raise exception 'El mes % ya está cerrado. Registra la venta con la fecha de un mes abierto.',
      to_char(new.fecha, 'YYYY-MM');
  end if;

  if tg_op = 'UPDATE' then
    v_cerrado_viejo := exists (
      select 1 from public.cierres_mensuales c where c.periodo = to_char(old.fecha, 'YYYY-MM'));
    if (v_cerrado_nuevo or v_cerrado_viejo) and (
         new.fecha, new.factura, new.nombre, new.apellido, new.cedula, new.tienda,
         new.monto_total_usd, new.tasa,
         new.pct_inicial, new.pct_comision, new.pct_adelanto, new.metodo_pago)
       is distinct from (
         old.fecha, old.factura, old.nombre, old.apellido, old.cedula, old.tienda,
         old.monto_total_usd, old.tasa,
         old.pct_inicial, old.pct_comision, old.pct_adelanto, old.metodo_pago) then
      raise exception 'Ese mes ya está cerrado: no se pueden cambiar los datos de esta venta (sí se puede cobrar o anular)';
    end if;
  end if;

  if new.estado = 'pendiente' then
    new.cobrada_en := null;
    new.anulada_en := null;
  elsif new.estado = 'cobrada' then
    new.anulada_en := null;
    if tg_op = 'INSERT' then
      new.cobrada_en := coalesce(new.cobrada_en, now());
    elsif old.estado is distinct from 'cobrada' then
      new.cobrada_en := now();
    end if;
  elsif new.estado = 'anulada' then
    if tg_op = 'INSERT' then
      new.anulada_en := coalesce(new.anulada_en, now());
    elsif old.estado is distinct from 'anulada' then
      new.anulada_en := now();
    end if;
  end if;

  if new.liq_fecha is not null and (
       tg_op = 'INSERT'
    or new.liq_recibido_bs is distinct from old.liq_recibido_bs
    or new.liq_tasa is distinct from old.liq_tasa
    or new.liq_fecha is distinct from old.liq_fecha) then
    new.liq_comprobado_por := public.usuaria_actual();
    new.liq_comprobado_en := now();
  end if;
  return new;
end $$;

drop trigger if exists cashea_cambios on public.cashea_ventas;
create trigger cashea_cambios
  before insert or update on public.cashea_ventas
  for each row execute function public.tr_cashea();

-- 5) Cierre de un mes (función interna, la usan el manual, el automático y el de respaldo)
create or replace function public.ejecutar_cierre(p_periodo text, p_tipo text, p_por text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_resumen jsonb;
  v_ventas integer;
  v_total numeric(14,2);
begin
  if exists (select 1 from public.cierres_mensuales where periodo = p_periodo) then
    return jsonb_build_object('ya_cerrado', true, 'periodo', p_periodo);
  end if;

  select coalesce(jsonb_agg(f order by f.orden), '[]'::jsonb) into v_resumen
  from (
    select
      case c.tienda when 'decocintas' then 1 when 'merceria' then 2 else 3 end as orden,
      c.tienda,
      count(*) filter (where c.estado <> 'anulada')::integer                       as ventas,
      count(*) filter (where c.estado = 'anulada')::integer                        as anuladas,
      coalesce(sum(c.monto_total_usd) filter (where c.estado <> 'anulada'), 0)::numeric(14,2) as total_usd,
      coalesce(sum(c.inicial_usd) filter (where c.estado <> 'anulada'), 0)::numeric(14,2)     as inicial_usd,
      coalesce(sum(c.descuento_usd) filter (where c.estado <> 'anulada'), 0)::numeric(14,2)   as descuento_usd,
      coalesce(sum(c.liquidacion_usd) filter (where c.estado <> 'anulada'), 0)::numeric(14,2) as liquidacion_usd
    from public.cashea_ventas c
    where to_char(c.fecha, 'YYYY-MM') = p_periodo
    group by c.tienda
  ) f;

  select count(*) filter (where estado <> 'anulada')::integer,
         coalesce(sum(monto_total_usd) filter (where estado <> 'anulada'), 0)::numeric(14,2)
    into v_ventas, v_total
  from public.cashea_ventas
  where to_char(fecha, 'YYYY-MM') = p_periodo;

  insert into public.cierres_mensuales (periodo, tipo, cerrado_por, ventas, total_usd, resumen)
  values (p_periodo, p_tipo, p_por, v_ventas, v_total, v_resumen)
  on conflict (periodo) do nothing;

  if not found then
    return jsonb_build_object('ya_cerrado', true, 'periodo', p_periodo);
  end if;

  insert into public.actividad (usuaria, texto)
  values (p_por, case when p_tipo = 'manual'
    then 'cerró el mes ' || p_periodo
    else 'cierre automático del mes ' || p_periodo end);

  return jsonb_build_object('ya_cerrado', false, 'periodo', p_periodo,
    'ventas', v_ventas, 'total_usd', v_total, 'tipo', p_tipo);
end $$;

-- 6) Cierre manual (botón "Cerrar mes"): cualquier mes que ya empezó o terminó
create or replace function public.cerrar_mes(p_periodo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_por text := public.usuaria_actual();
  v_hoy text := to_char((now() at time zone 'America/Caracas')::date, 'YYYY-MM');
begin
  if v_por is null then
    raise exception 'Cuenta no autorizada';
  end if;
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Período inválido';
  end if;
  if p_periodo > v_hoy then
    raise exception 'No se puede cerrar un mes que todavía no empieza';
  end if;
  return public.ejecutar_cierre(p_periodo, 'manual', v_por);
end $$;

-- 7) Cierre automático: lo llama pg_cron todos los días a las 11:59 p. m. (Caracas).
--    Solo cierra el mes si hoy es el último día del mes.
create or replace function public.cierre_automatico()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  if extract(day from (v_hoy + 1)) <> 1 then
    return jsonb_build_object('omitido', true, 'motivo', 'hoy no es el último día del mes');
  end if;
  return public.ejecutar_cierre(to_char(v_hoy, 'YYYY-MM'), 'automatico', 'Sistema (cierre automático)');
end $$;

-- 8) Respaldo: cierra los meses anteriores que tengan ventas y no estén cerrados.
--    Lo usa el botón "Cerrar meses vencidos" del panel, nunca se corre solo.
create or replace function public.cerrar_meses_vencidos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actual text := to_char((now() at time zone 'America/Caracas')::date, 'YYYY-MM');
  v_periodo text;
  v_cerrados integer := 0;
begin
  if public.usuaria_actual() is null then
    raise exception 'Cuenta no autorizada';
  end if;
  for v_periodo in
    select distinct to_char(fecha, 'YYYY-MM') from public.cashea_ventas
    where to_char(fecha, 'YYYY-MM') < v_actual
      and to_char(fecha, 'YYYY-MM') not in (select periodo from public.cierres_mensuales)
    order by 1
  loop
    perform public.ejecutar_cierre(v_periodo, 'manual', public.usuaria_actual());
    v_cerrados := v_cerrados + 1;
  end loop;
  return jsonb_build_object('cerrados', v_cerrados);
end $$;

-- 9) Permisos de las funciones
revoke all on function public.ejecutar_cierre(text, text, text) from public, anon, authenticated;
revoke all on function public.cierre_automatico() from public, anon, authenticated;
revoke all on function public.cerrar_mes(text) from public, anon;
revoke all on function public.cerrar_meses_vencidos() from public, anon;
grant execute on function public.cerrar_mes(text) to authenticated;
grant execute on function public.cerrar_meses_vencidos() to authenticated;

-- 10) Programar el cierre automático (11:59 p. m. Caracas = 03:59 UTC). Si pg_cron no está
--     disponible, el script avisa y no falla.
do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron no está activo. Actívalo en Database → Extensions, corre esta v9 otra vez, o cierra los meses con el botón del panel.';
      return;
    end;
  end if;
  execute $sql$select cron.schedule('cierre-mensual-caracas', '59 3 * * *', 'select public.cierre_automatico()')$sql$;
exception when others then
  raise notice 'No se pudo programar el cierre automático: %', sqlerrm;
end $cron$;

-- =====================================================
-- Listo. Las ventas Cashea tienen tienda, cédula y método de pago, y los meses
-- se pueden cerrar a mano o solos a las 11:59 p. m. del último día.
-- =====================================================
