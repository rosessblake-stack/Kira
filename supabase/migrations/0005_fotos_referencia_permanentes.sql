-- Blake Reservas · migración 0005
-- Las fotos de REFERENCIA (el peinado que quiere la clienta) se guardan para siempre: son los ejemplos con los que se
-- enseñará a Kira a entender cada descripción de Blake. Las demás (pelo de la clienta y «otra») caducan a los 60 días.
-- La base de datos lo hace cumplir: una foto de referencia no puede tener fecha de caducidad ni las demás pueden no tenerla.
-- Solo cambia reglas de la tabla creada en 0004; no borra nada.

alter table public.attachments alter column expires_at drop not null;

-- Lo que ya hubiera de referencia deja de caducar.
update public.attachments set expires_at = null where kind = 'referencia';

alter table public.attachments
  add constraint attachments_retencion_check
  check ((kind = 'referencia') = (expires_at is null));
