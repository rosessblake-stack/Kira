import { duracionLegible, fechaLarga } from "./agenda";
import { contextoDe } from "./proposal";
import type { Reserva } from "./proposal-flow";
import { dinero } from "./ubicacion";

/**
 * Lo que la clienta escribe y lo que Kira le contesta por su cuenta, en la parte de la conversación que viene DESPUÉS de que
 * Blake apruebe el precio. Todo es determinista (ni Claude ni nada que dependa del texto libre):
 *  - Solo se entienden respuestas CORTAS y EXACTAS («vale», «confirmado»). Una frase con más cosas («no he confirmado
 *    todavía») no coincide con nada y pasa a Blake. Ante la duda, siempre Blake.
 *  - Lo que Kira le envía son plantillas con datos ya validados (fecha, importes, número de Bizum de Blake).
 * Reglas de docs/POLITICA.md y docs/SEGURIDAD.md.
 */

/** Plazos de Blake (20-oct): si no responde al precio, 20 h (Instagram solo deja escribir 24 h); si dice «vale» y no paga, 45 min. */
export const PLAZO_PRECIO_HORAS = 20;
export const PLAZO_PAGO_MIN = 45;
/** Instagram solo deja escribir a quien te ha escrito en las últimas 24 h; se deja un margen. */
export const VENTANA_MS = 24 * 3_600_000 - 15 * 60_000;

export const ventanaAbierta = (ultimoMensajeCliente: string | null, ahora: Date): boolean => {
  if (!ultimoMensajeCliente) return false;
  const t = Date.parse(ultimoMensajeCliente);
  return Number.isFinite(t) && ahora.getTime() - t <= VENTANA_MS && ahora.getTime() >= t - 60_000;
};

/** Minúsculas, sin acentos ni signos: «¡Vale, gracias!» → «vale gracias». */
export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ACEPTA = new Set([
  "ok", "okey", "okay", "oki", "okis", "vale", "valee", "vale gracias", "vale perfecto", "vale ok", "ok vale", "ok perfecto", "ok gracias",
  "si", "sii", "siii", "si gracias", "si por favor", "si claro", "si quiero", "quiero", "claro", "claro que si",
  "perfecto", "perfecto gracias", "genial", "estupendo", "guay", "muy bien", "bien", "de acuerdo", "dale", "adelante",
  "me parece bien", "me encaja", "me va bien", "me viene bien", "listo", "yes", "yeah",
]);

/** «Confirmo» a secas, dicho al precio, también es un sí. */
const ACEPTA_SOLO_AL_PRECIO = new Set(["confirmo", "confirmado", "confirmada"]);

const CONFIRMA = new Set([
  "confirmado", "confirmada", "confirmo", "confirmado gracias", "confirmada gracias", "ya esta confirmado", "ya esta confirmada", "esta confirmado",
  "hecho", "hecha", "ya esta", "ya esta hecho", "ya esta hecha", "ya hecho", "ya lo hice", "ya lo he hecho", "hecho el bizum", "hecho bizum",
  "pagado", "pagada", "ya pague", "ya he pagado", "ya esta pagado", "ya esta pagada",
  "bizum hecho", "bizum enviado", "bizum realizado", "enviado", "enviada", "ya lo envie", "ya lo he enviado", "ya lo mande", "ya lo he mandado",
  "listo", "lista", "done", "paid", "confirmed",
  "ya lo tengo", "lo tengo", "ya lo tengo hecho", "lo tengo hecho", "ya esta el bizum", "ya hice el bizum", "ya lo pague", "ya lo he pagado", "ya pago", "hecho ya",
]);

/** Solo un pulgar o similar, sin palabras. */
const SOLO_GESTO_DE_SI = /^[\s\u{1F44D}\u{1F44C}\u{2705}\u{1F64C}\u{1F64F}\u{1F60A}\u{FE0F}\u{1F3FB}-\u{1F3FF}]+$/u;

const MAX_CARACTERES_RESPUESTA = 60;

/** ¿Es un sí al precio? («vale», «ok», «👍», «confirmado»). Cualquier otra cosa, no. */
export function esAceptacion(texto: string, alPrecio = true): boolean {
  if (texto.length > MAX_CARACTERES_RESPUESTA || /[?¿]/.test(texto)) return false; // una pregunta no es un sí
  const n = normalizar(texto);
  if (!n) return SOLO_GESTO_DE_SI.test(texto) && /[\u{1F44D}\u{1F44C}\u{2705}]/u.test(texto);
  return ACEPTA.has(n) || (alPrecio && ACEPTA_SOLO_AL_PRECIO.has(n));
}

/** ¿Dice que ya hizo el Bizum? («confirmado», «hecho», «ya lo pagué»). Una palabra suelta de la clienta NO prueba nada: Blake puede revertirlo. */
export function esConfirmado(texto: string): boolean {
  if (texto.length > MAX_CARACTERES_RESPUESTA || /[?¿]/.test(texto)) return false; // «¿está confirmado?» no confirma nada
  return CONFIRMA.has(normalizar(texto));
}

// ---------------------------------------------------------------------------
// Lo que Kira le escribe (plantillas)
// ---------------------------------------------------------------------------

/** El número de Bizum: 9 cifras de España («662 01 84 25» → «662018425»). */
export function normalizarBizum(texto: string): string | null {
  const limpio = texto.replace(/[\s.\-()]/g, "").replace(/^\+34/, "").replace(/^0034/, "");
  return /^[6-9]\d{8}$/.test(limpio) ? limpio : null;
}

/** Tras el «vale»: cómo reservar el hueco por Bizum (España). */
export function textoPagoPedido(r: Reserva, bizum: string, plazoMin = PLAZO_PAGO_MIN): string {
  const lugar = contextoDe(r.spec ?? {});
  const cuando = r.starts_at ? ` para el ${fechaLarga(new Date(r.starts_at), lugar.zonaHoraria)}` : "";
  const senal = dinero(r.deposit_cents, lugar.moneda);
  return [
    `¡Perfecto! 😊 Para reservar tu hueco${cuando}, haz un Bizum de ${senal} al ${bizum}.`,
    `Esos ${senal} se descuentan del total el día de la cita y el resto lo pagas en efectivo.`,
    `Cuando lo hayas hecho, escríbeme «confirmado» y te envío la cita al correo. Tienes unos ${plazoMin} minutos; pasado ese tiempo libero el hueco.`,
  ].join("\n\n");
}

/** Cita confirmada (por el «confirmado» de la clienta o por Blake). */
export function textoConfirmada(r: Reserva, invitado: boolean): string {
  const lugar = contextoDe(r.spec ?? {});
  const cuando = r.starts_at ? fechaLarga(new Date(r.starts_at), lugar.zonaHoraria) : "la fecha acordada";
  const hasta = r.duration_minutes ? ` (dura aproximadamente ${duracionLegible(r.duration_minutes)})` : "";
  return [
    `¡Confirmado! 🎉 Tu cita queda reservada para el ${cuando}${hasta}.`,
    invitado && r.client_email ? `Te he enviado la invitación a ${r.client_email}.` : "Te la confirmo por aquí.",
    r.spec?.direccion ? `📍 ${r.spec.direccion}` : "",
    "¡Nos vemos!",
  ].filter(Boolean).join("\n\n");
}

/** El plazo de pago venció y se libera el hueco. */
export function textoLiberada(): string {
  return "No he recibido la señal a tiempo, así que he liberado el hueco. Si sigues interesada, escríbeme y lo vemos 😊";
}

/** La clienta dijo que ya hizo el Bizum: Kira se lo dice a Blake para que mire su banco, y a ella le avisa de que se comprueba. */
export function textoPagoRecibido(): string {
  return "¡Gracias! Lo compruebo y te confirmo en un momento 😊";
}

/** Blake dijo que el Bizum no le llegó: se libera el hueco, pero ella puede avisar si ya lo hizo. */
export function textoRevertida(): string {
  return "Todavía no me consta el Bizum, así que he tenido que liberar el hueco. Si ya lo hiciste, escríbeme y lo reviso enseguida 😊";
}
