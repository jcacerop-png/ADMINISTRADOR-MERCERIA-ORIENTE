-- =====================================================
-- MERCERÍA DE ORIENTE · Actualización 3
-- Ejecutar TODO en SQL Editor → Run. Es seguro correrlo más de una vez.
-- 1) Actualiza la vista pública para que incluya la fecha de publicación
--    (sirve para la etiqueta "Nuevo").
-- 2) Agrega las categorías nuevas a las restricciones de la base de datos.
-- No borra ni cambia datos.
-- =====================================================

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

-- ---------- Categorías (restricciones) ----------
-- Quita las restricciones antiguas de tipo (productos) y codigo (tipos), sea cual sea su nombre.
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

alter table public.productos add constraint productos_tipo_check
  check (tipo in ('maquina','hilo','tela','bisuteria','otro','acce_met','acce_plast','cierre','cordon','tijera','crochet_neg','crochet_blanc','macuto_neg','macuto_blanc','repuesto'));
alter table public.tipos add constraint tipos_codigo_check
  check (codigo in ('maquina','hilo','tela','bisuteria','otro','acce_met','acce_plast','cierre','cordon','tijera','crochet_neg','crochet_blanc','macuto_neg','macuto_blanc','repuesto'));

-- =====================================================
-- Listo. Costo y ganancia siguen privados (la vista nunca los incluye).
-- =====================================================
