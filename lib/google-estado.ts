/** El estado de la conexión con Google Calendar, dicho en palabras para Blake (Telegram y panel). */

export type EstadoCalendario = {
  /** Están puestos GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET. */
  configurado: boolean;
  conectado: boolean;
  /** Cuenta de Google con la que está conectado. */
  cuenta: string | null;
};

export function textoEstadoCalendario(e: EstadoCalendario): string {
  if (!e.configurado) {
    return "📅 Calendario: sin configurar.\n\nFalta crear el acceso en Google y poner GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel (los pasos están en docs/GOOGLE.md). Mientras tanto, cada propuesta avisa de que la disponibilidad NO está comprobada.";
  }
  if (!e.conectado) {
    return "📅 Calendario: listo para conectar.\n\nEntra en /panel → Calendario y pulsa «Conectar Google Calendar». Mientras tanto, cada propuesta avisa de que la disponibilidad NO está comprobada.";
  }
  return `📅 Calendario conectado${e.cuenta ? ` con ${e.cuenta}` : ""}.\n\nCada propuesta mira tu agenda (también las citas marcadas «libre»). Al aprobar se crea la reserva provisional (amarilla); «Señal recibida» la pasa a morado y «Cancelar cita» la borra.`;
}
