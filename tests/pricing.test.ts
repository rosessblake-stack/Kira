import { describe, expect, it } from "vitest";
import {
  EMAIL_INTERNO,
  LegacyError,
  PERFIL_POR_DEFECTO,
  consultarLegacy,
  construirPeticion,
  datosFaltantes,
  horasPorDefecto,
  interpretarPerfil,
  interpretarRespuesta,
  materialesPorDefecto,
  type FetchLike,
  type ServicioParaPrecio,
} from "../lib/pricing";

const servicio = (o: Partial<ServicioParaPrecio> = {}): ServicioParaPrecio => ({
  tipo_trenzado: null,
  numero_trenzas: null,
  tamano: null,
  estilo_pegadas: null,
  extensiones: null,
  boho: null,
  largo_cabello: null,
  largo_extensiones: null,
  ...o,
});

describe("datosFaltantes", () => {
  it("sin tipo de trenzado no se puede calcular", () => {
    expect(datosFaltantes(servicio({ extensiones: "con", numero_trenzas: 6 }))).toEqual(["tipo de trenzado (pegadas, sueltas o fulani)"]);
  });

  it("sueltas y fulani necesitan tamaño; las pegadas no", () => {
    expect(datosFaltantes(servicio({ tipo_trenzado: "sueltas", extensiones: "con" }))).toHaveLength(1);
    expect(datosFaltantes(servicio({ tipo_trenzado: "fulani", extensiones: "con" }))[0]).toMatch(/tamaño/);
    expect(datosFaltantes(servicio({ tipo_trenzado: "pegadas", extensiones: "con" }))).toEqual([]);
    expect(datosFaltantes(servicio({ tipo_trenzado: "sueltas", tamano: "large", extensiones: "con" }))).toEqual([]);
  });

  it("sin saber si lleva extensiones tampoco hay precio (saldría más barato de lo real)", () => {
    expect(datosFaltantes(servicio({ tipo_trenzado: "pegadas" }))).toEqual(["si lleva extensiones"]);
  });
});

describe("horas y materiales por defecto (provisionales)", () => {
  it("pegadas: 2 trenzas ≈ 1 h y crece 15 min por trenza, entre 1 y 8 h", () => {
    expect(horasPorDefecto(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 2 }))).toBe(1);
    expect(horasPorDefecto(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 6 }))).toBe(2);
    expect(horasPorDefecto(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 1 }))).toBe(1);
    expect(horasPorDefecto(servicio({ tipo_trenzado: "pegadas", numero_trenzas: 100 }))).toBe(8);
    expect(horasPorDefecto(servicio({ tipo_trenzado: "pegadas" }))).toBe(2);
  });

  it("sueltas y fulani dependen del tamaño", () => {
    expect(horasPorDefecto(servicio({ tipo_trenzado: "sueltas", tamano: "jumbo" }))).toBe(3);
    expect(horasPorDefecto(servicio({ tipo_trenzado: "fulani", tamano: "xs_small" }))).toBe(10);
    expect(horasPorDefecto(servicio({ tipo_trenzado: "sueltas" }))).toBe(0);
    expect(horasPorDefecto(servicio())).toBe(0);
  });

  it("materiales por tipo", () => {
    expect(materialesPorDefecto(servicio({ tipo_trenzado: "pegadas" }))).toBe(5);
    expect(materialesPorDefecto(servicio({ tipo_trenzado: "sueltas" }))).toBe(10);
    expect(materialesPorDefecto(servicio())).toBe(0);
  });
});

describe("construirPeticion", () => {
  it("nunca lleva datos de la clienta: email interno de marcador y sin Instagram", () => {
    const p = construirPeticion(servicio({ tipo_trenzado: "pegadas", extensiones: "con" }), PERFIL_POR_DEFECTO, 2, 5);
    expect(p.email).toBe(EMAIL_INTERNO);
    expect(String(p.email)).toMatch(/\.invalid$/);
    expect(p.instagram).toBe("");
    expect(String(p.nombreServicio)).toMatch(/^\[Kira\]/);
    expect(JSON.stringify(p)).not.toMatch(/gmail|@[a-z]+\.com/i);
  });

  it("pegadas: usa los campos de pegadas y respeta feed-in", () => {
    const p = construirPeticion(servicio({ tipo_trenzado: "pegadas", extensiones: "feedin", estilo_pegadas: "twist", boho: true }), PERFIL_POR_DEFECTO, 3, 5);
    expect(p).toMatchObject({ tipoTrenzado: "pegadas", tipoPegadas: "twist", extensionesPegadas: "feedin", bohoPegadas: "si", complejidadPegadas: "basico", horas: 3, materiales: 5 });
    expect(p.tamanoSueltas).toBeUndefined();
  });

  it("pegadas sin estilo indicado: cornrows", () => {
    const p = construirPeticion(servicio({ tipo_trenzado: "pegadas", extensiones: "sin" }), PERFIL_POR_DEFECTO, 1, 0);
    expect(p).toMatchObject({ tipoPegadas: "cornrows", extensionesPegadas: "sin", bohoPegadas: "no" });
  });

  it("sueltas y fulani: tamaño y extensiones en sus campos", () => {
    expect(construirPeticion(servicio({ tipo_trenzado: "sueltas", tamano: "large", extensiones: "con" }), PERFIL_POR_DEFECTO, 4, 10)).toMatchObject({
      tipoTrenzado: "sueltas", tamanoSueltas: "large", tipoSueltas: "box", extensionesSueltas: "con",
    });
    expect(construirPeticion(servicio({ tipo_trenzado: "fulani", tamano: "small", extensiones: "feedin" }), PERFIL_POR_DEFECTO, 8, 10)).toMatchObject({
      tipoTrenzado: "fulani", tamanoFulaniAtras: "small", extensionesFulani: "con", complejidadFulaniDelante: "simples",
    });
  });

  it("incluye el perfil de Blake", () => {
    const perfil = { ...PERFIL_POR_DEFECTO, estructura: "salon" as const, smi: 1500 };
    const p = construirPeticion(servicio({ tipo_trenzado: "pegadas", extensiones: "con" }), perfil, 2, 5);
    expect(p).toMatchObject({ pais: "es", zona: "media", estructura: "salon", nivel: "elite", smi: 1500 });
  });
});

describe("interpretarPerfil", () => {
  it("acepta un perfil completo y confirmado", () => {
    expect(interpretarPerfil({ pais: "es", zona: "premium", estructura: "salon", nivel: "elite", smi: 1400, confirmado: true })).toEqual({
      pais: "es", zona: "premium", estructura: "salon", nivel: "elite", smi: 1400, confirmado: true,
    });
  });

  it("cualquier dato raro vuelve al perfil por defecto, sin confirmar", () => {
    for (const raw of [null, undefined, "x", {}, { pais: "es", zona: "luna", estructura: "casa", nivel: "elite", smi: 1 }, { pais: "es", zona: "media", estructura: "casa", nivel: "elite", smi: -5 }, { pais: "España", zona: "media", estructura: "casa", nivel: "elite", smi: 1000 }]) {
      expect(interpretarPerfil(raw)).toBe(PERFIL_POR_DEFECTO);
    }
    expect(PERFIL_POR_DEFECTO.confirmado).toBe(false);
  });

  it("'confirmado' solo vale si es exactamente true", () => {
    expect(interpretarPerfil({ pais: "es", zona: "media", estructura: "casa", nivel: "elite", smi: 1350, confirmado: "true" }).confirmado).toBe(false);
  });
});

describe("interpretarRespuesta", () => {
  const ok = { precioTotal: 63.65, precioManoObra: 58.65, materiales: 5, tarifaHora: 29.32, valorConocimiento: 50, costeTiempo: 8.65 };

  it("convierte a céntimos sin perder decimales", () => {
    expect(interpretarRespuesta(ok)).toMatchObject({ totalCentimos: 6365, materiales: 5, tarifaHora: 29.32 });
  });

  it("rechaza lo que no tiene forma de respuesta de Legacy", () => {
    for (const r of [null, "x", {}, { ...ok, precioTotal: "63" }, { ...ok, materiales: null }, { ...ok, precioTotal: Number.NaN }]) {
      expect(() => interpretarRespuesta(r)).toThrow(LegacyError);
    }
  });

  it("rechaza precios imposibles en vez de usarlos", () => {
    expect(() => interpretarRespuesta({ ...ok, precioTotal: 0 })).toThrow(/fuera de rango/);
    expect(() => interpretarRespuesta({ ...ok, precioTotal: -10 })).toThrow(/fuera de rango/);
    expect(() => interpretarRespuesta({ ...ok, precioTotal: 99999 })).toThrow(/fuera de rango/);
  });
});

describe("consultarLegacy", () => {
  const respuesta = (status: number, cuerpo: string) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => cuerpo });
  const buena = JSON.stringify({ precioTotal: 80, precioManoObra: 75, materiales: 5, tarifaHora: 37.5 });

  it("devuelve el precio cuando Legacy responde bien", async () => {
    const r = await consultarLegacy({ a: 1 }, respuesta(200, buena) as FetchLike);
    expect(r.totalCentimos).toBe(8000);
  });

  it("envía JSON por POST con el cuerpo dado", async () => {
    let visto: { url: string; method: string; body: string; ct: string } | null = null;
    const f: FetchLike = async (url, init) => {
      visto = { url, method: init.method, body: init.body, ct: init.headers["content-type"] };
      return { ok: true, status: 200, text: async () => buena };
    };
    await consultarLegacy({ nivel: "elite" }, f);
    expect(visto).toMatchObject({ method: "POST", body: '{"nivel":"elite"}', ct: "application/json" });
    expect(visto!.url).toMatch(/\/api\/calculate$/);
  });

  it("un error de Legacy se explica y no se inventa un precio", async () => {
    await expect(consultarLegacy({}, respuesta(400, JSON.stringify({ error: "Tamaño de sueltas no reconocido." })) as FetchLike)).rejects.toThrow(
      "Legacy respondió 400: Tamaño de sueltas no reconocido.",
    );
    await expect(consultarLegacy({}, respuesta(429, JSON.stringify({ error: "Demasiadas peticiones." })) as FetchLike)).rejects.toMatchObject({ estado: 429 });
  });

  it("detecta una página de login de Vercel (HTML en vez de JSON)", async () => {
    await expect(consultarLegacy({}, respuesta(200, "<!doctype html><title>Login</title>") as FetchLike)).rejects.toThrow(/no devolvió JSON/);
    await expect(consultarLegacy({}, respuesta(401, "<html>Authentication Required</html>") as FetchLike)).rejects.toMatchObject({ estado: 401 });
  });

  it("fallos de red y tiempos agotados salen como LegacyError sin filtrar detalles internos", async () => {
    const caida: FetchLike = async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.5:443");
    };
    const e1 = await consultarLegacy({}, caida).catch((e) => e);
    expect(e1).toBeInstanceOf(LegacyError);
    expect(e1.message).toBe("No se pudo conectar con Legacy");
    const agotada: FetchLike = async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    };
    const e2 = await consultarLegacy({}, agotada).catch((e) => e);
    expect(e2).toBeInstanceOf(LegacyError);
    expect(e2.message).toBe("Legacy no respondió a tiempo");
  });
});
