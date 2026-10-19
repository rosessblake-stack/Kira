import { describe, expect, it } from "vitest";
import { safeEqual } from "../lib/safe-equal";
import { handleTelegramRequest, type Config, type Deps } from "../lib/telegram-handler";

const SECRET = "secreto-de-prueba";
const ADMIN = 111;
const OTHER = 222;
const NONCE = "a".repeat(32);

type Calls = {
  sent: { chatId: number; text: string; markup?: any }[];
  edited: { chatId: number; messageId: number; text: string }[];
  answered: { id: string; text?: string }[];
  events: { kind: string; level?: string; detail?: any }[];
  security: { kind: string; detail?: any }[];
};

function setup(opts: { issued?: string[]; seen?: string[] } = {}) {
  const calls: Calls = { sent: [], edited: [], answered: [], events: [], security: [] };
  const seen = new Set<string>(opts.seen ?? []);
  const issued = new Set<string>(opts.issued ?? []);
  let counter = 0;
  const deps: Deps = {
    async recordUpdate(provider, id) {
      const k = `${provider}:${id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    },
    async logEvent(e) {
      calls.events.push(e);
      if (e.kind === "prueba_enviada" && e.detail?.nonce) issued.add(e.detail.nonce as string);
    },
    async logSecurity(e) {
      calls.security.push(e);
    },
    async hasIssuedTest(n) {
      return issued.has(n);
    },
    async sendMessage(chatId, text, markup) {
      calls.sent.push({ chatId, text, markup });
    },
    async answerCallback(id, text) {
      calls.answered.push({ id, text });
    },
    async editMessage(chatId, messageId, text) {
      calls.edited.push({ chatId, messageId, text });
    },
    newNonce: () => (counter++ === 0 ? NONCE : "b".repeat(32)),
  };
  return { calls, deps };
}

const admin = (id: number | null): Config => ({ webhookSecret: SECRET, adminUserId: id });
let uid = 1;
const msg = (text: string, from = ADMIN, type = "private") =>
  JSON.stringify({ update_id: uid++, message: { message_id: 5, from: { id: from }, chat: { id: from, type }, text } });
const cb = (data: string, from = ADMIN) =>
  JSON.stringify({
    update_id: uid++,
    callback_query: { id: `cb${uid}`, from: { id: from }, data, message: { message_id: 9, chat: { id: from, type: "private" } } },
  });

describe("safeEqual", () => {
  it("compara bien", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(undefined, "x")).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});

describe("firma y formato del aviso", () => {
  it("sin secreto configurado: 500 y no procesa nada", async () => {
    const { calls, deps } = setup();
    const r = await handleTelegramRequest(SECRET, msg("/start"), { webhookSecret: undefined, adminUserId: ADMIN }, deps);
    expect(r.status).toBe(500);
    expect(calls.sent).toHaveLength(0);
    expect(calls.events[0].level).toBe("error");
  });

  it("firma incorrecta: 401, evento de seguridad y ninguna acción", async () => {
    const { calls, deps } = setup();
    const r = await handleTelegramRequest("otro", msg("/prueba"), admin(ADMIN), deps);
    expect(r.status).toBe(401);
    expect(calls.security.map((s) => s.kind)).toEqual(["firma_invalida"]);
    expect(calls.sent).toHaveLength(0);
  });

  it("cabecera ausente: 401", async () => {
    const { calls, deps } = setup();
    const r = await handleTelegramRequest(null, msg("/prueba"), admin(ADMIN), deps);
    expect(r.status).toBe(401);
    expect(calls.security[0].kind).toBe("firma_invalida");
  });

  it("JSON inválido: 400 y evento de seguridad", async () => {
    const { calls, deps } = setup();
    const r = await handleTelegramRequest(SECRET, "{no es json", admin(ADMIN), deps);
    expect(r.status).toBe(400);
    expect(calls.security[0].kind).toBe("payload_inesperado");
  });

  it("sin update_id: 400", async () => {
    const { calls, deps } = setup();
    const r = await handleTelegramRequest(SECRET, JSON.stringify({ hola: 1 }), admin(ADMIN), deps);
    expect(r.status).toBe(400);
    expect(calls.security[0].detail.reason).toBe("sin_update_id");
  });

  it("aviso repetido: se ignora", async () => {
    const { calls, deps } = setup();
    const body = msg("/start");
    await handleTelegramRequest(SECRET, body, admin(ADMIN), deps);
    const again = await handleTelegramRequest(SECRET, body, admin(ADMIN), deps);
    expect(again.body.duplicate).toBe(true);
    expect(calls.sent).toHaveLength(1);
  });
});

describe("modo de configuración (sin administrador)", () => {
  it("/start devuelve el user_id y nada más", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/start", 4242), admin(null), deps);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0].text).toContain("4242");
    expect(calls.sent[0].markup).toBeUndefined();
  });

  it("/start@KiracitasBot también funciona", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/start@KiracitasBot", 4242), admin(null), deps);
    expect(calls.sent[0].text).toContain("4242");
  });

  it("/prueba y otros textos no hacen nada", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/prueba", 4242), admin(null), deps);
    await handleTelegramRequest(SECRET, msg("hola", 4242), admin(null), deps);
    expect(calls.sent).toHaveLength(0);
  });

  it("los botones no sirven sin administrador", async () => {
    const { calls, deps } = setup({ issued: [NONCE] });
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:ok`), admin(null), deps);
    expect(calls.edited).toHaveLength(0);
    expect(calls.security[0].kind).toBe("telegram_no_autorizado");
  });
});

describe("con administrador", () => {
  it("un usuario ajeno queda registrado y no recibe nada", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/prueba", OTHER), admin(ADMIN), deps);
    await handleTelegramRequest(SECRET, msg("/start", OTHER), admin(ADMIN), deps);
    expect(calls.sent).toHaveLength(0);
    expect(calls.security.map((s) => s.kind)).toEqual(["telegram_no_autorizado", "telegram_no_autorizado"]);
    expect(calls.security[0].detail.user_id).toBe(OTHER);
  });

  it("ignora chats de grupo", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/prueba", ADMIN, "group"), admin(ADMIN), deps);
    expect(calls.sent).toHaveLength(0);
  });

  it("/start identifica al administrador", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/start"), admin(ADMIN), deps);
    expect(calls.sent[0].text).toContain("administrador");
  });

  it("/prueba registra antes de enviar y manda tres botones", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/prueba"), admin(ADMIN), deps);
    expect(calls.events[0].kind).toBe("prueba_enviada");
    expect(calls.events[0].detail.nonce).toBe(NONCE);
    const buttons = calls.sent[0].markup.inline_keyboard[0];
    expect(buttons.map((b: any) => b.text)).toEqual(["Aprobar", "Editar", "Rechazar"]);
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it("comando desconocido: respuesta amable", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/nada"), admin(ADMIN), deps);
    expect(calls.sent[0].text).toContain("No conozco");
  });
});

describe("botones", () => {
  it("aprobar: edita el mensaje, responde y registra", async () => {
    const { calls, deps } = setup({ issued: [NONCE] });
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:ok`), admin(ADMIN), deps);
    expect(calls.edited[0].text).toContain("Aprobado");
    expect(calls.answered[0].text).toContain("Aprobado");
    expect(calls.events.at(-1)?.kind).toBe("prueba_boton");
  });

  it("rechazar y editar tienen su propia etiqueta", async () => {
    const a = setup({ issued: [NONCE] });
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:no`), admin(ADMIN), a.deps);
    expect(a.calls.edited[0].text).toContain("Rechazado");
    const b = setup({ issued: [NONCE] });
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:ed`), admin(ADMIN), b.deps);
    expect(b.calls.edited[0].text).toContain("Editar");
  });

  it("un botón solo funciona una vez", async () => {
    const { calls, deps } = setup({ issued: [NONCE] });
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:ok`), admin(ADMIN), deps);
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:no`), admin(ADMIN), deps);
    expect(calls.edited).toHaveLength(1);
    expect(calls.answered[1].text).toBe("Ya procesado");
  });

  it("usuario ajeno pulsando un botón: seguridad y sin cambios", async () => {
    const { calls, deps } = setup({ issued: [NONCE] });
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:ok`, OTHER), admin(ADMIN), deps);
    expect(calls.edited).toHaveLength(0);
    expect(calls.security[0].kind).toBe("telegram_no_autorizado");
  });

  it("nonce que no hemos emitido: seguridad y sin cambios", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, cb(`t:${NONCE}:ok`), admin(ADMIN), deps);
    expect(calls.edited).toHaveLength(0);
    expect(calls.security[0].detail.reason).toBe("nonce_desconocido");
  });

  it("datos de botón con formato raro: seguridad y sin cambios", async () => {
    const { calls, deps } = setup({ issued: [NONCE] });
    for (const data of ["x", `t:${NONCE}:zz`, `t:${"g".repeat(32)}:ok`, "t::ok", `t:${NONCE}:ok; drop table`]) {
      await handleTelegramRequest(SECRET, cb(data), admin(ADMIN), deps);
    }
    expect(calls.edited).toHaveLength(0);
    expect(calls.security.every((s) => s.detail.reason === "callback_invalido")).toBe(true);
  });
});
