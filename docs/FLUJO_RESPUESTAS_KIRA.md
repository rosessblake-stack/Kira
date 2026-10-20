# Que Kira conteste a la clienta por Instagram (paso a paso)

Con esto, la clienta recibe el precio, dice «vale», recibe el Bizum, escribe «confirmado» y tú recibes el aviso. **Tú sigues decidiendo con tus botones.**

## Cómo funciona
| Paso | Quién | Qué pasa |
|---|---|---|
| 1 | Clienta | Termina el flujo «cita» → Kira te manda la propuesta |
| 2 | **Tú** | Pulsas **Aprobar** |
| 3 | **Kira** | Le escribe a la clienta: servicio, precio, duración, fecha y señal. Hueco en 🟡 amarillo |
| 4 | Clienta | Responde «vale» (u «ok», «sí», 👍…) |
| 5 | **Kira** | Le manda el Bizum de 20 € al número que tú has guardado y le dice que escriba «confirmado» (45 min) |
| 6 | Clienta | Hace el Bizum y escribe «confirmado» |
| 7 | **Kira** | A la clienta: «Lo compruebo y te confirmo». **A ti: dos botones**, «✅ Sí, me ha llegado» y «❌ No me ha llegado». **No confirma nada sola** |
| 8a | **Tú** | Miras tu banco. **«Sí, me ha llegado»** → cita en 💜 morado + invitación + «¡Confirmado!» a la clienta |
| 8b | **Tú** | **«No me ha llegado»** → Kira borra el evento, libera el hueco y le dice «Todavía no me consta el Bizum…» |
| 9 | Clienta | Si luego escribe «hecho» o «ya lo tengo», Kira vuelve a reservar su hueco y **te pregunta otra vez** con los dos botones (sin que crees la cita a mano). Si el hueco ya está ocupado, te avisa |

Cualquier otra cosa que escriba la clienta (una pregunta, una duda) **no se contesta sola**: Kira te la reenvía a Telegram y le respondes tú.

## Lo que hace falta
1. **Interruptor.** En Telegram, escribe `/responder on`. Para volver al modo sombra: `/responder off`. `/responder` solo te dice cómo está. **Por defecto está apagado.**
2. **La clave de la API de ManyChat** (`MANYCHAT_API_KEY`) ya está puesta en Vercel.
3. **El número de Bizum** guardado con `/bizum 662018425`.
4. **Un flujo en ManyChat que reenvíe a Kira lo que escribe la clienta** (esto es lo que falta montar, abajo).

## El flujo de ManyChat «Respuestas a Kira»
Es la respuesta predeterminada de ManyChat: solo se activa cuando la clienta escribe algo **que no encaja con ningún otro flujo**.

1. En ManyChat: **Automatización → Respuesta predeterminada** (*Default Reply*). Edítala.
2. Primer bloque: una **Condición**. Si el contacto tiene la etiqueta **`esperando_kira`** → sigue. Si no → no hagas nada (deja ese camino sin conectar).
3. Detrás, una **Acción → Solicitud externa**, igual que la de la solicitud, pero con otra dirección:
   - **Método:** `POST`
   - **URL:** `https://kira-virid-eight.vercel.app/api/manychat/respuesta`
   - **Cabecera 1:** Key `Content-Type`, Value `application/json`
   - **Cabecera 2:** Key `x-kira-secret`, Value tu clave larga (la misma de siempre)
   - **Cuerpo, añadiendo campos (Key / Value):**

| Key | Value (del selector de variables) |
|---|---|
| `id` | ID del contacto (*Contact ID*) |
| `texto` | **Último texto introducido** (*Last Text Input*) |

4. **No pongas ningún mensaje después.** Contesta Kira, no ManyChat.
5. Publica la respuesta predeterminada.

> ⚠️ Sin el paso 2 (la condición de la etiqueta), Kira recibiría **todos** los mensajes de **todos** los contactos. Con la condición, solo recibe los de las clientas que están esperando.

## Probarlo
1. `/responder on` en Telegram.
2. Haz una solicitud con tu cuenta de prueba (cita completa con fotos). Llega la propuesta.
3. Pulsa **Aprobar**: tu cuenta de prueba recibe el mensaje con el precio.
4. Responde «vale»: recibes el Bizum. Responde «confirmado»: recibes la confirmación y Telegram te avisa.
5. `/responder off` cuando termines si quieres volver al modo sombra.

## Si algo falla
- **No le llega el mensaje de precio:** Telegram te avisa «NO he podido escribir a…» con el motivo. Lo más común es que hayan pasado **más de 24 h** desde su último mensaje (límite de Instagram). Le escribes tú.
- **Dice «vale» y no pasa nada:** mira que la respuesta predeterminada esté publicada y que el contacto tenga la etiqueta `esperando_kira`. En el panel → Fallos verás si llegó.
- **Kira en pausa:** si la pausas desde el panel, no contesta a nadie y te avisa.
- **Plazos:** si la clienta no responde al precio en 20 h, se cierra en silencio. Si dice «vale» y no confirma en 45 min, Kira libera el hueco y se lo dice.
