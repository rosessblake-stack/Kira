# Conectar el calendario de Blake (Google Calendar)

Una sola vez, unos 10 minutos. Al final Kira mira tu agenda de verdad antes de proponer o aprobar una cita, crea la reserva provisional (amarilla), la pasa a morado cuando confirmas la señal y la borra si cancelas.

## Qué hace y qué no hace Kira con tu calendario

- **Lee TODOS los eventos** del calendario, también los marcados «libre» (como la cita de Lux) y los de todo el día. Un evento con hora que se solape con la cita **bloquea** (no se crea nada y la propuesta no deja aprobar). Un margen corto con la cita de antes o de después y un evento de todo el día son **avisos**: decides tú.
- **Mira la agenda dos veces**: al preparar la propuesta y otra vez justo al pulsar Aprobar (puede haber cambiado). Si Google no responde, **no crea nada**: sin mirar, no hay cita.
- **Crea** el evento con tus convenciones: título `Trenzas Nombre`, descripción (`6 Trenzas` / `Con extensiones (color)` / línea en blanco / `80€` / `@instagram`), dirección de la cita, aviso emergente a los 60 min, **sin Google Meet**, **sin invitados**, amarillo = sin señal. Las pruebas (`/simular`) llevan «🧪 PRUEBA» en el título y no bloquean huecos reales.
- **«Señal recibida»** (botón de Telegram, solo tuyo): pasa a morado y añade el email de la clienta (Google le envía la invitación). En una prueba solo se invita si el email es el de tu propia cuenta.
- **«Cancelar cita»**: borra **solo el evento que creó Kira para esa reserva**. Antes de tocar nada comprueba que el evento lleva la marca de esa reserva; **nunca** borra ni cambia una cita tuya.
- **Permisos que se piden a Google**: ver y editar eventos de tus calendarios, y tu email (para decirte con qué cuenta está conectado). Nada más: ni contactos, ni correo, ni borrar calendarios.

## Pasos

> Usa la cuenta de Google donde tienes tus citas: **info@blakebraider.com** (el calendario de rosessblake@gmail.com está vacío).

1. Entra en [console.cloud.google.com](https://console.cloud.google.com) con esa cuenta y crea un proyecto llamado **Kira**.
2. *APIs y servicios → Biblioteca*: busca **Google Calendar API** y pulsa **Habilitar**.
3. *Google Auth Platform* (antes «Pantalla de consentimiento OAuth»):
   - Si te deja elegir **Interno** (la cuenta es de Google Workspace), elígelo: no hay que publicar ni verificar nada y la conexión no caduca.
   - Si solo te deja **Externo**, elígelo, rellena nombre «Kira» y tu email como contacto, y en *Público* (*Audience*) pulsa **Publicar aplicación** (pasa a «En producción»). En modo «Pruebas» Google caduca la conexión a los 7 días.
4. *Clientes* (o *Credenciales → Crear credenciales → ID de cliente de OAuth*): tipo **Aplicación web**. En **URI de redireccionamiento autorizados** añade exactamente:
   `https://kira-virid-eight.vercel.app/api/google/callback`
   (en el panel, pestaña Calendario, ves la dirección exacta que debe estar ahí).
5. Google te da un **ID de cliente** y un **secreto de cliente**. En Vercel, proyecto **kira** → *Settings → Environment Variables*, añade en los tres entornos (Production, Preview, Development), tipo *Sensitive*:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   Nunca los pegues en un chat.
6. Redespliega (o dime que lo haga). Cuando esté, en Telegram escribe `/calendario`: debe decir «listo para conectar».
7. Entra en el panel (`/panel`) → pestaña **Calendario** → **Conectar Google Calendar**. Google te pedirá permiso. Si dice «Google no ha verificado esta aplicación» es tu propia app: *Avanzado → Ir a Kira (no seguro)* y acepta.
8. Vuelves al panel y verás «Conectado con …». Pulsa **Comprobar ahora**: debe decir que lee tu agenda.

Opcional: `GOOGLE_CALENDAR_ID` fija otro calendario (por defecto, el principal de la cuenta conectada).

## Si algo falla

| Qué ves | Qué significa |
|---|---|
| Google dice `redirect_uri_mismatch` | La dirección del paso 4 no coincide con la del panel (pestaña Calendario). Copia la que sale allí. |
| «Este enlace ya no vale» | Empezaste la conexión hace más de 10 min, ya la usaste o no empezó desde tu panel. Vuelve a pulsar Conectar. |
| «Google no entregó permiso permanente» | Al aceptar, desmarcaste algún permiso. Vuelve a conectar y marca todos. |
| Las propuestas dicen «comprobar la agenda (…)» y no dejan aprobar | Google no responde o la conexión se perdió (cambiaste la contraseña, quitaste el acceso, caducó). Mira Fallos y, si hace falta, **Reconectar**. |
| Dejó de funcionar tras rotar `SUPABASE_SERVICE_ROLE_KEY` | El permiso guardado se cifra con una clave derivada de esa. Pulsa **Reconectar**. |

## Dónde vive el permiso (seguridad)

El ID y el secreto de cliente viven solo en variables de entorno de Vercel. El permiso permanente que da Google al conectar se guarda en la base de datos **cifrado** (AES-256-GCM, clave derivada de la clave de servidor de Supabase): una copia de la base de datos sola no sirve para usarlo. Nunca se registra, nunca se muestra y el panel solo enseña la cuenta. **Desconectar** (panel) lo revoca en Google y lo borra de Kira.
