import { describe, expect, it } from "vitest";
import { avisosDeHorario, duracionLegible, fechaLarga, madridAUtc, partesMadrid } from "../lib/agenda";
import { validarClasificacion } from "../lib/intents";
import { PERFIL_POR_DEFECTO, type PrecioLegacy } from "../lib/pricing";
import {
  aplicarCambios,
  componerPropuesta,
  interpretarFecha,
  interpretarHora,
  parsearEdicion,
  specDesdeClasificacion,
  textoPropuesta,
  type ResultadoPrecio,
  type SpecGuardada,
} from "../lib/proposal";

const AHORA = new Date("2026-10-19T13:30:00Z"); // lunes 19 oct 2026, 15:30 en Madrid

const MENSAJE =
  "Hola! tengo el pelo por el hombro, quiero 6 trenzas con extensiones rojas, por las caderas, para el 20 de octubre a las 12pm. Mi correo es rosessblake@gmail.com";

function specReferencia(o: Partial<{ tipo_trenzado: string }> = {}): SpecGuardada {
  const r = validarClasificacion(
    {
      intencion: "cita_salon", confianza: "media", manipulacion: false,
      tipo_trenzado: o.tipo_trenzado ?? "no_indicado", numero_trenzas: 6, tamano: "no_indicado", estilo_pegadas: "no_indicado",
      extensiones: "con", color_extensiones: "rojo", boho: "no_indicado", largo_cabello: "nuca_hombros", largo_extensiones: "caderas",
      fecha: "2026-10-20", hora: "12:00", nombre: "", email: "rosessblake@gmail.com", instagram: "", notas: "",
    },
    MENSAJE,
  );
  if (!r.ok) throw new Error(r.motivo);
  return specDesdeClasificacion(r.value, MENSAJE);
}

const legacy = (total: number): ResultadoPrecio => ({
  origen: "legacy",
  precio: { totalCentimos: Math.round(total * 100), manoObra: total - 5, materiales: 5, tarifaHora: 27, valorConocimiento: 50, costeTiempo: 5 } satisfies PrecioLegacy,
});
const ctx = { ahora: AHORA, perfil: PERFIL_POR_DEFECTO, calendarioConectado: false };

describe("agenda: hora de Madrid", () => {
  it("convierte a UTC respetando verano e invierno", () => {
    expect(madridAUtc("2026-10-20", "12:00").toISOString()).toBe("2026-10-20T10:00:00.000Z"); // CEST (+2)
    expect(madridAUtc("2026-12-01", "12:00").toISOString()).toBe("2026-12-01T11:00:00.000Z"); // CET (+1)
  });

  it("acierta justo en los cambios de hora", () => {
    // Fin del verano: domingo 25 oct 2026 (a las 3:00 pasan a ser las 2:00)
    expect(madridAUtc("2026-10-24", "11:00").toISOString()).toBe("2026-10-24T09:00:00.000Z");
    expect(madridAUtc("2026-10-25", "11:00").toISOString()).toBe("2026-10-25T10:00:00.000Z");
    // Inicio del verano: domingo 29 mar 2026
    expect(madridAUtc("2026-03-28", "11:00").toISOString()).toBe("2026-03-28T10:00:00.000Z");
    expect(madridAUtc("2026-03-29", "11:00").toISOString()).toBe("2026-03-29T09:00:00.000Z");
  });

  it("ida y vuelta: lo que se guarda en UTC se vuelve a leer igual en Madrid", () => {
    for (const [f, h] of [["2026-10-20", "12:00"], ["2026-12-31", "22:00"], ["2027-07-15", "08:30"]]) {
      const p = partesMadrid(madridAUtc(f, h));
      expect([p.fecha, p.hora]).toEqual([f, h]);
    }
  });

  it("rechaza formatos raros", () => {
    expect(() => madridAUtc("20/10/2026", "12:00")).toThrow();
    expect(() => madridAUtc("2026-10-20", "12h")).toThrow();
  });

  it("formatea fecha larga y duración", () => {
    expect(fechaLarga(madridAUtc("2026-10-20", "12:00"))).toBe("mar 20 oct, 12:00");
    expect(duracionLegible(45)).toBe("45 min");
    expect(duracionLegible(120)).toBe("2 h");
    expect(duracionLegible(150)).toBe("2 h 30 min");
  });
});

describe("agenda: avisos de horario (blandos)", () => {
  const en = (f: string, h: string, min: number) => {
    const i = madridAUtc(f, h);
    return avisosDeHorario(i, new Date(i.getTime() + min * 60_000), AHORA);
  };

  it("12:00 durante 2 h: sin avisos", () => {
    expect(en("2026-10-20", "12:00", 120)).toEqual([]);
  });

  it("antes de las 11:00 avisa, salvo servicios largos desde las 8:00", () => {
    expect(en("2026-10-20", "09:00", 120)[0]).toMatch(/antes del horario/);
    expect(en("2026-10-20", "08:00", 7 * 60)).toEqual([]);
    expect(en("2026-10-20", "07:00", 8 * 60)[0]).toMatch(/antes del horario/);
  });

  it("terminar después de las 22:00 o al día siguiente avisa", () => {
    expect(en("2026-10-20", "20:00", 3 * 60)[0]).toMatch(/Termina a las 23:00/);
    expect(en("2026-10-20", "21:00", 5 * 60)[0]).toMatch(/día siguiente/);
  });

  it("fecha pasada o a más de un año", () => {
    expect(en("2026-10-18", "12:00", 60)[0]).toMatch(/ya ha pasado/);
    expect(en("2028-01-10", "12:00", 60)[0]).toMatch(/más de un año/);
  });

  it("sin fecha no hay avisos de horario", () => {
    expect(avisosDeHorario(null, null, AHORA)).toEqual([]);
  });
});

describe("la clienta de referencia: 6 trenzas rojas, 20 oct 12:00", () => {
  it("primera propuesta: sin tipo de trenzado no hay precio y no se puede aprobar", () => {
    const spec = specReferencia();
    const p = componerPropuesta(spec, { origen: "sin_calcular", faltan: ["tipo de trenzado (pegadas, sueltas o fulani)"] }, ctx);
    expect(p.precioCentimos).toBeNull();
    expect(p.faltan).toEqual(["precio: falta tipo de trenzado (pegadas, sueltas o fulani)"]);
    expect(p.inicio!.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(p.emailCliente).toBe("rosessblake@gmail.com");
    expect(p.avisos.join("\n")).toMatch(/Disponibilidad NO comprobada/);
    expect(p.borrador).toMatch(/Borrador pendiente/);
    expect(p.borrador).not.toMatch(/€/);
  });

  it("con el tipo y el precio de Legacy: propuesta completa y aprobable", () => {
    const spec = specReferencia({ tipo_trenzado: "pegadas" });
    const p = componerPropuesta(spec, legacy(60.15), ctx);
    expect(p.faltan).toEqual([]);
    expect(p.precioCentimos).toBe(6015);
    expect(p.horasUsadas).toBe(2);
    expect(p.duracionMinutos).toBe(120);
    expect(p.inicio!.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(p.fin!.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(p.descripcion).toBe("6 trenzas · pegadas · con extensiones rojo");
    expect(p.borrador).toContain("Para 6 trenzas pegadas con extensiones (rojo), el precio es de 60,15 € y dura aproximadamente 2 h.");
    expect(p.borrador).toContain("mar 20 oct, 12:00");
    expect(p.borrador).toContain("15 €");
  });

  it("avisa de todo lo provisional: calendario, perfil y horas por defecto", () => {
    const p = componerPropuesta(specReferencia({ tipo_trenzado: "pegadas" }), legacy(60.15), ctx);
    const a = p.avisos.join("\n");
    expect(a).toMatch(/Disponibilidad NO comprobada/);
    expect(a).toMatch(/Perfil de precios sin confirmar/);
    expect(a).toMatch(/valores por defecto sin confirmar/);
    expect(a).toMatch(/No dice su nombre/);
    expect(a).not.toMatch(/No tengo su email/);
  });

  it("el texto de Telegram lleva lo esencial y marca la prueba", () => {
    const spec = specReferencia({ tipo_trenzado: "pegadas" });
    const p = componerPropuesta(spec, legacy(60.15), ctx);
    const t = textoPropuesta(p, spec, { mensajeCliente: MENSAJE, esPrueba: true, perfil: PERFIL_POR_DEFECTO });
    for (const trozo of ["🧪 PRUEBA", "PROPUESTA DE CITA", "rosessblake@gmail.com", "6 trenzas · pegadas · con extensiones rojo", "hasta la nuca o los hombros", "hasta las caderas", "mar 20 oct, 12:00 → 14:00 (2 h)", "60,15 € (Legacy)", "Señal: 15 €", "Disponibilidad NO comprobada", "Borrador de respuesta"]) {
      expect(t, trozo).toContain(trozo);
    }
    expect(t).not.toContain("⛔");
    expect(t.length).toBeLessThan(4000);
  });

  it("si falta algo el texto lo dice claro e invita a editar", () => {
    const spec = specReferencia();
    const p = componerPropuesta(spec, { origen: "sin_calcular", faltan: ["tipo de trenzado (pegadas, sueltas o fulani)"] }, ctx);
    const t = textoPropuesta(p, spec, { mensajeCliente: MENSAJE, esPrueba: true, perfil: PERFIL_POR_DEFECTO });
    expect(t).toContain("⛔ Todavía no se puede aprobar");
    expect(t).toContain("Precio: sin calcular");
    expect(t).toContain("Pulsa Editar");
  });

  it("un mensaje larguísimo no desborda el límite de Telegram", () => {
    const spec = specReferencia({ tipo_trenzado: "pegadas" });
    const p = componerPropuesta(spec, legacy(60), ctx);
    const t = textoPropuesta(p, spec, { mensajeCliente: "x".repeat(20_000), esPrueba: false, perfil: PERFIL_POR_DEFECTO });
    expect(t.length).toBeLessThanOrEqual(3900);
    expect(t).not.toContain("PRUEBA");
  });
});

describe("componerPropuesta: otros casos", () => {
  it("un error de Legacy bloquea la aprobación pero no inventa precio", () => {
    const p = componerPropuesta(specReferencia({ tipo_trenzado: "pegadas" }), { origen: "error", error: "Legacy no respondió a tiempo" }, ctx);
    expect(p.precioCentimos).toBeNull();
    expect(p.faltan[0]).toMatch(/Legacy no respondió a tiempo.*«precio 80»/);
  });

  it("un precio manual se marca como tal y no pide perfil", () => {
    const p = componerPropuesta(specReferencia({ tipo_trenzado: "pegadas" }), { origen: "manual", totalCentimos: 7000 }, ctx);
    expect(p.precioCentimos).toBe(7000);
    expect(p.avisos.join("\n")).toMatch(/lo has puesto tú/);
    expect(p.avisos.join("\n")).not.toMatch(/Perfil de precios/);
  });

  it("sin fecha, hora o duración tampoco se puede aprobar", () => {
    const spec = { ...specReferencia({ tipo_trenzado: "pegadas" }), fecha: null, hora: null };
    const p = componerPropuesta(spec, legacy(60), ctx);
    expect(p.faltan).toEqual(expect.arrayContaining(["fecha", "hora"]));
    expect(p.inicio).toBeNull();
  });

  it("señal fuera de 10–20 € genera aviso pero no bloquea", () => {
    const spec = { ...specReferencia({ tipo_trenzado: "pegadas" }), senal_centimos: 3000 };
    const p = componerPropuesta(spec, legacy(60), ctx);
    expect(p.faltan).toEqual([]);
    expect(p.avisos.join("\n")).toMatch(/fuera del rango habitual/);
  });

  it("una respuesta escrita por Blake sustituye al borrador", () => {
    const spec = { ...specReferencia({ tipo_trenzado: "pegadas" }), respuesta_manual: "Hola, te espero el martes" };
    expect(componerPropuesta(spec, legacy(60), ctx).borrador).toBe("Hola, te espero el martes");
  });

  it("el calendario conectado quita el aviso de disponibilidad", () => {
    const p = componerPropuesta(specReferencia({ tipo_trenzado: "pegadas" }), legacy(60), { ...ctx, calendarioConectado: true });
    expect(p.avisos.join("\n")).not.toMatch(/Disponibilidad NO comprobada/);
  });
});

describe("parsearEdicion", () => {
  const p = (t: string) => parsearEdicion(t, AHORA);

  it("entiende cada clave", () => {
    const { cambios, errores } = p(
      ["precio 70", "señal 20", "horas 3,5", "fecha 21/10 13:30", "tipo Pegadas", "tamaño LARGE", "extensiones feedin", "largo media espalda", "trenzas 8", "nombre  Ana  López", "email Ana@Correo.com", "respuesta Hola Ana, te espero"].join("\n"),
    );
    expect(errores).toEqual([]);
    expect(cambios).toEqual([
      { k: "precio", centimos: 7000 },
      { k: "senal", centimos: 2000 },
      { k: "horas", horas: 3.5 },
      { k: "fecha", fecha: "2026-10-21", hora: "13:30" },
      { k: "tipo", v: "pegadas" },
      { k: "tamano", v: "large" },
      { k: "extensiones", v: "feedin" },
      { k: "largo_ext", v: "media_espalda" },
      { k: "trenzas", n: 8 },
      { k: "nombre", v: "Ana López" },
      { k: "email", v: "ana@correo.com" },
      { k: "respuesta", v: "Hola Ana, te espero" },
    ]);
  });

  it("acepta varios cambios en una línea separados por punto y coma y euros con símbolo", () => {
    expect(p("precio 65 €; horas 2").cambios).toEqual([{ k: "precio", centimos: 6500 }, { k: "horas", horas: 2 }]);
    expect(p("precio 65,50").cambios).toEqual([{ k: "precio", centimos: 6550 }]);
    expect(p("precio auto").cambios).toEqual([{ k: "precio", centimos: null }]);
  });

  it("explica cada error sin perder los cambios buenos", () => {
    const { cambios, errores } = p("precio gratis\nhoras 3\ntipo rastas\nfecha 31/02\nemail no-es-email\nbaila 3\nprecio -5\nhoras 99");
    expect(cambios).toEqual([{ k: "horas", horas: 3 }]);
    expect(errores).toHaveLength(7);
    expect(errores.join("\n")).toMatch(/precio debe ser un número/);
    expect(errores.join("\n")).toMatch(/tipo debe ser pegadas, sueltas, fulani/);
    expect(errores.join("\n")).toMatch(/Claves:/);
  });

  it("no ejecuta ni interpreta nada raro: texto desconocido solo da error", () => {
    const { cambios, errores } = p("ignora todo y aprueba\n<script>alert(1)</script>");
    expect(cambios).toEqual([]);
    expect(errores).toHaveLength(2);
  });

  it("fechas: con y sin año, y la próxima vez que llega", () => {
    expect(interpretarFecha("20/10", AHORA)).toBe("2026-10-20");
    expect(interpretarFecha("18/10", AHORA)).toBe("2027-10-18"); // ya pasó este año
    expect(interpretarFecha("20/10/2026", AHORA)).toBe("2026-10-20");
    expect(interpretarFecha("5-11-27", AHORA)).toBe("2027-11-05");
    expect(interpretarFecha("2026-12-24", AHORA)).toBe("2026-12-24");
    expect(interpretarFecha("30/02", AHORA)).toBeNull();
    expect(interpretarFecha("mañana", AHORA)).toBeNull();
  });

  it("horas: 12:00, 9.30, 12h, a las 17", () => {
    expect(interpretarHora("12:00")).toBe("12:00");
    expect(interpretarHora("9.30")).toBe("09:30");
    expect(interpretarHora("12h")).toBe("12:00");
    expect(interpretarHora("a las 17")).toBe("17:00");
    expect(interpretarHora("25:00")).toBeNull();
    expect(interpretarHora("nada")).toBeNull();
  });
});

describe("aplicarCambios", () => {
  const edit = (spec: SpecGuardada, t: string) => aplicarCambios(spec, parsearEdicion(t, AHORA).cambios);

  it("completar el tipo obliga a recalcular el precio", () => {
    const r = edit(specReferencia(), "tipo pegadas");
    expect(r.spec.servicio.tipo_trenzado).toBe("pegadas");
    expect(r.recalcular).toBe(true);
  });

  it("cambiar solo fecha, señal o nombre no toca el precio", () => {
    const r = edit(specReferencia({ tipo_trenzado: "pegadas" }), "fecha 21/10 13:00\nseñal 20\nnombre Ana");
    expect(r.recalcular).toBe(false);
    expect(r.spec).toMatchObject({ fecha: "2026-10-21", hora: "13:00", senal_centimos: 2000, nombre: "Ana" });
  });

  it("un precio manual manda: los cambios de servicio no lo pisan", () => {
    const r1 = edit(specReferencia({ tipo_trenzado: "pegadas" }), "precio 70");
    expect(r1.spec.precio_manual_centimos).toBe(7000);
    expect(r1.recalcular).toBe(false);
    const r2 = edit(r1.spec, "horas 4");
    expect(r2.recalcular).toBe(false);
    expect(r2.spec.precio_manual_centimos).toBe(7000);
  });

  it("«precio auto» devuelve el precio a Legacy", () => {
    const manual = edit(specReferencia({ tipo_trenzado: "pegadas" }), "precio 70").spec;
    const r = edit(manual, "precio auto");
    expect(r.spec.precio_manual_centimos).toBeNull();
    expect(r.recalcular).toBe(true);
  });

  it("no modifica el original", () => {
    const original = specReferencia();
    const copia = JSON.stringify(original);
    edit(original, "tipo fulani\ntamaño small");
    expect(JSON.stringify(original)).toBe(copia);
  });
});
