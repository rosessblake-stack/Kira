# Prompt para la IA de ManyChat (copiar y pegar)

**Antes de pegarlo:**
1. **Pega tus dos textos reales** donde pone «[PEGA AQUÍ TU TEXTO COMPLETO]» (el del «Expediente recibido…» y el de abandono).
2. Duplica tu flujo «cita / agendar» y trabaja en la copia (menú ⋯ → Duplicar), o pide a la IA que cree uno nuevo con este texto.
3. Crea a mano el campo `Fecha_texto` (texto) y las etiquetas `Esperando_Kira` y `Error_Kira`.
4. **No pegues tu clave secreta en este prompt.** La pones tú a mano en la cabecera `x-kira-secret` cuando termines.
5. Revisa el resultado bloque a bloque: la IA puede equivocarse con condiciones, pausas o la solicitud externa.

---

## ▼▼▼ COPIA DESDE AQUÍ ▼▼▼

Crea (o modifica) un flujo de Instagram para agendar citas de trenzas. Mantén EXACTAMENTE los textos que te doy, en español, sin cambiarlos ni resumirlos. No menciones nunca que hay inteligencia artificial. No añadas notificaciones a administradores ni asignes la conversación a nadie.

### Nombre y disparador
- Nombre del flujo: «cita agendar v2 Kira».
- Disparador: palabra clave en mensaje de Instagram que CONTENGA «citaprueba». (Más adelante la cambiaré a «cita» y «agendar».)

### Campos personalizados que se usan (ya existen o los creo yo)
Nombre, pais de cliente, Referencia_Diseño, Estado_Cabello, uso_extensiones, color_extensiones, Largo_trenzas, Fecha_texto (todos de texto). No uses el campo «Fecha y Hora».

### Etiquetas que se usan
En_proceso_reserva, Esperando_Kira, Error_Kira, Lugar Cliente, Foto_Recibida.

### Pasos del flujo, en este orden

**1. Condición.** Si el contacto tiene la etiqueta «Esperando_Kira»: enviar el mensaje «Tu solicitud ya está en revisión 🖤 Te escribo en cuanto la valore.» y TERMINAR el flujo. Si no, continuar.

**2. Condición.** Si el contacto tiene la etiqueta «En_proceso_reserva»: enviar «Tu diagnóstico de trenzas está en proceso. Responde la información pendiente.» y TERMINAR. Si no, continuar.

**3. Acción.** Añadir la etiqueta «En_proceso_reserva».

**4. Mensaje con botones.** Texto: «¿Estás en Miami o España?». Botones: «Miami» y «España». Guardar la respuesta en el campo «pais de cliente». Al responder, añadir la etiqueta «Lugar Cliente».

**5. Condición.** Si «pais de cliente» es «Miami»: enviar «Estaré disponible en Miami hacia Diciembre. Antes de empezar, responde las siguientes preguntas y haremos un mejor servicio.» y continuar. Si es España, continuar directamente.

**6. Mensaje.** «¿Con qué nombre te anoto?». Esperar texto. Guardar en el campo «Nombre».

**7. Mensaje.** «Para saber qué deseas en tu servicio. Adjunta la fotografía del estilo exacto que deseas realizarte. (Imagen que permanezca en el chat, no temporales)». Esperar una IMAGEN. Guardar en «Referencia_Diseño». Al responder, añadir la etiqueta «Foto_Recibida».

**8. Mensaje.** «Recibido. Adjunta una foto del estado actual de tu cabello. Así podré analizar largura y color del mismo.». Esperar una IMAGEN. Guardar en «Estado_Cabello».

**9. Mensaje con botones.** «Ahora necesitaré saber si quieres o no usar extensiones en tu servicio». Botones: «SI» y «NO». Guardar en «uso_extensiones».

**10. Condición.** Si «uso_extensiones» es «SI», ir al paso 11. Si es «NO», saltar al paso 12.

**11. Mensaje.** «¿Qué color de extensiones tienes en mente o cuál es tu base actual? Así podré asegurar la disponibilidad del material técnico. (Solo dime el color)». Esperar texto. Guardar en «color_extensiones».

**12. Mensaje con botones.** «¿Cuál sería el largo deseado, por donde quisieras que lleguen tus trenzas?». Botones: «Nuca», «Media espalda», «Cintura», «Debajo del culo». Guardar en «Largo_trenzas».

**13. Mensaje.** «Dime tu fecha y hora ideal para tu cita. (La disponibilidad final será confirmada personalmente tras evaluar la complejidad técnica de tu diseño).». Esperar TEXTO LIBRE (no un selector de calendario). Guardar en «Fecha_texto».

**14. Mensaje.** «Antes de continuar, necesito tu correo, por si confirmamos el servicio, poder generar tu cita posteriormente.». Esperar un EMAIL y guardarlo en el campo estándar de email del contacto. Sin más acciones.

**15. Acción.** Quitar la etiqueta «En_proceso_reserva» y añadir la etiqueta «Esperando_Kira».

**16. Solicitud externa (External Request).**
- Método: POST
- URL: https://kira-virid-eight.vercel.app/api/manychat
- Cabeceras: «Content-Type» = «application/json» y «x-kira-secret» = (déjalo vacío, lo rellenaré yo).
- Cuerpo JSON: enviar todos los datos del contacto (Full contact data). Si no existe esa opción, usar este JSON con los campos dinámicos correspondientes: {"id": ID del contacto, "ig_username": usuario de Instagram, "email": email, "Nombre": campo Nombre, "pais de cliente": campo pais de cliente, "Referencia_Diseño": campo Referencia_Diseño, "Estado_Cabello": campo Estado_Cabello, "uso_extensiones": campo uso_extensiones, "color_extensiones": campo color_extensiones, "Largo_trenzas": campo Largo_trenzas, "Fecha_texto": campo Fecha_texto}
- Si la solicitud FALLA: añadir la etiqueta «Error_Kira» y continuar igualmente.

**17. Mensaje.** Empieza con «Expediente recibido con éxito, {nombre}» (nombre = campo «Nombre») y sigue con el resto del texto que YA tiene mi flujo actual de «cita / agendar»: [PEGA AQUÍ TU TEXTO COMPLETO]. Quita solo la última frase que dice que no vuelva a escribir «cita».

**18. Pausa (Smart Delay).** Esperar 23 horas y después quitar la etiqueta «Esperando_Kira».

### Recordatorios si la clienta no contesta
En los pasos que esperan respuesta (4, 6, 7, 8, 9, 11, 12, 13 y 14): si no contesta en 15 minutos, enviar el recordatorio que ya tiene mi flujo actual para ese paso (si no hay, uno amable con el mismo contenido). Si sigue sin contestar tras 23 horas, enviar el mensaje de abandono que ya tiene mi flujo actual («Vi que se te olvidó acabar de rellenar todo…»: [PEGA AQUÍ TU TEXTO COMPLETO]) y QUITAR la etiqueta «En_proceso_reserva». Estos caminos de abandono NUNCA deben añadir la etiqueta «Esperando_Kira».
Para el paso 13 (fecha), el recordatorio debe decir: «Veo que la planificación de tu diseño quedó a medias. La agenda para trenzas es limitada. Escríbeme tu fecha y hora ideal para que pueda valorar tu caso personalmente 🙂🖤».

### Reglas finales
- Todos los mensajes van por Instagram, en español, tono cercano.
- No uses etiquetas, campos ni plantillas distintas de las indicadas.
- No publiques ni actives el flujo: déjalo en borrador para que yo lo revise.
- Al terminar, dame una lista de los bloques creados y señala cualquier paso que no hayas podido crear tal cual.

## ▲▲▲ COPIA HASTA AQUÍ ▲▲▲

---

## Qué comprobar a mano cuando la IA termine

| Comprobar | Cómo |
|---|---|
| Los textos son idénticos a los tuyos | Léelos bloque a bloque |
| Fecha en **texto libre** (no calendario) | Bloque «Dime tu fecha y hora ideal» |
| La condición del paso 10 salta de verdad al largo si dice NO | Prueba con NO |
| Solicitud externa: dirección, `Content-Type` y datos del contacto | Mira que esté bien escrita |
| **Pon tu clave** en la cabecera `x-kira-secret` | La misma que en Vercel (`MANYCHAT_WEBHOOK_SECRET`) |
| El camino de error añade `Error_Kira` | Está en la solicitud externa |
| Los abandonos **quitan** `En_proceso_reserva` y **nunca** ponen `Esperando_Kira` | Revisa los recordatorios |
| Pausa de 23 h quita `Esperando_Kira` | Último bloque |
| Sigue en borrador | No publiques hasta probar con tu cuenta de prueba |
