/**
 * Mensajes largos de Telegram, plegables: la notificación del móvil enseña solo la primera línea (el resumen) y, al abrir el chat,
 * el detalle sale en una cita desplegable («expandable blockquote»). Todo lo que viene de fuera (nombre de la clienta, sus textos,
 * lo que lee Claude) se escapa: en HTML de Telegram solo se interpretan las etiquetas que pone este módulo.
 */

/** Telegram admite hasta 4096 caracteres por mensaje (ya sin etiquetas): se deja margen. */
export const MAX_DETALLE = 3800;

export const escaparHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** El texto HTML (y su modo) para un mensaje con resumen arriba y el detalle completo plegado. */
export function formatoPlegable(resumen: string, detalle: string): string {
  const corto = resumen.replace(/\s+/g, " ").trim().slice(0, 200);
  const cuerpo = detalle.trim().slice(0, MAX_DETALLE);
  return `<b>${escaparHtml(corto)}</b>\n<blockquote expandable>${escaparHtml(cuerpo)}</blockquote>`;
}
