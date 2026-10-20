# Flujo de ManyChat «cita / agendar» — versión corregida (paso a paso)

Se parte del flujo actual de Blake **sin cambiar sus textos** (a la clienta le suenan a él). Se trabaja sobre una **copia** y no se toca el original hasta que la copia esté probada.

## 0. Antes de empezar

1. **Duplicar el flujo.** En la lista de flujos, en el flujo cuyo disparador es «cita / agendar»: menú ⋯ → *Duplicar*. A partir de aquí se edita **la copia**. El original sigue funcionando.
2. **Campos personalizados** (Configuración → Campos personalizados):
   - Crear **`Fecha_texto`** (tipo Texto).
   - Ya existen y se usan: `Nombre`, `Referencia_Diseño`, `Estado_Cabello`, `uso_extensiones`, `color_extensiones`, `Largo_trenzas`, `pais de cliente`.
   - **`Fecha y Hora`** (tipo fecha): se deja de usar.
   - **`Clor_extensiones`** (con errata): comprobar en la copia que el bloque «¿Qué color de extensiones…?» guarda en `color_extensiones`; si es así, borrar `Clor_extensiones`.
3. **Etiquetas:** crear **`Esperando_Kira`** y **`Error_Kira`**. Ya existen: `En_proceso_reserva`, `Lugar Cliente`, `Foto_Recibida`.

## 1. Bloques, en orden

| # | Bloque | Qué hace | Siguiente |
|---|---|---|---|
| **B0** | Disparador | «El usuario envía un mensaje que contiene **cita** o **agendar**» (igual que ahora) | B1 |
| **B1** | **Condición NUEVA** | Si la etiqueta **`Esperando_Kira`** está puesta → mensaje: «Tu solicitud ya está en revisión 🖤 Te escribo en cuanto la valore.» y **FIN** (sin siguiente paso). Si no → | B2 |
| **B2** | Condición | Si **`En_proceso_reserva`** está puesta → su mensaje de siempre («Tu diagnóstico de trenzas está en proceso. Responde la información pendiente.») y **FIN**. Quitar de ese camino la acción «Assign conversation: Unknown user». Si no → | B3 |
| **B3** | Acción | **Añadir etiqueta `En_proceso_reserva`** (esto es lo que a España le faltaba) | B4 |
| **B4** | Mensaje | «¿Estás en Miami o España?» con los botones **Miami** / **España**. **Guardar la respuesta en el campo `pais de cliente`**. Acción al responder: añadir etiqueta `Lugar Cliente` | B5 |
| **B5** | Condición | Si `pais de cliente` es **Miami** → mensaje «Estaré disponible en Miami hacia Diciembre. Antes de empezar, responde las siguientes preguntas y haremos un mejor servicio.» (y luego a B6). Si no (España) → directo a B6 | B6 |
| **B6** | Mensaje **NUEVO** | «¿Con qué nombre te anoto?» Esperar **texto** → guardar en **`Nombre`** | B7 |
| **B7** | Mensaje | El de ahora: «Para saber qué deseas en tu servicio. Adjunta la fotografía del estilo exacto que deseas realizarte. (Imagen que permanezca en el chat, no temporales)». Esperar **imagen** → guardar en **`Referencia_Diseño`**. Al responder: etiqueta `Foto_Recibida` | B8 |
| **B8** | Mensaje | El de ahora: «Recibido. Adjunta una foto del estado actual de tu cabello. Así podré analizar largura y color del mismo.» Esperar **imagen** → guardar en **`Estado_Cabello`** | B9 |
| **B9** | Mensaje | El de ahora: «Ahora necesitaré saber si quieres o no usar extensiones en tu servicio» con **SI / NO** → guardar en **`uso_extensiones`** | B10 |
| **B10** | Condición | Si `uso_extensiones` es **SI** → B11. Si no → B12 | |
| **B11** | Mensaje | El de ahora: «¿Qué color de extensiones tienes en mente o cuál es tu base actual? Así podré asegurar la disponibilidad del material técnico. (Solo dime el color)». Esperar **texto** → guardar en **`color_extensiones`** | B12 |
| **B12** | Mensaje | El de ahora: «¿Cuál sería el largo deseado, por donde quisieras que lleguen tus trenzas?» con **Nuca / Media espalda / Cintura / Debajo del culo** → guardar en **`Largo_trenzas`** | B13 |
| **B13** | Mensaje | «Dime tu fecha y hora ideal para tu cita. (La disponibilidad final será confirmada personalmente tras evaluar la complejidad técnica de tu diseño).» Esperar **texto** → guardar en **`Fecha_texto`** (**no** en `Fecha y Hora`) | B14 |
| **B14** | Mensaje | El de ahora: «Antes de continuar, necesito tu correo, por si confirmamos el servicio, poder generar tu cita posteriormente.» Esperar **email**. **Quitar** de su acción la línea «Set User Field: Fecha y Hora → Fecha y Hora» y el «Notify Assignees» | B15 |
| **B15** | Acción | **Quitar** etiqueta `En_proceso_reserva` · **Añadir** etiqueta **`Esperando_Kira`** | B16 |
| **B16** | **Solicitud externa NUEVA** | Ver el apartado 2. Si falla (rama de error) → añadir etiqueta `Error_Kira` | B17 |
| **B17** | Mensaje | El «Expediente recibido con éxito, {nombre}…» de ahora. Se puede **quitar** la última frase («No vuelvas a escribir "cita"…»): ya no hace falta | B18 |
| **B18** | **Pausa NUEVA** | «Smart Delay» de **23 horas** y después **quitar la etiqueta `Esperando_Kira`** (así, pasado ese tiempo, la clienta puede empezar otra solicitud) | FIN |

## 2. El bloque «Solicitud externa» (B16)

- **Tipo:** `POST`
- **URL:** `https://kira-virid-eight.vercel.app/api/manychat`
- **Cabeceras:**
  - `Content-Type`: `application/json`
  - `x-kira-secret`: **una clave larga al azar que eliges tú** (30 o más caracteres, de un generador de contraseñas). **La misma** que se pone en Vercel como variable `MANYCHAT_WEBHOOK_SECRET`. No se pega en ningún chat.
- **Cuerpo:** lo más fácil es elegir la opción de enviar **todos los datos del contacto** (*Full contact data*), que incluye campos personalizados, etiquetas, email y usuario de Instagram. Si esa opción no existe en tu pantalla, usa un JSON con estas claves (los valores se insertan con el selector de campos de ManyChat):
  ```json
  {
    "id": "<ID del contacto>",
    "ig_username": "<usuario de Instagram>",
    "email": "<email>",
    "Nombre": "<campo Nombre>",
    "pais de cliente": "<campo pais de cliente>",
    "Referencia_Diseño": "<campo Referencia_Diseño>",
    "Estado_Cabello": "<campo Estado_Cabello>",
    "uso_extensiones": "<campo uso_extensiones>",
    "color_extensiones": "<campo color_extensiones>",
    "Largo_trenzas": "<campo Largo_trenzas>",
    "Fecha_texto": "<campo Fecha_texto>"
  }
  ```
  Kira entiende las dos formas y no distingue mayúsculas, acentos ni espacios en los nombres.

## 3. Recordatorios y abandonos (lo que ya tienes, con dos retoques)

- Cada paso que espera respuesta mantiene su camino «si el contacto no responde»: pausa de 15 min → recordatorio → pausa de 23 h → «Vi que se te olvidó acabar de rellenar todo…». **Todos esos caminos deben terminar quitando `En_proceso_reserva`** (como ahora), y **nunca** poner `Esperando_Kira`.
- En el recordatorio de la fecha, cambiar «Selecciona tu fecha en el calendario de arriba…» por: «Veo que la planificación de tu diseño quedó a medias. La agenda para trenzas es limitada. Escríbeme tu fecha y hora ideal para que pueda valorar tu caso personalmente 🙂🖤».
- La condición de las 23 h de la fecha pasa a mirar **`Fecha_texto` está vacío** (en vez de `Fecha y Hora`).

## 4. Probarlo (con una cuenta de Instagram de prueba)

1. Poner `MANYCHAT_WEBHOOK_SECRET` en Vercel (Production y Preview) con la misma clave de la cabecera. Redesplegar.
2. Publicar la copia **sin** quitar todavía el original (la copia de pruebas puede usar otra palabra clave, p. ej. «citaprueba»).
3. Desde la cuenta de prueba, escribir la palabra clave y completar el flujo con fotos reales.
4. En menos de un minuto debe llegar a Telegram: las dos fotos y un mensaje **«📥 SOLICITUD DE INSTAGRAM (modo sombra)»** con la lectura de la foto, el precio y los botones. **Kira no contesta a la clienta** (modo sombra): tú le respondes como siempre.
5. Si no llega nada: mirar en ManyChat la etiqueta `Error_Kira` y, en el panel de Kira, Fallos.
6. Para repetir la prueba, quitar a mano las etiquetas `Esperando_Kira` y `En_proceso_reserva` del contacto de prueba.

## 5. Pasar al flujo nuevo

1. En el flujo **original**, quitar (o cambiar) las palabras clave de su disparador.
2. En la **copia**, poner las palabras clave «cita» y «agendar».
3. Publicar. Probar una vez más con la cuenta de prueba.
4. Dejar el original guardado unos días por si hay que volver atrás.
