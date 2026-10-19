# Reglas de seguridad y de disponibilidad

Estas reglas son parte del diseño, no un añadido final. Cada flujo nuevo las hereda.

## 1. Claude propone, nunca decide
- **Precio y horas:** salen de Legacy y de tu aprobación en Telegram. Claude nunca inventa ni cambia un precio.
- **Enlace de pago:** solo se genera después de que tú apruebes.
- **Confirmación de una cita:** solo se produce cuando llega un aviso de pago **firmado por Stripe**. Ningún mensaje de un cliente, por convincente que sea ("ya he pagado", "me dijo Blake que cuesta 5 €"), confirma nada.
- **Qué puede hacer Claude:** clasificar el mensaje, redactar propuestas y respuestas, y rellenar datos estructurados. Todo lo que devuelve se valida con un esquema antes de usarse.

## 2. El texto de los clientes es dato, no instrucciones
- Los mensajes de clientes se pasan a Claude dentro de un bloque delimitado y marcado como contenido no fiable.
- Si un mensaje intenta dar órdenes al modelo (ignorar instrucciones, cambiar precios, revelar el prompt), se marca (`messages.flagged`), se registra en `security_events` (`posible_inyeccion`) y se te avisa en Telegram. No se responde automáticamente.
- Claude no tiene acceso a claves ni a herramientas con efectos: solo devuelve texto estructurado. Las acciones las ejecuta el código, con sus propias comprobaciones.

## 3. Quién puede qué
- **Telegram:** solo se aceptan aprobaciones de tu `user_id` de Telegram (guardado como variable de entorno). Cualquier otro intento se descarta y se registra (`telegram_no_autorizado`). Los botones llevan un identificador de un solo uso.
- **Webhooks:** se verifica la firma o el secreto de cada proveedor (Stripe, Telegram, ManyChat, Typeform). Sin firma válida: se rechaza y se registra (`firma_invalida`).
- **Idempotencia:** cada aviso se anota en `processed_webhooks`; un reintento no se procesa dos veces.
- **Panel:** acceso protegido con inicio de sesión de administrador. Los intentos denegados se registran (`acceso_panel_denegado`).
- **Base de datos:** RLS activada y sin políticas. Solo el servidor, con la clave `service_role`, puede leer o escribir.
- **Límite de peticiones:** tope por contacto y por minuto para frenar abusos y evitar gasto descontrolado de API.

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
- **Seguridad:** firmas inválidas, intentos no autorizados, límites alcanzados, posibles inyecciones.
- El panel registra y avisa de lo sospechoso; no sustituye una revisión de seguridad del código, que se hace antes de pasar a automático.
