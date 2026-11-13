-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 7: cuotas pagadas por venta Cashea
-- Ejecutar TODO en SQL Editor → Run, después de la v5 y la v6.
-- Es seguro correrlo más de una vez. No borra ventas.
--
-- - cuotas_pagadas: cuántas cuotas lleva pagadas la clienta (de 0 al número de cuotas).
-- - Se calcula solo:
--     pagado en cuotas (USD) = saldo × cuotas pagadas ÷ cuotas
--     debe (USD)             = saldo − pagado en cuotas
--     debe (Bs)              = tasa × debe (USD)
--   Al pagar todas las cuotas, el debe queda en 0 (sin centavos de sobra).
-- - La actividad registra cada cambio de cuotas con la cuenta que lo hizo.
-- - Corre v5, v6 y v7 juntas, en ese orden.
-- =====================================================

-- 1) Cuotas pagadas (0 por defecto)
alter table public.cashea_ventas add column if not exists cuotas_pagadas smallint not null default 0;

alter table public.cashea_ventas drop constraint if exists cashea_cuotas_pagadas_chk;
alter table public.cashea_ventas add constraint cashea_cuotas_pagadas_chk
  check (cuotas_pagadas >= 0 and cuotas_pagadas <= coalesce(cuotas, 0));

-- 2) Debe en dólares y en bolívares (se calculan solos)
alter table public.cashea_ventas add column if not exists pendiente_usd numeric(14,2)
  generated always as (
    round(
      round(monto_total_usd * (100 - pct_pagado) / 100, 2)
      - case when coalesce(cuotas, 0) = 0 then 0
          else round(round(monto_total_usd * (100 - pct_pagado) / 100, 2) * cuotas_pagadas / cuotas, 2)
        end
    , 2)
  ) stored;

alter table public.cashea_ventas add column if not exists pendiente_bs numeric(14,2)
  generated always as (
    round(tasa * round(
      round(monto_total_usd * (100 - pct_pagado) / 100, 2)
      - case when coalesce(cuotas, 0) = 0 then 0
          else round(round(monto_total_usd * (100 - pct_pagado) / 100, 2) * cuotas_pagadas / cuotas, 2)
        end
    , 2), 2)
  ) stored;

-- 3) Registro en la actividad del panel (incluye cambios de cuotas)
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
  elsif new.cuotas_pagadas is distinct from old.cuotas_pagadas then
    insert into public.actividad (usuaria, texto)
    values (public.usuaria_actual(),
      'actualizó las cuotas de la venta Cashea ' || new.factura || ': pagadas '
      || new.cuotas_pagadas::text || ' de ' || coalesce(new.cuotas, 0)::text
      || ' (debe US$ ' || new.pendiente_usd::text || ')');
  end if;
  return null;
end $$;

-- =====================================================
-- Listo. Cada venta Cashea lleva el registro de sus cuotas pagadas.
-- =====================================================
