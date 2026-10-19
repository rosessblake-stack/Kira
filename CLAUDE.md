# Kira — Traspaso para Claude Code

Proyecto de Blake (trenzador profesional en España, habla español; responde siempre en español). Ecosistema propio de automatización ("Kira") sobre Vercel + Supabase que sustituye a Make. Incluye un panel para ver proceso, fallos y seguridad.

**Regla de oro: Claude propone, Blake decide, el código ejecuta.** Lee `docs/SEGURIDAD.md` y `docs/POLITICA.md` antes de tocar nada. No se saltan.

## 1. Objetivo del producto

Flujo: DM de Instagram → ManyChat → servidor Kira → Claude clasifica y redacta → Telegram a Blake con botones (Aprobar / Editar / Rechazar) → según el caso:

- **Cita de salón:** precio y horas desde Legacy (su app de precios) → reserva provisional amarilla en Google Calendar → enlace de Stripe de "paga y señal" (10–20 €, lo elige Blake) → plazo de 10 min; si no paga, se borra el evento provisional; si paga, el evento pasa a morado y se añade el email del cliente. Clientes OG/conocidos: los reserva Blake a mano (sin email ni señal).
- **Formación online / infoproducto:** enviar enlace de la página.
- **Formación presencial:** enviar Typeform, esperar 10–15 min, responder y proponer fecha de llamada.

Reglas de agenda (blandas, decide siempre Blake): horario 11:00–22:00; inicio desde 8:00 para servicios de más de ~6 h; margen mínimo 1 h entre citas (puede ser menor en servicios fáciles); la alerta de Telegram debe mostrar las citas contiguas (tipo/duración/margen) y etiquetas cuando un hueco rompe una regla. Días libres: no se contesta (configurable; **pendiente preguntar a Blake qué días no trabaja**).

## 2. Stack e identificadores (no son secretos)

- Next.js 16 App Router (TypeScript), React 19, vitest. Código en `/home/claude/blake-reservas`.
- **Vercel:** equipo `legacycalculator` (`team_frYYbu3HpiTVVB1uyfBIxDC9`), proyecto `kira` (`prj_IRGik57tCAIKHBIr5lIm2MnNYcEy`), región dub1. Producción: `https://kira-virid-eight.vercel.app` (alias también `kira-legacycalculator.vercel.app`). Protección SSO desactivada (Telegram debe poder llamar); al construir el panel, protegerlo con login propio.
- **Supabase:** proyecto "Kira", ref `nkrzngvaftmxzlitivgy`, eu-west-1, Postgres 17.
- **Bot de Telegram:** @KiracitasBot. Admin único: user_id `1547856536` (Blake).
- Variables de entorno en Vercel (todas sensibles salvo URL; **solo escritura**, no se pueden leer): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_USER_ID`. Cada variable tiene una fila por entorno (production/preview/development): hay que editar las tres. Un cambio de variable exige **redesplegar**.
- Nunca pegar secretos en el chat, ni en código, ni en logs. Si un secreto pasa por una conversación, rotarlo.

## 3. Lo que ya está hecho

- **Base de datos** (`supabase/migrations/0001_init.sql`, aplicada como `init_reservas`): `conversations`, `messages`, `bookings` (con restricción de exclusión `bookings_no_overlap` contra solapes en estados activos), `scheduled_jobs` + `claim_due_jobs()` (FOR UPDATE SKIP LOCKED, para el temporizador de 10 min con cron cada minuto), `processed_webhooks` (idempotencia por proveedor+id), `event_log`, `security_events`. Tablas de auditoría solo-añadir (trigger `forbid_mutation`). RLS activado sin políticas, permisos revocados a anon/authenticated y concedidos explícitamente a service_role. Probado en Postgres temporal.
- **Estados de reserva:** propuesta → aprobada → pendiente_pago → pagada | expirada | cancelada.
- **Telegram operativo:** `app/api/telegram/route.ts` + `lib/telegram-handler.ts` (verifica cabecera secreta → 401 y evento de seguridad si falla; idempotencia; solo chats privados; solo admin; `/start`, `/prueba` con botones de un solo uso y nonce emitido; usuarios ajenos → `telegram_no_autorizado`). 22 tests en `tests/telegram-handler.test.ts` (pasan).
- **Otras rutas:** `/api/health` (estado de Supabase, bot, webhook y presencia de variables, sin secretos), `/api/setup?key=<secreto>` (registra el webhook), páginas mínimas.
- **Seguridad de cabeceras** en `next.config.mjs` (DENY frames, nosniff, no-referrer, no-store en /api).
- **Despliegue en producción verificado:** bot responde, webhook registrado (0 pendientes), usuario admin reconocido. Prueba real de `/prueba` + botón Aprobar OK (registrada en `event_log` como `prueba_enviada` y `prueba_boton`).
- **Rotaciones hechas hoy:** token del bot (revocado y sustituido) y secreto del webhook (nuevo, webhook re-registrado). Falta la prueba final `/prueba` con las claves nuevas (Blake la está haciendo).
- **Documentos:** `docs/SEGURIDAD.md` (reglas de seguridad y disponibilidad) y `docs/POLITICA.md` (intenciones permitidas, prohibidas, derivaciones, defensas anti-manipulación, automatización gradual).

## 4. Pasos que faltan (orden acordado)

1. **Panel** (siguiente, lo pidió Blake primero): login solo para Blake; pestañas **Proceso** (conversaciones y su paso), **Fallos** (errores, webhooks perdidos, pagos/eventos sin cerrar), **Seguridad** (eventos de `security_events`, intentos de manipulación, límites superados); interruptor **Pausar Kira**. Re-activar protección de Vercel o auth propia en estas rutas. Datos solo con service_role desde el servidor.
2. **Motor de intenciones** según `docs/POLITICA.md`: Claude devuelve JSON con intención de lista cerrada; validar con esquema estricto; mensaje del cliente como dato (anti prompt-injection); filtro de salida (sin enlaces fuera de lista ni importes que no calcule el código); límites de ritmo por cliente y tope diario de gasto; derivar a Blake ante duda. Requiere `ANTHROPIC_API_KEY` en Vercel (la pone Blake).
3. **ManyChat/Instagram:** webhook firmado hacia el servidor, respuesta de vuelta por ManyChat; respetar la ventana de 24 h de Instagram.
4. **Formación online/infoproducto** (enlace de página) y **presencial** (Typeform, espera 10–15 min con `scheduled_jobs`, respuesta + fecha de llamada).
5. **Cita de salón:**
   - Precios/horas desde Legacy (repo `rosessblake-stack/legacy`; decidir entre su API o Supabase Legacy-Data).
   - Google Calendar con credenciales OAuth propias.
   - Disponibilidad: leer TODOS los eventos (también los marcados "libre"/transparent), usar la hora de fin real, respetar horario y márgenes, comprobar antes de crear y apoyarse en `bookings_no_overlap`.
   - Convenciones del evento: título `Trenzas [Nombre]`; descripción `tipo servicio\ncon/sin extensiones (color)\n\nprecio€\n@instagram`; ubicación Carrer de la Duquessa de la Victòria, 16; recordatorio emergente 60 min; **sin Google Meet**; colorId 5 amarillo = sin señal, colorId 3 morado = reservado/pagado.
   - Borrar solo eventos con `calendar_event_id` guardado.
   - Stripe: sesión de pago de la señal (10–20 €), cancelar la sesión de checkout a los 10 min, webhook de Stripe con verificación de firma e idempotencia, al pagar pasar a morado y añadir email.
   - Cron cada minuto (Vercel Cron) que ejecute `claim_due_jobs()` para expiraciones.
6. **Revisión de seguridad completa** y automatización gradual (fase 1: todo con Aprobar; fase 2: solo lo que Blake marque como seguro; citas, pagos y borrados nunca automáticos sin su decisión explícita).

## 5. Coste estimado (para informar a Blake)

~0,10 € por consulta de automatización + comisión Stripe (0,40–0,65 €, solo si se cobra). ManyChat Pro ~15 $/mes. Sustituye a Make (~9–12 $/mes).

## 6. Lecciones aprendidas / trampas

- **Nunca crear una cita sin comprobar huecos reales.** Una vez se creó una cita solapada con otro cliente (Lux) porque no se miraron los eventos marcados "libre". Se borró a petición de Blake. Es la regla más importante del módulo de agenda.
- Las variables sensibles de Vercel son de solo escritura y se editan por entorno; al cambiar una, redesplegar. Tras reconectar el conector de Vercel puede dar 403 hasta que Blake lo vuelva a autorizar.
- `WebFetch` cachea ~15 min por URL: usar otro alias para datos frescos. `list_deployment_events` y `web_fetch_vercel_url` dan 403.
- `sleep` en primer plano está bloqueado en el shell de Claude: usar ejecución en segundo plano.
- Blake pegó una vez el token del bot en el chat: se revocó. No volver a pedirle secretos por chat; que los ponga solo en Vercel.
- Las columnas de tiempo de las tablas se llaman `at` (no `created_at`).

## 7. Cómo trabajar

- Comunicación en español, tono directo y breve; Blake no es programador: explicar qué ve y qué tiene que pulsar, paso a paso.
- Antes de cualquier acción irreversible o con coste (cobros, borrados, mensajes a clientes) → pedir confirmación.
- Probar con `npm test` y `next build` antes de desplegar; verificar con `/api/health` en una URL no cacheada y, para Telegram, con `/prueba`.
