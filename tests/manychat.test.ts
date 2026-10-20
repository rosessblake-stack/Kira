import { afterEach, describe, expect, it } from "vitest";
import { ManychatError, claveManychat, crearClienteManychat, baseManychat, type FetchManychat } from "../lib/manychat";
import { crearFlujoManychat, type ManychatDeps } from "../lib/manychat-flow";

const CLAVE = "1234567:abcdefghijklmnopqrstuvwxyz012345";
const respuesta = (status: number, cuerpo: unknown) => ({ status, async text() { return typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo); } });

function falso(mapa: Record<string, { status: number; cuerpo: unknown }>) {
  const llamadas: { url: string; metodo: string; cabeceras: Record<string, string> }[] = [];
  const f: FetchManychat = async (url, init) => {
    llamadas.push({ url, metodo: init.method, cabeceras: init.headers });
    const ruta = new URL(url).pathname;
    const r = mapa[ruta];
    if (!r) return respuesta(404, { status: "error", message: "not found" });
    return respuesta(r.status, r.cuerpo);
  };
  return { f, llamadas };
}

afterEach(() => {
  delete process.env.MANYCHAT_API_KEY;
  delete process.env.MANYCHAT_API_BASE;
  delete process.env.KIRA_E2E;
});

describe("clave de ManyChat", () => {
  it("solo se acepta si está puesta y tiene forma de clave (se limpian comillas y espacios)", () => {
    expect(claveManychat()).toBeNull();
    process.env.MANYCHAT_API_KEY = `  "${CLAVE}"\n`;
    expect(claveManychat()).toBe(CLAVE);
    process.env.MANYCHAT_API_KEY = "corta";
    expect(claveManychat()).toBeNull();
    process.env.MANYCHAT_API_KEY = "tiene espacios dentro de la clave de api";
    expect(claveManychat()).toBeNull();
  });

  it("la dirección de la API solo se puede cambiar en las pruebas: en producción la clave no puede irse a otro sitio", () => {
    process.env.MANYCHAT_API_BASE = "https://malo.example";
    expect(baseManychat()).toBe("https://api.manychat.com");
    process.env.KIRA_E2E = "1";
    expect(baseManychat()).toBe("https://malo.example");
  });
});

describe("cliente de ManyChat (solo lectura)", () => {
  it("lee la cuenta, los flujos, las etiquetas y los campos, solo con GET y con la clave en la cabecera", async () => {
    const { f, llamadas } = falso({
      "/fb/page/getInfo": { status: 200, cuerpo: { status: "success", data: { id: "99", name: "Blake Braider" } } },
      "/fb/page/getFlows": { status: 200, cuerpo: { status: "success", data: { flows: [{ ns: "content1", name: "Pedir cita" }, { ns: "content2", name: "Formación" }, { ns: "x", name: "" }] } } },
      "/fb/page/getTags": { status: 200, cuerpo: { status: "success", data: [{ id: 1, name: "OG" }, { id: 2, name: "Miami" }] } },
      "/fb/page/getCustomFields": { status: 200, cuerpo: { status: "success", data: [{ id: 1, name: "ciudad", type: "text" }, { id: 2, name: "foto_pelo", type: "text" }] } },
    });
    const c = crearClienteManychat(CLAVE, f);
    expect(await c.paginas()).toEqual({ id: "99", nombre: "Blake Braider" });
    expect(await c.flujos()).toEqual([{ ns: "content1", nombre: "Pedir cita" }, { ns: "content2", nombre: "Formación" }]);
    expect(await c.etiquetas()).toEqual(["OG", "Miami"]);
    expect(await c.campos()).toEqual([{ nombre: "ciudad", tipo: "text" }, { nombre: "foto_pelo", tipo: "text" }]);
    expect(llamadas.every((l) => l.metodo === "GET" && l.cabeceras.authorization === `Bearer ${CLAVE}`)).toBe(true);
    expect(llamadas.map((l) => new URL(l.url).host)).toEqual(Array(4).fill("api.manychat.com"));
  });

  it("clave rechazada, demasiadas peticiones, error del servicio y respuestas raras: errores claros SIN la clave ni el cuerpo crudo", async () => {
    const casos: [number, unknown, RegExp][] = [
      [401, { status: "error" }, /rechazó la clave/],
      [403, { status: "error" }, /rechazó la clave/],
      [429, { status: "error" }, /demasiadas peticiones/],
      [500, { status: "error", message: `fallo con ${CLAVE}` }, /respondió 500/],
      [200, "<html>no es json</html>", /no devolvió una respuesta que se entienda/],
      [200, { status: "error", message: "algo" }, /respondió 200 \(algo\)/],
    ];
    for (const [status, cuerpo, re] of casos) {
      const { f } = falso({ "/fb/page/getInfo": { status, cuerpo } });
      const err = await crearClienteManychat(CLAVE, f).paginas().catch((e) => e);
      expect(err).toBeInstanceOf(ManychatError);
      expect(err.message).toMatch(re);
      expect(err.message).not.toContain("<html>");
    }
  });

  it("si la red falla o tarda, lo dice sin detalles internos", async () => {
    const caida: FetchManychat = async () => { throw new Error(`ECONNREFUSED con ${CLAVE}`); };
    const err = await crearClienteManychat(CLAVE, caida).flujos().catch((e) => e);
    expect(err.message).toBe("No se pudo conectar con ManyChat");
    const lenta: FetchManychat = (_u, init) => new Promise((_ok, ko) => init.signal.addEventListener("abort", () => ko(Object.assign(new Error("abortado"), { name: "AbortError" }))));
    const t0 = Date.now();
    const e2 = await Promise.race([crearClienteManychat(CLAVE, lenta).flujos().catch((e) => e), new Promise((r) => setTimeout(() => r("sigue esperando"), 11_500))]);
    expect(Date.now() - t0).toBeLessThan(11_400);
    expect((e2 as Error).message).toBe("ManyChat no respondió a tiempo");
  }, 15_000);

  it("limpia lo que viene de fuera (sin saltos de línea ni textos kilométricos)", async () => {
    const { f } = falso({ "/fb/page/getTags": { status: 200, cuerpo: { status: "success", data: [{ name: `Tag\n\nlargo ${"x".repeat(500)}` }] } } });
    const [t] = await crearClienteManychat(CLAVE, f).etiquetas();
    expect(t.includes("\n")).toBe(false);
    expect(t.length).toBeLessThanOrEqual(80);
  });
});

describe("/manychat", () => {
  const mundo = (cliente: ManychatDeps["cliente"]) => {
    const enviados: string[] = [];
    const eventos: { kind: string; level?: string; summary: string }[] = [];
    const flujo = crearFlujoManychat({ cliente, async enviar(_c, t) { enviados.push(t); }, async logEvent(e) { eventos.push(e); } });
    return { flujo, enviados, eventos };
  };

  it("sin clave puesta explica dónde conseguirla y que no se pegue por chat", async () => {
    const m = mundo(() => null);
    await m.flujo.estado(1);
    expect(m.enviados[0]).toContain("MANYCHAT_API_KEY");
    expect(m.enviados[0]).toContain("nunca por aquí");
  });

  it("con la conexión buena lista solo nombres y avisa de que no cambió nada", async () => {
    const { f } = falso({
      "/fb/page/getInfo": { status: 200, cuerpo: { status: "success", data: { id: "9", name: "Blake" } } },
      "/fb/page/getFlows": { status: 200, cuerpo: { status: "success", data: { flows: [{ ns: "a", name: "Pedir cita" }] } } },
      "/fb/page/getTags": { status: 200, cuerpo: { status: "success", data: [] } },
      "/fb/page/getCustomFields": { status: 200, cuerpo: { status: "success", data: [{ name: "ciudad", type: "text" }] } },
    });
    const m = mundo(() => crearClienteManychat(CLAVE, f));
    await m.flujo.estado(1);
    const t = m.enviados[0];
    expect(t).toContain("ManyChat conectado: Blake");
    expect(t).toContain("Flujos (1): Pedir cita");
    expect(t).toContain("Etiquetas (0): ninguna");
    expect(t).toContain("ciudad (text)");
    expect(t).toContain("No he enviado ni cambiado nada");
    expect(t).not.toContain(CLAVE);
    expect(m.eventos[0].kind).toBe("manychat_comprobado");
  });

  it("si falla, lo dice, lo registra como error y no vuelca la respuesta", async () => {
    const { f } = falso({ "/fb/page/getInfo": { status: 401, cuerpo: { status: "error", message: `clave ${CLAVE} mala` } } });
    const m = mundo(() => crearClienteManychat(CLAVE, f));
    await m.flujo.estado(1);
    expect(m.enviados[0]).toContain("rechazó la clave");
    expect(m.enviados[0]).not.toContain(CLAVE);
    expect(m.eventos[0]).toMatchObject({ kind: "manychat_fallo", level: "error" });
    expect(JSON.stringify(m.eventos)).not.toContain(CLAVE);
  });
});

describe("enviarTexto: el único mensaje que Kira puede mandar por ManyChat", () => {
  function fetchEnvio(res: { status: number; cuerpo: unknown }) {
    const llamadas: { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: any }[] = [];
    const f: FetchManychat = async (url, init) => {
      llamadas.push({ url, metodo: init.method, cabeceras: init.headers, cuerpo: init.body ? JSON.parse(init.body) : undefined });
      return respuesta(res.status, res.cuerpo);
    };
    return { f, llamadas };
  }

  it("manda un POST a sendContent con el contacto y el texto, como mensaje de Instagram", async () => {
    const { f, llamadas } = fetchEnvio({ status: 200, cuerpo: { status: "success" } });
    await crearClienteManychat(CLAVE, f).enviarTexto("251792246", "Hola 😊\n\nTu cita es el viernes");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].metodo).toBe("POST");
    expect(new URL(llamadas[0].url).pathname).toBe("/fb/sending/sendContent");
    expect(llamadas[0].cabeceras.authorization).toBe(`Bearer ${CLAVE}`);
    expect(llamadas[0].cuerpo).toEqual({ subscriber_id: "251792246", data: { version: "v2", content: { type: "instagram", messages: [{ type: "text", text: "Hola 😊\n\nTu cita es el viernes" }] } } });
  });

  it("rechaza un id raro o un texto vacío o enorme SIN llamar a ManyChat", async () => {
    const { f, llamadas } = fetchEnvio({ status: 200, cuerpo: { status: "success" } });
    const c = crearClienteManychat(CLAVE, f);
    await expect(c.enviarTexto("1; drop", "hola")).rejects.toThrow(ManychatError);
    await expect(c.enviarTexto("123", "   ")).rejects.toThrow(ManychatError);
    await expect(c.enviarTexto("123", "x".repeat(2000))).rejects.toThrow(ManychatError);
    expect(llamadas).toHaveLength(0);
  });

  it("si ManyChat rechaza el envío (p. ej. ventana de 24 h cerrada) lanza un error legible sin la clave", async () => {
    const { f } = fetchEnvio({ status: 400, cuerpo: { status: "error", message: "Outside of the allowed window" } });
    const e = await crearClienteManychat(CLAVE, f).enviarTexto("123", "hola").catch((x) => x);
    expect(e).toBeInstanceOf(ManychatError);
    expect(e.message).toContain("Outside of the allowed window");
    expect(e.message).not.toContain(CLAVE);
  });
});
