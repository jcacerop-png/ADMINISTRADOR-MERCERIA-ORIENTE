-- =====================================================
-- MERCERÍA DE ORIENTE · Base de datos (proyecto NUEVO de Supabase)
-- Ejecutar TODO en SQL Editor → Run, una sola vez.
-- =====================================================

-- ---------- 1) Quién es quién (según el correo con que se inicia sesión) ----------
create or replace function public.usuaria_actual()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_nombre text;
begin
  v_nombre := case lower(coalesce(auth.jwt() ->> 'email', ''))
    when 'rodolfo019@merceria.com'       then 'Rodolfo'
    when 'administrador029@merceria.com' then 'Administrador'
    else null
  end;
  if v_nombre is null then
    raise exception 'Cuenta no autorizada';
  end if;
  return v_nombre;
end $$;

revoke execute on function public.usuaria_actual() from public, anon;
grant  execute on function public.usuaria_actual() to authenticated;

-- ---------- 2) Tablas ----------
create table if not exists public.productos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (char_length(nombre) between 1 and 120),
  tipo            text not null default 'otro' check (tipo in ('maquina','hilo','tela','bisuteria','otro')),
  descripcion     text not null default '' check (char_length(descripcion) <= 1000),
  precio          numeric(10,2) not null default 0 check (precio >= 0),
  costo           numeric(10,2) not null default 0 check (costo >= 0),   -- privado: nunca sale en la vista pública
  destacado       boolean not null default false,
  activo          boolean not null default true,
  fotos           jsonb not null default '[]'::jsonb,        -- ["https://...", ...] (la primera es la principal)
  caracteristicas jsonb not null default '[]'::jsonb,        -- [{"campo":"...","valor":"..."}]
  accesorios      jsonb not null default '[]'::jsonb,        -- ["...", ...]
  usos            jsonb not null default '[]'::jsonb,        -- ["...", ...]
  documentos      jsonb not null default '[]'::jsonb,        -- [{"nombre":"...","url":"https://..."}]
  variantes       jsonb not null default '[]'::jsonb,        -- [{"nombre":"Azul","stock":3}]
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create table if not exists public.tipos (
  codigo      text primary key check (codigo in ('maquina','hilo','tela','bisuteria','otro')),
  campos      jsonb not null default '[]'::jsonb,
  accesorios  jsonb not null default '[]'::jsonb,
  usos        jsonb not null default '[]'::jsonb
);

create table if not exists public.actividad (
  id        uuid primary key default gen_random_uuid(),
  usuaria   text not null,
  texto     text not null,
  creado_en timestamptz not null default now()
);

create table if not exists public.notas (
  id        uuid primary key default gen_random_uuid(),
  usuaria   text not null default public.usuaria_actual(),
  texto     text not null check (char_length(texto) between 1 and 300),
  hecha     boolean not null default false,
  creado_en timestamptz not null default now()
);

-- Una sola fila que cambia cada vez que el panel guarda algo: sirve para avisar al catálogo público
create table if not exists public.catalogo_meta (
  id             int primary key default 1 check (id = 1),
  actualizado_en timestamptz not null default now()
);
insert into public.catalogo_meta (id) values (1) on conflict (id) do nothing;

-- ---------- 3) Auditoría y aviso en vivo (automático, no se puede falsear desde la página) ----------
create or replace function public.tr_productos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.actividad (usuaria, texto)
  values (
    public.usuaria_actual(),
    case tg_op
      when 'INSERT' then 'agregó ' || new.nombre
      when 'DELETE' then 'eliminó ' || old.nombre
      else 'editó ' || new.nombre
    end
  );
  update public.catalogo_meta set actualizado_en = now() where id = 1;
  return coalesce(new, old);
end $$;

drop trigger if exists productos_cambios on public.productos;
create trigger productos_cambios
  after insert or update or delete on public.productos
  for each row execute function public.tr_productos();

-- ---------- 4) Seguridad (RLS) ----------
alter table public.productos     enable row level security;
alter table public.tipos         enable row level security;
alter table public.actividad     enable row level security;
alter table public.notas         enable row level security;
alter table public.catalogo_meta enable row level security;

-- Productos: solo las dos cuentas autorizadas (la función lanza error a cualquier otra)
create policy productos_leer   on public.productos for select to authenticated using (public.usuaria_actual() is not null);
create policy productos_crear  on public.productos for insert to authenticated with check (public.usuaria_actual() is not null);
create policy productos_editar on public.productos for update to authenticated using (public.usuaria_actual() is not null) with check (public.usuaria_actual() is not null);
create policy productos_borrar on public.productos for delete to authenticated using (public.usuaria_actual() is not null);

-- Plantillas
create policy tipos_leer    on public.tipos for select to authenticated using (public.usuaria_actual() is not null);
create policy tipos_guardar on public.tipos for insert to authenticated with check (public.usuaria_actual() is not null);
create policy tipos_editar  on public.tipos for update to authenticated using (public.usuaria_actual() is not null) with check (public.usuaria_actual() is not null);

-- Actividad: solo lectura (la escribe el trigger)
create policy actividad_leer on public.actividad for select to authenticated using (public.usuaria_actual() is not null);

-- Notas
create policy notas_leer   on public.notas for select to authenticated using (public.usuaria_actual() is not null);
create policy notas_crear  on public.notas for insert to authenticated with check (usuaria = public.usuaria_actual());
create policy notas_editar on public.notas for update to authenticated using (public.usuaria_actual() is not null) with check (public.usuaria_actual() is not null);
create policy notas_borrar on public.notas for delete to authenticated using (public.usuaria_actual() is not null);

-- Aviso en vivo: lo puede leer cualquiera (la clienta sin sesión), pero no escribirlo
create policy meta_leer_publico on public.catalogo_meta for select to anon, authenticated using (true);

-- ---------- 5) Vista pública: solo lo que ve la clienta ----------
-- Sin costo, sin cantidades exactas: las variantes salen como "disponible: sí / no".
create or replace view public.catalogo_publico as
select
  p.id, p.nombre, p.tipo, p.descripcion, p.precio, p.destacado,
  p.fotos, p.caracteristicas, p.accesorios, p.usos, p.documentos,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'nombre', x.v->>'nombre',
        'disponible', coalesce((x.v->>'stock')::int, 0) > 0
      ) order by x.n
    )
    from jsonb_array_elements(p.variantes) with ordinality as x(v, n)
  ), '[]'::jsonb) as variantes
from public.productos p
where p.activo;

grant select on public.catalogo_publico to anon, authenticated;

-- ---------- 6) Plantillas iniciales (se pueden editar desde el panel) ----------
insert into public.tipos (codigo, campos, accesorios, usos) values
  ('maquina',
   '["Tipo","Puntadas","Velocidad máxima","Motor","Ojal","Iluminación","Peso","Garantía"]',
   '["Pie prensatelas universal","Juego de bobinas","Descosedor","Cepillo de limpieza","Juego de agujas","Manual de instrucciones"]',
   '["Dobladillos y ruedos","Costuras rectas y zigzag","Botones y ojales","Remiendos y reparaciones"]'),
  ('hilo',
   '["Composición","Grosor","Metraje","Marca","Código de color"]',
   '[]',
   '["Costura general","Bordado","Overlock"]'),
  ('tela',
   '["Composición","Ancho","Peso","Se vende por","Uso recomendado"]',
   '[]',
   '["Ropa","Cortinas","Manualidades"]'),
  ('bisuteria',
   '["Material","Medida","Cierre","Color"]',
   '[]',
   '["Uso diario","Regalo","Ocasiones especiales"]'),
  ('otro',
   '[]',
   '[]',
   '[]')
on conflict (codigo) do nothing;

-- ---------- 7) Fotos (bucket público para que la clienta vea las imágenes) ----------
insert into storage.buckets (id, name, public) values ('catalogo', 'catalogo', true)
on conflict (id) do nothing;

create policy catalogo_subir  on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogo' and public.usuaria_actual() is not null);
create policy catalogo_editar on storage.objects for update to authenticated
  using (bucket_id = 'catalogo' and public.usuaria_actual() is not null);
create policy catalogo_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'catalogo' and public.usuaria_actual() is not null);

-- ---------- 8) Tiempo real ----------
alter publication supabase_realtime add table public.productos, public.actividad, public.notas, public.catalogo_meta;

-- =====================================================
-- PASOS EN EL PANEL DE SUPABASE (no van en este archivo):
-- 1) Authentication → Providers → Email: DESACTIVA "Allow new users to sign up".
-- 2) Authentication → Users → "Add user" → crea:
--      rodolfo019@merceria.com
--      administrador029@merceria.com
--    Marca "Auto Confirm User" y pon una contraseña a cada una.
-- 3) Settings → API: copia "Project URL" y "anon public" en config.js.
-- =====================================================
