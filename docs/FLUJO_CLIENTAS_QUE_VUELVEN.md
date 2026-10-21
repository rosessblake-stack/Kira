# Clientas que vuelven: que ManyChat no les pida todo otra vez

Kira guarda una **ficha** de cada clienta (usuario de Instagram, nombre, email, ciudad, nº de citas y último servicio) cuando apruebas su
primera cita. Cuando vuelve, ManyChat le pregunta a Kira «¿la conoces?» **al empezar el flujo**; si la conoce, se salta nombre, email,
país y la foto del pelo (si la tiene de menos de 60 días) y solo pregunta lo que cambia: **estilo (foto de referencia), extensiones, color,
largo y fecha**.

## 1. Campos nuevos en ManyChat (Ajustes → Campos personalizados → Crear campo, tipo Texto)
`Conocida` · `Saludo` · `Soy_Yo` · `Pelo_Guardado` · `Ultimo_Servicio` · `Citas`
(`Nombre`, `email` y `pais de cliente` ya los tienes.)

## 2. Primer bloque del flujo: «Solicitud externa» (Acciones)
- Método **POST**, dirección: `https://kira-virid-eight.vercel.app/api/manychat/conocer`
- Cabeceras (las dos): `Content-Type` = `application/json` y `x-kira-secret` = la misma clave de siempre.
- Cuerpo (JSON): `{"ig_username": "<variable Instagram Username, elegida con el selector>"}`
  (la variable se inserta con el botón del selector, no escrita a mano, como en las otras solicitudes).
- Pulsa **Probar** y, en **Mapeo de la respuesta** (Response mapping), enlaza cada dato con su campo:

| La respuesta trae | Se guarda en |
|---|---|
| `conocida` | Conocida |
| `saludo` | Saludo (el mensaje ya escrito por Kira: «¡Hola, Marta! 🖤 Qué ganas de verte otra vez. Hace 3 semanas te hice 6 Flat Twist, ¿qué tal te quedó? ¿Eres tú?») |
| `nombre` | Nombre |
| `email` | email |
| `pais` | pais de cliente |
| `pelo_guardado` | Pelo_Guardado |
| `ultimo_servicio` | Ultimo_Servicio |
| `citas` | Citas |

Si Kira no responde o no la conoce, `Conocida` queda en `no` y el flujo sigue **exactamente como ahora**. Nunca se rompe por esto.

## 3. Justo después: una condición (Condición)
- **Si `Conocida` = `si`** → camino corto:
  1. Mensaje: «¡Hola, {{Nombre}}! 🖤 Qué ganas de volver a verte. Te recuerdo de otras veces; si no eres tú, escribe NO.»
  2. Foto de referencia (¿qué estilo quieres esta vez?) → extensiones → color → largo → fecha.
  3. **Foto del pelo solo si `Pelo_Guardado` = `no`** (otra condición).
  4. Termina en el mismo bloque final «Solicitud externa» de siempre.
- **Si no** → el flujo largo de siempre.

El bloque final **no cambia**: sigue mandando `Nombre`, `email`, `pais de cliente`, etc. (ya rellenados por el mapeo) y los campos nuevos.
Si la clienta no manda foto del pelo y Kira tiene una de menos de 60 días, **la reutiliza sola** (lo anota en la línea de tiempo).

## 4. Qué datos recibe ManyChat (y cuáles nunca)
Solo: nombre, email, ciudad, nº de citas, último servicio y si hay foto del pelo reciente. **Nunca** precios, fotos, mensajes ni fechas de
otras citas. Se identifica por el usuario de Instagram que da Meta (no lo escribe la clienta).

## 5. Telegram
- `/ficha @usuario` → ver lo que Kira sabe de ella.
- `/borrarficha @usuario` → borrarla (la próxima vez Kira le vuelve a pedir todo). Sus citas antiguas siguen en el historial.
- Se crea sola al **aprobar** una cita; el nº de citas sube cuando pulsas «Señal recibida» / «Sí, me ha llegado». Las pruebas (`/simular`) no crean fichas.

## 6. Cómo probarlo
1. Haz una solicitud real con tu cuenta y **apruébala** (así se crea tu ficha). Tu ficha de prueba ya existe como `@blakeroses`.
2. Vuelve a entrar al flujo con la misma cuenta: debería saludarte por tu nombre y saltarse los datos.
3. `/ficha @blakeroses` te enseña lo que guardó.
