import Anthropic from "@anthropic-ai/sdk";
import { describirErrorClaude } from "./claude";

/**
 * Diagnóstico de la clave de Claude SIN enseñarla: de qué tipo parece y si Anthropic la acepta. Solo devuelve etiquetas,
 * un número y un código de estado; nunca ni un carácter de la clave.
 */

export type FormatoClave = {
  presente: boolean;
  longitud: number;
  /** normal = clave de API (sk-ant-api…); administracion = clave de administración (sk-ant-admin…), que NO sirve para Kira. */
  formato: "normal" | "administracion" | "desconocido" | "ausente";
  /** Hay espacios o saltos de línea delante o detrás (se pegó mal en Vercel). */
  conEspacios: boolean;
  /** Va entre comillas, o se pegó también el nombre («ANTHROPIC_API_KEY=…»). */
  mezclada: boolean;
};

export function formatoDeClave(valor: string | undefined | null): FormatoClave {
  if (!valor) return { presente: false, longitud: 0, formato: "ausente", conEspacios: false, mezclada: false };
  const limpio = valor.trim();
  const conEspacios = limpio !== valor;
  const mezclada = /^["']/.test(limpio) || /["']$/.test(limpio) || /^ANTHROPIC_API_KEY\s*=/i.test(limpio);
  const formato = /^sk-ant-admin/.test(limpio) ? "administracion" : /^sk-ant-api\d{2}-/.test(limpio) ? "normal" : "desconocido";
  return { presente: true, longitud: valor.length, formato, conEspacios, mezclada };
}

export type EstadoClaude = FormatoClave & {
  /** Anthropic acepta la clave (null = no se pudo preguntar: no hay clave o no hubo respuesta). */
  aceptada: boolean | null;
  estado?: number;
  motivo?: string;
};

let guardado: { en: number; valor: EstadoClaude } | null = null;

/**
 * Pregunta a Anthropic por la lista de modelos (no gasta nada) para saber si acepta la clave. El resultado se guarda 60 s:
 * esta función se usa desde la comprobación de estado, que es pública, y no debe poder gastar el límite de peticiones.
 */
export async function comprobarClaude(ahora = Date.now()): Promise<EstadoClaude> {
  if (guardado && ahora - guardado.en < 60_000) return guardado.valor;
  const formato = formatoDeClave(process.env.ANTHROPIC_API_KEY);
  let valor: EstadoClaude;
  if (!formato.presente) {
    valor = { ...formato, aceptada: null };
  } else {
    try {
      await new Anthropic({ maxRetries: 0, timeout: 5000 }).models.list({ limit: 1 });
      valor = { ...formato, aceptada: true, estado: 200 };
    } catch (e) {
      const estado = typeof (e as { status?: unknown } | null)?.status === "number" ? (e as { status: number }).status : undefined;
      valor = { ...formato, aceptada: estado === undefined ? null : false, estado, motivo: describirErrorClaude(e) };
    }
  }
  guardado = { en: ahora, valor };
  return valor;
}

/** Solo para pruebas. */
export function olvidarComprobacion() {
  guardado = null;
}
