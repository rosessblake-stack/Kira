import { getDb } from "./db";
import type { EjemploGuardado, EstiloPegadas, NuevoEjemplo } from "./ejemplos";

const BUCKET = "kira-fotos";

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function guardarEjemplo(e: NuevoEjemplo, bytes: Uint8Array): Promise<{ seq: number } | null> {
  const db = getDb();
  const repetido = await db.from("style_examples").select("seq").eq("sha256", e.sha256).maybeSingle();
  ok("No se pudo comprobar el ejemplo", repetido.error);
  if (repetido.data) return null;
  const subida = await db.storage.from(BUCKET).upload(e.storagePath, bytes, { contentType: e.mime, upsert: false });
  ok("No se pudo guardar el archivo del ejemplo", subida.error);
  const { data, error } = await db
    .from("style_examples")
    .insert({ id: e.id, estilo: e.estilo, storage_path: e.storagePath, content_type: e.mime, size_bytes: e.size, sha256: e.sha256, description: e.descripcion })
    .select("seq")
    .single();
  if (error) {
    await db.storage.from(BUCKET).remove([e.storagePath]).catch(() => undefined);
    throw new Error(`No se pudo guardar la ficha del ejemplo: ${error.message}`);
  }
  return { seq: Number((data as { seq: number }).seq) };
}

export async function listarEjemplos(): Promise<EjemploGuardado[]> {
  const { data, error } = await getDb().from("style_examples").select("seq,estilo,description,created_at").order("seq", { ascending: true });
  ok("No se pudieron leer los ejemplos", error);
  return ((data as EjemploGuardado[] | null) ?? []).map((x) => ({ ...x, seq: Number(x.seq) }));
}

export async function contarEjemplosPorEstilo(): Promise<Record<EstiloPegadas, number>> {
  const r: Record<EstiloPegadas, number> = { cornrows: 0, twist: 0, barrel_twist: 0 };
  for (const e of await listarEjemplos()) r[e.estilo]++;
  return r;
}

export async function borrarEjemplo(seq: number): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from("style_examples").select("id,storage_path").eq("seq", seq).maybeSingle();
  ok("No se pudo buscar el ejemplo", error);
  const fila = data as { id: string; storage_path: string } | null;
  if (!fila) return false;
  const r = await db.storage.from(BUCKET).remove([fila.storage_path]);
  ok("No se pudo borrar el archivo del ejemplo", r.error);
  const d = await db.from("style_examples").delete().eq("id", fila.id);
  ok("No se pudo borrar la ficha del ejemplo", d.error);
  return true;
}

/** Los `porEstilo` ejemplos más recientes de cada estilo, con sus bytes (para enseñárselos a Claude). */
export async function cargarEjemplosParaClaude(porEstilo: number): Promise<{ estilo: EstiloPegadas; bytes: Uint8Array }[]> {
  const db = getDb();
  const { data, error } = await db.from("style_examples").select("estilo,storage_path,created_at").order("created_at", { ascending: false });
  ok("No se pudieron leer los ejemplos", error);
  const cuenta: Record<string, number> = {};
  const salida: { estilo: EstiloPegadas; bytes: Uint8Array }[] = [];
  for (const f of (data as { estilo: EstiloPegadas; storage_path: string }[] | null) ?? []) {
    if ((cuenta[f.estilo] ?? 0) >= porEstilo) continue;
    const dl = await db.storage.from(BUCKET).download(f.storage_path);
    if (dl.error || !dl.data) continue;
    cuenta[f.estilo] = (cuenta[f.estilo] ?? 0) + 1;
    salida.push({ estilo: f.estilo, bytes: new Uint8Array(await dl.data.arrayBuffer()) });
  }
  return salida;
}
