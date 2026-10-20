import { ManychatError, type ClienteManychat } from "./manychat";

/**
 * /manychat: dice si la conexión con ManyChat funciona y qué hay en la cuenta (nombres de flujos, etiquetas y campos).
 * Solo lectura. No muestra la clave ni datos de ninguna persona.
 */

export interface ManychatDeps {
  /** null si MANYCHAT_API_KEY no está puesta (o no tiene forma de clave). */
  cliente(): ClienteManychat | null;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown> }): Promise<void>;
}

export interface ManychatPort {
  estado(chatId: number): Promise<void>;
}

const recorta = (lista: string[], max: number) => (lista.length <= max ? lista.join(", ") : `${lista.slice(0, max).join(", ")} … (+${lista.length - max} más)`);

export function crearFlujoManychat(deps: ManychatDeps): ManychatPort {
  return {
    async estado(chatId) {
      const cli = deps.cliente();
      if (!cli) {
        await deps.enviar(chatId, "🔌 ManyChat: todavía no está la clave (MANYCHAT_API_KEY) en Vercel. En ManyChat: Configuración → API → Generar clave; y pégala en Vercel (nunca por aquí).");
        return;
      }
      try {
        const [pagina, flujos, etiquetas, campos] = await Promise.all([cli.paginas(), cli.flujos(), cli.etiquetas(), cli.campos()]);
        await deps.logEvent({ kind: "manychat_comprobado", summary: "Conexión con ManyChat comprobada", detail: { flujos: flujos.length, etiquetas: etiquetas.length, campos: campos.length } });
        await deps.enviar(
          chatId,
          [
            `🔌 ManyChat conectado${pagina.nombre ? `: ${pagina.nombre}` : ""}.`,
            "",
            `🧩 Flujos (${flujos.length}): ${flujos.length ? recorta(flujos.map((f) => f.nombre), 25) : "ninguno"}`,
            `🏷 Etiquetas (${etiquetas.length}): ${etiquetas.length ? recorta(etiquetas, 25) : "ninguna"}`,
            `🗂 Campos personalizados (${campos.length}): ${campos.length ? recorta(campos.map((c) => `${c.nombre} (${c.tipo})`), 25) : "ninguno"}`,
            "",
            "Solo he leído nombres. No he enviado ni cambiado nada.",
          ].join("\n"),
        );
      } catch (e) {
        const motivo = e instanceof ManychatError ? e.message : "error desconocido";
        await deps.logEvent({ kind: "manychat_fallo", level: "error", summary: motivo, detail: { estado: e instanceof ManychatError ? e.estado : undefined } });
        await deps.enviar(chatId, `⚠️ No he podido leer ManyChat: ${motivo}.`);
      }
    },
  };
}
