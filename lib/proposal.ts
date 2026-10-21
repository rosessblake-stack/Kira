import { ZONA_MADRID, aUtc, avisosDeHorario, duracionLegible, fechaLarga, horasTexto, partesEn } from "./agenda";
import { avisosDeHueco, textoAgendaDelDia, textoChoques, type ResultadoAgenda } from "./agenda-eventos";
import {
  AVISO_TIPO_ASUMIDO,
  ESTILOS_PEGADAS,
  EXTENSIONES,
  LARGOS_CABELLO,
  LARGOS_EXTENSIONES,
  TAMANOS,
  TIPOS_TRENZADO,
  limpiarTexto,
  type Clasificacion,
} from "./intents";
import { leerFechaHora } from "./fecha-texto";
import { enlaceInstagram } from "./instagram";
import type { OpcionHueco } from "./opciones";
import { ETIQUETA_FOTO, limpiarDescripcion, type ResumenFoto } from "./fotos";
import type { LecturaGuardada } from "./lectura-foto";
import { avisoDeEstancia, type Estancia } from "./estancias";
import { CONFIG_UBICACION, dinero, interpretarUbicacion, type Moneda, type Ubicacion } from "./ubicacion";
import {
  datosFaltantes,
  horasPorDefecto,
  materialesPorDefecto,
  type PerfilLegacy,
  type PrecioLegacy,
  type ServicioParaPrecio,
} from "./pricing";

/**
 * Propuesta de cita: lo que Kira entiende + lo que Legacy cobra + lo que hay que avisar a Blake.
 * Todo es lógica pura. Nada de aquí envía nada a nadie ni toca el calendario.
 */

export const SENAL_POR_DEFECTO_CENTIMOS = CONFIG_UBICACION.espana.senalCentimos; // paga y señal fijada por Blake: 20 € (admite 10–20 €; «señal N» la cambia en una propuesta)
export const SENAL_MIN_CENTIMOS = 1000;
export const SENAL_MAX_CENTIMOS = 2000;

export type SpecGuardada = {
  /** Dónde está la clienta (primera pregunta de ManyChat). Las propuestas antiguas, sin este dato, son de España. */
  ubicacion?: Ubicacion;
  /** Mensaje original del cliente (recortado): permite volver a mostrar la propuesta al editarla. */
  mensaje_cliente: string;
  servicio: ServicioParaPrecio;
  color_extensiones: string | null;
  fecha: string | null;
  hora: string | null;
  nombre: string | null;
  email: string | null;
  instagram: string | null;
  /** Dónde se hace la cita (va al evento del calendario). Cambia según el día: se pone o corrige con «dirección …». */
  direccion?: string | null;
  notas: string | null;
  confianza: "alta" | "media" | "baja";
  avisos_validacion: string[];
  /** Quién interpretó el mensaje: Claude, o la lectura básica por reglas (solo pruebas, sin clave). */
  clasificador?: "claude" | "basica" | "formulario";
  /** De dónde viene: solicitud real del formulario de Instagram (ManyChat). Sin dato = prueba de Telegram. */
  origen?: "instagram";
  /** Lo que Claude vio en las fotos de la clienta (solo describe; los datos que rellenó llevan su aviso). */
  lectura_foto?: LecturaGuardada;
  /** Cómo describe Blake el peinado («referencia …» en Editar): va al evento del calendario para saber qué hacer. */
  descripcion_peinado?: string | null;
  /** Alternativas que Blake ofreció a la clienta cuando su hora chocaba (la clienta contesta con el número). */
  opciones_hueco?: OpcionHueco[];
  /** Última vez que Kira mandó el acuse genérico a la clienta (no más de uno cada pocas horas). */
  acuse_at?: string;
  /** Blake ya avisó a la clienta de que no se podía hacer su solicitud. */
  rechazo_avisado?: boolean;
  /** Horas fijadas por Blake; null = las de por defecto. */
  horas: number | null;
  /** Materiales fijados por Blake (en la moneda de la ubicación); null/ausente = los de por defecto. */
  materiales?: number | null;
  /** Precio puesto a mano por Blake; null = lo calcula Legacy. */
  precio_manual_centimos: number | null;
  senal_centimos: number;
  respuesta_manual: string | null;
};

/** Ubicación, moneda y zona horaria de una propuesta (las antiguas sin dato son de España y euros). */
export function contextoDe(spec: Pick<SpecGuardada, "ubicacion">) {
  const ubicacion = interpretarUbicacion(spec.ubicacion);
  return { ubicacion, ...CONFIG_UBICACION[ubicacion] };
}

export function specDesdeClasificacion(
  c: Clasificacion,
  mensajeCliente: string,
  clasificador: "claude" | "basica" | "formulario" = "claude",
  ubicacion: Ubicacion = "espana",
): SpecGuardada {
  return {
    ubicacion,
    mensaje_cliente: mensajeCliente,
    clasificador,
    servicio: {
      tipo_trenzado: c.tipo_trenzado,
      numero_trenzas: c.numero_trenzas,
      tamano: c.tamano,
      estilo_pegadas: c.estilo_pegadas,
      extensiones: c.extensiones,
      boho: c.boho,
      largo_cabello: c.largo_cabello,
      largo_extensiones: c.largo_extensiones,
    },
    color_extensiones: c.color_extensiones,
    fecha: c.fecha,
    hora: c.hora,
    nombre: c.nombre,
    email: c.email,
    instagram: c.instagram,
    notas: c.notas,
    confianza: c.confianza,
    avisos_validacion: c.avisosValidacion,
    horas: null,
    precio_manual_centimos: null,
    senal_centimos: CONFIG_UBICACION[ubicacion].senalCentimos,
    direccion: CONFIG_UBICACION[ubicacion].direccionPorDefecto,
    respuesta_manual: null,
  };
}

export type ResultadoPrecio =
  | { origen: "legacy"; precio: PrecioLegacy }
  | { origen: "manual"; totalCentimos: number }
  | { origen: "sin_calcular"; faltan: string[] }
  | { origen: "error"; error: string };

export type Propuesta = {
  nombreCliente: string;
  emailCliente: string | null;
  descripcion: string;
  precioCentimos: number | null;
  senalCentimos: number;
  duracionMinutos: number | null;
  inicio: Date | null;
  fin: Date | null;
  horasUsadas: number;
  materialesUsados: number;
  avisos: string[];
  /** Lo que impide aprobar todavía. Vacío = se puede aprobar. */
  faltan: string[];
  borrador: string;
  precioOrigen: ResultadoPrecio["origen"];
};

const LARGO_CABELLO: Record<string, string> = {
  muy_corto: "muy corto",
  corto: "corto",
  nuca_hombros: "hasta la nuca o los hombros",
  media_espalda: "hasta media espalda",
  caderas: "hasta las caderas",
  mas_largo: "más largo que las caderas",
};
const LARGO_EXTENSIONES: Record<string, string> = {
  nuca: "hasta la nuca",
  hombros: "hasta los hombros",
  media_espalda: "hasta media espalda",
  caderas: "hasta las caderas",
  mas_largo: "más largo que las caderas",
};

const NOMBRE_ESTILO = { cornrows: "cornrows", twist: "flat twist", barrel_twist: "barrel twist" } as const;

function describirServicio(s: SpecGuardada): string {
  const v = s.servicio;
  const partes: string[] = [];
  partes.push(v.numero_trenzas ? `${v.numero_trenzas} trenzas` : "Trenzas");
  partes.push(v.tipo_trenzado ?? "tipo sin concretar");
  if (v.tipo_trenzado === "pegadas" && v.estilo_pegadas) partes.push(NOMBRE_ESTILO[v.estilo_pegadas]);
  if (v.tamano) partes.push(`tamaño ${v.tamano}`);
  if (v.extensiones === "con" || v.extensiones === "feedin") {
    partes.push(`con extensiones${s.color_extensiones ? ` ${s.color_extensiones}` : ""}${v.extensiones === "feedin" ? " (feed-in)" : ""}`);
  } else if (v.extensiones === "sin") partes.push("sin extensiones");
  if (v.boho) partes.push("boho");
  return partes.join(" · ");
}

/** Versión para hablar con el cliente: "6 trenzas pegadas con extensiones (rojo)". */
function describirServicioNatural(s: SpecGuardada): string {
  const v = s.servicio;
  // A la clienta se le habla con el nombre del servicio: «6 flat twist», «6 cornrows», «6 barrel twist» (no «trenzas pegadas»).
  const estilo = v.tipo_trenzado === "pegadas" && v.estilo_pegadas ? NOMBRE_ESTILO[v.estilo_pegadas] : null;
  const partes: string[] = estilo
    ? [v.numero_trenzas ? `${v.numero_trenzas} ${estilo}` : estilo]
    : [v.numero_trenzas ? `${v.numero_trenzas} trenzas` : "tus trenzas"];
  if (!estilo && v.tipo_trenzado) partes.push(v.tipo_trenzado);
  if (v.tamano) partes.push(`tamaño ${v.tamano}`);
  if (v.extensiones === "con" || v.extensiones === "feedin") {
    partes.push(`con extensiones${s.color_extensiones ? ` (${s.color_extensiones})` : ""}`);
  } else if (v.extensiones === "sin") partes.push("sin extensiones");
  if (v.boho) partes.push("estilo boho");
  return partes.join(" ");
}

export function resumenPerfil(p: PerfilLegacy, moneda: Moneda = "EUR"): string {
  return `${p.nivel === "elite" ? "élite" : p.nivel} · zona ${p.zona} · ${p.estructura === "salon" ? "salón" : "casa"} · base salarial ${p.smi} ${moneda === "USD" ? "$" : "€"}`;
}

/** Inicio y fin de la cita pedida (fecha y hora en la zona de SU ciudad). null si falta fecha, hora o duración. */
export function horarioDeSpec(spec: SpecGuardada): { inicio: Date | null; fin: Date | null } {
  const lugar = contextoDe(spec);
  const horas = spec.horas ?? horasPorDefecto(spec.servicio);
  const minutos = horas > 0 ? Math.round(horas * 60) : null;
  const inicio = spec.fecha && spec.hora ? aUtc(spec.fecha, spec.hora, lugar.zonaHoraria) : null;
  return { inicio, fin: inicio && minutos ? new Date(inicio.getTime() + minutos * 60_000) : null };
}

export function componerPropuesta(
  spec: SpecGuardada,
  precio: ResultadoPrecio,
  ctx: {
    ahora: Date;
    perfil: PerfilLegacy;
    /** Antiguo: true = no avisar de la agenda. Sustituido por `agenda`, que dice qué se encontró en el calendario. */
    calendarioConectado?: boolean;
    /** Lo que se vio en el calendario de Blake para esa fecha (si no se pasa, vale `calendarioConectado`). */
    agenda?: ResultadoAgenda;
    fotos?: ResumenFoto[];
    estancias?: Estancia[];
  },
): Propuesta {
  const lugar = contextoDe(spec);
  const horasUsadas = spec.horas ?? horasPorDefecto(spec.servicio);
  const materialesUsados = spec.materiales ?? materialesPorDefecto(spec.servicio);
  const duracionMinutos = horasUsadas > 0 ? Math.round(horasUsadas * 60) : null;

  // La fecha y la hora que da la clienta son las de SU ciudad (Madrid o Miami).
  const { inicio, fin } = horarioDeSpec(spec);
  const agenda: ResultadoAgenda = ctx.agenda ?? (ctx.calendarioConectado ? { estado: "sin_horario" } : { estado: "no_conectado" });

  const precioCentimos =
    precio.origen === "legacy" ? precio.precio.totalCentimos : precio.origen === "manual" ? precio.totalCentimos : null;

  const faltan: string[] = [];
  if (precioCentimos === null) {
    if (precio.origen === "error") faltan.push(`precio (${precio.error}; puedes ponerlo tú con «precio 80»)`);
    else if (precio.origen === "sin_calcular") faltan.push(...precio.faltan.map((f) => `precio: falta ${f}`));
    else faltan.push("precio");
  }
  if (!spec.fecha) faltan.push("fecha");
  if (!spec.hora) faltan.push("hora");
  // Si el precio no se puede calcular por falta de datos, la duración falta por el mismo motivo: no se repite.
  if (!duracionMinutos && precio.origen !== "sin_calcular") faltan.push("duración (horas)");

  const avisos: string[] = [];
  if (spec.clasificador === "basica") {
    avisos.push("Lectura básica por reglas: este mensaje NO lo ha leído Claude (modo de prueba, aún sin clave). Revisa lo que he entendido.");
  }
  if (confianzaBaja(spec)) avisos.push("Kira no está segura de lo que pide (confianza baja): revisa el mensaje original.");
  if (agenda.estado === "no_conectado") {
    avisos.push("Disponibilidad NO comprobada: el calendario todavía no está conectado. Mira tu agenda antes de aprobar.");
  } else if (agenda.estado === "error") {
    // Con el calendario conectado pero sin poder mirarlo, no se aprueba: nunca se da por libre un hueco sin comprobarlo.
    faltan.push(`comprobar la agenda (${agenda.motivo})`);
    avisos.push("No he podido mirar tu calendario, así que no sé si ese hueco está libre. No se puede aprobar hasta comprobarlo.");
  } else if (agenda.estado === "ok") {
    // Un choque con cualquier evento (también los marcados «libre») bloquea: no se crea nada encima de otra cita.
    for (const c of textoChoques(agenda.hueco, lugar.zonaHoraria)) faltan.push(c);
    avisos.push(...avisosDeHueco(agenda.hueco, lugar.zonaHoraria));
  }
  if (agenda.estado === "sin_horario" && ctx.agenda !== undefined) {
    avisos.push("Todavía no he mirado tu agenda: falta la fecha, la hora o la duración. La miro en cuanto estén.");
  }
  avisos.push(...avisosDeHorario(inicio, fin, ctx.ahora, lugar.reglas));
  // Dónde está Blake ese día (sus viajes a Miami): blando, la propuesta avisa y decide él.
  const avisoViaje = ctx.estancias ? avisoDeEstancia(lugar.ubicacion, spec.fecha, ctx.estancias) : null;
  if (avisoViaje) avisos.push(avisoViaje);
  avisos.push(...lugar.pendientes);
  if (!spec.direccion) avisos.push("No hay dirección para el evento (cambia según el día): ponla con «dirección …» antes de aprobar.");
  if (precio.origen === "manual") avisos.push("El precio lo has puesto tú: no lo ha calculado Legacy.");
  if (precio.origen === "legacy") {
    if (!ctx.perfil.confirmado) avisos.push(`Perfil de precios sin confirmar (${resumenPerfil(ctx.perfil, lugar.moneda)}).`);
    const sinHoras = spec.horas === null;
    const sinMateriales = (spec.materiales ?? null) === null;
    const simbolo = lugar.moneda === "USD" ? "$" : "€";
    if (sinHoras && sinMateriales) {
      avisos.push(`Horas (${horasTexto(horasUsadas)} h) y materiales (${materialesUsados} ${simbolo}) son una sugerencia: ajústalas con «horas 3» y «materiales 8».`);
    } else if (sinHoras) {
      avisos.push(`Las horas (${horasTexto(horasUsadas)} h) son una sugerencia: ajústalas con «horas 3».`);
    } else if (sinMateriales) {
      avisos.push(`Los materiales (${materialesUsados} ${simbolo}) son una sugerencia: ajústalos con «materiales 8».`);
    }
  }
  const s = spec.servicio;
  if (s.tipo_trenzado === "pegadas" && (s.extensiones === "con" || s.extensiones === "feedin") && !s.largo_extensiones) {
    avisos.push("No dice hasta dónde quiere las extensiones (afecta al precio de las pegadas).");
  }
  if (s.tipo_trenzado === "pegadas" && !s.numero_trenzas && s.estilo_pegadas !== "twist" && s.estilo_pegadas !== "barrel_twist") {
    avisos.push("No sé cuántas trenzas son: escribe «trenzas 6» y saldrá en el evento del calendario.");
  }
  if (s.tipo_trenzado === "pegadas" && !s.estilo_pegadas) {
    avisos.push("No sé si son cornrows, flat twist o barrel twist (así se lo digo a la clienta y sale en el evento): escribe «estilo flat twist», por ejemplo.");
  }
  // Blake pide en Instagram una foto del pelo y otra de las trenzas que quiere. Es un aviso, no un bloqueo: decide él.
  if (ctx.fotos) {
    if (!ctx.fotos.some((f) => f.tipo === "pelo")) avisos.push("Falta la foto del pelo de la clienta.");
    if (!ctx.fotos.some((f) => f.tipo === "referencia")) avisos.push("Falta la foto de las trenzas de referencia.");
  }
  if (!spec.email) avisos.push("No tengo su email: hará falta para la reserva y el recibo.");
  if (!spec.nombre) avisos.push("No dice su nombre.");
  if (spec.senal_centimos < SENAL_MIN_CENTIMOS || spec.senal_centimos > SENAL_MAX_CENTIMOS) {
    avisos.push(`La señal (${dinero(spec.senal_centimos, lugar.moneda)}) está fuera del rango habitual de 10–20 ${lugar.moneda === "USD" ? "$" : "€"}.`);
  }
  avisos.push(...spec.avisos_validacion);
  if (spec.notas) avisos.push(`Nota del clasificador: ${spec.notas}`);

  const nombreCliente = spec.nombre ?? "Cliente sin nombre";
  return {
    nombreCliente,
    emailCliente: spec.email,
    descripcion: describirServicio(spec),
    precioCentimos,
    senalCentimos: spec.senal_centimos,
    duracionMinutos,
    inicio,
    fin,
    horasUsadas,
    materialesUsados,
    avisos,
    faltan,
    borrador: componerBorrador(spec, precioCentimos, duracionMinutos, inicio, faltan, lugar.moneda, lugar.zonaHoraria),
    precioOrigen: precio.origen,
  };
}

const confianzaBaja = (s: SpecGuardada) => s.confianza === "baja";

/**
 * Borrador para el cliente. Es una plantilla: solo contiene datos que ya validó el código (precio de Legacy
 * o puesto por Blake, señal, fecha). Claude no escribe nada que llegue al cliente. Blake puede reescribirlo.
 */
function componerBorrador(
  spec: SpecGuardada,
  precio: number | null,
  duracion: number | null,
  inicio: Date | null,
  faltan: string[],
  moneda: Moneda,
  zona: string,
): string {
  if (spec.respuesta_manual) return spec.respuesta_manual;
  if (precio === null || !inicio) {
    return `Borrador pendiente: faltan datos. ${faltan.join(" · ") || "fecha"}. Completa la propuesta con Editar.`;
  }
  const saludo = spec.nombre ? `¡Hola, ${spec.nombre}!` : "¡Hola!";
  return [
    `${saludo} Gracias por escribirme 😊`,
    `Para ${describirServicioNatural(spec)}, el precio es de ${dinero(precio, moneda)}${duracion ? ` y dura aproximadamente ${duracionLegible(duracion)}` : ""}.`,
    `Tu cita sería el ${fechaLarga(inicio, zona)}.`,
    `Para reservar el hueco se deja una señal de ${dinero(spec.senal_centimos, moneda)}, que se descuenta del total el día de la cita. Si te encaja, respóndeme «vale» y te explico cómo hacerla 😊`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Texto de la propuesta para Telegram (texto plano: nada del cliente se interpreta como formato)
// ---------------------------------------------------------------------------

const recorte = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);

/**
 * La primera línea del mensaje de la propuesta: lo que se ve en la notificación del móvil («Lucía · vie 30 oct, 12:00 · 6 trenzas · 70 €»).
 * El detalle completo va debajo, plegado.
 */
export function resumenCortoPropuesta(p: Propuesta, spec: SpecGuardada, esPrueba: boolean): string {
  const lugar = contextoDe(spec);
  const icono = esPrueba ? "🧪" : spec.origen === "instagram" ? "📥" : "💬";
  const cuando = p.inicio ? fechaLarga(p.inicio, lugar.zonaHoraria) : "sin fecha";
  const precio = p.precioCentimos !== null ? dinero(p.precioCentimos, lugar.moneda) : "sin precio";
  const nota = p.faltan.length ? " · ⛔ falta algo" : p.avisos.length ? ` · ⚠️ ${p.avisos.length}` : "";
  return `${icono} ${limpiarTexto(p.nombreCliente || "Clienta", 40)} quiere cita · ${cuando} · ${limpiarTexto(p.descripcion, 60)} · ${precio}${nota}`;
}

export function textoPropuesta(
  p: Propuesta,
  spec: SpecGuardada,
  ctx: { mensajeCliente: string; esPrueba: boolean; perfil: PerfilLegacy; fotos?: ResumenFoto[]; agenda?: ResultadoAgenda },
): string {
  const lugar = contextoDe(spec);
  const l: string[] = [];
  l.push(`${ctx.esPrueba ? "🧪 PRUEBA · " : ""}${spec.origen === "instagram" ? "📥 SOLICITUD DE INSTAGRAM · " : ""}PROPUESTA DE CITA`);
  if (spec.origen === "instagram") l.push("👀 Modo sombra: Kira NO ha escrito a la clienta. Respóndele tú como siempre.");
  l.push("");
  l.push(`📍 ${lugar.nombre} · ${lugar.moneda === "USD" ? "dólares · hora de Miami" : "euros · hora de Madrid"}`);
  l.push(`🏠 Dirección: ${spec.direccion ? recorte(limpiarTexto(spec.direccion, 200), 200) : "sin indicar"}`);
  l.push(`👤 Cliente: ${spec.nombre ?? "sin nombre"}${p.emailCliente ? ` (${p.emailCliente})` : ""}${spec.instagram ? ` · ${spec.instagram}` : ""}`);
  if (enlaceInstagram(spec.instagram)) l.push(`📷 ${enlaceInstagram(spec.instagram)}`);
  l.push(`💬 Dijo: «${recorte(limpiarTexto(ctx.mensajeCliente, 600), 500)}»`);
  l.push("");
  l.push("🧾 Lo que he entendido");
  l.push(`• Servicio: ${p.descripcion}`);
  if (spec.servicio.largo_cabello) l.push(`• Pelo de la clienta: ${LARGO_CABELLO[spec.servicio.largo_cabello]}`);
  if (spec.servicio.largo_extensiones) l.push(`• Largo de las trenzas: ${LARGO_EXTENSIONES[spec.servicio.largo_extensiones]}`);
  if (p.inicio) {
    l.push(`• Fecha pedida: ${fechaLarga(p.inicio, lugar.zonaHoraria)}${p.fin ? ` → ${partesEn(p.fin, lugar.zonaHoraria).hora}` : ""}${p.duracionMinutos ? ` (${duracionLegible(p.duracionMinutos)})` : ""}`);
  } else {
    l.push("• Fecha pedida: sin concretar");
  }
  if (ctx.agenda?.estado === "ok" && p.inicio && p.fin) {
    l.push("");
    l.push(...textoAgendaDelDia(ctx.agenda.hueco, p.inicio, p.fin, lugar.zonaHoraria, fechaLarga(p.inicio, lugar.zonaHoraria).split(",")[0]));
  }
  if (ctx.fotos) {
    l.push("");
    l.push("📷 Fotos");
    for (const tipo of ["pelo", "referencia"] as const) {
      const f = ctx.fotos.find((x) => x.tipo === tipo);
      l.push(`• ${ETIQUETA_FOTO[tipo]}: ${!f ? "sin foto" : f.descripcion ? `«${recorte(f.descripcion, 200)}»` : "foto sin describir"}`);
    }
    const otras = ctx.fotos.filter((x) => x.tipo === "otra").length;
    if (otras) l.push(`• Otras fotos: ${otras}`);
  }
  if (spec.lectura_foto && (spec.lectura_foto.referencia || spec.lectura_foto.pelo)) {
    l.push("");
    l.push("🔎 Lo que veo en las fotos (lectura de Claude, confírmala tú)");
    if (spec.lectura_foto.referencia) l.push(`• Referencia: ${recorte(spec.lectura_foto.referencia, 220)}`);
    if (spec.lectura_foto.pelo) l.push(`• Pelo: ${recorte(spec.lectura_foto.pelo, 220)}`);
  }
  l.push("");
  if (p.precioCentimos !== null) {
    const origen = p.precioOrigen === "manual" ? "puesto por ti" : "Legacy";
    l.push(`💶 Precio: ${dinero(p.precioCentimos, lugar.moneda)} (${origen}) · Señal: ${dinero(p.senalCentimos, lugar.moneda)}`);
    if (p.precioOrigen === "legacy") l.push(`   ${horasTexto(p.horasUsadas)} h · materiales ${p.materialesUsados} ${lugar.moneda === "USD" ? "$" : "€"} · perfil ${resumenPerfil(ctx.perfil, lugar.moneda)}`);
  } else {
    l.push(`💶 Precio: sin calcular · Señal: ${dinero(p.senalCentimos, lugar.moneda)}`);
  }
  if (p.avisos.length) {
    l.push("");
    l.push("⚠️ Avisos");
    for (const a of p.avisos) l.push(`• ${recorte(a, 260)}`);
  }
  l.push("");
  l.push("✉️ Borrador de respuesta (no se envía nada sin tu Aprobar)");
  l.push(`«${recorte(p.borrador, 900)}»`);
  if (p.faltan.length) {
    l.push("");
    l.push(`⛔ Todavía no se puede aprobar. Falta: ${p.faltan.join(" · ")}`);
    l.push(`Pulsa Editar y dime, por ejemplo: ${ejemploDeEdicion(p.faltan)}`);
  }
  return recorte(l.join("\n"), 3900);
}

// ---------------------------------------------------------------------------
// Edición: Blake escribe cambios en lenguaje simple, una línea por cambio
// ---------------------------------------------------------------------------

/** Un ejemplo de edición que corresponda a lo primero que falta (no uno cualquiera). */
export function ejemploDeEdicion(faltan: string[]): string {
  const primero = (faltan[0] ?? "").toLowerCase();
  if (primero.includes("tipo de trenzado")) return "tipo pegadas";
  if (primero.includes("tamaño")) return "tamaño large";
  if (primero.includes("extensiones")) return "extensiones con";
  if (primero.startsWith("precio (")) return "precio 80";
  if (primero === "fecha") return "fecha 20/10 12:00";
  if (primero === "hora") return "hora 12:00";
  if (primero.includes("duración")) return "horas 3";
  if (primero.includes("agenda") || primero.includes("hueco ocupado")) return "fecha 20/10 12:00";
  return "precio 80";
}

export const AYUDA_EDICION = [
  "Dime qué cambiar, una cosa por línea. Por ejemplo:",
  "precio 70",
  "señal 15",
  "horas 3   (lo que dura el servicio)",
  "materiales 8   (lo que gastas en material)",
  "fecha 20/10 12:00",
  "tipo pegadas",
  "tamaño large",
  "extensiones con",
  "largo caderas   (hasta dónde llegan las trenzas)",
  "largo pelo hombros   (hasta dónde le llega su pelo)",
  "trenzas 6",
  "estilo flat twist   (cornrows, flat twist o barrel twist)",
  "boho si",
  "color rojo",
  "instagram usuario",
  "estructura salon   (casa o salon)",
  "zona premium   (premium, media o baja)",
  "nivel elite",
  "base 1500   (salario base con el que calcula Legacy)",
  "nombre Ana",
  "email ana@correo.com",
  "dirección Calle Ejemplo 12, Miami   (dónde es la cita)",
  "respuesta Hola Ana, ...",
  "pelo rizado, fino, a los hombros   (lo que ves en su foto del pelo)",
  "referencia boxeadoras hasta la cadera   (lo que ves en su foto de trenzas)",
  "",
  "«precio auto», «horas auto» y «materiales auto» devuelven ese dato a Legacy y a Kira. /cancelar lo deja como está.",
].join("\n");

export type Cambio =
  | { k: "precio"; centimos: number | null }
  | { k: "senal"; centimos: number }
  | { k: "horas"; horas: number | null }
  | { k: "materiales"; valor: number | null }
  | { k: "boho"; v: boolean }
  | { k: "estilo"; v: (typeof ESTILOS_PEGADAS)[number] }
  | { k: "largo_cabello"; v: (typeof LARGOS_CABELLO)[number] }
  | { k: "color"; v: string }
  | { k: "instagram"; v: string }
  | { k: "estructura"; v: PerfilLegacy["estructura"] }
  | { k: "zona"; v: PerfilLegacy["zona"] }
  | { k: "nivel"; v: PerfilLegacy["nivel"] }
  | { k: "base"; n: number }
  | { k: "fecha"; fecha: string; hora: string | null }
  | { k: "hora"; hora: string }
  | { k: "tipo"; v: (typeof TIPOS_TRENZADO)[number] }
  | { k: "tamano"; v: (typeof TAMANOS)[number] }
  | { k: "extensiones"; v: (typeof EXTENSIONES)[number] }
  | { k: "largo_ext"; v: (typeof LARGOS_EXTENSIONES)[number] }
  | { k: "trenzas"; n: number }
  | { k: "nombre"; v: string }
  | { k: "email"; v: string }
  | { k: "direccion"; v: string }
  | { k: "respuesta"; v: string }
  /** Lo que Blake ve en una foto: no cambia la reserva, se guarda junto a la foto. */
  | { k: "foto_pelo"; v: string }
  | { k: "foto_referencia"; v: string };

/** Nombre de cada cambio tal como lo escribe Blake (no el identificador interno). */
const ETIQUETAS_CAMBIO: Record<Cambio["k"], string> = {
  precio: "precio", senal: "señal", horas: "horas", materiales: "materiales", boho: "boho", estilo: "estilo", largo_cabello: "largo del pelo",
  color: "color", instagram: "instagram", estructura: "estructura", zona: "zona", nivel: "nivel", base: "base salarial", fecha: "fecha", hora: "hora", tipo: "tipo", tamano: "tamaño",
  extensiones: "extensiones", largo_ext: "largo", trenzas: "trenzas", nombre: "nombre", email: "email", direccion: "dirección", respuesta: "respuesta",
  foto_pelo: "descripción del pelo", foto_referencia: "descripción de la referencia",
};
export const etiquetaCambio = (k: Cambio["k"]) => ETIQUETAS_CAMBIO[k];

const quitarAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function numero(txt: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:€|\$|eur|euros|usd|d[oó]lares)?\s*$/i.exec(txt);
  return m ? Number(m[1].replace(",", ".")) : null;
}

const HORA_RE = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/;

/** "20/10", "20/10/2026", "20-10", "2026-10-20" → AAAA-MM-DD (sin año: la próxima vez que llegue esa fecha). */
export function interpretarFecha(txt: string, ahora: Date, zona: string = ZONA_MADRID): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(txt);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const dm = /\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/.exec(txt);
    if (!dm) return null;
    d = Number(dm[1]);
    m = Number(dm[2]);
    const hoy = partesEn(ahora, zona).fecha.split("-").map(Number);
    if (dm[3]) {
      y = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]);
    } else {
      y = hoy[0];
      const cand = Date.UTC(y, m - 1, d);
      if (cand < Date.UTC(hoy[0], hoy[1] - 1, hoy[2])) y += 1;
    }
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function interpretarHora(txt: string): string | null {
  const m = HORA_RE.exec(txt);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  // «5 pm», «5:30pm», «11am»
  const ap = /^\s*(?:a\s+las\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s*m\.?\s*$/i.exec(txt);
  if (ap) {
    const h = (Number(ap[1]) % 12) + (ap[3].toLowerCase() === "p" ? 12 : 0);
    return `${String(h).padStart(2, "0")}:${ap[2] ?? "00"}`;
  }
  const solo = /^\s*(?:a\s+las\s+)?([01]?\d|2[0-3])\s*(?:h|horas)?\s*$/i.exec(txt);
  return solo ? `${solo[1].padStart(2, "0")}:00` : null;
}

const EMAIL_RE = /^[^\s@<>"',;()]{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,24}$/;

export function parsearEdicion(texto: string, ahora: Date, zona: string = ZONA_MADRID): { cambios: Cambio[]; errores: string[] } {
  const cambios: Cambio[] = [];
  const errores: string[] = [];
  const lineas = texto
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const linea of lineas) {
    const m = /^(\S+)\s*(.*)$/.exec(linea);
    if (!m) continue;
    const clave = quitarAcentos(m[1].toLowerCase()).replace(/:$/, "");
    const valor = m[2].trim();
    const err = (msg: string) => errores.push(`«${recorte(linea, 60)}»: ${msg}`);

    switch (clave) {
      case "precio": {
        if (/^auto$/i.test(valor)) { cambios.push({ k: "precio", centimos: null }); break; }
        const n = numero(valor);
        if (n === null || n <= 0 || n > 5000) err("el precio debe ser un importe, por ejemplo «precio 70».");
        else cambios.push({ k: "precio", centimos: Math.round(n * 100) });
        break;
      }
      case "senal": {
        const n = numero(valor);
        if (n === null || n <= 0 || n > 500) err("la señal debe ser un importe, por ejemplo «señal 15».");
        else cambios.push({ k: "senal", centimos: Math.round(n * 100) });
        break;
      }
      case "duracion":
      case "horas": {
        if (/^auto$/i.test(valor)) { cambios.push({ k: "horas", horas: null }); break; }
        const n = numero(valor.replace(/\s*(?:horas?|hrs?|h)\.?$/i, ""));
        if (n === null || n < 0.5 || n > 14) err("las horas deben estar entre 0,5 y 14, por ejemplo «horas 3».");
        else cambios.push({ k: "horas", horas: Math.round(n * 2) / 2 });
        break;
      }
      case "material":
      case "materiales": {
        if (/^auto$/i.test(valor)) { cambios.push({ k: "materiales", valor: null }); break; }
        const n = numero(valor);
        if (n === null || n > 500) err("los materiales deben ser un importe, por ejemplo «materiales 8».");
        else cambios.push({ k: "materiales", valor: Math.round(n * 100) / 100 });
        break;
      }
      case "boho": {
        const v = quitarAcentos(valor.toLowerCase());
        if (v === "si" || v === "yes" || v === "true") cambios.push({ k: "boho", v: true });
        else if (v === "no" || v === "false") cambios.push({ k: "boho", v: false });
        else err("escribe «boho si» o «boho no».");
        break;
      }
      case "estilo": {
        const norm = quitarAcentos(valor.toLowerCase()).replace(/[\s-]+/g, "_");
        // «flat twist» es el nombre de Blake para el twist pegado (en el sistema: «twist»).
        const t = ESTILOS_PEGADAS.find((x) => x === (norm === "flat_twist" || norm === "flat" ? "twist" : norm === "cornrow" ? "cornrows" : norm));
        if (!t) err("el estilo debe ser cornrows, flat twist o barrel twist.");
        else cambios.push({ k: "estilo", v: t });
        break;
      }
      case "largopelo": {
        const t = LARGOS_CABELLO.find((x) => x === quitarAcentos(valor.toLowerCase()).replace(/\s+/g, "_"));
        if (!t) err(`el largo del pelo debe ser ${LARGOS_CABELLO.join(", ")}.`);
        else cambios.push({ k: "largo_cabello", v: t });
        break;
      }
      case "color": {
        const v = limpiarTexto(valor, 40);
        if (!v) err("escribe el color después de «color», por ejemplo «color rojo».");
        else cambios.push({ k: "color", v });
        break;
      }
      case "instagram": {
        const v = valor.replace(/^@/, "").trim();
        if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) err("ese usuario de Instagram no es válido; escribe solo el nombre, por ejemplo «instagram ana_trenzas».");
        else cambios.push({ k: "instagram", v });
        break;
      }
      case "estructura": {
        const v = quitarAcentos(valor.toLowerCase());
        if (v === "casa" || v === "salon") cambios.push({ k: "estructura", v });
        else err("la estructura debe ser casa o salon.");
        break;
      }
      case "zona": {
        const v = quitarAcentos(valor.toLowerCase());
        const z = v === "normal" ? "media" : v;
        if (z === "premium" || z === "media" || z === "baja") cambios.push({ k: "zona", v: z });
        else err("la zona debe ser premium, media o baja.");
        break;
      }
      case "nivel": {
        const v = quitarAcentos(valor.toLowerCase());
        const n = (["junior", "intermedio", "avanzado", "profesional", "elite"] as const).find((x) => x === v);
        if (!n) err("el nivel debe ser junior, intermedio, avanzado, profesional o elite.");
        else cambios.push({ k: "nivel", v: n });
        break;
      }
      case "base": {
        const n = numero(valor);
        if (n === null || n < 100 || n > 20000) err("la base salarial debe ser un importe mensual, por ejemplo «base 1500».");
        else cambios.push({ k: "base", n });
        break;
      }
      case "fecha": {
        const f = interpretarFecha(valor, ahora, zona);
        if (!f) {
          // En palabras: «22 octubre», «22 de octubre a las 5 pm», «viernes», «mañana 11:30».
          const completa = leerFechaHora(valor, ahora, zona);
          const sinHora = completa ? null : leerFechaHora(`${valor} 12:00`, ahora, zona);
          if (completa) cambios.push({ k: "fecha", fecha: completa.fecha, hora: completa.hora });
          else if (sinHora) cambios.push({ k: "fecha", fecha: sinHora.fecha, hora: null });
          else err("no entiendo la fecha; prueba «fecha 22 octubre», «fecha viernes 5 pm» o «fecha 20/10 12:00».");
          break;
        }
        cambios.push({ k: "fecha", fecha: f, hora: interpretarHora(valor.replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/, "")) });
        break;
      }
      case "hora": {
        const h = interpretarHora(valor);
        if (!h) err("no entiendo la hora; prueba «hora 17:00» o «hora 5 pm».");
        else cambios.push({ k: "hora", hora: h });
        break;
      }
      case "tipo": {
        const v = quitarAcentos(valor.toLowerCase());
        const t = TIPOS_TRENZADO.find((x) => x === v);
        if (!t) err(`el tipo debe ser ${TIPOS_TRENZADO.join(", ")}.`);
        else cambios.push({ k: "tipo", v: t });
        break;
      }
      case "tamano": {
        const t = TAMANOS.find((x) => x === quitarAcentos(valor.toLowerCase()).replace(/\s+/g, "_"));
        if (!t) err(`el tamaño debe ser ${TAMANOS.join(", ")}.`);
        else cambios.push({ k: "tamano", v: t });
        break;
      }
      case "extensiones": {
        const t = EXTENSIONES.find((x) => x === quitarAcentos(valor.toLowerCase()));
        if (!t) err("escribe «extensiones con», «extensiones sin» o «extensiones feedin».");
        else cambios.push({ k: "extensiones", v: t });
        break;
      }
      case "largo": {
        const delPelo = /^pelo\s+(.+)$/i.exec(quitarAcentos(valor));
        if (delPelo) {
          const p = LARGOS_CABELLO.find((x) => x === delPelo[1].toLowerCase().replace(/\s+/g, "_"));
          if (!p) err(`el largo del pelo debe ser ${LARGOS_CABELLO.join(", ")}.`);
          else cambios.push({ k: "largo_cabello", v: p });
          break;
        }
        const t = LARGOS_EXTENSIONES.find((x) => x === quitarAcentos(valor.toLowerCase()).replace(/\s+/g, "_"));
        if (!t) err(`el largo debe ser ${LARGOS_EXTENSIONES.join(", ")}.`);
        else cambios.push({ k: "largo_ext", v: t });
        break;
      }
      case "trenzas": {
        const n = numero(valor);
        if (n === null || !Number.isInteger(n) || n < 1 || n > 200) err("indica un número de trenzas entre 1 y 200.");
        else cambios.push({ k: "trenzas", n });
        break;
      }
      case "nombre": {
        const v = limpiarTexto(valor, 60);
        if (!v) err("escribe el nombre, por ejemplo «nombre Ana».");
        else cambios.push({ k: "nombre", v });
        break;
      }
      case "email": {
        if (!EMAIL_RE.test(valor)) err("ese email no es válido.");
        else cambios.push({ k: "email", v: valor.toLowerCase() });
        break;
      }
      case "direccion": {
        const v = limpiarTexto(valor, 200);
        if (!v) err("escribe la dirección después de «dirección», por ejemplo «dirección Calle Ejemplo 12, Miami».");
        else cambios.push({ k: "direccion", v });
        break;
      }
      case "respuesta": {
        const v = valor.replace(/\s+$/g, "");
        if (!v) err("escribe el texto de la respuesta después de «respuesta».");
        else cambios.push({ k: "respuesta", v: recorte(v, 900) });
        break;
      }
      case "pelo":
      case "referencia": {
        const v = limpiarDescripcion(valor);
        if (!v) err(`escribe lo que ves en la foto, por ejemplo «${clave} ${clave === "pelo" ? "rizado, fino, a los hombros" : "boxeadoras hasta la cadera"}».`);
        else cambios.push({ k: clave === "pelo" ? "foto_pelo" : "foto_referencia", v });
        break;
      }
      default:
        err("no sé qué cambiar con eso. Claves: precio, señal, horas, materiales, fecha, hora, tipo, tamaño, extensiones, largo, trenzas, estilo, boho, color, instagram, nombre, email, dirección, estructura, zona, nivel, base, respuesta, pelo, referencia.");
    }
  }
  return { cambios, errores };
}

export type CambioDePerfil = Partial<Pick<PerfilLegacy, "estructura" | "zona" | "nivel" | "smi">>;

export type ResultadoAplicar = {
  spec: SpecGuardada;
  /** Lo que Blake cambió del perfil de precios SOLO para esta cita (el perfil general no se toca). */
  perfil: CambioDePerfil;
  /** true si hay que volver a pedir el precio a Legacy (cambió algo que lo afecta y no hay precio manual). */
  recalcular: boolean;
};

const AFECTAN_AL_PRECIO = new Set([
  "horas", "materiales", "tipo", "tamano", "extensiones", "largo_ext", "trenzas", "estilo", "boho", "largo_cabello", "estructura", "zona", "nivel", "base",
]);

export function aplicarCambios(spec: SpecGuardada, cambios: Cambio[]): ResultadoAplicar {
  const s: SpecGuardada = { ...spec, servicio: { ...spec.servicio } };
  const perfil: CambioDePerfil = {};
  let tocaPrecio = false;
  for (const c of cambios) {
    if (AFECTAN_AL_PRECIO.has(c.k)) tocaPrecio = true;
    switch (c.k) {
      case "precio": s.precio_manual_centimos = c.centimos; if (c.centimos === null) tocaPrecio = true; break;
      case "senal": s.senal_centimos = c.centimos; break;
      case "horas": s.horas = c.horas; break;
      case "materiales": s.materiales = c.valor; break;
      case "boho": s.servicio.boho = c.v; break;
      // Cornrows, flat twist y barrel twist son siempre trenzas pegadas.
      case "estilo": s.servicio.estilo_pegadas = c.v; s.servicio.tipo_trenzado = "pegadas"; break;
      case "largo_cabello": s.servicio.largo_cabello = c.v; break;
      case "color": s.color_extensiones = c.v; break;
      case "instagram": s.instagram = c.v; break;
      case "estructura": perfil.estructura = c.v; break;
      case "zona": perfil.zona = c.v; break;
      case "nivel": perfil.nivel = c.v; break;
      case "base": perfil.smi = c.n; break;
      case "fecha": s.fecha = c.fecha; if (c.hora) s.hora = c.hora; break;
      case "hora": s.hora = c.hora; break;
      case "tipo":
        s.servicio.tipo_trenzado = c.v;
        // Si el tipo estaba asumido por la regla del número de trenzas, ya lo ha decidido Blake: el aviso sobra.
        s.avisos_validacion = s.avisos_validacion.filter((a) => !a.startsWith(AVISO_TIPO_ASUMIDO));
        break;
      case "tamano": s.servicio.tamano = c.v; break;
      case "extensiones": s.servicio.extensiones = c.v; break;
      case "largo_ext": s.servicio.largo_extensiones = c.v; break;
      case "trenzas": s.servicio.numero_trenzas = c.n; break;
      case "nombre": s.nombre = c.v; break;
      case "email": s.email = c.v; break;
      case "direccion": s.direccion = c.v; break;
      case "respuesta": s.respuesta_manual = c.v; break;
      // Las descripciones de fotos no tocan la reserva: el flujo las guarda junto a cada foto.
      case "foto_pelo":
        break;
      // …salvo la del peinado: también va al evento del calendario.
      case "foto_referencia": {
        s.descripcion_peinado = c.v;
        // Blake describe el peinado con sus palabras («6 flat twist pegadas, cabello largo»): si el nº de trenzas o el estilo
        // aún no estaban fijados, se toman de ahí para que el título del evento diga «6 Flat Twist» y no «Trenzas pegadas».
        const m = /(?:^|\D)(\d{1,2})\s*(flat\s*twists?|cornrows?|barrel\s*twists?)/i.exec(quitarAcentos(c.v));
        const sinNumero = /(flat\s*twists?|cornrows?|barrel\s*twists?)/i.exec(quitarAcentos(c.v));
        const nombreEstilo = (m?.[2] ?? sinNumero?.[1] ?? "").toLowerCase().replace(/\s+/g, "");
        const estilo = nombreEstilo.startsWith("flat") ? "twist" : nombreEstilo.startsWith("cornrow") ? "cornrows" : nombreEstilo.startsWith("barrel") ? "barrel_twist" : null;
        if (estilo && !s.servicio.estilo_pegadas) {
          s.servicio.estilo_pegadas = estilo;
          s.servicio.tipo_trenzado = "pegadas";
          tocaPrecio = true;
        }
        const n = m ? Number(m[1]) : null;
        if (n && n >= 1 && n <= 12 && !s.servicio.numero_trenzas) {
          s.servicio.numero_trenzas = n;
          tocaPrecio = true;
        }
        break;
      }
    }
  }
  // Si Blake fijó el precio a mano, los cambios de servicio no lo pisan.
  return { spec: s, perfil, recalcular: tocaPrecio && s.precio_manual_centimos === null };
}

/** ¿Hay datos suficientes para pedir el precio a Legacy? */
export const puedeCalcular = (s: SpecGuardada) => datosFaltantes(s.servicio).length === 0;
