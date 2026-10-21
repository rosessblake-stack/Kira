import { describe, expect, it } from "vitest";
import { DIAS_LIBRES, avisosDeHorario, duracionLegible, esDiaLibre, fechaLarga, horasTexto, listaDiasLibres, madridAUtc, nombreDia, partesMadrid } from "../lib/agenda";
import { validarClasificacion } from "../lib/intents";
import { PERFIL_POR_DEFECTO, type PrecioLegacy } from "../lib/pricing";
import {
  aplicarCambios,
  componerPropuesta,
  ejemploDeEdicion,
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

  it("domingo y lunes son días libres: la cita en esos días avisa (blando) y el resto no", () => {
    expect(en("2026-10-25", "12:00", 120)[0]).toBe("La cita cae en domingo, que es día libre (no trabajas: domingo y lunes).");
    expect(en("2026-10-26", "12:00", 120)[0]).toMatch(/cae en lunes, que es día libre/);
    for (const f of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) expect(en(f, "12:00", 120)).toEqual([]); // mar a sáb
  });

  it("el día libre se mira en hora de Madrid, no en UTC", () => {
    // lunes 26 oct 00:30 en Madrid = domingo 25 oct 23:30 en UTC: sigue siendo lunes para Blake
    expect(esDiaLibre(madridAUtc("2026-10-26", "00:30"))).toBe(true);
    // martes 27 oct 00:30 en Madrid (lunes 26 por la noche en UTC) ya es martes
    expect(esDiaLibre(madridAUtc("2026-10-27", "00:30"))).toBe(false);
  });

  it("los días libres son los que dijo Blake", () => {
    expect([...DIAS_LIBRES]).toEqual([0, 1]);
    expect(listaDiasLibres()).toBe("domingo y lunes");
    expect([0, 1, 2, 3, 4, 5, 6].map(nombreDia)).toEqual(["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]);
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
    expect(p.horasUsadas).toBe(3); // 6 trenzas pegadas con extensiones: 3 h (dato real de Blake)
    expect(p.duracionMinutos).toBe(180);
    expect(p.inicio!.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(p.fin!.toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(p.descripcion).toBe("6 trenzas · pegadas · con extensiones rojo");
    expect(p.borrador).toContain("Para 6 trenzas pegadas con extensiones (rojo), el precio es de 60,15 € y dura aproximadamente 3 h.");
    expect(p.borrador).toContain("mar 20 oct, 12:00");
    expect(p.borrador).toContain("señal de 20 €"); // la paga y señal de Blake
  });

  it("avisa de todo lo provisional: calendario, perfil (si no está confirmado) y horas sugeridas", () => {
    const p = componerPropuesta(specReferencia({ tipo_trenzado: "pegadas" }), legacy(60.15), { ...ctx, perfil: { ...PERFIL_POR_DEFECTO, confirmado: false } });
    const a = p.avisos.join("\n");
    expect(a).toMatch(/Disponibilidad NO comprobada/);
    expect(a).toMatch(/Perfil de precios sin confirmar/);
    expect(a).toMatch(/son una sugerencia: ajústalas con «horas 3»/);
    expect(a).toMatch(/No dice su nombre/);
    expect(a).not.toMatch(/No tengo su email/);
  });

  it("con el perfil confirmado de Blake no avisa de perfil sin confirmar; las horas y materiales siguen avisando como sugerencia", () => {
    const a = componerPropuesta(specReferencia({ tipo_trenzado: "pegadas" }), legacy(60.15), ctx).avisos.join("\n");
    expect(a).not.toMatch(/Perfil de precios sin confirmar/);
    expect(a).toMatch(/son una sugerencia: ajústalas con «horas 3»/);
  });

  it("el texto de Telegram lleva lo esencial y marca la prueba", () => {
    const spec = specReferencia({ tipo_trenzado: "pegadas" });
    const p = componerPropuesta(spec, legacy(60.15), ctx);
    const t = textoPropuesta(p, spec, { mensajeCliente: MENSAJE, esPrueba: true, perfil: PERFIL_POR_DEFECTO });
    for (const trozo of ["🧪 PRUEBA", "PROPUESTA DE CITA", "rosessblake@gmail.com", "6 trenzas · pegadas · con extensiones rojo", "hasta la nuca o los hombros", "hasta las caderas", "mar 20 oct, 12:00 → 15:00 (3 h)", "60,15 € (Legacy)", "Señal: 20 €", "Disponibilidad NO comprobada", "Borrador de respuesta"]) {
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

  it("sin nombre se dice «sin nombre», no «Cliente sin nombre»", () => {
    const spec = specReferencia({ tipo_trenzado: "pegadas" });
    const t = textoPropuesta(componerPropuesta(spec, legacy(60), ctx), spec, { mensajeCliente: MENSAJE, esPrueba: false, perfil: PERFIL_POR_DEFECTO });
    expect(t).toContain("Cliente: sin nombre (rosessblake@gmail.com)");
    expect(t).not.toContain("Cliente sin nombre");
  });

  it("el ejemplo de edición corresponde a lo que falta", () => {
    expect(ejemploDeEdicion(["precio: falta tipo de trenzado (pegadas, sueltas o fulani)"])).toBe("tipo pegadas");
    expect(ejemploDeEdicion(["precio: falta tamaño de las trenzas (jumbo, large, medium, small…)"])).toBe("tamaño large");
    expect(ejemploDeEdicion(["precio: falta si lleva extensiones"])).toBe("extensiones con");
    expect(ejemploDeEdicion(["precio (Legacy respondió 503; puedes ponerlo tú con «precio 80»)"])).toBe("precio 80");
    expect(ejemploDeEdicion(["fecha", "hora"])).toBe("fecha 20/10 12:00");
    expect(ejemploDeEdicion(["hora"])).toBe("hora 12:00");
    expect(ejemploDeEdicion(["duración (horas)"])).toBe("horas 3");
    const spec = specReferencia({ tipo_trenzado: "pegadas" });
    const p = componerPropuesta(spec, { origen: "error", error: "Legacy respondió 503" }, ctx);
    expect(textoPropuesta(p, spec, { mensajeCliente: MENSAJE, esPrueba: true, perfil: PERFIL_POR_DEFECTO })).toContain("por ejemplo: precio 80");
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
    expect(errores.join("\n")).toMatch(/el precio debe ser un importe/);
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

describe("fotos en la propuesta", () => {
  const spec = () => specReferencia({ tipo_trenzado: "pegadas" });
  const completa = (fotos?: { tipo: "pelo" | "referencia" | "otra"; descripcion: string | null }[]) =>
    componerPropuesta(spec(), legacy(60.15), { ...ctx, fotos });
  const texto = (fotos?: { tipo: "pelo" | "referencia" | "otra"; descripcion: string | null }[]) =>
    textoPropuesta(completa(fotos), spec(), { mensajeCliente: MENSAJE, esPrueba: true, perfil: PERFIL_POR_DEFECTO, fotos });

  it("sin fotos: avisa de las dos que faltan, pero no bloquea la aprobación (decide Blake)", () => {
    const p = completa([]);
    expect(p.avisos).toContain("Falta la foto del pelo de la clienta.");
    expect(p.avisos).toContain("Falta la foto de las trenzas de referencia.");
    expect(p.faltan).toEqual([]);
    const t = texto([]);
    expect(t).toContain("📷 Fotos");
    expect(t).toContain("• Pelo de la clienta: sin foto");
    expect(t).toContain("• Trenzas de referencia: sin foto");
  });

  it("con las dos fotos descritas: sin avisos de fotos y con lo que dijo Blake", () => {
    const fotos = [
      { tipo: "pelo" as const, descripcion: "rizado, fino, a los hombros" },
      { tipo: "referencia" as const, descripcion: "boxeadoras hasta la cadera" },
    ];
    expect(completa(fotos).avisos.filter((a) => a.includes("foto"))).toEqual([]);
    const t = texto(fotos);
    expect(t).toContain("• Pelo de la clienta: «rizado, fino, a los hombros»");
    expect(t).toContain("• Trenzas de referencia: «boxeadoras hasta la cadera»");
  });

  it("foto sin describir y fotos «otra»", () => {
    const t = texto([{ tipo: "pelo", descripcion: null }, { tipo: "referencia", descripcion: null }, { tipo: "otra", descripcion: null }, { tipo: "otra", descripcion: "x" }]);
    expect(t).toContain("• Pelo de la clienta: foto sin describir");
    expect(t).toContain("• Otras fotos: 2");
  });

  it("si no se pasa información de fotos (no se pudo leer), ni sección ni avisos de fotos", () => {
    const p = completa(undefined);
    expect(p.avisos.some((a) => a.includes("foto"))).toBe(false);
    expect(texto(undefined)).not.toContain("📷 Fotos");
  });

  it("la descripción de Blake se pinta como texto (no se interpreta) y se recorta", () => {
    const t = texto([{ tipo: "pelo", descripcion: `<b>${"x".repeat(500)}</b>` }]);
    expect(t).toContain("<b>");
    expect(t.length).toBeLessThanOrEqual(3900);
  });
});

describe("parsearEdicion: descripciones de fotos", () => {
  const p = (t: string) => parsearEdicion(t, AHORA);

  it("«pelo …» y «referencia …» (con o sin dos puntos) describen la foto", () => {
    const { cambios, errores } = p("pelo rizado, fino, a los hombros\nreferencia: boxeadoras hasta la cadera");
    expect(errores).toEqual([]);
    expect(cambios).toEqual([
      { k: "foto_pelo", v: "rizado, fino, a los hombros" },
      { k: "foto_referencia", v: "boxeadoras hasta la cadera" },
    ]);
  });

  it("sin texto da un error con ejemplo", () => {
    const { cambios, errores } = p("pelo\nreferencia:");
    expect(cambios).toEqual([]);
    expect(errores).toHaveLength(2);
    expect(errores[0]).toContain("escribe lo que ves en la foto");
  });

  it("limpia caracteres de control y respeta el tope", () => {
    const { cambios } = p(`pelo ${"a".repeat(5000)}`);
    expect((cambios[0] as { v: string }).v.length).toBe(1000);
  });

  it("la clave con dos puntos funciona también para las demás («precio: 70»)", () => {
    expect(p("precio: 70").cambios).toEqual([{ k: "precio", centimos: 7000 }]);
  });

  it("«dirección …» (con o sin tilde y dos puntos) pone la dirección del evento y no pide recalcular el precio", () => {
    const p = (t: string) => parsearEdicion(t, AHORA);
    expect(p("dirección Calle 8 nº 1234, Miami").cambios).toEqual([{ k: "direccion", v: "Calle 8 nº 1234, Miami" }]);
    expect(p("direccion: Carrer de Mallorca 1").cambios).toEqual([{ k: "direccion", v: "Carrer de Mallorca 1" }]);
    expect(p("direccion").errores[0]).toContain("escribe la dirección");
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    const r = aplicarCambios(s, [{ k: "direccion", v: "Calle 8" }]);
    expect(r.spec.direccion).toBe("Calle 8");
    expect(r.recalcular).toBe(false);
    expect(s.direccion).toBe("Carrer de la Duquessa de la Victòria, 16"); // no modifica el original
  });

  it("no cambian el servicio ni el precio; la de la referencia queda como descripción del peinado (va al evento)", () => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    const r = aplicarCambios(s, [{ k: "foto_pelo", v: "rizado" }, { k: "foto_referencia", v: "boxeadoras" }]);
    expect(r.spec).toEqual({ ...s, descripcion_peinado: "boxeadoras" });
    expect(r.recalcular).toBe(false);
  });
});

describe("la descripción del peinado de Blake completa el servicio", () => {
  it("«6 flat twist pegadas…» fija nº y estilo si faltaban (el título del evento dirá «6 Flat Twist») y recalcula el precio", () => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    const r = aplicarCambios(s, [{ k: "foto_referencia", v: "6 flat twists pegadas cabello largo" }]);
    expect(r.spec.servicio).toMatchObject({ numero_trenzas: 6, estilo_pegadas: "twist", tipo_trenzado: "pegadas" });
    expect(r.recalcular).toBe(true);
  });
  it("no pisa lo que Blake ya fijó", () => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    s.servicio.numero_trenzas = 4;
    s.servicio.estilo_pegadas = "cornrows";
    const r = aplicarCambios(s, [{ k: "foto_referencia", v: "6 flat twists" }]);
    expect(r.spec.servicio).toMatchObject({ numero_trenzas: 4, estilo_pegadas: "cornrows" });
  });
});

describe("horas en español", () => {
  it("coma decimal: 3,5 y 3", () => {
    expect(horasTexto(3.5)).toBe("3,5");
    expect(horasTexto(3)).toBe("3");
    expect(horasTexto(0.5)).toBe("0,5");
  });
});

describe("edición: materiales, perfil de la cita y demás datos", () => {
  const p = (t: string) => parsearEdicion(t, AHORA);
  const edit = (spec: SpecGuardada, t: string) => aplicarCambios(spec, parsearEdicion(t, AHORA).cambios);

  it("materiales: importe con coma o punto, «auto» y límites", () => {
    expect(p("materiales 8").cambios).toEqual([{ k: "materiales", valor: 8 }]);
    expect(p("materiales 7,5 €").cambios).toEqual([{ k: "materiales", valor: 7.5 }]);
    expect(p("materiales 12.25").cambios).toEqual([{ k: "materiales", valor: 12.25 }]);
    expect(p("materiales 0").cambios).toEqual([{ k: "materiales", valor: 0 }]);
    expect(p("materiales auto").cambios).toEqual([{ k: "materiales", valor: null }]);
    expect(p("materiales mucho").errores).toHaveLength(1);
    expect(p("materiales 900").errores).toHaveLength(1);
    expect(p("materiales -3").errores).toHaveLength(1);
  });

  it("horas auto devuelve las de por defecto", () => {
    expect(p("horas auto").cambios).toEqual([{ k: "horas", horas: null }]);
    expect(edit(specReferencia({ tipo_trenzado: "pegadas" }), "horas 4").spec.horas).toBe(4);
    expect(edit({ ...specReferencia({ tipo_trenzado: "pegadas" }), horas: 4 }, "horas auto").spec.horas).toBeNull();
  });

  it("boho, estilo, largo del pelo, color e instagram", () => {
    expect(p("boho sí").cambios).toEqual([{ k: "boho", v: true }]);
    expect(p("boho no").cambios).toEqual([{ k: "boho", v: false }]);
    expect(p("boho quizás").errores).toHaveLength(1);
    expect(p("estilo barrel twist").cambios).toEqual([{ k: "estilo", v: "barrel_twist" }]);
    expect(p("estilo twist").cambios).toEqual([{ k: "estilo", v: "twist" }]);
    expect(p("estilo rizado").errores).toHaveLength(1);
    expect(p("largo pelo media espalda").cambios).toEqual([{ k: "largo_cabello", v: "media_espalda" }]);
    expect(p("largopelo caderas").cambios).toEqual([{ k: "largo_cabello", v: "caderas" }]);
    expect(p("largo pelo larguísimo").errores).toHaveLength(1);
    expect(p("largo caderas").cambios).toEqual([{ k: "largo_ext", v: "caderas" }]); // el de las trenzas sigue igual
    expect(p("color negro 1B").cambios).toEqual([{ k: "color", v: "negro 1B" }]);
    expect(p("color").errores).toHaveLength(1);
    expect(p("instagram @ana_trenzas").cambios).toEqual([{ k: "instagram", v: "ana_trenzas" }]);
    expect(p("instagram ana trenzas").errores).toHaveLength(1);
    expect(p("instagram https://instagram.com/x").errores).toHaveLength(1);
  });

  it("perfil de la cita: estructura, zona (normal = media), nivel y base", () => {
    expect(p("estructura salón").cambios).toEqual([{ k: "estructura", v: "salon" }]);
    expect(p("estructura casa").cambios).toEqual([{ k: "estructura", v: "casa" }]);
    expect(p("estructura garaje").errores).toHaveLength(1);
    expect(p("zona normal").cambios).toEqual([{ k: "zona", v: "media" }]);
    expect(p("zona premium").cambios).toEqual([{ k: "zona", v: "premium" }]);
    expect(p("zona lujo").errores).toHaveLength(1);
    expect(p("nivel élite").cambios).toEqual([{ k: "nivel", v: "elite" }]);
    expect(p("nivel dios").errores).toHaveLength(1);
    expect(p("base 1500").cambios).toEqual([{ k: "base", n: 1500 }]);
    expect(p("base 5").errores).toHaveLength(1);
    expect(p("base 99999").errores).toHaveLength(1);
  });

  it("los cambios de perfil no tocan el servicio y piden recalcular; los de color e instagram no", () => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    const r = edit(s, "estructura salon\nzona premium\nbase 1600");
    expect(r.perfil).toEqual({ estructura: "salon", zona: "premium", smi: 1600 });
    expect(r.spec.servicio).toEqual(s.servicio);
    expect(r.recalcular).toBe(true);
    const c = edit(s, "color rojo\ninstagram ana");
    expect(c.recalcular).toBe(false);
    expect(c.perfil).toEqual({});
    expect(c.spec).toMatchObject({ color_extensiones: "rojo", instagram: "ana" });
  });

  it("materiales pide recalcular salvo que el precio sea manual", () => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    expect(edit(s, "materiales 9").recalcular).toBe(true);
    expect(edit({ ...s, precio_manual_centimos: 7000 }, "materiales 9").recalcular).toBe(false);
    expect(edit(s, "materiales 9").spec.materiales).toBe(9);
  });

  it("no modifica el original", () => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    edit(s, "materiales 9\nboho si");
    expect(s.materiales ?? null).toBeNull();
    expect(s.servicio.boho).toBeNull();
  });
});

describe("editar entiende fechas y horas en palabras", () => {
  const ahora = new Date("2026-10-21T10:00:00Z");
  it("fecha y hora como las escribe Blake", () => {
    expect(parsearEdicion("fecha 22 octubre", ahora).cambios).toEqual([{ k: "fecha", fecha: "2026-10-22", hora: null }]);
    expect(parsearEdicion("fecha 22 de octubre a las 5 pm", ahora).cambios).toEqual([{ k: "fecha", fecha: "2026-10-22", hora: "17:00" }]);
    expect(parsearEdicion("hora 5 pm", ahora).cambios).toEqual([{ k: "hora", hora: "17:00" }]);
    expect(parsearEdicion("duración 3 horas", ahora).cambios).toEqual([{ k: "horas", horas: 3 }]);
    expect(parsearEdicion("fecha 25/10 12:00", ahora).cambios).toEqual([{ k: "fecha", fecha: "2026-10-25", hora: "12:00" }]);
  });
});

describe("flat twist, cornrows y barrel twist son trenzas pegadas", () => {
  const ahora = new Date("2026-10-21T10:00:00Z");
  it("«estilo flat twist» se entiende y deja el tipo en pegadas", () => {
    const { cambios } = parsearEdicion("estilo flat twist", ahora);
    expect(cambios).toEqual([{ k: "estilo", v: "twist" }]);
    const s = specReferencia({ tipo_trenzado: "sueltas" });
    expect(aplicarCambios(s, cambios).spec.servicio).toMatchObject({ tipo_trenzado: "pegadas", estilo_pegadas: "twist" });
    expect(parsearEdicion("estilo barrel twist", ahora).cambios).toEqual([{ k: "estilo", v: "barrel_twist" }]);
  });
});

describe("el mensaje a la clienta usa el nombre del estilo", () => {
  const ctx = { perfil: { ...PERFIL_POR_DEFECTO, confirmado: true }, ahora: AHORA } as never;
  const borrador = (estilo: "cornrows" | "twist" | "barrel_twist" | null) => {
    const s = specReferencia({ tipo_trenzado: "pegadas" });
    s.servicio.estilo_pegadas = estilo;
    s.servicio.numero_trenzas = 5;
    s.respuesta_manual = null;
    return componerPropuesta(s, { origen: "legacy", precio: { ok: true } } as never, ctx).borrador;
  };
  it("flat twist, cornrows y barrel twist en vez de «trenzas pegadas»", () => {
    expect(borrador("twist")).toContain("5 flat twist");
    expect(borrador("cornrows")).toContain("5 cornrows");
    expect(borrador("barrel_twist")).toContain("5 barrel twist");
    expect(borrador("twist")).not.toContain("pegadas");
  });
});
