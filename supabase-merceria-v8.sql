-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 8: Cashea Express (liquidación y comprobación)
-- Ejecutar TODO en SQL Editor → Run, después de la v5, la v6 y la v7.
-- Es seguro correrlo más de una vez. No borra ventas.
--
-- Modelo:
-- - Inicial 40%: la clienta la paga en caja, en bolívares a la tasa BCV de la venta.
-- - Financiado: el resto (60%). Cashea lo debe al comercio.
-- - Descuentos de Cashea sobre el monto total de la venta:
--     comisión por servicio tecnológico 4%  (pct_comision)
--     adelanto de fondos semanal        4%  (pct_adelanto)
--     total descontado                  8%
-- - Liquidación esperada (USD) = financiado − descuentos.
-- - Al llegar el pago de Cashea se registra lo que llegó en bolívares, la tasa BCV de ese día
--   y la fecha. La app compara lo esperado con lo recibido y separa la diferencia en:
--     variación por tasa BCV y descuento de más o de menos de Cashea.
-- - Cada venta guarda sus porcentajes y tasas: si algún día cambian, las ventas viejas no se mueven.
-- - Se quitan las cuotas y el porcentaje variable de la v6 y la v7.
-- =====================================================

-- 1) Quitar lo del modelo anterior (cuotas y porcentaje variable)
alter table public.cashea_ventas drop constraint if exists cashea_cuotas_pagadas_chk;
alter table public.cashea_ventas drop constraint if exists cashea_cuotas_chk;
alter table public.cashea_ventas drop constraint if exists cashea_pct_chk;

alter table public.cashea_ventas drop column if exists pagado_usd;
alter table public.cashea_ventas drop column if exists pagado_bs;
alter table public.cashea_ventas drop column if exists saldo_usd;
alter table public.cashea_ventas drop column if exists cuota_usd;
alter table public.cashea_ventas drop column if exists cuota_bs;
alter table public.cashea_ventas drop column if exists pendiente_usd;
alter table public.cashea_ventas drop column if exists pendiente_bs;
alter table public.cashea_ventas drop column if exists cuotas_pagadas;
alter table public.cashea_ventas drop column if exists cuotas;
alter table public.cashea_ventas drop column if exists pct_pagado;

-- 2) Porcentajes de cada venta (quedan guardados con la venta)
alter table public.cashea_ventas add column if not exists pct_inicial  numeric(5,2) not null default 40;
alter table public.cashea_ventas add column if not exists pct_comision numeric(5,2) not null default 4;
alter table public.cashea_ventas add column if not exists pct_adelanto numeric(5,2) not null default 4;

alter table public.cashea_ventas drop constraint if exists cashea_pct_chk;
alter table public.cashea_ventas add constraint cashea_pct_chk check (
  pct_inicial >= 0 and pct_inicial <= 100
  and pct_comision >= 0 and pct_comision <= 100
  and pct_adelanto >= 0 and pct_adelanto <= 100
  and pct_comision + pct_adelanto < 100
);

-- 3) Datos de la liquidación que te paga Cashea (se llenan al comprobar)
alter table public.cashea_ventas add column if not exists liq_fecha date;
alter table public.cashea_ventas add column if not exists liq_tasa numeric(14,4);
alter table public.cashea_ventas add column if not exists liq_recibido_bs numeric(14,2);
alter table public.cashea_ventas add column if not exists liq_nota text;
alter table public.cashea_ventas add column if not exists liq_comprobado_por text;
alter table public.cashea_ventas add column if not exists liq_comprobado_en timestamptz;

alter table public.cashea_ventas drop constraint if exists cashea_liq_chk;
alter table public.cashea_ventas add constraint cashea_liq_chk check (
  (liq_fecha is null and liq_tasa is null and liq_recibido_bs is null)
  or (liq_fecha is not null and liq_fecha >= fecha
      and liq_tasa > 0 and liq_recibido_bs >= 0)
);

alter table public.cashea_ventas drop constraint if exists cashea_liq_nota_chk;
alter table public.cashea_ventas add constraint cashea_liq_nota_chk check (liq_nota is null or char_length(liq_nota) <= 200);

-- 4) Cálculos del modelo (se llenan solos)
--    inicial_usd          = total × inicial %
--    inicial_bs           = tasa de venta × inicial_usd
--    financiado_usd       = total − inicial_usd
--    descuento_usd        = total × comisión % + total × adelanto %
--    liquidacion_usd      = financiado_usd − descuento_usd   (lo que Cashea debe pagar)
--    liquidacion_bs_venta = tasa de venta × liquidacion_usd  (lo esperado en bolívares al BCV de la venta)
alter table public.cashea_ventas add column if not exists inicial_usd numeric(14,2)
  generated always as (round(monto_total_usd * pct_inicial / 100, 2)) stored;

alter table public.cashea_ventas add column if not exists inicial_bs numeric(14,2)
  generated always as (round(tasa * round(monto_total_usd * pct_inicial / 100, 2), 2)) stored;

alter table public.cashea_ventas add column if not exists financiado_usd numeric(14,2)
  generated always as (round(monto_total_usd - round(monto_total_usd * pct_inicial / 100, 2), 2)) stored;

alter table public.cashea_ventas add column if not exists descuento_usd numeric(14,2)
  generated always as (round(round(monto_total_usd * pct_comision / 100, 2) + round(monto_total_usd * pct_adelanto / 100, 2), 2)) stored;

alter table public.cashea_ventas add column if not exists liquidacion_usd numeric(14,2)
  generated always as (round(
      round(monto_total_usd - round(monto_total_usd * pct_inicial / 100, 2), 2)
      - round(round(monto_total_usd * pct_comision / 100, 2) + round(monto_total_usd * pct_adelanto / 100, 2), 2)
    , 2)) stored;

alter table public.cashea_ventas add column if not exists liquidacion_bs_venta numeric(14,2)
  generated always as (round(tasa * round(
      round(monto_total_usd - round(monto_total_usd * pct_inicial / 100, 2), 2)
      - round(round(monto_total_usd * pct_comision / 100, 2) + round(monto_total_usd * pct_adelanto / 100, 2), 2)
    , 2), 2)) stored;

-- 5) Quién hizo la comprobación (la base de datos lo anota sola, con la cuenta que entró)
create or replace function public.tr_cashea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.actualizado_en := now();
    new.actualizado_por := public.usuaria_actual();
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

-- 6) Registro en la actividad del panel
create or replace function public.tr_cashea_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.actividad (usuaria, texto)
    values (public.usuaria_actual(),
      'registró la venta Cashea ' || new.factura || ' por US$ ' || round(new.monto_total_usd, 2)::text
      || ' (inicial en caja Bs ' || new.inicial_bs::text || ')');
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
  elsif new.liq_recibido_bs is distinct from old.liq_recibido_bs
     or new.liq_tasa is distinct from old.liq_tasa
     or new.liq_fecha is distinct from old.liq_fecha then
    insert into public.actividad (usuaria, texto)
    values (public.usuaria_actual(),
      'comprobó la liquidación Cashea ' || new.factura || ': recibió Bs '
      || coalesce(round(new.liq_recibido_bs, 2)::text, '—') || ' a tasa ' || coalesce(trim_scale(new.liq_tasa)::text, '—'));
  end if;
  return null;
end $$;

-- =====================================================
-- Listo. Las ventas Cashea usan el modelo de inicial 40% y descuentos 4% + 4%,
-- y se comprueban contra la liquidación que llega de Cashea.
-- =====================================================
