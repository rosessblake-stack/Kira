# Kira — Traspaso para Claude Code

Proyecto de Blake (trenzador profesional en España, habla español; responde siempre en español). Ecosistema propio de automatización ("Kira") sobre Vercel + Supabase que sustituye a Make. Incluye un panel para ver proceso, fallos y seguridad.

**Regla de oro: Claude propone, Blake decide, el código ejecuta.** Lee `docs/SEGURIDAD.md` y `docs/POLITICA.md` antes de tocar nada. No se saltan.

## 1. Objetivo del producto

Flujo: DM de Instagram → ManyChat → servidor Kira → Claude clasifica → Telegram a Blake con botones (Aprobar / Editar / Rechazar) → según el caso:

- **Cita de salón:** precio desde Legacy (su app de precios) → reserva provisional amarilla en Google Calendar → enlace de Stripe de "paga y señal" (10–20 €, lo elige Blake) → plazo de 10 min; si no paga, se borra el evento provisional; si paga, el evento pasa a morado y se añade el email del cliente. Clientes OG/conocidos: los reserva Blake a mano (sin email ni señal).
- **Formación online / infoproducto:** enviar enlace de la página.
- **Formación presencial:** enviar Typeform, esperar 10–15 min, responder y proponer fecha de llamada.

Reglas de agenda (blandas, decide siempre Blake): horario 11:00–22:00; inicio desde 8:00 para servicios de más de ~6 h; margen mínimo 1 h entre citas (puede ser menor en servicios fáciles); la alerta de Telegram debe mostrar las citas contiguas (tipo/duración/margen) y etiquetas cuando un hueco rompe una regla. Días libres: no se contesta (configurable; **pendiente preguntar a Blake qué días no trabaja**).

## 2. Stack, repositorio e identificadores (no son secretos)

- Next.js 16 App Router (TypeScript), React 19, vitest, SDK oficial `@anthropic-ai/sdk`.
- **Código:** repo privado `rosessblake-stack/Kira` (rama de trabajo `panel`; `main` = punto de partida subido por Blake). Carpeta de trabajo en cada sesión: `/home/user/kira`.
- **Vercel:** equipo `legacycalculator` (`team_frYYbu3HpiTVVB1uyfBIxDC9`), proyecto `kira` (`prj_IRGik57tCAIKHBIr5lIm2MnNYcEy`), región dub1. Producción: `https://kira-virid-eight.vercel.app` (alias también `kira-legacycalculator.vercel.app`). Protección SSO desactivada (Telegram debe poder llamar). Se despliega con `create_deployment` y `gitSource` (github, org `rosessblake-stack`, repo `Kira`, ref y sha exactos): Vercel tiene acceso al repo.
- **Supabase Kira:** ref `nkrzngvaftmxzlitivgy`, eu-west-1, Postgres 17. **Supabase Legacy-Data:** ref `crmpjtaczpmjfxxbujkb` (datos de OTROS usuarios de la calculadora: no volcarlos nunca; no es un catálogo de servicios de Blake).
- **Legacy:** proyecto Vercel `legacy` (`prj_Pyork7CkuYjT6uUykz4cd1EdX9OT`), dirección pública `https://legacy-rosy-rho.vercel.app`. Su API es `/api/calculate`.
- **Bot de Telegram:** @KiracitasBot. Admin único: user_id `1547856536` (Blake).
- Variables de entorno en Vercel (sensibles salvo URL; **solo escritura**, no se pueden leer; una fila por entorno: production/preview/development, hay que editar las tres; un cambio exige **redesplegar**):
  - Ya puestas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_USER_ID`.
  - **Falta (la pone Blake, nunca por chat): `ANTHROPIC_API_KEY`.** Sin ella `/simular` avisa «Falta la clave de Claude» y deriva a Blake.
  - Opcionales: `KIRA_MODEL` (por defecto `claude-opus-5-5`), `LEGACY_API_URL` (por defecto la dirección pública de Legacy), `LEGACY_INTERNAL_EMAIL` (por defecto `kira-interno@kira.invalid`).
  - Solo para pruebas e2e: `KIRA_E2E=1` + `TELEGRAM_API_BASE`. **Nunca ponerlas en Vercel**; así el token del bot no puede enviarse a otra dirección.
- Nunca pegar secretos en el chat, ni en código, ni en logs. Si un secreto pasa por una conversación, rotarlo.

## 3. Lo que ya está hecho

- **Base de datos** (`supabase/migrations/`, todas aplicadas en producción): `0001_init` (conversaciones, mensajes, reservas con `bookings_no_overlap`, `scheduled_jobs` + `claim_due_jobs()`, idempotencia, `event_log` y `security_events` solo-añadir, RLS sin políticas), `0002_panel` (`panel_login_tokens`, `panel_sessions`, `app_settings` con `kira_paused`), `0003_propuestas` (canal `prueba`; en `bookings`: `is_test`, `spec`, `pricing`, `warnings`, `reply_draft`, `proposal_nonce`, `telegram_message_id`, `edit_requested_at`; el anti-solape ignora las reservas de prueba). Cada migración se probó en un Postgres 16 temporal.
- **Estados de reserva:** propuesta → aprobada → pendiente_pago → pagada | expirada | cancelada.
- **Telegram:** verifica la cabecera secreta (401 + evento si falla), idempotencia, solo chats privados, solo admin. Comandos: `/start`, `/panel`, `/simular <mensaje>`, `/cancelar`, `/prueba`. Botones de un solo uso (`t:` prueba, `p:` propuestas con gasto atómico del nonce).
- **Panel** (`/panel`): login sin contraseñas. Blake escribe `/panel` al bot, recibe un enlace de un solo uso (5 min, sin vista previa), lo abre y pulsa **Entrar** (para que una vista previa no lo gaste). Sesión de 12 h guardada solo como hash; cookie `__Host-`, HttpOnly, Secure, SameSite=Strict. Pestañas **Proceso** (conversaciones, detalle con línea de tiempo, *lo que Kira entendió*, precio, avisos y borrador), **Fallos** (reservas y tareas sin cerrar, webhook de Telegram, errores registrados), **Seguridad** (eventos y mensajes marcados). Interruptor **Pausar Kira**. Todo el texto de clientes se pinta como texto plano. Cada función de datos exige la prueba `Admin` que solo entrega `requireAdmin()`.
- **Motor de intenciones** (`lib/intents.ts`, `lib/claude.ts`): Claude solo clasifica (lista cerrada de `docs/POLITICA.md`) con salida JSON de esquema estricto; el código valida cada campo, descarta lo que no cuadra y exige que email e Instagram aparezcan literalmente en el mensaje. El mensaje del cliente va como dato dentro de `<mensaje_cliente>`. Filtro de manipulación previo (sin gastar Claude), límites de ritmo y tope diario de llamadas. Rechazo del modelo = señal de seguridad y derivación. Claude no redacta nada que llegue al cliente: el borrador es una plantilla con datos ya validados.
- **Legacy** (`lib/pricing.ts`): el precio lo calcula la fórmula real de Legacy (`/api/calculate`) con el perfil de Blake. Kira usa un email interno de marcador y nunca envía datos de la clienta (cada llamada guarda una fila en `legacy_data`: se reconocen por `email = kira-interno@kira.invalid` y `nombre_servicio` que empieza por `[Kira]`). Si faltan datos o Legacy falla, **no hay precio** (nunca se inventa); Blake puede poner `precio 80`.
- **Propuestas** (`lib/proposal.ts`, `lib/proposal-flow.ts`): `/simular` crea una conversación de canal `prueba`, comprueba pausa, manipulación y límites, clasifica, calcula el precio y manda a Blake la propuesta con Aprobar/Editar/Rechazar. Editar acepta líneas simples (`precio`, `señal`, `horas`, `fecha`, `hora`, `tipo`, `tamaño`, `extensiones`, `largo`, `trenzas`, `nombre`, `email`, `respuesta`); un precio puesto a mano no lo pisa Legacy (`precio auto` lo devuelve). Aprobar solo deja la reserva en `aprobada`: **no envía nada al cliente ni toca el calendario**.
- **Pruebas:** `npm test` (vitest, incluido un contrato contra la fórmula real de Legacy: usa `LEGACY_REPO`, por defecto `/home/user/legacy`), `npm run e2e` (panel) y `npm run e2e:flujo` (flujo completo con Legacy real). Los e2e arrancan la app compilada y un navegador real; solo simulan base de datos, Telegram y Claude. Requieren `npm run build` antes.
- **Documentos:** `docs/SEGURIDAD.md` y `docs/POLITICA.md`.

## 4. Pasos que faltan (orden acordado)

0. **Confirmar con Blake** (están marcados «por confirmar» en cada propuesta): perfil de precios (nivel, zona, **¿casa o salón?**, SMI) —hoy provisional: élite · media · casa · 1350 €—, horas y materiales por defecto (`lib/pricing.ts`: pegadas 0,5 h + 15 min por trenza; sueltas/fulani por tamaño; materiales 5 € y 10 €), señal por defecto (15 €), política de redondeo del precio de Legacy y días libres.
1. **Poner `ANTHROPIC_API_KEY`** en Vercel y probar en vivo con `/simular` (ver sección 8).
2. **ManyChat/Instagram:** webhook firmado hacia el servidor, respuesta de vuelta por ManyChat; respetar la ventana de 24 h de Instagram; límite de ritmo por cliente (`LIMITES.mensajesPorHoraYCliente`, ya implementado y probado en `lib/intents.ts`, falta conectarlo); quitar el aviso «aún no hay mensajes de clientes conectados» del panel.
3. **Formación online/infoproducto** (enlace de página) y **presencial** (Typeform, espera 10–15 min con `scheduled_jobs`, respuesta + fecha de llamada). Hoy `/simular` las deriva a Blake.
4. **Cita de salón (lo que queda):**
   - Google Calendar con credenciales OAuth propias.
   - Disponibilidad: leer TODOS los eventos (también los marcados "libre"/transparent), usar la hora de fin real, respetar horario y márgenes, comprobar antes de crear y apoyarse en `bookings_no_overlap`. Hoy cada propuesta dice «Disponibilidad NO comprobada».
   - Convenciones del evento: título `Trenzas [Nombre]`; descripción `tipo servicio\ncon/sin extensiones (color)\n\nprecio€\n@instagram`; ubicación Carrer de la Duquessa de la Victòria, 16; recordatorio emergente 60 min; **sin Google Meet**; colorId 5 amarillo = sin señal, colorId 3 morado = reservado/pagado.
   - Borrar solo eventos con `calendar_event_id` guardado.
   - Stripe: sesión de pago de la señal (10–20 €), cancelar la sesión de checkout a los 10 min, webhook con verificación de firma e idempotencia, al pagar pasar a morado y añadir email.
   - Cron cada minuto (Vercel Cron) que ejecute `claim_due_jobs()` para expiraciones.
5. **Revisión de seguridad completa** y automatización gradual (fase 1: todo con Aprobar; fase 2: solo lo que Blake marque como seguro; citas, pagos y borrados nunca automáticos sin su decisión explícita). Pendientes ya identificados: CSP completa con nonces (hoy solo `frame-ancestors`, `base-uri`, `form-action`), límite de intentos de canje de enlaces y tope al registro de `acceso_panel_denegado`, limpieza de tokens y sesiones caducados, comando `/pausa` desde Telegram, comando `/perfil` para que Blake confirme el perfil de precios sin tocar código, y decidir si Claude puede redactar respuestas (hoy no: filtro de salida de `docs/POLITICA.md` §4.3 pendiente para ese caso).

## 5. Coste estimado (para informar a Blake)

~0,01–0,02 € de Claude por mensaje clasificado con `claude-opus-5-5` (≈1.000 tokens de entrada y ≈300 de salida; $4/$20 por millón) frente a la estimación inicial de 0,10 € por consulta; el resto depende de ManyChat y Stripe (comisión 0,40–0,65 € solo si se cobra). ManyChat Pro ~15 $/mes. Sustituye a Make (~9–12 $/mes). `KIRA_MODEL` permite cambiar de modelo sin tocar código.

## 6. Lecciones aprendidas / trampas

- **Nunca crear una cita sin comprobar huecos reales.** Una vez se creó una cita solapada con otro cliente (Lux) porque no se miraron los eventos marcados "libre". Es la regla más importante del módulo de agenda.
- Las variables sensibles de Vercel son de solo escritura y se editan por entorno; al cambiar una, redesplegar. Tras reconectar el conector de Vercel puede dar 403 hasta que Blake lo vuelva a autorizar.
- `WebFetch` cachea ~15 min por URL. `list_deployment_events` y `web_fetch_vercel_url` dan 403. La lista de archivos de un despliegue trunca los grandes: el código fuente no se puede recuperar de Vercel; vive en GitHub.
- `sleep` en primer plano está bloqueado: usar ejecución en segundo plano.
- Blake pegó una vez el token del bot en el chat: se revocó. No volver a pedirle secretos por chat.
- Las columnas de tiempo de `event_log` y `security_events` se llaman `at` (no `created_at`).
- **Legacy no es un catálogo de servicios**: su `legacy_data` guarda lo que cada usuario calcula, y las **horas son un dato de entrada**, no un resultado. Su fórmula ha cambiado desde julio: los precios no coinciden con los de entonces.
- **Cada llamada a Legacy escribe en su base de datos.** No usar emails reales; no probar contra producción salvo que sea necesario.
- La dirección `*.vercel.app` de Legacy podría estar tras la protección de Vercel (SSO `all_except_custom_domains`): si Kira recibe un HTML de login o un 401/403, aparecerá en Fallos como «Legacy respondió …». No se pudo verificar desde la sesión de desarrollo (el proxy de salida bloquea ese dominio).
- En JavaScript sin la bandera `u`, `\b` no considera letra la `ó` de «autorizó»: no cerrar patrones con `\b` tras vocal acentuada. «dan» (verbo) ≠ «DAN» (jailbreak): el patrón es sensible a mayúsculas.
- Con `text-transform: uppercase`, `innerText` en Playwright devuelve el texto en mayúsculas.
- `pkill -f "texto"` desde un comando que contiene ese texto se mata a sí mismo. `next start` deja un hijo `next-server`: arrancarlo con `detached: true` y matar el grupo (`process.kill(-pid)`); los e2e se niegan a arrancar si el puerto está ocupado. No ejecutar `vitest --root /` (escanea todo el disco).
- PostgreSQL no arranca como root: para probar migraciones, `runuser -u postgres` en una carpeta fuera del scratchpad (que es privado de root).
- El Write de la herramienta convierte ` `/` ` en caracteres reales, que rompen un literal de regex: escribir esos escapes con Python.
- El modelo `claude-opus-5-5`: pensamiento siempre activo, esfuerzo por defecto `medium` (se pide `low`), sin `temperature`, sin prefill, sin `tool_choice` forzado. El pensamiento cuenta contra `max_tokens` (se dan 4000). No se usan los `fallbacks` del servidor a propósito: un rechazo del modelo sobre un mensaje de cliente es en sí mismo una señal, y se trata como derivación a Blake.

## 7. Cómo trabajar

- Comunicación en español, tono directo y breve; Blake no es programador: explicar qué ve y qué tiene que pulsar, paso a paso.
- Antes de cualquier acción irreversible o con coste (cobros, borrados, mensajes a clientes) → pedir confirmación.
- Probar con `npm test`, `npx tsc --noEmit`, `npm run build` y los e2e antes de desplegar. Orden de despliegue: **primero migraciones** (aditivas), **después código**. Verificar con `/api/health` en una URL no cacheada y, para Telegram, con `/prueba` o `/simular`.
- No tocar el repo `legacy` sin que Blake lo pida (es público y está desplegado).

## 8. Prueba en vivo con la clienta de referencia

Mensaje: «Hola! tengo el pelo por el hombro, quiero 6 trenzas con extensiones rojas, por las caderas, para el 20 de octubre a las 12pm. Mi correo es rosessblake@gmail.com».

1. Blake pone `ANTHROPIC_API_KEY` en Vercel (3 entornos) y se redespliega.
2. En Telegram: `/simular <el mensaje>`. Debe llegar una propuesta con 🧪 PRUEBA, sin precio y sin botón Aprobar, porque el mensaje no dice si son pegadas o sueltas.
3. Pulsar **Editar** y escribir `tipo pegadas`: aparece el precio de Legacy y el botón Aprobar.
4. Probar **Aprobar**, **Rechazar** (con otro `/simular`) y **Editar** con `precio 70`, `fecha 21/10 13:30`, etc.
5. En `/panel`: ver la conversación con *lo que Kira entendió*, el precio, los avisos y la línea de tiempo; revisar Fallos y Seguridad.
6. Las reservas de prueba (`is_test`) no bloquean huecos reales. Para limpiar filas de Legacy creadas por Kira: `delete from legacy_data where email = 'kira-interno@kira.invalid'`.
