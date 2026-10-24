# Flujo de ManyChat «¿cómo te apunto y a qué correo?»

Kira lo lanza por la API de ManyChat (`/fb/sending/sendFlow`) cuando Blake pulsa «✅ Sí, me ha llegado» y la cita no tiene correo.

1. En ManyChat crea un flujo (p. ej. «Pedir nombre y correo») con: pregunta «¿Cómo te apunto?» (texto → campo `nombre_cita`) y pregunta «¿A qué correo te envío la invitación?» (tipo **Email**, con validación → campo `email`).
2. Último bloque: **Solicitud externa** `POST https://kira-virid-eight.vercel.app/api/manychat/datos`, cabecera `x-kira-secret` (la misma clave de siempre), cuerpo JSON `{"id":"{{id}}","nombre":"{{nombre_cita}}","email":"{{email}}"}` (insertando las variables con el selector).
3. Copia el identificador (`ns`) del flujo y en Telegram: `/flowdatos <identificador>`. `/flowdatos off` lo apaga (Kira pide el correo por mensaje de texto, como antes).

Kira guarda nombre y correo en la reserva y la ficha, pone «Trenzas [Nombre]» al evento, invita a la clienta y avisa a Blake.
