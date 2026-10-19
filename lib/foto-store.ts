import { getDb } from "./db";
import { VENTANA_ADJUNTAR_MIN, esUuid, type ImagenDetectada, type TipoFoto } from "./fotos";
import type { FotoGuardada, NuevaFoto } from "./photo-flow";
import type { Admin } from "./panel-session";

/**
 * Persistencia de las fotos sobre Supabase (solo servidor, clave service_role):
 * los archivos van a un almacén PRIVADO (bucket kira-fotos, sin URLs públicas) y la ficha a la tabla attachments.
 */

const BUCKET = "kira-fotos";

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const COLUMNAS = "id,conversation_id,kind,source,storage_path,content_type,size_bytes,sha256,description,described_at,created_at,expires_at,purged_at";

export async function guardarFoto(f: NuevaFoto, bytes: Uint8Array): Promise<FotoGuardada> {
  const db = getDb();
  const subida = await db.storage.from(BUCKET).upload(f.storagePath, bytes, { contentType: f.mime, upsert: false });
  ok("No se pudo guardar el archivo de la foto", subida.error);

  const { data, error } = await db
    .from("attachments")
    .insert({
      id: f.id,
      conversation_id: f.conversationId,
      kind: f.tipo,
      source: f.origen,
      storage_path: f.storagePath,
      content_type: f.mime,
      size_bytes: bytes.length,
      sha256: f.sha256,
      description: f.descripcion,
      described_at: f.descripcion ? f.creadaEn : null,
      created_at: f.creadaEn,
      expires_at: f.caducaEn,
    })
    .select(COLUMNAS)
    .single();
  if (error) {
    // La ficha no se creó: no se deja el archivo huérfano en el almacén.
    await db.storage.from(BUCKET).remove([f.storagePath]).catch(() => undefined);
    throw new Error(`No se pudo guardar la ficha de la foto: ${error.message}`);
  }
  return data as FotoGuardada;
}

export async function listarFotos(conversationId: string): Promise<FotoGuardada[]> {
  const { data, error } = await getDb()
    .from("attachments")
    .select(COLUMNAS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  ok("No se pudieron leer las fotos", error);
  return (data as FotoGuardada[] | null) ?? [];
}

export async function descargarBytes(foto: Pick<FotoGuardada, "storage_path">): Promise<Uint8Array | null> {
  if (!foto.storage_path) return null;
  const { data, error } = await getDb().storage.from(BUCKET).download(foto.storage_path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Escribe lo que Blake dice que se ve en la última foto de ese tipo. false si no hay ninguna. */
export async function describirUltima(conversationId: string, tipo: TipoFoto, texto: string, ahora: Date): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db
    .from("attachments")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("kind", tipo)
    .is("purged_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  ok("No se pudo buscar la foto", error);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) return false;
  const r = await db.from("attachments").update({ description: texto, described_at: ahora.toISOString() }).eq("id", id);
  ok("No se pudo guardar la descripción", r.error);
  return true;
}

/** Corrige el tipo y/o la descripción de una foto ya guardada. */
export async function actualizarFicha(id: string, cambios: { tipo?: TipoFoto; descripcion?: string | null }, ahora: Date): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (cambios.tipo) patch.kind = cambios.tipo;
  if (cambios.descripcion !== undefined) {
    patch.description = cambios.descripcion;
    patch.described_at = cambios.descripcion ? ahora.toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await getDb().from("attachments").update(patch).eq("id", id);
  ok("No se pudo actualizar la foto", error);
}

/** Prueba (/simular) más reciente si es de las últimas horas: a ella se adjuntan las fotos sueltas de Blake. */
export async function conversacionDePruebaReciente(ahora: Date): Promise<{ id: string; creada: string; primerMensaje: string | null } | null> {
  const db = getDb();
  const { data, error } = await db.from("conversations").select("id,created_at").eq("channel", "prueba").order("created_at", { ascending: false }).limit(1);
  ok("No se pudo buscar la prueba más reciente", error);
  const c = (data as { id: string; created_at: string }[] | null)?.[0];
  if (!c) return null;
  if (ahora.getTime() - Date.parse(c.created_at) > VENTANA_ADJUNTAR_MIN * 60_000) return null;
  return { id: c.id, creada: c.created_at, primerMensaje: await primerMensajeDe(c.id) };
}

export async function primerMensajeDe(conversationId: string): Promise<string | null> {
  const { data } = await getDb().from("messages").select("body").eq("conversation_id", conversationId).eq("direction", "in").order("created_at", { ascending: true }).limit(1);
  return (data as { body: string }[] | null)?.[0]?.body ?? null;
}

/**
 * Borra las fotos que han llegado a su fecha de caducidad (el archivo; la ficha y la descripción de Blake se conservan).
 * Primero el archivo y después la ficha: si el borrado falla, se reintenta la próxima vez.
 */
export async function purgarCaducadas(ahora: Date, limite = 50): Promise<number> {
  const db = getDb();
  const { data, error } = await db
    .from("attachments")
    .select("id,storage_path")
    .is("purged_at", null)
    .lt("expires_at", ahora.toISOString())
    .limit(limite);
  ok("No se pudieron buscar las fotos caducadas", error);
  const filas = (data as { id: string; storage_path: string }[] | null) ?? [];
  let borradas = 0;
  for (const f of filas) {
    const r = await db.storage.from(BUCKET).remove([f.storage_path]);
    if (r.error) continue;
    const u = await db.from("attachments").update({ storage_path: null, purged_at: ahora.toISOString() }).eq("id", f.id).is("purged_at", null);
    if (!u.error) borradas++;
  }
  return borradas;
}

// ---------------------------------------------------------------------------
// Panel (exigen la prueba Admin que solo entrega requireAdmin())
// ---------------------------------------------------------------------------

export type FotoParaPanel = { mime: ImagenDetectada["mime"]; bytes: Uint8Array };

export async function leerFotoParaPanel(_a: Admin, id: string): Promise<FotoParaPanel | null> {
  if (!esUuid(id)) return null;
  const { data, error } = await getDb().from("attachments").select("content_type,storage_path").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const fila = data as { content_type: ImagenDetectada["mime"]; storage_path: string | null };
  const bytes = await descargarBytes({ storage_path: fila.storage_path });
  return bytes ? { mime: fila.content_type, bytes } : null;
}
