-- =====================================================================
-- MERCERÍA ORIENTE · Actualización 17 (script consolidado)
-- Ejecutar TODO en Supabase → SQL Editor → Run, DESPUÉS de v9, facturas y biopago.
-- Es seguro correrlo varias veces. NO borra ventas ni fotos.
--
-- Qué corrige / agrega:
--   1) RLS de cashea_ventas (SELECT, INSERT, UPDATE; DELETE bloqueado a propósito)
--      y de Storage (buckets facturas, catalogo y personalizacion) con SELECT,
--      INSERT, UPDATE y DELETE. Esto elimina el error
--      "new row violates row-level security policy" al guardar ventas con foto.
--   2) Factura fiscal + Factura Cashea en cada venta (las ventas viejas conservan
--      su número en "factura" y se copia a "factura_fiscal": no se pierde historial).
--   3) Tabla configuracion_catalogo + bucket público "personalizacion" para la
--      imagen Hero Full-Bleed del pie de página del catálogo público.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) DIAGNÓSTICO (opcional, antes de correr): confirma que el historial
--    sigue en la base. El SQL Editor no aplica RLS, así que verás todo.
--    select tienda, estado, count(*) from public.cashea_ventas group by 1, 2 order by 1, 2;
-- ---------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------
-- 1) Quién es quién (solo las dos cuentas autorizadas del panel,
--    más permiso interno cuando corres scripts desde el SQL Editor de Supabase)
-- ---------------------------------------------------------------------
create or replace function public.usuaria_actual()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_email  text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_nombre text;
begin
  v_nombre := case v_email
    when 'rodolfo019@merceria.com'       then 'Rodolfo'
    when 'administrador029@merceria.com' then 'Administrador'
    else null
  end;
  -- Cuando ejecutas una consulta o migración directamente en el SQL Editor de Supabase,
  -- no hay token JWT web (v_email = '') y el usuario de base de datos es postgres / service_role.
  if v_nombre is null and v_email = '' and current_user in ('postgres', 'supabase_admin', 'service_role') then
    return 'Rodolfo';
  end if;
  if v_nombre is null then
    raise exception 'Cuenta no autorizada';
  end if;
  return v_nombre;
end $$;

revoke execute on function public.usuaria_actual() from public, anon;
grant  execute on function public.usuaria_actual() to authenticated;

-- ---------------------------------------------------------------------
-- 2) Factura fiscal y Factura Cashea (compatibles con el campo "factura")
-- ---------------------------------------------------------------------
alter table public.cashea_ventas add column if not exists factura_fiscal text;
alter table public.cashea_ventas add column if not exists factura_cashea text;

-- Historial: el número que ya existía pasa a ser la factura fiscal
update public.cashea_ventas
   set factura_fiscal = btrim(factura)
 where factura_fiscal is null and factura is not null;

alter table public.cashea_ventas drop constraint if exists cashea_factura_fiscal_chk;
alter table public.cashea_ventas add constraint cashea_factura_fiscal_chk
  check (factura_fiscal is null or char_length(btrim(factura_fiscal)) between 1 and 40);

alter table public.cashea_ventas drop constraint if exists cashea_factura_cashea_chk;
alter table public.cashea_ventas add constraint cashea_factura_cashea_chk
  check (factura_cashea is null or char_length(btrim(factura_cashea)) between 1 and 40);

-- Una misma factura Cashea no se puede registrar dos veces (las viejas sin dato no cuentan)
create unique index if not exists cashea_factura_cashea_uidx
  on public.cashea_ventas (lower(btrim(factura_cashea)))
  where factura_cashea is not null;

-- Trigger previo (se ejecuta ANTES de "cashea_cambios" por orden alfabético):
-- - Normaliza los dos números y mantiene "factura" = factura fiscal (compatibilidad).
-- - En ventas nuevas exige ambas facturas y fija quién la registró (evita el choque con RLS).
-- - En meses cerrados no deja cambiar una factura Cashea ya cargada (sí completarla si faltaba).
create or replace function public.tr_cashea_facturas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.factura_fiscal := nullif(btrim(coalesce(new.factura_fiscal, '')), '');
  new.factura_cashea := nullif(btrim(coalesce(new.factura_cashea, '')), '');

  if tg_op = 'INSERT' then
    new.registrado_por := public.usuaria_actual();
    if new.factura_fiscal is null and new.factura is not null then
      new.factura_fiscal := nullif(btrim(new.factura), '');
    end if;
    if new.factura_fiscal is null or new.factura_cashea is null then
      raise exception 'Faltan la factura fiscal o la factura Cashea de la venta';
    end if;
  else
    -- Un panel viejo que solo cambie "factura" sigue funcionando
    if new.factura is distinct from old.factura
       and new.factura_fiscal is not distinct from old.factura_fiscal then
      new.factura_fiscal := nullif(btrim(new.factura), '');
    end if;
    if old.factura_cashea is not null
       and new.factura_cashea is distinct from old.factura_cashea
       and exists (select 1 from public.cierres_mensuales c
                    where c.periodo = to_char(old.fecha, 'YYYY-MM')) then
      raise exception 'Ese mes ya está cerrado: no se puede cambiar la factura Cashea';
    end if;
  end if;

  if new.factura_fiscal is not null then
    new.factura := new.factura_fiscal;
  end if;
  return new;
end $$;

drop trigger if exists cashea_a_facturas on public.cashea_ventas;
create trigger cashea_a_facturas
  before insert or update on public.cashea_ventas
  for each row execute function public.tr_cashea_facturas();

-- ---------------------------------------------------------------------
-- 3) RLS de cashea_ventas (historial visible y ventas nuevas sin error)
-- ---------------------------------------------------------------------
alter table public.cashea_ventas enable row level security;
revoke all on public.cashea_ventas from anon;
grant select, insert, update on public.cashea_ventas to authenticated;

drop policy if exists cashea_leer   on public.cashea_ventas;
drop policy if exists cashea_crear  on public.cashea_ventas;
drop policy if exists cashea_editar on public.cashea_ventas;
drop policy if exists cashea_borrar on public.cashea_ventas;

create policy cashea_leer on public.cashea_ventas
  for select to authenticated
  using (public.usuaria_actual() is not null);

-- registrado_por lo fija el trigger con la cuenta que inició sesión
create policy cashea_crear on public.cashea_ventas
  for insert to authenticated
  with check (public.usuaria_actual() is not null and registrado_por = public.usuaria_actual());

create policy cashea_editar on public.cashea_ventas
  for update to authenticated
  using (public.usuaria_actual() is not null)
  with check (public.usuaria_actual() is not null);

-- DELETE: bloqueado a propósito (sin GRANT ni política). Las ventas se ANULAN, no se borran,
-- para proteger el historial y los cierres de mes. Si algún día el dueño necesita borrar,
-- descomenta estas dos líneas (solo Rodolfo podrá hacerlo):
--   grant delete on public.cashea_ventas to authenticated;
--   create policy cashea_borrar on public.cashea_ventas for delete to authenticated using (public.usuaria_actual() = 'Rodolfo');

-- Cierres de mes: lectura para el panel (por si la política se perdió)
alter table public.cierres_mensuales enable row level security;
grant select on public.cierres_mensuales to authenticated;
drop policy if exists cierres_leer on public.cierres_mensuales;
create policy cierres_leer on public.cierres_mensuales
  for select to authenticated
  using (public.usuaria_actual() is not null);

-- ---------------------------------------------------------------------
-- 4) Buckets de Storage
-- ---------------------------------------------------------------------
-- facturas: PRIVADO (el panel usa enlaces temporales)
insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do nothing;
update storage.buckets set public = false where id = 'facturas';

-- catalogo: PÚBLICO (fotos de productos y carrusel)
insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do nothing;
update storage.buckets set public = true where id = 'catalogo';

-- personalizacion: PÚBLICO (imagen Hero del pie de página del catálogo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personalizacion', 'personalizacion', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
update storage.buckets
   set public = true,
       file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'personalizacion';

-- ---------------------------------------------------------------------
-- 5) Políticas de storage.objects (SELECT, INSERT, UPDATE, DELETE)
--    Subir con "upsert" exige SELECT + INSERT + UPDATE: por eso fallaba.
-- ---------------------------------------------------------------------
-- facturas (solo el panel)
drop policy if exists "facturas: ver"     on storage.objects;
drop policy if exists "facturas: subir"   on storage.objects;
drop policy if exists "facturas: editar"  on storage.objects;
drop policy if exists "facturas: borrar"  on storage.objects;

create policy "facturas: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'facturas' and public.usuaria_actual() is not null);
create policy "facturas: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas' and public.usuaria_actual() is not null);
create policy "facturas: editar" on storage.objects
  for update to authenticated
  using (bucket_id = 'facturas' and public.usuaria_actual() is not null)
  with check (bucket_id = 'facturas' and public.usuaria_actual() is not null);
create policy "facturas: borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'facturas' and public.usuaria_actual() is not null);

-- catalogo (lectura pública, escritura solo del panel)
drop policy if exists catalogo_ver    on storage.objects;
drop policy if exists catalogo_subir  on storage.objects;
drop policy if exists catalogo_editar on storage.objects;
drop policy if exists catalogo_borrar on storage.objects;

create policy catalogo_ver on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'catalogo');
create policy catalogo_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'catalogo' and public.usuaria_actual() is not null);
create policy catalogo_editar on storage.objects
  for update to authenticated
  using (bucket_id = 'catalogo' and public.usuaria_actual() is not null)
  with check (bucket_id = 'catalogo' and public.usuaria_actual() is not null);
create policy catalogo_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalogo' and public.usuaria_actual() is not null);

-- personalizacion (lectura pública, escritura solo del panel)
drop policy if exists personalizacion_ver    on storage.objects;
drop policy if exists personalizacion_subir  on storage.objects;
drop policy if exists personalizacion_editar on storage.objects;
drop policy if exists personalizacion_borrar on storage.objects;

create policy personalizacion_ver on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'personalizacion');
create policy personalizacion_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'personalizacion' and public.usuaria_actual() is not null);
create policy personalizacion_editar on storage.objects
  for update to authenticated
  using (bucket_id = 'personalizacion' and public.usuaria_actual() is not null)
  with check (bucket_id = 'personalizacion' and public.usuaria_actual() is not null);
create policy personalizacion_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'personalizacion' and public.usuaria_actual() is not null);

-- ---------------------------------------------------------------------
-- 6) Configuración del catálogo (clave → valor). Primera clave: hero_pie_url
-- ---------------------------------------------------------------------
create table if not exists public.configuracion_catalogo (
  clave           text primary key check (clave ~ '^[a-z0-9_]{2,60}$'),
  valor           text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);

alter table public.configuracion_catalogo drop constraint if exists config_hero_url_chk;
alter table public.configuracion_catalogo add constraint config_hero_url_chk
  check (clave <> 'hero_pie_url' or valor is null or valor ~ '^https://');

alter table public.configuracion_catalogo enable row level security;
revoke all on public.configuracion_catalogo from anon, authenticated;
grant select on public.configuracion_catalogo to anon, authenticated;
grant insert, update, delete on public.configuracion_catalogo to authenticated;

drop policy if exists config_leer_publico on public.configuracion_catalogo;
drop policy if exists config_crear        on public.configuracion_catalogo;
drop policy if exists config_editar       on public.configuracion_catalogo;
drop policy if exists config_borrar       on public.configuracion_catalogo;

create policy config_leer_publico on public.configuracion_catalogo
  for select to anon, authenticated
  using (true);
create policy config_crear on public.configuracion_catalogo
  for insert to authenticated
  with check (public.usuaria_actual() is not null);
create policy config_editar on public.configuracion_catalogo
  for update to authenticated
  using (public.usuaria_actual() is not null)
  with check (public.usuaria_actual() is not null);
create policy config_borrar on public.configuracion_catalogo
  for delete to authenticated
  using (public.usuaria_actual() is not null);

-- Quién y cuándo (no se puede falsear desde la página)
create or replace function public.tr_config_catalogo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := public.usuaria_actual();
  return new;
end $$;

drop trigger if exists config_catalogo_quien on public.configuracion_catalogo;
create trigger config_catalogo_quien
  before insert or update on public.configuracion_catalogo
  for each row execute function public.tr_config_catalogo();

-- Aviso en vivo al catálogo público + registro en la actividad del panel
create or replace function public.tr_config_catalogo_aviso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.catalogo_meta set actualizado_en = now() where id = 1;
  insert into public.actividad (usuaria, texto)
  values (public.usuaria_actual(), 'actualizó la personalización del catálogo (' || coalesce(new.clave, old.clave) || ')');
  return null;
end $$;

drop trigger if exists config_catalogo_aviso on public.configuracion_catalogo;
create trigger config_catalogo_aviso
  after insert or update or delete on public.configuracion_catalogo
  for each row execute function public.tr_config_catalogo_aviso();

-- Fila inicial (sin imagen: el catálogo muestra su fondo elegante de respaldo)
insert into public.configuracion_catalogo (clave, valor, actualizado_por)
select 'hero_pie_url', null, 'Sistema'
where not exists (select 1 from public.configuracion_catalogo where clave = 'hero_pie_url');

commit;

-- ---------------------------------------------------------------------
-- 7) Tiempo real para la tabla nueva (si ya estaba, no pasa nada)
-- ---------------------------------------------------------------------
do $rt$
begin
  alter publication supabase_realtime add table public.configuracion_catalogo;
exception when others then
  raise notice 'configuracion_catalogo ya estaba en tiempo real (o no aplica): %', sqlerrm;
end $rt$;

-- ---------------------------------------------------------------------
-- 8) VERIFICACIÓN: debe mostrar tus ventas (el historial nunca se borró)
-- ---------------------------------------------------------------------
select tienda,
       count(*)                                   as ventas,
       count(*) filter (where factura_cashea is null) as sin_factura_cashea
  from public.cashea_ventas
 group by tienda
 order by tienda;
