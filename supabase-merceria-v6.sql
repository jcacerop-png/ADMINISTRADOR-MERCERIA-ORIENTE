-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 6: Cashea en dólares, porcentaje y cuotas
-- Ejecutar TODO en SQL Editor → Run, después de la v4 y la v5.
-- Es seguro correrlo más de una vez. No borra ventas.
--
-- - El monto de la venta se escribe en DÓLARES (monto_total_usd) con la tasa BCV del día.
-- - pct_pagado: porcentaje que se paga hoy (0 a 100).
-- - cuotas: 3, 6 o 12 (cuando queda saldo por pagar).
-- - Las columnas de cálculo se llenan solas:
--     pagado_usd  = total × porcentaje
--     pagado_bs   = tasa × total × porcentaje   (lo que se lleva hoy, en bolívares)
--     saldo_usd   = total − pagado_usd          (lo que queda por pagar)
--     cuota_usd   = saldo ÷ cuotas
--     cuota_bs    = tasa × saldo ÷ cuotas
-- - Las ventas de la v5 se convierten: su monto en Bs pasa a dólares
--   (monto ÷ tasa) y quedan como pagadas al 100%, sin cambiar el monto en Bs.
-- - Corre la v5 y luego esta v6 juntas: si vuelves a correr la v5 sola,
--   corre también esta v6 después.
-- =====================================================

-- 1) Columnas nuevas
alter table public.cashea_ventas add column if not exists monto_total_usd numeric(14,4);
alter table public.cashea_ventas add column if not exists pct_pagado numeric(5,2);
alter table public.cashea_ventas add column if not exists cuotas smallint;

-- 2) Pasar las ventas de la v5 (en bolívares) al modelo nuevo.
--    Los disparadores se apagan solo durante esta conversión, para que el
--    SQL Editor (sin cuenta del panel) pueda correrla.
alter table public.cashea_ventas disable trigger cashea_cambios;
alter table public.cashea_ventas disable trigger cashea_actividad;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cashea_ventas' and column_name = 'monto_bs') then
    update public.cashea_ventas
       set monto_total_usd = round(monto_bs / tasa, 4),
           pct_pagado = 100
     where monto_total_usd is null;
  end if;
end $$;

alter table public.cashea_ventas enable trigger cashea_cambios;
alter table public.cashea_ventas enable trigger cashea_actividad;

-- 3) Quitar las columnas de la v5 que ya no se usan (monto_bs y monto_usd)
alter table public.cashea_ventas drop column if exists monto_usd;
alter table public.cashea_ventas drop column if exists monto_bs;

-- 4) Reglas de los datos nuevos
alter table public.cashea_ventas alter column monto_total_usd set not null;
alter table public.cashea_ventas alter column pct_pagado set not null;

alter table public.cashea_ventas drop constraint if exists cashea_total_usd_chk;
alter table public.cashea_ventas add constraint cashea_total_usd_chk check (monto_total_usd > 0);

alter table public.cashea_ventas drop constraint if exists cashea_tasa_chk;
alter table public.cashea_ventas add constraint cashea_tasa_chk check (tasa > 0);

alter table public.cashea_ventas drop constraint if exists cashea_pct_chk;
alter table public.cashea_ventas add constraint cashea_pct_chk check (pct_pagado >= 0 and pct_pagado <= 100);

-- Con saldo por pagar hay que elegir 3, 6 o 12 cuotas. Si se paga todo (100%), no hacen falta.
alter table public.cashea_ventas drop constraint if exists cashea_cuotas_chk;
alter table public.cashea_ventas add constraint cashea_cuotas_chk
  check ((cuotas is not null and cuotas in (3, 6, 12)) or (cuotas is null and pct_pagado = 100));

-- 5) Columnas de cálculo (se llenan solas)
alter table public.cashea_ventas add column if not exists pagado_usd numeric(14,2)
  generated always as (round(monto_total_usd * pct_pagado / 100, 2)) stored;
alter table public.cashea_ventas add column if not exists pagado_bs numeric(14,2)
  generated always as (round(tasa * monto_total_usd * pct_pagado / 100, 2)) stored;
alter table public.cashea_ventas add column if not exists saldo_usd numeric(14,2)
  generated always as (round(monto_total_usd * (100 - pct_pagado) / 100, 2)) stored;
alter table public.cashea_ventas add column if not exists cuota_usd numeric(14,2)
  generated always as (case when cuotas is null then null
    else round(monto_total_usd * (100 - pct_pagado) / 100 / cuotas, 2) end) stored;
alter table public.cashea_ventas add column if not exists cuota_bs numeric(14,2)
  generated always as (case when cuotas is null then null
    else round(tasa * monto_total_usd * (100 - pct_pagado) / 100 / cuotas, 2) end) stored;

-- 6) Registro en la actividad del panel (quién hizo qué)
create or replace function public.tr_cashea_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.actividad (usuaria, texto)
    values (public.usuaria_actual(),
      'registró la venta Cashea ' || new.factura || ' por US$ ' || round(new.monto_total_usd, 2)::text
      || ' (' || trim_scale(new.pct_pagado)::text || '% hoy)');
  elsif new.estado is distinct from old.estado then
    insert into public.actividad (usuaria, texto)
    values (
      public.usuaria_actual(),
      case new.estado
        when 'cobrada'  then 'marcó cobrada la venta Cashea ' || new.factura
        when 'anulada'  then 'anuló la venta Cashea ' || new.factura
        else 'dejó pendiente la venta Cashea ' || new.factura
      end
    );
  end if;
  return null;
end $$;

-- =====================================================
-- Listo. Las ventas Cashea ahora se registran en dólares, con porcentaje y cuotas.
-- =====================================================
