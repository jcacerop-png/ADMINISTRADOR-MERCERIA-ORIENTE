-- =====================================================================
-- MERCERÍA ORIENTE · Actualización 18: Arquitectura de Productos Base + Variantes
-- (Medidas y Colores con precio individual y estado Disponible / Agotado)
--
-- Ejecutar TODO en Supabase → SQL Editor → Run.
-- Es idempotente (seguro correrlo varias veces). NO borra productos existentes.
--
-- Qué hace este script:
--   1) Estructura la columna JSONB "variantes" en public.productos para que cada
--      variante almacene:
--        - nombre: etiqueta de medida o color (ej. "1,5 cm", "2,0 cm", "Rojo")
--        - precio: precio individual en USD (ej. 0.07, 0.08, 0.10)
--        - disponible: booleano (true = Disponible, false = Agotado)
--        - stock: entero de existencias (sincronizado con disponible)
--        - codigo: código o SKU opcional de la variante
--        - orden: posición ordenada (de menor a mayor medida o lista de colores)
--   2) Crea la tabla relacional public.producto_variantes vinculada a public.productos
--      con sincronización automática mediante trigger (sin romper ninguna consulta actual
--      del panel ni del catálogo).
--   3) Actualiza la vista pública public.catalogo_publico para publicar el precio
--      individual, disponibilidad y orden de cada variante en tiempo real.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Función auxiliar para extraer el valor numérico de una medida
--    Permite ordenar variantes de menor a mayor (ej. "1,5 cm" < "2,0 cm" < "10 cm")
-- ---------------------------------------------------------------------
create or replace function public.valor_medida_variante(p_etiqueta text)
returns numeric language plpgsql immutable as $$
declare
  v_txt text := lower(btrim(coalesce(p_etiqueta, '')));
  v_m   text[];
  v_num numeric;
begin
  -- Extrae el primer número (entero o decimal con coma o punto)
  v_m := regexp_match(v_txt, '([0-9]+(?:[.,][0-9]+)?)');
  if v_m is null or v_m[1] is null then
    return 999999;
  end if;
  v_num := replace(v_m[1], ',', '.')::numeric;
  -- Normaliza milímetros a centímetros si la etiqueta especifica mm para ordenar con coherencia
  if v_txt ~ '\m(mm|milimetros|milímetros)\M' or v_txt ~ '[0-9]\s*mm' then
    return v_num / 10.0;
  end if;
  return v_num;
exception when others then
  return 999999;
end $$;

-- ---------------------------------------------------------------------
-- 2) Normalizar la columna JSONB "variantes" en todos los productos existentes
--    Sin borrar ningún producto: añade "precio" y "disponible" a cada variante actual.
-- ---------------------------------------------------------------------
update public.productos p
set variantes = coalesce((
  select jsonb_agg(
    jsonb_build_object(
      'nombre', coalesce(nullif(btrim(x.v->>'nombre'), ''), 'Única'),
      'precio', coalesce(
        nullif(replace(btrim(coalesce(x.v->>'precio', '')), ',', '.'), '')::numeric(12,2),
        p.precio,
        0
      ),
      'disponible', case
        when x.v ? 'disponible' then coalesce((x.v->>'disponible')::boolean, false)
        else coalesce((x.v->>'stock')::int, 0) > 0
      end,
      'stock', case
        when x.v ? 'stock' then greatest(0, coalesce((x.v->>'stock')::int, 0))
        when coalesce((x.v->>'disponible')::boolean, true) then 1
        else 0
      end,
      'codigo', nullif(btrim(coalesce(x.v->>'codigo', '')), ''),
      'orden', coalesce(nullif(x.v->>'orden', '')::int, x.n::int)
    )
    order by coalesce(nullif(x.v->>'orden', '')::int, x.n::int)
  )
  from jsonb_array_elements(
    case
      when jsonb_typeof(p.variantes) = 'array' and jsonb_array_length(p.variantes) > 0
        then p.variantes
      else jsonb_build_array(jsonb_build_object('nombre', 'Única', 'stock', 1, 'precio', p.precio, 'disponible', true))
    end
  ) with ordinality as x(v, n)
), '[]'::jsonb);

-- ---------------------------------------------------------------------
-- 3) Tabla relacional public.producto_variantes vinculada a public.productos
--    Se mantiene sincronizada automáticamente con la columna JSONB p.variantes.
-- ---------------------------------------------------------------------
create table if not exists public.producto_variantes (
  id             uuid primary key default gen_random_uuid(),
  producto_id    uuid not null references public.productos(id) on delete cascade,
  nombre         text not null check (char_length(btrim(nombre)) between 1 and 80),
  precio         numeric(12,2) not null default 0 check (precio >= 0),
  disponible     boolean not null default true,
  stock          integer not null default 1 check (stock >= 0),
  codigo         text,
  orden          integer not null default 1,
  actualizado_en timestamptz not null default now()
);

create index if not exists producto_variantes_prod_idx
  on public.producto_variantes (producto_id, orden);

alter table public.producto_variantes enable row level security;
revoke all on public.producto_variantes from anon, authenticated;
grant select on public.producto_variantes to anon, authenticated;
grant insert, update, delete on public.producto_variantes to authenticated;

drop policy if exists prod_var_leer_publico on public.producto_variantes;
drop policy if exists prod_var_escribir     on public.producto_variantes;

create policy prod_var_leer_publico on public.producto_variantes
  for select to anon, authenticated
  using (exists (
    select 1 from public.productos p
    where p.id = producto_variantes.producto_id and p.activo
  ) or (auth.role() = 'authenticated' and public.usuaria_actual() is not null));

create policy prod_var_escribir on public.producto_variantes
  for all to authenticated
  using (public.usuaria_actual() is not null)
  with check (public.usuaria_actual() is not null);

-- Trigger que normaliza p.variantes al insertar/actualizar un producto
-- y sincroniza automáticamente la tabla public.producto_variantes
create or replace function public.tr_normalizar_variantes_producto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_arr jsonb;
  v_min_precio numeric(12,2);
begin
  if jsonb_typeof(new.variantes) <> 'array' or jsonb_array_length(new.variantes) = 0 then
    new.variantes := jsonb_build_array(
      jsonb_build_object(
        'nombre', 'Única',
        'precio', coalesce(new.precio, 0),
        'disponible', true,
        'stock', 1,
        'orden', 1
      )
    );
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'nombre', coalesce(nullif(btrim(x.v->>'nombre'), ''), 'Opción ' || x.n),
        'precio', coalesce(
          nullif(replace(btrim(coalesce(x.v->>'precio', '')), ',', '.'), '')::numeric(12,2),
          new.precio,
          0
        ),
        'disponible', case
          when x.v ? 'disponible' then coalesce((x.v->>'disponible')::boolean, false)
          else coalesce((x.v->>'stock')::int, 0) > 0
        end,
        'stock', case
          when x.v ? 'disponible' and not coalesce((x.v->>'disponible')::boolean, false) then 0
          when x.v ? 'stock' and coalesce((x.v->>'stock')::int, 0) > 0 then (x.v->>'stock')::int
          when coalesce((x.v->>'disponible')::boolean, true) then greatest(1, coalesce((x.v->>'stock')::int, 1))
          else 0
        end,
        'codigo', nullif(btrim(coalesce(x.v->>'codigo', '')), ''),
        'orden', coalesce(nullif(x.v->>'orden', '')::int, x.n::int)
      )
      order by coalesce(nullif(x.v->>'orden', '')::int, x.n::int), x.n
    ), '[]'::jsonb)
    into v_arr
    from jsonb_array_elements(new.variantes) with ordinality as x(v, n);

    new.variantes := v_arr;
  end if;

  -- Si el precio base del producto es 0 o nulo, toma el precio de la primera variante disponible (o la primera variante)
  select min(coalesce((v->>'precio')::numeric(12,2), new.precio, 0))
    into v_min_precio
    from jsonb_array_elements(new.variantes) as v
   where coalesce((v->>'disponible')::boolean, true);

  if (new.precio is null or new.precio <= 0) and v_min_precio is not null and v_min_precio > 0 then
    new.precio := v_min_precio;
  end if;

  return new;
end $$;

drop trigger if exists productos_a_normalizar_variantes on public.productos;
create trigger productos_a_normalizar_variantes
  before insert or update of variantes, precio on public.productos
  for each row execute function public.tr_normalizar_variantes_producto();

create or replace function public.tr_sincronizar_tabla_variantes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.producto_variantes where producto_id = new.id;

  insert into public.producto_variantes (producto_id, nombre, precio, disponible, stock, codigo, orden, actualizado_en)
  select
    new.id,
    coalesce(nullif(btrim(x.v->>'nombre'), ''), 'Única'),
    coalesce(nullif(x.v->>'precio', '')::numeric(12,2), new.precio, 0),
    coalesce((x.v->>'disponible')::boolean, coalesce((x.v->>'stock')::int, 0) > 0),
    greatest(0, coalesce((x.v->>'stock')::int, case when coalesce((x.v->>'disponible')::boolean, true) then 1 else 0 end)),
    nullif(btrim(coalesce(x.v->>'codigo', '')), ''),
    coalesce(nullif(x.v->>'orden', '')::int, x.n::int),
    now()
  from jsonb_array_elements(new.variantes) with ordinality as x(v, n);

  return null;
end $$;

drop trigger if exists productos_b_sync_tabla_variantes on public.productos;
create trigger productos_b_sync_tabla_variantes
  after insert or update of variantes, precio on public.productos
  for each row execute function public.tr_sincronizar_tabla_variantes();

-- Poblar public.producto_variantes con los productos actuales
delete from public.producto_variantes;
insert into public.producto_variantes (producto_id, nombre, precio, disponible, stock, codigo, orden)
select
  p.id,
  coalesce(nullif(btrim(x.v->>'nombre'), ''), 'Única'),
  coalesce(nullif(x.v->>'precio', '')::numeric(12,2), p.precio, 0),
  coalesce((x.v->>'disponible')::boolean, coalesce((x.v->>'stock')::int, 0) > 0),
  greatest(0, coalesce((x.v->>'stock')::int, 0)),
  nullif(btrim(coalesce(x.v->>'codigo', '')), ''),
  coalesce(nullif(x.v->>'orden', '')::int, x.n::int)
from public.productos p,
     jsonb_array_elements(p.variantes) with ordinality as x(v, n);

-- ---------------------------------------------------------------------
-- 4) Actualizar la vista pública public.catalogo_publico
--    Mantiene las columnas exactas existentes y enriquece "variantes" con
--    su precio individual, estado disponible/agotado, código y orden.
-- ---------------------------------------------------------------------
create or replace view public.catalogo_publico as
select
  p.id,
  p.nombre,
  p.tipo,
  p.descripcion,
  p.precio,
  p.destacado,
  p.fotos,
  p.caracteristicas,
  p.accesorios,
  p.usos,
  p.documentos,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'nombre', coalesce(nullif(btrim(x.v->>'nombre'), ''), 'Única'),
        'precio', coalesce(
          nullif(replace(btrim(coalesce(x.v->>'precio', '')), ',', '.'), '')::numeric(12,2),
          p.precio,
          0
        ),
        'disponible', case
          when x.v ? 'disponible' then coalesce((x.v->>'disponible')::boolean, false)
          else coalesce((x.v->>'stock')::int, 0) > 0
        end,
        'codigo', nullif(btrim(coalesce(x.v->>'codigo', '')), ''),
        'orden', coalesce(nullif(x.v->>'orden', '')::int, x.n::int)
      )
      order by coalesce(nullif(x.v->>'orden', '')::int, x.n::int), x.n
    )
    from jsonb_array_elements(p.variantes) with ordinality as x(v, n)
  ), '[]'::jsonb) as variantes,
  p.creado_en,
  p.codigo
from public.productos p
where p.activo;

grant select on public.catalogo_publico to anon, authenticated;

-- Notificar al catálogo público en tiempo real
update public.catalogo_meta set actualizado_en = now() where id = 1;

commit;

-- ---------------------------------------------------------------------
-- 5) VERIFICACIÓN: muestra productos con sus variantes estructuradas
-- ---------------------------------------------------------------------
select nombre, tipo, precio, jsonb_array_length(variantes) as num_variantes, variantes
  from public.catalogo_publico
 order by nombre
 limit 20;
