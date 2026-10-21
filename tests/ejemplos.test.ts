import { describe, expect, it } from "vitest";
import { crearFlujoEjemplos, interpretarPieEjemplo, MAX_EJEMPLOS_POR_ESTILO, type EjemplosDeps, type EstiloPegadas } from "../lib/ejemplos";

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function montar(over: Partial<EjemplosDeps> = {}, cuentas: Partial<Record<EstiloPegadas, number>> = {}) {
  const msgs: string[] = [];
  const guardados: { estilo: string; ruta: string; descripcion: string | null }[] = [];
  let cache = 0;
  const deps: EjemplosDeps = {
    newId: () => "11111111-1111-4111-8111-111111111111",
    descargar: async () => ({ ok: true, bytes: JPG }),
    guardar: async (e) => {
      guardados.push({ estilo: e.estilo, ruta: e.storagePath, descripcion: e.descripcion });
      return { seq: 7 };
    },
    contarPorEstilo: async () => ({ cornrows: 0, twist: 0, barrel_twist: 0, ...cuentas }),
    listar: async () => [],
    borrar: async () => true,
    invalidarCache: () => void cache++,
    enviar: async (_c, t) => void msgs.push(t),
    logEvent: async () => undefined,
    ...over,
  };
  return { port: crearFlujoEjemplos(deps), msgs, guardados, cache: () => cache };
}

describe("pie «ejemplo …»", () => {
  it("reconoce los tres estilos y la descripción", () => {
    expect(interpretarPieEjemplo("ejemplo flat twist")).toEqual({ estilo: "twist", descripcion: null });
    expect(interpretarPieEjemplo("Ejemplo Cornrows: seis finos hacia atrás")).toEqual({ estilo: "cornrows", descripcion: "seis finos hacia atrás" });
    expect(interpretarPieEjemplo("ejemplo barrel-twist - con cuentas")).toEqual({ estilo: "barrel_twist", descripcion: "con cuentas" });
    expect(interpretarPieEjemplo("ejemplo twist")).toEqual({ estilo: "twist", descripcion: null });
  });
  it("otros pies no son ejemplos", () => {
    expect(interpretarPieEjemplo("pelo: rizado")).toBeNull();
    expect(interpretarPieEjemplo("ejemplo")).toBeNull();
    expect(interpretarPieEjemplo("ejemplo sueltas")).toBeNull();
    expect(interpretarPieEjemplo("")).toBeNull();
  });
});

describe("guardar ejemplos", () => {
  it("guarda en ejemplos/, avisa a Blake e invalida la caché", async () => {
    const m = montar();
    await m.port.recibir(1, { fileId: "f", tamano: 1000 }, "twist", "seis");
    expect(m.guardados).toEqual([{ estilo: "twist", ruta: "ejemplos/11111111-1111-4111-8111-111111111111.jpg", descripcion: "seis" }]);
    expect(m.msgs[0]).toContain("ejemplo de flat twist (#7)");
    expect(m.cache()).toBe(1);
  });
  it("rechaza lo que no es una imagen", async () => {
    const m = montar({ descargar: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]) }) });
    await m.port.recibir(1, { fileId: "f", tamano: null }, "cornrows", null);
    expect(m.guardados).toHaveLength(0);
    expect(m.msgs[0]).toContain("no parece una foto");
  });
  it("tope por estilo", async () => {
    const m = montar({}, { cornrows: MAX_EJEMPLOS_POR_ESTILO });
    await m.port.recibir(1, { fileId: "f", tamano: null }, "cornrows", null);
    expect(m.guardados).toHaveLength(0);
    expect(m.msgs[0]).toContain("/borrarejemplo");
  });
  it("misma foto: no se duplica", async () => {
    const m = montar({ guardar: async () => null });
    await m.port.recibir(1, { fileId: "f", tamano: null }, "barrel_twist", null);
    expect(m.msgs[0]).toContain("ya la tenía");
    expect(m.cache()).toBe(0);
  });
  it("foto demasiado grande: ni se descarga", async () => {
    let descargas = 0;
    const m = montar({ descargar: async () => (descargas++, { ok: true, bytes: JPG }) });
    await m.port.recibir(1, { fileId: "f", tamano: 9_000_000 }, "twist", null);
    expect(descargas).toBe(0);
  });
  it("borrar y listar", async () => {
    const m = montar({ listar: async () => [{ seq: 2, estilo: "twist", description: "finos", created_at: "x" }] });
    await m.port.listar(1);
    expect(m.msgs[0]).toContain("flat twist: #2 (finos)");
    expect(m.msgs[0]).toContain("cornrows: ninguno");
    await m.port.borrar(1, 2);
    expect(m.msgs[1]).toContain("#2 borrado");
  });
});
