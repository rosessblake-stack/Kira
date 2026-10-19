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
};
let seq = 1;
const intId = new Set(["event_log", "security_events"]);

function defaults(table, row) {
  const r = { ...row };
  if (!("id" in r) && table !== "app_settings" && table !== "processed_webhooks") {
    r.id = intId.has(table) ? seq++ : randomUUID();
  }
  if (table === "event_log") Object.assign(r, { at: r.at ?? nowIso(), level: r.level ?? "info", detail: r.detail ?? {}, conversation_id: r.conversation_id ?? null });
  if (table === "security_events") Object.assign(r, { at: r.at ?? nowIso(), detail: r.detail ?? {}, conversation_id: r.conversation_id ?? null });
  if (table === "panel_login_tokens") Object.assign(r, { created_at: r.created_at ?? nowIso(), used_at: r.used_at ?? null });
  if (table === "panel_sessions") Object.assign(r, { created_at: r.created_at ?? nowIso(), revoked_at: r.revoked_at ?? null });
  if (table === "messages") Object.assign(r, { created_at: r.created_at ?? nowIso(), flagged: r.flagged ?? false });
  if (table === "bookings") Object.assign(r, { created_at: r.created_at ?? nowIso(), calendar_event_id: r.calendar_event_id ?? null, payment_deadline: r.payment_deadline ?? null, approved_at: r.approved_at ?? null });
  if (table === "conversations") Object.assign(r, { created_at: r.created_at ?? nowIso(), updated_at: r.updated_at ?? nowIso() });
  return r;
}

const isIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const cmp = (a, b) => (isIso(a) && isIso(b) ? Date.parse(a) - Date.parse(b) : a < b ? -1 : a > b ? 1 : 0);

function parseFilters(searchParams) {
  const filters = [];
  for (const [col, raw] of searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    filters.push({ col, op, val });
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
    case "in": {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
      return items.includes(String(v));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

  if (url.pathname.startsWith("/__dump/")) return send(res, 200, tables[url.pathname.slice(8)]);

  const m = /^\/rest\/v1\/(\w+)$/.exec(url.pathname);
  if (!m || !tables[m[1]]) return send(res, 404, { message: "tabla desconocida" });
  const table = m[1];
  const prefer = req.headers.prefer ?? "";
  const wantsRows = prefer.includes("return=representation");

  try {
    if (req.method === "GET" || req.method === "HEAD") {
      const { rows, total } = select(table, url.searchParams);
      const range = `${rows.length ? `0-${rows.length - 1}` : "*"}/${total}`;
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-range": range });
        return res.end();
      }
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
        const row = defaults(table, raw);
        tables[table].push(row);
        out.push(row);
      }
      return send(res, 201, wantsRows ? out : undefined);
    }
    if (req.method === "PATCH") {
      const filters = parseFilters(url.searchParams);
      const rows = tables[table].filter((r) => filters.every((f) => matches(r, f)));
      for (const r of rows) Object.assign(r, body);
      return send(res, wantsRows ? 200 : 204, wantsRows ? rows : undefined);
    }
    return send(res, 405, { message: "método no soportado" });
  } catch (e) {
    return send(res, 400, { message: String(e.message) });
  }
});

export function start(port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
