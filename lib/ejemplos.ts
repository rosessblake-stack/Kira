import { MAX_BYTES_FOTO, detectarImagen, sha256Hex } from "./fotos";
import { ESTILOS_PEGADAS, limpiarTexto } from "./intents";

/**
 * Fotos de ejemplo con su estilo, etiquetadas por Blake (cornrows / flat twist / barrel twist). Se le enseñan a Claude junto a la foto
 * de la clienta para que distinga los estilos («few-shot»): es lo único que «aprende», y solo de lo que Blake etiquetó. Las manda Blake
 * por Telegram con el pie «ejemplo flat twist» (no son fotos de clientas). Mismas defensas que las demás fotos: tipo por bytes, tope de
 * tamaño, almacén privado y repetidas detectadas por sha256.
 */

export type EstiloPegadas = (typeof ESTILOS_PEGADAS)[number];

export const NOMBRE_ESTILO_EJEMPLO: Record<EstiloPegadas, string> = { cornrows: "cornrows", twist: "flat twist", barrel_twist: "barrel twist" };
/** Cuántos ejemplos como máximo por estilo (más no mejoran la lectura y cada imagen cuesta tokens). */
export const MAX_EJEMPLOS_POR_ESTILO = 6;
/** Cuántos de cada estilo se le enseñan a Claude en cada lectura (los más recientes). */
export const EJEMPLOS_POR_ESTILO_A_CLAUDE = 2;
export const MAX_DESCRIPCION_EJEMPLO = 300;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «ejemplo flat twist», «ejemplo cornrows: seis trenzas finas», «ejemplo barrel twist - …». null si el pie no es de un ejemplo. */
export function interpretarPieEjemplo(pie: string): { estilo: EstiloPegadas; descripcion: string | null } | null {
  const t = sinAcentos(limpiarTexto(pie, 400));
  const m = /^ejemplos?\s+(cornrows?|corn\s*rows?|flat[\s_-]*twists?|twists?|barrel[\s_-]*twists?)\s*(?:[:\-–]\s*|\s+|$)([\s\S]*)$/.exec(t);
  if (!m) return null;
  const e = m[1].replace(/[\s_-]+/g, "");
  const estilo: EstiloPegadas = e.startsWith("barrel") ? "barrel_twist" : e.includes("twist") ? "twist" : "cornrows";
  const original = limpiarTexto(pie, 400);
  const resto = limpiarTexto(original.slice(original.length - m[2].length), MAX_DESCRIPCION_EJEMPLO);
  return { estilo, descripcion: resto || null };
}

export type EjemploGuardado = { seq: number; estilo: EstiloPegadas; description: string | null; created_at: string };
export type NuevoEjemplo = { id: string; estilo: EstiloPegadas; storagePath: string; mime: "image/jpeg" | "image/png" | "image/webp"; sha256: string; size: number; descripcion: string | null };
export type Descarga = { ok: true; bytes: Uint8Array } | { ok: false; motivo: "grande" | "error" };

export interface EjemplosDeps {
  newId(): string;
  descargar(fileId: string, maxBytes: number): Promise<Descarga>;
  /** Devuelve el número (#) con que Blake lo verá, o null si ya estaba (misma foto). */
  guardar(e: NuevoEjemplo, bytes: Uint8Array): Promise<{ seq: number } | null>;
  contarPorEstilo(): Promise<Record<EstiloPegadas, number>>;
  listar(): Promise<EjemploGuardado[]>;
  borrar(seq: number): Promise<boolean>;
  /** Los bytes de la última foto de REFERENCIA (no borrada) de la conversación de esa reserva, o null. */
  fotoReferenciaDeReserva?(reservaId: string): Promise<Uint8Array | null>;
  /** Para que la próxima lectura use los ejemplos nuevos. */
  invalidarCache(): void;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { source: "telegram" | "system"; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown> }): Promise<void>;
}

export interface EjemplosPort {
  recibir(chatId: number, media: { fileId: string; tamano: number | null }, estilo: EstiloPegadas, descripcion: string | null): Promise<void>;
  listar(chatId: number): Promise<void>;
  borrar(chatId: number, seq: number): Promise<void>;
  /** Botón «💾 Guardar como ejemplo» tras corregir el estilo de una propuesta: guarda la foto de referencia de esa reserva. */
  guardarDeReserva(chatId: number, reservaIdSinGuiones: string, estilo: EstiloPegadas): Promise<void>;
}

/** Los códigos del botón (callback_data lleva el id de la reserva sin guiones + una letra). */
export const CODIGO_ESTILO: Record<EstiloPegadas, string> = { cornrows: "c", twist: "t", barrel_twist: "b" };
export const ESTILO_DE_CODIGO: Record<string, EstiloPegadas> = { c: "cornrows", t: "twist", b: "barrel_twist" };
const UUID32 = /^[0-9a-f]{32}$/;
const aUuid = (s: string) => `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

export function crearFlujoEjemplos(deps: EjemplosDeps): EjemplosPort {
  async function recibir(chatId: number, media: { fileId: string; tamano: number | null }, estilo: EstiloPegadas, descripcion: string | null) {
    const nombre = NOMBRE_ESTILO_EJEMPLO[estilo];
    if (media.tamano !== null && media.tamano > MAX_BYTES_FOTO) {
      await deps.enviar(chatId, "Esa foto pesa demasiado (máximo 4 MB). Mándala como foto normal, no como archivo.");
      return;
    }
    const cuentas = await deps.contarPorEstilo();
    if (cuentas[estilo] >= MAX_EJEMPLOS_POR_ESTILO) {
      await deps.enviar(chatId, `Ya tengo ${MAX_EJEMPLOS_POR_ESTILO} ejemplos de ${nombre}. Mira /ejemplos y borra uno con /borrarejemplo N para poner otro.`);
      return;
    }
    const d = await deps.descargar(media.fileId, MAX_BYTES_FOTO);
    if (!d.ok) {
      await deps.enviar(chatId, d.motivo === "grande" ? "Esa foto pesa demasiado (máximo 4 MB)." : "No he podido descargar la foto de Telegram. Inténtalo otra vez.");
      return;
    }
    await guardarBytes(chatId, estilo, descripcion, d.bytes, cuentas[estilo]);
  }

  /** Valida y guarda unos bytes como ejemplo (la misma ruta para la foto que manda Blake y para la de una propuesta). */
  async function guardarBytes(chatId: number, estilo: EstiloPegadas, descripcion: string | null, bytes: Uint8Array, yaGuardados: number) {
    const nombre = NOMBRE_ESTILO_EJEMPLO[estilo];
    const tipo = detectarImagen(bytes);
    if (!tipo) {
      await deps.enviar(chatId, "Eso no parece una foto (JPG, PNG o WebP).");
      return;
    }
    const id = deps.newId();
    try {
      const g = await deps.guardar(
        { id, estilo, storagePath: `ejemplos/${id}.${EXT[tipo.mime]}`, mime: tipo.mime, sha256: await sha256Hex(bytes), size: bytes.length, descripcion },
        bytes,
      );
      if (!g) {
        await deps.enviar(chatId, "Esa foto ya la tenía guardada como ejemplo.");
        return;
      }
      deps.invalidarCache();
      await deps.logEvent({ source: "telegram", kind: "ejemplo_guardado", summary: `Ejemplo de ${nombre} guardado (#${g.seq})`, detail: { estilo, seq: g.seq } });
      await deps.enviar(chatId, `✅ Guardada como ejemplo de ${nombre} (#${g.seq}). Tengo ${yaGuardados + 1} de ${nombre}. Desde ahora Kira la usa para distinguir los estilos.`);
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "ejemplo_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
      await deps.enviar(chatId, "No he podido guardar el ejemplo. Inténtalo otra vez.");
    }
  }

  async function guardarDeReserva(chatId: number, reservaIdSinGuiones: string, estilo: EstiloPegadas) {
    const nombre = NOMBRE_ESTILO_EJEMPLO[estilo];
    if (!UUID32.test(reservaIdSinGuiones) || !deps.fotoReferenciaDeReserva) {
      await deps.enviar(chatId, "No he podido encontrar esa foto.");
      return;
    }
    const cuentas = await deps.contarPorEstilo();
    if (cuentas[estilo] >= MAX_EJEMPLOS_POR_ESTILO) {
      await deps.enviar(chatId, `Ya tengo ${MAX_EJEMPLOS_POR_ESTILO} ejemplos de ${nombre}. Mira /ejemplos y borra uno con /borrarejemplo N para poner otro.`);
      return;
    }
    let bytes: Uint8Array | null = null;
    try {
      bytes = await deps.fotoReferenciaDeReserva(aUuid(reservaIdSinGuiones));
    } catch {
      bytes = null;
    }
    if (!bytes) {
      await deps.enviar(chatId, "La foto de referencia de esa clienta ya no está guardada.");
      return;
    }
    await guardarBytes(chatId, estilo, null, bytes, cuentas[estilo]);
  }

  async function listar(chatId: number) {
    const todos = await deps.listar();
    if (!todos.length) {
      await deps.enviar(
        chatId,
        "Todavía no hay ejemplos.\n\nMándame una foto con el pie «ejemplo cornrows», «ejemplo flat twist» o «ejemplo barrel twist» (puedes añadir una descripción: «ejemplo flat twist: 6 finos hacia atrás»).",
      );
      return;
    }
    const lineas = (Object.keys(NOMBRE_ESTILO_EJEMPLO) as EstiloPegadas[]).map((e) => {
      const de = todos.filter((x) => x.estilo === e);
      return `• ${NOMBRE_ESTILO_EJEMPLO[e]}: ${de.length ? de.map((x) => `#${x.seq}${x.description ? ` (${limpiarTexto(x.description, 40)})` : ""}`).join(", ") : "ninguno"}`;
    });
    await deps.enviar(chatId, `Ejemplos que usa Kira para distinguir estilos:\n${lineas.join("\n")}\n\n/borrarejemplo N quita uno.`);
  }

  async function borrar(chatId: number, seq: number) {
    const ok = await deps.borrar(seq);
    if (ok) deps.invalidarCache();
    await deps.enviar(chatId, ok ? `Ejemplo #${seq} borrado.` : `No encuentro el ejemplo #${seq}. Mira /ejemplos.`);
  }

  return { recibir, listar, borrar, guardarDeReserva };
}
