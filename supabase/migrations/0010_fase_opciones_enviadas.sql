-- Blake Reservas · migración 0010
-- Nueva fase de la conversación con la clienta: «opciones_enviadas». Cuando la hora que pide choca con otra cita, Blake puede
-- pulsar «Ofrecer opciones» y Kira le manda 1-3 huecos libres del mismo día y la misma hora el próximo día libre; la clienta
-- contesta con el número. Solo amplía la lista de valores permitidos; no toca datos existentes.
-- (Aplicada en producción con NOT VALID para no bloquear la tabla; las filas existentes ya cumplen la restricción.)

alter table public.bookings drop constraint bookings_client_phase_check;
alter table public.bookings
  add constraint bookings_client_phase_check
    check (client_phase in ('precio_enviado', 'pago_pedido', 'pago_declarado', 'liberada', 'opciones_enviadas', 'confirmada', 'cerrada'));
