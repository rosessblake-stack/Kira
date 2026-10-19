import { getDb } from "./db";

/**
 * Interruptor "Pausar Kira". Pausada = deja de contestar a clientes y solo te avisa.
 * Falla hacia el silencio (docs/POLITICA.md §4.7): si no se puede leer el ajuste,
 * Kira se considera pausada.
 */

const KEY = "kira_paused";

export type PauseState = {
  paused: boolean;
  /** true si no se pudo leer el ajuste y se asume pausa por seguridad. */
  unknown: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

const FAIL_SAFE: PauseState = { paused: true, unknown: true, updatedAt: null, updatedBy: null };

export function interpretPause(
  row: { value: unknown; updated_at?: string | null; updated_by?: string | null } | null | undefined,
): PauseState {
  if (!row || typeof row.value !== "boolean") return FAIL_SAFE;
  return {
    paused: row.value,
    unknown: false,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

export async function getPauseState(): Promise<PauseState> {
  try {
    const { data, error } = await getDb()
      .from("app_settings")
      .select("value,updated_at,updated_by")
      .eq("key", KEY)
      .maybeSingle();
    if (error) return FAIL_SAFE;
    return interpretPause(data);
  } catch {
    return FAIL_SAFE;
  }
}

/** Lo que debe consultar cualquier flujo antes de contestar a un cliente. */
export async function isPaused(): Promise<boolean> {
  return (await getPauseState()).paused;
}

export async function setPaused(paused: boolean, by: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getDb()
    .from("app_settings")
    .upsert({ key: KEY, value: paused, updated_at: now, updated_by: by });
  if (error) throw new Error(`No se pudo guardar la pausa: ${error.message}`);
}
