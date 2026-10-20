/**
 * Cliente mínimo de la API de ManyChat (solo servidor, sin SDK). De momento SOLO LECTURA: comprobar la clave y ver los flujos,
 * etiquetas y campos de la cuenta. No envía mensajes ni modifica nada (eso llegará aparte y con su propia revisión).
 *
 * La clave (MANYCHAT_API_KEY) da control total sobre la cuenta de ManyChat: solo se lee aquí, nunca se registra, nunca se
 * devuelve y los errores no llevan ni la clave ni el cuerpo crudo de la respuesta.
 */

export class ManychatError extends Error {
  constructor(
    message: string,
    readonly estado?: number,
  ) {
    super(message);
    this.name = "ManychatError";
  }
}

export type FetchManychat = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

const BASE_POR_DEFECTO = "https://api.manychat.com";
const TIMEOUT_MS = 10_000;

/** La clave, si está puesta y tiene forma razonable (sin espacios, comillas ni saltos de línea pegados). */
export function claveManychat(): string | null {
  const k = process.env.MANYCHAT_API_KEY?.trim().replace(/^["']|["']$/g, "");
  return k && /^[\w:.\-]{10,200}$/.test(k) ? k : null;
}

/** Solo en las pruebas (KIRA_E2E=1) se puede cambiar la dirección: así la clave nunca puede enviarse a otro sitio en producción. */
export const baseManychat = () => (process.env.KIRA_E2E === "1" && process.env.MANYCHAT_API_BASE ? process.env.MANYCHAT_API_BASE : BASE_POR_DEFECTO);

export type PaginaManychat = { id: string; nombre: string };
export type FlujoManychat = { ns: string; nombre: string };
export type CampoManychat = { nombre: string; tipo: string };

const txt = (v: unknown, max = 80) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

export function crearClienteManychat(clave: string, fetchImpl: FetchManychat = fetch as unknown as FetchManychat) {
  async function pedir(ruta: string): Promise<unknown> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${baseManychat()}${ruta}`, { method: "GET", headers: { authorization: `Bearer ${clave}`, accept: "application/json" }, signal: ctl.signal });
      const cuerpo = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = cuerpo ? (JSON.parse(cuerpo) as Record<string, unknown>) : {};
      } catch {
        throw new ManychatError("ManyChat no devolvió una respuesta que se entienda", res.status);
      }
      if (res.status === 401 || res.status === 403) throw new ManychatError("ManyChat rechazó la clave (revisa MANYCHAT_API_KEY: debe ser la clave de la API de la cuenta, con plan Pro)", res.status);
      if (res.status === 429) throw new ManychatError("ManyChat dice que se han hecho demasiadas peticiones; prueba en un minuto", res.status);
      if (res.status !== 200 || json.status !== "success") {
        const motivo = txt(json.message ?? (json.error as unknown), 120);
        throw new ManychatError(`ManyChat respondió ${res.status}${motivo ? ` (${motivo})` : ""}`, res.status);
      }
      return json.data;
    } catch (e) {
      if (e instanceof ManychatError) throw e;
      if (e instanceof Error && e.name === "AbortError") throw new ManychatError("ManyChat no respondió a tiempo");
      throw new ManychatError("No se pudo conectar con ManyChat");
    } finally {
      clearTimeout(t);
    }
  }

  const lista = (d: unknown): unknown[] => (Array.isArray(d) ? d : d && typeof d === "object" && Array.isArray((d as { flows?: unknown }).flows) ? ((d as { flows: unknown[] }).flows) : []);

  return {
    /** La cuenta a la que pertenece la clave. */
    async paginas(): Promise<PaginaManychat> {
      const d = (await pedir("/fb/page/getInfo")) as Record<string, unknown> | null;
      return { id: txt(d?.id, 40), nombre: txt(d?.name) };
    },
    async flujos(): Promise<FlujoManychat[]> {
      const d = (await pedir("/fb/page/getFlows")) as unknown;
      return lista(d)
        .map((f) => f as Record<string, unknown>)
        .map((f) => ({ ns: txt(f.ns, 80), nombre: txt(f.name) }))
        .filter((f) => f.nombre);
    },
    async etiquetas(): Promise<string[]> {
      const d = (await pedir("/fb/page/getTags")) as unknown;
      return (Array.isArray(d) ? d : []).map((t) => txt((t as Record<string, unknown>)?.name)).filter(Boolean);
    },
    async campos(): Promise<CampoManychat[]> {
      const d = (await pedir("/fb/page/getCustomFields")) as unknown;
      return (Array.isArray(d) ? d : []).map((c) => ({ nombre: txt((c as Record<string, unknown>)?.name), tipo: txt((c as Record<string, unknown>)?.type, 20) })).filter((c) => c.nombre);
    },
  };
}

export type ClienteManychat = ReturnType<typeof crearClienteManychat>;
