import type { ClientasDeps, DatosFicha, Ficha } from "./clientas";
import { getDb } from "./db";

const COLUMNAS = "id,instagram,nombre,email,ubicacion,created_at,updated_at,ultima_solicitud_at,ultima_cita_at,citas_confirmadas,ultimo_servicio";

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function buscarFicha(instagram: string): Promise<Ficha | null> {
  const { data, error } = await getDb().from("clients").select(COLUMNAS).eq("instagram", instagram).maybeSingle();
  ok("No se pudo leer la ficha", error);
  return (data as Ficha | null) ?? null;
}

/** Crea la ficha o la actualiza SIN pisar un dato que ya había con uno vacío. */
export async function guardarSolicitud(d: DatosFicha, ahora: Date): Promise<void> {
  const previa = await buscarFicha(d.instagram);
  const fila = {
    instagram: d.instagram,
    nombre: d.nombre ?? previa?.nombre ?? null,
    email: d.email ?? previa?.email ?? null,
    ubicacion: d.ubicacion,
    ultima_solicitud_at: ahora.toISOString(),
    updated_at: ahora.toISOString(),
  };
  const { error } = await getDb().from("clients").upsert(fila, { onConflict: "instagram" });
  ok("No se pudo guardar la ficha", error);
}

export async function sumarCita(d: DatosFicha, fechaCita: Date | null, ahora: Date): Promise<void> {
  await guardarSolicitud(d, ahora);
  const previa = await buscarFicha(d.instagram);
  const { error } = await getDb()
    .from("clients")
    .update({
      citas_confirmadas: (previa?.citas_confirmadas ?? 0) + 1,
      ultimo_servicio: d.servicio ?? previa?.ultimo_servicio ?? null,
      ultima_cita_at: (fechaCita ?? ahora).toISOString(),
      updated_at: ahora.toISOString(),
    })
    .eq("instagram", d.instagram);
  ok("No se pudo anotar la cita en la ficha", error);
}

export async function borrarFicha(instagram: string): Promise<boolean> {
  const { data, error } = await getDb().from("clients").delete().eq("instagram", instagram).select("id");
  ok("No se pudo borrar la ficha", error);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** ¿Alguna reserva de esa clienta tiene una foto del pelo que siga guardada y sea reciente? */
export async function hayFotoPelo(instagram: string, desde: Date): Promise<boolean> {
  return (await fotoPeloReciente(instagram, desde)) !== null;
}

/** La conversación y la foto del pelo más reciente (no borrada) de esa clienta, o null. */
export async function fotoPeloReciente(instagram: string, desde: Date): Promise<{ conversation_id: string; storage_path: string } | null> {
  const db = getDb();
  // En las reservas el usuario se guarda tal cual lo dio Meta (con o sin «@», a veces con mayúsculas): se compara sin distinguirlas.
  // «_» y «%» son comodines en ilike: se escapan para que «marta_x» no coincida con «martaxx».
  const esc = instagram.replace(/[\\%_]/g, "\\$&");
  const { data: bs, error } = await db.from("bookings").select("conversation_id,created_at").or(`spec->>instagram.ilike.${esc},spec->>instagram.ilike.@${esc}`).eq("is_test", false).order("created_at", { ascending: false }).limit(10);
  ok("No se pudieron buscar las citas de la clienta", error);
  const convs = [...new Set(((bs as { conversation_id: string | null }[] | null) ?? []).map((b) => b.conversation_id).filter((x): x is string => Boolean(x)))];
  if (!convs.length) return null;
  const { data, error: e2 } = await db
    .from("attachments")
    .select("conversation_id,storage_path,created_at")
    .in("conversation_id", convs)
    .eq("kind", "pelo")
    .is("purged_at", null)
    .gte("created_at", desde.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  ok("No se pudo buscar la foto del pelo", e2);
  const f = ((data as { conversation_id: string; storage_path: string | null }[] | null) ?? [])[0];
  return f?.storage_path ? { conversation_id: f.conversation_id, storage_path: f.storage_path } : null;
}

export const clientasStore = { buscar: buscarFicha, guardarSolicitud, sumarCita, borrar: borrarFicha, hayFotoPelo } satisfies Partial<ClientasDeps>;
