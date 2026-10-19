# ManyChat: guion de preguntas con botones y fotos (para cuando se conecte Instagram)

Decisión de Blake (opción **C**): los datos que se pueden elegir se piden **con botones** en ManyChat, no en texto libre. Así llegan ya ordenados y Kira no tiene que adivinarlos. Las **fotos** (pelo y trenzas de referencia) llegan aparte, se guardan en privado y las describe Blake (opción **A**). Que Claude describa las fotos (opción **B**) queda para más adelante, cuando Blake lo decida.

> Estado: este documento es el diseño. Hoy ManyChat **no está conectado**; lo que ya funciona es el lado de Kira (validación, fotos, propuesta). Los límites de ManyChat de abajo salen de fuentes de la comunidad, no de documentación oficial: **se comprueban con una prueba real** al conectarlo.

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
