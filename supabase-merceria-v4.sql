-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 4
-- Ejecutar TODO en SQL Editor → Run. Se puede correr más de una vez.
-- Reemplaza a la actualización 3 (ya incluye todo lo de ella).
-- 1) Vista pública del catálogo (fecha de publicación para la etiqueta "Nuevo").
-- 2) Categorías en la base de datos: nombre, orden y visibilidad.
-- 3) Productos: código único y precio al por mayor (solo en el panel).
-- No borra ni cambia datos.
-- =====================================================

-- ---------- 1) Vista pública del catálogo ----------
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
  ), '[]'::jsonb) as variantes,
  p.creado_en
from public.productos p
where p.activo;

grant select on public.catalogo_publico to anon, authenticated;

-- ---------- 2) Categorías ----------
alter table public.tipos add column if not exists nombre text;
alter table public.tipos add column if not exists orden integer not null default 0;
alter table public.tipos add column if not exists visible boolean not null default true;

-- Quita las restricciones antiguas de tipo (productos) y codigo (tipos), sea cual sea su nombre
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tabla, conname
    from pg_constraint
    where contype = 'c'
      and ((conrelid = 'public.productos'::regclass and pg_get_constraintdef(oid) ilike '%tipo%')
        or (conrelid = 'public.tipos'::regclass and pg_get_constraintdef(oid) ilike '%codigo%'))
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
  end loop;
end $$;

-- Categorías base. Si ya existen, conserva el nombre y el orden que les hayas puesto.
insert into public.tipos (codigo, nombre, orden) values
  ('maquina', 'Máquinas de coser', 1),
  ('hilo', 'Hilos', 2),
  ('tela', 'Telas', 3),
  ('bisuteria', 'Bisutería', 4),
  ('acce_met', 'Accesorios metálicos', 5),
  ('acce_plast', 'Accesorios plásticos', 6),
  ('cierre', 'Cierres', 7),
  ('cordon', 'Cordones', 8),
  ('tijera', 'Tijeras', 9),
  ('crochet_neg', 'Crochet negro', 10),
  ('crochet_blanc', 'Crochet blanco', 11),
  ('macuto_neg', 'Macutos negros', 12),
  ('macuto_blanc', 'Macutos blancos', 13),
  ('repuesto', 'Repuestos', 14),
  ('otro', 'Otros', 15)
on conflict (codigo) do update set
  nombre = coalesce(public.tipos.nombre, excluded.nombre),
  orden  = case when public.tipos.orden = 0 then excluded.orden else public.tipos.orden end;

-- Si algún producto usa una categoría que no existe en la tabla, se crea para no perderlo
insert into public.tipos (codigo, nombre, orden)
select distinct p.tipo, p.tipo, 99
from public.productos p
where p.tipo is not null
  and not exists (select 1 from public.tipos t where t.codigo = p.tipo)
on conflict (codigo) do nothing;

-- Cada producto debe usar una categoría de la tabla
alter table public.productos drop constraint if exists productos_tipo_fkey;
alter table public.productos add constraint productos_tipo_fkey
  foreign key (tipo) references public.tipos (codigo);

-- Vista pública de categorías: solo las visibles
create or replace view public.categorias_publicas as
  select codigo, nombre, orden from public.tipos where visible order by orden, nombre;

grant select on public.categorias_publicas to anon, authenticated;

-- Permiso para borrar categorías (solo el panel)
drop policy if exists tipos_borrar on public.tipos;
create policy tipos_borrar on public.tipos for delete to authenticated
  using (public.usuaria_actual() is not null);

-- Cualquier cambio de categorías avisa al catálogo público en vivo
create or replace function public.tr_tipos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.catalogo_meta set actualizado_en = now() where id = 1;
  return null;
end $$;

drop trigger if exists tipos_cambios on public.tipos;
create trigger tipos_cambios
  after insert or update or delete on public.tipos
  for each row execute function public.tr_tipos();

-- El panel se entera de los cambios de categorías en vivo
do $$
begin
  alter publication supabase_realtime add table public.tipos;
exception when duplicate_object then null;
end $$;

-- ---------- 3) Productos: código y precio al por mayor ----------
alter table public.productos add column if not exists codigo text;
alter table public.productos add column if not exists precio_mayor numeric(12,2);
create unique index if not exists productos_codigo_key
  on public.productos (codigo) where codigo is not null;

-- =====================================================
-- Listo. Costo, ganancia y precio al por mayor siguen privados:
-- la vista pública nunca los incluye.
-- =====================================================
