# Reglas de seguridad y de disponibilidad

Estas reglas son parte del diseño, no un añadido final. Cada flujo nuevo las hereda.

## 1. Claude propone, nunca decide
- **Precio y horas:** salen de Legacy y de tu aprobación en Telegram. Claude nunca inventa ni cambia un precio.
- **Enlace de pago:** solo se genera después de que tú apruebes.
- **Confirmación de una cita:** solo se produce cuando llega un aviso de pago **firmado por Stripe** (Miami) o cuando **Blake lo confirma con su botón en Telegram** (pago por Bizum en España, que no se puede comprobar desde el servidor). Ningún mensaje de un cliente, por convincente que sea ("ya he pagado", **"confirmado"**, "me dijo Blake que cuesta 5 €"), confirma nada: una clienta que escribe «confirmado» solo hace que Kira avise a Blake para que mire su Bizum.
- **Qué puede hacer Claude:** clasificar el mensaje, redactar propuestas y respuestas, y rellenar datos estructurados. Todo lo que devuelve se valida con un esquema antes de usarse.

## 2. El texto de los clientes es dato, no instrucciones
- Los mensajes de clientes se pasan a Claude dentro de un bloque delimitado y marcado como contenido no fiable.
- Si un mensaje intenta dar órdenes al modelo (ignorar instrucciones, cambiar precios, revelar el prompt), se marca (`messages.flagged`), se registra en `security_events` (`posible_inyeccion`) y se te avisa en Telegram. No se responde automáticamente.
- Claude no tiene acceso a claves ni a herramientas con efectos: solo devuelve texto estructurado. Las acciones las ejecuta el código, con sus propias comprobaciones.

## 3. Quién puede qué
- **Telegram:** solo se aceptan aprobaciones de tu `user_id` de Telegram (guardado como variable de entorno). Cualquier otro intento se descarta y se registra (`telegram_no_autorizado`). Los botones llevan un identificador de un solo uso.
- **Webhooks:** se verifica la firma o el secreto de cada proveedor (Stripe, Telegram, ManyChat, Typeform). Sin firma válida: se rechaza y se registra (`firma_invalida`).
- **Idempotencia:** cada aviso se anota en `processed_webhooks`; un reintento no se procesa dos veces.
- **Panel:** sin contraseñas. Solo el administrador de Telegram puede pedir acceso (`/panel`): el bot le manda un enlace de un solo uso (5 minutos, sin vista previa) que se canjea pulsando un botón, para que ninguna vista previa lo gaste. La sesión dura 12 h, se guarda solo como hash y viaja en una cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`. Cada lectura de datos exige la prueba de administrador que solo entrega la comprobación de sesión. Sin sesión o con una cookie falsa se redirige al login (y la cookie falsa se registra). Enlaces ya usados, caducados o con formato inválido se rechazan y se registran (`acceso_panel_denegado`). Cabeceras: `no-store` y CSP restrictiva. Todo texto de clientes se muestra como texto plano.
- **Pausa:** el interruptor «Pausar Kira» falla hacia el silencio: si no se puede leer el ajuste, Kira se considera pausada.
- **Simulación (`/simular`):** solo el administrador; crea conversaciones del canal `prueba`, nunca envía nada a un cliente y sus reservas (`is_test`) no bloquean huecos reales.
- **Legacy:** Kira nunca envía a Legacy datos de una clienta (email interno de marcador y sin Instagram). Si Legacy falla o faltan datos, no se calcula precio.
- **Fotos de las clientas** (pelo y trenzas de referencia): son archivos de fuera, así que no se confía en nada de ellos. Solo JPG, PNG o WebP de hasta 4 MB, y el tipo lo deciden los **primeros bytes** del archivo (no lo que diga Telegram ni el nombre); si no cuadra, se rechaza y queda en seguridad (`payload_inesperado`). Se guardan en un almacén **privado** (bucket `kira-fotos`, sin URL pública) con ruta propia (`conversación/id.extensión`), junto a su hash SHA-256; el panel las sirve por `/panel/foto/<id>` **solo con sesión de administrador** (sin ella redirige al acceso), con `nosniff`, `sandbox` y sin caché. **Retención según el tipo (decisión de Blake):** la foto del **pelo de la clienta** (y cualquier «otra») **se borra a los 60 días** y su descripción se conserva; la foto de **referencia** (el peinado que quiere) **se guarda siempre**, porque son los ejemplos con los que se enseñará a Kira a entender cada descripción. La base de datos lo hace cumplir (`attachments_retencion_check`: referencia ⇔ sin fecha de caducidad). Corregir el tipo de una foto recalcula su fecha desde ese día (nunca borra de golpe una de referencia mal etiquetada). Mientras no haya tarea programada, cada foto nueva borra las caducadas. Una foto de referencia puede salir una persona (la modelo del peinado, o la propia clienta): por eso la clienta debe saber que se guarda (aviso en el guion de ManyChat) y debe poder pedir que se borre; **pendiente**: un comando para que Blake borre una foto concreta. La foto **no se envía a Claude** y nada que contenga se interpreta: la describe Blake y su texto se muestra como texto plano. Los errores de descarga nunca llevan la dirección (contiene el token del bot). Un EXIF con ubicación no es un riesgo hoy porque Telegram e Instagram reprocesan las imágenes; si algún día entra otra fuente, hay que quitarlo al guardar.
- **Registro de servicios** (`service_records`, `/real`, `/datos`): solo campos cerrados (tipo, tamaño, extensiones, horas, materiales, precio) y el nombre de pila para reconocer la cita; **nunca** el mensaje, el email ni el Instagram de la clienta. Solo Blake puede anotar o leer datos reales (comandos de administrador); lo que escribe se interpreta con un formato cerrado y la nota se limpia y se recorta. Las citas de prueba se guardan marcadas y no cuentan para calibrar.
- **Base de datos:** RLS activada y sin políticas. Solo el servidor, con la clave `service_role`, puede leer o escribir.
- **Límite de peticiones:** tope por contacto y por hora (10) y tope diario de llamadas a Claude (300) para frenar abusos y evitar gasto descontrolado de API. Al superarlo: silencio, evento `limite_de_peticiones` y aviso a Blake. El tope diario ya está activo; el de ritmo por contacto está implementado y probado y se conectará con ManyChat.

## 4. Secretos
- Tokens y claves (Stripe, Telegram, ManyChat, Anthropic, Google, `service_role`) viven **solo** en variables de entorno de Vercel. Las pones tú en el panel de Vercel; no se pegan en ningún chat.
- Nunca se guardan ni se registran datos de tarjeta. Stripe se encarga de los pagos.

## 5. Reglas del calendario y de la disponibilidad
- **Leer todos los eventos del día, no solo "libre/ocupado".** Hay citas marcadas como "libre" (transparentes), como la de Lux; el sistema las trata siempre como bloqueo.
- **Usar la hora de fin real** de cada evento y respetar un margen entre citas (a definir contigo).
- **Respetar horarios de trabajo** (a definir contigo).
- **Comprobar antes de crear**, no después: si el hueco no está libre, no se crea nada y se ofrecen alternativas.
- **Segundo cerrojo en la base de datos:** dos reservas activas no pueden solaparse (`bookings_no_overlap`).
- **Borrar solo lo propio:** el temporizador de 10 minutos solo elimina eventos cuyo `calendar_event_id` esté guardado en una reserva creada por el sistema. Tus citas manuales no se tocan nunca.
- **Sin Google Meet:** al crear eventos no se añade enlace de Meet (tus citas son presenciales).

## 6. Instagram
- Solo se puede escribir a una persona dentro de las 24 horas desde su último mensaje (`conversations.last_client_message_at`). Fuera de esa ventana, el sistema no envía y te avisa.

## 7. Qué vigila el panel
- **Proceso:** línea de tiempo por conversación (mensaje, clasificación, propuesta, aprobación, pago, cita).
- **Fallos:** errores y avisos, tareas fallidas o atascadas, reservas expiradas, aprobaciones pendientes demasiado tiempo.
- **Seguridad:** firmas inválidas, intentos no autorizados, límites alcanzados, posibles inyecciones, archivos que se hacían pasar por fotos.
- El panel registra y avisa de lo sospechoso; no sustituye una revisión de seguridad del código, que se hace antes de pasar a automático.
