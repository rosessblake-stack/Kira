import { describe, expect, it } from "vitest";
import { MAX_BYTES_FOTO, MAX_FOTOS_POR_CONVERSACION, RETENCION_DIAS, esUuid } from "../lib/fotos";
import { crearFlujoFotos, resumenDeFotos, type Descarga, type FotoGuardada, type PhotoDeps } from "../lib/photo-flow";

const CHAT = 111;
const CONV = "11111111-1111-4111-8111-111111111111";
const OTRA_CONV = "33333333-3333-4333-8333-333333333333";

const JPG = (marca: number, relleno = 200) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, marca, ...new Array(relleno).fill(marca)]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Opciones = { hayPrueba?: boolean; archivos?: Record<string, Descarga>; fallaGuardar?: boolean; fallaEnvio?: boolean; fallaPurga?: boolean };

function mundo(op: Opciones = {}) {
  let reloj = new Date("2026-10-19T13:30:00Z");
  let n = 0;
  const w = {
    avanza: (dias: number) => { reloj = new Date(reloj.getTime() + dias * 86_400_000); },
    fichas: new Map<string, FotoGuardada>(),
    almacen: new Map<string, Uint8Array>(),
    enviados: [] as string[],
    albumes: [] as { chat: number; fotos: { mime: string; ext: string; pie: string; bytes: number }[] }[],
    eventos: [] as { source: string; kind: string; level?: string; summary: string; detail?: Record<string, unknown>; conversation_id?: string | null }[],
    seguridad: [] as { kind: string; source: string; detail?: Record<string, unknown> }[],
    purgas: 0,
    descargas: 0,
  };
  const archivos = op.archivos ?? {};
  const deps: PhotoDeps = {
    now: () => reloj,
    newId: () => `${(++n).toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    async conversacionReciente() {
      return op.hayPrueba === false ? null : { id: CONV, creada: "2026-10-19T13:00:00Z", primerMensaje: "Hola! tengo el pelo por el hombro, quiero 6 trenzas" };
    },
    async primerMensaje(id) { return id === OTRA_CONV ? "Mensaje de otra prueba" : null; },
    async fotosDe(conv) { return [...w.fichas.values()].filter((f) => f.conversation_id === conv).map((f) => structuredClone(f)); },
    async descargar(fileId) { w.descargas++; return archivos[fileId] ?? { ok: false, motivo: "error", detalle: "Telegram getFile: file not found" }; },
    async guardar(f, bytes) {
      if (op.fallaGuardar) throw new Error("No se pudo guardar el archivo de la foto: bucket no encontrado");
      w.almacen.set(f.storagePath, bytes);
      const ficha: FotoGuardada = {
        id: f.id, conversation_id: f.conversationId, kind: f.tipo, source: f.origen, storage_path: f.storagePath, content_type: f.mime,
        size_bytes: bytes.length, sha256: f.sha256, description: f.descripcion, described_at: f.descripcion ? f.creadaEn : null,
        created_at: f.creadaEn, expires_at: f.caducaEn, purged_at: null,
      };
      w.fichas.set(f.id, ficha);
      return structuredClone(ficha);
    },
    async actualizarFicha(id, cambios) {
      const f = w.fichas.get(id)!;
      if (cambios.tipo) f.kind = cambios.tipo;
      if (cambios.descripcion !== undefined) f.description = cambios.descripcion;
    },
    async leerBytes(f) { return f.storage_path ? (w.almacen.get(f.storage_path) ?? null) : null; },
    async purgarCaducadas(ahora) {
      if (op.fallaPurga) throw new Error("storage: timeout");
      let k = 0;
      for (const f of w.fichas.values()) {
        if (!f.purged_at && Date.parse(f.expires_at) < ahora.getTime()) {
          w.almacen.delete(f.storage_path!);
          f.storage_path = null;
          f.purged_at = ahora.toISOString();
          k++;
        }
      }
      w.purgas += k;
      return k;
    },
    async enviar(_chat, texto) { w.enviados.push(texto); return w.enviados.length; },
    async enviarFotos(chat, fotos) {
      if (op.fallaEnvio) throw new Error("Telegram sendMediaGroup: Bad Request");
      w.albumes.push({ chat, fotos: fotos.map((f) => ({ mime: f.mime, ext: f.ext, pie: f.pie, bytes: f.bytes.length })) });
    },
    async logEvent(e) { w.eventos.push(e); },
    async logSecurity(e) { w.seguridad.push(e); },
  };
  const flujo = crearFlujoFotos(deps);
  const media = (fileId: string, tamano: number | null = null) => ({ fileId, tamano });
  const ultimo = () => w.enviados.at(-1)!;
  const fichas = () => [...w.fichas.values()];
  return { w, flujo, media, ultimo, fichas };
}

describe("recibir una foto", () => {
  it("la primera sin pie queda como foto del pelo, guardada con ruta propia y caducidad de 60 días", async () => {
    const m = mundo({ archivos: { f1: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("f1", 201), null, "");

    const [f] = m.fichas();
    expect(f).toMatchObject({ conversation_id: CONV, kind: "pelo", source: "telegram", content_type: "image/jpeg", description: null, purged_at: null });
    expect(f.storage_path).toBe(`${CONV}/${f.id}.jpg`);
    expect(esUuid(f.id)).toBe(true);
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(f.expires_at) - Date.parse(f.created_at)).toBe(RETENCION_DIAS * 86_400_000);
    expect(m.w.almacen.get(f.storage_path!)).toEqual(JPG(1));
    expect(m.ultimo()).toContain("Guardada como «Pelo de la clienta»");
    expect(m.ultimo()).toContain("Hola! tengo el pelo por el hombro");
    expect(m.ultimo()).toContain("Sin descripción todavía");
    expect(m.ultimo()).toContain("18/12/2026");
    expect(m.w.eventos.map((e) => e.kind)).toContain("foto_recibida");
  });

  it("la segunda sin pie es de referencia y la tercera «otra»; con aviso de cómo corregirlo", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) }, b: { ok: true, bytes: JPG(2) }, c: { ok: true, bytes: PNG } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    await m.flujo.recibir(CHAT, m.media("b"), null, "");
    expect(m.ultimo()).toContain("«Trenzas de referencia»");
    expect(m.ultimo()).toContain("vuelve a mandarla con el pie «pelo: …»");
    await m.flujo.recibir(CHAT, m.media("c"), null, "");
    expect(m.fichas().map((f) => f.kind)).toEqual(["pelo", "referencia", "otra"]);
    expect(m.fichas()[2].storage_path).toMatch(/\.png$/);
    expect(m.ultimo()).toContain("queda como «otra foto»");
  });

  it("con pie «referencia: …» fija el tipo y guarda la descripción de Blake", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "referencia: boxeadoras hasta la cadera");
    expect(m.fichas()[0]).toMatchObject({ kind: "referencia", description: "boxeadoras hasta la cadera" });
    expect(m.ultimo()).toContain("✍️ Tu descripción: «boxeadoras hasta la cadera»");
    expect(m.ultimo()).not.toContain("vuelve a mandarla"); // el tipo lo fijó él: no hay nada que sugerir
  });

  it("con una conversación concreta (foto enviada junto a /simular) no busca la más reciente", async () => {
    const m = mundo({ hayPrueba: false, archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), OTRA_CONV, "");
    expect(m.fichas()[0].conversation_id).toBe(OTRA_CONV);
    expect(m.ultimo()).toContain("Mensaje de otra prueba");
  });

  it("sin ninguna prueba reciente explica qué hacer y no descarga nada", async () => {
    const m = mundo({ hayPrueba: false, archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.ultimo()).toContain("/simular");
  });

  it("la misma foto dos veces no se duplica", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) }, b: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    await m.flujo.recibir(CHAT, m.media("b"), null, ""); // mismos bytes, otro file_id
    expect(m.fichas()).toHaveLength(1);
    expect(m.ultimo()).toContain("ya estaba guardada");
  });

  it("la misma foto con pie corrige el tipo y la descripción de la que ya estaba", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) }, b: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    expect(m.fichas()[0].kind).toBe("pelo");
    await m.flujo.recibir(CHAT, m.media("b"), null, "referencia: boxeadoras largas");
    expect(m.fichas()).toHaveLength(1);
    expect(m.fichas()[0]).toMatchObject({ kind: "referencia", description: "boxeadoras largas" });
    expect(m.ultimo()).toContain("He actualizado el tipo a «Trenzas de referencia» y la descripción");
    expect(m.w.eventos.map((e) => e.kind)).toContain("foto_actualizada");
  });

  it("hay un máximo de fotos por conversación", async () => {
    const archivos: Record<string, Descarga> = {};
    for (let i = 0; i < MAX_FOTOS_POR_CONVERSACION + 1; i++) archivos[`f${i}`] = { ok: true, bytes: JPG(i + 1) };
    const m = mundo({ archivos });
    for (let i = 0; i < MAX_FOTOS_POR_CONVERSACION + 1; i++) await m.flujo.recibir(CHAT, m.media(`f${i}`), null, "");
    expect(m.fichas()).toHaveLength(MAX_FOTOS_POR_CONVERSACION);
    expect(m.ultimo()).toContain("es el máximo");
  });
});

describe("recibir: lo que NO es una foto o no se puede guardar", () => {
  it("un archivo que no es JPG/PNG/WebP se rechaza y queda en seguridad (aunque Telegram diga que es una imagen)", async () => {
    const html = Uint8Array.from([...Buffer.from("<html><script>alert(1)</script></html>")]);
    const m = mundo({ archivos: { x: { ok: true, bytes: html }, g: { ok: true, bytes: Uint8Array.from([...Buffer.from("GIF89a....")]) } } });
    await m.flujo.recibir(CHAT, m.media("x"), null, "");
    await m.flujo.recibir(CHAT, m.media("g"), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.w.almacen.size).toBe(0);
    expect(m.w.seguridad.map((s) => [s.kind, s.detail?.reason])).toEqual([["payload_inesperado", "archivo_no_imagen"], ["payload_inesperado", "archivo_no_imagen"]]);
    expect(m.ultimo()).toContain("Eso no parece una foto válida");
  });

  it("tamaño declarado por encima del tope: se avisa sin descargar", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a", MAX_BYTES_FOTO + 1), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.ultimo()).toContain("máximo 4 MB");
    expect(m.w.descargas).toBe(0); // ni siquiera se intenta descargar
  });

  it("descarga que supera el tope a mitad de camino: mismo aviso", async () => {
    const m = mundo({ archivos: { a: { ok: false, motivo: "grande" } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.ultimo()).toContain("máximo 4 MB");
  });

  it("bytes por encima del tope aunque el tamaño declarado fuera pequeño: se rechaza", async () => {
    const enorme = new Uint8Array(MAX_BYTES_FOTO + 10);
    enorme.set([0xff, 0xd8, 0xff]);
    const m = mundo({ archivos: { a: { ok: true, bytes: enorme } } });
    await m.flujo.recibir(CHAT, m.media("a", 100), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.w.seguridad).toHaveLength(1);
  });

  it("fallo al descargar de Telegram: se registra el error y se avisa", async () => {
    const m = mundo({ archivos: {} });
    await m.flujo.recibir(CHAT, m.media("desconocida"), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.ultimo()).toContain("No he podido descargar");
    expect(m.w.eventos.find((e) => e.kind === "foto_descarga_fallo")).toMatchObject({ level: "error", summary: "Telegram getFile: file not found" });
  });

  it("si falla el guardado: Blake lo sabe, el error queda en Fallos y no queda ficha", async () => {
    const m = mundo({ fallaGuardar: true, archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    expect(m.fichas()).toHaveLength(0);
    expect(m.ultimo()).toContain("No he podido guardar la foto");
    expect(m.w.eventos.find((e) => e.kind === "foto_guardado_fallo")).toMatchObject({ level: "error", summary: expect.stringContaining("bucket no encontrado") });
    expect(m.w.eventos.map((e) => e.kind)).not.toContain("foto_recibida");
  });
});

describe("caducidad", () => {
  it("cada foto nueva borra las que ya caducaron; la descripción de Blake se conserva", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) }, b: { ok: true, bytes: JPG(2) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "pelo: rizado fino");
    const vieja = m.fichas()[0];
    m.w.avanza(RETENCION_DIAS + 1);
    await m.flujo.recibir(CHAT, m.media("b"), null, "referencia: trenzas largas");
    expect(m.w.purgas).toBe(1);
    expect(vieja).toMatchObject({ storage_path: null, description: "rizado fino" });
    expect(vieja.purged_at).not.toBeNull();
    expect(m.w.eventos.map((e) => e.kind)).toContain("fotos_caducadas_borradas");
    expect(resumenDeFotos(m.fichas())).toEqual([{ tipo: "referencia", descripcion: "trenzas largas" }]); // la borrada no cuenta
  });

  it("si falla la limpieza, la foto nueva se guarda igual y el fallo queda registrado", async () => {
    const m = mundo({ fallaPurga: true, archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    expect(m.fichas()).toHaveLength(1);
    expect(m.w.eventos.find((e) => e.kind === "fotos_limpieza_fallo")).toMatchObject({ level: "warn", summary: "storage: timeout" });
  });
});

describe("reenviar las fotos a Blake", () => {
  it("las manda en un álbum con el tipo y su descripción en el pie", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) }, b: { ok: true, bytes: PNG } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "pelo: rizado fino");
    await m.flujo.recibir(CHAT, m.media("b"), null, "");
    await m.flujo.reenviar(CHAT, null);
    expect(m.w.albumes).toHaveLength(1);
    expect(m.w.albumes[0].fotos.map((f) => [f.mime, f.ext, f.pie])).toEqual([
      ["image/jpeg", "jpg", "📷 Pelo de la clienta — rizado fino"],
      ["image/png", "png", "📷 Trenzas de referencia — sin describir"],
    ]);
  });

  it("sin fotos: avisa (o calla si es silencioso, como antes de una propuesta)", async () => {
    const m = mundo();
    await m.flujo.reenviar(CHAT, null);
    expect(m.ultimo()).toContain("todavía no tiene fotos");
    const antes = m.w.enviados.length;
    await m.flujo.reenviar(CHAT, CONV, { silencioso: true });
    expect(m.w.enviados.length).toBe(antes);
    expect(m.w.albumes).toHaveLength(0);
  });

  it("no manda las fotos ya borradas por caducidad", async () => {
    const m = mundo({ archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    m.fichas()[0].purged_at = "2026-12-30T00:00:00Z";
    m.fichas()[0].storage_path = null;
    await m.flujo.reenviar(CHAT, null);
    expect(m.w.albumes).toHaveLength(0);
  });

  it("si Telegram falla al enviar: error registrado y aviso, sin romper", async () => {
    const m = mundo({ fallaEnvio: true, archivos: { a: { ok: true, bytes: JPG(1) } } });
    await m.flujo.recibir(CHAT, m.media("a"), null, "");
    await m.flujo.reenviar(CHAT, null);
    expect(m.w.eventos.find((e) => e.kind === "foto_envio_fallo")).toMatchObject({ level: "error" });
    expect(m.ultimo()).toContain("No he podido enviarte las fotos");
  });
});
