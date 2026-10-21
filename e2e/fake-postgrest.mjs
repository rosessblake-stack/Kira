// PostgREST falso en memoria: solo el subconjunto que usa supabase-js en Kira. Si una consulta nueva
// usa un operador que no está aquí, lanza un error claro en vez de devolver datos equivocados.
// Sirve para probar la app real (next start) sin tocar la base de datos de producción.
import http from "node:http";
import { randomUUID } from "node:crypto";

const nowIso = () => new Date().toISOString();
export const tables = {
  panel_login_tokens: [],
  panel_sessions: [],
  app_settings: [{ key: "kira_paused", value: false, updated_at: nowIso(), updated_by: null }],
  event_log: [],
  security_events: [],
  conversations: [],
  messages: [],
  bookings: [],
  scheduled_jobs: [],
  processed_webhooks: [],
  attachments: [],
  service_records: [],
  clients: [],
};
/** Almacén de archivos falso (Supabase Storage): "bucket/ruta" -> { bytes, contentType }. */
export const storage = new Map();
let seq = 1;
let seqRegistro = 1; // service_records.seq: el número que Blake ve en /real
const intId = new Set(["event_log", "security_events"]);

function defaults(table, row) {
  const r = { ...row };
  if (!("id" in r) && table !== "app_settings" && table !== "processed_webhooks") {
    r.id = intId.has(table) ? seq++ : randomUUID();
  }
  if (table === "event_log") Object.assign(r, { at: r.at ?? nowIso(), level: r.level ?? "info", detail: r.detail ?? {}, conversation_id: r.conversation_id ?? null, booking_id: r.booking_id ?? null });
  if (table === "security_events") Object.assign(r, { at: r.at ?? nowIso(), detail: r.detail ?? {}, conversation_id: r.conversation_id ?? null });
  if (table === "panel_login_tokens") Object.assign(r, { created_at: r.created_at ?? nowIso(), used_at: r.used_at ?? null });
  if (table === "panel_sessions") Object.assign(r, { created_at: r.created_at ?? nowIso(), revoked_at: r.revoked_at ?? null });
  if (table === "messages") Object.assign(r, { created_at: r.created_at ?? nowIso(), flagged: r.flagged ?? false });
  if (table === "bookings") {
    Object.assign(r, {
      created_at: r.created_at ?? nowIso(),
      status: r.status ?? "propuesta",
      is_test: r.is_test ?? false,
      spec: r.spec ?? {},
      pricing: r.pricing ?? {},
      warnings: r.warnings ?? [],
      client_email: r.client_email ?? null,
      reply_draft: r.reply_draft ?? null,
      proposal_nonce: r.proposal_nonce ?? null,
      telegram_message_id: r.telegram_message_id ?? null,
      edit_requested_at: r.edit_requested_at ?? null,
      approved_by_telegram_user: r.approved_by_telegram_user ?? null,
      approved_at: r.approved_at ?? null,
      payment_deadline: r.payment_deadline ?? null,
      calendar_event_id: r.calendar_event_id ?? null,
      stripe_session_id: r.stripe_session_id ?? null,
    });
  }
  if (table === "attachments") {
    Object.assign(r, { created_at: r.created_at ?? nowIso(), description: r.description ?? null, described_at: r.described_at ?? null, purged_at: r.purged_at ?? null });
  }
  if (table === "service_records") {
    Object.assign(r, {
      seq: r.seq ?? seqRegistro++,
      created_at: r.created_at ?? nowIso(),
      updated_at: r.updated_at ?? nowIso(),
      horas_reales: r.horas_reales ?? null,
      materiales_reales: r.materiales_reales ?? null,
      precio_real_cents: r.precio_real_cents ?? null,
      nota_real: r.nota_real ?? null,
      real_at: r.real_at ?? null,
    });
  }
  if (table === "conversations") {
    Object.assign(r, {
      created_at: r.created_at ?? nowIso(),
      updated_at: r.updated_at ?? nowIso(),
      intent: r.intent ?? "desconocido",
      status: r.status ?? "abierta",
      last_client_message_at: r.last_client_message_at ?? null,
    });
  }
  return r;
}

/** Restricciones de la base de datos real que la app debe respetar (se prueban igual que en producción). */
function restricciones(table, row) {
  if (table === "attachments" && (row.kind === "referencia") !== (row.expires_at === null || row.expires_at === undefined)) {
    throw Object.assign(new Error('new row for relation "attachments" violates check constraint "attachments_retencion_check"'), { code: "23514" });
  }
}

const isIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const cmp = (a, b) => (isIso(a) && isIso(b) ? Date.parse(a) - Date.parse(b) : a < b ? -1 : a > b ? 1 : 0);

function parseFilters(searchParams) {
  const filters = [];
  for (const [col, raw] of searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
    const dot = raw.indexOf(".");
    filters.push({ col, op: raw.slice(0, dot), val: raw.slice(dot + 1) });
  }
  return filters;
}

function matches(row, { col, op, val }) {
  const v = row[col];
  switch (op) {
    case "eq": return String(v) === val;
    case "is": return val === "null" ? v === null || v === undefined : String(v) === val;
    case "gt": return v != null && cmp(v, val) > 0;
    case "gte": return v != null && cmp(v, val) >= 0;
    case "lt": return v != null && cmp(v, val) < 0;
    case "lte": return v != null && cmp(v, val) <= 0;
    case "in": {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
      return items.includes(String(v));
    }
    case "not": {
      const dot = val.indexOf(".");
      return !matches(row, { col, op: val.slice(0, dot), val: val.slice(dot + 1) });
    }
    default: throw new Error(`operador no soportado: ${op}`);
  }
}

function select(table, sp) {
  const filters = parseFilters(sp);
  let rows = tables[table].filter((r) => filters.every((f) => matches(r, f)));
  const order = sp.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    rows = [...rows].sort((a, b) => (dir === "desc" ? -cmp(a[col], b[col]) : cmp(a[col], b[col])));
  }
  const total = rows.length;
  const limit = sp.get("limit");
  if (limit) rows = rows.slice(0, Number(limit));
  return { rows, total };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

/** Respuesta con filas: array normal, o un único objeto si se pidió .single()/.maybeSingle() (como PostgREST). */
function conFilas(res, status, rows, comoObjeto) {
  if (!comoObjeto) return send(res, status, rows);
  if (rows.length !== 1) {
    return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
  }
  return send(res, status, rows[0]);
}

/** Subconjunto de la API de Storage que usa supabase-js: subir, descargar y borrar. Nada se sirve sin la clave. */
function almacen(req, res, url, crudo) {
  if (!req.headers.authorization?.startsWith("Bearer ")) return send(res, 401, { statusCode: "401", error: "Unauthorized", message: "sin clave" });
  const m = /^\/storage\/v1\/object\/([\w-]+)(?:\/(.*))?$/.exec(url.pathname);
  const bucket = m[1];
  const ruta = m[2] ? decodeURIComponent(m[2]) : "";
  if (bucket !== "kira-fotos") return send(res, 404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
  const clave = `${bucket}/${ruta}`;
  if (req.method === "POST") {
    if (storage.has(clave) && req.headers["x-upsert"] !== "true") return send(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    storage.set(clave, { bytes: crudo, contentType: String(req.headers["content-type"] ?? "") });
    return send(res, 200, { Id: randomUUID(), Key: clave });
  }
  if (req.method === "GET") {
    const f = storage.get(clave);
    if (!f) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "content-type": f.contentType });
    return res.end(f.bytes);
  }
  if (req.method === "DELETE" && !ruta) {
    const prefixes = JSON.parse(crudo.toString()).prefixes ?? [];
    const borrados = [];
    for (const p of prefixes) if (storage.delete(`${bucket}/${p}`)) borrados.push({ name: p });
    return send(res, 200, borrados);
  }
  return send(res, 405, { message: "método no soportado" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const crudo = Buffer.concat(chunks);
  if (url.pathname.startsWith("/storage/v1/object/")) return almacen(req, res, url, crudo);
  const body = crudo.length ? JSON.parse(crudo.toString()) : undefined;

  if (url.pathname.startsWith("/__dump/")) return send(res, 200, tables[url.pathname.slice(8)]);

  const m = /^\/rest\/v1\/(\w+)$/.exec(url.pathname);
  if (!m || !tables[m[1]]) return send(res, 404, { message: "tabla desconocida" });
  const table = m[1];
  const prefer = req.headers.prefer ?? "";
  const wantsRows = prefer.includes("return=representation");
  const comoObjeto = String(req.headers.accept ?? "").includes("vnd.pgrst.object");

  try {
    if (req.method === "GET" || req.method === "HEAD") {
      const { rows, total } = select(table, url.searchParams);
      const range = `${rows.length ? `0-${rows.length - 1}` : "*"}/${total}`;
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-range": range });
        return res.end();
      }
      if (comoObjeto) return conFilas(res, 200, rows, true);
      return send(res, 200, rows, { "content-range": range });
    }
    if (req.method === "POST") {
      const incoming = Array.isArray(body) ? body : [body];
      const out = [];
      for (const raw of incoming) {
        if (prefer.includes("resolution=merge-duplicates")) {
          const pk = table === "app_settings" ? "key" : "id";
          const existing = tables[table].find((r) => r[pk] === raw[pk]);
          if (existing) { Object.assign(existing, raw); out.push(existing); continue; }
        }
        // upsert(onConflict, ignoreDuplicates): si ya hay una fila con esa clave única, no se toca ni se inserta otra.
        const alConflicto = url.searchParams.get("on_conflict");
        if (alConflicto && prefer.includes("resolution=ignore-duplicates") && tables[table].some((r) => r[alConflicto] === raw[alConflicto])) continue;
        if (table === "processed_webhooks" && tables[table].some((r) => r.provider === raw.provider && r.external_id === raw.external_id)) {
          return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
        }
        const row = defaults(table, raw);
        restricciones(table, row);
        tables[table].push(row);
        out.push(row);
      }
      if (!wantsRows) return send(res, 201, undefined);
      return conFilas(res, 201, structuredClone(out), comoObjeto);
    }
    if (req.method === "PATCH") {
      const filters = parseFilters(url.searchParams);
      const rows = tables[table].filter((r) => filters.every((f) => matches(r, f)));
      for (const r of rows) {
        const nueva = { ...r, ...body };
        restricciones(table, nueva);
        Object.assign(r, body);
      }
      if (!wantsRows) return send(res, 204, undefined);
      return conFilas(res, 200, structuredClone(rows), comoObjeto);
    }
    if (req.method === "DELETE") {
      const filters = parseFilters(url.searchParams);
      if (!filters.length) return send(res, 400, { message: "DELETE sin filtro: no permitido" });
      const borradas = tables[table].filter((r) => filters.every((f) => matches(r, f)));
      tables[table] = tables[table].filter((r) => !borradas.includes(r));
      if (!wantsRows) return send(res, 204, undefined);
      return conFilas(res, 200, structuredClone(borradas), comoObjeto);
    }
    return send(res, 405, { message: "método no soportado" });
  } catch (e) {
    return send(res, 400, { message: String(e.message) });
  }
});

export function start(port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
