import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describirErrorClaude, limpiarMensajeDeApi } from "../lib/claude";
import { comprobarClaude, formatoDeClave, olvidarComprobacion } from "../lib/claude-check";

const NORMAL = `sk-ant-api03-${"A".repeat(90)}`;

describe("formatoDeClave: de qué tipo parece la clave, sin enseñarla", () => {
  it("clave normal", () => {
    expect(formatoDeClave(NORMAL)).toEqual({ presente: true, longitud: NORMAL.length, formato: "normal", conEspacios: false, mezclada: false });
  });
  it("clave de administración: NO sirve para Kira", () => {
    expect(formatoDeClave(`sk-ant-admin01-${"B".repeat(80)}`).formato).toBe("administracion");
  });
  it("ausente o vacía", () => {
    for (const v of [undefined, null, ""]) expect(formatoDeClave(v)).toMatchObject({ presente: false, formato: "ausente", longitud: 0 });
  });
  it("desconocida: otra cosa que no es una clave de Anthropic", () => {
    expect(formatoDeClave("sk-proj-abc123").formato).toBe("desconocido");
    expect(formatoDeClave("hola").formato).toBe("desconocido");
  });
  it("detecta espacios o saltos de línea pegados al principio o al final", () => {
    expect(formatoDeClave(`${NORMAL}\n`).conEspacios).toBe(true);
    expect(formatoDeClave(` ${NORMAL}`).conEspacios).toBe(true);
    expect(formatoDeClave(NORMAL).conEspacios).toBe(false);
  });
  it("detecta comillas o el nombre de la variable pegado también", () => {
    expect(formatoDeClave(`"${NORMAL}"`).mezclada).toBe(true);
    expect(formatoDeClave(`'${NORMAL}'`).mezclada).toBe(true);
    expect(formatoDeClave(`ANTHROPIC_API_KEY=${NORMAL}`).mezclada).toBe(true);
    expect(formatoDeClave(NORMAL).mezclada).toBe(false);
  });
  it("el resultado nunca contiene la clave", () => {
    expect(JSON.stringify(formatoDeClave(NORMAL))).not.toContain("sk-ant");
    expect(JSON.stringify(formatoDeClave(NORMAL))).not.toContain("AAAA");
  });
});

describe("describirErrorClaude con el cuerpo del error de la API", () => {
  const api = (status: number, tipo?: string, mensaje?: string, requestID?: string) =>
    Object.assign(new Error("x"), { status, error: tipo ? { type: "error", error: { type: tipo, message: mensaje } } : undefined, requestID });

  it("401: añade el tipo y el motivo de Anthropic y el identificador de la petición", () => {
    expect(describirErrorClaude(api(401, "authentication_error", "invalid x-api-key", "req_011CVabcdefghij"))).toBe(
      "Claude respondió con el error 401 (clave rechazada: revisa ANTHROPIC_API_KEY) · authentication_error: invalid x-api-key · req_011CVabcdefghij",
    );
  });

  it("400 de crédito: el motivo explica lo que pasa", () => {
    expect(describirErrorClaude(api(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."))).toBe(
      "Claude respondió con el error 400 · invalid_request_error: Your credit balance is too low to access the Anthropic API.",
    );
  });

  it("429 y 5xx: solo el tipo, sin el mensaje", () => {
    expect(describirErrorClaude(api(529, "overloaded_error", "Overloaded"))).toBe("Claude respondió con el error 529 (servicio sobrecargado o caído) · overloaded_error");
    expect(describirErrorClaude(api(429, "rate_limit_error", "uno dos tres"))).toBe("Claude respondió con el error 429 (demasiadas peticiones) · rate_limit_error");
  });

  it("si el mensaje trae algo con forma de clave, se tapa; también saltos de línea y longitud", () => {
    const t = describirErrorClaude(api(401, "authentication_error", `bad key sk-ant-api03-SECRETO123456\nsegunda línea ${"x".repeat(500)}`));
    expect(t).not.toContain("SECRETO");
    expect(t).toContain("[clave]");
    expect(t).not.toContain("\n");
    expect(t.length).toBeLessThan(330);
  });

  it("un tipo raro o un identificador raro no se copia", () => {
    expect(describirErrorClaude(api(401, "<script>alert(1)</script>", "x", "no-es-un-id"))).toBe("Claude respondió con el error 401 (clave rechazada: revisa ANTHROPIC_API_KEY)");
  });

  it("limpiarMensajeDeApi", () => {
    expect(limpiarMensajeDeApi("a\tb\n c   d")).toBe("a b c d");
    expect(limpiarMensajeDeApi("x".repeat(300))).toHaveLength(140);
  });
});

describe("comprobarClaude (guarda el resultado 60 s)", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => olvidarComprobacion());
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    globalThis.fetch = fetchOriginal;
    olvidarComprobacion();
  });

  it("sin clave: no pregunta a nadie", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const f = vi.fn();
    globalThis.fetch = f as never;
    expect(await comprobarClaude()).toMatchObject({ presente: false, aceptada: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("clave aceptada por Anthropic (200)", async () => {
    process.env.ANTHROPIC_API_KEY = NORMAL;
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = f as never;
    expect(await comprobarClaude(1000)).toMatchObject({ aceptada: true, estado: 200, formato: "normal" });
    expect(await comprobarClaude(30_000)).toMatchObject({ aceptada: true }); // dentro de los 60 s: no vuelve a preguntar
    expect(f).toHaveBeenCalledTimes(1);
    expect(await comprobarClaude(70_000)).toMatchObject({ aceptada: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("clave rechazada (401): lo dice con el motivo y sin la clave", async () => {
    process.env.ANTHROPIC_API_KEY = NORMAL;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } })) as never;
    const r = await comprobarClaude();
    expect(r).toMatchObject({ aceptada: false, estado: 401 });
    expect(r.motivo).toContain("authentication_error: invalid x-api-key");
    expect(JSON.stringify(r)).not.toContain("AAAA");
  });

  it("sin conexión con Anthropic: no se sabe (null), no se dice que la clave esté mal", async () => {
    process.env.ANTHROPIC_API_KEY = NORMAL;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as never;
    expect(await comprobarClaude()).toMatchObject({ aceptada: null });
  });
});
