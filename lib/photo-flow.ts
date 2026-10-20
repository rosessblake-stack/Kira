import { partesMadrid } from "./agenda";
import {
  ETIQUETA_FOTO,
  MAX_BYTES_FOTO,
  MAX_FOTOS_POR_CONVERSACION,
  caducidadPara,
  seConserva,
  detectarImagen,
  interpretarPieDeFoto,
  rutaAlmacenamiento,
  sha256Hex,
  siguienteTipo,
  type ResumenFoto,
  type TipoFoto,
} from "./fotos";
import { limpiarTexto } from "./intents";

/**
 * Fotos de las clientas, de principio a fin, escritas contra interfaces (PhotoDeps) para probarlas enteras.
 * Reglas que cumple (docs/SEGURIDAD.md):
 *  - Una foto es un archivo de fuera: se decide su tipo por los bytes, tiene tope de tamaño y se guarda
 *    en un almacén privado con identificadores propios.
 *  - Solo Blake (administrador) puede enviar fotos por Telegram; el canal de clientes llegará con ManyChat.
 *  - Nada de lo que traiga una foto se interpreta: la describe Blake con sus palabras.
 *  - La foto no se manda a Claude (la visión queda para más adelante, cuando Blake lo decida).
 */

export type FotoGuardada = {
  id: string;
  conversation_id: string;
  kind: TipoFoto;
  source: "telegram" | "manychat";
  storage_path: string | null;
  content_type: "image/jpeg" | "image/png" | "image/webp";
  size_bytes: number;
  sha256: string;
  description: string | null;
  described_at: string | null;
  created_at: string;
  /** null = se conserva siempre (fotos de referencia). */
  expires_at: string | null;
  purged_at: string | null;
};

export type NuevaFoto = {
  id: string;
  conversationId: string;
  tipo: TipoFoto;
  origen: "telegram" | "manychat";
  storagePath: string;
  mime: FotoGuardada["content_type"];
  sha256: string;
  descripcion: string | null;
  creadaEn: string;
  /** null = se conserva siempre (fotos de referencia). */
  caducaEn: string | null;
};

/** Archivo que Blake envía por Telegram (foto normal o archivo de imagen). */
export type MediaTelegram = { fileId: string; tamano: number | null };

export type Descarga = { ok: true; bytes: Uint8Array } | { ok: false; motivo: "grande" | "error"; detalle?: string };

type Fuente = "manychat" | "stripe" | "telegram" | "typeform" | "claude" | "calendar" | "legacy" | "system";

export interface PhotoDeps {
  now(): Date;
  newId(): string;
  /** Prueba más reciente (de las últimas horas), a la que se pegan las fotos sueltas. */
  conversacionReciente(ahora: Date): Promise<{ id: string; creada: string; primerMensaje: string | null } | null>;
  primerMensaje(conversationId: string): Promise<string | null>;
  fotosDe(conversationId: string): Promise<FotoGuardada[]>;
  descargar(fileId: string, maxBytes: number): Promise<Descarga>;
  guardar(f: NuevaFoto, bytes: Uint8Array): Promise<FotoGuardada>;
  /** `caducaEn` solo se envía si cambia la clase de retención (de/hacia referencia); null = se conserva siempre. */
  actualizarFicha(id: string, cambios: { tipo?: TipoFoto; descripcion?: string | null; caducaEn?: string | null }, ahora: Date): Promise<void>;
  leerBytes(foto: FotoGuardada): Promise<Uint8Array | null>;
  /** Borra los archivos caducados (de mejor esfuerzo). */
  purgarCaducadas(ahora: Date): Promise<number>;
  enviar(chatId: number, texto: string): Promise<number | null>;
  enviarFotos(chatId: number, fotos: { bytes: Uint8Array; mime: string; ext: string; pie: string }[]): Promise<void>;
  logEvent(e: { source: Fuente; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown>; conversation_id?: string | null }): Promise<void>;
  logSecurity(e: { kind: "payload_inesperado"; source: string; conversation_id?: string | null; detail?: Record<string, unknown> }): Promise<void>;
}

export interface PhotoPort {
  /** conversationId = null → la prueba más reciente. `pie` es el texto que Blake puso a la foto. */
  recibir(chatId: number, media: MediaTelegram, conversationId: string | null, pie: string): Promise<void>;
  /** Vuelve a enviar a Blake las fotos de una conversación (null = la prueba más reciente). */
  reenviar(chatId: number, conversationId: string | null, opts?: { silencioso?: boolean }): Promise<void>;
  /**
   * Guarda una foto que ya se descargó (la de una clienta, vía ManyChat): comprueba los bytes, el tope y las repetidas y no escribe a
   * nadie. `ok` también cuando la foto ya estaba guardada.
   */
  guardarDeClienta(conversationId: string, tipo: "pelo" | "referencia", bytes: Uint8Array): Promise<{ ok: true; repetida: boolean } | { ok: false; motivo: "no_es_imagen" | "limite" | "error" }>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");
const EXT_DE_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

/** Fotos que siguen guardadas, tal como las necesita la propuesta. */
export const resumenDeFotos = (fotos: FotoGuardada[]): ResumenFoto[] =>
  fotos.filter((f) => !f.purged_at).map((f) => ({ tipo: f.kind, descripcion: f.description }));

function fechaCorta(iso: string): string {
  const [a, m, d] = partesMadrid(new Date(iso)).fecha.split("-");
  return `${d}/${m}/${a}`;
}

export function crearFlujoFotos(deps: PhotoDeps): PhotoPort {
  async function avisoDeCaducidad() {
    // Limpieza oportunista: hasta que exista la tarea programada, cada foto nueva borra las que ya caducaron.
    try {
      const n = await deps.purgarCaducadas(deps.now());
      if (n > 0) await deps.logEvent({ source: "system", kind: "fotos_caducadas_borradas", summary: `Borradas ${n} fotos caducadas`, detail: { fotos: n } });
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "fotos_limpieza_fallo", level: "warn", summary: msg(e) });
    }
  }

  async function recibir(chatId: number, media: MediaTelegram, conversationId: string | null, pie: string): Promise<void> {
    const ahora = deps.now();
    let destino: { id: string; resumen: string };
    if (conversationId) {
      destino = { id: conversationId, resumen: limpiarTexto((await deps.primerMensaje(conversationId)) ?? "", 60) };
    } else {
      const reciente = await deps.conversacionReciente(ahora);
      if (!reciente) {
        await deps.enviar(chatId, "No hay ninguna prueba reciente a la que añadir la foto.\n\nPrimero escribe /simular y el mensaje del cliente; después me mandas las fotos.");
        return;
      }
      destino = { id: reciente.id, resumen: limpiarTexto(reciente.primerMensaje ?? "", 60) };
    }
    const ids = { conversation_id: destino.id };
    const de = destino.resumen ? `la prueba «${destino.resumen}${destino.resumen.length >= 60 ? "…" : ""}»` : "la última prueba";

    const existentes = await deps.fotosDe(destino.id);
    const fijadaPorBlake = interpretarPieDeFoto(pie);

    if (media.tamano !== null && media.tamano > MAX_BYTES_FOTO) {
      await deps.enviar(chatId, "Esa imagen pesa demasiado (máximo 4 MB). Mándala como foto normal, no como archivo.");
      return;
    }
    if (existentes.filter((f) => !f.purged_at).length >= MAX_FOTOS_POR_CONVERSACION) {
      await deps.enviar(chatId, `Ya hay ${MAX_FOTOS_POR_CONVERSACION} fotos en ${de}: es el máximo.`);
      return;
    }

    const descarga = await deps.descargar(media.fileId, MAX_BYTES_FOTO);
    if (!descarga.ok) {
      if (descarga.motivo === "grande") {
        await deps.enviar(chatId, "Esa imagen pesa demasiado (máximo 4 MB). Mándala como foto normal, no como archivo.");
      } else {
        await deps.logEvent({ source: "telegram", kind: "foto_descarga_fallo", level: "error", summary: descarga.detalle ?? "No se pudo descargar la foto de Telegram", ...ids });
        await deps.enviar(chatId, "No he podido descargar esa foto de Telegram. Inténtalo de nuevo.");
      }
      return;
    }
    const bytes = descarga.bytes;

    // El tipo lo dicen los bytes, no Telegram ni el nombre del archivo.
    const imagen = detectarImagen(bytes);
    if (!imagen || bytes.length === 0 || bytes.length > MAX_BYTES_FOTO) {
      await deps.logSecurity({ kind: "payload_inesperado", source: "telegram", ...ids, detail: { reason: "archivo_no_imagen", bytes: bytes.length } });
      await deps.enviar(chatId, "Eso no parece una foto válida. Solo guardo JPG, PNG o WebP de hasta 4 MB.");
      return;
    }

    const sha256 = sha256Hex(bytes);
    const repetida = existentes.find((f) => f.sha256 === sha256);
    if (repetida) {
      // Misma foto otra vez: no se duplica. Si Blake la vuelve a mandar con un pie, así se corrige su tipo o su descripción.
      if (fijadaPorBlake.tipo || fijadaPorBlake.descripcion) {
        const nuevoTipo = fijadaPorBlake.tipo;
        // Si el cambio de tipo cambia lo que se hace con la foto (guardarla siempre o borrarla a los 60 días), la fecha se recalcula
        // desde hoy: corregir una foto de referencia mal etiquetada nunca debe borrarla de golpe.
        const cambiaRetencion = nuevoTipo !== null && seConserva(nuevoTipo) !== seConserva(repetida.kind);
        await deps.actualizarFicha(
          repetida.id,
          {
            ...(nuevoTipo ? { tipo: nuevoTipo } : {}),
            ...(fijadaPorBlake.descripcion ? { descripcion: fijadaPorBlake.descripcion } : {}),
            ...(cambiaRetencion && nuevoTipo ? { caducaEn: caducidadPara(nuevoTipo, ahora)?.toISOString() ?? null } : {}),
          },
          ahora,
        );
        await deps.logEvent({ source: "telegram", kind: "foto_actualizada", summary: "Foto repetida: actualizado su tipo o descripción", detail: { tipo: fijadaPorBlake.tipo }, ...ids });
        await deps.enviar(chatId, `Esa foto ya la tenía. He actualizado${fijadaPorBlake.tipo ? ` el tipo a «${ETIQUETA_FOTO[fijadaPorBlake.tipo]}»` : ""}${fijadaPorBlake.tipo && fijadaPorBlake.descripcion ? " y" : ""}${fijadaPorBlake.descripcion ? " la descripción" : ""}.`);
      } else {
        await deps.enviar(chatId, "Esa foto ya estaba guardada: no la duplico.");
      }
      return;
    }

    // Sin indicación, la primera es del pelo y la segunda de referencia. Con un álbum enviado de golpe pueden salir las dos
    // como «pelo»: el pie «referencia: …» lo fija, y reenviándola con ese pie se corrige.
    const tipo = fijadaPorBlake.tipo ?? siguienteTipo(existentes.filter((f) => !f.purged_at).map((f) => f.kind));
    const id = deps.newId();
    let guardada: FotoGuardada;
    try {
      guardada = await deps.guardar(
        {
          id,
          conversationId: destino.id,
          tipo,
          origen: "telegram",
          storagePath: rutaAlmacenamiento(destino.id, id, EXT_DE_MIME[imagen.mime]),
          mime: imagen.mime,
          sha256,
          descripcion: fijadaPorBlake.descripcion,
          creadaEn: ahora.toISOString(),
          caducaEn: caducidadPara(tipo, ahora)?.toISOString() ?? null,
        },
        bytes,
      );
    } catch (e) {
      // Blake no se queda sin saberlo: el detalle técnico va a Fallos, a él se le dice que no se guardó.
      await deps.logEvent({ source: "telegram", kind: "foto_guardado_fallo", level: "error", summary: msg(e), ...ids });
      await deps.enviar(chatId, "No he podido guardar la foto (fallo técnico, mira Fallos en el panel). Inténtalo de nuevo en un momento.");
      return;
    }
    await deps.logEvent({
      source: "telegram",
      kind: "foto_recibida",
      summary: `Foto guardada: ${ETIQUETA_FOTO[tipo]}${fijadaPorBlake.descripcion ? " (con descripción)" : ""}`,
      detail: { tipo, bytes: bytes.length, mime: imagen.mime, descrita: Boolean(fijadaPorBlake.descripcion) },
      ...ids,
    });

    await deps.enviar(
      chatId,
      [
        `📷 Guardada como «${ETIQUETA_FOTO[tipo]}» en ${de}.`,
        fijadaPorBlake.descripcion
          ? `✍️ Tu descripción: «${fijadaPorBlake.descripcion}»`
          : "✍️ Sin descripción todavía. Mándala con un pie de foto («pelo: …» o «referencia: …») o, en la propuesta, pulsa Editar y escribe «pelo …» o «referencia …».",
        tipoSugerido(tipo, fijadaPorBlake.tipo !== null),
        guardada.expires_at
          ? `🗑 La foto se borrará el ${fechaCorta(guardada.expires_at)}; tu descripción se conserva.`
          : "🗂 Esta foto se guarda siempre: con ella se enseñará a Kira a entender tus descripciones.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    await avisoDeCaducidad();
  }

  async function reenviar(chatId: number, conversationId: string | null, opts: { silencioso?: boolean } = {}): Promise<void> {
    const ahora = deps.now();
    let convId = conversationId;
    if (!convId) {
      const reciente = await deps.conversacionReciente(ahora);
      if (!reciente) {
        if (!opts.silencioso) await deps.enviar(chatId, "No hay ninguna prueba reciente. Escribe /simular y el mensaje del cliente.");
        return;
      }
      convId = reciente.id;
    }
    const fotos = (await deps.fotosDe(convId)).filter((f) => !f.purged_at);
    if (fotos.length === 0) {
      if (!opts.silencioso) await deps.enviar(chatId, "Esa prueba todavía no tiene fotos guardadas.");
      return;
    }
    const listas: { bytes: Uint8Array; mime: string; ext: string; pie: string }[] = [];
    for (const f of fotos) {
      const bytes = await deps.leerBytes(f);
      if (!bytes) continue;
      listas.push({
        bytes,
        mime: f.content_type,
        ext: EXT_DE_MIME[f.content_type],
        pie: `📷 ${ETIQUETA_FOTO[f.kind]} — ${f.description ?? "sin describir"}`,
      });
    }
    if (listas.length === 0) {
      await deps.logEvent({ source: "telegram", kind: "foto_envio_fallo", level: "warn", summary: "No se pudieron leer los archivos de las fotos", conversation_id: convId });
      if (!opts.silencioso) await deps.enviar(chatId, "No he podido leer las fotos guardadas.");
      return;
    }
    try {
      await deps.enviarFotos(chatId, listas);
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "foto_envio_fallo", level: "error", summary: msg(e), conversation_id: convId });
      if (!opts.silencioso) await deps.enviar(chatId, "No he podido enviarte las fotos. Mira Fallos en el panel.");
    }
  }

  async function guardarDeClienta(conversationId: string, tipo: "pelo" | "referencia", bytes: Uint8Array) {
    const ahora = deps.now();
    const ids = { conversation_id: conversationId };
    const imagen = detectarImagen(bytes);
    if (!imagen || bytes.length === 0 || bytes.length > MAX_BYTES_FOTO) {
      await deps.logSecurity({ kind: "payload_inesperado", source: "manychat", ...ids, detail: { reason: "archivo_no_imagen", bytes: bytes.length } });
      return { ok: false as const, motivo: "no_es_imagen" as const };
    }
    try {
      const existentes = (await deps.fotosDe(conversationId)).filter((f) => !f.purged_at);
      const sha256 = sha256Hex(bytes);
      if (existentes.some((f) => f.sha256 === sha256)) return { ok: true as const, repetida: true };
      if (existentes.length >= MAX_FOTOS_POR_CONVERSACION) {
        await deps.logEvent({ source: "manychat", kind: "foto_limite", level: "warn", summary: `Ya hay ${MAX_FOTOS_POR_CONVERSACION} fotos en la conversación: no se guarda otra`, ...ids });
        return { ok: false as const, motivo: "limite" as const };
      }
      const id = deps.newId();
      await deps.guardar(
        {
          id,
          conversationId,
          tipo,
          origen: "manychat",
          storagePath: rutaAlmacenamiento(conversationId, id, EXT_DE_MIME[imagen.mime]),
          mime: imagen.mime,
          sha256,
          descripcion: null,
          creadaEn: ahora.toISOString(),
          caducaEn: caducidadPara(tipo, ahora)?.toISOString() ?? null,
        },
        bytes,
      );
      await deps.logEvent({ source: "manychat", kind: "foto_recibida", summary: `Foto de la clienta guardada: ${ETIQUETA_FOTO[tipo]}`, detail: { tipo, bytes: bytes.length, mime: imagen.mime }, ...ids });
      await avisoDeCaducidad();
      return { ok: true as const, repetida: false };
    } catch (e) {
      await deps.logEvent({ source: "manychat", kind: "foto_guardado_fallo", level: "error", summary: msg(e), ...ids });
      return { ok: false as const, motivo: "error" as const };
    }
  }

  return { recibir, reenviar, guardarDeClienta };
}

function tipoSugerido(tipo: TipoFoto, loFijoBlake: boolean): string {
  if (loFijoBlake) return "";
  if (tipo === "otra") return "ℹ️ Ya había foto del pelo y de referencia, así que ésta queda como «otra foto».";
  return `ℹ️ La he tomado como «${ETIQUETA_FOTO[tipo]}». Si no es, vuelve a mandarla con el pie «${tipo === "pelo" ? "referencia" : "pelo"}: …».`;
}

