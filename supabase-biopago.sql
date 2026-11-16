-- Mercería de Oriente · Agregar el método de pago "Biopago" a Cashea
-- Es seguro correrlo más de una vez. No borra ventas.
begin;

alter table public.cashea_ventas drop constraint if exists cashea_metodo_chk;
alter table public.cashea_ventas add constraint cashea_metodo_chk
  check (metodo_pago is null or metodo_pago in (
    'Efectivo USD', 'Efectivo Bs', 'Pago móvil', 'Transferencia', 'Punto de venta', 'Biopago', 'Zelle', 'Otro'
  ));

commit;
