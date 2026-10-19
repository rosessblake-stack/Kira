import { getDb } from "./db";
import { interpretarEstancias, type Estancia } from "./estancias";

/** Los viajes de Blake a Miami, guardados en app_settings (clave `estancias`). Solo servidor, clave service_role. */

const KEY = "estancias";

export async function leerEstancias(): Promise<Estancia[]> {
  const { data, error } = await getDb().from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(`No se pudieron leer los viajes: ${error.message}`);
  return interpretarEstancias((data as { value: unknown } | null)?.value);
}

export async function guardarEstancias(estancias: Estancia[]): Promise<void> {
  const { error } = await getDb()
    .from("app_settings")
    .upsert({ key: KEY, value: interpretarEstancias(estancias), updated_at: new Date().toISOString(), updated_by: "telegram" });
  if (error) throw new Error(`No se pudieron guardar los viajes: ${error.message}`);
}
