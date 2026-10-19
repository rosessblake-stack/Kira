import { avisosDeHorario, duracionLegible, fechaLarga, madridAUtc, partesMadrid } from "./agenda";
import {
  EXTENSIONES,
  LARGOS_EXTENSIONES,
  TAMANOS,
  TIPOS_TRENZADO,
  limpiarTexto,
  type Clasificacion,
} from "./intents";
import { euros } from "./panel-rules";
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

export const SENAL_POR_DEFECTO_CENTIMOS = 1500; // la señal (10–20 €) la elige Blake; 15 € es solo el punto de partida
export const SENAL_MIN_CENTIMOS = 1000;
export const SENAL_MAX_CENTIMOS = 2000;

export type SpecGuardada = {
  /** Mensaje original del cliente (recortado): permite volver a mostrar la propuesta al editarla. */
  mensaje_cliente: string;
  servicio: ServicioParaPrecio;
  color_extensiones: string | null;
  fecha: string | null;
  hora: string | null;
  nombre: string | null;
  email: string | null;
  instagram: string | null;
  notas: string | null;
  confianza: "alta" | "media" | "baja";
  avisos_validacion: string[];
  /** Horas fijadas por Blake; null = las de por defecto. */
  horas: number | null;
  /** Precio puesto a mano por Blake; null = lo calcula Legacy. */
  precio_manual_centimos: number | null;
  senal_centimos: number;
  respuesta_manual: string | null;
};

export function specDesdeClasificacion(c: Clasificacion, mensajeCliente: string): SpecGuardada {
  return {
    mensaje_cliente: mensajeCliente,
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
    senal_centimos: SENAL_POR_DEFECTO_CENTIMOS,
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

function describirServicio(s: SpecGuardada): string {
  const v = s.servicio;
  const partes: string[] = [];
  partes.push(v.numero_trenzas ? `${v.numero_trenzas} trenzas` : "Trenzas");
  partes.push(v.tipo_trenzado ?? "tipo sin concretar");
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
  const partes: string[] = [v.numero_trenzas ? `${v.numero_trenzas} trenzas` : "tus trenzas"];
  if (v.tipo_trenzado) partes.push(v.tipo_trenzado);
  if (v.tamano) partes.push(`tamaño ${v.tamano}`);
  if (v.extensiones === "con" || v.extensiones === "feedin") {
    partes.push(`con extensiones${s.color_extensiones ? ` (${s.color_extensiones})` : ""}`);
  } else if (v.extensiones === "sin") partes.push("sin extensiones");
  if (v.boho) partes.push("estilo boho");
  return partes.join(" ");
}

export function resumenPerfil(p: PerfilLegacy): string {
  return `${p.nivel === "elite" ? "élite" : p.nivel} · zona ${p.zona} · ${p.estructura === "salon" ? "salón" : "casa"} · SMI ${p.smi} €`;
}

export function componerPropuesta(
  spec: SpecGuardada,
  precio: ResultadoPrecio,
  ctx: { ahora: Date; perfil: PerfilLegacy; calendarioConectado: boolean },
): Propuesta {
  const horasUsadas = spec.horas ?? horasPorDefecto(spec.servicio);
  const materialesUsados = materialesPorDefecto(spec.servicio);
  const duracionMinutos = horasUsadas > 0 ? Math.round(horasUsadas * 60) : null;

  let inicio: Date | null = null;
  if (spec.fecha && spec.hora) inicio = madridAUtc(spec.fecha, spec.hora);
  const fin = inicio && duracionMinutos ? new Date(inicio.getTime() + duracionMinutos * 60_000) : null;

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
  if (confianzaBaja(spec)) avisos.push("Kira no está segura de lo que pide (confianza baja): revisa el mensaje original.");
  if (!ctx.calendarioConectado) {
    avisos.push("Disponibilidad NO comprobada: el calendario todavía no está conectado. Mira tu agenda antes de aprobar.");
  }
  avisos.push(...avisosDeHorario(inicio, fin, ctx.ahora));
  if (precio.origen === "manual") avisos.push("El precio lo has puesto tú: no lo ha calculado Legacy.");
  if (precio.origen === "legacy") {
    if (!ctx.perfil.confirmado) avisos.push(`Perfil de precios sin confirmar (${resumenPerfil(ctx.perfil)}).`);
    if (spec.horas === null) {
      avisos.push(`Horas (${horasUsadas} h) y materiales (${materialesUsados} €) son valores por defecto sin confirmar. Cámbialos con «horas 3».`);
    }
  }
  const s = spec.servicio;
  if (s.tipo_trenzado === "pegadas" && (s.extensiones === "con" || s.extensiones === "feedin") && !s.largo_extensiones) {
    avisos.push("No dice hasta dónde quiere las extensiones (afecta al precio de las pegadas).");
  }
  if (!spec.email) avisos.push("No tengo su email: hará falta para la reserva y el recibo.");
  if (!spec.nombre) avisos.push("No dice su nombre.");
  if (spec.senal_centimos < SENAL_MIN_CENTIMOS || spec.senal_centimos > SENAL_MAX_CENTIMOS) {
    avisos.push(`La señal (${euros(spec.senal_centimos)}) está fuera del rango habitual de 10–20 €.`);
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
    borrador: componerBorrador(spec, precioCentimos, duracionMinutos, inicio, faltan),
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
): string {
  if (spec.respuesta_manual) return spec.respuesta_manual;
  if (precio === null || !inicio) {
    return `Borrador pendiente: faltan datos. ${faltan.join(" · ") || "fecha"}. Completa la propuesta con Editar.`;
  }
  const saludo = spec.nombre ? `¡Hola, ${spec.nombre}!` : "¡Hola!";
  return [
    `${saludo} Gracias por escribirme 😊`,
    `Para ${describirServicioNatural(spec)}, el precio es de ${euros(precio)}${duracion ? ` y dura aproximadamente ${duracionLegible(duracion)}` : ""}.`,
    `Me pides el ${fechaLarga(inicio)}. Lo confirmo y te aviso enseguida.`,
    `Para reservar el hueco se deja una señal de ${euros(spec.senal_centimos)}, que se descuenta del total. En cuanto lo confirme te paso el enlace de pago.`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Texto de la propuesta para Telegram (texto plano: nada del cliente se interpreta como formato)
// ---------------------------------------------------------------------------

const recorte = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);

export function textoPropuesta(
  p: Propuesta,
  spec: SpecGuardada,
  ctx: { mensajeCliente: string; esPrueba: boolean; perfil: PerfilLegacy },
): string {
  const l: string[] = [];
  l.push(`${ctx.esPrueba ? "🧪 PRUEBA · " : ""}PROPUESTA DE CITA`);
  l.push("");
  l.push(`👤 Cliente: ${spec.nombre ?? "sin nombre"}${p.emailCliente ? ` (${p.emailCliente})` : ""}${spec.instagram ? ` · ${spec.instagram}` : ""}`);
  l.push(`💬 Dijo: «${recorte(limpiarTexto(ctx.mensajeCliente, 600), 500)}»`);
  l.push("");
  l.push("🧾 Lo que he entendido");
  l.push(`• Servicio: ${p.descripcion}`);
  if (spec.servicio.largo_cabello) l.push(`• Pelo de la clienta: ${LARGO_CABELLO[spec.servicio.largo_cabello]}`);
  if (spec.servicio.largo_extensiones) l.push(`• Largo de las trenzas: ${LARGO_EXTENSIONES[spec.servicio.largo_extensiones]}`);
  if (p.inicio) {
    l.push(`• Fecha pedida: ${fechaLarga(p.inicio)}${p.fin ? ` → ${partesMadrid(p.fin).hora}` : ""}${p.duracionMinutos ? ` (${duracionLegible(p.duracionMinutos)})` : ""}`);
  } else {
    l.push("• Fecha pedida: sin concretar");
  }
  l.push("");
  if (p.precioCentimos !== null) {
    const origen = p.precioOrigen === "manual" ? "puesto por ti" : "Legacy";
    l.push(`💶 Precio: ${euros(p.precioCentimos)} (${origen}) · Señal: ${euros(p.senalCentimos)}`);
    if (p.precioOrigen === "legacy") l.push(`   ${p.horasUsadas} h · materiales ${p.materialesUsados} € · perfil ${resumenPerfil(ctx.perfil)}`);
  } else {
    l.push(`💶 Precio: sin calcular · Señal: ${euros(p.senalCentimos)}`);
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
  return "precio 80";
}

export const AYUDA_EDICION = [
  "Dime qué cambiar, una cosa por línea. Por ejemplo:",
  "precio 70",
  "señal 15",
  "horas 3",
  "fecha 20/10 12:00",
  "tipo pegadas",
  "tamaño large",
  "extensiones con",
  "largo caderas",
  "trenzas 6",
  "nombre Ana",
  "email ana@correo.com",
  "respuesta Hola Ana, ...",
  "",
  "«precio auto» devuelve el precio a Legacy. /cancelar lo deja como está.",
].join("\n");

export type Cambio =
  | { k: "precio"; centimos: number | null }
  | { k: "senal"; centimos: number }
  | { k: "horas"; horas: number }
  | { k: "fecha"; fecha: string; hora: string | null }
  | { k: "hora"; hora: string }
  | { k: "tipo"; v: (typeof TIPOS_TRENZADO)[number] }
  | { k: "tamano"; v: (typeof TAMANOS)[number] }
  | { k: "extensiones"; v: (typeof EXTENSIONES)[number] }
  | { k: "largo_ext"; v: (typeof LARGOS_EXTENSIONES)[number] }
  | { k: "trenzas"; n: number }
  | { k: "nombre"; v: string }
  | { k: "email"; v: string }
  | { k: "respuesta"; v: string };

/** Nombre de cada cambio tal como lo escribe Blake (no el identificador interno). */
const ETIQUETAS_CAMBIO: Record<Cambio["k"], string> = {
  precio: "precio", senal: "señal", horas: "horas", fecha: "fecha", hora: "hora", tipo: "tipo", tamano: "tamaño",
  extensiones: "extensiones", largo_ext: "largo", trenzas: "trenzas", nombre: "nombre", email: "email", respuesta: "respuesta",
};
export const etiquetaCambio = (k: Cambio["k"]) => ETIQUETAS_CAMBIO[k];

const quitarAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function numero(txt: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros)?\s*$/i.exec(txt);
  return m ? Number(m[1].replace(",", ".")) : null;
}

const HORA_RE = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/;

/** "20/10", "20/10/2026", "20-10", "2026-10-20" → AAAA-MM-DD (sin año: la próxima vez que llegue esa fecha). */
export function interpretarFecha(txt: string, ahora: Date): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(txt);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const dm = /\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/.exec(txt);
    if (!dm) return null;
    d = Number(dm[1]);
    m = Number(dm[2]);
    const hoy = partesMadrid(ahora).fecha.split("-").map(Number);
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
  const solo = /^\s*(?:a\s+las\s+)?([01]?\d|2[0-3])\s*(?:h|horas)?\s*$/i.exec(txt);
  return solo ? `${solo[1].padStart(2, "0")}:00` : null;
}

const EMAIL_RE = /^[^\s@<>"',;()]{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,24}$/;

export function parsearEdicion(texto: string, ahora: Date): { cambios: Cambio[]; errores: string[] } {
  const cambios: Cambio[] = [];
  const errores: string[] = [];
  const lineas = texto
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const linea of lineas) {
    const m = /^(\S+)\s*(.*)$/.exec(linea);
    if (!m) continue;
    const clave = quitarAcentos(m[1].toLowerCase());
    const valor = m[2].trim();
    const err = (msg: string) => errores.push(`«${recorte(linea, 60)}»: ${msg}`);

    switch (clave) {
      case "precio": {
        if (/^auto$/i.test(valor)) { cambios.push({ k: "precio", centimos: null }); break; }
        const n = numero(valor);
        if (n === null || n <= 0 || n > 5000) err("el precio debe ser un número de euros, por ejemplo «precio 70».");
        else cambios.push({ k: "precio", centimos: Math.round(n * 100) });
        break;
      }
      case "senal": {
        const n = numero(valor);
        if (n === null || n <= 0 || n > 500) err("la señal debe ser un número de euros, por ejemplo «señal 15».");
        else cambios.push({ k: "senal", centimos: Math.round(n * 100) });
        break;
      }
      case "horas": {
        const n = numero(valor);
        if (n === null || n < 0.5 || n > 14) err("las horas deben estar entre 0,5 y 14, por ejemplo «horas 3».");
        else cambios.push({ k: "horas", horas: Math.round(n * 2) / 2 });
        break;
      }
      case "fecha": {
        const f = interpretarFecha(valor, ahora);
        if (!f) { err("no entiendo la fecha; prueba «fecha 20/10 12:00»."); break; }
        cambios.push({ k: "fecha", fecha: f, hora: interpretarHora(valor.replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/, "")) });
        break;
      }
      case "hora": {
        const h = interpretarHora(valor);
        if (!h) err("no entiendo la hora; prueba «hora 12:00».");
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
      case "respuesta": {
        const v = valor.replace(/\s+$/g, "");
        if (!v) err("escribe el texto de la respuesta después de «respuesta».");
        else cambios.push({ k: "respuesta", v: recorte(v, 900) });
        break;
      }
      default:
        err("no sé qué cambiar con eso. Claves: precio, señal, horas, fecha, hora, tipo, tamaño, extensiones, largo, trenzas, nombre, email, respuesta.");
    }
  }
  return { cambios, errores };
}

export type ResultadoAplicar = {
  spec: SpecGuardada;
  /** true si hay que volver a pedir el precio a Legacy (cambió algo que lo afecta y no hay precio manual). */
  recalcular: boolean;
};

const AFECTAN_AL_PRECIO = new Set(["horas", "tipo", "tamano", "extensiones", "largo_ext", "trenzas"]);

export function aplicarCambios(spec: SpecGuardada, cambios: Cambio[]): ResultadoAplicar {
  const s: SpecGuardada = { ...spec, servicio: { ...spec.servicio } };
  let tocaPrecio = false;
  for (const c of cambios) {
    if (AFECTAN_AL_PRECIO.has(c.k)) tocaPrecio = true;
    switch (c.k) {
      case "precio": s.precio_manual_centimos = c.centimos; if (c.centimos === null) tocaPrecio = true; break;
      case "senal": s.senal_centimos = c.centimos; break;
      case "horas": s.horas = c.horas; break;
      case "fecha": s.fecha = c.fecha; if (c.hora) s.hora = c.hora; break;
      case "hora": s.hora = c.hora; break;
      case "tipo": s.servicio.tipo_trenzado = c.v; break;
      case "tamano": s.servicio.tamano = c.v; break;
      case "extensiones": s.servicio.extensiones = c.v; break;
      case "largo_ext": s.servicio.largo_extensiones = c.v; break;
      case "trenzas": s.servicio.numero_trenzas = c.n; break;
      case "nombre": s.nombre = c.v; break;
      case "email": s.email = c.v; break;
      case "respuesta": s.respuesta_manual = c.v; break;
    }
  }
  // Si Blake fijó el precio a mano, los cambios de servicio no lo pisan.
  return { spec: s, recalcular: tocaPrecio && s.precio_manual_centimos === null };
}

/** ¿Hay datos suficientes para pedir el precio a Legacy? */
export const puedeCalcular = (s: SpecGuardada) => datosFaltantes(s.servicio).length === 0;
