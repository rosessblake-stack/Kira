import { euros } from "./panel-rules";
import { fechaLarga, partesEn } from "./agenda";
import { evaluarHueco, textoChoques, type ResultadoAgenda } from "./agenda-eventos";
import { DIAS_BUSQUEDA, calcularOpciones, lineaOpcion, type OpcionHueco } from "./opciones";
import { eventoDeReserva, type AgendaPort } from "./evento";
import { idDeEvento } from "./google-calendar";
import { describirFalloGoogle } from "./google-oauth";
import { CONFIG_UBICACION, dinero, separarUbicacion, SIMBOLO, type Moneda, type Ubicacion } from "./ubicacion";
import type { Estancia } from "./estancias";
import type { ResumenFoto } from "./fotos";
import { aplicarLecturaFoto, validarLecturaFoto, type LecturaGuardada } from "./lectura-foto";
import type { SolicitudManychat } from "./manychat-entrada";
import { clasificacionDesdeFormulario } from "./formulario";
import {
  INTENCION_EN_BD,
  MAX_CARACTERES_CLIENTE,
  detectarInyeccion,
  limpiarTexto,
  superaLimites,
  validarClasificacion,
  type Clasificacion,
} from "./intents";
import type { FotoParaLeer, RespuestaClaude } from "./claude";
import { SinClaveError, describirErrorClaude } from "./claude";
import {
  construirPeticion,
  datosFaltantes,
  horasPorDefecto,
  materialesPorDefecto,
  type PerfilLegacy,
  type PrecioLegacy,
  type PeticionLegacy,
} from "./pricing";
import {
  AYUDA_EDICION,
  aplicarCambios,
  componerPropuesta,
  etiquetaCambio,
  parsearEdicion,
  specDesdeClasificacion,
  textoPropuesta,
  resumenCortoPropuesta,
  contextoDe,
  horarioDeSpec,
  type Cambio,
  type Propuesta,
  type ResultadoPrecio,
  type SpecGuardada,
} from "./proposal";

/**
 * Flujo de una propuesta de cita, de principio a fin, escrito contra interfaces (FlowDeps) para poder
 * probarlo entero con simulaciones. Reglas que cumple (docs/POLITICA.md y SEGURIDAD.md):
 *  - Claude solo clasifica; el precio lo calcula Legacy; todo lo demás es código.
 *  - Nada llega al cliente ni toca el calendario sin el botón Aprobar de Blake.
 *  - Ante duda, error o manipulación: silencio hacia el cliente y aviso a Blake.
 */

export type Reserva = {
  id: string;
  conversation_id: string | null;
  client_name: string;
  client_email: string | null;
  service_description: string;
  price_cents: number | null;
  deposit_cents: number | null;
  duration_minutes: number | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  spec: SpecGuardada;
  pricing: PricingGuardado;
  warnings: string[];
  reply_draft: string | null;
  proposal_nonce: string | null;
  telegram_message_id: number | null;
  edit_requested_at: string | null;
  is_test: boolean;
  /** Evento de Google Calendar de esta reserva (lo guarda Kira al aprobar: solo se borran eventos con este id). */
  calendar_event_id?: string | null;
  /** En qué punto de la conversación con la clienta está (lib/cliente-flow.ts). */
  client_phase?: "precio_enviado" | "pago_pedido" | "pago_declarado" | "liberada" | "opciones_enviadas" | "confirmada" | "cerrada" | null;
  /** Plazo de la fase actual (si vence, el temporizador cierra la reserva). */
  payment_deadline?: string | null;
  approved_by_telegram_user: number | null;
  approved_at: string | null;
};

export type PricingGuardado = {
  origen: ResultadoPrecio["origen"];
  /** Moneda de los importes (la de la ubicación de la clienta). Las propuestas antiguas, sin dato, son en euros. */
  moneda?: Moneda;
  perfil?: PerfilLegacy;
  horas?: number;
  materiales?: number;
  /** Respuesta íntegra de Legacy (auditable). */
  legacy?: PrecioLegacy;
  error?: string;
};

export type NuevaReserva = Omit<Reserva, "id" | "telegram_message_id" | "edit_requested_at" | "approved_by_telegram_user" | "approved_at">;

type Fuente = "manychat" | "stripe" | "telegram" | "typeform" | "claude" | "calendar" | "legacy" | "system";

export interface FlowDeps {
  now(): Date;
  newNonce(): string;
  clasificar(texto: string, ahora: Date, zonaHoraria?: string): Promise<RespuestaClaude>;
  /**
   * Lectura por reglas, SIN Claude. Solo para las conversaciones de prueba (/simular) y solo cuando falta la clave:
   * deja ver todo el recorrido antes de tenerla. Un canal real nunca debe usarla.
   */
  lecturaBasica?(texto: string, ahora: Date, zonaHoraria?: string): RespuestaClaude;
  /** Perfil de precios de Legacy de ese lugar (España o Miami). */
  perfil(ubicacion: Ubicacion): Promise<PerfilLegacy>;
  precio(peticion: PeticionLegacy): Promise<PrecioLegacy>;
  estaPausada(): Promise<boolean>;
  contarLlamadasClaudeHoy(): Promise<number>;

  /** Crea la conversación; en el canal «instagram» reutiliza la que ya tenga ese contacto de ManyChat. */
  crearConversacion(canal: "prueba" | "instagram", ref: string, nombre: string): Promise<string>;
  /** Mensajes de la clienta en la última hora (para el límite de ritmo de las solicitudes reales). */
  contarMensajesClienteUltimaHora?(conversationId: string): Promise<number>;
  /** Visión: las fotos guardadas de la conversación (la última de referencia y la última del pelo), ya descargadas. */
  fotosParaLeer?(conversationId: string): Promise<FotoParaLeer[]>;
  /** Visión: Claude lee las fotos. Solo se llama en solicitudes reales (Instagram). */
  leerFotos?(fotos: FotoParaLeer[]): Promise<RespuestaClaude>;
  guardarMensaje(conversationId: string, direccion: "in" | "out", cuerpo: string, marcado: boolean): Promise<void>;
  actualizarConversacion(id: string, patch: { intent?: string; status?: string; last_client_message_at?: string }): Promise<void>;
  crearReserva(r: NuevaReserva): Promise<Reserva>;
  actualizarReserva(id: string, patch: Partial<Omit<Reserva, "id">>): Promise<Reserva>;
  leerReserva(id: string): Promise<Reserva>;
  /** Marca como sospechosos los mensajes entrantes de la conversación (messages.flagged). */
  marcarMensajeSospechoso(conversationId: string): Promise<void>;
  verReservaPorNonce(nonce: string): Promise<Reserva | null>;
  /** Atómico: si el nonce sigue vigente (y la reserva está en ese estado: por defecto «propuesta»), lo gasta y devuelve la reserva. */
  tomarNonce(nonce: string, estado?: string): Promise<Reserva | null>;
  reservaEnEdicion(): Promise<Reserva | null>;

  /** El calendario de Blake. Sin él (o sin conectar) la propuesta avisa de que la disponibilidad NO está comprobada. */
  agenda?: AgendaPort;
  /** Los viajes de Blake a Miami (de qué fecha a qué fecha): la propuesta avisa si la fecha pedida no cuadra. */
  estancias(): Promise<Estancia[]>;
  /** Fotos que siguen guardadas de una conversación (resumen para la propuesta). */
  fotosDe(conversationId: string): Promise<ResumenFoto[]>;
  /** Guarda lo que Blake ve en la última foto de ese tipo. false si todavía no hay foto de ese tipo. */
  describirFoto(conversationId: string, tipo: "pelo" | "referencia", texto: string): Promise<boolean>;
  /** Envía a Blake las fotos guardadas de la conversación, antes de la propuesta (no hace nada si no hay). */
  enviarFotos(chatId: number, conversationId: string): Promise<void>;
  /** Guarda la foto fija de la cita al aprobarla (lo sugerido, lo aprobado) para calibrar horas y materiales con datos propios. */
  guardarRegistro(r: Reserva): Promise<void>;
  /** Quita el registro de una cita cancelada (no cuenta para calibrar). */
  retirarRegistro(bookingId: string): Promise<void>;
  /**
   * La conversación con la clienta tras el Aprobar (precio, «vale», Bizum, «confirmado»). Sin él, Aprobar solo reserva el hueco
   * y no se escribe a nadie (como antes de conectar Instagram).
   */
  cliente?: {
    alAprobar(r: Reserva): Promise<void>;
    alConfirmarBlake(r: Reserva, invitado: boolean): Promise<void>;
    alCancelarBlake(r: Reserva): Promise<void>;
    /** «Ofrecer opciones»: le escribe a la clienta los huecos alternativos y espera su número. */
    ofrecerOpciones?(r: Reserva, opciones: OpcionHueco[]): Promise<{ ok: true } | { ok: false; motivo: string }>;
  };
  /** Ficha de la clienta (reconocerla cuando vuelve): se rellena al aprobar y al confirmarse la cita. Nunca rompe la cita. */
  fichas?: { alAprobar(r: Reserva): Promise<void>; alConfirmarCita(r: Reserva): Promise<void> };
  /** Reservas que pueden haberse quedado sin botones (propuestas y citas provisionales), las más recientes primero. */
  listarPendientes(): Promise<Reserva[]>;

  logEvent(e: { source: Fuente; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown>; conversation_id?: string | null; booking_id?: string | null }): Promise<void>;
  logSecurity(e: { kind: "posible_inyeccion" | "limite_de_peticiones"; source: string; conversation_id?: string | null; detail?: Record<string, unknown> }): Promise<void>;

  /** `plegable`: resumen de la primera línea (lo que enseña la notificación); el texto entero va plegado debajo. */
  enviar(chatId: number, texto: string, markup?: unknown, opts?: { noPreview?: boolean; plegable?: string }): Promise<number | null>;
  editar(chatId: number, messageId: number, texto: string): Promise<void>;
  responderCallback(callbackId: string, texto?: string): Promise<void>;
}

export interface ProposalPort {
  /**
   * Crea la conversación de prueba y prepara la propuesta. `alCrear` se ejecuta nada más crearse la conversación
   * (así una foto enviada junto al mensaje queda guardada antes de la propuesta). Devuelve el id de la conversación.
   */
  simular(chatId: number, texto: string, alCrear?: (conversationId: string) => Promise<void>): Promise<string | null>;
  /**
   * Solicitud real del formulario de Instagram (ManyChat), en MODO SOMBRA: se prepara la propuesta para Blake, con las fotos y su
   * lectura, pero no se escribe a la clienta. `alCrear` guarda las fotos antes de la propuesta. Devuelve el id de la conversación.
   */
  recibirSolicitud(chatId: number, s: SolicitudManychat, alCrear?: (conversationId: string) => Promise<void>): Promise<string | null>;
  boton(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: "ok" | "ed" | "no" | "op" }): Promise<void>;
  /** Vuelve a mandar a Blake la propuesta de una reserva (p. ej. cuando la clienta elige una de las opciones). */
  reenviarPropuesta(chatId: number, reservaId: string, prefijo?: string): Promise<void>;
  /** Botones de una cita ya aprobada con reserva provisional en el calendario: señal recibida / cancelar. */
  botonCita(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: "pay" | "del" }): Promise<void>;
  /** /pendientes: vuelve a mandar los botones que se hayan perdido (reservas provisionales y propuestas sin botones). */
  pendientes(chatId: number): Promise<void>;
  /** Texto libre del administrador: si hay una edición abierta lo consume y devuelve true. */
  textoLibre(chatId: number, texto: string): Promise<boolean>;
  cancelarEdicion(chatId: number): Promise<boolean>;
}

/** Una edición abierta caduca a los 30 min; /cancelar recupera la propuesta en cualquier momento. */
export const EDICION_CADUCA_MIN = 30;

const aprobable = (r: Pick<Reserva, "price_cents" | "starts_at" | "ends_at">) =>
  r.price_cents !== null && Boolean(r.starts_at) && Boolean(r.ends_at);

const teclado = (nonce: string, puedeAprobar: boolean, puedeOfrecer = false) => ({
  inline_keyboard: [
    [
      ...(puedeAprobar ? [{ text: "✅ Aprobar", callback_data: `p:${nonce}:ok` }] : []),
      { text: "✏️ Editar", callback_data: `p:${nonce}:ed` },
      { text: "❌ Rechazar", callback_data: `p:${nonce}:no` },
    ],
    ...(puedeOfrecer ? [[{ text: "📨 Ofrecer opciones a la clienta", callback_data: `p:${nonce}:op` }]] : []),
  ],
});

const tecladoCita = (nonce: string) => ({
  inline_keyboard: [
    [
      { text: "💜 Señal recibida", callback_data: `c:${nonce}:pay` },
      { text: "🗑 Cancelar cita", callback_data: `c:${nonce}:del` },
    ],
  ],
});

const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");
const DIA_MS = 86_400_000;

type Canal = "prueba" | "instagram";

/** Lo que pide procesar un mensaje, venga de /simular (Telegram) o del formulario de Instagram (ManyChat). */
type Entrada = {
  canal: Canal;
  ref: string;
  nombreConversacion: string;
  texto: string;
  ubicacion: Ubicacion;
  /** Datos que el formulario ya trae estructurados (se validaron al leerlos): mandan sobre lo que interprete el clasificador. */
  fijos?: { nombre: string | null; email: string | null; instagram: string | null };
  /** Avisos propios de la entrada (p. ej. el país no era ni Miami ni España). */
  avisos?: string[];
  /** La clasificación ya hecha por código a partir de los campos del formulario (sin Claude). Si falta, clasifica Claude. */
  directa?: Clasificacion | null;
  alCrear?: (conversationId: string) => Promise<void>;
};

export function crearFlujoPropuestas(deps: FlowDeps): ProposalPort {
  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  async function calcularPrecio(
    spec: SpecGuardada,
    perfil: PerfilLegacy,
    ids: { conversation_id: string | null; booking_id?: string | null },
  ): Promise<{ resultado: ResultadoPrecio; guardado: PricingGuardado }> {
    const { moneda } = contextoDe(spec);
    if (spec.precio_manual_centimos !== null) {
      return {
        resultado: { origen: "manual", totalCentimos: spec.precio_manual_centimos },
        guardado: { origen: "manual", perfil, moneda },
      };
    }
    const faltan = datosFaltantes(spec.servicio);
    if (faltan.length) return { resultado: { origen: "sin_calcular", faltan }, guardado: { origen: "sin_calcular", perfil, moneda } };

    const horas = spec.horas ?? horasPorDefecto(spec.servicio);
    const materiales = spec.materiales ?? materialesPorDefecto(spec.servicio);
    try {
      const precio = await deps.precio(construirPeticion(spec.servicio, perfil, horas, materiales));
      await deps.logEvent({
        source: "legacy",
        kind: "precio_calculado",
        summary: `Legacy calculó ${dinero(precio.totalCentimos, moneda)} (${horas} h, materiales ${materiales} ${SIMBOLO[moneda]})`,
        detail: { horas, materiales, total_centimos: precio.totalCentimos, tarifa_hora: precio.tarifaHora },
        ...ids,
      });
      return { resultado: { origen: "legacy", precio }, guardado: { origen: "legacy", perfil, moneda, horas, materiales, legacy: precio } };
    } catch (e) {
      await deps.logEvent({ source: "legacy", kind: "legacy_error", level: "error", summary: msg(e), ...ids });
      return { resultado: { origen: "error", error: msg(e) }, guardado: { origen: "error", perfil, moneda, horas, materiales, error: msg(e) } };
    }
  }

  function resultadoGuardado(r: Reserva): ResultadoPrecio {
    const p = r.pricing;
    if (r.spec.precio_manual_centimos !== null) return { origen: "manual", totalCentimos: r.spec.precio_manual_centimos };
    if (p.origen === "legacy" && p.legacy) return { origen: "legacy", precio: p.legacy };
    if (p.origen === "error") return { origen: "error", error: p.error ?? "error de Legacy" };
    return { origen: "sin_calcular", faltan: datosFaltantes(r.spec.servicio) };
  }

  function filaDeReserva(prop: Propuesta, spec: SpecGuardada, guardado: PricingGuardado, nonce: string | null, conversationId: string | null, esPrueba = true): NuevaReserva {
    return {
      conversation_id: conversationId,
      client_name: prop.nombreCliente,
      client_email: prop.emailCliente,
      service_description: prop.descripcion,
      price_cents: prop.precioCentimos,
      deposit_cents: prop.senalCentimos,
      duration_minutes: prop.duracionMinutos,
      starts_at: prop.inicio ? prop.inicio.toISOString() : null,
      ends_at: prop.fin ? prop.fin.toISOString() : null,
      status: "propuesta",
      spec,
      pricing: guardado,
      warnings: prop.avisos,
      reply_draft: prop.borrador,
      proposal_nonce: nonce,
      is_test: esPrueba,
    };
  }

  const resumenDecision = (r: Reserva) => {
    const lugar = contextoDe(r.spec ?? {});
    return [
      `👤 ${r.spec?.nombre ?? "sin nombre"}${r.client_email ? ` (${r.client_email})` : ""} · 📍 ${lugar.nombre}`,
      `🧾 ${r.service_description}`,
      `📅 ${r.starts_at ? fechaLarga(new Date(r.starts_at), lugar.zonaHoraria) : "sin fecha"}${r.starts_at && r.ends_at ? ` → ${partesEn(new Date(r.ends_at), lugar.zonaHoraria).hora}` : ""} · 💶 ${dinero(r.price_cents, lugar.moneda)} (señal ${dinero(r.deposit_cents, lugar.moneda)})`,
    ].join("\n");
  };

  async function avisarADerivar(chatId: number, convId: string, titulo: string, texto: string, detalle?: Record<string, unknown>, canal: Canal = "prueba") {
    await deps.logEvent({ source: "system", kind: "derivado_a_blake", level: "warn", summary: titulo, detail: detalle, conversation_id: convId });
    await deps.actualizarConversacion(convId, { status: "esperando_aprobacion" });
    if (canal === "instagram") await deps.enviarFotos(chatId, convId).catch(() => undefined);
    await deps.enviar(
      chatId,
      `${canal === "prueba" ? "🧪 PRUEBA" : "📥 INSTAGRAM"} · DERIVADO A TI\n\n${titulo}\n\n💬 «${limpiarTexto(texto, 400)}»\n\nKira no ha preparado respuesta para el cliente.`,
    );
  }

  async function marcarManipulacion(chatId: number, convId: string, texto: string, origen: "filtro" | "modelo", senales: string[], canal: Canal = "prueba") {
    await deps.marcarMensajeSospechoso(convId);
    await deps.logSecurity({
      kind: "posible_inyeccion",
      source: origen === "filtro" ? "filtro_de_texto" : "claude",
      conversation_id: convId,
      detail: { origen, senales },
    });
    await deps.actualizarConversacion(convId, { status: "esperando_aprobacion" });
    await deps.enviar(
      chatId,
      `🚩 POSIBLE MANIPULACIÓN (${canal === "prueba" ? "prueba" : "Instagram"})\n\nEl mensaje intenta dar órdenes al sistema${senales.length ? ` (${senales.join(", ")})` : ""}.\nNo se ha contestado nada ni se ha preparado propuesta.\n\n💬 «${limpiarTexto(texto, 400)}»`,
    );
  }

  /** Si las fotos no se pueden leer, la propuesta sale igual (sin sección de fotos) y el fallo queda registrado. */
  async function fotosParaPropuesta(convId: string | null): Promise<ResumenFoto[] | undefined> {
    if (!convId) return undefined;
    try {
      return await deps.fotosDe(convId);
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "fotos_lectura_fallo", level: "warn", summary: msg(e), conversation_id: convId });
      return undefined;
    }
  }

  /** Si no se pueden leer los viajes, la propuesta sale igual (sin ese aviso) y el fallo queda registrado. */
  async function estanciasParaPropuesta(convId: string | null): Promise<Estancia[] | undefined> {
    try {
      return await deps.estancias();
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "viajes_lectura_fallo", level: "warn", summary: msg(e), conversation_id: convId });
      return undefined;
    }
  }

  /**
   * Lo que hay en el calendario de Blake para la fecha de la propuesta. Con el calendario conectado pero sin poder leerlo,
   * devuelve «error»: la propuesta no se puede aprobar (nunca se da por libre un hueco sin mirarlo).
   */
  async function agendaPara(spec: SpecGuardada, bookingId: string | null, convId: string | null): Promise<ResultadoAgenda> {
    if (!deps.agenda) return { estado: "no_conectado" };
    try {
      if (!(await deps.agenda.estado()).conectado) return { estado: "no_conectado" };
      const { inicio, fin } = horarioDeSpec(spec);
      if (!inicio || !fin) return { estado: "sin_horario" };
      const eventos = await deps.agenda.eventosEntre(new Date(inicio.getTime() - DIA_MS), new Date(fin.getTime() + DIA_MS));
      const lugar = contextoDe(spec);
      return { estado: "ok", hueco: evaluarHueco(inicio, fin, eventos, lugar.zonaHoraria, { excluirBookingId: bookingId, horario: lugar.reglas.horario }) };
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "agenda_lectura_fallo", level: "error", summary: describirFalloGoogle(e), conversation_id: convId, booking_id: bookingId });
      return { estado: "error", motivo: describirFalloGoogle(e) };
    }
  }

  /** «Ofrecer opciones»: solo si la hora choca con otra cita, hay conversación con la clienta y todavía no se ha ofrecido nada. */
  function puedeOfrecerOpciones(r: Reserva, agenda: ResultadoAgenda): boolean {
    return Boolean(deps.cliente?.ofrecerOpciones && r.conversation_id && r.starts_at && r.ends_at && !r.client_phase && agenda.estado === "ok" && agenda.hueco.choques.length > 0);
  }

  async function reenviarPropuesta(chatId: number, reservaId: string, prefijo = ""): Promise<void> {
    const r = await deps.leerReserva(reservaId);
    if (r.status !== "propuesta") return;
    await enviarPropuesta(chatId, r, prefijo);
  }

  async function enviarPropuesta(chatId: number, r: Reserva, prefijo = ""): Promise<void> {
    const spec = r.spec;
    const guardado = resultadoGuardado(r);
    const perfil = r.pricing.perfil ?? (await deps.perfil(contextoDe(spec).ubicacion));
    const fotos = await fotosParaPropuesta(r.conversation_id);
    const estancias = await estanciasParaPropuesta(r.conversation_id);
    const agenda = await agendaPara(spec, r.id, r.conversation_id);
    const prop = componerPropuesta(spec, guardado, { ahora: deps.now(), perfil, agenda, fotos, estancias });
    const nonce = deps.newNonce();
    // Primero el nonce vigente en la base de datos y luego el mensaje: el botón siempre encuentra su registro.
    const actualizada = await deps.actualizarReserva(r.id, {
      client_name: prop.nombreCliente,
      client_email: prop.emailCliente,
      service_description: prop.descripcion,
      price_cents: prop.precioCentimos,
      deposit_cents: prop.senalCentimos,
      duration_minutes: prop.duracionMinutos,
      starts_at: prop.inicio ? prop.inicio.toISOString() : null,
      ends_at: prop.fin ? prop.fin.toISOString() : null,
      warnings: prop.avisos,
      reply_draft: prop.borrador,
      proposal_nonce: nonce,
      edit_requested_at: null,
    });
    const texto = `${prefijo}${textoPropuesta(prop, spec, { mensajeCliente: spec.mensaje_cliente, esPrueba: actualizada.is_test, perfil, fotos, agenda })}`;
    let id: number | null;
    try {
      id = await deps.enviar(chatId, texto.slice(0, 4000), teclado(nonce, aprobable(actualizada) && prop.faltan.length === 0, puedeOfrecerOpciones(actualizada, agenda)), { plegable: resumenCortoPropuesta(prop, spec, actualizada.is_test) });
    } catch (e) {
      // El mensaje no llegó: el botón no existe, así que su nonce no puede quedar vivo (si no, /pendientes no vería la propuesta).
      await deps.actualizarReserva(r.id, { proposal_nonce: null }).catch(() => undefined);
      throw e;
    }
    if (id !== null) await deps.actualizarReserva(r.id, { telegram_message_id: id });
  }

  // -------------------------------------------------------------------------
  // /simular
  // -------------------------------------------------------------------------

  async function simular(chatId: number, textoBruto: string, alCrear?: (conversationId: string) => Promise<void>): Promise<string | null> {
    // «miami: …» al principio elige dónde está la clienta (en ManyChat lo decide el primer botón); sin él, España.
    const { ubicacion, texto: sinPrefijo } = separarUbicacion(textoBruto);
    const texto = sinPrefijo.trim().slice(0, MAX_CARACTERES_CLIENTE);
    if (!texto) {
      await deps.enviar(chatId, "Escribe el mensaje del cliente después de /simular. Por ejemplo:\n\n/simular Hola, quiero 6 trenzas con extensiones para el sábado a las 12\n\nPara una clienta de Miami: /simular miami: Hola, quiero 6 trenzas…");
      return null;
    }
    return procesarEntrada(chatId, { canal: "prueba", ref: `prueba-${deps.now().getTime().toString(36)}`, nombreConversacion: "Prueba", texto, ubicacion, alCrear });
  }

  async function recibirSolicitud(chatId: number, s: SolicitudManychat, alCrear?: (conversationId: string) => Promise<void>): Promise<string | null> {
    return procesarEntrada(chatId, {
      canal: "instagram",
      ref: s.contactoId,
      nombreConversacion: s.nombre ?? (s.instagram ? `@${s.instagram}` : "Instagram"),
      texto: s.texto.slice(0, MAX_CARACTERES_CLIENTE),
      ubicacion: s.ubicacion,
      fijos: { nombre: s.nombre, email: s.email, instagram: s.instagram ? `@${s.instagram}` : null },
      directa: clasificacionDesdeFormulario(s, deps.now(), CONFIG_UBICACION[s.ubicacion].zonaHoraria),
      avisos: s.ubicacionDudosa ? ["El campo «país» de la clienta no era ni Miami ni España: se ha tomado España. Si es de Miami, rechaza esta propuesta y vuelve a lanzarla."] : [],
      alCrear,
    });
  }

  async function procesarEntrada(chatId: number, entrada: Entrada): Promise<string | null> {
    const { canal, ubicacion, texto, alCrear } = entrada;
    const real = canal === "instagram";
    const ahora = deps.now();
    const lugar = CONFIG_UBICACION[ubicacion];

    const convId = await deps.crearConversacion(canal, entrada.ref, entrada.nombreConversacion);
    await deps.guardarMensaje(convId, "in", texto, false);
    await deps.actualizarConversacion(convId, { last_client_message_at: ahora.toISOString() });
    await deps.logEvent({
      source: real ? "manychat" : "system",
      kind: real ? "solicitud_recibida" : "mensaje_simulado",
      summary: real ? `Solicitud de Instagram recibida (${lugar.nombre})` : `Mensaje de cliente simulado recibido (${lugar.nombre})`,
      detail: { caracteres: texto.length, ubicacion },
      conversation_id: convId,
    });
    await procesarConversacion(chatId, convId, entrada, ahora);
    return convId;
  }

  async function procesarConversacion(chatId: number, convId: string, entrada: Entrada, ahora: Date): Promise<void> {
    const { canal, ubicacion, texto, alCrear } = entrada;
    const real = canal === "instagram";
    const lugar = CONFIG_UBICACION[ubicacion];
    if (alCrear) {
      try {
        await alCrear(convId);
      } catch (e) {
        // Un fallo con la foto no debe impedir la propuesta: queda registrado y Blake lo ve en Fallos.
        await deps.logEvent({ source: "system", kind: "adjunto_fallo", level: "error", summary: msg(e), conversation_id: convId });
      }
    }

    // 1. Pausa: solo avisa.
    if (await deps.estaPausada()) {
      await deps.logEvent({ source: "system", kind: "mensaje_con_kira_pausada", level: "warn", summary: "Kira está en pausa: no se prepara respuesta", conversation_id: convId });
      await deps.enviar(chatId, `⏸ KIRA EN PAUSA\n\nHa llegado ${real ? "una solicitud de Instagram" : "un mensaje (prueba)"} pero Kira está pausada: no se prepara respuesta.\n\n💬 «${limpiarTexto(texto, 400)}»\n\nReanuda Kira desde el panel.`);
      return;
    }

    // Domingo y lunes Blake no peina, pero SÍ contesta para dar citas (dicho por él): no hay silencio por día libre.
    // Solo importa el día de la CITA pedida, y eso lo avisa la propuesta (blando).

    // 2. Señales de manipulación: sin gastar una llamada a Claude y sin contestar.
    const senales = detectarInyeccion(texto);
    if (senales.length) return marcarManipulacion(chatId, convId, texto, "filtro", senales, canal);

    // 3. Límites de gasto.
    const mensajesHora = real && deps.contarMensajesClienteUltimaHora ? await deps.contarMensajesClienteUltimaHora(convId) : 1;
    const limite = superaLimites({ mensajesClienteUltimaHora: mensajesHora, llamadasClaudeHoy: await deps.contarLlamadasClaudeHoy() });
    if (limite) {
      await deps.logSecurity({ kind: "limite_de_peticiones", source: "claude", conversation_id: convId, detail: { motivo: limite } });
      await avisarADerivar(chatId, convId, limite === "ritmo_por_cliente" ? "Esta clienta ha mandado demasiadas solicitudes en poco tiempo: no se clasifica." : "Tope diario de llamadas a Claude alcanzado: no se clasifica.", texto, { motivo: limite }, canal);
      return;
    }

    // 4–5. Quién interpreta el mensaje. Un formulario de Instagram con la fecha ya entendida por código NO gasta Claude (ahorro de tokens);
    // el resto, sí: Claude clasifica y el código valida de forma estricta lo que devuelve.
    const clasificarConClaudeFlow = async (): Promise<{ c: Clasificacion; basica: boolean } | null> => {
      let respuesta: RespuestaClaude;
      let basica = false;
      try {
        respuesta = await deps.clasificar(texto, ahora, lugar.zonaHoraria);
      } catch (e) {
        const sinClave = e instanceof SinClaveError;
        if (sinClave && deps.lecturaBasica && !real) {
          // Sin clave: se lee con reglas simples (solo pruebas) para poder ver todo el recorrido. Cualquier otro
          // fallo de Claude NO cae aquí: ahí lo correcto es derivar a Blake.
          basica = true;
          respuesta = deps.lecturaBasica(texto, ahora, lugar.zonaHoraria);
          await deps.logEvent({ source: "system", kind: "lectura_basica", level: "warn", summary: "Sin clave de Claude: mensaje leído con la lectura básica por reglas (solo pruebas)", conversation_id: convId });
        } else {
          await deps.logEvent({ source: "claude", kind: sinClave ? "sin_clave_anthropic" : "claude_error", level: "error", summary: describirErrorClaude(e), conversation_id: convId });
          await avisarADerivar(chatId, convId, sinClave ? "Falta la clave de Claude (ANTHROPIC_API_KEY) en Vercel: no puedo clasificar." : "No he podido clasificar el mensaje (Claude no respondió).", texto, undefined, canal);
          return null;
        }
      }
      // La lectura básica no cuenta para el tope diario de llamadas a Claude porque no es una llamada.
      if (!basica) {
        await deps.logEvent({
          source: "claude",
          kind: "claude_llamada",
          summary: `Claude respondió (${respuesta.tipo})`,
          detail: respuesta.tipo === "ok" ? { entrada: respuesta.entrada, salida: respuesta.salida, modelo: respuesta.modelo ?? null, reintento: respuesta.reintento ?? false } : { resultado: respuesta.tipo },
          conversation_id: convId,
        });
      }
      if (respuesta.tipo !== "ok") {
        if (respuesta.tipo === "rechazo") {
          await deps.logSecurity({ kind: "posible_inyeccion", source: "claude", conversation_id: convId, detail: { origen: "rechazo_del_modelo" } });
        }
        await avisarADerivar(chatId, convId, `Claude no devolvió una clasificación utilizable (${respuesta.tipo}).`, texto, undefined, canal);
        return null;
      }

      // 5. Validación estricta: lo que no cuadra se descarta.
      const validada = validarClasificacion(respuesta.raw, texto);
      if (!validada.ok) {
        await deps.logEvent({ source: "claude", kind: "clasificacion_invalida", level: "warn", summary: `Clasificación descartada: ${validada.motivo}`, conversation_id: convId });
        await avisarADerivar(chatId, convId, "La clasificación de Claude no pasó la validación y se ha descartado.", texto, { motivo: validada.motivo }, canal);
        return null;
      }
      return { c: validada.value, basica };
    };
    let c: Clasificacion;
    let basica = false;
    let lector: "claude" | "basica" | "formulario" = "claude";
    if (entrada.directa) {
      c = entrada.directa;
      lector = "formulario";
      await deps.logEvent({ source: "system", kind: "formulario_leido", summary: "Formulario de Instagram leído por código, sin Claude (los datos ya vienen estructurados)", conversation_id: convId });
    } else {
      const r = await clasificarConClaudeFlow();
      if (!r) return;
      c = r.c;
      basica = r.basica;
      lector = basica ? "basica" : "claude";
    }
    await deps.actualizarConversacion(convId, { intent: INTENCION_EN_BD[c.intencion] });
    await deps.logEvent({ source: lector === "claude" ? "claude" : "system", kind: "clasificado", summary: `Intención: ${c.intencion} (confianza ${c.confianza})${basica ? " · lectura básica" : lector === "formulario" ? " · formulario" : ""}`, detail: { intencion: c.intencion, confianza: c.confianza, lector }, conversation_id: convId });

    if (c.manipulacion) return marcarManipulacion(chatId, convId, texto, "modelo", ["marcado_por_el_modelo"], canal);

    if (c.intencion !== "cita_salon") {
      const aun = c.intencion === "info_formacion_online" || c.intencion === "info_formacion_presencial";
      await avisarADerivar(
        chatId,
        convId,
        aun ? `Intención «${c.intencion}»: las formaciones todavía no están conectadas, te lo derivo.` : `Intención «${c.intencion}»: te lo derivo.`,
        texto,
        { intencion: c.intencion, notas: c.notas },
        canal,
      );
      return;
    }

    let lectura: LecturaGuardada | undefined;
    if (real) {
      // Los datos que el formulario ya trae estructurados (nombre, email, Instagram) mandan sobre lo que interprete el clasificador.
      const f = entrada.fijos;
      if (f) c = { ...c, nombre: f.nombre ?? c.nombre, email: f.email ?? c.email, instagram: f.instagram ?? c.instagram };
      if (entrada.avisos?.length) c = { ...c, avisosValidacion: [...c.avisosValidacion, ...entrada.avisos] };
      const vista = await leerLasFotos(chatId, convId, c, texto);
      if (vista === "manipulacion") return;
      if (vista) {
        c = vista.clasificacion;
        lectura = vista.guardada;
      }
    }
    await proponerCita(chatId, convId, c, texto, basica, ubicacion, { canal, lectura, lector });
  }

  /**
   * Visión (solo solicitudes reales): Claude describe las fotos y lo que vea rellena lo que la clienta no dijo, con aviso. Si falla,
   * la propuesta sale igual sin esa ayuda y Blake lo ve en el aviso. Una foto con órdenes dentro se trata como manipulación.
   */
  async function leerLasFotos(chatId: number, convId: string, c: Clasificacion, texto: string): Promise<{ clasificacion: Clasificacion; guardada: LecturaGuardada | undefined } | "manipulacion" | null> {
    if (!deps.fotosParaLeer || !deps.leerFotos) return null;
    const aviso = (t: string) => ({ clasificacion: { ...c, avisosValidacion: [...c.avisosValidacion, t] }, guardada: undefined });
    try {
      const fotos = await deps.fotosParaLeer(convId);
      if (fotos.length === 0) return aviso("La clienta no ha mandado fotos que se puedan leer: pídelas.");
      if (superaLimites({ mensajesClienteUltimaHora: 1, llamadasClaudeHoy: await deps.contarLlamadasClaudeHoy() })) {
        return aviso("No he leído las fotos (tope diario de llamadas a Claude alcanzado).");
      }
      const r = await deps.leerFotos(fotos);
      await deps.logEvent({
        source: "claude",
        kind: "claude_llamada",
        summary: `Claude leyó las fotos (${r.tipo})`,
        detail: r.tipo === "ok" ? { entrada: r.entrada, salida: r.salida, fotos: fotos.length, uso: "vision", modelo: r.modelo ?? null, reintento: r.reintento ?? false } : { resultado: r.tipo, uso: "vision" },
        conversation_id: convId,
      });
      if (r.tipo === "rechazo") {
        await deps.logSecurity({ kind: "posible_inyeccion", source: "claude", conversation_id: convId, detail: { origen: "rechazo_del_modelo", en: "fotos" } });
        await marcarManipulacion(chatId, convId, texto, "modelo", ["rechazo_del_modelo_en_fotos"], "instagram");
        return "manipulacion";
      }
      if (r.tipo !== "ok") return aviso(`No he podido leer las fotos (${r.tipo}): míralas tú.`);
      const v = validarLecturaFoto(r.raw, { referencia: fotos.some((f) => f.rol === "referencia"), pelo: fotos.some((f) => f.rol === "pelo") });
      if (!v.ok) {
        await deps.logEvent({ source: "claude", kind: "lectura_foto_invalida", level: "warn", summary: `Lectura de fotos descartada: ${v.motivo}`, conversation_id: convId });
        return aviso("La lectura de las fotos no pasó la validación y se ha descartado: míralas tú.");
      }
      if (v.value.manipulacion) {
        await deps.logSecurity({ kind: "posible_inyeccion", source: "claude", conversation_id: convId, detail: { origen: "marcado_por_el_modelo", en: "fotos" } });
        await marcarManipulacion(chatId, convId, texto, "modelo", ["instruccion_en_una_foto"], "instagram");
        return "manipulacion";
      }
      const hecho = aplicarLecturaFoto(c, v.value);
      await deps.logEvent({ source: "claude", kind: "fotos_leidas", summary: `Fotos leídas (confianza ${v.value.confianza}); rellenó: ${hecho.guardada.rellenados.join(", ") || "nada"}`, detail: { rellenados: hecho.guardada.rellenados, confianza: v.value.confianza }, conversation_id: convId });
      return hecho;
    } catch (e) {
      await deps.logEvent({ source: "claude", kind: "lectura_foto_fallo", level: "error", summary: describirErrorClaude(e), conversation_id: convId });
      return aviso("No he podido leer las fotos (fallo técnico): míralas tú.");
    }
  }

  async function proponerCita(
    chatId: number,
    convId: string,
    c: Clasificacion,
    texto: string,
    basica: boolean,
    ubicacion: Ubicacion,
    origen: { canal: Canal; lectura?: LecturaGuardada; lector?: "claude" | "basica" | "formulario" } = { canal: "prueba" },
  ) {
    const real = origen.canal === "instagram";
    const spec: SpecGuardada = {
      ...specDesdeClasificacion(c, texto, basica ? "basica" : origen.lector === "formulario" ? "formulario" : "claude", ubicacion),
      ...(real ? { origen: "instagram" as const } : {}),
      ...(origen.lectura ? { lectura_foto: origen.lectura } : {}),
    };
    const perfil = await deps.perfil(ubicacion);
    const { resultado, guardado } = await calcularPrecio(spec, perfil, { conversation_id: convId });
    const fotos = await fotosParaPropuesta(convId);
    const estancias = await estanciasParaPropuesta(convId);
    const agenda = await agendaPara(spec, null, convId);
    const prop = componerPropuesta(spec, resultado, { ahora: deps.now(), perfil, agenda, fotos, estancias });
    const nonce = deps.newNonce();
    const reserva = await deps.crearReserva(filaDeReserva(prop, spec, guardado, nonce, convId, !real));
    await deps.actualizarConversacion(convId, { status: "esperando_aprobacion" });
    const textoTg = textoPropuesta(prop, spec, { mensajeCliente: texto, esPrueba: !real, perfil, fotos, agenda });
    // Las fotos llegan primero: así Blake las tiene delante al leer la propuesta (nada si el cliente no mandó ninguna).
    if (fotos?.length) {
      try {
        await deps.enviarFotos(chatId, convId);
      } catch (e) {
        await deps.logEvent({ source: "telegram", kind: "foto_envio_fallo", level: "error", summary: msg(e), conversation_id: convId });
      }
    }
    let id: number | null;
    try {
      id = await deps.enviar(chatId, textoTg, teclado(nonce, aprobable(reserva) && prop.faltan.length === 0), { plegable: resumenCortoPropuesta(prop, spec, !real) });
    } catch (e) {
      await deps.actualizarReserva(reserva.id, { proposal_nonce: null }).catch(() => undefined);
      throw e;
    }
    if (id !== null) await deps.actualizarReserva(reserva.id, { telegram_message_id: id });
    await deps.logEvent({
      source: "telegram",
      kind: "propuesta_enviada",
      summary: prop.faltan.length ? `Propuesta enviada con datos pendientes: ${prop.faltan.join(" · ")}` : "Propuesta completa enviada a Blake",
      detail: { faltan: prop.faltan, avisos: prop.avisos.length, precio_origen: prop.precioOrigen },
      conversation_id: convId,
      booking_id: reserva.id,
    });
  }

  // -------------------------------------------------------------------------
  // Botones
  // -------------------------------------------------------------------------

  /**
   * ¿Hay que pasar por el calendario al aprobar? Si está conectado, sí. Si no se puede ni saber (fallo al leer la conexión),
   * también: es mejor que el calendario diga que no puede a aprobar sin mirarlo.
   */
  async function calendarioActivo(): Promise<boolean> {
    if (!deps.agenda) return false;
    try {
      return (await deps.agenda.estado()).conectado;
    } catch {
      return true;
    }
  }

  /** Vuelve a mandar la propuesta con botones nuevos (el nonce anterior ya se gastó) y un aviso delante. */
  async function devolverPropuesta(chatId: number, reservaId: string, aviso: string) {
    await enviarPropuesta(chatId, await deps.leerReserva(reservaId), aviso);
  }

  /** Contestar al botón nunca debe romper el flujo: Telegram rechaza contestar pasados unos segundos y nada depende de ello. */
  async function responder(callbackId: string, texto?: string) {
    try {
      await deps.responderCallback(callbackId, texto);
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "responder_boton_fallo", level: "warn", summary: msg(e) }).catch(() => undefined);
    }
  }

  /** Un paso secundario (anotar, registrar…) que, si falla, solo deja constancia: nunca deja colgado lo importante. */
  async function mejorEsfuerzo(nombre: string, ids: { conversation_id: string | null; booking_id: string }, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "paso_secundario_fallo", level: "warn", summary: `${nombre}: ${msg(e)}`, ...ids }).catch(() => undefined);
    }
  }

  /**
   * Manda a Blake el mensaje de la reserva provisional con sus botones (señal recibida / cancelar). Si Telegram falla, un texto
   * simple le dice cómo recuperarlos (/pendientes). Devuelve si los botones llegaron.
   */
  async function ofrecerBotonesCita(chatId: number, r: Reserva, nonce: string, aviso: string, ids: { conversation_id: string | null; booking_id: string }): Promise<boolean> {
    try {
      const id = await deps.enviar(chatId, textoProvisional(r, aviso), tecladoCita(nonce));
      if (id !== null) await mejorEsfuerzo("guardar el mensaje de la cita", ids, () => deps.actualizarReserva(r.id, { telegram_message_id: id }));
      return true;
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "botones_cita_fallo", level: "error", summary: msg(e), ...ids }).catch(() => undefined);
      try {
        await deps.enviar(chatId, `⚠️ ${aviso ? `${aviso}\n` : ""}La reserva de ${r.spec?.nombre ?? "la clienta"} está en tu calendario, pero no he podido mandarte sus botones. Escribe /pendientes y te los mando otra vez.`);
      } catch {
        /* sin Telegram no hay más que hacer: queda registrado y /pendientes los recupera */
      }
      return false;
    }
  }

  /** Vuelve a mandar la propuesta; si no se puede, un texto simple con la salida (/pendientes). */
  async function intentarDevolver(chatId: number, reservaId: string, aviso: string, ids: { conversation_id: string | null; booking_id: string }) {
    try {
      await devolverPropuesta(chatId, reservaId, aviso);
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "devolver_propuesta_fallo", level: "error", summary: msg(e), ...ids }).catch(() => undefined);
      try {
        await deps.enviar(chatId, `${aviso}No he podido mandarte la propuesta de nuevo (${msg(e)}). Escribe /pendientes para recibirla.`);
      } catch {
        /* queda registrado */
      }
    }
  }

  /**
   * Aprobar con el calendario conectado. Orden pensado para no crear NUNCA una cita encima de otra:
   *  1. se mira la agenda ahora mismo (lo que se vio al preparar la propuesta pudo cambiar);
   *  2. se reserva el hueco en la base de datos (segundo cerrojo: bookings_no_overlap);
   *  3. solo entonces se crea el evento provisional (amarillo). Si algo falla, se deshace y se vuelve a la propuesta.
   * Y, una vez creado el evento, LO PRIMERO es darle a Blake sus botones; todo lo demás es secundario.
   */
  async function aprobarConCalendario(
    b: { callbackId: string; chatId: number; fromId: number },
    r: Reserva,
    ids: { conversation_id: string | null; booking_id: string },
    editarMensaje: (t: string) => Promise<void>,
  ) {
    const agenda = deps.agenda as AgendaPort;
    const lugar = contextoDe(r.spec);
    const marca = r.is_test ? "🧪 PRUEBA · " : "";
    const inicio = new Date(r.starts_at as string);
    const fin = new Date(r.ends_at as string);
    const volver = async (cb: string, aviso: string) => {
      await responder(b.callbackId, cb);
      await editarMensaje(`${marca}↩️ No se ha aprobado: te mando la propuesta de nuevo (ver abajo).`);
      await intentarDevolver(b.chatId, r.id, aviso, ids);
    };

    // 1. La agenda, ahora.
    try {
      const eventos = await agenda.eventosEntre(new Date(inicio.getTime() - DIA_MS), new Date(fin.getTime() + DIA_MS));
      const hueco = evaluarHueco(inicio, fin, eventos, lugar.zonaHoraria, { excluirBookingId: r.id, horario: lugar.reglas.horario });
      if (hueco.choques.length) {
        await deps.logEvent({ source: "calendar", kind: "agenda_choque", level: "warn", summary: `Aprobación detenida: ${textoChoques(hueco, lugar.zonaHoraria).join("; ")}`, ...ids });
        return volver("Ese hueco está ocupado", `⛔ No he aprobado nada ni he creado ningún evento: ${textoChoques(hueco, lugar.zonaHoraria).join("; ")}.\nCambia la fecha o la hora con Editar.\n\n`);
      }
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "agenda_lectura_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      return volver("No puedo mirar tu agenda", `⚠️ No he aprobado nada: no he podido mirar tu calendario (${describirFalloGoogle(e)}). Sin mirarlo no creo ninguna cita.\n\n`);
    }

    // 2. El hueco, reservado en la base de datos (si otra reserva activa lo ocupa, la base de datos lo rechaza).
    const eventoId = idDeEvento(r.id);
    const nonceCita = deps.newNonce();
    const ahora = deps.now().toISOString();
    try {
      await deps.actualizarReserva(r.id, { status: "pendiente_pago", calendar_event_id: eventoId, proposal_nonce: nonceCita, approved_by_telegram_user: b.fromId, approved_at: ahora });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "reserva_hueco_fallo", level: "error", summary: msg(e), ...ids });
      return volver("No se pudo reservar el hueco", `⛔ No he aprobado nada: la base de datos no deja reservar ese hueco (${msg(e)}).\n\n`);
    }

    // 3. El evento provisional.
    try {
      await agenda.crearProvisional(eventoDeReserva({ ...r, status: "pendiente_pago" }));
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "evento_provisional_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      // Si Google llegó a crearlo pero la respuesta se perdió, no se deja un evento huérfano (solo borra uno con la marca de esta reserva).
      await agenda.borrar(eventoId, r.id).catch(() => undefined);
      try {
        await deps.actualizarReserva(r.id, { status: "propuesta", calendar_event_id: null, proposal_nonce: null, approved_by_telegram_user: null, approved_at: null });
      } catch (e2) {
        await deps.logEvent({ source: "system", kind: "reserva_deshacer_fallo", level: "error", summary: msg(e2), ...ids });
        await responder(b.callbackId, "Algo falló");
        try {
          await deps.enviar(b.chatId, `⚠️ No se pudo crear el evento y además no pude deshacer la reserva (${msg(e2)}). Mírala en Fallos del panel antes de seguir.`);
        } catch {
          /* queda registrado */
        }
        return;
      }
      return volver("No se pudo crear el evento", `⚠️ No he aprobado nada: Google Calendar no me ha dejado crear el evento (${describirFalloGoogle(e)}).\n\n`);
    }

    // 4. Hecho. Primero lo importante (los botones); después, lo secundario, que si falla solo deja constancia.
    await ofrecerBotonesCita(b.chatId, r, nonceCita, "", ids);
    await responder(b.callbackId, "✅ Aprobada · evento creado");
    await editarMensaje(`${marca}✅ APROBADA\n\n${resumenDecision(r)}\n\nReserva provisional creada en tu calendario (ver abajo).`);
    if (r.conversation_id) {
      const conv = r.conversation_id;
      await mejorEsfuerzo("estado de la conversación", ids, () => deps.actualizarConversacion(conv, { status: "esperando_cliente" }));
    }
    try {
      await deps.guardarRegistro({ ...r, status: "pendiente_pago" });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "registro_servicio_fallo", level: "error", summary: msg(e), ...ids });
    }
    await deps.logEvent({ source: "telegram", kind: "propuesta_aprobada", summary: "Propuesta aprobada por Blake", detail: { precio_centimos: r.price_cents }, ...ids });
    await mejorEsfuerzo("guardar la ficha de la clienta", ids, () => deps.fichas?.alAprobar(r) ?? Promise.resolve());
    await deps.logEvent({ source: "calendar", kind: "evento_provisional_creado", summary: "Evento provisional (amarillo) creado en Google Calendar", ...ids });
    if (deps.cliente) {
      // El precio a la clienta: lo último y secundario (si falla, Blake ya tiene sus botones y recibe un aviso).
      const cliente = deps.cliente;
      await mejorEsfuerzo("enviar el precio a la clienta", ids, () => cliente.alAprobar({ ...r, status: "pendiente_pago", calendar_event_id: eventoId }));
    } else {
      await deps.logEvent({ source: "system", kind: "respuesta_lista_sin_enviar", summary: "Respuesta aprobada pero sin enviar: el canal de Instagram no está conectado", ...ids });
    }
  }

  const textoProvisional = (r: Reserva, aviso = "") => {
    const lugar = contextoDe(r.spec);
    const email = r.client_email
      ? ` y se añade el email de la clienta (${r.client_email})${r.is_test ? "; en las pruebas solo si es el de tu propia cuenta de Google" : ""}`
      : "";
    const siguiente = deps.cliente
      ? [
          `Le mando el precio a la clienta. Si dice «vale», le pido el Bizum y, cuando escriba «confirmado», te pregunto con dos botones si te ha llegado: con «✅ Sí, me ha llegado» la cita pasa a morado${email}; con «❌ No me ha llegado» borro el evento y libero el hueco (y si ella dice «hecho», lo vuelvo a reservar y te pregunto otra vez).`,
          "Si no responde al precio en 20 h, o dice «vale» y no paga en 45 min, borro el evento y libero el hueco.",
          "Tú puedes adelantarte: «Señal recibida» la da por pagada y «Cancelar cita» borra el evento.",
        ]
      : [
          `Cuando recibas la señal (Bizum o Stripe), pulsa «Señal recibida»: el evento pasa a morado${email}.`,
          "Si la cita no va a ser, pulsa «Cancelar cita»: borro el evento.",
          "",
          "No se ha enviado nada al cliente (el canal de Instagram no está conectado).",
        ];
    return [
      `${r.is_test ? "🧪 PRUEBA · " : ""}📅 RESERVA PROVISIONAL (amarilla)`,
      ...(aviso ? ["", aviso] : []),
      "",
      resumenDecision(r),
      `📍 Dirección: ${r.spec.direccion ?? "sin indicar"} · 🌍 ${lugar.nombre}`,
      "",
      ...siguiente,
    ].join("\n");
  };

  /** Botones de una cita con reserva provisional: señal recibida / cancelar. Un solo uso cada vez; si algo falla, se vuelven a ofrecer. */
  async function botonCita(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: "pay" | "del" }) {
    const r = await deps.verReservaPorNonce(b.nonce);
    if (!r || r.status !== "pendiente_pago") {
      await responder(b.callbackId, "Ya procesado");
      return;
    }
    if (!(await deps.tomarNonce(b.nonce, "pendiente_pago"))) {
      await responder(b.callbackId, "Ya procesado");
      return;
    }
    const ids = { conversation_id: r.conversation_id, booking_id: r.id };
    const marca = r.is_test ? "🧪 PRUEBA · " : "";
    const editarMensaje = async (texto: string) => {
      if (b.messageId === null) return;
      try {
        await deps.editar(b.chatId, b.messageId, texto);
      } catch (e) {
        await deps.logEvent({ source: "telegram", kind: "editar_mensaje_fallo", level: "warn", summary: msg(e), ...ids }).catch(() => undefined);
      }
    };
    /** Algo falló: el botón se había gastado, así que se ofrece uno nuevo con el motivo. Nada queda sin salida. */
    const reofrecer = async (cb: string, aviso: string) => {
      await responder(b.callbackId, cb);
      const nuevo = deps.newNonce();
      let fresca: Reserva;
      try {
        fresca = await deps.actualizarReserva(r.id, { proposal_nonce: nuevo });
      } catch (e) {
        await deps.logEvent({ source: "system", kind: "botones_cita_fallo", level: "error", summary: msg(e), ...ids }).catch(() => undefined);
        try {
          await deps.enviar(b.chatId, `⚠️ ${aviso}\nY no he podido volver a ofrecerte los botones (${msg(e)}). Escribe /pendientes para recibirlos.`);
        } catch {
          /* queda registrado */
        }
        return;
      }
      await editarMensaje(`${marca}↩️ No se ha podido: te vuelvo a ofrecer los botones (ver abajo).`);
      await ofrecerBotonesCita(b.chatId, fresca, nuevo, `⚠️ ${aviso}`, ids);
    };

    const eventoId = r.calendar_event_id;
    if (!eventoId || !deps.agenda) {
      await deps.logEvent({ source: "calendar", kind: "evento_sin_id", level: "error", summary: "La reserva no tiene evento guardado o el calendario no está disponible", ...ids });
      return reofrecer("No encuentro el evento", "No encuentro el evento de esta reserva en el calendario.");
    }

    if (b.accion === "pay") {
      let invitado = false;
      try {
        ({ invitado } = await deps.agenda.pasarAPagada(eventoId, r.id, { email: r.client_email, esPrueba: r.is_test }));
      } catch (e) {
        await deps.logEvent({ source: "calendar", kind: "evento_pagado_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
        return reofrecer("No se pudo actualizar el evento", `No he podido pasar el evento a morado (${describirFalloGoogle(e)}). Puede que Google sí lo haya aplicado (incluida la invitación): míralo en tu calendario antes de reintentar.`);
      }
      try {
        await deps.actualizarReserva(r.id, { status: "pagada" });
      } catch (e) {
        await deps.logEvent({ source: "system", kind: "reserva_pagada_fallo", level: "error", summary: msg(e), ...ids });
        return reofrecer("No se pudo guardar", `El evento ya está morado, pero no he podido guardar el pago (${msg(e)}). Pulsa otra vez.`);
      }
      await responder(b.callbackId, "💜 Señal recibida");
      await editarMensaje(`${marca}💜 SEÑAL RECIBIDA · RESERVA CONFIRMADA\n\n${resumenDecision(r)}\n\nEl evento está en morado en tu calendario${invitado ? ` y he invitado a ${r.client_email} (Google le envía la invitación)` : r.client_email ? ` (no he invitado a ${r.client_email}${r.is_test ? ": es una prueba y no es tu cuenta" : ""})` : " (no tengo su email, así que no hay invitación)"}.`);
      await deps.logEvent({ source: "telegram", kind: "senal_confirmada_por_blake", summary: "Blake confirmó la señal: reserva pagada", detail: { invitado }, ...ids });
      await deps.logEvent({ source: "calendar", kind: "evento_pagado", summary: `Evento pasado a morado${invitado ? " e invitada la clienta" : ""}`, ...ids });
      await mejorEsfuerzo("anotar la cita en la ficha de la clienta", ids, () => deps.fichas?.alConfirmarCita({ ...r, status: "pagada" }) ?? Promise.resolve());
      if (deps.cliente) {
        const cliente = deps.cliente;
        await mejorEsfuerzo("confirmar la cita a la clienta", ids, () => cliente.alConfirmarBlake({ ...r, status: "pagada" }, invitado));
      }
      return;
    }

    // Cancelar: borra el evento que creó Kira para esta reserva (nada más) y cierra la reserva.
    try {
      await deps.agenda.borrar(eventoId, r.id);
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "evento_borrado_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      return reofrecer("No se pudo borrar el evento", `No he podido borrar el evento (${describirFalloGoogle(e)}). Puede que Google sí lo haya borrado: míralo en tu calendario antes de reintentar.`);
    }
    try {
      await deps.actualizarReserva(r.id, { status: "cancelada" });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "reserva_cancelada_fallo", level: "error", summary: msg(e), ...ids });
      return reofrecer("No se pudo guardar", `El evento ya está borrado, pero no he podido cerrar la reserva (${msg(e)}). Pulsa otra vez.`);
    }
    await responder(b.callbackId, "🗑 Cita cancelada");
    await editarMensaje(`${marca}🗑 CITA CANCELADA\n\n${resumenDecision(r)}\n\nHe borrado el evento de tu calendario. No se envía nada al cliente.`);
    if (r.conversation_id) {
      const conv = r.conversation_id;
      await mejorEsfuerzo("cerrar la conversación", ids, () => deps.actualizarConversacion(conv, { status: "cerrada" }));
    }
    // Una cita cancelada no cuenta para calibrar horas y materiales: su registro se retira.
    await mejorEsfuerzo("retirar el registro del servicio", ids, () => deps.retirarRegistro(r.id));
    if (deps.cliente) {
      const cliente = deps.cliente;
      await mejorEsfuerzo("cerrar el seguimiento de la clienta", ids, () => cliente.alCancelarBlake(r));
    }
    await deps.logEvent({ source: "telegram", kind: "cita_cancelada_por_blake", summary: "Blake canceló la cita: evento borrado", ...ids });
    await deps.logEvent({ source: "calendar", kind: "evento_borrado", summary: "Evento provisional borrado del calendario", ...ids });
  }

  /**
   * /pendientes: por si se perdió un mensaje con botones (Telegram falló), te los vuelve a mandar. Reservas provisionales
   * esperando señal (botones nuevos) y propuestas que se quedaron sin botones.
   */
  async function pendientes(chatId: number): Promise<void> {
    let lista: Reserva[];
    try {
      lista = await deps.listarPendientes();
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "pendientes_fallo", level: "error", summary: msg(e) });
      await deps.enviar(chatId, "No he podido leer las reservas pendientes. Prueba otra vez en un momento.");
      return;
    }
    const dePago = lista.filter((x) => x.status === "pendiente_pago").slice(0, 6);
    const sinBotones = lista.filter((x) => x.status === "propuesta" && !x.proposal_nonce && !x.edit_requested_at && !x.client_phase).slice(0, 6);
    if (!dePago.length && !sinBotones.length) {
      await deps.enviar(chatId, "No tienes ninguna reserva provisional esperando la señal ni propuestas sin botones.");
      return;
    }
    await deps.enviar(chatId, `Te mando otra vez los botones de ${dePago.length + sinBotones.length} ${dePago.length + sinBotones.length === 1 ? "reserva" : "reservas"}.`);
    for (const r of dePago) {
      const ids = { conversation_id: r.conversation_id, booking_id: r.id };
      const nonce = deps.newNonce();
      try {
        const fresca = await deps.actualizarReserva(r.id, { proposal_nonce: nonce });
        await ofrecerBotonesCita(chatId, fresca, nonce, "", ids);
      } catch (e) {
        await deps.logEvent({ source: "system", kind: "pendientes_fallo", level: "error", summary: msg(e), ...ids });
      }
    }
    for (const r of sinBotones) {
      try {
        await enviarPropuesta(chatId, r, "↩️ Esta propuesta se había quedado sin botones:\n\n");
      } catch (e) {
        await deps.logEvent({ source: "system", kind: "pendientes_fallo", level: "error", summary: msg(e), conversation_id: r.conversation_id, booking_id: r.id });
      }
    }
  }

  /** «📨 Ofrecer opciones»: calcula los huecos alternativos, se los escribe a la clienta y espera su número. Si algo falla, Blake recupera su propuesta con botones. */
  async function ofrecerOpciones(
    b: { callbackId: string; chatId: number },
    r: Reserva,
    ids: { conversation_id: string | null; booking_id: string },
    editarMensaje: (t: string) => Promise<void>,
  ): Promise<void> {
    const devolver = async (motivo: string) => {
      await responder(b.callbackId, "No se han enviado");
      await enviarPropuesta(b.chatId, await deps.leerReserva(r.id), `⚠️ No he podido ofrecer opciones: ${motivo}\n\n`);
    };
    if (!deps.cliente?.ofrecerOpciones || !deps.agenda || !r.starts_at || !r.ends_at) return devolver("falta el calendario o la conversación con la clienta.");
    const lugar = contextoDe(r.spec);
    const inicio = new Date(r.starts_at);
    const fin = new Date(r.ends_at);
    let opciones: OpcionHueco[];
    try {
      const eventos = await deps.agenda.eventosEntre(new Date(inicio.getTime() - DIA_MS), new Date(inicio.getTime() + (DIAS_BUSQUEDA + 2) * DIA_MS));
      const hueco = evaluarHueco(inicio, fin, eventos, lugar.zonaHoraria, { excluirBookingId: r.id, horario: lugar.reglas.horario });
      opciones = calcularOpciones({ inicio, fin, hueco, eventos, zona: lugar.zonaHoraria, reglas: lugar.reglas, ahora: deps.now(), excluirBookingId: r.id });
    } catch (e) {
      await deps.logEvent({ source: "calendar", kind: "agenda_lectura_fallo", level: "error", summary: describirFalloGoogle(e), ...ids });
      return devolver(`no he podido leer tu calendario (${describirFalloGoogle(e)}).`);
    }
    if (!opciones.length) return devolver("no encuentro huecos libres cerca de esa hora. Cambia la fecha con Editar o escríbele tú.");
    const envio = await deps.cliente.ofrecerOpciones(r, opciones);
    if (!envio.ok) return devolver(`no he podido escribir a la clienta (${envio.motivo === "ventana_24h" ? "han pasado más de 24 h desde su último mensaje" : envio.motivo === "canal_no_conectado" ? "Kira todavía no escribe por Instagram: modo sombra, escríbele tú" : envio.motivo}).`);
    await responder(b.callbackId, "📨 Opciones enviadas");
    await editarMensaje(`${r.is_test ? "🧪 PRUEBA · " : ""}📨 OPCIONES ENVIADAS a ${r.client_name ?? "la clienta"}\n\n${opciones.map((o, i) => `${i + 1}) ${lineaOpcion(o, lugar.zonaHoraria)}`).join("\n")}\n\nCuando conteste con un número te llega la propuesta nueva para aprobar.`);
    await deps.logEvent({ source: "telegram", kind: "opciones_ofrecidas", summary: `Blake ofreció ${opciones.length} opciones de hueco a la clienta`, detail: { opciones: opciones.length }, ...ids });
  }

  async function boton(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: "ok" | "ed" | "no" | "op" }) {
    const r = await deps.verReservaPorNonce(b.nonce);
    if (!r || r.status !== "propuesta") {
      await responder(b.callbackId, "Ya procesado");
      return;
    }
    const ids = { conversation_id: r.conversation_id, booking_id: r.id };

    if (b.accion === "ok" && !aprobable(r)) {
      await responder(b.callbackId, "Faltan datos: pulsa Editar");
      return;
    }
    const tomada = await deps.tomarNonce(b.nonce);
    if (!tomada) {
      await responder(b.callbackId, "Ya procesado");
      return;
    }

    const editarMensaje = async (texto: string) => {
      if (b.messageId === null) return;
      try {
        await deps.editar(b.chatId, b.messageId, texto);
      } catch (e) {
        await deps.logEvent({ source: "telegram", kind: "editar_mensaje_fallo", level: "warn", summary: msg(e), ...ids });
      }
    };

    if (b.accion === "op") {
      await ofrecerOpciones(b, r, ids, editarMensaje);
      return;
    }

    if (b.accion === "ok" && (await calendarioActivo())) {
      await aprobarConCalendario(b, r, ids, editarMensaje);
      return;
    }

    if (b.accion === "ok") {
      await deps.actualizarReserva(r.id, { status: "aprobada", approved_by_telegram_user: b.fromId, approved_at: deps.now().toISOString() });
      if (r.conversation_id) await deps.actualizarConversacion(r.conversation_id, { status: "esperando_cliente" });
      try {
        await deps.guardarRegistro({ ...r, status: "aprobada" });
      } catch (e) {
        // Que no se pueda anotar el registro no impide aprobar: queda a la vista en Fallos.
        await deps.logEvent({ source: "system", kind: "registro_servicio_fallo", level: "error", summary: msg(e), ...ids });
      }
      await responder(b.callbackId, "✅ Aprobada");
      await editarMensaje(
        `${r.is_test ? "🧪 PRUEBA · " : ""}✅ APROBADA\n\n${resumenDecision(r)}\n\nNo se ha enviado nada al cliente (el canal de Instagram no está conectado).\nSiguientes pasos pendientes de conectar: calendario (reserva provisional) y enlace de pago de la señal.`,
      );
      await deps.logEvent({ source: "telegram", kind: "propuesta_aprobada", summary: "Propuesta aprobada por Blake", detail: { precio_centimos: r.price_cents }, ...ids });
    await mejorEsfuerzo("guardar la ficha de la clienta", ids, () => deps.fichas?.alAprobar(r) ?? Promise.resolve());
      await deps.logEvent({ source: "system", kind: "respuesta_lista_sin_enviar", summary: "Respuesta aprobada pero sin enviar: el canal de Instagram no está conectado", ...ids });
      return;
    }

    if (b.accion === "no") {
      await deps.actualizarReserva(r.id, { status: "cancelada" });
      if (r.conversation_id) await deps.actualizarConversacion(r.conversation_id, { status: "cerrada" });
      await responder(b.callbackId, "❌ Rechazada");
      await editarMensaje(`${r.is_test ? "🧪 PRUEBA · " : ""}❌ RECHAZADA\n\n${resumenDecision(r)}\n\nNo se envía nada al cliente. Si quieres retomarla, escribe de nuevo con /simular.`);
      await deps.logEvent({ source: "telegram", kind: "propuesta_rechazada", summary: "Propuesta rechazada por Blake", ...ids });
      return;
    }

    // Editar
    await deps.actualizarReserva(r.id, { edit_requested_at: deps.now().toISOString() });
    await responder(b.callbackId, "✏️ Dime los cambios");
    await editarMensaje(`${r.is_test ? "🧪 PRUEBA · " : ""}✏️ EDITANDO\n\n${resumenDecision(r)}\n\nEscribe los cambios en el siguiente mensaje.`);
    await deps.enviar(b.chatId, AYUDA_EDICION);
    await deps.logEvent({ source: "telegram", kind: "edicion_solicitada", summary: "Blake pulsó Editar", ...ids });
  }

  // -------------------------------------------------------------------------
  // Edición por texto
  // -------------------------------------------------------------------------

  async function textoLibre(chatId: number, texto: string): Promise<boolean> {
    const r = await deps.reservaEnEdicion();
    if (!r) return false;
    const ids = { conversation_id: r.conversation_id, booking_id: r.id };

    const minutos = (deps.now().getTime() - Date.parse(r.edit_requested_at ?? "")) / 60_000;
    if (!(minutos <= EDICION_CADUCA_MIN)) {
      await deps.enviar(chatId, "La edición caducó. Escribe /cancelar y te vuelvo a mandar la propuesta con sus botones.");
      return true;
    }

    const lugar = contextoDe(r.spec);
    const { cambios: pedidos, errores } = parsearEdicion(texto, deps.now(), lugar.zonaHoraria);
    const esDeFoto = (c: Cambio) => c.k === "foto_pelo" || c.k === "foto_referencia";
    const cambios: Cambio[] = pedidos.filter((c) => !esDeFoto(c));
    // Lo que Blake ve en las fotos se guarda junto a cada foto; no cambia la reserva.
    for (const c of pedidos.filter(esDeFoto)) {
      const tipo = c.k === "foto_pelo" ? "pelo" : "referencia";
      if (c.k !== "foto_pelo" && c.k !== "foto_referencia") continue;
      if (r.conversation_id && (await deps.describirFoto(r.conversation_id, tipo, c.v))) {
        cambios.push(c);
        await deps.logEvent({ source: "telegram", kind: "foto_descrita", summary: `Blake describió la foto (${tipo})`, detail: { tipo, caracteres: c.v.length }, ...ids });
      } else {
        errores.push(`«${tipo}»: todavía no hay foto de ${tipo === "pelo" ? "su pelo" : "referencia"} guardada en esta conversación.`);
      }
    }
    if (!cambios.length) {
      await deps.enviar(chatId, `No he podido aplicar nada:\n• ${errores.join("\n• ") || "no he entendido el mensaje"}\n\nInténtalo de nuevo o escribe /cancelar.`);
      return true;
    }

    const { spec, perfil: cambioDePerfil, recalcular } = aplicarCambios(r.spec, cambios);
    // Lo que Blake cambie del perfil (estructura, zona, nivel, base) vale solo para esta cita.
    const perfil = { ...(r.pricing.perfil ?? (await deps.perfil(lugar.ubicacion))), ...cambioDePerfil };
    let guardado: PricingGuardado = r.pricing;
    if (recalcular || r.pricing.origen === "sin_calcular" || r.pricing.origen === "error") {
      guardado = (await calcularPrecio(spec, perfil, ids)).guardado;
    } else if (spec.precio_manual_centimos !== null) {
      // Se conserva lo último que calculó Legacy (para el registro: lo que Kira sugería frente a lo que Blake puso).
      guardado = { ...r.pricing, origen: "manual", perfil, moneda: lugar.moneda };
    }
    await deps.actualizarReserva(r.id, { spec, pricing: guardado });
    await deps.logEvent({ source: "telegram", kind: "propuesta_editada", summary: `Blake editó la propuesta (${cambios.map((c) => etiquetaCambio(c.k)).join(", ")})`, detail: { cambios: cambios.map((c) => c.k), recalculado: recalcular }, ...ids });

    const refrescada = await deps.leerReserva(r.id);
    const resumenCambios = `✏️ Cambios aplicados: ${cambios.map((c) => etiquetaCambio(c.k)).join(", ")}.${errores.length ? `\n⚠️ No he podido aplicar:\n• ${errores.join("\n• ")}` : ""}\n\n`;
    await enviarPropuesta(chatId, refrescada, resumenCambios);
    return true;
  }

  async function cancelarEdicion(chatId: number): Promise<boolean> {
    const r = await deps.reservaEnEdicion();
    if (!r) return false;
    await deps.logEvent({ source: "telegram", kind: "edicion_cancelada", summary: "Blake canceló la edición", conversation_id: r.conversation_id, booking_id: r.id });
    await enviarPropuesta(chatId, r, "↩️ Edición cancelada. Sigue como estaba:\n\n");
    return true;
  }

  return { simular, recibirSolicitud, boton, botonCita, reenviarPropuesta, pendientes, textoLibre, cancelarEdicion };
}
