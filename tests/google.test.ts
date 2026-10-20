import { describe, expect, it } from "vitest";
import {
  GoogleError,
  SCOPES,
  cifrar,
  configGoogle,
  descifrar,
  emailDelIdToken,
  hashState,
  intercambiarCodigo,
  nuevoState,
  redirectUri,
  renovarAcceso,
  urlDeAutorizacion,
  type FetchGoogle,
} from "../lib/google-oauth";
import { ClienteCalendario, COLOR_AMARILLO, COLOR_MORADO, idDeEvento, type NuevoEvento } from "../lib/google-calendar";

/** El error con el que acaba una promesa (la prueba falla si no falla). */
async function fallo(p: Promise<unknown>): Promise<GoogleError> {
  try {
    await p;
  } catch (e) {
    return e as GoogleError;
  }
  throw new Error("Se esperaba un error y no lo hubo");
}

const CFG = { clientId: "id-cliente", clientSecret: "secreto-de-cliente" };

describe("configGoogle y dirección de retorno", () => {
  it("hace falta el ID y el secreto; sin uno de los dos no se puede conectar", () => {
    expect(configGoogle({ GOOGLE_CLIENT_ID: " a ", GOOGLE_CLIENT_SECRET: "b" })).toEqual({ clientId: "a", clientSecret: "b" });
    expect(configGoogle({ GOOGLE_CLIENT_ID: "a" })).toBeNull();
    expect(configGoogle({ GOOGLE_CLIENT_SECRET: "b" })).toBeNull();
    expect(configGoogle({ GOOGLE_CLIENT_ID: "  ", GOOGLE_CLIENT_SECRET: "b" })).toBeNull();
    expect(configGoogle({})).toBeNull();
  });

  it("la dirección de retorno es la del panel", () => {
    expect(redirectUri("kira-virid-eight.vercel.app")).toBe("https://kira-virid-eight.vercel.app/api/google/callback");
  });
});

describe("urlDeAutorizacion", () => {
  const u = new URL(urlDeAutorizacion(CFG, "https://k.test/api/google/callback", "estado-1"));
  it("va a Google con el permiso mínimo y pide el permiso permanente", () => {
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events openid email");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://k.test/api/google/callback");
    expect(u.searchParams.get("state")).toBe("estado-1");
    expect(u.searchParams.get("client_id")).toBe("id-cliente");
  });
  it("jamás lleva el secreto de cliente", () => {
    expect(u.toString()).not.toContain("secreto-de-cliente");
  });
  it("los permisos pedidos son solo eventos + identidad (nada de contactos, correo ni calendarios enteros)", () => {
    expect([...SCOPES]).toEqual(["https://www.googleapis.com/auth/calendar.events", "openid", "email"]);
  });
});

describe("cifrado del refresh token", () => {
  it("se descifra con la misma clave y el texto cifrado no contiene el original", () => {
    const c = cifrar("1//refresh-token-secreto", "clave-de-servidor");
    expect(c).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(c).not.toContain("refresh-token-secreto");
    expect(descifrar(c, "clave-de-servidor")).toBe("1//refresh-token-secreto");
  });
  it("cada cifrado es distinto (iv nuevo)", () => {
    expect(cifrar("x", "k")).not.toBe(cifrar("x", "k"));
  });
  it("con otra clave, manipulado o con otro formato NO descifra (y no lanza)", () => {
    const c = cifrar("secreto", "clave-a");
    expect(descifrar(c, "clave-b")).toBeNull();
    const partes = c.split(".");
    partes[3] = partes[3].slice(0, -2) + (partes[3].endsWith("AA") ? "BB" : "AA");
    expect(descifrar(partes.join("."), "clave-a")).toBeNull();
    expect(descifrar("v2.a.b.c", "clave-a")).toBeNull();
    expect(descifrar("", "clave-a")).toBeNull();
    expect(descifrar("no es nada", "clave-a")).toBeNull();
  });
});

describe("state contra CSRF", () => {
  it("es aleatorio y largo; solo su hash se guarda", () => {
    const a = nuevoState(), b = nuevoState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashState(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashState(a)).not.toContain(a);
  });
});

const jwt = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("emailDelIdToken", () => {
  it("lee el email en minúsculas y descarta lo raro", () => {
    expect(emailDelIdToken(jwt({ email: "Info@BlakeBraider.com" }))).toBe("info@blakebraider.com");
    expect(emailDelIdToken(jwt({}))).toBeNull();
    expect(emailDelIdToken("no-es-jwt")).toBeNull();
    expect(emailDelIdToken(undefined)).toBeNull();
    expect(emailDelIdToken(jwt({ email: "x".repeat(300) }))).toBeNull();
  });
});

type Llamada = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeFetch(respuestas: { status: number; json?: unknown; texto?: string }[]) {
  const llamadas: Llamada[] = [];
  const f: FetchGoogle = async (url, init) => {
    llamadas.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.texto ?? (r.json === undefined ? "" : JSON.stringify(r.json)) };
  };
  return { f, llamadas };
}

describe("intercambiarCodigo", () => {
  const buenos = { access_token: "acc", refresh_token: "ref", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events", id_token: jwt({ email: "info@blakebraider.com" }) };

  it("cambia el código por los tokens, con el secreto en el cuerpo (no en la URL) y devuelve el email", async () => {
    const { f, llamadas } = fakeFetch([{ status: 200, json: buenos }]);
    const c = await intercambiarCodigo(CFG, "codigo-1", "https://k.test/cb", f);
    expect(c).toEqual({ refreshToken: "ref", accessToken: "acc", expiraEnSeg: 3599, email: "info@blakebraider.com" });
    expect(llamadas[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(llamadas[0].url).not.toContain("secreto");
    const cuerpo = new URLSearchParams(llamadas[0].body);
    expect(cuerpo.get("grant_type")).toBe("authorization_code");
    expect(cuerpo.get("code")).toBe("codigo-1");
    expect(cuerpo.get("client_secret")).toBe("secreto-de-cliente");
    expect(cuerpo.get("redirect_uri")).toBe("https://k.test/cb");
  });

  it("sin permiso permanente (refresh token) no vale", async () => {
    const { f } = fakeFetch([{ status: 200, json: { ...buenos, refresh_token: undefined } }]);
    await expect(intercambiarCodigo(CFG, "c", "r", f)).rejects.toThrow(/permiso permanente/);
  });

  it("si la clienta… perdón, Blake desmarca el permiso del calendario, no vale", async () => {
    const { f } = fakeFetch([{ status: 200, json: { ...buenos, scope: "openid email" } }]);
    await expect(intercambiarCodigo(CFG, "c", "r", f)).rejects.toThrow(/permiso para ver y editar los eventos/);
  });

  it("un código ya usado o caducado se reconoce como conexión perdida, sin filtrar el código", async () => {
    const { f } = fakeFetch([{ status: 400, json: { error: "invalid_grant", error_description: "Bad Request codigo-1" } }]);
    const e = await fallo(intercambiarCodigo(CFG, "codigo-1", "r", f));
    expect(e).toBeInstanceOf(GoogleError);
    expect(e.desconectado).toBe(true);
    expect(e.message).toBe("Google rechazó la conexión (400: invalid_grant)");
    expect(e.message).not.toContain("codigo-1");
  });

  it("cuando Google no responde o devuelve basura, el error es claro y sin detalles internos", async () => {
    const roto: FetchGoogle = async () => { throw new Error("ECONNRESET 10.0.0.1 secreto-de-cliente"); };
    const e = await fallo(intercambiarCodigo(CFG, "c", "r", roto));
    expect(e.message).toBe("No se pudo conectar con Google");
    const html = fakeFetch([{ status: 502, texto: "<html>Bad gateway</html>" }]);
    const e2 = await fallo(intercambiarCodigo(CFG, "c", "r", html.f));
    expect(e2.message).toBe("Google rechazó la conexión (502)");
    expect(e2.desconectado).toBe(false);
  });
});

describe("renovarAcceso", () => {
  it("pide un acceso nuevo con el refresh token", async () => {
    const { f, llamadas } = fakeFetch([{ status: 200, json: { access_token: "nuevo", expires_in: 3000 } }]);
    expect(await renovarAcceso(CFG, "ref", f)).toEqual({ accessToken: "nuevo", expiraEnSeg: 3000 });
    const c = new URLSearchParams(llamadas[0].body);
    expect(c.get("grant_type")).toBe("refresh_token");
    expect(c.get("refresh_token")).toBe("ref");
  });
  it("si el permiso se retiró (invalid_grant) lo dice: hay que volver a conectar", async () => {
    const { f } = fakeFetch([{ status: 400, json: { error: "invalid_grant" } }]);
    const e = await fallo(renovarAcceso(CFG, "ref", f));
    expect(e.desconectado).toBe(true);
  });
  it("una respuesta sin acceso no se acepta", async () => {
    const { f } = fakeFetch([{ status: 200, json: {} }]);
    await expect(renovarAcceso(CFG, "ref", f)).rejects.toThrow(/acceso válido/);
  });
});

// ---------------------------------------------------------------------------
// Cliente de Calendar
// ---------------------------------------------------------------------------

function cliente(respuestas: { status: number; json?: unknown }[], calendarId = "info@blakebraider.com") {
  const { f, llamadas } = fakeFetch(respuestas);
  let olvidos = 0;
  let n = 0;
  const c = new ClienteCalendario({ calendarId, token: async () => `tok${++n}`, olvidarToken: () => { olvidos++; }, fetchImpl: f });
  return { c, llamadas, olvidos: () => olvidos };
}

const evento = (o: Partial<NuevoEvento> = {}): NuevoEvento => ({
  id: idDeEvento("61dba233-632a-4ee4-b9b2-1a72a18895d2"), bookingId: "61dba233-632a-4ee4-b9b2-1a72a18895d2",
  titulo: "Trenzas Michael", descripcion: "6 Trenzas\nCon extensiones\n\n80€", ubicacion: "Carrer de la Duquessa de la Victòria, 16",
  inicio: new Date("2026-10-22T15:00:00.000Z"), fin: new Date("2026-10-22T17:30:00.000Z"), zona: "Europe/Madrid", prueba: false, ...o,
});

describe("idDeEvento", () => {
  it("es válido para Google (letras a–v y cifras, 5–1024) y siempre el mismo para la misma reserva", () => {
    const id = idDeEvento("61DBA233-632A-4EE4-B9B2-1A72A18895D2");
    expect(id).toBe("kira61dba233632a4ee4b9b21a72a18895d2");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(idDeEvento("61dba233-632a-4ee4-b9b2-1a72a18895d2")).toBe(id);
  });
});

describe("ClienteCalendario.listar", () => {
  const e1 = { id: "a", status: "confirmed", summary: "Trenzas A", start: { dateTime: "2026-10-22T11:00:00+02:00" }, end: { dateTime: "2026-10-22T13:00:00+02:00" } };
  const libre = { id: "b", status: "confirmed", summary: "Lux", transparency: "transparent", start: { dateTime: "2026-10-22T14:00:00+02:00" }, end: { dateTime: "2026-10-22T16:00:00+02:00" } };
  const cancelado = { id: "c", status: "cancelled" };

  it("pide TODOS los eventos del calendario indicado, ya expandidos, y solo los campos necesarios", async () => {
    const { c, llamadas } = cliente([{ status: 200, json: { items: [e1, libre, cancelado] } }]);
    const r = await c.listar(new Date("2026-10-21T00:00:00Z"), new Date("2026-10-23T00:00:00Z"));
    expect(r.map((x) => x.titulo)).toEqual(["Trenzas A", "Lux"]);
    expect(r[1].libre).toBe(true); // los «libres» llegan y cuentan
    const u = new URL(llamadas[0].url);
    expect(u.pathname).toBe("/calendar/v3/calendars/info%40blakebraider.com/events");
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(u.searchParams.get("timeMin")).toBe("2026-10-21T00:00:00.000Z");
    expect(u.searchParams.get("timeMax")).toBe("2026-10-23T00:00:00.000Z");
    expect(u.searchParams.get("showDeleted")).toBe("false");
    expect(u.searchParams.get("fields")).not.toMatch(/description|attendees|location/);
    expect(llamadas[0].headers.authorization).toBe("Bearer tok1");
  });

  it("sigue las páginas hasta el final", async () => {
    const { c, llamadas } = cliente([
      { status: 200, json: { items: [e1], nextPageToken: "p2" } },
      { status: 200, json: { items: [libre] } },
    ]);
    const r = await c.listar(new Date(0), new Date(1e12));
    expect(r).toHaveLength(2);
    expect(new URL(llamadas[1].url).searchParams.get("pageToken")).toBe("p2");
  });

  it("si la agenda no cabe en 10 páginas NO se da por comprobada", async () => {
    const { c } = cliente([{ status: 200, json: { items: [e1], nextPageToken: "siempre" } }]);
    await expect(c.listar(new Date(0), new Date(1e12))).rejects.toThrow(/demasiados eventos/);
  });

  it("con 401 renueva el acceso y repite UNA vez", async () => {
    const { c, llamadas, olvidos } = cliente([{ status: 401, json: {} }, { status: 200, json: { items: [e1] } }]);
    expect(await c.listar(new Date(0), new Date(1))).toHaveLength(1);
    expect(llamadas).toHaveLength(2);
    expect(olvidos()).toBe(1);
    expect(llamadas[1].headers.authorization).toBe("Bearer tok2");
  });

  it("un segundo 401 seguido es error de conexión perdida", async () => {
    const { c } = cliente([{ status: 401, json: {} }]);
    const e = await fallo(c.listar(new Date(0), new Date(1)));
    expect(e).toBeInstanceOf(GoogleError);
    expect(e.desconectado).toBe(true);
  });

  it("errores de Google: mensaje corto con el motivo, sin el cuerpo ni tokens", async () => {
    const { c } = cliente([{ status: 403, json: { error: { errors: [{ reason: "insufficientPermissions" }], message: "Bearer tok1 secreto" } } }]);
    const e = await fallo(c.listar(new Date(0), new Date(1)));
    expect(e.message).toBe("Google Calendar respondió 403 al leer la agenda (insufficientPermissions)");
    expect(e.message).not.toContain("tok1");
  });
});

describe("ClienteCalendario.crear", () => {
  it("crea el evento PROVISIONAL con las convenciones de Blake: amarillo, ocupado, aviso 60 min, sin Meet ni invitados", async () => {
    const { c, llamadas } = cliente([{ status: 200, json: { id: "x" } }]);
    await c.crear(evento());
    expect(llamadas).toHaveLength(1);
    const u = new URL(llamadas[0].url);
    expect(llamadas[0].method).toBe("POST");
    expect(u.searchParams.get("sendUpdates")).toBe("none");
    expect(u.searchParams.has("conferenceDataVersion")).toBe(false); // sin Google Meet
    const b = JSON.parse(llamadas[0].body!);
    expect(b).toMatchObject({
      id: "kira61dba233632a4ee4b9b21a72a18895d2",
      summary: "Trenzas Michael",
      description: "6 Trenzas\nCon extensiones\n\n80€",
      location: "Carrer de la Duquessa de la Victòria, 16",
      colorId: COLOR_AMARILLO,
      transparency: "opaque",
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      start: { dateTime: "2026-10-22T15:00:00.000Z", timeZone: "Europe/Madrid" },
      end: { dateTime: "2026-10-22T17:30:00.000Z", timeZone: "Europe/Madrid" },
      extendedProperties: { private: { kira_booking_id: "61dba233-632a-4ee4-b9b2-1a72a18895d2" } },
    });
    expect(b.attendees).toBeUndefined();
    expect(b.conferenceData).toBeUndefined();
  });

  it("una prueba lleva la marca de prueba", async () => {
    const { c, llamadas } = cliente([{ status: 200, json: {} }]);
    await c.crear(evento({ prueba: true }));
    expect(JSON.parse(llamadas[0].body!).extendedProperties.private).toEqual({ kira_booking_id: "61dba233-632a-4ee4-b9b2-1a72a18895d2", kira_test: "1" });
  });

  it("sin dirección no manda ubicación", async () => {
    const { c, llamadas } = cliente([{ status: 200, json: {} }]);
    await c.crear(evento({ ubicacion: null }));
    expect(JSON.parse(llamadas[0].body!).location).toBeUndefined();
  });

  it("si ya existe el evento de ESTA reserva (reintento tras un corte), no lo duplica", async () => {
    const { c, llamadas } = cliente([
      { status: 409, json: {} },
      { status: 200, json: { id: "k", status: "confirmed", extendedProperties: { private: { kira_booking_id: "61dba233-632a-4ee4-b9b2-1a72a18895d2" } } } },
    ]);
    await expect(c.crear(evento())).resolves.toBeUndefined();
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].method).toBe("GET");
  });

  it("si el identificador lo usa otro evento (o uno borrado), falla en vez de pisarlo", async () => {
    for (const marca of [{ status: 200, json: { id: "k", status: "confirmed", extendedProperties: { private: { kira_booking_id: "otra" } } } }, { status: 200, json: { id: "k", status: "cancelled", extendedProperties: { private: { kira_booking_id: "61dba233-632a-4ee4-b9b2-1a72a18895d2" } } } }]) {
      const { c } = cliente([{ status: 409, json: {} }, marca]);
      await expect(c.crear(evento())).rejects.toThrow(/no se puede reutilizar/);
    }
  });

  it("otros errores de Google se cuentan sin inventar nada", async () => {
    const { c } = cliente([{ status: 500, json: { error: { status: "INTERNAL" } } }]);
    await expect(c.crear(evento())).rejects.toThrow("Google Calendar respondió 500 al crear el evento (INTERNAL)");
  });
});

const MARCA_OK = { status: 200, json: { id: "k", status: "confirmed", extendedProperties: { private: { kira_booking_id: "61dba233-632a-4ee4-b9b2-1a72a18895d2" } } } };
const BOOKING = "61dba233-632a-4ee4-b9b2-1a72a18895d2";
const EID = idDeEvento(BOOKING);

describe("ClienteCalendario.pasarAPagada", () => {
  it("pasa a morado y añade el email de la clienta, avisándola (invitación)", async () => {
    const { c, llamadas } = cliente([MARCA_OK, { status: 200, json: {} }]);
    await c.pasarAPagada(EID, BOOKING, { email: "michal@gmail.com", invitar: true });
    expect(llamadas[1].method).toBe("PATCH");
    expect(new URL(llamadas[1].url).searchParams.get("sendUpdates")).toBe("all");
    expect(JSON.parse(llamadas[1].body!)).toEqual({ colorId: COLOR_MORADO, attendees: [{ email: "michal@gmail.com" }] });
  });

  it("sin invitar: solo cambia el color y no avisa a nadie", async () => {
    const { c, llamadas } = cliente([MARCA_OK, { status: 200, json: {} }]);
    await c.pasarAPagada(EID, BOOKING, { email: "otra@x.com", invitar: false });
    expect(new URL(llamadas[1].url).searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(llamadas[1].body!)).toEqual({ colorId: COLOR_MORADO });
  });

  it("no toca un evento que no es de esta reserva", async () => {
    const { c, llamadas } = cliente([{ status: 200, json: { id: "k", status: "confirmed", extendedProperties: { private: { kira_booking_id: "otra" } } } }]);
    await expect(c.pasarAPagada(EID, BOOKING, { email: null, invitar: false })).rejects.toThrow(/no es de Kira/);
    expect(llamadas).toHaveLength(1);
    const { c: c2 } = cliente([{ status: 200, json: { id: "k", status: "confirmed" } }]); // un evento de Blake, sin marca
    await expect(c2.pasarAPagada(EID, BOOKING, { email: null, invitar: false })).rejects.toThrow(/no es de Kira/);
  });

  it("si el evento ya no existe, lo dice", async () => {
    const { c } = cliente([{ status: 404, json: {} }]);
    await expect(c.pasarAPagada(EID, BOOKING, { email: null, invitar: false })).rejects.toThrow(/ya no existe/);
  });
});

describe("ClienteCalendario.borrar: solo lo propio", () => {
  it("borra un evento con la marca de esta reserva, sin avisar a nadie", async () => {
    const { c, llamadas } = cliente([MARCA_OK, { status: 204 }]);
    expect(await c.borrar(EID, BOOKING)).toBe("borrado");
    expect(llamadas[1].method).toBe("DELETE");
    expect(new URL(llamadas[1].url).searchParams.get("sendUpdates")).toBe("none");
  });

  it("NUNCA borra un evento de Blake (sin la marca) ni de otra reserva, aunque se pida su identificador", async () => {
    for (const marca of [{ status: 200, json: { id: "k", status: "confirmed" } }, { status: 200, json: { id: "k", status: "confirmed", extendedProperties: { private: { kira_booking_id: "otra" } } } }]) {
      const { c, llamadas } = cliente([marca, { status: 204 }]);
      await expect(c.borrar("evento-de-blake", BOOKING)).rejects.toThrow(/no es de Kira: no se borra/);
      expect(llamadas.filter((x) => x.method === "DELETE")).toHaveLength(0);
    }
  });

  it("si ya no existe (borrado a mano), no es un error", async () => {
    expect(await cliente([{ status: 404, json: {} }]).c.borrar(EID, BOOKING)).toBe("ya_no_existe");
    expect(await cliente([{ status: 200, json: { id: "k", status: "cancelled" } }]).c.borrar(EID, BOOKING)).toBe("ya_no_existe");
    expect(await cliente([MARCA_OK, { status: 410, json: {} }]).c.borrar(EID, BOOKING)).toBe("ya_no_existe");
  });

  it("un error al borrar se cuenta", async () => {
    const { c } = cliente([MARCA_OK, { status: 500, json: {} }]);
    await expect(c.borrar(EID, BOOKING)).rejects.toThrow("Google Calendar respondió 500 al borrar el evento");
  });
});
