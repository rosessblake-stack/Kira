import { describe, expect, it } from "vitest";
import { safeEqual } from "../lib/safe-equal";
import { handleTelegramRequest, type Config, type Deps } from "../lib/telegram-handler";

const SECRET = "secreto-de-prueba";
const ADMIN = 111;
const OTHER = 222;
const NONCE = "a".repeat(32);
const LINK_TOKEN = "Z".repeat(43);

type Calls = {
  sent: { chatId: number; text: string; markup?: any; opts?: { noPreview?: boolean } }[];
  links: number;
  prop: {
    simular: { chatId: number; texto: string; conAdjunto: boolean }[];
    botones: { callbackId: string; chatId: number; messageId: number | null; fromId: number; nonce: string; accion: string }[];
    libres: string[];
    cancelar: number;
  };
  fotos: { recibir: { chatId: number; fileId: string; tamano: number | null; conversationId: string | null; pie: string }[]; reenviar: { chatId: number; conversationId: string | null }[] };
  edited: { chatId: number; messageId: number; text: string }[];
  answered: { id: string; text?: string }[];
  events: { kind: string; level?: string; detail?: any }[];
  security: { kind: string; detail?: any }[];
};

function setup(opts: { issued?: string[]; seen?: string[]; edicion?: boolean } = {}) {
  const calls: Calls = { sent: [], links: 0, prop: { simular: [], botones: [], libres: [], cancelar: 0 }, fotos: { recibir: [], reenviar: [] }, edited: [], answered: [], events: [], security: [] };
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
    async sendMessage(chatId, text, markup, opts) {
      calls.sent.push({ chatId, text, markup, opts });
    },
    async answerCallback(id, text) {
      calls.answered.push({ id, text });
    },
    async editMessage(chatId, messageId, text) {
      calls.edited.push({ chatId, messageId, text });
    },
    newNonce: () => (counter++ === 0 ? NONCE : "b".repeat(32)),
    async createLoginLink() {
      calls.links++;
      return `https://kira.test/panel/entrar?t=${LINK_TOKEN}`;
    },
    proposals: {
      async simular(chatId, texto, alCrear) {
        calls.prop.simular.push({ chatId, texto, conAdjunto: Boolean(alCrear) });
        // Como el flujo real: crea la conversación y ejecuta el adjunto enseguida.
        if (alCrear) await alCrear("conv-nueva");
        return "conv-nueva";
      },
      async boton(b) { calls.prop.botones.push(b); },
      async textoLibre(_chatId, texto) { calls.prop.libres.push(texto); return opts.edicion ?? false; },
      async cancelarEdicion() { calls.prop.cancelar++; return opts.edicion ?? false; },
    },
    photos: {
      async recibir(chatId, media, conversationId, pie) { calls.fotos.recibir.push({ chatId, fileId: media.fileId, tamano: media.tamano, conversationId, pie }); },
      async reenviar(chatId, conversationId) { calls.fotos.reenviar.push({ chatId, conversationId }); },
    },
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

  it("/panel envía el enlace de acceso sin vista previa", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/panel"), admin(ADMIN), deps);
    expect(calls.links).toBe(1);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0].chatId).toBe(ADMIN);
    expect(calls.sent[0].text).toContain(`https://kira.test/panel/entrar?t=${LINK_TOKEN}`);
    expect(calls.sent[0].opts?.noPreview).toBe(true);
  });

  it("/panel deja constancia pero el token nunca llega a los registros", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/panel"), admin(ADMIN), deps);
    expect(calls.events.map((e) => e.kind)).toEqual(["panel_enlace_emitido"]);
    expect(JSON.stringify([calls.events, calls.security])).not.toContain(LINK_TOKEN);
  });

  it("/panel@KiracitasBot también funciona", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/panel@KiracitasBot"), admin(ADMIN), deps);
    expect(calls.links).toBe(1);
  });

  it("/panel de un usuario ajeno: nada de enlace y queda registrado", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/panel", OTHER), admin(ADMIN), deps);
    expect(calls.links).toBe(0);
    expect(calls.sent).toHaveLength(0);
    expect(calls.security.map((s) => s.kind)).toEqual(["telegram_no_autorizado"]);
  });

  it("/panel desde un grupo no emite enlace", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/panel", ADMIN, "group"), admin(ADMIN), deps);
    expect(calls.links).toBe(0);
    expect(calls.sent).toHaveLength(0);
  });

  it("/panel sin administrador configurado no emite enlace", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/panel", 4242), admin(null), deps);
    expect(calls.links).toBe(0);
    expect(calls.sent).toHaveLength(0);
  });

  it("comando desconocido: respuesta amable", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/nada"), admin(ADMIN), deps);
    expect(calls.sent[0].text).toContain("No conozco");
  });
});


describe("propuestas de cita: comandos y botones", () => {
  it("/simular entrega al flujo SOLO el texto que sigue al comando", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/simular Hola, quiero 6 trenzas\ncon extensiones"), admin(ADMIN), deps);
    expect(calls.prop.simular).toEqual([{ chatId: ADMIN, texto: "Hola, quiero 6 trenzas\ncon extensiones", conAdjunto: false }]);
    expect(calls.sent).toHaveLength(0); // el handler no contesta: lo hace el flujo
  });

  it("/simular@KiracitasBot también funciona y sin texto llega vacío", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/simular@KiracitasBot ordena todo"), admin(ADMIN), deps);
    await handleTelegramRequest(SECRET, msg("/simular"), admin(ADMIN), deps);
    expect(calls.prop.simular.map((x) => x.texto)).toEqual(["ordena todo", ""]);
  });

  it("un usuario ajeno no puede simular: queda registrado", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/simular hola", OTHER), admin(ADMIN), deps);
    expect(calls.prop.simular).toEqual([]);
    expect(calls.security.map((s) => s.kind)).toEqual(["telegram_no_autorizado"]);
  });

  it("ni en grupos ni sin administrador configurado", async () => {
    const a = setup();
    await handleTelegramRequest(SECRET, msg("/simular hola", ADMIN, "group"), admin(ADMIN), a.deps);
    const b = setup();
    await handleTelegramRequest(SECRET, msg("/simular hola", 4242), admin(null), b.deps);
    expect(a.calls.prop.simular).toEqual([]);
    expect(b.calls.prop.simular).toEqual([]);
  });

  it("un aviso repetido de Telegram no simula dos veces", async () => {
    const { calls, deps } = setup();
    const body = msg("/simular hola");
    await handleTelegramRequest(SECRET, body, admin(ADMIN), deps);
    await handleTelegramRequest(SECRET, body, admin(ADMIN), deps);
    expect(calls.prop.simular).toHaveLength(1);
  });

  const NONCE_P = "c".repeat(32);

  it("los botones de propuesta (p:) llegan al flujo con todo lo necesario", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, cb(`p:${NONCE_P}:ok`), admin(ADMIN), deps);
    await handleTelegramRequest(SECRET, cb(`p:${NONCE_P}:ed`), admin(ADMIN), deps);
    await handleTelegramRequest(SECRET, cb(`p:${NONCE_P}:no`), admin(ADMIN), deps);
    expect(calls.prop.botones.map((b) => b.accion)).toEqual(["ok", "ed", "no"]);
    expect(calls.prop.botones[0]).toMatchObject({ chatId: ADMIN, messageId: 9, fromId: ADMIN, nonce: NONCE_P });
    expect(calls.security).toEqual([]);
  });

  it("un botón de propuesta pulsado por un ajeno se descarta y se registra", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, cb(`p:${NONCE_P}:ok`, OTHER), admin(ADMIN), deps);
    expect(calls.prop.botones).toEqual([]);
    expect(calls.security.map((s) => s.kind)).toEqual(["telegram_no_autorizado"]);
  });

  it("botones de propuesta mal formados no llegan al flujo", async () => {
    const { calls, deps } = setup();
    for (const data of ["p:zzz:ok", `p:${NONCE_P}:borrar`, `p:${NONCE_P.toUpperCase()}:ok`, `p:${NONCE_P}:ok:extra`]) {
      await handleTelegramRequest(SECRET, cb(data), admin(ADMIN), deps);
    }
    expect(calls.prop.botones).toEqual([]);
    expect(calls.security.every((s) => s.kind === "payload_inesperado")).toBe(true);
    expect(calls.security).toHaveLength(4);
  });

  it("el texto libre solo se consume si hay una edición abierta", async () => {
    const sin = setup();
    await handleTelegramRequest(SECRET, msg("tipo pegadas"), admin(ADMIN), sin.deps);
    expect(sin.calls.prop.libres).toEqual(["tipo pegadas"]);
    expect(sin.calls.sent[0].text).toContain("No conozco");

    const con = setup({ edicion: true });
    await handleTelegramRequest(SECRET, msg("tipo pegadas"), admin(ADMIN), con.deps);
    expect(con.calls.sent).toHaveLength(0);
  });

  it("los comandos desconocidos nunca se tratan como texto de edición", async () => {
    const { calls, deps } = setup({ edicion: true });
    await handleTelegramRequest(SECRET, msg("/borrartodo"), admin(ADMIN), deps);
    expect(calls.prop.libres).toEqual([]);
    expect(calls.sent[0].text).toContain("No conozco");
  });

  it("el texto libre de un ajeno nunca llega al flujo", async () => {
    const { calls, deps } = setup({ edicion: true });
    await handleTelegramRequest(SECRET, msg("precio 1", OTHER), admin(ADMIN), deps);
    expect(calls.prop.libres).toEqual([]);
  });

  it("/cancelar: sin edición avisa; con edición lo gestiona el flujo", async () => {
    const sin = setup();
    await handleTelegramRequest(SECRET, msg("/cancelar"), admin(ADMIN), sin.deps);
    expect(sin.calls.prop.cancelar).toBe(1);
    expect(sin.calls.sent[0].text).toBe("No hay ninguna edición en curso.");
    const con = setup({ edicion: true });
    await handleTelegramRequest(SECRET, msg("/cancelar"), admin(ADMIN), con.deps);
    expect(con.calls.sent).toHaveLength(0);
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

describe("fotos que envía Blake", () => {
  const foto = (extra: Record<string, unknown> = {}, from = ADMIN, type = "private") =>
    JSON.stringify({
      update_id: uid++,
      message: {
        message_id: 7,
        from: { id: from },
        chat: { id: from, type },
        photo: [
          { file_id: "chica", file_size: 900, width: 90, height: 90 },
          { file_id: "mediana", file_size: 30_000, width: 320, height: 320 },
          { file_id: "grande", file_size: 200_000, width: 1280, height: 960 },
        ],
        ...extra,
      },
    });

  it("una foto sin pie se entrega con la versión más grande y sin conversación (la prueba más reciente)", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, foto(), admin(ADMIN), deps);
    expect(calls.fotos.recibir).toEqual([{ chatId: ADMIN, fileId: "grande", tamano: 200_000, conversationId: null, pie: "" }]);
    expect(calls.prop.simular).toHaveLength(0);
  });

  it("si la versión más grande supera el tope, se usa la mayor que quepa", async () => {
    const { calls, deps } = setup();
    const raw = JSON.stringify({
      update_id: uid++,
      message: { message_id: 7, from: { id: ADMIN }, chat: { id: ADMIN, type: "private" }, photo: [
        { file_id: "ok", file_size: 3_000_000, width: 2000, height: 2000 },
        { file_id: "enorme", file_size: 9_000_000, width: 4000, height: 4000 },
      ] },
    });
    await handleTelegramRequest(SECRET, raw, admin(ADMIN), deps);
    expect(calls.fotos.recibir[0].fileId).toBe("ok");
  });

  it("el pie de la foto (pelo: …) viaja tal cual al flujo de fotos", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, foto({ caption: "pelo: rizado, fino, a los hombros" }), admin(ADMIN), deps);
    expect(calls.fotos.recibir[0]).toMatchObject({ conversationId: null, pie: "pelo: rizado, fino, a los hombros" });
  });

  it("pie «/simular …»: crea la prueba y la foto se adjunta a ESA conversación, antes de la propuesta", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, foto({ caption: "/simular Hola, quiero 6 trenzas" }), admin(ADMIN), deps);
    expect(calls.prop.simular).toEqual([{ chatId: ADMIN, texto: "Hola, quiero 6 trenzas", conAdjunto: true }]);
    expect(calls.fotos.recibir).toEqual([{ chatId: ADMIN, fileId: "grande", tamano: 200_000, conversationId: "conv-nueva", pie: "" }]);
  });

  it("archivo de imagen enviado como documento: se guarda igual", async () => {
    const { calls, deps } = setup();
    const raw = JSON.stringify({ update_id: uid++, message: { message_id: 7, from: { id: ADMIN }, chat: { id: ADMIN, type: "private" }, document: { file_id: "doc1", file_size: 1234, mime_type: "image/png" } } });
    await handleTelegramRequest(SECRET, raw, admin(ADMIN), deps);
    expect(calls.fotos.recibir).toEqual([{ chatId: ADMIN, fileId: "doc1", tamano: 1234, conversationId: null, pie: "" }]);
  });

  it("documento que no es JPG/PNG/WebP (pdf, gif, html): no se guarda y se avisa", async () => {
    for (const mime of ["application/pdf", "image/gif", "text/html", "image/svg+xml", ""]) {
      const { calls, deps } = setup();
      const raw = JSON.stringify({ update_id: uid++, message: { message_id: 7, from: { id: ADMIN }, chat: { id: ADMIN, type: "private" }, document: { file_id: "d", file_size: 10, mime_type: mime } } });
      await handleTelegramRequest(SECRET, raw, admin(ADMIN), deps);
      expect(calls.fotos.recibir).toHaveLength(0);
      expect(calls.sent[0].text).toContain("Solo guardo fotos");
    }
  });

  it("foto de alguien que no es el administrador: nada se guarda y queda en seguridad", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, foto({}, OTHER), admin(ADMIN), deps);
    expect(calls.fotos.recibir).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    expect(calls.security[0]).toMatchObject({ kind: "telegram_no_autorizado" });
  });

  it("foto en un grupo (no es chat privado): se ignora", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, foto({}, ADMIN, "supergroup"), admin(ADMIN), deps);
    expect(calls.fotos.recibir).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
  });

  it("file_id raro (vacío, demasiado largo o no texto): se descarta", async () => {
    for (const fid of ["", "x".repeat(301), 42]) {
      const { calls, deps } = setup();
      const raw = JSON.stringify({ update_id: uid++, message: { message_id: 7, from: { id: ADMIN }, chat: { id: ADMIN, type: "private" }, photo: [{ file_id: fid, file_size: 10, width: 5, height: 5 }] } });
      await handleTelegramRequest(SECRET, raw, admin(ADMIN), deps);
      expect(calls.fotos.recibir).toHaveLength(0);
    }
  });

  it("/fotos pide reenviar las de la última prueba", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, msg("/fotos"), admin(ADMIN), deps);
    expect(calls.fotos.reenviar).toEqual([{ chatId: ADMIN, conversationId: null }]);
  });

  it("en modo configuración (sin administrador) una foto no hace nada", async () => {
    const { calls, deps } = setup();
    await handleTelegramRequest(SECRET, foto(), admin(null), deps);
    expect(calls.fotos.recibir).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
  });
});
