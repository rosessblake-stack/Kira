import { euros } from "./panel-rules";
import { fechaLarga } from "./agenda";
import type { ResumenFoto } from "./fotos";
import {
  INTENCION_EN_BD,
  MAX_CARACTERES_CLIENTE,
  detectarInyeccion,
  limpiarTexto,
  superaLimites,
  validarClasificacion,
  type Clasificacion,
} from "./intents";
import type { RespuestaClaude } from "./claude";
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
  approved_by_telegram_user: number | null;
  approved_at: string | null;
};

export type PricingGuardado = {
  origen: ResultadoPrecio["origen"];
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
  clasificar(texto: string, ahora: Date): Promise<RespuestaClaude>;
  /**
   * Lectura por reglas, SIN Claude. Solo para las conversaciones de prueba (/simular) y solo cuando falta la clave:
   * deja ver todo el recorrido antes de tenerla. Un canal real nunca debe usarla.
   */
  lecturaBasica?(texto: string, ahora: Date): RespuestaClaude;
  perfil(): Promise<PerfilLegacy>;
  precio(peticion: PeticionLegacy): Promise<PrecioLegacy>;
  estaPausada(): Promise<boolean>;
  contarLlamadasClaudeHoy(): Promise<number>;

  crearConversacion(canal: "prueba", ref: string, nombre: string): Promise<string>;
  guardarMensaje(conversationId: string, direccion: "in" | "out", cuerpo: string, marcado: boolean): Promise<void>;
  actualizarConversacion(id: string, patch: { intent?: string; status?: string; last_client_message_at?: string }): Promise<void>;
  crearReserva(r: NuevaReserva): Promise<Reserva>;
  actualizarReserva(id: string, patch: Partial<Omit<Reserva, "id">>): Promise<Reserva>;
  leerReserva(id: string): Promise<Reserva>;
  /** Marca como sospechosos los mensajes entrantes de la conversación (messages.flagged). */
  marcarMensajeSospechoso(conversationId: string): Promise<void>;
  verReservaPorNonce(nonce: string): Promise<Reserva | null>;
  /** Atómico: si el nonce sigue vigente (y la reserva es una propuesta), lo gasta y devuelve la reserva. */
  tomarNonce(nonce: string): Promise<Reserva | null>;
  reservaEnEdicion(): Promise<Reserva | null>;

  /** Fotos que siguen guardadas de una conversación (resumen para la propuesta). */
  fotosDe(conversationId: string): Promise<ResumenFoto[]>;
  /** Guarda lo que Blake ve en la última foto de ese tipo. false si todavía no hay foto de ese tipo. */
  describirFoto(conversationId: string, tipo: "pelo" | "referencia", texto: string): Promise<boolean>;
  /** Envía a Blake las fotos guardadas de la conversación, antes de la propuesta (no hace nada si no hay). */
  enviarFotos(chatId: number, conversationId: string): Promise<void>;

  logEvent(e: { source: Fuente; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown>; conversation_id?: string | null; booking_id?: string | null }): Promise<void>;
  logSecurity(e: { kind: "posible_inyeccion" | "limite_de_peticiones"; source: string; conversation_id?: string | null; detail?: Record<string, unknown> }): Promise<void>;

  enviar(chatId: number, texto: string, markup?: unknown, opts?: { noPreview?: boolean }): Promise<number | null>;
  editar(chatId: number, messageId: number, texto: string): Promise<void>;
  responderCallback(callbackId: string, texto?: string): Promise<void>;
}

export interface ProposalPort {
  /**
   * Crea la conversación de prueba y prepara la propuesta. `alCrear` se ejecuta nada más crearse la conversación
   * (así una foto enviada junto al mensaje queda guardada antes de la propuesta). Devuelve el id de la conversación.
   */
  simular(chatId: number, texto: string, alCrear?: (conversationId: string) => Promise<void>): Promise<string | null>;
  boton(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: "ok" | "ed" | "no" }): Promise<void>;
  /** Texto libre del administrador: si hay una edición abierta lo consume y devuelve true. */
  textoLibre(chatId: number, texto: string): Promise<boolean>;
  cancelarEdicion(chatId: number): Promise<boolean>;
}

/** Una edición abierta caduca a los 30 min; /cancelar recupera la propuesta en cualquier momento. */
export const EDICION_CADUCA_MIN = 30;

const aprobable = (r: Pick<Reserva, "price_cents" | "starts_at" | "ends_at">) =>
  r.price_cents !== null && Boolean(r.starts_at) && Boolean(r.ends_at);

const teclado = (nonce: string, puedeAprobar: boolean) => ({
  inline_keyboard: [
    [
      ...(puedeAprobar ? [{ text: "✅ Aprobar", callback_data: `p:${nonce}:ok` }] : []),
      { text: "✏️ Editar", callback_data: `p:${nonce}:ed` },
      { text: "❌ Rechazar", callback_data: `p:${nonce}:no` },
    ],
  ],
});

const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");

export function crearFlujoPropuestas(deps: FlowDeps): ProposalPort {
  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  async function calcularPrecio(
    spec: SpecGuardada,
    perfil: PerfilLegacy,
    ids: { conversation_id: string | null; booking_id?: string | null },
  ): Promise<{ resultado: ResultadoPrecio; guardado: PricingGuardado }> {
    if (spec.precio_manual_centimos !== null) {
      return {
        resultado: { origen: "manual", totalCentimos: spec.precio_manual_centimos },
        guardado: { origen: "manual", perfil },
      };
    }
    const faltan = datosFaltantes(spec.servicio);
    if (faltan.length) return { resultado: { origen: "sin_calcular", faltan }, guardado: { origen: "sin_calcular", perfil } };

    const horas = spec.horas ?? horasPorDefecto(spec.servicio);
    const materiales = materialesPorDefecto(spec.servicio);
    try {
      const precio = await deps.precio(construirPeticion(spec.servicio, perfil, horas, materiales));
      await deps.logEvent({
        source: "legacy",
        kind: "precio_calculado",
        summary: `Legacy calculó ${euros(precio.totalCentimos)} (${horas} h, materiales ${materiales} €)`,
        detail: { horas, materiales, total_centimos: precio.totalCentimos, tarifa_hora: precio.tarifaHora },
        ...ids,
      });
      return { resultado: { origen: "legacy", precio }, guardado: { origen: "legacy", perfil, horas, materiales, legacy: precio } };
    } catch (e) {
      await deps.logEvent({ source: "legacy", kind: "legacy_error", level: "error", summary: msg(e), ...ids });
      return { resultado: { origen: "error", error: msg(e) }, guardado: { origen: "error", perfil, horas, materiales, error: msg(e) } };
    }
  }

  function resultadoGuardado(r: Reserva): ResultadoPrecio {
    const p = r.pricing;
    if (r.spec.precio_manual_centimos !== null) return { origen: "manual", totalCentimos: r.spec.precio_manual_centimos };
    if (p.origen === "legacy" && p.legacy) return { origen: "legacy", precio: p.legacy };
    if (p.origen === "error") return { origen: "error", error: p.error ?? "error de Legacy" };
    return { origen: "sin_calcular", faltan: datosFaltantes(r.spec.servicio) };
  }

  function filaDeReserva(prop: Propuesta, spec: SpecGuardada, guardado: PricingGuardado, nonce: string | null, conversationId: string | null): NuevaReserva {
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
      is_test: true,
    };
  }

  const resumenDecision = (r: Reserva) =>
    [
      `👤 ${r.spec?.nombre ?? "sin nombre"}${r.client_email ? ` (${r.client_email})` : ""}`,
      `🧾 ${r.service_description}`,
      `📅 ${r.starts_at ? fechaLarga(new Date(r.starts_at)) : "sin fecha"} · 💶 ${euros(r.price_cents)} (señal ${euros(r.deposit_cents)})`,
    ].join("\n");

  async function avisarADerivar(chatId: number, convId: string, titulo: string, texto: string, detalle?: Record<string, unknown>) {
    await deps.logEvent({ source: "system", kind: "derivado_a_blake", level: "warn", summary: titulo, detail: detalle, conversation_id: convId });
    await deps.actualizarConversacion(convId, { status: "esperando_aprobacion" });
    await deps.enviar(
      chatId,
      `🧪 PRUEBA · DERIVADO A TI\n\n${titulo}\n\n💬 «${limpiarTexto(texto, 400)}»\n\nKira no ha preparado respuesta para el cliente.`,
    );
  }

  async function marcarManipulacion(chatId: number, convId: string, texto: string, origen: "filtro" | "modelo", senales: string[]) {
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
      `🚩 POSIBLE MANIPULACIÓN (prueba)\n\nEl mensaje intenta dar órdenes al sistema${senales.length ? ` (${senales.join(", ")})` : ""}.\nNo se ha contestado nada ni se ha preparado propuesta.\n\n💬 «${limpiarTexto(texto, 400)}»`,
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

  async function enviarPropuesta(chatId: number, r: Reserva, prefijo = ""): Promise<void> {
    const spec = r.spec;
    const guardado = resultadoGuardado(r);
    const perfil = r.pricing.perfil ?? (await deps.perfil());
    const fotos = await fotosParaPropuesta(r.conversation_id);
    const prop = componerPropuesta(spec, guardado, { ahora: deps.now(), perfil, calendarioConectado: false, fotos });
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
    const texto = `${prefijo}${textoPropuesta(prop, spec, { mensajeCliente: spec.mensaje_cliente, esPrueba: actualizada.is_test, perfil, fotos })}`;
    const id = await deps.enviar(chatId, texto.slice(0, 4000), teclado(nonce, aprobable(actualizada)));
    if (id !== null) await deps.actualizarReserva(r.id, { telegram_message_id: id });
  }

  // -------------------------------------------------------------------------
  // /simular
  // -------------------------------------------------------------------------

  async function simular(chatId: number, textoBruto: string, alCrear?: (conversationId: string) => Promise<void>): Promise<string | null> {
    let convId: string | null = null;
    await procesarSimulacion(chatId, textoBruto, alCrear, (id) => {
      convId = id;
    });
    return convId;
  }

  async function procesarSimulacion(
    chatId: number,
    textoBruto: string,
    alCrear: ((conversationId: string) => Promise<void>) | undefined,
    conversacionCreada: (id: string) => void,
  ): Promise<void> {
    const ahora = deps.now();
    const texto = textoBruto.trim().slice(0, MAX_CARACTERES_CLIENTE);
    if (!texto) {
      await deps.enviar(chatId, "Escribe el mensaje del cliente después de /simular. Por ejemplo:\n\n/simular Hola, quiero 6 trenzas con extensiones para el sábado a las 12");
      return;
    }

    const convId = await deps.crearConversacion("prueba", `prueba-${ahora.getTime().toString(36)}`, "Prueba");
    conversacionCreada(convId);
    await deps.guardarMensaje(convId, "in", texto, false);
    await deps.actualizarConversacion(convId, { last_client_message_at: ahora.toISOString() });
    await deps.logEvent({ source: "system", kind: "mensaje_simulado", summary: "Mensaje de cliente simulado recibido", detail: { caracteres: texto.length }, conversation_id: convId });
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
      await deps.enviar(chatId, `⏸ KIRA EN PAUSA\n\nHa llegado un mensaje (prueba) pero Kira está pausada: no se prepara respuesta.\n\n💬 «${limpiarTexto(texto, 400)}»\n\nReanuda Kira desde el panel.`);
      return;
    }

    // 2. Señales de manipulación: sin gastar una llamada a Claude y sin contestar.
    const senales = detectarInyeccion(texto);
    if (senales.length) return marcarManipulacion(chatId, convId, texto, "filtro", senales);

    // 3. Límites de gasto.
    const limite = superaLimites({ mensajesClienteUltimaHora: 1, llamadasClaudeHoy: await deps.contarLlamadasClaudeHoy() });
    if (limite) {
      await deps.logSecurity({ kind: "limite_de_peticiones", source: "claude", conversation_id: convId, detail: { motivo: limite } });
      await avisarADerivar(chatId, convId, "Tope diario de llamadas a Claude alcanzado: no se clasifica.", texto, { motivo: limite });
      return;
    }

    // 4. Claude clasifica.
    let respuesta: RespuestaClaude;
    let basica = false;
    try {
      respuesta = await deps.clasificar(texto, ahora);
    } catch (e) {
      const sinClave = e instanceof SinClaveError;
      if (sinClave && deps.lecturaBasica) {
        // Sin clave: se lee con reglas simples (solo pruebas) para poder ver todo el recorrido. Cualquier otro
        // fallo de Claude NO cae aquí: ahí lo correcto es derivar a Blake.
        basica = true;
        respuesta = deps.lecturaBasica(texto, ahora);
        await deps.logEvent({ source: "system", kind: "lectura_basica", level: "warn", summary: "Sin clave de Claude: mensaje leído con la lectura básica por reglas (solo pruebas)", conversation_id: convId });
      } else {
        await deps.logEvent({ source: "claude", kind: sinClave ? "sin_clave_anthropic" : "claude_error", level: "error", summary: describirErrorClaude(e), conversation_id: convId });
        await avisarADerivar(chatId, convId, sinClave ? "Falta la clave de Claude (ANTHROPIC_API_KEY) en Vercel: no puedo clasificar." : "No he podido clasificar el mensaje (Claude no respondió).", texto);
        return;
      }
    }
    // La lectura básica no cuenta para el tope diario de llamadas a Claude porque no es una llamada.
    if (!basica) {
      await deps.logEvent({
        source: "claude",
        kind: "claude_llamada",
        summary: `Claude respondió (${respuesta.tipo})`,
        detail: respuesta.tipo === "ok" ? { entrada: respuesta.entrada, salida: respuesta.salida } : { resultado: respuesta.tipo },
        conversation_id: convId,
      });
    }
    if (respuesta.tipo !== "ok") {
      if (respuesta.tipo === "rechazo") {
        await deps.logSecurity({ kind: "posible_inyeccion", source: "claude", conversation_id: convId, detail: { origen: "rechazo_del_modelo" } });
      }
      await avisarADerivar(chatId, convId, `Claude no devolvió una clasificación utilizable (${respuesta.tipo}).`, texto);
      return;
    }

    // 5. Validación estricta: lo que no cuadra se descarta.
    const validada = validarClasificacion(respuesta.raw, texto);
    if (!validada.ok) {
      await deps.logEvent({ source: "claude", kind: "clasificacion_invalida", level: "warn", summary: `Clasificación descartada: ${validada.motivo}`, conversation_id: convId });
      await avisarADerivar(chatId, convId, "La clasificación de Claude no pasó la validación y se ha descartado.", texto, { motivo: validada.motivo });
      return;
    }
    const c = validada.value;
    await deps.actualizarConversacion(convId, { intent: INTENCION_EN_BD[c.intencion] });
    await deps.logEvent({ source: "claude", kind: "clasificado", summary: `Intención: ${c.intencion} (confianza ${c.confianza})${basica ? " · lectura básica" : ""}`, detail: { intencion: c.intencion, confianza: c.confianza, lector: basica ? "basica" : "claude" }, conversation_id: convId });

    if (c.manipulacion) return marcarManipulacion(chatId, convId, texto, "modelo", ["marcado_por_el_modelo"]);

    if (c.intencion !== "cita_salon") {
      const aun = c.intencion === "info_formacion_online" || c.intencion === "info_formacion_presencial";
      await avisarADerivar(
        chatId,
        convId,
        aun ? `Intención «${c.intencion}»: las formaciones todavía no están conectadas, te lo derivo.` : `Intención «${c.intencion}»: te lo derivo.`,
        texto,
        { intencion: c.intencion, notas: c.notas },
      );
      return;
    }
    await proponerCita(chatId, convId, c, texto, basica);
  }

  async function proponerCita(chatId: number, convId: string, c: Clasificacion, texto: string, basica: boolean) {
    const spec = specDesdeClasificacion(c, texto, basica ? "basica" : "claude");
    const perfil = await deps.perfil();
    const { resultado, guardado } = await calcularPrecio(spec, perfil, { conversation_id: convId });
    const fotos = await fotosParaPropuesta(convId);
    const prop = componerPropuesta(spec, resultado, { ahora: deps.now(), perfil, calendarioConectado: false, fotos });
    const nonce = deps.newNonce();
    const reserva = await deps.crearReserva(filaDeReserva(prop, spec, guardado, nonce, convId));
    await deps.actualizarConversacion(convId, { status: "esperando_aprobacion" });
    const textoTg = textoPropuesta(prop, spec, { mensajeCliente: texto, esPrueba: true, perfil, fotos });
    // Las fotos llegan primero: así Blake las tiene delante al leer la propuesta (nada si el cliente no mandó ninguna).
    if (fotos?.length) {
      try {
        await deps.enviarFotos(chatId, convId);
      } catch (e) {
        await deps.logEvent({ source: "telegram", kind: "foto_envio_fallo", level: "error", summary: msg(e), conversation_id: convId });
      }
    }
    const id = await deps.enviar(chatId, textoTg, teclado(nonce, aprobable(reserva)));
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

  async function boton(b: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: "ok" | "ed" | "no" }) {
    const r = await deps.verReservaPorNonce(b.nonce);
    if (!r || r.status !== "propuesta") {
      await deps.responderCallback(b.callbackId, "Ya procesado");
      return;
    }
    const ids = { conversation_id: r.conversation_id, booking_id: r.id };

    if (b.accion === "ok" && !aprobable(r)) {
      await deps.responderCallback(b.callbackId, "Faltan datos: pulsa Editar");
      return;
    }
    const tomada = await deps.tomarNonce(b.nonce);
    if (!tomada) {
      await deps.responderCallback(b.callbackId, "Ya procesado");
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

    if (b.accion === "ok") {
      await deps.actualizarReserva(r.id, { status: "aprobada", approved_by_telegram_user: b.fromId, approved_at: deps.now().toISOString() });
      if (r.conversation_id) await deps.actualizarConversacion(r.conversation_id, { status: "esperando_cliente" });
      await deps.responderCallback(b.callbackId, "✅ Aprobada");
      await editarMensaje(
        `${r.is_test ? "🧪 PRUEBA · " : ""}✅ APROBADA\n\n${resumenDecision(r)}\n\nNo se ha enviado nada al cliente (el canal de Instagram no está conectado).\nSiguientes pasos pendientes de conectar: calendario (reserva provisional) y enlace de pago de la señal.`,
      );
      await deps.logEvent({ source: "telegram", kind: "propuesta_aprobada", summary: "Propuesta aprobada por Blake", detail: { precio_centimos: r.price_cents }, ...ids });
      await deps.logEvent({ source: "system", kind: "respuesta_lista_sin_enviar", summary: "Respuesta aprobada pero sin enviar: el canal de Instagram no está conectado", ...ids });
      return;
    }

    if (b.accion === "no") {
      await deps.actualizarReserva(r.id, { status: "cancelada" });
      if (r.conversation_id) await deps.actualizarConversacion(r.conversation_id, { status: "cerrada" });
      await deps.responderCallback(b.callbackId, "❌ Rechazada");
      await editarMensaje(`${r.is_test ? "🧪 PRUEBA · " : ""}❌ RECHAZADA\n\n${resumenDecision(r)}\n\nNo se envía nada al cliente. Si quieres retomarla, escribe de nuevo con /simular.`);
      await deps.logEvent({ source: "telegram", kind: "propuesta_rechazada", summary: "Propuesta rechazada por Blake", ...ids });
      return;
    }

    // Editar
    await deps.actualizarReserva(r.id, { edit_requested_at: deps.now().toISOString() });
    await deps.responderCallback(b.callbackId, "✏️ Dime los cambios");
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

    const { cambios: pedidos, errores } = parsearEdicion(texto, deps.now());
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

    const { spec, recalcular } = aplicarCambios(r.spec, cambios);
    const perfil = r.pricing.perfil ?? (await deps.perfil());
    let guardado: PricingGuardado = r.pricing;
    if (recalcular || r.pricing.origen === "sin_calcular" || r.pricing.origen === "error") {
      guardado = (await calcularPrecio(spec, perfil, ids)).guardado;
    } else if (spec.precio_manual_centimos !== null) {
      guardado = { origen: "manual", perfil };
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

  return { simular, boton, textoLibre, cancelarEdicion };
}
