-- Blake Reservas · migración 0008
-- Dos fases nuevas en la conversación con la clienta (decisión de Blake, 20-oct): Kira ya NO confirma sola cuando la clienta dice
-- «confirmado»; se lo pregunta a Blake con dos botones.
--   pago_declarado : la clienta dijo que ya hizo el Bizum; Blake mira su banco y decide (sin plazo propio: decide él)
--   liberada       : Blake dijo «no me ha llegado»: el hueco está libre y el evento borrado, pero si la clienta escribe
--                    «hecho» se vuelve a reservar y se le pregunta a Blake otra vez (con plazo, para no esperar eternamente)
-- Solo amplía la lista de valores permitidos; no toca datos existentes.

alter table public.bookings drop constraint bookings_client_phase_check;
alter table public.bookings
  add constraint bookings_client_phase_check
    check (client_phase in ('precio_enviado', 'pago_pedido', 'pago_declarado', 'liberada', 'confirmada', 'cerrada'));

drop index if exists public.bookings_client_phase_idx;
create index bookings_client_phase_idx on public.bookings (client_phase, payment_deadline)
  where client_phase in ('precio_enviado', 'pago_pedido', 'liberada');
