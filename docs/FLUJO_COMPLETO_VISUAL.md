# 🖤 Kira + ManyChat: cómo funciona todo, de principio a fin

**Modo sombra:** Kira prepara todo y te lo manda a ti. **Tú decides y tú contestas a la clienta.** Kira no le escribe nada y no se le avisa de que hay IA.

---

## 1️⃣ El recorrido completo (vista general)

| Paso | Quién | Qué pasa |
|---|---|---|
| 1 | **Clienta** | Escribe "cita" o "agendar" por Instagram |
| 2 | **ManyChat** | Le hace las preguntas con botones y le pide las fotos |
| 3 | **ManyChat** | Al terminar, manda **todo de golpe** a Kira |
| 4 | **Kira** | Descarga las 2 fotos y las guarda en privado |
| 5 | **Claude** | Lee el texto y **mira las fotos** (solo describe) |
| 6 | **Legacy** | Calcula el precio con tu fórmula real |
| 7 | **Kira → Telegram** | Te manda **las fotos + la propuesta** |
| 8 | **Tú** | Pulsas **Aprobar**, **Editar** o **Rechazar** |
| 9 | **Kira** | Si aprobaste: hueco en **amarillo** en tu calendario |
| 10 | **Tú** | Le escribes el precio a la clienta, como siempre |
| 11 | **Tú** | Cuando paga, pulsas **💜 Señal recibida** → morado + invitación |

> Regla de oro: **Claude propone, Blake decide, el código ejecuta.**

---

## 2️⃣ Lo que tienes que hacer tú (en orden)

### A. Antes de tocar ManyChat
1. Inventa una **clave larga al azar** (30 caracteres o más, con un generador de contraseñas).
2. Ponla en **Vercel** como variable `MANYCHAT_WEBHOOK_SECRET` (en *Production* y *Preview*).
3. Avísame y **yo redespliego**.

> 🔒 **Nunca pegues la clave en el chat.** Solo en Vercel y en ManyChat.

### B. En ManyChat: preparar piezas
1. **Duplica** el flujo "cita / agendar" (menú ⋯ → *Duplicar*). Trabajas en la **copia**. El original sigue funcionando.
2. Crea el **campo personalizado** `Fecha_texto` (tipo Texto).
3. Crea las **etiquetas** `Esperando_Kira` y `Error_Kira`.

---

## 3️⃣ El flujo nuevo, bloque a bloque

| # | Bloque | Qué hace |
|---|---|---|
| **B0** | Disparador | Contiene **cita** o **agendar** (igual que ahora) |
| **B1** 🆕 | Condición | Si tiene la etiqueta `Esperando_Kira` → "Tu solicitud ya está en revisión 🖤 Te escribo en cuanto la valore." y **FIN** |
| **B2** | Condición | Si tiene `En_proceso_reserva` → tu mensaje de siempre y **FIN** |
| **B3** 🆕 | Acción | **Añadir** etiqueta `En_proceso_reserva` |
| **B4** | Mensaje | "¿Estás en Miami o España?" (botones) → se guarda en `pais de cliente` |
| **B5** | Condición | Si es Miami → tu mensaje de "Estaré disponible en Miami hacia Diciembre…" |
| **B6** 🆕 | Mensaje | "¿Con qué nombre te anoto?" → se guarda en `Nombre` |
| **B7** | Mensaje | Foto del **estilo exacto** → se guarda en `Referencia_Diseño` |
| **B8** | Mensaje | Foto del **estado del cabello** → se guarda en `Estado_Cabello` |
| **B9** | Mensaje | ¿Extensiones? **SÍ / NO** → `uso_extensiones` |
| **B10** | Condición | Si es SÍ → B11. Si es NO → B12 |
| **B11** | Mensaje | ¿Qué color de extensiones? → `color_extensiones` |
| **B12** | Mensaje | Largo: **Nuca / Media espalda / Cintura / Debajo del culo** → `Largo_trenzas` |
| **B13** ✏️ | Mensaje | "Dime tu fecha y hora ideal…" → se guarda en **`Fecha_texto`** (ya no en `Fecha y Hora`) |
| **B14** ✏️ | Mensaje | Pides el **email**. Quita la línea que copia `Fecha y Hora` y el aviso a los asignados |
| **B15** 🆕 | Acción | **Quitar** `En_proceso_reserva` y **añadir** `Esperando_Kira` |
| **B16** 🆕 | Solicitud externa | **Envía todo a Kira** (ver apartado 4). Si falla → etiqueta `Error_Kira` |
| **B17** | Mensaje | Tu "Expediente recibido con éxito…" (puedes quitar la última frase de "no vuelvas a escribir cita") |
| **B18** 🆕 | Pausa | Espera **23 horas** y **quita** `Esperando_Kira` |

🆕 = nuevo · ✏️ = modificado

### Retoques pequeños
- Borra el campo `Clor_extensiones` (tiene una errata). Comprueba antes que el color se guarda en `color_extensiones`.
- Los recordatorios de 15 minutos y 23 horas **se quedan**, pero esos caminos deben **quitar** `En_proceso_reserva` y **nunca** poner `Esperando_Kira`.
- En el recordatorio de la fecha, cambia el texto por: *"Veo que la planificación de tu diseño quedó a medias. La agenda para trenzas es limitada. Escríbeme tu fecha y hora ideal para que pueda valorar tu caso personalmente 🙂🖤"*
- La condición de 23 h de la fecha ahora mira si **`Fecha_texto` está vacío**.

---

## 4️⃣ El bloque "Solicitud externa" (B16)

| Ajuste | Valor |
|---|---|
| **Método** | `POST` |
| **Dirección** | `https://kira-virid-eight.vercel.app/api/manychat` |
| **Cabecera 1** | `Content-Type` = `application/json` |
| **Cabecera 2** | `x-kira-secret` = *tu clave larga* |
| **Cuerpo** | Elige **enviar todos los datos del contacto** (*Full contact data*) |

Si no te sale esa opción, usa este cuerpo y rellena cada valor con el selector de campos de ManyChat:

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

Kira no distingue mayúsculas, acentos ni espacios en los nombres de los campos.

---

## 5️⃣ Lo que hace Kira por dentro (en 10 segundos)

| Paso | Qué hace | Si algo falla |
|---|---|---|
| 🔑 Comprueba la clave | Si no coincide → rechaza y lo anota en **Seguridad** | No pasa nada más |
| 📋 Lee los datos | Valida email, Instagram, textos y direcciones | Rechaza y lo anota |
| 🔁 Evita duplicados | Si ManyChat reintenta, no crea otra solicitud | — |
| 🖼️ Descarga las fotos | **Solo** de dominios de Instagram/Meta/ManyChat, máx. 4 MB, 10 s | La propuesta sale igual y avisa que falta la foto |
| 🧪 Comprueba que son fotos | Mira los bytes, no el nombre. Un HTML disfrazado se rechaza | Queda en **Seguridad** |
| 🧠 Claude lee el texto | Entiende fecha, hora, extensiones, largo… | Si no puede → **te lo deriva** (nunca inventa) |
| 👁️ Claude mira las fotos | Describe el peinado y el pelo | Si falla → te lo dice y sigue sin ella |
| 💶 Legacy calcula | Precio con tu fórmula real | Sin datos suficientes → sin precio, tú lo pones |
| 📲 Te lo manda | **Primero las fotos, luego la propuesta** | — |

---

## 6️⃣ Lo que recibes en Telegram

```
📥 SOLICITUD DE INSTAGRAM · PROPUESTA DE CITA
👀 Modo sombra: Kira NO ha escrito a la clienta.

👤 Cliente: Lucía (email) · @usuario
🧾 Servicio: 6 trenzas · pegadas · con extensiones rojo
📅 Fecha pedida: vie 30 oct, 12:00 (3 h)

🔎 Lo que veo en las fotos
• Referencia: Seis cornrows largos hasta las caderas
• Pelo: Rizado por los hombros, sin trenzas

💶 Precio: 80 € (Legacy) · Señal: 20 €

⚠️ Avisos
• Visto en la foto (aprox. 6 trenzas): confírmalo

[ ✅ Aprobar ]  [ ✏️ Editar ]  [ ❌ Rechazar ]
```

### Qué significa cada aviso
- **"Visto en la foto … confírmalo"** → la clienta no lo dijo, Claude lo dedujo de la imagen. Míralo tú.
- **"Tipo asumido"** → tu regla: número de trenzas = pegadas, "trenzas" a secas = sueltas.
- **Sin botón Aprobar** → falta algo (por ejemplo el tamaño) o hay un choque con tu agenda. Pulsa **Editar** y escribe, por ejemplo, `tipo pegadas` o `tamaño large`.

### Con Editar puedes escribir líneas como
`precio 80` · `horas 3` · `fecha 30/10 12:00` · `tipo sueltas` · `tamaño large` · `dirección …` · `materiales 9`

---

## 7️⃣ Cuando pulsas Aprobar

1. Kira vuelve a mirar tu calendario (ningún solape).
2. Crea la cita en **🟡 amarillo** (provisional).
3. Te avisa: **"No he podido escribir a la clienta (modo sombra). Escríbele tú el precio."**
4. Tú le escribes por Instagram, como siempre.
5. Cuando te llegue el Bizum, pulsas **💜 Señal recibida** → pasa a **morado** y se le envía la invitación al email.
6. Si no se concreta: **🗑 Cancelar cita** borra el evento.

---

## 8️⃣ Protecciones (lo que Kira NO hace)

- ❌ No escribe a la clienta.
- ❌ No cobra, no cancela ni crea citas sin tu botón.
- ❌ No inventa precios: sin datos, no hay precio.
- ❌ No obedece órdenes escondidas en un mensaje o en una foto: te avisa de **posible manipulación** y no prepara propuesta.
- ❌ Una foto nunca pisa lo que la clienta escribió.
- ❌ Con confianza baja en la foto, solo te enseña el resumen y no rellena nada.
- ✅ Si pausas Kira desde el panel, no prepara nada.
- ✅ Tope de solicitudes por clienta y por día para controlar el gasto.
- ✅ Foto del pelo: se borra a los **60 días**. Foto de referencia: se **guarda siempre**.

---

## 9️⃣ Probar y pasar a producción

1. Con una **cuenta de Instagram de prueba**, usa una palabra clave distinta (por ejemplo `citaprueba`) en la **copia**.
2. Completa el flujo con fotos reales.
3. En **menos de un minuto** debe llegarte la propuesta a Telegram.
4. Si no llega: mira en ManyChat si el contacto tiene la etiqueta `Error_Kira`, y en el panel de Kira → **Fallos**.
5. Para repetir la prueba: quita a mano `Esperando_Kira` y `En_proceso_reserva` del contacto de prueba.
6. Cuando salga bien: **quita** "cita" y "agendar" del disparador del flujo **original** y **ponlas** en la copia. Guarda el original unos días por si hay que volver atrás.

---

## 🔜 Para más adelante (no está hecho todavía)

- Que Kira conteste a la clienta por Instagram (con la API de ManyChat).
- Ficha de cada clienta en Supabase (cuándo vino, qué se hizo, qué pagó).
- Mensaje de seguimiento a las 2 semanas pidiendo una foto con las trenzas.
- Cobro con Stripe para Miami.
- Formación online y presencial.
