/**
 * Cliente mínimo de la API de ManyChat (solo servidor, sin SDK). Lee (comprobar la clave, ver flujos, etiquetas y campos) y, desde
 * que Blake activa «/responder on», envía UN tipo de cosa: un mensaje de texto de Instagram a un contacto (`enviarTexto`). El texto
 * siempre sale de las plantillas de lib/clienta.ts con datos ya validados; nunca de Claude. Nada más se modifica en la cuenta.
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

export type FetchManychat = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

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
  async function pedir(ruta: string, envio?: { cuerpo: unknown }): Promise<unknown> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${baseManychat()}${ruta}`, {
        method: envio ? "POST" : "GET",
        headers: { authorization: `Bearer ${clave}`, accept: "application/json", ...(envio ? { "content-type": "application/json" } : {}) },
        signal: ctl.signal,
        ...(envio ? { body: JSON.stringify(envio.cuerpo) } : {}),
      });
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
    /**
     * Mensaje de texto de Instagram a un contacto. Solo dentro de la ventana de 24 h de Instagram (la comprueba quien llama): fuera de
     * ella ManyChat lo rechaza y aquí se convierte en un error legible. El id es el del contacto en ManyChat.
     */
    async enviarTexto(contactoId: string, texto: string): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(contactoId)) throw new ManychatError("El id del contacto de ManyChat no es válido");
      const limpio = texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
      if (!limpio || limpio.length > 1900) throw new ManychatError("El mensaje para la clienta está vacío o es demasiado largo");
      await pedir("/fb/sending/sendContent", {
        cuerpo: { subscriber_id: contactoId, data: { version: "v2", content: { type: "instagram", messages: [{ type: "text", text: limpio }] } } },
      });
    },
    /** Pone una etiqueta existente al contacto (así la «Respuesta predeterminada» recoge su respuesta aunque el flujo no la haya puesto). */
    async ponerEtiqueta(contactoId: string, etiqueta: string): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(contactoId) || !/^[\w\- ]{1,60}$/.test(etiqueta)) throw new ManychatError("Datos de etiqueta no válidos");
      await pedir("/fb/subscriber/addTagByName", { cuerpo: { subscriber_id: contactoId, tag_name: etiqueta } });
    },
    /**
     * Rellena campos personalizados del contacto (nombre exacto del campo → valor de texto), de uno en uno para saber cuál falla.
     * Devuelve los nombres de los campos que ManyChat rechazó (no existen, tipo distinto…); no lanza por eso.
     */
    async ponerCampos(contactoId: string, campos: Record<string, string>): Promise<string[]> {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(contactoId)) throw new ManychatError("El id del contacto de ManyChat no es válido");
      const fallan: string[] = [];
      for (const [nombre, valor] of Object.entries(campos)) {
        const v = txt(valor, 400);
        if (!/^[\w\- ]{1,60}$/.test(nombre) || v === "") continue;
        try {
          await pedir("/fb/subscriber/setCustomFieldByName", { cuerpo: { subscriber_id: contactoId, field_name: nombre, field_value: v } });
        } catch (e) {
          if (e instanceof ManychatError && e.estado === 429) throw e;
          fallan.push(nombre);
        }
      }
      return fallan;
    },
    async campos(): Promise<CampoManychat[]> {
      const d = (await pedir("/fb/page/getCustomFields")) as unknown;
      return (Array.isArray(d) ? d : []).map((c) => ({ nombre: txt((c as Record<string, unknown>)?.name), tipo: txt((c as Record<string, unknown>)?.type, 20) })).filter((c) => c.nombre);
    },
  };
}

export type ClienteManychat = ReturnType<typeof crearClienteManychat>;
