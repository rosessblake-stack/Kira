import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PERFIL_MIAMI,
  PERFIL_POR_DEFECTO,
  construirPeticion,
  horasPorDefecto,
  interpretarRespuesta,
  materialesPorDefecto,
  type ServicioParaPrecio,
} from "../lib/pricing";

/**
 * Contrato con Legacy: ejecuta la fórmula REAL (api/calculate.js del repo de Legacy) con lo que Kira envía.
 * Detecta si Legacy cambia un campo y Kira se queda enviando algo que ya no entiende.
 * Se omite si no hay copia del repo de Legacy (variable LEGACY_REPO, por defecto /home/user/legacy).
 */
const LEGACY_REPO = process.env.LEGACY_REPO ?? "/home/user/legacy";
const RUTA = `${LEGACY_REPO}/api/calculate.js`;
const hayLegacy = existsSync(RUTA);

type Res = { code: number; body: Record<string, unknown> };

async function llamarLegacy(body: Record<string, unknown>): Promise<Res> {
  // Que el handler de Legacy no escriba jamás en ninguna base de datos durante la prueba.
  const guardado = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_ANON_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  try {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(RUTA).href)) as { default: (req: unknown, res: unknown) => Promise<void> };
    const out: Res = { code: 0, body: {} };
    const res = {
      setHeader() {},
      status(c: number) { out.code = c; return res; },
      json(b: Record<string, unknown>) { out.body = b; return res; },
      end() { return res; },
    };
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    await mod.default({ headers: { "x-forwarded-for": ip }, method: "POST", body, socket: {} }, res);
    return out;
  } finally {
    if (guardado.u !== undefined) process.env.SUPABASE_URL = guardado.u;
    if (guardado.k !== undefined) process.env.SUPABASE_ANON_KEY = guardado.k;
  }
}

const servicio = (o: Partial<ServicioParaPrecio>): ServicioParaPrecio => ({
  tipo_trenzado: null, numero_trenzas: null, tamano: null, estilo_pegadas: null, extensiones: null, boho: null, largo_cabello: null, largo_extensiones: null, ...o,
});

async function precio(s: ServicioParaPrecio, horas = horasPorDefecto(s), perfil = PERFIL_POR_DEFECTO) {
  const r = await llamarLegacy(construirPeticion(s, perfil, horas, materialesPorDefecto(s)));
  return { r, parsed: r.code === 200 ? interpretarRespuesta(r.body) : null };
}

describe.skipIf(!hayLegacy)("contrato con la fórmula real de Legacy", () => {
  it("pegadas con extensiones (el caso de las 6 trenzas): Legacy lo acepta y el precio es coherente", async () => {
    const { r, parsed } = await precio(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 6, extensiones: "con", largo_cabello: "nuca_hombros", largo_extensiones: "caderas" }));
    expect(r.code, JSON.stringify(r.body)).toBe(200);
    expect(parsed!.totalCentimos).toBeGreaterThan(2000);
    expect(parsed!.totalCentimos).toBeLessThan(40000);
    expect(r.body.llevaExtensiones).toBe(true);
    expect(r.body.tipoTrenzado).toBe("pegadas");
  });

  it("acepta todos los tipos y tamaños que Kira puede enviar", async () => {
    for (const tamano of ["jumbo", "large", "lardium", "medium", "smedium", "small", "xs_small"] as const) {
      for (const tipo of ["sueltas", "fulani"] as const) {
        const { r } = await precio(servicio({ tipo_trenzado: tipo, tamano, extensiones: "con" }));
        expect(r.code, `${tipo}/${tamano}: ${JSON.stringify(r.body)}`).toBe(200);
      }
    }
    for (const ext of ["con", "feedin", "sin"] as const) {
      for (const estilo of ["cornrows", "twist", "barrel_twist"] as const) {
        const { r } = await precio(servicio({ tipo_trenzado: "pegadas", extensiones: ext, estilo_pegadas: estilo, numero_trenzas: 4 }));
        expect(r.code, `pegadas/${ext}/${estilo}: ${JSON.stringify(r.body)}`).toBe(200);
      }
    }
  });

  it("más trabajo = más precio (sanidad de la integración)", async () => {
    const dos = (await precio(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 2, extensiones: "con" }))).parsed!;
    const doce = (await precio(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 12, extensiones: "con" }))).parsed!;
    expect(doce.totalCentimos).toBeGreaterThan(dos.totalCentimos);
    const jumbo = (await precio(servicio({ tipo_trenzado: "sueltas", tamano: "jumbo", extensiones: "con" }))).parsed!;
    const small = (await precio(servicio({ tipo_trenzado: "sueltas", tamano: "small", extensiones: "con" }))).parsed!;
    expect(small.totalCentimos).toBeGreaterThan(jumbo.totalCentimos);
  });

  it("el perfil de Blake cambia el precio (estructura salón > casa)", async () => {
    const s = servicio({ tipo_trenzado: "sueltas", tamano: "medium", extensiones: "con" });
    const casa = (await precio(s, 6, { ...PERFIL_POR_DEFECTO, estructura: "casa" })).parsed!;
    const salon = (await precio(s, 6, { ...PERFIL_POR_DEFECTO, estructura: "salon" })).parsed!;
    expect(salon.totalCentimos).toBeGreaterThan(casa.totalCentimos);
  });

  it("Miami (EE. UU., salón, zona premium, élite): Legacy lo acepta, responde en dólares y cobra más que en España", async () => {
    const s = servicio({ tipo_trenzado: "pegadas", numero_trenzas: 6, extensiones: "con", largo_cabello: "nuca_hombros", largo_extensiones: "caderas" });
    const espana = await precio(s, 2, PERFIL_POR_DEFECTO);
    const miami = await precio(s, 2, PERFIL_MIAMI);
    expect(miami.r.code, JSON.stringify(miami.r.body)).toBe(200);
    expect(miami.parsed!.totalCentimos).toBeGreaterThan(espana.parsed!.totalCentimos); // premium (×1,2) y salón (×1,3) con SMI parecido
    // Sin conversión de moneda: para EE. UU. Legacy trabaja en dólares (tasa 1), así que el total ya viene en $.
    const casa = await precio(s, 2, { ...PERFIL_MIAMI, estructura: "casa", zona: "media" });
    expect(miami.parsed!.totalCentimos).toBeGreaterThan(casa.parsed!.totalCentimos);
  });

  it("si Kira enviara algo incompleto, Legacy lo rechaza con 400 (y Kira no inventaría precio)", async () => {
    const mala = construirPeticion(servicio({ tipo_trenzado: "sueltas", extensiones: "con" }), PERFIL_POR_DEFECTO, 4, 10); // sin tamaño
    const r = await llamarLegacy(mala);
    expect(r.code).toBe(400);
    expect(String(r.body.error)).toMatch(/tamaño/i);
  });

  it("no manda a Legacy ningún dato de la clienta", async () => {
    const p = construirPeticion(servicio({ tipo_trenzado: "pegadas", extensiones: "con" }), PERFIL_POR_DEFECTO, 2, 5);
    expect(Object.values(p).join(" ")).not.toMatch(/rosessblake|gmail/i);
  });
});
