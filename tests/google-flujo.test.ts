import { describe, expect, it } from "vitest";
import { iniciarConexion, terminarConexion, type DepsGoogleFlujo } from "../lib/google-flujo";
import { GoogleError, hashState } from "../lib/google-oauth";
import { textoEstadoCalendario } from "../lib/google-estado";

const HOST = "kira-virid-eight.vercel.app";
const AHORA = new Date("2026-10-20T10:00:00Z");

function mundo(op: { sinConfig?: boolean; falla?: GoogleError | Error; esperada?: string | null; email?: string | null; previa?: string | null; incidentes?: number; refresh?: string } = {}) {
  const w = {
    states: new Map<string, string>(),
    conexion: null as null | { refreshToken: string; email: string | null; calendario: string },
    revocados: [] as string[],
    eventos: [] as { kind: string; level?: string; summary: string; detail?: Record<string, unknown> }[],
    seguridad: [] as { kind: string; source: string; detail?: Record<string, unknown> }[],
    codigosCambiados: [] as { code: string; redirect: string }[],
    reloj: AHORA,
  };
  const deps: DepsGoogleFlujo = {
    now: () => w.reloj,
    config: () => (op.sinConfig ? null : { clientId: "cid", clientSecret: "csec" }),
    async guardarState(hash, expira) { w.states.set(hash, expira); },
    async gastarState(hash, ahora) {
      const expira = w.states.get(hash);
      if (!expira || Date.parse(expira) < ahora.getTime()) return false;
      w.states.delete(hash);
      return true;
    },
    async intercambiar(_cfg, code, redirect) {
      w.codigosCambiados.push({ code, redirect });
      if (op.falla) throw op.falla;
      return { refreshToken: op.refresh ?? "refresh-secreto", accessToken: "acc", expiraEnSeg: 3000, email: op.email === undefined ? "info@blakebraider.com" : op.email };
    },
    async guardarConexion(c) { w.conexion = c; },
    calendarioPorDefecto: () => "primary",
    cuentaEsperada: () => op.esperada ?? null,
    async conexionPrevia() { return op.previa ? { refreshToken: op.previa } : null; },
    async revocar(t) { w.revocados.push(t); },
    async incidentesRecientes() { return op.incidentes ?? 0; },
    async logEvent(e) { w.eventos.push(e); },
    async logSecurity(e) { w.seguridad.push(e); },
  };
  return { w, deps };
}

describe("iniciar la conexión", () => {
  it("guarda solo el HASH del state (caduca en 10 min) y manda a Google con el mismo state", async () => {
    const { w, deps } = mundo();
    const r = await iniciarConexion(HOST, deps);
    if (!r.ok) throw new Error("debía poder empezar");
    const u = new URL(r.urlGoogle);
    expect(u.searchParams.get("state")).toBe(r.state);
    expect(u.searchParams.get("redirect_uri")).toBe(`https://${HOST}/api/google/callback`);
    expect([...w.states.keys()]).toEqual([hashState(r.state)]);
    expect(JSON.stringify([...w.states])).not.toContain(r.state);
    expect(w.states.get(hashState(r.state))).toBe("2026-10-20T10:10:00.000Z");
  });

  it("sin GOOGLE_CLIENT_ID/SECRET no empieza nada", async () => {
    const { w, deps } = mundo({ sinConfig: true });
    expect(await iniciarConexion(HOST, deps)).toEqual({ ok: false, motivo: "sin_configurar" });
    expect(w.states.size).toBe(0);
  });
});

describe("terminar la conexión", () => {
  async function empezada(op = {}) {
    const m = mundo(op);
    const r = await iniciarConexion(HOST, m.deps);
    if (!r.ok) throw new Error("x");
    return { ...m, state: r.state };
  }

  it("todo correcto: cambia el código por el permiso, lo guarda y no registra secretos", async () => {
    const { w, deps, state } = await empezada();
    const r = await terminarConexion(HOST, { code: "codigo-de-google", state, error: null, cookieState: state }, deps);
    expect(r).toEqual({ ok: true, cuenta: "info@blakebraider.com" });
    expect(w.codigosCambiados).toEqual([{ code: "codigo-de-google", redirect: `https://${HOST}/api/google/callback` }]);
    expect(w.conexion).toEqual({ refreshToken: "refresh-secreto", email: "info@blakebraider.com", calendario: "primary" });
    const registro = JSON.stringify(w.eventos);
    expect(registro).not.toMatch(/refresh-secreto|codigo-de-google|info@blakebraider/);
    expect(w.eventos[0]).toMatchObject({ kind: "google_conectado" });
  });

  it("sin cookie o sin state es ruido de fuera: se rechaza SIN anotar nada en seguridad (no se puede inundar el registro)", async () => {
    const { w, deps, state } = await empezada();
    for (const p of [{ state, cookieState: null }, { state: null, cookieState: state }, { state: "", cookieState: "" }]) {
      expect(await terminarConexion(HOST, { code: "c", error: null, ...p }, deps)).toMatchObject({ ok: false, motivo: "state_invalido" });
    }
    expect(w.seguridad).toEqual([]);
    expect(w.codigosCambiados).toHaveLength(0);
  });

  it("con muchos incidentes en la última hora deja de anotarlos (tope), pero sigue rechazando", async () => {
    const { w, deps } = mundo({ incidentes: 20 });
    expect(await terminarConexion(HOST, { code: "c", state: "inventado", error: null, cookieState: "inventado" }, deps)).toMatchObject({ ok: false, motivo: "state_invalido" });
    expect(w.seguridad).toEqual([]);
    const otra = mundo({ incidentes: 19 });
    await terminarConexion(HOST, { code: "c", state: "inventado", error: null, cookieState: "inventado" }, otra.deps);
    expect(otra.w.seguridad).toHaveLength(1);
  });

  it("el state sirve UNA sola vez (recargar la página o repetir el enlace no vale)", async () => {
    const { w, deps, state } = await empezada();
    await terminarConexion(HOST, { code: "c1", state, error: null, cookieState: state }, deps);
    w.conexion = null;
    const otra = await terminarConexion(HOST, { code: "c2", state, error: null, cookieState: state }, deps);
    expect(otra).toMatchObject({ ok: false, motivo: "state_invalido" });
    expect(w.conexion).toBeNull();
    expect(w.codigosCambiados).toHaveLength(1);
    expect(w.seguridad.at(-1)).toMatchObject({ kind: "payload_inesperado", source: "google_callback", detail: { razon: "state_desconocido_caducado_o_usado" } });
  });

  it("si la cookie del navegador no coincide (alguien intenta colar su propio código), no se hace nada", async () => {
    const { w, deps, state } = await empezada();
    for (const cookieState of [null, "otro-estado", ""]) {
      const r = await terminarConexion(HOST, { code: "c", state, error: null, cookieState }, deps);
      expect(r).toMatchObject({ ok: false, motivo: "state_invalido" });
    }
    expect(w.seguridad).toHaveLength(1); // solo el que traía una cookie distinta; sin cookie es ruido y no se anota
    expect(w.codigosCambiados).toHaveLength(0);
    expect(w.conexion).toBeNull();
    // y el state sigue vivo para el navegador legítimo
    expect(await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps)).toMatchObject({ ok: true });
  });

  it("sin state, con un state inventado o caducado: rechazado y anotado en seguridad", async () => {
    const { w, deps, state } = await empezada();
    expect(await terminarConexion(HOST, { code: "c", state: null, error: null, cookieState: null }, deps)).toMatchObject({ ok: false, motivo: "state_invalido" });
    expect(await terminarConexion(HOST, { code: "c", state: "inventado", error: null, cookieState: "inventado" }, deps)).toMatchObject({ ok: false, motivo: "state_invalido" });
    w.reloj = new Date(AHORA.getTime() + 11 * 60_000);
    expect(await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps)).toMatchObject({ ok: false, motivo: "state_invalido" });
    expect(w.seguridad).toHaveLength(2); // el primero no traía ni state ni cookie: ruido, sin anotar
    expect(w.codigosCambiados).toHaveLength(0);
  });

  it("si Blake cancela el permiso en Google, no se conecta y queda anotado", async () => {
    const { w, deps, state } = await empezada();
    const r = await terminarConexion(HOST, { code: null, state, error: "access_denied", cookieState: state }, deps);
    expect(r).toMatchObject({ ok: false, motivo: "cancelado" });
    expect(w.conexion).toBeNull();
    expect(w.eventos[0]).toMatchObject({ kind: "google_conexion_cancelada", level: "warn", detail: { error: "access_denied" } });
  });

  it("sin código o con un código enorme, no se intenta", async () => {
    const a = await empezada();
    expect(await terminarConexion(HOST, { code: null, state: a.state, error: null, cookieState: a.state }, a.deps)).toMatchObject({ ok: false });
    const b = await empezada();
    expect(await terminarConexion(HOST, { code: "x".repeat(3000), state: b.state, error: null, cookieState: b.state }, b.deps)).toMatchObject({ ok: false });
    expect(a.w.codigosCambiados.length + b.w.codigosCambiados.length).toBe(0);
  });

  it("si Google rechaza el código, lo dice con claridad y no guarda nada", async () => {
    const { w, deps, state } = await empezada({ falla: new GoogleError("Google rechazó la conexión (400: invalid_grant)", 400, true) });
    const r = await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps);
    expect(r).toMatchObject({ ok: false, motivo: "google_rechazo" });
    if (!r.ok) expect(r.mensaje).toContain("invalid_grant");
    expect(w.conexion).toBeNull();
    expect(w.eventos[0]).toMatchObject({ kind: "google_conexion_fallo", level: "error" });
  });

  it("un error inesperado no filtra detalles internos", async () => {
    const { deps, state } = await empezada({ falla: new Error("ECONNRESET en 10.0.0.5 con token ya29.secreto") });
    const r = await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps);
    if (r.ok) throw new Error("debía fallar");
    expect(r.mensaje).not.toMatch(/10\.0\.0\.5|ya29/);
  });

  it("sin configuración no se acepta nada", async () => {
    const { deps } = mundo({ sinConfig: true });
    expect(await terminarConexion(HOST, { code: "c", state: "s", error: null, cookieState: "s" }, deps)).toMatchObject({ ok: false, motivo: "sin_configurar" });
  });
});

describe("textoEstadoCalendario", () => {
  it("dice en cada caso qué falta o qué hay", () => {
    expect(textoEstadoCalendario({ configurado: false, conectado: false, cuenta: null })).toContain("GOOGLE_CLIENT_ID");
    expect(textoEstadoCalendario({ configurado: true, conectado: false, cuenta: null })).toContain("Conectar Google Calendar");
    const c = textoEstadoCalendario({ configurado: true, conectado: true, cuenta: "info@blakebraider.com" });
    expect(c).toContain("conectado con info@blakebraider.com");
    expect(c).toContain("«libre»");
  });
});

describe("la cuenta equivocada no se guarda", () => {
  async function conEsperada(op: Parameters<typeof mundo>[0]) {
    const m = mundo(op);
    const r = await iniciarConexion(HOST, m.deps);
    if (!r.ok) throw new Error("x");
    return { ...m, state: r.state };
  }

  it("al empezar, Google propone esa cuenta (login_hint)", async () => {
    const { deps } = mundo({ esperada: "info@blakebraider.com" });
    const r = await iniciarConexion(HOST, deps);
    if (!r.ok) throw new Error("x");
    expect(new URL(r.urlGoogle).searchParams.get("login_hint")).toBe("info@blakebraider.com");
  });

  it("si Blake conecta otra cuenta (p. ej. la de rosessblake@gmail.com, con el calendario vacío): no se guarda nada, se anula el permiso y se explica", async () => {
    const { w, deps, state } = await conEsperada({ esperada: "info@blakebraider.com", email: "rosessblake@gmail.com" });
    const r = await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps);
    expect(r).toMatchObject({ ok: false, motivo: "cuenta_distinta" });
    if (!r.ok) {
      expect(r.mensaje).toContain("Has conectado rosessblake@gmail.com");
      expect(r.mensaje).toContain("tus citas están en info@blakebraider.com");
      expect(r.mensaje).toContain("No se ha guardado nada");
    }
    expect(w.conexion).toBeNull();
    expect(w.revocados).toEqual(["refresh-secreto"]);
    expect(w.seguridad.at(-1)).toMatchObject({ kind: "payload_inesperado", source: "google_callback", detail: { razon: "cuenta_distinta_de_la_esperada" } });
    expect(w.eventos.find((e) => e.kind === "google_conectado")).toBeUndefined();
  });

  it("si no se puede saber con qué cuenta se conectó, tampoco se acepta", async () => {
    const { w, deps, state } = await conEsperada({ esperada: "info@blakebraider.com", email: null });
    expect(await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps)).toMatchObject({ ok: false, motivo: "cuenta_distinta" });
    expect(w.conexion).toBeNull();
  });

  it("la cuenta correcta se acepta", async () => {
    const { w, deps, state } = await conEsperada({ esperada: "info@blakebraider.com" });
    expect(await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps)).toMatchObject({ ok: true });
    expect(w.conexion?.email).toBe("info@blakebraider.com");
    expect(w.revocados).toEqual([]);
  });

  it("sin cuenta esperada configurada se acepta cualquiera (como antes)", async () => {
    const { w, deps, state } = await conEsperada({ email: "cualquiera@x.com" });
    expect(await terminarConexion(HOST, { code: "c", state, error: null, cookieState: state }, deps)).toMatchObject({ ok: true });
    expect(w.conexion?.email).toBe("cualquiera@x.com");
  });
});

describe("reconectar anula el permiso anterior", () => {
  it("si Google da un permiso nuevo, el viejo se revoca; si es el mismo, NO (se anularía el nuevo)", async () => {
    const a = mundo({ previa: "refresh-viejo", refresh: "refresh-nuevo" });
    const ra = await iniciarConexion(HOST, a.deps);
    if (!ra.ok) throw new Error("x");
    await terminarConexion(HOST, { code: "c", state: ra.state, error: null, cookieState: ra.state }, a.deps);
    expect(a.w.revocados).toEqual(["refresh-viejo"]);
    expect(a.w.conexion?.refreshToken).toBe("refresh-nuevo");

    const b = mundo({ previa: "mismo", refresh: "mismo" });
    const rb = await iniciarConexion(HOST, b.deps);
    if (!rb.ok) throw new Error("x");
    await terminarConexion(HOST, { code: "c", state: rb.state, error: null, cookieState: rb.state }, b.deps);
    expect(b.w.revocados).toEqual([]);
    expect(b.w.conexion?.refreshToken).toBe("mismo");
  });
});
