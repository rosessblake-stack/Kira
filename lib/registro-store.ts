import { getDb } from "./db";
import type { Reserva } from "./proposal-flow";
import { registroDesdeReserva, type RegistroGuardado } from "./registro";

/** Persistencia del registro de servicios sobre Supabase (solo servidor, clave service_role). */

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Guarda la foto fija de una cita al aprobarla. Una cita solo tiene un registro (booking_id es único). */
export async function guardarRegistro(r: Reserva): Promise<void> {
  const { error } = await getDb()
    .from("service_records")
    .upsert(registroDesdeReserva(r), { onConflict: "booking_id", ignoreDuplicates: true });
  ok("No se pudo guardar el registro del servicio", error);
}

export async function listarRegistros(limite: number): Promise<RegistroGuardado[]> {
  const { data, error } = await getDb().from("service_records").select("*").order("seq", { ascending: false }).limit(limite);
  ok("No se pudieron leer los servicios", error);
  return (data as RegistroGuardado[] | null) ?? [];
}

export async function leerRegistroPorSeq(seq: number): Promise<RegistroGuardado | null> {
  const { data, error } = await getDb().from("service_records").select("*").eq("seq", seq).maybeSingle();
  ok("No se pudo leer el servicio", error);
  return (data as RegistroGuardado | null) ?? null;
}

export async function anotarReal(
  id: string,
  patch: { horas_reales?: number; materiales_reales?: number; precio_real_cents?: number; nota_real?: string | null; real_at: string },
): Promise<void> {
  const { error } = await getDb().from("service_records").update(patch).eq("id", id);
  ok("No se pudieron guardar los datos reales", error);
}

/** Servicios con datos reales anotados (hasta 1000, los más recientes). Las pruebas solo si se piden. */
export async function registrosConDatosReales(incluirPruebas: boolean): Promise<{ registros: RegistroGuardado[]; pruebasExcluidas: number }> {
  const db = getDb();
  let q = db.from("service_records").select("*").not("real_at", "is", null).order("seq", { ascending: false }).limit(1000);
  if (!incluirPruebas) q = q.eq("is_test", false);
  const { data, error } = await q;
  ok("No se pudieron leer los datos reales", error);
  let pruebasExcluidas = 0;
  if (!incluirPruebas) {
    const r = await db.from("service_records").select("id", { count: "exact", head: true }).not("real_at", "is", null).eq("is_test", true);
    ok("No se pudieron contar las pruebas", r.error);
    pruebasExcluidas = r.count ?? 0;
  }
  return { registros: (data as RegistroGuardado[] | null) ?? [], pruebasExcluidas };
}
