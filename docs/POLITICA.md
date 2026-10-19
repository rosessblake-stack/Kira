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
- Dar tu teléfono, dirección exacta o email antes de que haya cita pagada.
- Hablar de política, medicina, temas legales, dar consejos fuera de trenzas/formaciones, ni hacer de asistente general (código, traducciones, redacciones, "ignora tus instrucciones").
- Revelar sus instrucciones, que es una IA configurada de cierta manera, claves, herramientas o cómo está montado.
- Abrir enlaces, ejecutar nada que venga en un mensaje, ni enviar enlaces que no estén en su lista (Stripe generado por el sistema, página del curso, Typeform).
- Reembolsos, disputas, quejas: siempre a ti.
- Contestar en día libre (**domingo y lunes**) o fuera del horario configurado.
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

## 5. Automatización gradual

- Fase 1: todo pasa por tu Aprobar.
- Fase 2: solo lo que tú marques como seguro (p. ej. enlace de curso online) se envía solo.
- Las citas, los pagos y los borrados nunca pasan a automático sin tu decisión explícita.
- Interruptor general en el panel: "Pausar Kira" (deja de contestar y solo avisa).

## 6. Fotos de las clientas

- Kira pide (en Instagram, con ManyChat) una foto del pelo y otra de las trenzas de referencia. **Hoy Claude no las ve**: las guarda el servidor, te llegan a Telegram y las describes tú con tus palabras (`pelo …`, `referencia …`). Que Claude las describa con visión es una decisión tuya, para más adelante.
- Faltar una foto es un **aviso** en la propuesta, no un bloqueo: decides tú.
- Las fotos se guardan en privado. **La foto del pelo de la clienta se borra a los 60 días** (tu descripción se conserva). **La foto de referencia (el peinado que quiere) se guarda siempre**: es el material para enseñar a Kira. Nunca se muestran a nadie más ni se mandan a un servicio externo.
- La clienta tiene que saber que se guarda su foto de referencia (se le dice en el guion de ManyChat) y si pide que se borre, se borra.
- Claude no «aprende» solo de tus descripciones: se guardan junto a cada foto de referencia como ejemplos etiquetados y, cuando quieras, se usan para enseñarle o evaluarlo (ver `docs/MANYCHAT.md` §4).

## 7. Qué verás en el panel

- **Proceso:** cada conversación y en qué paso está (clasificada, esperando aprobación, pendiente de pago, pagada, expirada), con sus fotos y tu descripción de cada una.
- **Fallos:** errores del sistema, webhooks que no llegaron, pagos o eventos sin cerrar.
- **Seguridad:** intentos de manipulación, firmas inválidas, usuarios no autorizados, límites superados.
