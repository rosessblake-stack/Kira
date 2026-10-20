import { afterEach, describe, expect, it } from "vitest";
import { MODELO, conReintentoDeModelo, modeloTexto, modeloVision } from "../lib/claude";

afterEach(() => {
  delete process.env.KIRA_MODEL_TEXTO;
  delete process.env.KIRA_MODEL_VISION;
});

describe("modelo por tarea (ahorro de tokens)", () => {
  it("sin variables, las dos tareas usan el modelo principal", () => {
    expect(modeloTexto()).toBe(MODELO);
    expect(modeloVision()).toBe(MODELO);
  });

  it("KIRA_MODEL_VISION y KIRA_MODEL_TEXTO cambian solo su tarea", () => {
    process.env.KIRA_MODEL_VISION = " claude-haiku-5-5 ";
    expect(modeloVision()).toBe("claude-haiku-5-5");
    expect(modeloTexto()).toBe(MODELO);
    process.env.KIRA_MODEL_TEXTO = "claude-sonnet-5-5";
    expect(modeloTexto()).toBe("claude-sonnet-5-5");
  });
});

describe("si el modelo barato no admite la petición, se repite UNA vez con el principal", () => {
  const falla = (status: number) => Object.assign(new Error("x"), { status });

  it("error 400 o 404 del modelo barato → reintento con el principal", async () => {
    for (const st of [400, 404]) {
      const usados: string[] = [];
      const r = await conReintentoDeModelo("claude-haiku-5-5", async (m) => {
        usados.push(m);
        if (m !== MODELO) throw falla(st);
        return "ok";
      });
      expect(usados).toEqual(["claude-haiku-5-5", MODELO]);
      expect(r).toEqual({ res: "ok", modelo: MODELO, reintento: true });
    }
  });

  it("otros errores (401, 429, 500, sin red) NO se reintentan con otro modelo", async () => {
    for (const e of [falla(401), falla(429), falla(500), new Error("sin red")]) {
      const usados: string[] = [];
      await expect(conReintentoDeModelo("claude-haiku-5-5", async (m) => { usados.push(m); throw e; })).rejects.toBe(e);
      expect(usados).toEqual(["claude-haiku-5-5"]);
    }
  });

  it("con el modelo principal no hay reintento: el error sale tal cual", async () => {
    const e = falla(400);
    await expect(conReintentoDeModelo(MODELO, async () => { throw e; })).rejects.toBe(e);
  });

  it("si el barato funciona, se usa y no hay reintento", async () => {
    const r = await conReintentoDeModelo("claude-haiku-5-5", async (m) => m);
    expect(r).toEqual({ res: "claude-haiku-5-5", modelo: "claude-haiku-5-5", reintento: false });
  });
});
