import { describe, expect, it } from "vitest";
import { DIAS_FOTO_PELO, NO_CONOCIDA, crearFlujoClientas, datosDeReserva, normalizarInstagram, type ClientasDeps, type Ficha } from "../lib/clientas";
import type { Reserva } from "../lib/proposal-flow";

const reserva = (o: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) =>
  ({
    id: "r1", conversation_id: "c1", client_name: "Marta", client_email: "marta@correo.com", service_description: "6 flat twist", is_test: false,
    starts_at: "2026-10-24T10:00:00.000Z", spec: { nombre: "Marta", instagram: "Marta.Trenzas", ubicacion: "espana", ...spec }, ...o,
  }) as unknown as Reserva;

function montar(f: Ficha | null = null, peloGuardado = true) {
  const llamadas: string[] = [];
  const msgs: string[] = [];
  const deps: ClientasDeps = {
    now: () => new Date("2026-10-21T10:00:00Z"),
    async guardarSolicitud(d) { llamadas.push(`solicitud:${d.instagram}:${d.nombre}:${d.email}`); },
    async sumarCita(d, fecha) { llamadas.push(`cita:${d.instagram}:${fecha?.toISOString()}`); },
    async buscar(ig) { return f && f.instagram === ig ? f : null; },
    async borrar(ig) { llamadas.push(`borrar:${ig}`); return Boolean(f); },
    async hayFotoPelo(_ig, desde) { llamadas.push(`pelo:${desde.toISOString()}`); return peloGuardado; },
    async enviar(_c, t) { msgs.push(t); },
    async logEvent(e) { llamadas.push(`log:${e.kind}`); },
  };
  return { port: crearFlujoClientas(deps), llamadas, msgs };
}

const FICHA: Ficha = {
  id: "f1", instagram: "marta.trenzas", nombre: "Marta", email: "marta@correo.com", ubicacion: "espana", created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z", ultima_solicitud_at: null, ultima_cita_at: "2026-10-05T10:00:00Z", citas_confirmadas: 2, ultimo_servicio: "6 flat twist",
};

describe("datos de la ficha desde una reserva", () => {
  it("usuario en minúsculas, nombre y email validados", () => {
    expect(datosDeReserva(reserva())).toMatchObject({ instagram: "marta.trenzas", nombre: "Marta", email: "marta@correo.com", ubicacion: "espana" });
  });
  it("sin Instagram válido no hay ficha (no se puede reconocer)", () => {
    expect(datosDeReserva(reserva({}, { instagram: null }))).toBeNull();
    expect(datosDeReserva(reserva({}, { instagram: "no válido!" }))).toBeNull();
  });
  it("email malo → null; «Cliente sin nombre» → null", () => {
    const d = datosDeReserva(reserva({ client_email: "no-es-email", client_name: "Cliente sin nombre" }, { nombre: null, email: null }));
    expect(d).toMatchObject({ email: null, nombre: null });
  });
  it("normalizarInstagram", () => {
    expect(normalizarInstagram(" @Marta_X ")).toBe("marta_x");
    expect(normalizarInstagram("hola que tal")).toBeNull();
  });
});

describe("guardar y recordar", () => {
  it("al aprobar y al confirmar la cita se anota; las pruebas no cuentan", async () => {
    const m = montar();
    await m.port.alAprobar(reserva());
    await m.port.alConfirmarCita(reserva());
    await m.port.alAprobar(reserva({ is_test: true }));
    expect(m.llamadas).toEqual(["solicitud:marta.trenzas:Marta:marta@correo.com", "cita:marta.trenzas:2026-10-24T10:00:00.000Z"]);
  });
  it("un fallo al guardar no rompe nada (se anota)", async () => {
    const m = montar();
    const port = crearFlujoClientas({ ...({} as ClientasDeps), now: () => new Date(), guardarSolicitud: async () => { throw new Error("db"); }, logEvent: async (e) => void m.llamadas.push(e.kind) } as ClientasDeps);
    await expect(port.alAprobar(reserva())).resolves.toBeUndefined();
    expect(m.llamadas).toContain("ficha_fallo");
  });
});

describe("conocer (lo que recibe ManyChat)", () => {
  it("clienta conocida: solo datos básicos, todo texto, con la foto del pelo si es reciente", async () => {
    const m = montar(FICHA, true);
    const r = await m.port.conocer("@Marta.Trenzas");
    expect(r).toEqual({ conocida: "si", saludo: "¡Hola, Marta! 🖤 Qué ganas de verte otra vez. Hace 2 semanas te hice 6 flat twist, ¿qué tal te quedó? ¿Eres tú?", nombre: "Marta", email: "marta@correo.com", pais: "España", citas: "2", ultimo_servicio: "6 flat twist", pelo_guardado: "si" });
    expect(m.llamadas.find((l) => l.startsWith("pelo:"))).toBe(`pelo:${new Date(Date.parse("2026-10-21T10:00:00Z") - DIAS_FOTO_PELO * 86_400_000).toISOString()}`);
  });
  it("pelo_guardado «no» si la foto es antigua", async () => {
    expect((await montar(FICHA, false).port.conocer("marta.trenzas")).pelo_guardado).toBe("no");
  });
  it("desconocida o usuario inválido: «no» y todo vacío", async () => {
    expect(await montar(null).port.conocer("otra.persona")).toEqual(NO_CONOCIDA);
    expect(await montar(FICHA).port.conocer("???")).toEqual(NO_CONOCIDA);
  });
  it("nunca devuelve precios ni fotos: solo las 7 claves previstas", async () => {
    expect(Object.keys(await montar(FICHA).port.conocer("marta.trenzas")).sort()).toEqual(["citas", "conocida", "email", "nombre", "pais", "pelo_guardado", "saludo", "ultimo_servicio"]);
  });
});

describe("/ficha y /borrarficha", () => {
  it("ver y borrar", async () => {
    const m = montar(FICHA);
    await m.port.ver(1, "/ficha @marta.trenzas");
    expect(m.msgs[0]).toContain("Citas confirmadas: 2");
    await m.port.borrar(1, "/borrarficha @marta.trenzas");
    expect(m.msgs[1]).toContain("borrada");
    expect(m.llamadas).toContain("log:ficha_borrada");
    await m.port.ver(1, "/ficha");
    expect(m.msgs[2]).toContain("Dime de quién");
  });
});

describe("saludo", () => {
  const ahora = new Date("2026-10-21T10:00:00Z");
  const f = (o: Partial<Ficha> = {}): Ficha => ({ ...FICHA, ...o });
  it("sin cita confirmada o con descripción larga antigua, no menciona el servicio", async () => {
    const { saludoParaClienta } = await import("../lib/clientas");
    expect(saludoParaClienta(f({ citas_confirmadas: 0 }), ahora)).toBe("¡Hola, Marta! 🖤 Qué ganas de verte otra vez. Te reconozco de otras veces. ¿Eres tú?");
    expect(saludoParaClienta(f({ ultimo_servicio: "6 trenzas · pegadas · con extensiones rojo" }), ahora)).toContain("Te reconozco de otras veces");
  });
  it("calcula «hace N semanas / meses» y «la última vez»", async () => {
    const { saludoParaClienta } = await import("../lib/clientas");
    expect(saludoParaClienta(f({ ultima_cita_at: "2026-10-18T10:00:00Z" }), ahora)).toContain("La última vez te hice 6 flat twist");
    expect(saludoParaClienta(f({ ultima_cita_at: "2026-07-21T10:00:00Z" }), ahora)).toContain("Hace 3 meses te hice");
    expect(saludoParaClienta(f({ nombre: null }), ahora).startsWith("¡Hola! 🖤")).toBe(true);
  });
});
