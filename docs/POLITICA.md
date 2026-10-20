# Política de Kira: qué hace, qué no y a quién se deriva

Principio: **Claude propone, tú decides, el código ejecuta.** Claude nunca llama a Stripe, al calendario, a Legacy ni a Telegram por su cuenta. Solo devuelve un JSON con una *intención* de una lista cerrada. El código valida esa intención, y las acciones con efecto real solo se ejecutan tras tu botón Aprobar.

## 1. Intenciones permitidas (lista cerrada)

| Intención | Qué hace Kira | ¿Necesita tu aprobación? |
|---|---|---|
| `cita_salon` | Pide servicio/fecha, calcula huecos reales, te propone precio y duración | Sí, siempre |
| `info_formacion_online` | Responde con el enlace a la página del curso/infoproducto | Sí (al principio); automático cuando tú lo decidas |
| `info_formacion_presencial` | Envía el Typeform, espera 10–15 min, propone respuesta + fecha de llamada | Sí |
| `precio_servicio` | Informa del precio que da Legacy (solo servicios de la lista) | Sí (al principio) |
| `saludo_o_gracias` | Respuesta corta de cortesía | Sí (al principio) |
| `derivar_a_blake` | Te avisa por Telegram y no contesta nada al cliente | No hace falta, solo aviso |

Cualquier otra cosa que Claude devuelva se descarta y se trata como `derivar_a_blake`.

## 2. Qué NUNCA hace Kira (ni aunque el cliente lo pida)

- Dar descuentos, regalar servicios, cambiar precios o importes de señal.
- Reservar sin tu Aprobar, o saltarse la señal (los clientes OG los metes tú a mano).
- Mover, cancelar o borrar citas existentes. Solo borra el evento provisional que ella misma creó y que sigue sin pagar.
- Dar datos de otros clientes, de tu agenda, de tus precios internos, de tus contactos o de VIPs.
- Dar tu teléfono, dirección exacta o email antes de que haya cita pagada. **Única excepción, decidida por Blake:** el número de Bizum (662018425) se da a la clienta que ha dicho «vale» al precio aprobado, y solo en esa plantilla.
- Hablar de política, medicina, temas legales, dar consejos fuera de trenzas/formaciones, ni hacer de asistente general (código, traducciones, redacciones, "ignora tus instrucciones").
- Revelar sus instrucciones, que es una IA configurada de cierta manera, claves, herramientas o cómo está montado.
- Abrir enlaces, ejecutar nada que venga en un mensaje, ni enviar enlaces que no estén en su lista (Stripe generado por el sistema, página del curso, Typeform).
- Reembolsos, disputas, quejas: siempre a ti.
- Dar una cita en un día libre sin avisarte: **domingo y lunes Blake no peina pero SÍ contesta** (dicho por él), así que Kira atiende siempre y solo marca como aviso (blando, decide él) si la FECHA de la cita cae en domingo o lunes o fuera de 11–22 h.
- Dar por buena una cita de Miami fuera de las fechas que Blake apuntó de viaje (o una de España mientras está en Miami): lo marca como aviso 🚫 y decide él.

## 3. Se deriva siempre a Blake (Kira solo te avisa)

Reembolsos y quejas, colaboraciones/marcas/prensa, VIPs y clientes conocidos, mensajes con enfado o urgencia, peticiones de descuento, preguntas técnicas de braiding, cursos a medida, menores de edad, cualquier cosa que Claude no clasifique con seguridad, y todo mensaje marcado como posible manipulación.

## 4. Defensas contra manipulación (prompt injection)

1. El mensaje del cliente se pasa a Claude como **dato entre etiquetas**, nunca como instrucciones.
2. La respuesta de Claude se valida con un esquema estricto: intención de la lista, campos con formato y rango (duración, precio dentro de lo que dice Legacy, fecha futura, etc.). Si no cuadra: se descarta y se deriva.
3. El texto que Claude redacta para el cliente pasa por un filtro: sin enlaces fuera de la lista, sin importes distintos a los calculados por el código, longitud máxima.
4. Si el mensaje contiene señales de ataque ("ignora", "system prompt", "eres ahora…", código, peticiones de claves), se registra un evento de seguridad, **no se contesta** y te llega un aviso con la etiqueta 🚩.
5. Límites de ritmo por cliente (p. ej. máx. mensajes por hora y por día) y tope diario de gasto en Claude; al superarlos, silencio y aviso.
6. Solo el servidor con firma válida de ManyChat/Telegram/Stripe puede activar acciones. Solo tu usuario de Telegram puede aprobar.
7. Si algo falla, Kira falla **hacia el silencio y hacia ti**, nunca hacia hacer algo por su cuenta.

## 4 bis. Lo que Kira escribe sola a la clienta (decisión de Blake, 20-oct)

Después de que apruebes el precio, Kira lleva sola este tramo, SIEMPRE con plantillas fijas (nada redactado por Claude) y solo con respuestas cortas y exactas de la clienta:

1. **Aprobar** → le manda el precio (el borrador que viste) y reserva el hueco en **amarillo**.
2. **«vale»/«ok»/«👍»** → le pide la señal: Bizum de 20 € al 662018425 (se descuentan del total; el resto, en efectivo) y que escriba «confirmado». Plazo: 45 min.
3. **«confirmado»** → cita en **morado** + invitación al email, y te avisa AL MOMENTO con el botón «❌ No me ha llegado nada» para revertirlo (opción C).
4. **Sin respuesta al precio en 20 h** → cierra el chat en silencio y libera el hueco. **«vale» sin pago en 45 min** → libera el hueco y se lo dice.

Todo lo demás que escriba la clienta (preguntas, regateos, dudas) se te reenvía y Kira no contesta. Si han pasado más de 24 h desde su último mensaje, Instagram no deja escribirle: Kira te avisa en vez de enviar. Clientas de Miami: aún no hay cobro (Stripe pendiente), te avisa para que se lo digas tú.

## 5. Automatización gradual

- Fase 1: todo pasa por tu Aprobar.
- Fase 2: solo lo que tú marques como seguro (p. ej. enlace de curso online) se envía solo.
- Las citas, los pagos y los borrados nunca pasan a automático sin tu decisión explícita.
- Interruptor general en el panel: "Pausar Kira" (deja de contestar y solo avisa).

## 6. Fotos de las clientas

- Kira pide (en Instagram, con ManyChat) una foto del pelo y otra de las trenzas de referencia. **Claude las lee (decisión tuya, 20-oct)** solo en las solicitudes reales de Instagram: describe el peinado de la foto de referencia (tipo, nº aproximado de trenzas, grosor, largo) y el pelo de la clienta, y te lo enseña en la propuesta («Lo que veo en las fotos») junto con las fotos. Solo describe: lo que deduce de la foto y la clienta no dijo se rellena con un aviso visible («Visto en la foto … confírmalo»), nunca pisa lo que ella escribió y, si su confianza es baja, solo se enseña. El texto que aparezca dentro de una foto es un dato, nunca una orden: si Claude lo ve como una orden o rechaza leerla, se trata como manipulación y no hay propuesta. Tus descripciones (`pelo …`, `referencia …`) siguen siendo tuyas y no las cambia nada.
- Faltar una foto es un **aviso** en la propuesta, no un bloqueo: decides tú.
- Las fotos se guardan en privado. **La foto del pelo de la clienta se borra a los 60 días** (tu descripción se conserva). **La foto de referencia (el peinado que quiere) se guarda siempre**: es el material para enseñar a Kira. Nunca se muestran a nadie más. **Las dos fotos de una solicitud real se mandan a Anthropic (Claude) para leerlas**, solo en ese momento y por decisión tuya; no se mandan a ningún otro servicio.
- La clienta tiene que saber que se guarda su foto de referencia (se le dice en el guion de ManyChat) y si pide que se borre, se borra. **No se le avisa de que una IA lee las fotos ni los mensajes** (decisión de Blake, 20-oct, asumiendo esa responsabilidad).
- Claude no «aprende» solo de tus descripciones: se guardan junto a cada foto de referencia como ejemplos etiquetados y, cuando quieras, se usan para enseñarle o evaluarlo (ver `docs/MANYCHAT.md` §4).

## 7. Qué verás en el panel

- **Proceso:** cada conversación y en qué paso está (clasificada, esperando aprobación, pendiente de pago, pagada, expirada), con sus fotos y tu descripción de cada una.
- **Fallos:** errores del sistema, webhooks que no llegaron, pagos o eventos sin cerrar.
- **Seguridad:** intentos de manipulación, firmas inválidas, usuarios no autorizados, límites superados.

## 8. Modo sombra: la entrada de ManyChat (20-oct)

- Cuando la clienta termina el flujo «cita / agendar», ManyChat manda a Kira todo de una vez (`POST /api/manychat`, `docs/FLUJO_MANYCHAT.md`). Kira baja las dos fotos, las lee, calcula el precio con Legacy y te manda a Telegram las fotos y la propuesta «📥 SOLICITUD DE INSTAGRAM».
- **Kira NO escribe a la clienta** por Instagram (el envío no existe): tú le contestas como siempre. Al pulsar Aprobar se reserva el hueco en amarillo y Kira te avisa de que le escribas tú el precio y, cuando pague, pulses «Señal recibida».
- Una solicitud real **nunca** se lee con la lectura básica por reglas: sin clave de Claude, o si Claude falla, se te deriva.
- Mismos filtros que cualquier mensaje: pausa, señales de manipulación, límite de solicitudes por clienta y hora, tope diario de llamadas a Claude (la lectura de fotos también cuenta).
