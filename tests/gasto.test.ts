import { describe, expect, it } from "vitest";
import { crearFlujoGasto, resumirGasto, textoGasto } from "../lib/gasto";

describe("/gasto", () => {
  it("suma tokens por tipo y calcula el coste con el precio de Opus ($4 / $20 por millón)", () => {
    const r = resumirGasto(
      [
        { uso: "texto", modelo: "claude-opus-5-5", entrada: 2800, salida: 250 },
        { uso: "fotos", modelo: "claude-opus-5-5", entrada: 5800, salida: 200 },
        { uso: "fotos", modelo: null, entrada: 5800, salida: 200 }, // anterior a anotar el modelo: era el principal
      ],
      4,
    );
    expect(r.texto).toEqual({ llamadas: 1, entrada: 2800, salida: 250 });
    expect(r.fotos).toEqual({ llamadas: 2, entrada: 11600, salida: 400 });
    expect(r.costeUsd).toBeCloseTo((14400 * 4 + 650 * 20) / 1e6, 6);
    expect(r.tokensSinPrecio).toBe(0);
    expect(r.formulariosSinClaude).toBe(4);
  });

  it("un modelo sin precio conocido: sus tokens se cuentan aparte y no inventan coste", () => {
    const r = resumirGasto([{ uso: "fotos", modelo: "claude-haiku-5-5", entrada: 1500, salida: 200 }], 0);
    expect(r.costeUsd).toBe(0);
    expect(r.tokensSinPrecio).toBe(1700);
    expect(textoGasto(r, 30)).toContain("modelo del que no conozco el precio");
  });

  it("el texto resume en céntimos y menciona los formularios leídos sin Claude", () => {
    const t = textoGasto(resumirGasto([{ uso: "texto", modelo: "claude-opus-5-5", entrada: 2800, salida: 250 }], 7), 30);
    expect(t).toContain("últimos 30 días");
    expect(t).toContain("1,6 céntimos");
    expect(t).toContain("7 formularios de Instagram leídos por código");
  });

  it("sin llamadas lo dice", () => {
    expect(textoGasto(resumirGasto([], 0), 30)).toContain("Todavía no hay llamadas");
  });

  it("si no se puede leer el registro, avisa sin romper", async () => {
    const enviados: string[] = [];
    const p = crearFlujoGasto({ leer: async () => { throw new Error("db"); }, now: () => new Date(), enviar: async (_c, t) => { enviados.push(t); } });
    await p.resumen(1);
    expect(enviados[0]).toContain("No he podido leer el gasto");
  });

  it("pide los últimos 30 días", async () => {
    let desde: Date | null = null;
    const ahora = new Date("2026-10-30T12:00:00Z");
    const p = crearFlujoGasto({ leer: async (d) => { desde = d; return { filas: [], formulariosSinClaude: 0 }; }, now: () => ahora, enviar: async () => {} });
    await p.resumen(1);
    expect(desde!.toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });
});
