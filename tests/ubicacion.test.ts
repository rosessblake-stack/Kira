import { describe, expect, it } from "vitest";
import {
  ZONA_MADRID,
  ZONA_MIAMI,
  REGLAS_ESPANA,
  aUtc,
  avisosDeHorario,
  esDiaLibre,
  fechaLarga,
  listaDiasLibres,
  partesEn,
} from "../lib/agenda";
import { extraerFecha, leerBasico } from "../lib/lectura-basica";
import { PERFIL_MIAMI, PERFIL_POR_DEFECTO, interpretarPerfil } from "../lib/pricing";
import { CONFIG_UBICACION, dinero, interpretarUbicacion, separarUbicacion } from "../lib/ubicacion";

describe("fechas en la hora de Miami (Nueva York)", () => {
  it("12:00 en Miami = 16:00 UTC con horario de verano y 17:00 UTC en invierno", () => {
    expect(aUtc("2026-10-20", "12:00", ZONA_MIAMI).toISOString()).toBe("2026-10-20T16:00:00.000Z"); // EDT (−4)
    expect(aUtc("2026-12-01", "12:00", ZONA_MIAMI).toISOString()).toBe("2026-12-01T17:00:00.000Z"); // EST (−5)
  });

  it("los cambios de hora de EE. UU. no coinciden con los de Europa (1 nov y 8 mar frente a 25 oct y 29 mar)", () => {
    // Entre el 25 oct y el 1 nov de 2026 Madrid ya está en invierno y Miami aún en verano: 5 h de diferencia en vez de 6.
    expect(aUtc("2026-10-28", "12:00", ZONA_MIAMI).toISOString()).toBe("2026-10-28T16:00:00.000Z");
    expect(aUtc("2026-10-28", "12:00", ZONA_MADRID).toISOString()).toBe("2026-10-28T11:00:00.000Z");
    expect(aUtc("2026-11-02", "12:00", ZONA_MIAMI).toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });

  it("ida y vuelta: lo guardado en UTC se vuelve a leer igual en la hora de Miami", () => {
    for (const [f, h] of [["2026-10-20", "12:00"], ["2026-11-01", "00:30"], ["2027-03-14", "03:30"], ["2026-07-04", "23:45"]] as const) {
      const p = partesEn(aUtc(f, h, ZONA_MIAMI), ZONA_MIAMI);
      expect([p.fecha, p.hora]).toEqual([f, h]);
    }
  });

  it("el mismo instante es otro día según la ciudad", () => {
    const i = new Date("2026-10-20T02:00:00Z"); // 04:00 en Madrid, 22:00 del día anterior en Miami
    expect(partesEn(i, ZONA_MADRID).fecha).toBe("2026-10-20");
    expect(partesEn(i, ZONA_MIAMI).fecha).toBe("2026-10-19");
    expect(fechaLarga(aUtc("2026-10-20", "12:00", ZONA_MIAMI), ZONA_MIAMI)).toBe("mar 20 oct, 12:00");
  });

  it("España sigue igual por defecto (sin pasar zona)", () => {
    expect(aUtc("2026-10-20", "12:00").toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(fechaLarga(new Date("2026-10-20T10:00:00Z"))).toBe("mar 20 oct, 12:00");
  });
});

describe("reglas de agenda por ciudad", () => {
  it("Miami tiene los mismos días libres y horario que España (dicho por Blake)", () => {
    expect([...(CONFIG_UBICACION.miami.reglas.diasLibres ?? [])]).toEqual([0, 1]);
    expect(CONFIG_UBICACION.miami.reglas.horario).toEqual(CONFIG_UBICACION.espana.reglas.horario);
    expect(listaDiasLibres(CONFIG_UBICACION.miami.reglas)).toBe("domingo y lunes");
  });

  it("pero cada uno mira SU calendario: el mismo instante puede ser lunes en Miami y martes en Madrid", () => {
    const i = new Date("2026-10-27T03:00:00Z"); // martes 04:00 en Madrid, lunes 23:00 en Miami
    expect(esDiaLibre(i, REGLAS_ESPANA)).toBe(false);
    expect(esDiaLibre(i, CONFIG_UBICACION.miami.reglas)).toBe(true);
    const j = new Date("2026-10-26T03:00:00Z"); // lunes 04:00 en Madrid, domingo 23:00 en Miami: libre en los dos
    expect(esDiaLibre(j, REGLAS_ESPANA)).toBe(true);
    expect(esDiaLibre(j, CONFIG_UBICACION.miami.reglas)).toBe(true);
  });

  it("avisos de horario en Miami: el domingo y las 7:00 de la mañana avisan, como en España pero en hora de Miami", () => {
    const i = aUtc("2026-10-25", "07:00", ZONA_MIAMI); // domingo en Miami
    const a = avisosDeHorario(i, new Date(i.getTime() + 2 * 3_600_000), new Date("2026-10-19T12:00:00Z"), CONFIG_UBICACION.miami.reglas);
    expect(a[0]).toBe("La cita cae en domingo, que es día libre (no trabajas: domingo y lunes).");
    expect(a[1]).toMatch(/Empieza a las 07:00, antes del horario habitual/);
    const bien = aUtc("2026-10-22", "12:00", ZONA_MIAMI);
    expect(avisosDeHorario(bien, new Date(bien.getTime() + 2 * 3_600_000), new Date("2026-10-19T12:00:00Z"), CONFIG_UBICACION.miami.reglas)).toEqual([]);
  });

  it("pero la fecha pasada o muy lejana sigue avisando en Miami", () => {
    const pasada = aUtc("2026-10-10", "12:00", ZONA_MIAMI);
    expect(avisosDeHorario(pasada, new Date(pasada.getTime() + 3_600_000), new Date("2026-10-19T12:00:00Z"), CONFIG_UBICACION.miami.reglas)[0]).toMatch(/ya ha pasado/);
  });
});

describe("dinero", () => {
  it("euros y dólares, con coma decimal y sin decimales redondos", () => {
    expect(dinero(2000, "EUR")).toBe("20 €");
    expect(dinero(2000, "USD")).toBe("20 $");
    expect(dinero(6015, "USD")).toBe("60,15 $");
    expect(dinero(123456, "EUR")).toBe("1234,56 €");
    expect(dinero(null, "USD")).toBe("—");
    expect(dinero(5)).toBe("0,05 €"); // por defecto euros
  });
});

describe("ubicación", () => {
  it("«miami: …» elige Miami y quita el prefijo; sin separador no se toca el mensaje", () => {
    expect(separarUbicacion("miami: hola, quiero cita")).toEqual({ ubicacion: "miami", texto: "hola, quiero cita" });
    expect(separarUbicacion("  Miami - hola")).toEqual({ ubicacion: "miami", texto: "hola" });
    expect(separarUbicacion("España: hola")).toEqual({ ubicacion: "espana", texto: "hola" });
    expect(separarUbicacion("espana—hola")).toEqual({ ubicacion: "espana", texto: "hola" });
    expect(separarUbicacion("Miami es mi ciudad")).toEqual({ ubicacion: "espana", texto: "Miami es mi ciudad" });
    expect(separarUbicacion("hola, vivo en miami: quiero cita")).toEqual({ ubicacion: "espana", texto: "hola, vivo en miami: quiero cita" });
  });

  it("cualquier valor raro es España", () => {
    expect(interpretarUbicacion("miami")).toBe("miami");
    for (const v of [undefined, null, "", "Miami", "usa", 5, {}]) expect(interpretarUbicacion(v)).toBe("espana");
  });

  it("la configuración de cada sitio: España en euros y Madrid; Miami en dólares y Nueva York; señal de 20 en los dos", () => {
    expect(CONFIG_UBICACION.espana).toMatchObject({ moneda: "EUR", zonaHoraria: "Europe/Madrid", senalCentimos: 2000, pendientes: [] });
    expect(CONFIG_UBICACION.miami).toMatchObject({ moneda: "USD", zonaHoraria: "America/New_York", senalCentimos: 2000, pendientes: [] });
  });

  it("dirección por defecto: la de siempre en España; en Miami ninguna (depende del día)", () => {
    expect(CONFIG_UBICACION.espana.direccionPorDefecto).toBe("Carrer de la Duquessa de la Victòria, 16");
    expect(CONFIG_UBICACION.miami.direccionPorDefecto).toBeNull();
    expect(CONFIG_UBICACION.espana.clavePerfil).not.toBe(CONFIG_UBICACION.miami.clavePerfil);
  });
});

describe("perfiles de precios por ubicación", () => {
  it("Miami: salón, zona premium, EE. UU., élite y el mínimo de Florida (15 $/h × 173,33 h/mes = 2600 $); confirmado", () => {
    expect(PERFIL_MIAMI).toEqual({ pais: "us", zona: "premium", estructura: "salon", nivel: "elite", smi: 2600, confirmado: true });
    expect(Math.round(15 * (40 * 52) / 12)).toBe(PERFIL_MIAMI.smi); // la cuenta, a la vista
  });

  it("sin nada guardado: el perfil de ese lugar; roto: el mismo, marcado sin confirmar", () => {
    expect(interpretarPerfil(null, PERFIL_MIAMI)).toBe(PERFIL_MIAMI);
    expect(interpretarPerfil("x", PERFIL_MIAMI)).toEqual({ ...PERFIL_MIAMI, confirmado: false }); // roto: se usa pero se avisa
    expect(interpretarPerfil("x", PERFIL_POR_DEFECTO)).toEqual({ ...PERFIL_POR_DEFECTO, confirmado: false });
    expect(interpretarPerfil(null)).toBe(PERFIL_POR_DEFECTO);
  });

  it("Blake puede guardar su perfil de Miami confirmado", () => {
    expect(interpretarPerfil({ pais: "us", zona: "premium", estructura: "salon", nivel: "elite", smi: 1300, confirmado: true }, PERFIL_MIAMI)).toEqual({
      pais: "us", zona: "premium", estructura: "salon", nivel: "elite", smi: 1300, confirmado: true,
    });
  });
});

describe("lectura básica con la zona de la clienta", () => {
  it("«mañana» es el día siguiente en SU calendario (cuando en Madrid ya es otro día)", () => {
    const ahora = new Date("2026-10-20T02:00:00Z"); // martes 04:00 en Madrid, lunes 22:00 en Miami
    expect(extraerFecha("quiero cita manana a las 5", ahora)).toBe("2026-10-21");
    expect(extraerFecha("quiero cita manana a las 5", ahora, ZONA_MIAMI)).toBe("2026-10-20");
    expect(leerBasico("quiero 6 trenzas pegadas con extensiones, manana a las 5pm", ahora, ZONA_MIAMI).fecha).toBe("2026-10-20");
  });
});
