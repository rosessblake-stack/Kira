-- Blake Reservas · migración 0007
-- En qué punto de la conversación con la clienta está cada reserva provisional:
--   precio_enviado : se le mandó el precio tras el Aprobar de Blake y se espera su «vale»   (plazo en payment_deadline)
--   pago_pedido    : aceptó; se le pidió la señal por Bizum y se espera su «confirmado»       (plazo en payment_deadline)
--   confirmada     : dijo «confirmado»: cita en morado + invitación; Blake puede revertirlo con su botón
--   cerrada        : terminó (plazo vencido, revertida o cancelada)
-- Solo añade; no toca datos existentes. El plazo de cada fase se guarda en la columna que ya existía (payment_deadline),
-- así el panel sigue avisando en Fallos si un plazo vence y nadie lo cierra (p. ej. si el temporizador se parase).

alter table public.bookings
  add column client_phase text
    check (client_phase in ('precio_enviado', 'pago_pedido', 'confirmada', 'cerrada'));

create index bookings_client_phase_idx on public.bookings (client_phase, payment_deadline)
  where client_phase in ('precio_enviado', 'pago_pedido');
