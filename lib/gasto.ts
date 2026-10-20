import { getDb } from "./db";

/**
 * /gasto: cuánto gasta Claude, para vigilar el ahorro de tokens. Sale del registro de llamadas (nada de lo que escribe una clienta:
 * solo contadores de tokens). El precio solo se calcula de los modelos cuyo precio se conoce; de los demás se enseñan los tokens.
 */

/** Dólares por millón de tokens (entrada, salida). Solo los modelos con precio confirmado. */
export const PRECIOS: Record<string, { entrada: number; salida: number }> = {
  "claude-opus-5-5": { entrada: 4, salida: 20 },
};

export type FilaLlamada = { uso: "texto" | "fotos"; modelo: string | null; entrada: number; salida: number };
export type ResumenGasto = {
  texto: { llamadas: number; entrada: number; salida: number };
  fotos: { llamadas: number; entrada: number; salida: number };
  costeUsd: number;
  /** Tokens de llamadas cuyo modelo no tiene precio conocido (no entran en el coste). */
  tokensSinPrecio: number;
  formulariosSinClaude: number;
};

export function resumirGasto(filas: FilaLlamada[], formulariosSinClaude: number): ResumenGasto {
  const r: ResumenGasto = { texto: { llamadas: 0, entrada: 0, salida: 0 }, fotos: { llamadas: 0, entrada: 0, salida: 0 }, costeUsd: 0, tokensSinPrecio: 0, formulariosSinClaude };
  for (const f of filas) {
    const g = r[f.uso];
    g.llamadas++;
    g.entrada += f.entrada;
    g.salida += f.salida;
    // Las llamadas anteriores a que se anotara el modelo se hicieron con el principal.
    const p = PRECIOS[f.modelo ?? "claude-opus-5-5"];
    if (p) r.costeUsd += (f.entrada * p.entrada + f.salida * p.salida) / 1_000_000;
    else r.tokensSinPrecio += f.entrada + f.salida;
  }
  return r;
}

const miles = (n: number) => n.toLocaleString("es-ES");
const centimos = (usd: number) => (usd < 0.01 ? "menos de 1 céntimo" : `${(usd * 100).toFixed(1).replace(".", ",")} céntimos`);

export function textoGasto(r: ResumenGasto, dias: number): string {
  const linea = (n: string, g: ResumenGasto["texto"]) => `• ${n}: ${g.llamadas} llamadas · ${miles(g.entrada)} tokens de entrada · ${miles(g.salida)} de salida`;
  const total = r.texto.llamadas + r.fotos.llamadas;
  return [
    `📊 Gasto de Claude (últimos ${dias} días)`,
    "",
    linea("Leer textos", r.texto),
    linea("Mirar fotos", r.fotos),
    "",
    total === 0 ? "Todavía no hay llamadas en este periodo." : `💶 Coste aproximado: ${centimos(r.costeUsd)} (${(r.costeUsd).toFixed(3).replace(".", ",")} $)${total ? ` · de media ${centimos(r.costeUsd / total)} por llamada` : ""}`,
    r.tokensSinPrecio > 0 ? `ℹ️ ${miles(r.tokensSinPrecio)} tokens son de un modelo del que no conozco el precio: no entran en el coste.` : "",
    r.formulariosSinClaude > 0 ? `✅ ${r.formulariosSinClaude} formularios de Instagram leídos por código, sin gastar Claude.` : "",
  ].filter((x) => x !== "").join("\n");
}

export interface GastoDeps {
  leer(desde: Date): Promise<{ filas: FilaLlamada[]; formulariosSinClaude: number }>;
  now(): Date;
  enviar(chatId: number, texto: string): Promise<unknown>;
}
export interface GastoPort {
  resumen(chatId: number): Promise<void>;
}

export const DIAS_GASTO = 30;

export function crearFlujoGasto(deps: GastoDeps): GastoPort {
  return {
    async resumen(chatId) {
      try {
        const desde = new Date(deps.now().getTime() - DIAS_GASTO * 86_400_000);
        const { filas, formulariosSinClaude } = await deps.leer(desde);
        await deps.enviar(chatId, textoGasto(resumirGasto(filas, formulariosSinClaude), DIAS_GASTO));
      } catch {
        await deps.enviar(chatId, "No he podido leer el gasto ahora mismo. Prueba otra vez en un momento.");
      }
    },
  };
}

/** Lectura real del registro (solo servidor). */
export async function leerGastoReal(desde: Date): Promise<{ filas: FilaLlamada[]; formulariosSinClaude: number }> {
  const db = getDb();
  const [llamadas, formularios] = await Promise.all([
    db.from("event_log").select("detail").eq("kind", "claude_llamada").gte("at", desde.toISOString()).order("at", { ascending: false }).limit(5000),
    db.from("event_log").select("id", { count: "exact", head: true }).eq("kind", "formulario_leido").gte("at", desde.toISOString()),
  ]);
  if (llamadas.error) throw new Error(llamadas.error.message);
  const filas: FilaLlamada[] = [];
  for (const f of (llamadas.data as { detail: Record<string, unknown> | null }[] | null) ?? []) {
    const d = f.detail ?? {};
    const entrada = Number(d.entrada);
    const salida = Number(d.salida);
    if (!Number.isFinite(entrada) || !Number.isFinite(salida)) continue;
    filas.push({ uso: d.uso === "vision" ? "fotos" : "texto", modelo: typeof d.modelo === "string" ? d.modelo : null, entrada, salida });
  }
  return { filas, formulariosSinClaude: formularios.count ?? 0 };
}
