import { limpiarTexto } from "./intents";
import type { Ubicacion } from "./ubicacion";

/**
 * Lo que ManyChat manda a Kira cuando la clienta termina el flujo «cita / agendar» (docs/FLUJO_MANYCHAT.md).
 * Todo viene de fuera, así que se lee de forma tolerante con la FORMA (ManyChat puede mandar los datos del contacto completos o un
 * JSON plano; los nombres de los campos no distinguen mayúsculas, acentos ni espacios) pero estricta con los VALORES: texto limpio y
 * con tope, email y usuario de Instagram con formato exacto, direcciones de foto solo https (el dominio lo vuelve a comprobar la descarga).
 *
 * Del texto que escribió la clienta se compone un mensaje único para el clasificador. Ese mensaje NO usa la palabra «trenza»: la regla
 * de Blake «trenzas sin número = sueltas» (intents.ts) se aplica a lo que dice la clienta, no a nuestra plantilla.
 */

export type SolicitudManychat = {
  /** Id del contacto en ManyChat (identifica la conversación). */
  contactoId: string;
  /** Usuario de Instagram sin @ (validado) o null. */
  instagram: string | null;
  nombre: string | null;
  /** Email con formato válido o null. */
  email: string | null;
  ubicacion: Ubicacion;
  /** true si el campo «país» no era ni Miami ni España: se toma España y la propuesta lo avisa. */
  ubicacionDudosa: boolean;
  fotoReferenciaUrl: string | null;
  fotoPeloUrl: string | null;
  usoExtensiones: "si" | "no" | null;
  colorExtensiones: string | null;
  largo: string | null;
  /** Botones «¿Qué estilo es?» y «¿Cuántas trenzas?» del flujo (cornrows / flat twist / barrel twist; «No sé» = null). */
  estilo?: "cornrows" | "twist" | "barrel_twist" | null;
  numeroTrenzas?: number | null;
  fechaTexto: string | null;
  /** Mensaje único que se manda a clasificar. */
  texto: string;
  /** Nombres (nunca valores) de los campos que llegaron con algo escrito: para saber qué falta cuando algo no cuadra. */
  claves?: string[];
};

export type ResultadoEntrada = { ok: true; solicitud: SolicitudManychat } | { ok: false; motivo: string };

const EMAIL_RE = /^[^\s@<>"',;()]{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,24}$/;
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_URL = 2000;

const clave = (k: string) => k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Aplana el JSON recibido a {clave normalizada → valor de texto}. Admite objetos anidados y custom_fields como objeto o lista. */
function aplanar(raw: unknown): Map<string, string> {
  const salida = new Map<string, string>();
  const poner = (k: string, v: unknown) => {
    const nk = clave(k);
    if (!nk || salida.has(nk)) return;
    if (typeof v === "string") salida.set(nk, v);
    else if (typeof v === "number" && Number.isFinite(v)) salida.set(nk, String(v));
  };
  const recorrer = (o: unknown, nivel: number) => {
    if (nivel > 3 || o === null || typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const e of o.slice(0, 200)) {
        if (e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string") poner((e as { name: string }).name, (e as { value?: unknown }).value);
      }
      return;
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>).slice(0, 300)) {
      if (v !== null && typeof v === "object") recorrer(v, nivel + 1);
      else poner(k, v);
    }
  };
  recorrer(raw, 0);
  return salida;
}

function primero(m: Map<string, string>, claves: string[]): string | null {
  for (const k of claves) {
    const v = m.get(k);
    if (v === undefined) continue;
    const t = limpiarTexto(v, MAX_URL);
    // ManyChat deja el marcador sin sustituir cuando el campo está vacío.
    if (t && !/^\{\{.*\}\}$/.test(t)) return t;
  }
  return null;
}

const texto_ = (v: string | null, max: number) => (v ? limpiarTexto(v, max) || null : null);
const texto = (v: string | null, max: number) => (v ? limpiarTexto(v, max) || null : null);

function url(v: string | null): string | null {
  if (!v || v.length > MAX_URL) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function ubicacionDe(v: string | null): { ubicacion: Ubicacion; dudosa: boolean } {
  const t = sinAcentos(v ?? "");
  if (/miami|florida|usa|eeuu|ee\.?uu|estados unidos/.test(t)) return { ubicacion: "miami", dudosa: false };
  if (/espan|spain|barcelona|madrid/.test(t)) return { ubicacion: "espana", dudosa: false };
  return { ubicacion: "espana", dudosa: true };
}

/** El botón de estilo → el valor de Kira. «No sé» y cualquier otra cosa = null (lo decide la foto o Blake). */
export function estiloDe(v: string | null): "cornrows" | "twist" | "barrel_twist" | null {
  const t = sinAcentos(v ?? "").replace(/[\s_-]+/g, "");
  if (/barrel/.test(t)) return "barrel_twist";
  if (/twist/.test(t)) return "twist";
  if (/cornrow/.test(t)) return "cornrows";
  return null;
}

/** «6» → 6; «Otro», «no sé», «40» → null (solo 1–30). */
export function numeroTrenzasDe(v: string | null): number | null {
  const m = /^\s*(\d{1,2})\s*(?:trenzas?)?\s*$/i.exec(v ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
}

function extensionesDe(v: string | null): "si" | "no" | null {
  const t = sinAcentos(v ?? "").trim();
  if (/^(si|yes|s)\b/.test(t)) return "si";
  if (/^(no|n)\b/.test(t)) return "no";
  return null;
}

/** Los cuatro botones del largo: se traducen a un texto que el clasificador entiende, conservando lo que eligió la clienta. */
export function largoComoTexto(v: string): string {
  const t = sinAcentos(v);
  if (/nuca/.test(t)) return "hasta la nuca";
  if (/media espalda/.test(t)) return "hasta media espalda";
  if (/cintura/.test(t)) return `por las caderas (la clienta eligió «${v}»)`;
  if (/(debajo|culo|gluteo)/.test(t)) return `más largo que las caderas (la clienta eligió «${v}»)`;
  return v;
}

export function componerMensaje(s: Pick<SolicitudManychat, "nombre" | "instagram" | "email" | "usoExtensiones" | "colorExtensiones" | "largo" | "fechaTexto">): string {
  const l = ["Solicitud de cita recibida por el formulario de Instagram."];
  if (s.nombre) l.push(`Nombre: ${s.nombre}`);
  if (s.instagram) l.push(`Instagram: @${s.instagram}`);
  if (s.email) l.push(`Email: ${s.email}`);
  if (s.usoExtensiones) l.push(`Extensiones: ${s.usoExtensiones === "si" ? "sí quiere extensiones" : "no quiere extensiones"}`);
  if (s.colorExtensiones) l.push(`Color de las extensiones: ${s.colorExtensiones}`);
  if (s.largo) l.push(`Largo deseado: ${largoComoTexto(s.largo)}`);
  if (s.fechaTexto) l.push(`Fecha y hora deseadas: ${s.fechaTexto}`);
  l.push("El estilo exacto está en la foto de referencia; no lo ha descrito con palabras.");
  return l.join("\n");
}

/** Solo los NOMBRES de los campos recibidos (nunca los valores): para saber qué manda ManyChat cuando algo no cuadra. */
export function clavesRecibidas(raw: unknown): string[] {
  return [...aplanar(raw).keys()].slice(0, 40).map((k) => k.slice(0, 40));
}

export function leerSolicitud(raw: unknown): ResultadoEntrada {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, motivo: "cuerpo_no_es_objeto" };
  const m = aplanar(raw);

  const id = primero(m, ["id", "subscriberid", "contactid", "userid", "igid"]);
  if (!id || !ID_RE.test(id)) return { ok: false, motivo: "sin_id_de_contacto" };

  const igRaw = texto(primero(m, ["igusername", "instagram", "instagramusername", "username"]), 60)?.replace(/^@/, "") ?? null;
  const emailRaw = texto(primero(m, ["email"]), 120);
  const nombre = texto(primero(m, ["nombre", "firstname", "name"]), 60);
  const pais = ubicacionDe(primero(m, ["paisdecliente", "pais", "country", "ubicacion"]));

  const base = {
    contactoId: id,
    instagram: igRaw && INSTAGRAM_RE.test(igRaw) ? igRaw : null,
    nombre,
    email: emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : null,
    ubicacion: pais.ubicacion,
    ubicacionDudosa: pais.dudosa,
    fotoReferenciaUrl: url(primero(m, ["referenciadiseno", "referencia", "referencedesign"])),
    fotoPeloUrl: url(primero(m, ["estadocabello", "fotopelo"])),
    usoExtensiones: extensionesDe(primero(m, ["usoextensiones"])),
    colorExtensiones: texto(primero(m, ["colorextensiones", "clorextensiones"]), 80),
    largo: texto(primero(m, ["largotrenzas", "largo"]), 60),
    estilo: estiloDe(primero(m, ["estilotrenzas", "estilo"])),
    numeroTrenzas: numeroTrenzasDe(primero(m, ["numtrenzas", "numerotrenzas", "numerodetrenzas", "trenzas"])),
    fechaTexto: texto(primero(m, ["fechatexto"]), 200),
  };
  const claves = [...m.entries()]
    .filter(([, v]) => {
      const t = limpiarTexto(v, 50);
      return t && !/^\{\{.*\}\}$/.test(t);
    })
    .map(([k]) => k.slice(0, 40))
    .slice(0, 40);
  return { ok: true, solicitud: { ...base, texto: componerMensaje(base), claves } };
}

// ---------------------------------------------------------------------------
// Lo que la clienta escribe DESPUÉS del flujo («vale», «confirmado»…), reenviado por ManyChat
// ---------------------------------------------------------------------------

export type RespuestaManychat = { contactoId: string; texto: string };

/** El cuerpo de /api/manychat/respuesta: el id del contacto y lo que acaba de escribir. */
export function leerRespuesta(raw: unknown): { ok: true; respuesta: RespuestaManychat } | { ok: false; motivo: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, motivo: "cuerpo_no_es_objeto" };
  const m = aplanar(raw);
  const id = primero(m, ["id", "subscriberid", "contactid", "userid", "igid"]);
  if (!id || !ID_RE.test(id)) return { ok: false, motivo: "sin_id_de_contacto" };
  const texto = texto_(primero(m, ["texto", "lastinputtext", "mensaje", "message", "text"]), 600);
  if (!texto) return { ok: false, motivo: "sin_texto" };
  return { ok: true, respuesta: { contactoId: id, texto } };
}

/** La consulta «¿conoces a esta clienta?» del principio del flujo: solo el usuario de Instagram (el que da Meta), ya validado. */
export function leerConsultaClienta(raw: unknown): { instagram: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { instagram: null };
  const m = aplanar(raw);
  const ig = texto(primero(m, ["igusername", "instagram", "instagramusername", "username"]), 60)?.replace(/^@/, "").toLowerCase() ?? null;
  return { instagram: ig && INSTAGRAM_RE.test(ig) ? ig : null };
}
