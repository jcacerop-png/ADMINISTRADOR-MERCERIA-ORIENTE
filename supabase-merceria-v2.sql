-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 2
-- Ejecutar TODO en SQL Editor → Run, UNA sola vez.
-- Va sobre el proyecto que ya tienes (no hace falta volver a
-- ejecutar supabase-merceria.sql). Se puede repetir sin romper nada.
-- Agrega: carrusel de fotos, ventas (venta rápida y anulaciones)
-- y ajusta el aviso de actividad para que no duplique las ventas.
-- =====================================================

-- ---------- 1) Actividad: las ventas se registran a sí mismas ----------
-- Si la modificación viene de una venta o anulación, no se escribe la línea genérica "editó…"
create or replace function public.tr_productos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.venta', true) is distinct from '1' then
    insert into public.actividad (usuaria, texto)
    values (
      public.usuaria_actual(),
      case tg_op
        when 'INSERT' then 'agregó ' || new.nombre
        when 'DELETE' then 'eliminó ' || old.nombre
        else 'editó ' || new.nombre
      end
    );
  end if;
  update public.catalogo_meta set actualizado_en = now() where id = 1;
  return coalesce(new, old);
end $$;

-- ---------- 2) Carrusel de fotos (fondo de la entrada y banner del catálogo) ----------
create table if not exists public.carrusel (
  id         uuid primary key default gen_random_uuid(),
  url        text not null check (char_length(url) between 10 and 1000),
  orden      int not null default 0,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

alter table public.carrusel enable row level security;

drop policy if exists carrusel_leer_publico on public.carrusel;
create policy carrusel_leer_publico on public.carrusel for select to anon using (activo);

drop policy if exists carrusel_leer_panel on public.carrusel;
create policy carrusel_leer_panel on public.carrusel for select to authenticated using (public.usuaria_actual() is not null);

drop policy if exists carrusel_crear on public.carrusel;
create policy carrusel_crear on public.carrusel for insert to authenticated
  with check (public.usuaria_actual() is not null and (select count(*) from public.carrusel) < 10);

drop policy if exists carrusel_editar on public.carrusel;
create policy carrusel_editar on public.carrusel for update to authenticated
  using (public.usuaria_actual() is not null) with check (public.usuaria_actual() is not null);

drop policy if exists carrusel_borrar on public.carrusel;
create policy carrusel_borrar on public.carrusel for delete to authenticated
  using (public.usuaria_actual() is not null);

-- Cada cambio en el carrusel avisa al catálogo público en vivo
create or replace function public.tr_carrusel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.catalogo_meta set actualizado_en = now() where id = 1;
  return coalesce(new, old);
end $$;

drop trigger if exists carrusel_cambios on public.carrusel;
create trigger carrusel_cambios
  after insert or update or delete on public.carrusel
  for each row execute function public.tr_carrusel();

-- ---------- 3) Ventas (solo se escriben con las funciones de abajo) ----------
create table if not exists public.ventas (
  id           uuid primary key default gen_random_uuid(),
  creado_en    timestamptz not null default now(),
  usuaria      text not null,
  metodo       text not null default 'Efectivo' check (char_length(metodo) <= 40),
  nota         text not null default '' check (char_length(nota) <= 300),
  total        numeric(12,2) not null default 0 check (total >= 0),
  costo_total  numeric(12,2) not null default 0 check (costo_total >= 0),   -- privado: solo el panel
  items        jsonb not null default '[]'::jsonb,   -- [{producto_id,nombre,tipo,variante,cantidad,precio,costo}]
  anulada      boolean not null default false,
  anulada_en   timestamptz,
  anulada_por  text
);

alter table public.ventas enable row level security;

drop policy if exists ventas_leer on public.ventas;
create policy ventas_leer on public.ventas for select to authenticated using (public.usuaria_actual() is not null);
-- Sin políticas de insertar/editar/borrar: las ventas solo se crean o anulan con las funciones seguras.

-- ---------- 4) Registrar venta: valida y descuenta existencias en una sola transacción ----------
create or replace function public.registrar_venta(
  p_items  jsonb,
  p_metodo text default 'Efectivo',
  p_nota   text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuaria  text := public.usuaria_actual();
  v_item     jsonb;
  v_prod     public.productos%rowtype;
  v_cant     int;
  v_precio   numeric(12,2);
  v_var      text;
  v_idx      int;
  v_stock    int;
  v_vars     jsonb;
  v_detalle  jsonb := '[]'::jsonb;
  v_total    numeric(12,2) := 0;
  v_costo    numeric(12,2) := 0;
  v_id       uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene prendas';
  end if;

  -- Esta transacción no escribe la línea genérica "editó…": la registra la propia venta
  perform set_config('app.venta', '1', true);

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cant   := greatest(1, coalesce((v_item->>'cantidad')::int, 0));
    v_precio := round(greatest(0, coalesce((v_item->>'precio')::numeric, 0)), 2);
    v_var    := coalesce(nullif(v_item->>'variante', ''), 'Única');

    -- Bloquea la fila: dos cajas no pueden vender la última pieza a la vez
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::uuid for update;
    if not found then
      raise exception 'Una de las prendas ya no existe';
    end if;

    select ord - 1 into v_idx
    from jsonb_array_elements(v_prod.variantes) with ordinality as x(v, ord)
    where x.v->>'nombre' = v_var
    limit 1;
    if v_idx is null then
      raise exception 'La variante % no existe en %', v_var, v_prod.nombre;
    end if;

    v_stock := coalesce((v_prod.variantes -> v_idx ->> 'stock')::int, 0);
    if v_stock < v_cant then
      raise exception 'Sin existencias suficientes de % (%): quedan %', v_prod.nombre, v_var, v_stock;
    end if;

    v_vars := jsonb_set(v_prod.variantes, array[v_idx::text, 'stock'], to_jsonb(v_stock - v_cant));
    update public.productos set variantes = v_vars, actualizado_en = now() where id = v_prod.id;

    insert into public.actividad (usuaria, texto)
    values (v_usuaria, 'vendió ' || v_cant || ' × ' || v_prod.nombre || ' (' || v_var || ')');

    v_total   := v_total + v_precio * v_cant;
    v_costo   := v_costo + v_prod.costo * v_cant;
    v_detalle := v_detalle || jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod.id,
      'nombre', v_prod.nombre,
      'tipo', v_prod.tipo,
      'variante', v_var,
      'cantidad', v_cant,
      'precio', v_precio,
      'costo', v_prod.costo
    ));
  end loop;

  insert into public.ventas (usuaria, metodo, nota, total, costo_total, items)
  values (
    v_usuaria,
    left(coalesce(nullif(p_metodo, ''), 'Efectivo'), 40),
    left(coalesce(p_nota, ''), 300),
    v_total,
    v_costo,
    v_detalle
  )
  returning id into v_id;

  return v_id;
end $$;

-- ---------- 5) Anular venta: devuelve las existencias y marca la venta ----------
create or replace function public.anular_venta(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_usuaria text := public.usuaria_actual();
  v_venta   public.ventas%rowtype;
  v_item    jsonb;
  v_prod    public.productos%rowtype;
  v_idx     int;
  v_vars    jsonb;
begin
  select * into v_venta from public.ventas where id = p_id for update;
  if not found then
    raise exception 'La venta no existe';
  end if;
  if v_venta.anulada then
    raise exception 'Esa venta ya estaba anulada';
  end if;

  perform set_config('app.venta', '1', true);

  for v_item in select value from jsonb_array_elements(v_venta.items) loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::uuid for update;
    if found then
      select ord - 1 into v_idx
      from jsonb_array_elements(v_prod.variantes) with ordinality as x(v, ord)
      where x.v->>'nombre' = v_item->>'variante'
      limit 1;
      if v_idx is not null then
        v_vars := jsonb_set(
          v_prod.variantes,
          array[v_idx::text, 'stock'],
          to_jsonb(coalesce((v_prod.variantes -> v_idx ->> 'stock')::int, 0) + coalesce((v_item->>'cantidad')::int, 0))
        );
        update public.productos set variantes = v_vars, actualizado_en = now() where id = v_prod.id;
      end if;
    end if;

    insert into public.actividad (usuaria, texto)
    values (v_usuaria, 'anuló ' || coalesce(v_item->>'cantidad', '0') || ' × ' || coalesce(v_item->>'nombre', '')
      || ' de la venta del ' || to_char(v_venta.creado_en at time zone 'America/Caracas', 'DD/MM HH24:MI'));
  end loop;

  update public.ventas
  set anulada = true, anulada_en = now(), anulada_por = v_usuaria
  where id = p_id;
end $$;

-- Solo las cuentas autorizadas pueden usar las funciones
revoke execute on function public.registrar_venta(jsonb, text, text) from public, anon;
grant  execute on function public.registrar_venta(jsonb, text, text) to authenticated;
revoke execute on function public.anular_venta(uuid) from public, anon;
grant  execute on function public.anular_venta(uuid) to authenticated;

-- =====================================================
-- Listo. No hace falta tocar nada más en Supabase.
-- =====================================================
