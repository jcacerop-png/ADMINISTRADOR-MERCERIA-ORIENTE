-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 5: Ventas Cashea
-- Ejecutar TODO en SQL Editor → Run, después de la v4.
-- Es seguro correrlo más de una vez. No borra datos.
--
-- - Tabla cashea_ventas: factura, nombre, apellido, día, monto en bolívares,
--   tasa BCV del día y monto en dólares (se calcula solo).
-- - Solo el panel de administración la ve (no es pública).
-- - Las ventas no se borran: se anulan, para conservar el registro.
-- - Cada venta guarda quién la registró y quién la cambió por última vez.
-- =====================================================

create table if not exists public.cashea_ventas (
  id              uuid primary key default gen_random_uuid(),
  factura         text not null unique check (char_length(btrim(factura)) between 1 and 40),
  nombre          text not null check (char_length(btrim(nombre)) between 1 and 60),
  apellido        text not null check (char_length(btrim(apellido)) between 1 and 60),
  fecha           date not null,
  monto_bs        numeric(14,2) not null check (monto_bs > 0),
  tasa            numeric(14,4) not null check (tasa > 0),
  monto_usd       numeric(14,2) generated always as (round(monto_bs / tasa, 2)) stored,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'cobrada', 'anulada')),
  cobrada_en      timestamptz,
  anulada_en      timestamptz,
  registrado_por  text not null default public.usuaria_actual(),
  actualizado_por text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index if not exists cashea_fecha_idx on public.cashea_ventas (fecha desc);

-- Fechas de cobro/anulación y auditoría de cambios
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
  return new;
end $$;

drop trigger if exists cashea_cambios on public.cashea_ventas;
create trigger cashea_cambios
  before insert or update on public.cashea_ventas
  for each row execute function public.tr_cashea();

-- Registro en la actividad del panel (quién hizo qué)
create or replace function public.tr_cashea_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.actividad (usuaria, texto)
    values (public.usuaria_actual(), 'registró la venta Cashea ' || new.factura || ' por Bs ' || new.monto_bs);
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

drop trigger if exists cashea_actividad on public.cashea_ventas;
create trigger cashea_actividad
  after insert or update on public.cashea_ventas
  for each row execute function public.tr_cashea_actividad();

-- Seguridad: solo cuentas del panel, sin borrado
alter table public.cashea_ventas enable row level security;
revoke all on public.cashea_ventas from anon;
grant select, insert, update on public.cashea_ventas to authenticated;

drop policy if exists cashea_leer   on public.cashea_ventas;
drop policy if exists cashea_crear  on public.cashea_ventas;
drop policy if exists cashea_editar on public.cashea_ventas;

create policy cashea_leer on public.cashea_ventas
  for select to authenticated
  using (public.usuaria_actual() is not null);

create policy cashea_crear on public.cashea_ventas
  for insert to authenticated
  with check (registrado_por = public.usuaria_actual());

create policy cashea_editar on public.cashea_ventas
  for update to authenticated
  using (public.usuaria_actual() is not null)
  with check (public.usuaria_actual() is not null);

-- =====================================================
-- Listo. Las ventas Cashea solo las ve el panel de administración.
-- =====================================================
