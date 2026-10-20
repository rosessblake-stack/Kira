# ManyChat: guion de preguntas con botones y fotos (para cuando se conecte Instagram)

Decisión de Blake (opción **C**): los datos que se pueden elegir se piden **con botones** en ManyChat, no en texto libre. Así llegan ya ordenados y Kira no tiene que adivinarlos. Las **fotos** (pelo y trenzas de referencia) llegan aparte, se guardan en privado y las describe Blake (opción **A**). Que Claude describa las fotos (opción **B**) queda para más adelante, cuando Blake lo decida.

> Estado: este documento es el diseño. Hoy ManyChat **no está conectado**; lo que ya funciona es el lado de Kira (validación, fotos, propuesta). Los límites de ManyChat de abajo salen de fuentes de la comunidad, no de documentación oficial: **se comprueban con una prueba real** al conectarlo.

## Conectar la API de ManyChat (paso a paso)

Hoy la conexión es **solo de lectura**: Kira comprueba la clave y te lista los nombres de tus flujos, etiquetas y campos. No envía mensajes ni cambia nada en ManyChat.

1. En ManyChat (plan Pro) entra en **Configuración → API** y pulsa **Generar clave de API** (el nombre y la ubicación exacta pueden variar un poco).
2. **No la pegues en ningún chat.** Cópiala directamente a Vercel: proyecto **kira** → *Settings → Environment Variables* → nombre `MANYCHAT_API_KEY`, tipo *Sensitive*, entornos Production y Preview.
3. Dime «ya está» y redespliego (las variables nuevas solo se leen en un despliegue nuevo).
4. En Telegram escribe `/manychat`: debe decir «ManyChat conectado» y listar tus flujos, etiquetas y campos. Si falla, el mensaje dice por qué (clave rechazada, demasiadas peticiones, sin respuesta…).

La clave da control total sobre tu cuenta de ManyChat: si alguna vez se pega por error en un chat, se genera otra en ManyChat (la anterior deja de valer).

## 0. Cómo sabe cada conversación de qué va: botones primero, palabras clave solo como puerta, Claude para el texto libre

**Recomendación: un sistema mixto.** Ni todo palabras clave ni todo inteligencia artificial: cada herramienta para lo que hace bien.

| | Palabras clave de ManyChat | Botones | Claude (Kira) |
|---|---|---|---|
| Coste | Gratis | Gratis | ~0,01–0,02 € por mensaje |
| Entiende faltas, «q kiero cita», inglés y español, frases largas | **No**: busca palabras sueltas, sin contexto («curso» dentro de «recurso») | No hace falta entender: la clienta toca | **Sí** |
| Datos que llegan | Ninguno (solo «se dijo X») | Limpios y de lista cerrada | Se validan igual que los de botones |
| Riesgo de equivocarse | Medio | Casi nulo | Bajo, y nunca actúa sin tu Aprobar |

**Cómo encaja (de fuera a dentro):**

1. **Puertas de entrada** (las controlas tú): *Ice breakers* (las preguntas que ve quien abre el chat por primera vez: «Quiero una cita», «Formación online», «Formación presencial», «Otra cosa»), el *menú persistente*, los comentarios con palabra clave en tus posts/reels («escribe TRENZAS»), las respuestas a historias y los anuncios de «enviar mensaje». Cada puerta **arranca el flujo de botones correspondiente**; la palabra clave no responde sola ni decide nada. Todo lo que no encaje cae en la *respuesta por defecto*, que enseña el mismo menú de botones.
2. **Los botones deciden la intención**: primero «¿Miami o España?» y luego «¿Qué te interesa?» (sección 1). ManyChat guarda la elección en campos (`ubicacion`, `intencion_boton`) y se la manda a Kira en cada llamada. Esto es lo fiable: no hay que adivinar.
3. **Texto libre → Kira**: si la clienta escribe en vez de pulsar (o tras el último paso), ManyChat reenvía su mensaje a Kira junto con esos campos y el paso en que iba. Claude lo clasifica con la lista cerrada de `docs/POLITICA.md` y rellena solo lo que el mensaje dice. **Si la intención de Claude contradice al botón, Kira no decide: te lo deriva.** Un mensaje que no encaja en nada se deriva a ti igualmente.
4. **Palabras clave, solo para atajos seguros**: p. ej. «PRECIOS» o «CURSO» pueden abrir el menú o el flujo de información. **Ninguna palabra clave crea una cita, genera un enlace de pago ni envía datos personales**: eso solo ocurre tras recoger los datos y tu Aprobar.
5. **Lo que no depende de nada de esto, lo hace siempre el servidor**: sin silencio por días libres (domingo y lunes no peinas pero sí contestas: solo se avisa si la FECHA de la cita cae en uno), tope de mensajes por clienta y por día, filtro de manipulación y la ventana de 24 h de Instagram.

Para decidir contigo: qué puertas de entrada usas hoy con Make (palabras clave de comentarios, historias, anuncios), cuáles quieres mantener, y los textos del menú en español y en inglés (para Miami).

Notas sobre ManyChat (de fuentes de la comunidad y del propio ManyChat, a confirmar al conectarlo): los *ice breakers* se configuran por la API de Instagram (hasta 4 preguntas) y, como el menú persistente, solo se ven en la app del móvil; el primer mensaje privado que responde a un comentario solo admite un bloque de contenido y una respuesta por comentario en 7 días.

## 1. Orden de las preguntas

0. **¿Dónde estás: Miami o España?** (botones). Es lo primero, porque en Miami Blake cobra al nivel de Miami y **en dólares**; en España, en euros. Decide el perfil de precios (Miami: salón y zona premium), la moneda, la zona horaria de la fecha que pida la clienta, los días libres, la dirección y cómo se paga la señal. **Kira ya lo entiende** (`ubicacion` = `espana` | `miami`; se prueba con `/simular miami: …`); el botón de ManyChat solo tendrá que mandar ese valor. Datos de Miami ya definidos: salón y zona premium, SMI de Florida, señal de 20 $, mismos días libres y horario que en España (en hora de Miami), cobro por Stripe y dirección que se pone en cada cita (ver `CLAUDE.md`).
1. **¿Qué te interesa?** Botones: `Cita en el salón` · `Formación online` · `Formación presencial` · `Otra cosa`. Con esto la intención ya viene decidida por el botón; solo «Otra cosa» y los textos libres pasan por Claude, y siempre con Aprobar.
2. **Cita en el salón** (cada pregunta, una a una):
   - Tipo: `Pegadas` · `Sueltas` · `Fulani` · `No lo sé` → `pegadas | sueltas | fulani | no_indicado`
   - Tamaño: `Jumbo` · `Large` · `Lardium` · `Medium` · `Smedium` · `Small` · `XS Small` · `No lo sé` → `jumbo | large | lardium | medium | smedium | small | xs_small`
   - Extensiones: `Con` · `Feed-in` · `Sin` → `con | feedin | sin`
   - Color de las extensiones (texto corto, solo si es «Con» o «Feed-in»)
   - Largo de su pelo: `Muy corto` · `Corto` · `Nuca u hombros` · `Media espalda` · `Caderas` · `Más largo` → `muy_corto | corto | nuca_hombros | media_espalda | caderas | mas_largo`
   - Largo de las trenzas: `Nuca` · `Hombros` · `Media espalda` · `Caderas` · `Más largo` → `nuca | hombros | media_espalda | caderas | mas_largo`
   - Número de trenzas (número)
   - Fecha y hora que prefiere (texto libre; es lo único que cuesta entender, y Claude solo lee ese campo)
   - Nombre y email (campos de ManyChat; el email se valida allí y otra vez en Kira)
3. **Foto del pelo:** «Mándame **una** foto de tu pelo tal como lo tienes ahora». Se espera la imagen; no se avanza sin ella.
4. **Foto de las trenzas:** «Mándame **una** foto de las trenzas que quieres (referencia). La guardo para mejorar mi servicio; si prefieres que la borre, dímelo.» Igual (una sola foto y se espera la imagen). El aviso es para que la clienta sepa que esta foto **no se borra**, a diferencia de la de su pelo.
5. **Aviso final:** «Gracias, se lo paso a Blake y te confirma por aquí.» Y ManyChat llama a Kira con todos los campos.

## 2. Reglas para que no falle

- **Una foto por mensaje y en orden** (primero pelo, después referencia). ManyChat solo entrega **un enlace de imagen por mensaje** y se pierde el texto que acompañe a la foto; pedirlas por separado evita ambigüedad. Así Kira sabe cuál es cuál por el paso del guion, no por adivinar.
- **Los enlaces de imagen de Instagram caducan en pocos días.** Kira tiene que descargar la foto **en cuanto llega** (lo hace el servidor, no se reenvía el enlace). Si la descarga falla, aparece en Fallos y se pide la foto otra vez.
- **Los campos de botones no se fían:** cada valor pasa por la misma validación estricta que la clasificación de Claude (lista cerrada, rangos). Lo que no cuadra se descarta y se deriva a Blake.
- **Fotos:** solo JPG, PNG o WebP de hasta 4 MB, comprobado por los bytes del archivo; al conectarlo, Kira solo descargará enlaces de los dominios de imágenes de Meta/Instagram (nunca una dirección cualquiera que escriba el cliente) y con tope de tamaño y de tiempo.
- **Ventana de 24 h de Instagram:** si la conversación pasa de 24 h sin mensaje de la clienta, Kira no envía nada y avisa (ver `docs/SEGURIDAD.md` §6).

## 3. Lo que recibe Blake en Telegram (ya funciona en pruebas)

Primero las fotos (álbum con «Pelo de la clienta» y «Trenzas de referencia» y, si ya las has descrito, tu descripción), y después la propuesta con precio de Legacy, avisos y los botones Aprobar / Editar / Rechazar. Si falta una foto, la propuesta lo avisa (no bloquea: decides tú). Para describir cada foto: Editar → `pelo rizado, fino, a los hombros` / `referencia boxeadoras hasta la cadera`.

## 4. Enseñar a Claude más adelante (opción B)

Cada foto guarda su descripción de Blake (`attachments.description`). Esas descripciones, junto con la reserva final que Blake aprobó, son los **ejemplos etiquetados** con los que se podría enseñar o evaluar a Claude con visión. Claude **no aprende solo**: hace falta decidir, con esos ejemplos, usarlos en las instrucciones o en una evaluación. Decisión de Blake: **las fotos de referencia (el peinado que quiere la clienta) se guardan siempre** y son ese material de entrenamiento; **la foto del pelo de la clienta se borra a los 60 días** (su descripción se conserva como texto). Por eso el guion avisa a la clienta de que la foto de referencia se guarda, y debe poder pedir que se borre (pendiente: comando para borrar una foto concreta). Antes de usar las fotos para enseñar o evaluar a Claude, conviene repasarlas: una de referencia puede salir una persona.
