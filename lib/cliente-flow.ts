import {
  PLAZO_PAGO_MIN,
  PLAZO_PRECIO_HORAS,
  esAceptacion,
  esConfirmado,
  normalizarBizum,
  textoConfirmada,
  textoLiberada,
  textoAcuse,
  textoCitaCancelada,
  textoMiamiPago,
  textoSolicitudRechazada,
  textoPagoPedido,
  textoPagoRecibido,
  textoPedirFecha,
  textoFechaPasada,
  textoPedirEmail,
  textoEmailRecibido,
  textoRevertida,
  ventanaAbierta,
} from "./clienta";
import { aUtc, fechaLarga } from "./agenda";
import { leerFechaHora } from "./fecha-texto";
import { evaluarHueco, textoChoques } from "./agenda-eventos";
import { eventoDeReserva } from "./evento";
import { idDeEvento } from "./google-calendar";
import { describirFalloGoogle } from "./google-oauth";
import { MAX_CARACTERES_CLIENTE, detectarInyeccion, limpiarTexto } from "./intents";
import { botonInstagram } from "./instagram";
import { DIAS_BUSQUEDA, calcularOpciones, interpretarElegida, lineaOpcion, motivoNoDisponible, textoOpciones, type MotivoNoDisponible, type OpcionHueco } from "./opciones";
import { partesEn } from "./agenda";
import { contextoDe, esSinFecha, horarioDeSpec } from "./proposal";
import type { FlowDeps, Reserva } from "./proposal-flow";
import { dinero } from "./ubicacion";

/**
 * La conversación con la clienta DESPUÉS de que Blake apruebe el precio (decisiones de Blake, 20-oct):
 *
 *   Aprobar ─► precio a la clienta ─► «vale» ─► Bizum (20 €, 45 min) ─► «confirmado» ─► Blake mira su banco y decide
 *              (plazo 20 h)                      (plazo 45 min)             ├─ «✅ Me ha llegado» → morado + invitación + confirmación
 *                                                                          └─ «❌ No me ha llegado» → evento borrado, hueco libre;
 *                                                                              si ella escribe «hecho», se vuelve a reservar y se le pregunta otra vez
 *
 *  - El hueco queda reservado en AMARILLO desde el Aprobar hasta que paga (morado). Si el plazo vence, se borra solo ese evento.
 *  - «confirmado» NO confirma nada por sí solo (cambio de Blake, 20-oct): la palabra de la clienta no prueba un pago. Kira le
 *    pregunta a Blake con dos botones y solo con «✅ Me ha llegado» pasa a morado y se invita a la clienta.
 *  - Solo se entienden respuestas cortas y exactas (lib/clienta.ts). Todo lo demás se le reenvía a Blake sin contestar nada.
 *  - Kira en pausa, mensaje con señales de manipulación, ventana de 24 h de Instagram cerrada o canal sin conectar: no se
 *    contesta a la clienta y se avisa a Blake.
 *  - Todo cambio de fase es atómico (solo gana una ejecución) y los plazos los cierra un temporizador (cron cada minuto).
 */

export type Fase = "precio_enviado" | "pago_pedido" | "pago_declarado" | "liberada" | "opciones_enviadas" | "confirmada" | "cerrada";

/** Mientras Blake no tenga el Bizum o no decida, la clienta que escribe «hecho» otra vez solo recibe silencio (ya está avisado). */
export const PLAZO_LIBERADA_HORAS = 20;

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
  /** Tiempo 2: los botones «Señal recibida / Cancelar cita» de la reserva que Kira acaba de crear sola. Opcional. */
  botonesCita?(r: Reserva, aviso: string): Promise<void>;
  /** La última cita pagada de la conversación a la que aún le falta el correo (se le pide al confirmar). Opcional. */
  citaSinEmailDe?(conversationId: string): Promise<Reserva | null>;
  /** Ya no se espera su respuesta (cita confirmada, cancelada o cerrada): quita la etiqueta que la mantiene en «esperando a Kira». Opcional. */
  liberarEspera?(conv: ConversacionCanal): Promise<void>;
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
  /** La solicitud aún sin decidir por Blake de una conversación (para avisarle si la clienta vuelve a escribir). */
  propuestaPendienteDe(conversationId: string): Promise<Reserva | null>;
  /** La última reserva de PRUEBA con conversación activa (para /clienta y /vencer). */
  reservaDePruebaActiva(): Promise<Reserva | null>;
  /** Reservas con plazo vencido en una fase activa. */
  vencidas(ahora: Date, limite: number): Promise<Reserva[]>;
  /** Vuelve a mandar a Blake la propuesta de una reserva con botones (cuando la clienta elige una opción). */
  nuevaPropuesta?(r: Reserva, prefijo: string): Promise<void>;
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
  /** Blake rechazó la solicitud: se quita la etiqueta «esperando_kira» para que la clienta pueda volver a empezar. */
  alRechazarBlake(r: Reserva): Promise<void>;
  /** Botón «📨 Avisar a la clienta» tras rechazar una solicitud. */
  avisarRechazada(chatId: number, reservaId: string): Promise<void>;
  /** Blake canceló la cita: se cierra el seguimiento. */
  alCancelarBlake(r: Reserva): Promise<void>;
  /** Lo que escribe la clienta (el webhook de ManyChat llamará aquí; en pruebas, /clienta). */
  respuestaClienta(conversationId: string, texto: string): Promise<void>;
  /** /clienta <texto>: Blake escribe como si fuera la clienta de la última prueba. */
  respuestaEnPrueba(chatId: number, texto: string): Promise<void>;
  /** Botón «❌ No me ha llegado» (el Bizum no entró): borra el evento, libera el hueco y se lo dice a la clienta. */
  botonNoLlego(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string }): Promise<void>;
  /** Blake pulsó «Ofrecer opciones»: se las escribe a la clienta y pasa a esperar su número (plazo de 20 h). */
  ofrecerOpciones(r: Reserva, opciones: OpcionHueco[], motivo?: MotivoNoDisponible): Promise<ResultadoEnvio>;
  /** Botón antiguo «❌ No me ha llegado nada» de una cita ya confirmada (revertir). */
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
const ACUSE_CADA_HORAS = 6;
const MARGEN_MIN = 60;
const DIA_MS = 86_400_000;
const EMAIL_EN_TEXTO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Los dos botones de Blake cuando la clienta dice que ya hizo el Bizum: «pay» es el de siempre («Señal recibida»). */
const tecladoPago = (nonce: string) => ({
  inline_keyboard: [[
    { text: "✅ Sí, me ha llegado", callback_data: `c:${nonce}:pay` },
    { text: "❌ No me ha llegado", callback_data: `c:${nonce}:nop` },
  ]],
});

const tecladoRevertir = (nonce: string) => ({ inline_keyboard: [[{ text: "❌ No me ha llegado nada", callback_data: `c:${nonce}:rev` }]] });

const MOTIVOS: Record<string, string> = {
  ventana_24h: "han pasado más de 24 h desde su último mensaje y Instagram no deja escribirle",
  canal_no_conectado: "Kira todavía no escribe a las clientas por Instagram (modo sombra)",
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

  /** Quita la etiqueta «esperando_kira» (mejor esfuerzo: nunca rompe el flujo). */
  async function liberarEspera(conv: ConversacionCanal | null): Promise<void> {
    if (!conv || !deps.liberarEspera) return;
    await deps.liberarEspera(conv).catch((e) => deps.logEvent({ source: "system", kind: "liberar_espera_fallo", level: "warn", summary: msg(e) }).catch(() => undefined));
  }

  /** Acuse corto a la clienta cuando escribe algo que Kira no gestiona sola (como mucho uno cada ACUSE_CADA_HORAS h). Nunca lanza. */
  async function acusar(r: Reserva, conv: ConversacionCanal): Promise<void> {
    try {
      const ultimo = r.spec?.acuse_at ? Date.parse(r.spec.acuse_at) : NaN;
      if (Number.isFinite(ultimo) && deps.now().getTime() - ultimo < ACUSE_CADA_HORAS * HORA_MS) return;
      const envio = await enviarAClienta(conv, textoAcuse(), r);
      if (envio.ok) await deps.actualizarReserva(r.id, { spec: { ...(r.spec ?? {}), acuse_at: deps.now().toISOString() } } as Partial<Reserva>);
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "acuse_fallo", level: "warn", summary: msg(e), ...idsDe(r) }).catch(() => undefined);
    }
  }

  async function cerrarConversacion(r: Reserva) {
    if (!r.conversation_id) return;
    await deps.actualizarConversacion(r.conversation_id, { status: "cerrada" }).catch(() => undefined);
    await liberarEspera(await deps.leerConversacion(r.conversation_id).catch(() => null));
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
        esSinFecha(r.spec)
          ? `${marca(r)}⚠️ NO he podido escribir a ${nombreDe(r)} con el precio: ${motivoLegible(envio.motivo)}.\n\nEscríbele tú. La solicitud sigue pendiente: puedes recuperarla con /pendientes.`
          : `${marca(r)}⚠️ He reservado el hueco (amarillo) pero NO he podido escribir a ${nombreDe(r)}: ${motivoLegible(envio.motivo)}.\n\nEscríbele tú con el precio y, cuando pague, pulsa «Señal recibida». Este hueco no caduca solo.`,
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
  // Hora ocupada: Blake ofrece huecos alternativos y la clienta elige con un número
  // -------------------------------------------------------------------------

  async function ofrecerOpciones(r: Reserva, opciones: OpcionHueco[], motivo?: MotivoNoDisponible): Promise<ResultadoEnvio> {
    const ids = idsDe(r);
    if (!r.conversation_id || !r.starts_at || !opciones.length) return { ok: false, motivo: "sin_conversacion" };
    const conv = await deps.leerConversacion(r.conversation_id);
    const lugar = contextoDe(r.spec ?? {});
    const texto = textoOpciones(r.spec?.nombre ?? null, new Date(r.starts_at), opciones, lugar.zonaHoraria, { motivo });
    // La fase se fija ANTES de escribir: si ella contesta enseguida, la respuesta ya encuentra sus opciones.
    const plazo = new Date(deps.now().getTime() + PLAZO_PRECIO_HORAS * HORA_MS);
    const ganada = await deps.avanzarFase(r.id, [null], { client_phase: "opciones_enviadas", payment_deadline: plazo.toISOString(), spec: { ...r.spec, opciones_hueco: opciones } });
    if (!ganada) return { ok: false, motivo: "ya_gestionada" };
    const envio = await enviarAClienta(conv, texto, ganada);
    if (!envio.ok) {
      await deps.avanzarFase(r.id, ["opciones_enviadas"], { client_phase: null, payment_deadline: null }).catch(() => undefined);
      return envio;
    }
    await deps.logEvent({ source: "system", kind: "opciones_enviadas_a_clienta", summary: `Opciones de hueco enviadas a la clienta (${opciones.length}); plazo ${PLAZO_PRECIO_HORAS} h`, detail: { opciones: opciones.length }, ...ids });
    return { ok: true };
  }

  /** La clienta contestó con un número: la reserva pasa a ese hueco y Blake recibe la propuesta nueva para aprobar. */
  async function elegirOpcion(r: Reserva, conv: ConversacionCanal, n: number): Promise<void> {
    const ids = idsDe(r);
    const o = r.spec?.opciones_hueco?.[n - 1];
    if (!o) return;
    if (esSinFecha(r.spec)) {
      // Precio primero (Tiempo 2): elegir un hueco = reservarlo y pedir el Bizum, sin otra propuesta a Blake.
      const hecho = await reservarHueco(r, conv, new Date(o.inicio), new Date(o.fin));
      if (!hecho) await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} eligió la opción ${n} pero no he podido reservarla sola. Escríbele tú.`);
      return;
    }
    const lugar = contextoDe(r.spec ?? {});
    const inicio = new Date(o.inicio);
    const p = partesEn(inicio, lugar.zonaHoraria);
    const ganada = await deps.avanzarFase(r.id, ["opciones_enviadas"], {
      client_phase: null,
      payment_deadline: null,
      starts_at: o.inicio,
      ends_at: o.fin,
      spec: { ...r.spec, fecha: p.fecha, hora: p.hora, opciones_hueco: undefined },
    });
    if (!ganada) return; // dos respuestas seguidas: solo gana una
    await deps.logEvent({ source: "system", kind: "clienta_elige_opcion", summary: `La clienta eligió la opción ${n}: ${lineaOpcion(o, lugar.zonaHoraria)}`, detail: { opcion: n }, ...ids });
    const envio = await enviarAClienta(conv, `¡Perfecto! Te apunto: ${lineaOpcion(o, lugar.zonaHoraria)} 😊 En un momento te confirmo el precio y cómo reservar el hueco.`, ganada);
    if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido confirmarle a ${nombreDe(r)} que ha elegido su hueco (${motivoLegible(envio.motivo)}).`);
    const prefijo = `${marca(r)}📨 ${nombreDe(r)} ha elegido la opción ${n}: ${lineaOpcion(o, lugar.zonaHoraria)}.\nAquí tienes la propuesta con la fecha nueva:\n\n`;
    try {
      if (!deps.nuevaPropuesta) throw new Error("sin_nueva_propuesta");
      await deps.nuevaPropuesta(ganada, prefijo);
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "nueva_propuesta_fallo", level: "error", summary: msg(e), ...ids });
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} eligió la opción ${n} (${lineaOpcion(o, lugar.zonaHoraria)}), pero no he podido mandarte la propuesta nueva. Usa /pendientes.`);
    }
  }

  // -------------------------------------------------------------------------
  // Tiempo 2: precio primero, fecha después (la clienta dice el día; Kira mira el calendario)
  // -------------------------------------------------------------------------

  /**
   * La clienta dijo un día y una hora. Devuelve true si Kira ya gestionó el mensaje; false = que lo reciba Blake (no se pudo decidir sola).
   * Hueco libre → reserva amarilla + Bizum. Ocupado, día libre de Blake o fuera de horario → opciones (con «o dime otro día»).
   */
  async function fechaElegida(r: Reserva, conv: ConversacionCanal, f: { fecha: string; hora: string }): Promise<boolean> {
    const ids = idsDe(r);
    const lugar = contextoDe(r.spec ?? {});
    const dur = r.duration_minutes;
    if (!deps.agenda || !dur || !r.client_phase) return false;
    const inicio = aUtc(f.fecha, f.hora, lugar.zonaHoraria);
    const fin = new Date(inicio.getTime() + dur * MIN_MS);
    if (inicio.getTime() <= deps.now().getTime()) {
      await enviarAClienta(conv, textoFechaPasada(), r);
      return true;
    }
    let eventos;
    try {
      eventos = await deps.agenda.eventosEntre(new Date(inicio.getTime() - DIA_MS), new Date(inicio.getTime() + (DIAS_BUSQUEDA + 2) * DIA_MS));
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "agenda_lectura_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      return false;
    }
    const hueco = evaluarHueco(inicio, fin, eventos, lugar.zonaHoraria, { excluirBookingId: r.id, horario: lugar.reglas.horario });
    const dia = partesEn(inicio, lugar.zonaHoraria);
    const motivo: MotivoNoDisponible | null = motivoNoDisponible(inicio, fin, hueco, lugar.zonaHoraria, lugar.reglas);

    if (motivo === null) return reservarHueco(r, conv, inicio, fin);

    const opciones = calcularOpciones({ inicio, fin, hueco, eventos, zona: lugar.zonaHoraria, reglas: lugar.reglas, ahora: deps.now(), excluirBookingId: r.id, maxDiasSiguientes: 3 });
    if (!opciones.length) return false;
    const faseAntes = r.client_phase as Fase;
    const plazo = new Date(deps.now().getTime() + PLAZO_PRECIO_HORAS * HORA_MS);
    const ganada = await deps.avanzarFase(r.id, [faseAntes], { client_phase: "opciones_enviadas", payment_deadline: plazo.toISOString(), spec: { ...r.spec, opciones_hueco: opciones } });
    if (!ganada) return true; // otra ejecución ya la gestionó
    const envio = await enviarAClienta(conv, textoOpciones(r.spec?.nombre ?? null, inicio, opciones, lugar.zonaHoraria, { motivo, otraFecha: true }), ganada);
    if (!envio.ok) {
      await deps.avanzarFase(r.id, ["opciones_enviadas"], { client_phase: faseAntes, payment_deadline: r.payment_deadline, spec: r.spec }).catch(() => undefined);
      return false;
    }
    await deps.logEvent({ source: "system", kind: "opciones_automaticas", summary: `La clienta pidió ${fechaLarga(inicio, lugar.zonaHoraria)}: no disponible (${motivo}); se le ofrecieron ${opciones.length} opciones`, detail: { motivo, opciones: opciones.length }, ...ids });
    await avisarBlake(`${marca(r)}📅 ${nombreDe(r)} pidió ${fechaLarga(inicio, lugar.zonaHoraria)} y ${motivo === "dia_libre" ? "es uno de tus días libres" : motivo === "fuera_horario" ? "queda fuera de tu horario" : "no está libre"}. Le he ofrecido ${opciones.length} ${opciones.length === 1 ? "opción" : "opciones"}; si elige una, reservo el hueco yo. No tienes que hacer nada.`);
    return true;
  }

  /** El hueco está libre: se reserva en la base de datos y en el calendario (amarillo) y se le pide el Bizum. Devuelve false si no se pudo. */
  async function reservarHueco(r: Reserva, conv: ConversacionCanal, inicio: Date, fin: Date): Promise<boolean> {
    const ids = idsDe(r);
    const lugar = contextoDe(r.spec ?? {});
    if (lugar.ubicacion !== "espana" || !deps.agenda) return false; // Miami: sin Stripe todavía, lo lleva Blake
    const bizum = await deps.bizum().catch(() => null);
    if (!bizum) return false;
    const faseAntes = r.client_phase as Fase;
    const eventoId = `${idDeEvento(r.id)}${deps.newNonce().slice(0, 6)}`;
    const p = partesEn(inicio, lugar.zonaHoraria);
    let ganada: Reserva | null;
    try {
      ganada = await deps.avanzarFase(r.id, [faseAntes], {
        client_phase: "pago_pedido",
        status: "pendiente_pago",
        starts_at: inicio.toISOString(),
        ends_at: fin.toISOString(),
        calendar_event_id: eventoId,
        payment_deadline: new Date(deps.now().getTime() + PLAZO_PAGO_MIN * MIN_MS).toISOString(),
        spec: { ...r.spec, fecha: p.fecha, hora: p.hora, opciones_hueco: undefined },
      });
    } catch (e) {
      // La base de datos no deja reservar encima de otra cita: no se reserva nada.
      await deps.logEvent({ source: "system", kind: "reserva_hueco_rechazada", level: "warn", summary: msg(e), ...ids });
      return false;
    }
    if (!ganada) return true; // otra ejecución ya la gestionó
    try {
      await deps.agenda.crearProvisional({ ...eventoDeReserva(ganada), id: eventoId });
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "evento_provisional_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      await deps.agenda.borrar(eventoId, r.id).catch(() => undefined);
      await deps.avanzarFase(r.id, ["pago_pedido"], { client_phase: faseAntes, status: "propuesta", starts_at: null, ends_at: null, calendar_event_id: null, payment_deadline: r.payment_deadline, spec: r.spec }).catch(() => undefined);
      return false;
    }
    await deps.logEvent({ source: "calendar", kind: "evento_provisional_creado", summary: "Evento provisional (amarillo) creado al elegir la clienta su día", ...ids });
    const texto = textoPagoPedido(ganada, bizum);
    const envio = await enviarAClienta(conv, texto, ganada);
    if (!envio.ok) await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} eligió ${fechaLarga(inicio, lugar.zonaHoraria)} y he reservado su hueco, pero NO he podido pedirle el Bizum: ${motivoLegible(envio.motivo)}.\n\nEscríbele tú:\n«${texto}»`);
    const aviso = `📅 ${nombreDe(r)} ha elegido ${fechaLarga(inicio, lugar.zonaHoraria)}. Estaba libre: he reservado el hueco en amarillo y ${envio.ok ? "le he pedido el Bizum" : "NO le he podido pedir el Bizum"} (${PLAZO_PAGO_MIN} min). Cuando te llegue la señal, pulsa «Señal recibida».`;
    if (deps.botonesCita) {
      await deps.botonesCita(ganada, aviso).catch(async (e) => {
        await deps.logEvent({ source: "system", kind: "botones_cita_fallo", level: "error", summary: msg(e), ...ids }).catch(() => undefined);
        await avisarBlake(`${marca(r)}${aviso}\n\n(No he podido mandarte sus botones: escribe /pendientes.)`);
      });
    } else await avisarBlake(`${marca(r)}${aviso}`);
    return true;
  }

  /** Tras el precio sin fecha: «vale» → pide el día; un día y una hora → mira el calendario. false = que lo lea Blake. */
  async function tratarFecha(r: Reserva, conv: ConversacionCanal, texto: string): Promise<boolean> {
    const lugar = contextoDe(r.spec ?? {});
    if (lugar.ubicacion !== "espana") return false;
    if (r.client_phase === "precio_enviado" && esAceptacion(texto, true)) {
      await enviarAClienta(conv, textoPedirFecha(), r);
      return true;
    }
    const f = leerFechaHora(texto, deps.now(), lugar.zonaHoraria);
    return f ? fechaElegida(r, conv, f) : false;
  }

  /** Cita confirmada sin correo: la clienta lo escribe y se le manda la invitación del calendario. */
  async function guardarEmailDeCita(cita: Reserva, conv: ConversacionCanal, email: string): Promise<void> {
    const ids = idsDe(cita);
    const limpio = email.toLowerCase();
    await deps.actualizarReserva(cita.id, { client_email: limpio, spec: { ...cita.spec, email: limpio } });
    let invitado = false;
    if (deps.agenda && cita.calendar_event_id) {
      try {
        ({ invitado } = await deps.agenda.pasarAPagada(cita.calendar_event_id, cita.id, { email: limpio, esPrueba: cita.is_test }));
      } catch (e) {
        await deps.logEvent({ source: "calendar", kind: "invitacion_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      }
    }
    await deps.logEvent({ source: "system", kind: "email_recibido_tras_confirmar", summary: `La clienta dio su correo tras confirmar${invitado ? " y se le invitó" : ""}`, ...ids });
    await enviarAClienta(conv, textoEmailRecibido(invitado, limpio), cita);
    await avisarBlake(`${marca(cita)}📧 ${nombreDe(cita)} te ha dado su correo (${limpio})${invitado ? " y le he mandado la invitación del calendario" : ". No he podido invitarla: añádelo tú al evento"}.`);
    await liberarEspera(conv);
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
      // Cita confirmada a la que se le pidió el correo: si lo escribe, se guarda y se le invita.
      const cita = deps.citaSinEmailDe ? await deps.citaSinEmailDe(conversationId).catch(() => null) : null;
      const correo = cita ? EMAIL_EN_TEXTO.exec(texto)?.[0] : null;
      if (cita && correo) return guardarEmailDeCita(cita, conv, correo);
      const pendiente = await deps.propuestaPendienteDe(conversationId).catch(() => null);
      if (pendiente) {
        // Blake aún no ha decidido su solicitud: el aviso lo dice claro y trae el botón para verla y decidir.
        const bIg = botonInstagram(pendiente.spec?.instagram);
        await deps.logEvent({ source: "system", kind: "clienta_escribe_con_propuesta_pendiente", summary: "La clienta escribió con su propuesta sin decidir", ...idsDe(pendiente) });
        await avisarBlake(
          `${marca(pendiente)}⏳ ${nombreDe(pendiente)} ha vuelto a escribir y todavía tienes su solicitud SIN decidir (Aprobar / Editar / Rechazar).\n\n«${limpiarTexto(texto, 600)}»\n\nPulsa «Ver propuesta» para decidir.`,
          { inline_keyboard: [[{ text: "📋 Ver propuesta", callback_data: `v:${pendiente.id.replace(/-/g, "")}` }], ...(bIg.length ? [bIg] : [])] },
        );
        if (!(await deps.estaPausada())) await acusar(pendiente, conv);
        return;
      }
      await liberarEspera(conv); // no se espera nada de ella: que la etiqueta no la atrape la próxima vez
      await avisarBlake(`${prefijo}💬 Ha escrito la clienta (no hay nada pendiente que Kira gestione solo):\n\n«${limpiarTexto(texto, 600)}»\n\nContéstale tú.`);
      return;
    }
    const ids = idsDe(r);
    if (await deps.estaPausada()) {
      await deps.logEvent({ source: "system", kind: "respuesta_clienta_con_kira_pausada", level: "warn", summary: "Kira está en pausa: la respuesta de la clienta no se gestiona", ...ids });
      await avisarBlake(`${marca(r)}⏸ Kira está en pausa y ${nombreDe(r)} ha escrito:\n\n«${limpiarTexto(texto, 600)}»\n\nNo he hecho nada.`);
      return;
    }

    const botonesIg = botonInstagram(r.spec?.instagram);

    if (r.client_phase === "precio_enviado") {
      if (esSinFecha(r.spec)) {
        if (await tratarFecha(r, conv, texto)) return;
      } else if (esAceptacion(texto, true)) return aceptar(r, conv);
    } else if (r.client_phase === "pago_pedido") {
      if (esConfirmado(texto)) return declararPago(r, conv);
      if (esAceptacion(texto, false)) {
        await deps.logEvent({ source: "system", kind: "respuesta_clienta_ignorada", summary: "La clienta repitió un «vale» tras pedirle el Bizum: no se hace nada", ...ids });
        return;
      }
    } else if (r.client_phase === "pago_declarado") {
      if (esConfirmado(texto) || esAceptacion(texto, false)) {
        await deps.logEvent({ source: "system", kind: "respuesta_clienta_ignorada", summary: "La clienta insiste en que ya pagó mientras Blake lo comprueba: no se hace nada", ...ids });
        return;
      }
    } else if (r.client_phase === "liberada") {
      if (esConfirmado(texto)) return reabrir(r, conv);
    } else if (r.client_phase === "opciones_enviadas") {
      const n = interpretarElegida(texto, r.spec?.opciones_hueco?.length ?? 0);
      if (n !== null) return elegirOpcion(r, conv, n);
      // Si ninguna le encaja y dice otro día y hora (solo con el precio primero), se vuelve a mirar el calendario.
      if (esSinFecha(r.spec) && (await tratarFecha(r, conv, texto))) return;
    }
    await deps.logEvent({ source: "system", kind: "respuesta_clienta_a_blake", summary: "Respuesta de la clienta que Kira no gestiona sola: reenviada a Blake", ...ids });
    // Mientras habla con Blake, el reloj de 20 h no debe cerrarle la solicitud: se reinicia con cada mensaje suyo.
    if (r.client_phase === "precio_enviado" || r.client_phase === "opciones_enviadas") {
      const nuevoPlazo = new Date(deps.now().getTime() + PLAZO_PRECIO_HORAS * HORA_MS).toISOString();
      await deps.avanzarFase(r.id, [r.client_phase], { payment_deadline: nuevoPlazo }).catch(() => undefined);
    }
    await avisarBlake(
      `${marca(r)}💬 ${nombreDe(r)} ha escrito (${r.client_phase === "pago_pedido" ? "esperaba su «confirmado»" : r.client_phase === "pago_declarado" ? "Blake está comprobando su Bizum" : r.client_phase === "liberada" ? "el hueco está liberado; esperaba su «hecho»" : r.client_phase === "opciones_enviadas" ? "esperaba que eligiera una de las opciones de hueco" : "esperaba su «vale»"}):\n\n«${limpiarTexto(texto, 600)}»\n\nNo he contestado nada: respóndele tú.`,
      botonesIg.length ? { inline_keyboard: [botonesIg] } : undefined,
    );
    await acusar(r, conv);
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
      const envioM = await enviarAClienta(conv, textoMiamiPago(), r);
      if (!envioM.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido decirle a ${nombreDe(r)} que le escribes enseguida (${motivoLegible(envioM.motivo)}).`);
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
    await avisarBlake(`${marca(r)}✅ ${nombreDe(r)} ha dicho que sí. Le he pedido el Bizum de ${dinero(r.deposit_cents, lugar.moneda)} al ${bizum}; tiene ${PLAZO_PAGO_MIN} minutos. Cuando escriba «confirmado», te pregunto con dos botones si te ha llegado y, solo si me dices que sí, confirmo la cita.`);
  }

  // -------------------------------------------------------------------------
  // «confirmado» → Blake mira su banco y decide (dos botones)
  // -------------------------------------------------------------------------

  /** El mensaje a Blake con «✅ Sí, me ha llegado» / «❌ No me ha llegado». Devuelve false si no se pudo mandar. */
  async function preguntarABlake(r: Reserva, cabecera: string): Promise<boolean> {
    const ids = idsDe(r);
    const lugar = contextoDe(r.spec ?? {});
    const nonce = deps.newNonce();
    try {
      await deps.actualizarReserva(r.id, { proposal_nonce: nonce });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "boton_pago_fallo", level: "error", summary: msg(e), ...ids });
      return false;
    }
    const avisado = await avisarBlake(
      `${marca(r)}${cabecera}\n\n🧾 ${r.service_description}\n💶 ${dinero(r.price_cents, lugar.moneda)} · señal ${dinero(r.deposit_cents, lugar.moneda)}${r.starts_at ? ` · 📅 ${fechaLarga(new Date(r.starts_at), lugar.zonaHoraria)}` : ""}\n\n👉 Mira tu banco: ¿te ha llegado el Bizum de ${dinero(r.deposit_cents, lugar.moneda)}?`,
      tecladoPago(nonce),
    );
    if (!avisado) await deps.actualizarReserva(r.id, { proposal_nonce: null }).catch(() => undefined);
    return avisado;
  }

  async function declararPago(r: Reserva, conv: ConversacionCanal): Promise<void> {
    const ids = idsDe(r);
    const ganada = await deps.avanzarFase(r.id, ["pago_pedido"], { client_phase: "pago_declarado", payment_deadline: null });
    if (!ganada) return; // dos «confirmado» seguidos: solo gana uno
    await deps.logEvent({ source: "system", kind: "pago_declarado_por_clienta", summary: "La clienta escribió «confirmado»: se le pregunta a Blake si le ha llegado el Bizum", ...ids });
    const ok = await preguntarABlake(ganada, `💬 ${nombreDe(r)} dice que ya ha hecho el Bizum.`);
    if (!ok) await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} dice que ya hizo el Bizum, pero no he podido ofrecerte los botones. Usa /pendientes (o «Señal recibida» si te ha llegado).`);
    const envio = await enviarAClienta(conv, textoPagoRecibido(), ganada);
    if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido decirle a ${nombreDe(r)} que lo estás comprobando (${motivoLegible(envio.motivo)}).`);
  }

  /**
   * La clienta dice «hecho» después de que Blake marcara que el Bizum no llegó (y el hueco quedó libre): se vuelve a reservar el hueco
   * (si sigue libre) y se le pregunta a Blake otra vez, sin que tenga que crear la cita a mano.
   */
  async function reabrir(r: Reserva, conv: ConversacionCanal): Promise<void> {
    const ids = idsDe(r);
    if (!deps.agenda || !r.starts_at || !r.ends_at) {
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} dice que ya hizo el Bizum, pero no puedo volver a reservar el hueco (falta el calendario o la hora). Míralo tú.`);
      return;
    }
    const lugar = contextoDe(r.spec ?? {});
    const inicio = new Date(r.starts_at);
    const fin = new Date(r.ends_at);
    // Evento NUEVO (identificador propio): el anterior se borró y Google conserva su identificador, así no se depende de «resucitarlo».
    const eventoId = `${idDeEvento(r.id)}${deps.newNonce().slice(0, 6)}`;
    try {
      const eventos = await deps.agenda.eventosEntre(new Date(inicio.getTime() - 86_400_000), new Date(fin.getTime() + 86_400_000));
      const hueco = evaluarHueco(inicio, fin, eventos, lugar.zonaHoraria, { excluirBookingId: r.id, horario: lugar.reglas.horario });
      if (hueco.choques.length) {
        await deps.logEvent({ source: "calendar", kind: "reabrir_choque", level: "warn", summary: `No se puede volver a reservar: ${textoChoques(hueco, lugar.zonaHoraria).join("; ")}`, ...ids });
        await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} dice que ya hizo el Bizum, pero su hueco ya no está libre (${textoChoques(hueco, lugar.zonaHoraria).join("; ")}). Escríbele tú y mira tu banco.`);
        return;
      }
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "agenda_lectura_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} dice que ya hizo el Bizum, pero no he podido mirar tu calendario (${describirFalloGoogle(e)}). Escríbele tú y mira tu banco.`);
      return;
    }
    // Se vuelve a reservar el hueco en la base de datos (si otra reserva lo ocupa, la base de datos lo rechaza).
    let ganada: Reserva | null;
    try {
      ganada = await deps.avanzarFase(r.id, ["liberada"], { client_phase: "pago_declarado", status: "pendiente_pago", calendar_event_id: eventoId, payment_deadline: null });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "reabrir_hueco_fallo", level: "error", summary: msg(e), ...ids });
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} dice que ya hizo el Bizum, pero el hueco ya está ocupado por otra reserva. Escríbele tú y mira tu banco.`);
      return;
    }
    if (!ganada) return; // otra ejecución ya lo gestionó
    try {
      await deps.agenda.crearProvisional({ ...eventoDeReserva({ ...ganada, status: "pendiente_pago" }), id: eventoId });
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "evento_provisional_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      await deps.agenda.borrar(eventoId, r.id).catch(() => undefined);
      await deps.avanzarFase(r.id, ["pago_declarado"], { client_phase: "liberada", status: "cancelada", payment_deadline: r.payment_deadline }).catch(() => undefined);
      await avisarBlake(`${marca(r)}⚠️ ${nombreDe(r)} dice que ya hizo el Bizum, pero Google no me ha dejado volver a crear la cita (${describirFalloGoogle(e)}). Escríbele tú y mira tu banco.`);
      return;
    }
    await deps.logEvent({ source: "system", kind: "reserva_reabierta", summary: "La clienta dijo que ya pagó tras liberar el hueco: hueco reservado de nuevo y pregunta a Blake", ...ids });
    const ok = await preguntarABlake(ganada, `🔁 ${nombreDe(r)} dice que ya ha hecho el Bizum (te había marcado que no llegó). He vuelto a reservar su hueco en amarillo.`);
    if (!ok) await avisarBlake(`${marca(r)}⚠️ He vuelto a reservar el hueco de ${nombreDe(r)}, pero no he podido ofrecerte los botones. Usa /pendientes.`);
    const envio = await enviarAClienta(conv, textoPagoRecibido(), ganada);
    if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido decirle a ${nombreDe(r)} que lo estás comprobando (${motivoLegible(envio.motivo)}).`);
  }

  async function botonNoLlego(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string }): Promise<void> {
    const responder = async (t?: string) => {
      try {
        await deps.responderCallback(b.callbackId, t);
      } catch (e) {
        await deps.logEvent({ source: "telegram", kind: "responder_boton_fallo", level: "warn", summary: msg(e) }).catch(() => undefined);
      }
    };
    const r = await deps.verReservaPorNonce(b.nonce);
    if (!r || r.status !== "pendiente_pago" || r.client_phase !== "pago_declarado") return responder("Ya procesado");
    if (!(await deps.tomarNonce(b.nonce, "pendiente_pago"))) return responder("Ya procesado");
    const ids = idsDe(r);
    const editar = async (t: string) => {
      if (b.messageId === null) return;
      await deps.editar(b.chatId, b.messageId, t).catch((e) => deps.logEvent({ source: "telegram", kind: "editar_mensaje_fallo", level: "warn", summary: msg(e), ...ids }).catch(() => undefined));
    };
    const reofrecer = async (cb: string, aviso: string) => {
      await responder(cb);
      const nuevo = deps.newNonce();
      await deps.actualizarReserva(r.id, { proposal_nonce: nuevo }).catch(() => undefined);
      await avisarBlake(`${marca(r)}⚠️ ${aviso}`, tecladoPago(nuevo));
    };

    if (r.calendar_event_id && deps.agenda) {
      try {
        await deps.agenda.borrar(r.calendar_event_id, r.id);
      } catch (e) {
        await deps.logEvent({ source: "calendar", kind: "evento_borrado_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
        return reofrecer("No se pudo borrar el evento", `No he podido borrar el evento (${describirFalloGoogle(e)}). Prueba otra vez con los botones de abajo.`);
      }
    }
    const plazo = new Date(deps.now().getTime() + PLAZO_LIBERADA_HORAS * HORA_MS).toISOString();
    const ganada = await deps.avanzarFase(r.id, ["pago_declarado"], { client_phase: "liberada", status: "cancelada", payment_deadline: plazo, proposal_nonce: null }).catch(() => null);
    if (!ganada) {
      await deps.logEvent({ source: "system", kind: "reserva_liberada_fallo", level: "error", summary: "No se pudo marcar la reserva como liberada", ...ids });
      return reofrecer("No se pudo guardar", "El evento ya está borrado, pero no he podido cerrar la reserva. Pulsa otra vez.");
    }
    await responder("↩️ Hueco liberado");
    await editar(`${marca(r)}↩️ NO LLEGÓ: el Bizum de ${nombreDe(r)} no te ha llegado.\n\nHe borrado su evento y libero el hueco. Si ella escribe «hecho» (u otra confirmación), vuelvo a reservar su hueco y te pregunto otra vez.`);
    await deps.logEvent({ source: "telegram", kind: "bizum_no_llego", level: "warn", summary: "Blake marcó que el Bizum no llegó: evento borrado y hueco liberado", ...ids });
    const conv = r.conversation_id ? await deps.leerConversacion(r.conversation_id).catch(() => null) : null;
    const envio = await enviarAClienta(conv, textoRevertida(), r);
    if (!envio.ok) await avisarBlake(`${marca(r)}No he podido avisar a ${nombreDe(r)} por mensaje (${motivoLegible(envio.motivo)}). Escríbele tú.`);
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
    await deps.avanzarFase(r.id, [null, "precio_enviado", "pago_pedido", "pago_declarado", "liberada"], { client_phase: "confirmada", payment_deadline: null }).catch(() => undefined);
    if (!r.conversation_id) return;
    const conv = await deps.leerConversacion(r.conversation_id).catch(() => null);
    const sinCorreo = !r.client_email;
    const envio = await enviarAClienta(conv, sinCorreo ? `${textoConfirmada(r, invitado)}\n\n${textoPedirEmail()}` : textoConfirmada(r, invitado), r);
    if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido confirmarle la cita a ${nombreDe(r)} por mensaje (${motivoLegible(envio.motivo)}). Díselo tú.`);
    // Sin correo, se sigue esperando su respuesta (la etiqueta se queda) para mandarle la invitación.
    if (!sinCorreo || !envio.ok) await liberarEspera(conv);
  }

  async function alCancelarBlake(r: Reserva): Promise<void> {
    const teniaAviso = r.client_phase === "precio_enviado" || r.client_phase === "pago_pedido" || r.client_phase === "pago_declarado" || r.client_phase === "confirmada";
    await deps.avanzarFase(r.id, [null, "precio_enviado", "pago_pedido", "pago_declarado", "liberada", "opciones_enviadas", "confirmada"], { client_phase: "cerrada", payment_deadline: null }).catch(() => undefined);
    // Si la clienta ya sabía de la cita (precio, Bizum o confirmada), se le dice que se ha cancelado.
    if (!r.conversation_id) return;
    const conv = await deps.leerConversacion(r.conversation_id).catch(() => null);
    if (!teniaAviso) return liberarEspera(conv);
    const envio = await enviarAClienta(conv, textoCitaCancelada(), r);
    await liberarEspera(conv);
    if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido avisar a ${nombreDe(r)} de que cancelaste su cita (${motivoLegible(envio.motivo)}). Díselo tú.`);
  }

  async function alRechazarBlake(r: Reserva): Promise<void> {
    if (!r.conversation_id) return;
    await liberarEspera(await deps.leerConversacion(r.conversation_id).catch(() => null));
  }

  /** Botón «📨 Avisar a la clienta» tras Rechazar una solicitud: una plantilla fija, una sola vez. */
  async function avisarRechazada(chatId: number, reservaId: string): Promise<void> {
    let r: Reserva;
    try {
      r = await deps.leerReserva(reservaId);
    } catch {
      await deps.enviar(chatId, "No encuentro esa solicitud.");
      return;
    }
    if (r.status !== "cancelada" || r.client_phase || !r.conversation_id) {
      await deps.enviar(chatId, "Esa solicitud ya no se puede avisar (no está rechazada o ya se gestionó).");
      return;
    }
    if (r.spec?.rechazo_avisado) {
      await deps.enviar(chatId, "Ya le avisaste a esa clienta.");
      return;
    }
    const marcada = await deps.avanzarFase(r.id, [null], { spec: { ...(r.spec ?? {}), rechazo_avisado: true } } as Partial<Reserva>).catch(() => null);
    if (!marcada) {
      await deps.enviar(chatId, "Ya le avisaste a esa clienta.");
      return;
    }
    const conv = await deps.leerConversacion(r.conversation_id).catch(() => null);
    const envio = await enviarAClienta(conv, textoSolicitudRechazada(), r);
    await liberarEspera(conv); // el aviso vuelve a poner la etiqueta: se quita para que pueda empezar de cero
    await deps.enviar(chatId, envio.ok ? `${marca(r)}📨 Le he avisado a ${nombreDe(r)}.` : `${marca(r)}No he podido avisar a ${nombreDe(r)} (${motivoLegible(envio.motivo)}). Escríbele tú.`);
    if (!envio.ok) await deps.avanzarFase(r.id, [null], { spec: { ...(r.spec ?? {}), rechazo_avisado: false } } as Partial<Reserva>).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // El temporizador: plazos vencidos
  // -------------------------------------------------------------------------

  async function expirar(r: Reserva): Promise<boolean> {
    const ids = idsDe(r);
    const fase = r.client_phase as Fase;
    if (fase === "opciones_enviadas") {
      // No eligió ningún hueco: se cierra en silencio (no hay evento que borrar: la propuesta nunca se aprobó).
      const cerrada = await deps.avanzarFase(r.id, [fase], { client_phase: "cerrada", status: "expirada", payment_deadline: null });
      if (!cerrada) return false;
      await cerrarConversacion(r);
      await deps.logEvent({ source: "system", kind: "opciones_sin_respuesta", level: "warn", summary: `La clienta no eligió ninguna opción en ${PLAZO_PRECIO_HORAS} h: se cierra`, ...ids });
      await avisarBlake(`${marca(r)}⌛ ${nombreDe(r)} no eligió ninguno de los huecos que le ofreciste en ${PLAZO_PRECIO_HORAS} h: he cerrado la solicitud.`);
      return true;
    }
    if (r.status === "propuesta" && fase === "precio_enviado") {
      // Aprobada sin fecha y sin respuesta de la clienta: no hay evento que borrar. Se cierra en silencio.
      const cerrada = await deps.avanzarFase(r.id, [fase], { client_phase: "cerrada", status: "expirada", payment_deadline: null });
      if (!cerrada) return false;
      await cerrarConversacion(r);
      await deps.retirarRegistro(r.id).catch(() => undefined);
      await deps.logEvent({ source: "system", kind: "reserva_expirada", level: "warn", summary: `La clienta no dijo ningún día en ${PLAZO_PRECIO_HORAS} h tras el precio: se cierra`, detail: { fase }, ...ids });
      await avisarBlake(`${marca(r)}⌛ ${nombreDe(r)} no dijo ningún día en ${PLAZO_PRECIO_HORAS} h tras el precio: he cerrado la solicitud.`);
      return true;
    }
    if (r.status !== "pendiente_pago") {
      // Ya no está esperando pago (la cerró alguien por otro camino): solo se limpia la fase.
      await deps.avanzarFase(r.id, [fase], { client_phase: "cerrada", payment_deadline: null });
      if (fase === "liberada") {
        // La clienta no volvió a decir que había pagado: se cierra en silencio y la cita deja de contar para calibrar.
        await cerrarConversacion(r);
        await deps.retirarRegistro(r.id).catch(() => undefined);
        await deps.logEvent({ source: "system", kind: "liberada_cerrada", summary: `La clienta no volvió a escribir en ${PLAZO_LIBERADA_HORAS} h tras liberar el hueco: se cierra`, ...ids });
      }
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
    // 2. Cierre atómico: solo una ejecución sigue. Si dijo «vale» y no pagó, el hueco se libera pero ella puede
    //    aún escribir «hecho» (fase «liberada», como cuando Blake marca que el Bizum no llegó): se vuelve a reservar.
    const reabrible = fase === "pago_pedido";
    const ganada = await deps.avanzarFase(
      r.id,
      [fase],
      reabrible
        ? { client_phase: "liberada", status: "cancelada", payment_deadline: new Date(deps.now().getTime() + PLAZO_LIBERADA_HORAS * HORA_MS).toISOString(), proposal_nonce: null }
        : { client_phase: "cerrada", status: "expirada", payment_deadline: null },
    );
    if (!ganada) return false;
    if (!reabrible) {
      await cerrarConversacion(r);
      await deps.retirarRegistro(r.id).catch(() => undefined);
    }
    await deps.logEvent({ source: "system", kind: "reserva_expirada", level: "warn", summary: fase === "pago_pedido" ? `La clienta no confirmó el Bizum en ${PLAZO_PAGO_MIN} min: hueco liberado` : `La clienta no respondió al precio en ${PLAZO_PRECIO_HORAS} h: hueco liberado`, detail: { fase }, ...ids });

    // 3. Avisos. Si no contestó al precio, se cierra en silencio (decisión de Blake); si dijo «vale» y no pagó, se le avisa.
    if (fase === "pago_pedido" && r.conversation_id) {
      const conv = await deps.leerConversacion(r.conversation_id).catch(() => null);
      const envio = await enviarAClienta(conv, textoLiberada(), r);
      if (!envio.ok) await avisarBlake(`${marca(r)}ℹ️ No he podido avisar a ${nombreDe(r)} de que libero el hueco (${motivoLegible(envio.motivo)}).`);
    }
    await avisarBlake(
      fase === "pago_pedido"
        ? `${marca(r)}⌛ ${nombreDe(r)} dijo que sí pero no confirmó el Bizum en ${PLAZO_PAGO_MIN} min: he borrado su evento amarillo y libero el hueco. Si ella escribe «hecho» en las próximas ${PLAZO_LIBERADA_HORAS} h, vuelvo a reservarlo y te pregunto.`
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

  return { alAprobar, alConfirmarBlake, alCancelarBlake, alRechazarBlake, avisarRechazada, ofrecerOpciones, respuestaClienta, respuestaEnPrueba, botonNoLlego, botonRevertir, procesarVencidas, vencerYa, bizum };
}
