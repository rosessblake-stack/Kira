/**
 * Motor de intenciones (docs/POLITICA.md): lo que Claude devuelve es solo DATOS, de una lista cerrada.
 * Este módulo es lógica pura: define el esquema que se le pide al modelo, valida estrictamente lo que
 * devuelve (no se fía de él) y detecta intentos de manipulación en el texto del cliente.
 */

export const INTENCIONES = [
  "cita_salon",
  "info_formacion_online",
  "info_formacion_presencial",
  "precio_servicio",
  "saludo_o_gracias",
  "derivar_a_blake",
] as const;
export type Intencion = (typeof INTENCIONES)[number];

/** conversations.intent tiene su propia lista cerrada en la base de datos. */
export const INTENCION_EN_BD: Record<Intencion, string> = {
  cita_salon: "cita_salon",
  info_formacion_online: "formacion_online",
  info_formacion_presencial: "formacion_presencial",
  precio_servicio: "cita_salon",
  saludo_o_gracias: "otro",
  derivar_a_blake: "otro",
};

export const TIPOS_TRENZADO = ["pegadas", "sueltas", "fulani"] as const;
export const TAMANOS = ["jumbo", "large", "lardium", "medium", "smedium", "small", "xs_small"] as const;
export const ESTILOS_PEGADAS = ["cornrows", "twist", "barrel_twist"] as const;
export const EXTENSIONES = ["con", "feedin", "sin"] as const;
export const LARGOS_CABELLO = ["muy_corto", "corto", "nuca_hombros", "media_espalda", "caderas", "mas_largo"] as const;
export const LARGOS_EXTENSIONES = ["nuca", "hombros", "media_espalda", "caderas", "mas_largo"] as const;

const NO = "no_indicado";

/**
 * Esquema que se le pide al modelo. Plano y sin rasgos avanzados (sin anyOf, sin límites numéricos):
 * "no indicado" se expresa con valores centinela. La validación real es la de abajo.
 */
export const CLASIFICACION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intencion", "confianza", "manipulacion", "tipo_trenzado", "numero_trenzas", "tamano", "estilo_pegadas",
    "extensiones", "color_extensiones", "boho", "largo_cabello", "largo_extensiones", "fecha", "hora",
    "nombre", "email", "instagram", "notas",
  ],
  properties: {
    intencion: { type: "string", enum: [...INTENCIONES] },
    confianza: { type: "string", enum: ["alta", "media", "baja"] },
    manipulacion: { type: "boolean" },
    tipo_trenzado: { type: "string", enum: [...TIPOS_TRENZADO, NO] },
    numero_trenzas: { type: "integer" },
    tamano: { type: "string", enum: [...TAMANOS, NO] },
    estilo_pegadas: { type: "string", enum: [...ESTILOS_PEGADAS, NO] },
    extensiones: { type: "string", enum: [...EXTENSIONES, NO] },
    color_extensiones: { type: "string" },
    boho: { type: "string", enum: ["si", "no", NO] },
    largo_cabello: { type: "string", enum: [...LARGOS_CABELLO, NO] },
    largo_extensiones: { type: "string", enum: [...LARGOS_EXTENSIONES, NO] },
    fecha: { type: "string" },
    hora: { type: "string" },
    nombre: { type: "string" },
    email: { type: "string" },
    instagram: { type: "string" },
    notas: { type: "string" },
  },
} as const;

export type Clasificacion = {
  intencion: Intencion;
  confianza: "alta" | "media" | "baja";
  manipulacion: boolean;
  tipo_trenzado: (typeof TIPOS_TRENZADO)[number] | null;
  numero_trenzas: number | null;
  tamano: (typeof TAMANOS)[number] | null;
  estilo_pegadas: (typeof ESTILOS_PEGADAS)[number] | null;
  extensiones: (typeof EXTENSIONES)[number] | null;
  color_extensiones: string | null;
  boho: boolean | null;
  largo_cabello: (typeof LARGOS_CABELLO)[number] | null;
  largo_extensiones: (typeof LARGOS_EXTENSIONES)[number] | null;
  /** AAAA-MM-DD, fecha de calendario real. */
  fecha: string | null;
  /** HH:MM en 24 h. */
  hora: string | null;
  nombre: string | null;
  email: string | null;
  instagram: string | null;
  notas: string | null;
  /** Avisos de la validación (p. ej. "el email no aparece en el mensaje: descartado"). */
  avisosValidacion: string[];
};

export type ResultadoValidacion = { ok: true; value: Clasificacion } | { ok: false; motivo: string };

// ---------------------------------------------------------------------------
// Validación estricta de lo que devuelve el modelo
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>"',;()]{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,24}$/;
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Texto libre que viene del modelo y acabará en pantalla: sin control, sin saltos, con tope. */
export function limpiarTexto(v: string, max: number): string {
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function fechaValida(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const horaValida = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Prefijo del aviso de «tipo asumido»: la edición `tipo …` lo quita, porque entonces ya lo ha decidido Blake. */
export const AVISO_TIPO_ASUMIDO = "Tipo asumido";
/** Más trenzas que esto ya no es la forma de pedir pegadas (las sueltas son decenas): no se asume nada. */
export const MAX_TRENZAS_PEGADAS = 12;

/**
 * Regla de Blake (dicha el 20-oct): quien pide un número concreto de trenzas («6 trenzas», «8», «2», «4 boxeadoras») quiere
 * PEGADAS; «trenzas» a secas, sin número ni tipo, suelen ser SUELTAS. Solo se aplica cuando el mensaje NO dice el tipo y siempre
 * con un aviso visible (Blake corrige con «tipo sueltas» / «tipo pegadas»). Lo aplica el código, no Claude: Claude solo anota
 * lo que el mensaje dice.
 */
export function asumirTipoTrenzado(numero: number | null, textoCliente: string): { tipo: "pegadas" | "sueltas"; aviso: string } | null {
  // Un correo o un usuario de Instagram («@trenzas_by_ana») no es la clienta hablando de trenzas.
  const t = textoCliente.toLowerCase().replace(/\S*@\S+/g, " ");
  const corregir = (otro: string) => `Si no es así, escribe «tipo ${otro}».`;
  if (/boxeadora|boxer|boxing/.test(t)) {
    return { tipo: "pegadas", aviso: `${AVISO_TIPO_ASUMIDO}: pegadas (pide trenzas boxeadoras sin decir el tipo; para ti son pegadas). ${corregir("sueltas")}` };
  }
  if (numero !== null && numero >= 1 && numero <= MAX_TRENZAS_PEGADAS) {
    return { tipo: "pegadas", aviso: `${AVISO_TIPO_ASUMIDO}: pegadas (pide ${numero} trenza${numero === 1 ? "" : "s"} sin decir el tipo; para ti, con un número son pegadas). ${corregir("sueltas")}` };
  }
  if (numero === null && /trenza|braid/.test(t)) {
    return { tipo: "sueltas", aviso: `${AVISO_TIPO_ASUMIDO}: sueltas (pide «trenzas» sin número ni tipo; para ti suelen ser sueltas). ${corregir("pegadas")}` };
  }
  return null;
}

export function validarClasificacion(raw: unknown, textoCliente: string): ResultadoValidacion {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, motivo: "no_es_objeto" };
  const o = raw as Record<string, unknown>;

  const esperadas = new Set<string>(CLASIFICACION_SCHEMA.required);
  for (const k of Object.keys(o)) if (!esperadas.has(k)) return { ok: false, motivo: `campo_desconocido:${k}` };
  for (const k of esperadas) if (!(k in o)) return { ok: false, motivo: `falta_campo:${k}` };

  const enumOpt = <T extends string>(k: string, lista: readonly T[]): T | null | undefined => {
    const v = o[k];
    if (v === NO) return null;
    return typeof v === "string" && (lista as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  const enumReq = <T extends string>(k: string, lista: readonly T[]): T | undefined => {
    const v = o[k];
    return typeof v === "string" && (lista as readonly string[]).includes(v) ? (v as T) : undefined;
  };

  const intencion = enumReq("intencion", INTENCIONES);
  if (!intencion) return { ok: false, motivo: "intencion_fuera_de_lista" };
  const confianza = enumReq("confianza", ["alta", "media", "baja"] as const);
  if (!confianza) return { ok: false, motivo: "confianza_invalida" };
  if (typeof o.manipulacion !== "boolean") return { ok: false, motivo: "manipulacion_invalida" };

  const tipo = enumOpt("tipo_trenzado", TIPOS_TRENZADO);
  const tamano = enumOpt("tamano", TAMANOS);
  const estilo = enumOpt("estilo_pegadas", ESTILOS_PEGADAS);
  const ext = enumOpt("extensiones", EXTENSIONES);
  const boho = enumOpt("boho", ["si", "no"] as const);
  const largoCab = enumOpt("largo_cabello", LARGOS_CABELLO);
  const largoExt = enumOpt("largo_extensiones", LARGOS_EXTENSIONES);
  for (const [k, v] of Object.entries({ tipo_trenzado: tipo, tamano, estilo_pegadas: estilo, extensiones: ext, boho, largo_cabello: largoCab, largo_extensiones: largoExt })) {
    if (v === undefined) return { ok: false, motivo: `${k}_invalido` };
  }

  const n = o.numero_trenzas;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 200) return { ok: false, motivo: "numero_trenzas_invalido" };

  for (const k of ["color_extensiones", "fecha", "hora", "nombre", "email", "instagram", "notas"]) {
    if (typeof o[k] !== "string") return { ok: false, motivo: `${k}_no_es_texto` };
  }

  const avisos: string[] = [];
  const lower = textoCliente.toLowerCase();

  // Fecha y hora: forma exacta; la fecha debe existir en el calendario.
  let fecha: string | null = null;
  const fRaw = (o.fecha as string).trim();
  if (fRaw) {
    if (fechaValida(fRaw)) fecha = fRaw;
    else avisos.push("La fecha que devolvió el modelo no es válida: descartada.");
  }
  let hora: string | null = null;
  const hRaw = (o.hora as string).trim();
  if (hRaw) {
    if (horaValida(hRaw)) hora = hRaw;
    else avisos.push("La hora que devolvió el modelo no es válida: descartada.");
  }

  // Email e Instagram: solo valen si aparecen literalmente en el mensaje del cliente.
  // (Evita que el modelo se invente o "complete" un dato de contacto.)
  let email: string | null = null;
  const eRaw = (o.email as string).trim();
  if (eRaw) {
    if (EMAIL_RE.test(eRaw) && lower.includes(eRaw.toLowerCase())) email = eRaw.toLowerCase();
    else avisos.push("El email no es válido o no aparece en el mensaje: descartado.");
  }
  let instagram: string | null = null;
  const iRaw = (o.instagram as string).trim().replace(/^@/, "");
  if (iRaw) {
    if (INSTAGRAM_RE.test(iRaw) && lower.includes(iRaw.toLowerCase())) instagram = `@${iRaw}`;
    else avisos.push("El usuario de Instagram no es válido o no aparece en el mensaje: descartado.");
  }

  const texto = (k: string, max: number) => limpiarTexto(o[k] as string, max) || null;

  // Regla de Blake: si el mensaje no dice el tipo, se asume por el número de trenzas (con aviso visible).
  const numeroTrenzas = n === 0 ? null : n;
  let tipoFinal = tipo ?? null;
  if (tipoFinal === null && (intencion === "cita_salon" || intencion === "precio_servicio")) {
    const asumido = asumirTipoTrenzado(numeroTrenzas, textoCliente);
    if (asumido) {
      tipoFinal = asumido.tipo;
      avisos.push(asumido.aviso);
    }
  }

  return {
    ok: true,
    value: {
      intencion,
      confianza,
      manipulacion: o.manipulacion,
      tipo_trenzado: tipoFinal,
      numero_trenzas: numeroTrenzas,
      tamano: tamano ?? null,
      estilo_pegadas: estilo ?? null,
      extensiones: ext ?? null,
      color_extensiones: texto("color_extensiones", 40),
      boho: boho === undefined || boho === null ? null : boho === "si",
      largo_cabello: largoCab ?? null,
      largo_extensiones: largoExt ?? null,
      fecha,
      hora,
      nombre: texto("nombre", 60),
      email,
      instagram,
      notas: texto("notas", 300),
      avisosValidacion: avisos,
    },
  };
}

// ---------------------------------------------------------------------------
// Señales de manipulación en el texto del cliente (docs/POLITICA.md §4.4)
// ---------------------------------------------------------------------------

const SENALES: { nombre: string; re: RegExp }[] = [
  { nombre: "ignorar_instrucciones", re: /\b(ignora|ignorar|olvida|olvidar|omite|omitir|salta(te)?|desobedece)\b[^.\n]{0,40}\b(instrucciones|reglas|indicaciones|normas|anteriores|prompt)\b/i },
  { nombre: "ignore_previous", re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions|rules|prompt|previous|above)\b/i },
  { nombre: "system_prompt", re: /\b(system\s*prompt|prompt\s+del\s+sistema|mensaje\s+del\s+sistema|tus\s+instrucciones|your\s+instructions)\b/i },
  { nombre: "cambio_de_rol", re: /\b(eres\s+ahora|a\s+partir\s+de\s+ahora\s+(eres|act[uú]a|responde)|finge\s+que|haz\s+como\s+si|pretend\s+(to\s+be|you)|you\s+are\s+now|act\s+as)\b/i },
  { nombre: "peticion_de_secretos", re: /\b(api[\s_-]?key|clave\s+(secreta|api)|token|contrase[ñn]a|password|credenciales|secret(o)?s?\b)/i },
  { nombre: "etiquetas_de_sistema", re: /<\s*\/?\s*(system|assistant|instructions?|mensaje_cliente|tool|prompt)\b[^>]*>/i },
  { nombre: "modo_especial", re: /\b(jailbreak|modo\s+desarrollador|developer\s+mode|modo\s+dios)\b/i },
  // "DAN" solo en mayúsculas: en minúsculas es el verbo español ("me dan cita").
  { nombre: "modo_dan", re: /\bDAN\b/ },
  { nombre: "bloque_de_codigo", re: /```|\bexec\s*\(|\beval\s*\(|<script\b/i },
  { nombre: "orden_de_precio", re: /\b(cambia|cambiar|pon|ponle|dale|aplica|aplicar)\b[^.\n]{0,25}\b(el\s+)?(precio|importe|tarifa|se[ñn]al|descuento)\b[^.\n]{0,25}\b(a|en)\s*\d/i },
  {
    nombre: "falsa_autoridad",
    re: /\b(me\s+(dijo|dijeron|autoriz[oó]|prometi[oó])\s+(blake|la\s+due[ñn]a|el\s+jefe)|(blake|la\s+due[ñn]a|el\s+jefe)\s+me\s+(dijo|dijeron|autoriz[oó]|prometi[oó])|soy\s+(blake|la\s+due[ñn]a|el\s+admin(istrador)?)|de\s+parte\s+de\s+blake)/i, // sin \b final: en JS (sin flag u) la ó de "autorizó" no cuenta como letra
  },
];

/** Devuelve los nombres de las señales encontradas (vacío = limpio). Es un filtro barato previo a Claude. */
export function detectarInyeccion(texto: string): string[] {
  return SENALES.filter((s) => s.re.test(texto)).map((s) => s.nombre);
}

// ---------------------------------------------------------------------------
// Preparación del mensaje para el modelo
// ---------------------------------------------------------------------------

export const MAX_CARACTERES_CLIENTE = 1500;
const ETIQUETA = "mensaje_cliente";

/** El texto del cliente va como DATO dentro de una etiqueta; si intenta cerrarla o abrir otra, se neutraliza. */
export function envolverMensajeCliente(texto: string): string {
  const limpio = texto
    .slice(0, MAX_CARACTERES_CLIENTE)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(new RegExp(`<\\s*(/?)\\s*${ETIQUETA}\\s*>`, "gi"), (_m, barra: string) => `‹${barra}${ETIQUETA}›`);
  return `<${ETIQUETA}>\n${limpio}\n</${ETIQUETA}>`;
}

// ---------------------------------------------------------------------------
// Límites (docs/POLITICA.md §4.5): ritmo por cliente y tope diario de llamadas a Claude
// ---------------------------------------------------------------------------

export const LIMITES = {
  mensajesPorHoraYCliente: 10,
  llamadasClaudePorDia: 300,
} as const;

export type MotivoLimite = "ritmo_por_cliente" | "tope_diario_claude";

export function superaLimites(c: { mensajesClienteUltimaHora: number; llamadasClaudeHoy: number }): MotivoLimite | null {
  if (c.mensajesClienteUltimaHora > LIMITES.mensajesPorHoraYCliente) return "ritmo_por_cliente";
  if (c.llamadasClaudeHoy >= LIMITES.llamadasClaudePorDia) return "tope_diario_claude";
  return null;
}
