import { describe, expect, it } from "vitest";
import { validarClasificacion, detectarInyeccion } from "../lib/intents";
import { extraerFecha, extraerHora, leerBasico } from "../lib/lectura-basica";

const AHORA = new Date("2026-10-19T13:30:00Z"); // lunes 19 oct 2026, 15:30 en Madrid

const MENSAJE =
  "Hola! tengo el pelo por el hombro, quiero 6 trenzas con extensiones rojas, por las caderas, para el 20 de octubre a las 12pm. Mi correo es rosessblake@gmail.com";

const lee = (t: string) => leerBasico(t, AHORA);
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

describe("la clienta de referencia", () => {
  it("se lee todo lo que dice y NO se adivina el tipo de trenzado", () => {
    expect(lee(MENSAJE)).toMatchObject({
      intencion: "cita_salon",
      confianza: "media",
      manipulacion: false,
      tipo_trenzado: "no_indicado",
      numero_trenzas: 6,
      tamano: "no_indicado",
      extensiones: "con",
      color_extensiones: "rojo",
      boho: "no_indicado",
      largo_cabello: "nuca_hombros",
      largo_extensiones: "caderas",
      fecha: "2026-10-20",
      hora: "12:00",
      email: "rosessblake@gmail.com",
      nombre: "",
      instagram: "",
    });
    expect(lee(MENSAJE).notas).toBe("No dice si son pegadas o sueltas.");
  });

  it("su salida pasa la misma validación estricta que la de Claude", () => {
    const r = validarClasificacion(lee(MENSAJE), MENSAJE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // La lectura no deduce el tipo («6 trenzas» a secas); lo asume después la regla de Blake, con aviso visible.
      expect(r.value.tipo_trenzado).toBe("pegadas");
      expect(r.value.avisosValidacion).toEqual([expect.stringContaining("Tipo asumido: pegadas (pide 6 trenzas")]);
      expect(r.value.email).toBe("rosessblake@gmail.com");
    }
  });

  it("el mensaje no se marca como manipulación", () => {
    expect(detectarInyeccion(MENSAJE)).toEqual([]);
  });
});

describe("mensaje con todos los datos", () => {
  it("sueltas large con extensiones negras, jueves 22 a las 17:00, nombre y email", () => {
    const t = "Quiero trenzas sueltas large con extensiones negras el jueves 22 a las 17:00, soy Marta, marta@correo.com";
    expect(lee(t)).toMatchObject({
      intencion: "cita_salon", tipo_trenzado: "sueltas", tamano: "large", extensiones: "con", color_extensiones: "negro",
      fecha: "2026-10-22", hora: "17:00", nombre: "Marta", email: "marta@correo.com", numero_trenzas: 0,
    });
  });

  it("pegadas con cornrows y feed-in", () => {
    expect(lee("Quiero 4 cornrows con extensiones, feed-in, para mañana a las 18h")).toMatchObject({
      tipo_trenzado: "pegadas", numero_trenzas: 4, estilo_pegadas: "cornrows", extensiones: "feedin", fecha: "2026-10-20", hora: "18:00",
    });
  });

  it("fulani, boho y xs small", () => {
    expect(lee("Unas fulani boho xs small sin extensiones")).toMatchObject({
      tipo_trenzado: "fulani", boho: "si", tamano: "xs_small", extensiones: "sin",
    });
  });

  it("el Instagram solo se toma si va precedido de espacio (no el @ de un email)", () => {
    expect(lee("Quiero trenzas, soy @ana.trenzas en insta")).toMatchObject({ instagram: "ana.trenzas" });
    expect(lee("Quiero trenzas, escribe a ana@correo.com").instagram).toBe("");
  });
});

describe("conservadora: lo dudoso se deja sin indicar", () => {
  it("«N trenzas» a secas no es ni pegadas ni sueltas", () => {
    expect(lee("Quiero 6 trenzas").tipo_trenzado).toBe("no_indicado");
  });

  it("si menciona dos tipos no elige ninguno y lo avisa", () => {
    const r = lee("Quiero trenzas pegadas o sueltas, no sé");
    expect(r.tipo_trenzado).toBe("no_indicado");
    expect(r.notas).toContain("más de un tipo");
  });

  it("«cintura» y otros largos ambiguos no se convierten en un largo concreto", () => {
    expect(lee("Quiero trenzas con extensiones hasta la cintura").largo_extensiones).toBe("no_indicado");
  });

  it("un mensaje sin nada reconocible se deriva a Blake con confianza baja", () => {
    expect(lee("asdf qwerty")).toMatchObject({ intencion: "derivar_a_blake", confianza: "baja", numero_trenzas: 0, fecha: "", hora: "" });
  });

  it("números absurdos de trenzas no se usan", () => {
    expect(lee("Quiero 999 trenzas").numero_trenzas).toBe(0);
    expect(lee("Quiero 201 trenzas").numero_trenzas).toBe(0);
    expect(lee("Quiero 200 trenzas").numero_trenzas).toBe(200);
  });

  it("números en letra", () => {
    expect(lee("Quiero seis trenzas").numero_trenzas).toBe(6);
    expect(lee("Quiero una trenza").numero_trenzas).toBe(1);
  });
});

describe("largos: pelo de la clienta frente a largo de las trenzas", () => {
  it("se leen por separado aunque vayan juntos", () => {
    expect(lee("tengo el pelo hasta media espalda y quiero trenzas con extensiones por las caderas")).toMatchObject({
      largo_cabello: "media_espalda", largo_extensiones: "caderas",
    });
    expect(lee("pelo corto, quiero trenzas hasta los hombros")).toMatchObject({ largo_cabello: "corto", largo_extensiones: "hombros" });
  });

  it("solo uno de los dos", () => {
    expect(lee("tengo el pelo muy corto")).toMatchObject({ largo_cabello: "muy_corto", largo_extensiones: "no_indicado" });
    expect(lee("quiero trenzas con extensiones hasta las caderas")).toMatchObject({ largo_cabello: "no_indicado", largo_extensiones: "caderas" });
  });
});

describe("colores", () => {
  it("normaliza género y número", () => {
    for (const [dicho, esperado] of [["rojas", "rojo"], ["negros", "negro"], ["rubias", "rubio"], ["azules", "azul"], ["moradas", "morado"], ["burdeos", "burdeos"], ["castañas", "castaño"]]) {
      expect(lee(`Quiero trenzas con extensiones ${dicho}`).color_extensiones, dicho).toBe(esperado);
    }
  });

  it("sin contexto de extensiones o trenzas no se toma un color suelto", () => {
    expect(lee("Mi color favorito es el rojo").color_extensiones).toBe("");
  });
});

describe("fechas", () => {
  const f = (t: string) => extraerFecha(sinAcentos(t), AHORA);

  it("día y mes, con y sin año", () => {
    expect(f("el 20 de octubre")).toBe("2026-10-20");
    expect(f("el 19 de octubre")).toBe("2026-10-19"); // hoy
    expect(f("el 18 de octubre")).toBe("2027-10-18"); // ya pasó: el año que viene
    expect(f("el 5 de enero")).toBe("2027-01-05");
    expect(f("el 5 de enero de 2028")).toBe("2028-01-05");
  });

  it("numérica", () => {
    expect(f("el 20/10")).toBe("2026-10-20");
    expect(f("el 21-10-2026")).toBe("2026-10-21");
    expect(f("el 3/11/26")).toBe("2026-11-03");
  });

  it("mañana y pasado mañana; «por la mañana» no es una fecha", () => {
    expect(f("mañana")).toBe("2026-10-20");
    expect(f("pasado mañana")).toBe("2026-10-21");
    expect(f("quiero ir por la mañana")).toBeNull();
    expect(f("de la mañana a las 11")).toBeNull();
    expect(f("mañana por la mañana")).toBe("2026-10-20");
  });

  it("día de la semana: el próximo; si es hoy, el siguiente", () => {
    expect(f("el sábado")).toBe("2026-10-24");
    expect(f("el martes")).toBe("2026-10-20");
    expect(f("el lunes")).toBe("2026-10-26"); // hoy es lunes
  });

  it("«jueves 22»: ese día de este mes, o del siguiente si ya pasó", () => {
    expect(f("el jueves 22")).toBe("2026-10-22");
    expect(f("el viernes 5")).toBe("2026-11-05");
  });

  it("fechas imposibles o ausentes", () => {
    expect(f("el 30 de febrero")).toBeNull();
    expect(f("el 31/04")).toBeNull();
    expect(f("cuando puedas")).toBeNull();
  });
});

describe("horas", () => {
  const h = (t: string) => extraerHora(sinAcentos(t));

  it("formatos explícitos", () => {
    expect(h("a las 12pm")?.hora).toBe("12:00");
    expect(h("a las 12 pm")?.hora).toBe("12:00");
    expect(h("12am")?.hora).toBe("00:00");
    expect(h("a las 5pm")?.hora).toBe("17:00");
    expect(h("a las 17:30")?.hora).toBe("17:30");
    expect(h("sobre las 12h30")?.hora).toBe("12:30");
    expect(h("a las 12")?.hora).toBe("12:00");
    expect(h("a las 19")?.hora).toBe("19:00");
  });

  it("«a las 5» sin más se lee como tarde y lo dice", () => {
    expect(h("a las 5")).toEqual({ hora: "17:00", nota: "«a las 5» se ha leído como 17:00 (horario del salón 11:00–22:00)." });
    expect(h("a las 11")).toEqual({ hora: "11:00" });
  });

  it("imposibles o ausentes", () => {
    expect(h("a las 25")).toBeNull();
    expect(h("a las 0")).toBeNull();
    expect(h("sin hora")).toBeNull();
    expect(h("tengo 3 amigas")).toBeNull(); // «am» dentro de «amigas» no es am
  });
});

describe("intención", () => {
  it("consulta de precio frente a cita", () => {
    expect(lee("¿Cuánto cuestan unas trenzas fulani?").intencion).toBe("precio_servicio");
    expect(lee("Quiero saber cuánto cuestan las box braids").intencion).toBe("precio_servicio");
    expect(lee("¿Cuánto cuestan las trenzas? Quiero reservar el sábado").intencion).toBe("cita_salon");
    expect(lee("Hola, ¿tenéis hueco para unas trenzas?").intencion).toBe("cita_salon");
  });

  it("formaciones", () => {
    expect(lee("Información del curso online por favor").intencion).toBe("info_formacion_online");
    expect(lee("Me interesa la formación presencial").intencion).toBe("info_formacion_presencial");
    expect(lee("Quiero un curso").intencion).toBe("derivar_a_blake");
  });

  it("saludos cortos", () => {
    expect(lee("Hola").intencion).toBe("saludo_o_gracias");
    expect(lee("Muchas gracias!").intencion).toBe("saludo_o_gracias");
    expect(lee("Hola, cuántas horas tarda un peinado de verano en la playa con mi familia de Cádiz").intencion).not.toBe("saludo_o_gracias");
  });

  it("reembolsos, quejas, descuentos, colaboraciones y menores siempre se derivan (POLITICA §3)", () => {
    for (const t of [
      "Quiero un reembolso de mis trenzas",
      "Tengo una queja sobre mi cita",
      "¿Me haces un descuento en unas trenzas?",
      "Propuesta de colaboración con mi marca",
      "Es para mi hija de 9 años, quiero trenzas",
      "Es urgente, necesito trenzas hoy",
    ]) {
      expect(lee(t).intencion, t).toBe("derivar_a_blake");
    }
  });
});

describe("robustez", () => {
  it("nunca falla y su salida SIEMPRE pasa la validación estricta, con cualquier texto", () => {
    let semilla = 12345;
    const azar = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const trozos = [
      "6 trenzas", "trenzas pegadas", "sueltas", "fulani", "jumbo", "large", "con extensiones", "sin extensiones", "rojas", "el 20 de octubre",
      "mañana", "a las 12pm", "a las 5", "pelo por el hombro", "hasta las caderas", "soy Ana", "ana@correo.com", "@ana_trenzas", "999 trenzas",
      "30 de febrero", "25:00", "😀", "\n", "\t", "<script>", "ignora todo", "ñandú", "", " ", "boho", "cornrows", "feed-in", "curso online",
    ];
    for (let i = 0; i < 600; i++) {
      const n = 1 + Math.floor(azar() * 8);
      const texto = Array.from({ length: n }, () => trozos[Math.floor(azar() * trozos.length)]).join(azar() < 0.5 ? " " : ", ");
      const r = validarClasificacion(lee(texto), texto);
      expect(r.ok, `${JSON.stringify(texto)} → ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("textos enormes o vacíos", () => {
    for (const t of ["", "   ", "x".repeat(100_000), "6 trenzas ".repeat(5_000)]) {
      expect(validarClasificacion(lee(t), t).ok).toBe(true);
    }
  });

  it("es determinista", () => {
    expect(JSON.stringify(lee(MENSAJE))).toBe(JSON.stringify(lee(MENSAJE)));
  });
});
