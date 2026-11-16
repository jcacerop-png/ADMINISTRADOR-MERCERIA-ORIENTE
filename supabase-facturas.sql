-- =========================================================
-- Facturas: foto de la factura en cada venta de Cashea.
-- Correr en Supabase (SQL Editor) DESPUÉS de supabase-merceria-v9.sql.
-- Es seguro correrlo más de una vez. No borra datos.
-- =========================================================
begin;

-- 1) Ruta de la foto dentro del bucket "facturas" (texto, puede estar vacía en ventas viejas)
alter table public.cashea_ventas add column if not exists factura_foto text;

-- 2) Bucket PRIVADO: las fotos no tienen enlace público; el panel pide un enlace temporal
insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do update set public = false;

-- 3) Solo las cuentas autorizadas del panel pueden subir y ver las facturas
drop policy if exists "facturas: subir" on storage.objects;
create policy "facturas: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas' and public.usuaria_actual() is not null);

drop policy if exists "facturas: ver" on storage.objects;
create policy "facturas: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'facturas' and public.usuaria_actual() is not null);

commit;
