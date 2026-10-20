import {
  PLAZO_PAGO_MIN,
  PLAZO_PRECIO_HORAS,
  esAceptacion,
  esConfirmado,
  normalizarBizum,
  textoConfirmada,
  textoLiberada,
  textoPagoPedido,
  textoRevertida,
  ventanaAbierta,
} from "./clienta";
import { describirFalloGoogle } from "./google-oauth";
import { MAX_CARACTERES_CLIENTE, detectarInyeccion, limpiarTexto } from "./intents";
import { contextoDe } from "./proposal";
import type { FlowDeps, Reserva } from "./proposal-flow";
import { dinero } from "./ubicacion";

/**
 * La conversación con la clienta DESPUÉS de que Blake apruebe el precio (decisiones de Blake, 20-oct):
 *
 *   Aprobar ─► precio a la clienta ─► «vale» ─► Bizum (20 €, 45 min) ─► «confirmado» ─► cita en morado + invitación
 *              (plazo 20 h)                      (plazo 45 min)             (Blake puede revertirlo con un botón)
 *
 *  - El hueco queda reservado en AMARILLO desde el Aprobar hasta que paga (morado). Si el plazo vence, se borra solo ese evento.
 *  - «confirmado» confirma sin esperar a Blake (opción C), pero SIEMPRE le avisa al momento con un botón «❌ No me ha llegado
 *    nada» que revierte (borra el evento avisando a la clienta). La palabra de la clienta no prueba un pago: por eso el aviso
 *    y el botón no son opcionales.
 *  - Solo se entienden respuestas cortas y exactas (lib/clienta.ts). Todo lo demás se le reenvía a Blake sin contestar nada.
 *  - Kira en pausa, mensaje con señales de manipulación, ventana de 24 h de Instagram cerrada o canal sin conectar: no se
 *    contesta a la clienta y se avisa a Blake.
 *  - Todo cambio de fase es atómico (solo gana una ejecución) y los plazos los cierra un temporizador (cron cada minuto).
 */

export type Fase = "precio_enviado" | "pago_pedido" | "confirmada" | "cerrada";

export type ConversacionCanal = {
  id: string;
  canal: "prueba" | "instagram";
  contact_ref: string;
  last_client_message_at: string | null;
};

export type ResultadoEnvio = { ok: true } | { ok: false; motivo: string };

export interface ClienteExtra {
  /** Chat privado de Blake (donde le llegan los avisos). */
  adminChatId: number | null;
  leerConversacion(id: string): Promise<ConversacionCanal | null>;
  /** Escribe a la clienta por su canal. En las pruebas es un mensaje a Blake; Instagram aún no está conectado. */
  canalEnviar(conv: ConversacionCanal, texto: string): Promise<ResultadoEnvio>;
  /** Número de Bizum de Blake (España). */
  bizum(): Promise<string | null>;
  guardarBizum(numero: string): Promise<void>;
  /**
   * Cambio de fase ATÓMICO: solo si la reserva sigue en una de las fases `de` (null = aún sin fase). Devuelve la reserva
   * actualizada, o null si otra ejecución ya la había movido.
   */
  avanzarFase(id: string, de: (Fase | null)[], parche: Partial<Omit<Reserva, "id">>): Promise<Reserva | null>;
  /** La reserva con conversación activa (esperando «vale» o «confirmado») de una conversación. */
  reservaActivaDe(conversationId: string): Promise<Reserva | null>;
  /** La última reserva de PRUEBA con conversación activa (para /clienta y /vencer). */
  reservaDePruebaActiva(): Promise<Reserva | null>;
  /** Reservas con plazo vencido en una fase activa. */
  vencidas(ahora: Date, limite: number): Promise<Reserva[]>;
}

export type ClienteDeps = Pick<
  FlowDeps,
  | "now"
  | "newNonce"
  | "agenda"
  | "estaPausada"
  | "leerReserva"
  | "actualizarReserva"
  | "verReservaPorNonce"
  | "tomarNonce"
  | "retirarRegistro"
  | "guardarMensaje"
  | "actualizarConversacion"
  | "marcarMensajeSospechoso"
  | "logEvent"
  | "logSecurity"
  | "enviar"
  | "editar"
  | "responderCallback"
> &
  ClienteExtra;

export interface ClientePort {
  /** Tras Aprobar con calendario: le manda el precio a la clienta y arranca el plazo de 20 h. */
  alAprobar(r: Reserva): Promise<void>;
  /** Blake pulsó «Señal recibida»: se lo confirma a la clienta y cierra el seguimiento. */
  alConfirmarBlake(r: Reserva, invitado: boolean): Promise<void>;
  /** Blake canceló la cita: se cierra el seguimiento. */
  alCancelarBlake(r: Reserva): Promise<void>;
  /** Lo que escribe la clienta (el webhook de ManyChat llamará aquí; en pruebas, /clienta). */
  respuestaClienta(conversationId: string, texto: string): Promise<void>;
  /** /clienta <texto>: Blake escribe como si fuera la clienta de la última prueba. */
  respuestaEnPrueba(chatId: number, texto: string): Promise<void>;
  /** Botón «❌ No me ha llegado nada» tras un «confirmado» de la clienta. */
  botonRevertir(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string }): Promise<void>;
  /** El temporizador (cada minuto): cierra los plazos vencidos. */
  procesarVencidas(): Promise<{ cerradas: number }>;
  /** /vencer: adelanta el plazo de la última prueba para ver qué pasa cuando se agota. */
  vencerYa(chatId: number): Promise<void>;
  /** /bizum [número]: ver o cambiar el número de Bizum que se le da a las clientas. */
  bizum(chatId: number, texto: string): Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");
const HORA_MS = 3_600_000;
const MIN_MS = 60_000;
const REINTENTO_BORRADO_MIN = 10;

const tecladoRevertir = (nonce: string) => ({ inline_keyboard: [[{ text: "❌ No me ha llegado nada", callback_data: `c:${nonce}:rev` }]] });

const MOTIVOS: Record<string, string> = {
  ventana_24h: "han pasado más de 24 h desde su último mensaje y Instagram no deja escribirle",
  canal_no_conectado: "el canal de Instagram todavía no está conectado",
};

export function crearFlujoCliente(deps: ClienteDeps): ClientePort {
  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  const marca = (r: Pick<Reserva, "is_test">) => (r.is_test ? "🧪 PRUEBA · " : "");
  const nombreDe = (r: Reserva) => r.spec?.nombre ?? r.client_name ?? "la clienta";
  const idsDe = (r: Reserva) => ({ conversation_id: r.conversation_id, booking_id: r.id });

  /** Un aviso a Blake nunca debe romper el flujo: si Telegram falla, queda registrado. */
  async function avisarBlake(texto: string, markup?: unknown): Promise<boolean> {
    if (deps.adminChatId === null) {
      await deps.logEvent({ source: "system", kind: "aviso_sin_chat_de_blake", level: "error", summary: "No hay chat de Blake al que avisar" }).catch(() => undefined);
      return false;
    }
    try {
      await deps.enviar(deps.adminChatId, texto.slice(0, 4000), markup);
      return true;
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "aviso_a_blake_fallo", level: "error", summary: msg(e) }).catch(() => undefined);
      return false;
    }
  }

  /**
   * Escribe a la clienta. Nunca lanza: devuelve si se pudo. Respeta la ventana de 24 h de Instagram y deja constancia
   * (mensaje saliente + evento) de lo que se envió.
   */
  async function enviarAClienta(conv: ConversacionCanal | null, texto: string, r: Reserva): Promise<ResultadoEnvio> {
    const ids = idsDe(r);
    if (!conv) return { ok: false, motivo: "sin_conversacion" };
    if (!ventanaAbierta(conv.last_client_message_at, deps.now())) {
      await deps.logEvent({ source: "system", kind: "mensaje_a_clienta_bloqueado", level: "warn", summary: "No se escribe a la clienta: ventana de 24 h cerrada", ...ids });
      return { ok: false, motivo: "ventana_24h" };
    }
    let res: ResultadoEnvio;
    try {
      res = await deps.canalEnviar(conv, texto);
    } catch (e) {
      res = { ok: false, motivo: msg(e) };
    }
    if (!res.ok) {
      await deps.logEvent({ source: "system", kind: "mensaje_a_clienta_fallo", level: "warn", summary: `No se pudo escribir a la clienta: ${MOTIVOS[res.motivo] ?? res.motivo}`, ...ids });
      return res;
    }
    await deps.guardarMensaje(conv.id, "out", texto, false).catch((e) =>
      deps.logEvent({ source: "system", kind: "mensaje_saliente_sin_guardar", level: "warn", summary: msg(e), ...ids }).catch(() => undefined),
    );
    await deps.logEvent({ source: "system", kind: "mensaje_a_clienta", summary: "Mensaje enviado a la clienta", detail: { caracteres: texto.length, canal: conv.canal }, ...ids });
    return res;
  }

  const motivoLegible = (m: string) => MOTIVOS[m] ?? m;

  async function cerrarConversacion(r: Reserva) {
    if (!r.conversation_id) return;
    await deps.actualizarConversacion(r.conversation_id, { status: "cerrada" }).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Tras Aprobar: el precio a la clienta
  // -------------------------------------------------------------------------

  async function alAprobar(r: Reserva): Promise<void> {
    const ids = idsDe(r);
    if (!r.conversation_id) return;
    const conv = await deps.leerConversacion(r.conversation_id);
    const texto = (r.reply_draft ?? "").trim();
    if (!texto || texto.startsWith("Borrador pendiente")) {
      await avisarBlake(`${marca(r)}⚠️ No hay mensaje para ${nombreDe(r)}: el borrador está incompleto. Escríbele tú, o cancela la cita.`);
      return;
    }
    const envio = await enviarAClienta(conv, texto, r);
    if (!envio.ok) {
      await avisarBlake(
        `${marca(r)}⚠️ He reservado el hueco (amarillo) pero NO he podido escribir a ${nombreDe(r)}: ${motivoLegible(envio.motivo)}.\n\nEscríbele tú con el precio y, cuando pague, pulsa «Señal recibida». Este hueco no caduca solo.`,
      );
      return;
    }
    const plazo = new Date(deps.now().getTime() + PLAZO_PRECIO_HORAS * HORA_MS);
    const ganada = await deps.avanzarFase(r.id, [null], { client_phase: "precio_enviado", payment_deadline: plazo.toISOString() });
    await deps.logEvent({ source: "system", kind: "precio_enviado_a_clienta", summary: `Precio enviado a la clienta; plazo de respuesta ${PLAZO_PRECIO_HORAS} h`, detail: { fase_guardada: Boolean(ganada) }, ...ids });
    if (!ganada) {
      await avisarBlake(`${marca(r)}⚠️ Le he enviado el precio a ${nombreDe(r)}, pero no he podido guardar el plazo de ${PLAZO_PRECIO_HORAS} h: no se cerrará sola. Revisa la reserva.`);
    }
  }

  // -------------------------------------------------------------------------
  // Lo que escribe la clienta
  // -------------------------------------------------------------------------

  async function respuestaClienta(conversationId: string, textoBruto: string): Promise<void> {
    const texto = textoBruto.trim().slice(0, MAX_CARACTERES_CLIENTE);
    const conv = await deps.leerConversacion(conversationId);
    if (!conv || !texto) return;
    const ahora = deps.now();
    await deps.guardarMensaje(conversationId, "in", texto, false);
    await deps.actualizarConversacion(conversationId, { last_client_message_at: ahora.toISOString() });
    const prefijo = conv.canal === "prueba" ? "🧪 PRUEBA · " : "";

    const senales = detectarInyeccion(texto);
    if (senales.length) {
      await deps.marcarMensajeSospechoso(conversationId);
      await deps.logSecurity({ kind: "posible_inyeccion", source: "filtro_de_texto", conversation_id: conversationId, detail: { origen: "respuesta_de_clienta", senales } });
      await avisarBlake(`${prefijo}🚩 POSIBLE MANIPULACIÓN en la respuesta de una clienta (${senales.join(", ")}).\nNo se ha contestado nada.\n\n💬 «${limpiarTexto(texto, 400)}»`);
      return;
    }

    const r = await deps.reservaActivaDe(conversationId);
    if (!r) {
      await avisarBlake(`${prefijo}💬 Ha escrito la clienta (no hay nada pendiente que Kira gestione solo):\n\n«${limpiarTexto(texto, 600)}»\n\nContéstale tú.`);
      return;
    }
    const ids = idsDe(r);
    if (await deps.estaPausada()) {
      await deps.logEvent({ source: "system", kind: "respuesta_clienta_con_kira_pausada", level: "warn", summary: "Kira está en pausa: la respuesta de la clienta no se gestiona", ...ids });
      await avisarBlake(`${marca(r)}⏸ Kira está en pausa y ${nombreDe(r)} ha escrito:\n\n«${limpiarTexto(texto, 600)}»\n\nNo he hecho nada.`);
      return;
    }

    if (r.client_phase === "precio_enviado") {
      if (esAceptacion(texto, true)) return aceptar(r, conv);
    } else if (r.client_phase === "pago_pedido") {
      if (esConfirmado(texto)) return confirmar(r, conv);
      if (esAceptacion(texto, false)) {
        await deps.logEvent({ source: "system", kind: "respuesta_clienta_ignorada", summary: "La clienta repitió un «vale» tras pedirle el Bizum: no se hace nada", ...ids });
        return;
      }
    }
    await deps.logEvent({ source: "system", kind: "respuesta_clienta_a_blake", summary: "Respuesta de la clienta que Kira no gestiona sola: reenviada a Blake", ...ids });
    await avisarBlake(
      `${marca(r)}💬 ${nombreDe(r)} ha escrito (${r.client_phase === "pago_pedido" ? "esperaba su «confirmado»" : "esperaba su «vale»"}):\n\n«${limpiarTexto(texto, 600)}»\n\nNo he contestado nada: respóndele tú.`,
    );
  }

  async function respuestaEnPrueba(chatId: number, texto: string): Promise<void> {
    if (!texto.trim()) {
      await deps.enviar(chatId, "Escribe lo que diría la clienta. Por ejemplo:\n\n/clienta vale\n/clienta confirmado\n\n(Contesta a la última prueba que está esperando respuesta.)");
      return;
    }
    const r = await deps.reservaDePruebaActiva();
    if (!r || !r.conversation_id) {
      await deps.enviar(chatId, "No hay ninguna prueba esperando respuesta de la clienta. Haz un /simular, apruébalo y vuelve a probar.");
      return;
    }
    await respuestaClienta(r.conversation_id, texto);
  }

  // -------------------------------------------------------------------------
  // «vale» → Bizum
  // -------------------------------------------------------------------------

  async function aceptar(r: Reserva, conv: ConversacionCanal): Promise<void> {
    const ids = idsDe(r);
    const lugar = contextoDe(r.spec ?? {});
    if (lugar.ubicacion !== "espana") {
      await avisarBlake(`${marca(r)}✅ ${nombreDe(r)} (${lugar.nombre}) ha dicho que sí al precio. El cobro por Stripe de Miami todavía no está conectado: escríbele tú cómo pagar la señal.`);
      return;
    }
    const bizum = await deps.bizum().catch(() => null);
    if (!bizum) {
      await avisarBlake(`${marca(r)}✅ ${nombreDe(r)} ha dicho que sí, pero no tengo tu número de Bizum. Guárdalo con /bizum 6XXXXXXXX y escríbele tú ahora.`);
      return;
    }
    const plazo = new Date(deps.now().getTime() + PLAZO_PAGO_MIN * MIN_MS);
    const ganada = await deps.avanzarFase(r.id, ["precio_enviado"], { client_phase: "pago_pedido", payment_deadline: plazo.toISOString() });
    if (!ganada) return; // otra ejecución ya la gestionó (dos «vale» seguidos)
    await deps.logEvent({ source: "system", kind: "clienta_acepta", summary: "La clienta aceptó el precio: se le pide el Bizum", ...ids });
    const texto = textoPagoPedido(ganada, bizum);
    const envio = await enviarAClienta(conv, texto, ganada);
    if (!envio.ok) {
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} ha aceptado, pero NO he podido pedirle el Bizum: ${motivoLegible(envio.motivo)}.\n\nEscríbele tú:\n«${texto}»`);
      return;
    }
    await avisarBlake(`${marca(r)}✅ ${nombreDe(r)} ha dicho que sí. Le he pedido el Bizum de ${dinero(r.deposit_cents, lugar.moneda)} al ${bizum}; tiene ${PLAZO_PAGO_MIN} minutos. Si escribe «confirmado», confirmo la cita y te aviso para que lo compruebes.`);
  }

  // -------------------------------------------------------------------------
  // «confirmado» → morado + invitación (opción C: automático, con aviso inmediato y botón de revertir)
  // -------------------------------------------------------------------------

  async function confirmar(r: Reserva, conv: ConversacionCanal): Promise<void> {
    const ids = idsDe(r);
    const eventoId = r.calendar_event_id;
    if (!eventoId || !deps.agenda) {
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} ha escrito «confirmado», pero no encuentro el evento de la reserva en el calendario. Míralo tú y usa «Señal recibida» (/pendientes).`);
      return;
    }
    const ganada = await deps.avanzarFase(r.id, ["pago_pedido"], { client_phase: "confirmada", payment_deadline: null });
    if (!ganada) return;

    let invitado = false;
    try {
      ({ invitado } = await deps.agenda.pasarAPagada(eventoId, r.id, { email: r.client_email, esPrueba: r.is_test }));
    } catch (e) {
      await deps.avanzarFase(r.id, ["confirmada"], { client_phase: "pago_pedido", payment_deadline: r.payment_deadline });
      await deps.logEvent({ source: "calendar", kind: "evento_pagado_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} ha escrito «confirmado», pero no he podido pasar la cita a morado (${describirFalloGoogle(e)}). Sigue en amarillo y con su plazo. Cuando compruebes el Bizum, usa «Señal recibida» (/pendientes).`);
      return;
    }
    const nonce = deps.newNonce();
    try {
      await deps.actualizarReserva(r.id, { status: "pagada", proposal_nonce: nonce });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "reserva_pagada_fallo", level: "error", summary: msg(e), ...ids });
      await avisarBlake(`${marca(r)}⚠️ El evento de ${nombreDe(r)} ya está en morado, pero no he podido guardar el pago (${msg(e)}). Revísalo en Fallos del panel.`);
      return;
    }
    await deps.logEvent({ source: "system", kind: "senal_confirmada_por_clienta", level: "warn", summary: "La clienta escribió «confirmado»: reserva confirmada sin esperar a Blake (él puede revertirla)", detail: { invitado }, ...ids });
    await deps.logEvent({ source: "calendar", kind: "evento_pagado", summary: `Evento pasado a morado${invitado ? " e invitada la clienta" : ""}`, ...ids });

    // Lo primero, el aviso a Blake con su botón: es lo que protege de un «confirmado» sin pago.
    const lugar = contextoDe(r.spec ?? {});
    const avisado = await avisarBlake(
      `${marca(r)}💜 ${nombreDe(r)} ha escrito «confirmado»: cita CONFIRMADA y en morado${invitado ? ` (invitación enviada a ${r.client_email})` : r.client_email ? ` (no he invitado a ${r.client_email}${r.is_test ? ": es una prueba y no es tu cuenta" : ""})` : ""}.\n\n🧾 ${r.service_description}\n💶 ${dinero(r.price_cents, lugar.moneda)} · señal ${dinero(r.deposit_cents, lugar.moneda)}\n\n⚠️ Mira tu Bizum: si NO te ha llegado, pulsa el botón y libero el hueco avisándola.`,
      tecladoRevertir(nonce),
    );
    if (!avisado) {
      await deps.actualizarReserva(r.id, { proposal_nonce: null }).catch(() => undefined);
    }
    const envio = await enviarAClienta(conv, textoConfirmada(r, invitado), r);
    if (!envio.ok) {
      await avisarBlake(`${marca(r)}⚠️ No he podido confirmarle la cita a ${nombreDe(r)} por mensaje: ${motivoLegible(envio.motivo)}. Escríbele tú.`);
    }
  }

  async function botonRevertir(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string }): Promise<void> {
    const responder = async (t?: string) => {
      try {
        await deps.responderCallback(b.callbackId, t);
      } catch (e) {
        await deps.logEvent({ source: "telegram", kind: "responder_boton_fallo", level: "warn", summary: msg(e) }).catch(() => undefined);
      }
    };
    const r = await deps.verReservaPorNonce(b.nonce);
    if (!r || r.status !== "pagada" || r.client_phase !== "confirmada") return responder("Ya procesado");
    if (!(await deps.tomarNonce(b.nonce, "pagada"))) return responder("Ya procesado");
    const ids = idsDe(r);
    const editar = async (t: string) => {
      if (b.messageId === null) return;
      await deps.editar(b.chatId, b.messageId, t).catch((e) => deps.logEvent({ source: "telegram", kind: "editar_mensaje_fallo", level: "warn", summary: msg(e), ...ids }).catch(() => undefined));
    };

    /** Algo falló: el botón ya se gastó, así que se ofrece uno nuevo. */
    const reofrecer = async (cb: string, aviso: string) => {
      await responder(cb);
      const nuevo = deps.newNonce();
      await deps.actualizarReserva(r.id, { proposal_nonce: nuevo }).catch(() => undefined);
      await avisarBlake(`${marca(r)}⚠️ ${aviso}`, tecladoRevertir(nuevo));
    };

    if (r.calendar_event_id && deps.agenda) {
      try {
        // Esta clienta ya recibió la invitación: se borra avisándola (Google le envía la cancelación).
        await deps.agenda.borrar(r.calendar_event_id, r.id, { avisarInvitados: true });
      } catch (e) {
        await deps.logEvent({ source: "calendar", kind: "evento_borrado_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
        return reofrecer("No se pudo borrar el evento", `No he podido borrar el evento (${describirFalloGoogle(e)}). Prueba otra vez con el botón de abajo.`);
      }
    }
    try {
      await deps.actualizarReserva(r.id, { status: "cancelada", client_phase: "cerrada", payment_deadline: null });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "reserva_cancelada_fallo", level: "error", summary: msg(e), ...ids });
      return reofrecer("No se pudo guardar", `El evento ya está borrado, pero no he podido cerrar la reserva (${msg(e)}). Pulsa otra vez.`);
    }
    await cerrarConversacion(r);
    await deps.retirarRegistro(r.id).catch(() => undefined);
    await responder("↩️ Revertida");
    await editar(`${marca(r)}↩️ REVERTIDA: no te llegó el Bizum de ${nombreDe(r)}.\n\nHe borrado el evento (y Google le avisa de la cancelación) y libero el hueco.`);
    await deps.logEvent({ source: "telegram", kind: "confirmacion_revertida_por_blake", level: "warn", summary: "Blake revirtió una confirmación: el Bizum no llegó", ...ids });
    const conv = r.conversation_id ? await deps.leerConversacion(r.conversation_id).catch(() => null) : null;
    const envio = await enviarAClienta(conv, textoRevertida(), r);
    if (!envio.ok) await avisarBlake(`${marca(r)}No he podido avisar a ${nombreDe(r)} por mensaje (${motivoLegible(envio.motivo)}). Escríbele tú.`);
  }

  // -------------------------------------------------------------------------
  // Blake actúa por su cuenta (sus botones de siempre)
  // -------------------------------------------------------------------------

  async function alConfirmarBlake(r: Reserva, invitado: boolean): Promise<void> {
    await deps.avanzarFase(r.id, [null, "precio_enviado", "pago_pedido"], { client_phase: "confirmada", payment_deadline: null }).catch(() => undefined);
    if (!r.conversation_id) return;
    const conv = await deps.leerConversacion(r.conversation_id).catch(() => null);
    const envio = await enviarAClienta(conv, textoConfirmada(r, invitado), r);
    if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido confirmarle la cita a ${nombreDe(r)} por mensaje (${motivoLegible(envio.motivo)}). Díselo tú.`);
  }

  async function alCancelarBlake(r: Reserva): Promise<void> {
    await deps.avanzarFase(r.id, [null, "precio_enviado", "pago_pedido", "confirmada"], { client_phase: "cerrada", payment_deadline: null }).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // El temporizador: plazos vencidos
  // -------------------------------------------------------------------------

  async function expirar(r: Reserva): Promise<boolean> {
    const ids = idsDe(r);
    const fase = r.client_phase as Fase;
    if (r.status !== "pendiente_pago") {
      // Ya no está esperando pago (la cerró alguien por otro camino): solo se limpia la fase.
      await deps.avanzarFase(r.id, [fase], { client_phase: "cerrada", payment_deadline: null });
      return false;
    }
    // 1. El evento amarillo (borrar es idempotente: si no existe, no pasa nada; solo borra el que lleva la marca de esta reserva).
    if (r.calendar_event_id && deps.agenda) {
      try {
        await deps.agenda.borrar(r.calendar_event_id, r.id);
      } catch (e) {
        await deps.logEvent({ source: "calendar", kind: "evento_borrado_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
        // Se vuelve a intentar dentro de unos minutos (sin avisar cada minuto).
        await deps.avanzarFase(r.id, [fase], { payment_deadline: new Date(deps.now().getTime() + REINTENTO_BORRADO_MIN * MIN_MS).toISOString() });
        await avisarBlake(`${marca(r)}⚠️ Se agotó el plazo de ${nombreDe(r)}, pero no he podido borrar su evento amarillo (${describirFalloGoogle(e)}). Lo reintento en ${REINTENTO_BORRADO_MIN} min; si no, bórralo tú.`);
        return false;
      }
    }
    // 2. Cierre atómico: solo una ejecución sigue.
    const ganada = await deps.avanzarFase(r.id, [fase], { client_phase: "cerrada", status: "expirada", payment_deadline: null });
    if (!ganada) return false;
    await cerrarConversacion(r);
    await deps.retirarRegistro(r.id).catch(() => undefined);
    await deps.logEvent({ source: "system", kind: "reserva_expirada", level: "warn", summary: fase === "pago_pedido" ? `La clienta no confirmó el Bizum en ${PLAZO_PAGO_MIN} min: hueco liberado` : `La clienta no respondió al precio en ${PLAZO_PRECIO_HORAS} h: hueco liberado`, detail: { fase }, ...ids });

    // 3. Avisos. Si no contestó al precio, se cierra en silencio (decisión de Blake); si dijo «vale» y no pagó, se le avisa.
    if (fase === "pago_pedido" && r.conversation_id) {
      const conv = await deps.leerConversacion(r.conversation_id).catch(() => null);
      const envio = await enviarAClienta(conv, textoLiberada(), r);
      if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido avisar a ${nombreDe(r)} de que libero el hueco (${motivoLegible(envio.motivo)}).`);
    }
    await avisarBlake(
      fase === "pago_pedido"
        ? `${marca(r)}⌛ ${nombreDe(r)} dijo que sí pero no confirmó el Bizum en ${PLAZO_PAGO_MIN} min: he borrado su evento amarillo y libero el hueco. Si en realidad pagó, vuelve a reservarla.`
        : `${marca(r)}⌛ ${nombreDe(r)} no respondió al precio en ${PLAZO_PRECIO_HORAS} h: he cerrado el chat, borrado su evento amarillo y liberado el hueco.`,
    );
    return true;
  }

  async function procesarVencidas(): Promise<{ cerradas: number }> {
    const lista = await deps.vencidas(deps.now(), 20);
    let cerradas = 0;
    for (const r of lista) {
      try {
        if (await expirar(r)) cerradas++;
      } catch (e) {
        await deps.logEvent({ source: "system", kind: "expirar_fallo", level: "error", summary: msg(e), ...idsDe(r) }).catch(() => undefined);
      }
    }
    return { cerradas };
  }

  async function vencerYa(chatId: number): Promise<void> {
    const r = await deps.reservaDePruebaActiva();
    if (!r) {
      await deps.enviar(chatId, "No hay ninguna prueba con plazo corriendo. Haz un /simular y aprueba la propuesta.");
      return;
    }
    await deps.actualizarReserva(r.id, { payment_deadline: new Date(deps.now().getTime() - MIN_MS).toISOString() });
    const { cerradas } = await procesarVencidas();
    await deps.enviar(chatId, cerradas ? "Plazo agotado: ya está cerrada (mira los mensajes de arriba)." : "He adelantado el plazo, pero no se ha podido cerrar ahora; lo intentará el temporizador (mira Fallos en el panel si no pasa nada).");
  }

  // -------------------------------------------------------------------------
  // /bizum
  // -------------------------------------------------------------------------

  async function bizum(chatId: number, texto: string): Promise<void> {
    const actual = await deps.bizum().catch(() => null);
    if (!texto.trim()) {
      await deps.enviar(chatId, actual ? `Tu número de Bizum es el ${actual}. Para cambiarlo: /bizum 6XXXXXXXX` : "Todavía no tengo tu número de Bizum. Guárdalo así: /bizum 6XXXXXXXX");
      return;
    }
    const nuevo = normalizarBizum(texto);
    if (!nuevo) {
      await deps.enviar(chatId, "Ese número no me cuadra: tiene que ser un móvil de España de 9 cifras. Por ejemplo: /bizum 662018425");
      return;
    }
    await deps.guardarBizum(nuevo);
    await deps.logEvent({ source: "telegram", kind: "bizum_guardado", summary: "Blake guardó su número de Bizum" });
    await deps.enviar(chatId, `Guardado: las clientas harán el Bizum al ${nuevo}.`);
  }

  return { alAprobar, alConfirmarBlake, alCancelarBlake, respuestaClienta, respuestaEnPrueba, botonRevertir, procesarVencidas, vencerYa, bizum };
}
