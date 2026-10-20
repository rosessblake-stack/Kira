import { describe, expect, it } from "vitest";
import { crearAgendaGoogle, type DepsAgendaGoogle } from "../lib/google-agenda";
import { GoogleError, type FetchGoogle } from "../lib/google-oauth";
import { idDeEvento } from "../lib/google-calendar";

const BOOKING = "61dba233-632a-4ee4-b9b2-1a72a18895d2";
const EID = idDeEvento(BOOKING);

/** El error con el que acaba una promesa (la prueba falla si no falla). */
async function fallo(p: Promise<unknown>): Promise<GoogleError> {
  try {
    await p;
  } catch (e) {
    return e as GoogleError;
  }
  throw new Error("Se esperaba un error y no lo hubo");
}

type Resp = { status: number; json?: unknown };
function mundo(op: { config?: boolean; conexion?: "ok" | "nada" | "ilegible"; email?: string | null; respuestas?: Resp[]; calendarioForzado?: string | null } = {}) {
  const w = { llamadas: [] as { url: string; method: string; headers: Record<string, string>; body?: string }[], ahora: 1_000_000 };
  const respuestas = op.respuestas ?? [];
  const fetchImpl: FetchGoogle = async (url, init) => {
    w.llamadas.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: `acc-${w.llamadas.length}`, expires_in: 3599 }) };
    const r = respuestas.shift() ?? { status: 200, json: {} };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => (r.json === undefined ? "" : JSON.stringify(r.json)) };
  };
  const deps: DepsAgendaGoogle = {
    config: () => (op.config === false ? null : { clientId: "cid", clientSecret: "csec" }),
    async leerConexion() {
      if (op.conexion === "nada") return null;
      if (op.conexion === "ilegible") throw new GoogleError("La conexión guardada con Google ya no se puede leer", undefined, true);
      return { refreshToken: "refresh-1", email: op.email === undefined ? "info@blakebraider.com" : op.email, calendario: "primary", conectadoEn: null };
    },
    calendarioForzado: () => op.calendarioForzado ?? null,
    now: () => w.ahora,
    fetchImpl,
  };
  return { w, agenda: crearAgendaGoogle(deps) };
}

const MARCA = { status: 200, json: { id: EID, status: "confirmed", extendedProperties: { private: { kira_booking_id: BOOKING } } } };

describe("el calendario real: estado", () => {
  it("conectado cuando hay configuración y conexión; enseña la cuenta", async () => {
    expect(await mundo().agenda.estado()).toEqual({ conectado: true, cuenta: "info@blakebraider.com" });
  });
  it("sin configuración o sin conexión: no conectado (y no se lee la base si ni está configurado)", async () => {
    expect(await mundo({ config: false }).agenda.estado()).toEqual({ conectado: false, cuenta: null });
    expect(await mundo({ conexion: "nada" }).agenda.estado()).toEqual({ conectado: false, cuenta: null });
  });
  it("conexión guardada pero ILEGIBLE: lanza (NO es «sin conectar»: con eso se aprobaría sin mirar la agenda)", async () => {
    await expect(mundo({ conexion: "ilegible" }).agenda.estado()).rejects.toThrow("ya no se puede leer");
  });
});

describe("el calendario real: lo que necesita lanza si no está listo", () => {
  it("sin ID/secreto de cliente, sin conexión o con conexión ilegible, leer la agenda lanza un error que pide reconectar o configurar", async () => {
    const a = await fallo(mundo({ config: false }).agenda.eventosEntre(new Date(0), new Date(1)));
    expect(a.message).toContain("GOOGLE_CLIENT_ID");
    const b = await fallo(mundo({ conexion: "nada" }).agenda.eventosEntre(new Date(0), new Date(1)));
    expect(b.message).toContain("no está conectado");
    expect(b.desconectado).toBe(true);
    const c = await fallo(mundo({ conexion: "ilegible" }).agenda.eventosEntre(new Date(0), new Date(1)));
    expect(c.message).toContain("ya no se puede leer");
  });
});

describe("el calendario real: acceso y calendario", () => {
  it("usa el calendario guardado, o el de GOOGLE_CALENDAR_ID si está puesto", async () => {
    const a = mundo({ respuestas: [{ status: 200, json: { items: [] } }] });
    await a.agenda.eventosEntre(new Date(0), new Date(1));
    expect(a.w.llamadas.find((l) => l.url.includes("/calendars/"))!.url).toContain("/calendars/primary/events");
    const b = mundo({ calendarioForzado: "info@blakebraider.com", respuestas: [{ status: 200, json: { items: [] } }] });
    await b.agenda.eventosEntre(new Date(0), new Date(1));
    expect(b.w.llamadas.find((l) => l.url.includes("/calendars/"))!.url).toContain("/calendars/info%40blakebraider.com/events");
  });

  it("renueva el acceso una vez y lo reutiliza mientras valga; con 401 lo pide de nuevo", async () => {
    const m = mundo({ respuestas: [{ status: 200, json: { items: [] } }, { status: 200, json: { items: [] } }, { status: 401, json: {} }, { status: 200, json: { items: [] } }] });
    await m.agenda.eventosEntre(new Date(0), new Date(1));
    await m.agenda.eventosEntre(new Date(0), new Date(1));
    expect(m.w.llamadas.filter((l) => l.url.includes("oauth2")).length).toBe(1);
    await m.agenda.eventosEntre(new Date(0), new Date(1)); // 401 → renueva y repite
    expect(m.w.llamadas.filter((l) => l.url.includes("oauth2")).length).toBe(2);
  });

  it("pasado el tiempo de validez, pide otro acceso", async () => {
    const m = mundo({ respuestas: [{ status: 200, json: { items: [] } }, { status: 200, json: { items: [] } }] });
    await m.agenda.eventosEntre(new Date(0), new Date(1));
    m.w.ahora += 3_500_000; // casi 1 h después
    await m.agenda.eventosEntre(new Date(0), new Date(1));
    expect(m.w.llamadas.filter((l) => l.url.includes("oauth2")).length).toBe(2);
  });
});

describe("el calendario real: a quién se invita al pasar a morado", () => {
  const pagar = async (op: { email: string | null; esPrueba: boolean; cuenta?: string | null }) => {
    const m = mundo({ email: op.cuenta === undefined ? "info@blakebraider.com" : op.cuenta, respuestas: [MARCA, { status: 200, json: {} }] });
    const r = await m.agenda.pasarAPagada(EID, BOOKING, { email: op.email, esPrueba: op.esPrueba });
    const patch = m.w.llamadas.find((l) => l.method === "PATCH")!;
    return { r, patch, cuerpo: JSON.parse(patch.body!), sendUpdates: new URL(patch.url).searchParams.get("sendUpdates") };
  };

  it("una clienta real con email: se la invita siempre", async () => {
    const x = await pagar({ email: "ana@correo.com", esPrueba: false });
    expect(x.r.invitado).toBe(true);
    expect(x.cuerpo).toEqual({ colorId: "3", attendees: [{ email: "ana@correo.com" }] });
    expect(x.sendUpdates).toBe("all");
  });
  it("una prueba con el email de otra persona: NO se invita a nadie", async () => {
    const x = await pagar({ email: "ana@correo.com", esPrueba: true });
    expect(x.r.invitado).toBe(false);
    expect(x.cuerpo).toEqual({ colorId: "3" });
    expect(x.sendUpdates).toBe("none");
  });
  it("una prueba con el email de la propia cuenta conectada (sin mirar mayúsculas): sí", async () => {
    expect((await pagar({ email: "INFO@blakebraider.com", esPrueba: true })).r.invitado).toBe(true);
  });
  it("si no se conoce la cuenta conectada, una prueba nunca invita", async () => {
    expect((await pagar({ email: "ana@correo.com", esPrueba: true, cuenta: null })).r.invitado).toBe(false);
  });
  it("sin email no hay invitación", async () => {
    expect((await pagar({ email: null, esPrueba: false })).r.invitado).toBe(false);
  });
});
