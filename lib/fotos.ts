import { createHash } from "node:crypto";
import { limpiarTexto } from "./intents";

/**
 * Fotos de las clientas (pelo y trenzas de referencia): reglas puras, sin red ni base de datos.
 *
 * Una foto es un archivo que llega de fuera, así que nunca se fía de lo que dice quien lo envía:
 * el tipo se decide por los primeros bytes del archivo, el tamaño tiene tope y la ruta de guardado
 * la compone el código con identificadores propios (nunca con el nombre que traiga el archivo).
 * El texto que escribe Blake para describirlas se limpia como cualquier otro texto que acaba en pantalla.
 */

export const TIPOS_FOTO = ["pelo", "referencia", "otra"] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

export const ETIQUETA_FOTO: Record<TipoFoto, string> = {
  pelo: "Pelo de la clienta",
  referencia: "Trenzas de referencia",
  otra: "Otra foto",
};

/** Cabe en la respuesta de una función de Vercel (4,5 MB) con margen; una foto normal de Telegram o Instagram pesa mucho menos. */
export const MAX_BYTES_FOTO = 4 * 1024 * 1024;
export const MAX_FOTOS_POR_CONVERSACION = 8;
/** Pasado este plazo se borra la foto; la descripción de Blake se conserva. */
export const RETENCION_DIAS = 60;
export const MAX_DESCRIPCION = 1000;
/** Las fotos que Blake manda sueltas se pegan a la prueba más reciente si es de las últimas horas. */
export const VENTANA_ADJUNTAR_MIN = 6 * 60;

export type ImagenDetectada = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

const ascii = (b: Uint8Array, desde: number, texto: string) => [...texto].every((c, i) => b[desde + i] === c.charCodeAt(0));

/** Tipo real de la imagen según sus primeros bytes. Cualquier otra cosa (GIF, SVG, PDF, HTML...) devuelve null. */
export function detectarImagen(b: Uint8Array): ImagenDetectada | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mime: "image/png", ext: "png" };
  }
  if (b.length >= 12 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  return null;
}

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string) => UUID_RE.test(v);

/** Ruta dentro del almacén privado: solo identificadores nuestros y una extensión de la lista cerrada. */
export function rutaAlmacenamiento(conversacionId: string, fotoId: string, ext: ImagenDetectada["ext"]): string {
  if (!esUuid(conversacionId) || !esUuid(fotoId)) throw new Error("Identificador de foto no válido");
  return `${conversacionId}/${fotoId}.${ext}`;
}

export const caducaEl = (ahora: Date) => new Date(ahora.getTime() + RETENCION_DIAS * 86_400_000);

/** Sin indicación, la primera foto se toma como del pelo, la segunda como de referencia y el resto como «otra». */
export function siguienteTipo(existentes: TipoFoto[]): TipoFoto {
  if (!existentes.includes("pelo")) return "pelo";
  if (!existentes.includes("referencia")) return "referencia";
  return "otra";
}

const PALABRAS_TIPO: Record<string, TipoFoto> = {
  pelo: "pelo",
  cabello: "pelo",
  referencia: "referencia",
  ref: "referencia",
  trenzas: "referencia",
  otra: "otra",
};

const quitarAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Lo que Blake escribe al enviar una foto: «pelo: rizado, fino, a los hombros». Si empieza por pelo / referencia /
 * trenzas / otra, eso fija el tipo y el resto es la descripción; si no, todo el texto es la descripción.
 */
export function interpretarPieDeFoto(pie: string): { tipo: TipoFoto | null; descripcion: string | null } {
  const limpio = limpiarTexto(pie, MAX_DESCRIPCION + 40);
  if (!limpio) return { tipo: null, descripcion: null };
  const m = /^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)(?:\s*[:\-–]\s*|\s+|$)([\s\S]*)$/.exec(limpio);
  const tipo = m ? PALABRAS_TIPO[quitarAcentos(m[1]).toLowerCase()] : undefined;
  if (m && tipo) {
    const resto = limpiarTexto(m[2], MAX_DESCRIPCION);
    return { tipo, descripcion: resto || null };
  }
  return { tipo: null, descripcion: limpiarTexto(limpio, MAX_DESCRIPCION) || null };
}

/** Descripción escrita por Blake para guardarla: sin caracteres de control y con tope. */
export const limpiarDescripcion = (t: string) => limpiarTexto(t, MAX_DESCRIPCION);

/** Lo que necesita la propuesta de cada foto: qué es y qué dijo Blake que se ve. */
export type ResumenFoto = { tipo: TipoFoto; descripcion: string | null };
