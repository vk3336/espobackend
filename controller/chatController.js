const { espoRequest } = require("./espoClient");

/**
 * In-memory conversation state (optional).
 * NOTE: In serverless environments this may reset; the client should pass back `context`.
 */
const SESSION_STORE = globalThis.__AGE_CHAT_SESSIONS || new Map();
globalThis.__AGE_CHAT_SESSIONS = SESSION_STORE;

/* ------------------------------ RESPONSE MODE ------------------------------ */
/**
 * Default: PLAIN TEXT (replyText only) so user feels it’s human.
 * If you want JSON for debugging/UI: add ?json=1
 * Example:
 *   POST /api/chat/message?json=1
 */
function wantsJson(req) {
  const q = String(req.query?.json || "").toLowerCase();
  if (q === "1" || q === "true") return true;

  const accept = String(req.headers?.accept || "").toLowerCase();
  if (accept.includes("application/json")) return true;

  return false;
}

function sendChatResponse(req, res, statusCode, data) {
  if (wantsJson(req)) {
    return res.status(statusCode).json(data);
  }

  const text =
    typeof data?.replyText === "string"
      ? data.replyText
      : typeof data?.error === "string"
      ? data.error
      : "Something went wrong";

  return res.status(statusCode).type("text/plain").send(text);
}

/* ------------------------------ helpers ------------------------------ */
function nowIso() {
  return new Date().toISOString();
}

function cleanStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function norm(v) {
  return cleanStr(v).toLowerCase();
}

function tokenize(text) {
  const s = norm(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!s) return [];
  return s.split(/\s+/g).filter(Boolean);
}

function isNum(v) {
  const n = Number(v);
  return Number.isFinite(n);
}

function fmtNum(v, decimals = 2) {
  if (!isNum(v)) return "";
  const n = Number(v);
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-6) return String(r);
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

function uniqList(arr, limit = 6) {
  const out = [];
  const seen = new Set();
  for (const x of toArr(arr)) {
    const s = cleanStr(x);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function cleanFinishLabel(s) {
  const v = cleanStr(s);
  if (!v) return "";
  const parts = v.split("-").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return v;
}

function niceJoin(arr, sep = ", ", limit = 6) {
  const u = uniqList(arr, limit);
  return u.join(sep);
}

function niceFinish(arr, limit = 6) {
  const cleaned = uniqList(arr, limit).map(cleanFinishLabel).filter(Boolean);
  return uniqList(cleaned, limit).join(", ");
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = cleanStr(v);
    if (s) return s;
  }
  return "";
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return "{}";
  }
}

/* ------------------------------ URL + CODE ------------------------------ */
function getFabricCode(p) {
  return pickFirstNonEmpty(p?.fabricCode, p?.vendorFabricCode, "");
}

function buildFrontendUrl(p) {
  const base = cleanStr(process.env.AGE_FRONTEND_URL); // e.g. https://.../fabric
  const slug = cleanStr(p?.productslug);
  if (!base || !slug) return "";
  const b = base.replace(/\/+$/g, "");
  const s = slug.replace(/^\/+/g, "");
  return `${b}/${s}`;
}

/* ------------------------------ OpenAI helpers ------------------------------ */
function extractOutputText(openaiResponseJson) {
  try {
    const out = openaiResponseJson?.output || [];
    for (const item of out) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            return c.text;
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return "";
}

async function openaiJson(schemaName, schema, system, user) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured");
    err.status = 500;
    throw err;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const body = {
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 250),
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error("OpenAI request failed");
    err.status = resp.status;
    err.data = json;
    throw err;
  }

  const text = extractOutputText(json);
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error("Failed to parse OpenAI JSON output");
    err.status = 502;
    err.data = { raw: text };
    throw err;
  }
}

async function openaiText(system, user) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured");
    err.status = 500;
    throw err;
  }

  const model =
    process.env.OPENAI_TRANSLATE_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini";

  const body = {
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_output_tokens: Number(
      process.env.OPENAI_TRANSLATE_MAX_OUTPUT_TOKENS || 280
    ),
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error("OpenAI translate request failed");
    err.status = resp.status;
    err.data = json;
    throw err;
  }

  return extractOutputText(json) || "";
}

/* ------------------------------ language handling ------------------------------ */
function detectLangFallback(message) {
  const s = String(message || "");
  if (/[ऀ-ॿ]/.test(s)) return "hi";
  if (/[અ-૿]/.test(s)) return "gu";
  if (/[ء-ي]/.test(s)) return "ar";
  if (/[ঁ-৿]/.test(s)) return "bn";
  if (/[ఀ-౿]/.test(s)) return "te";
  if (/[அ-௿]/.test(s)) return "ta";
  if (/[ಕ-೿]/.test(s)) return "kn";
  if (/[അ-ൿ]/.test(s)) return "ml";
  return "en";
}

async function maybeTranslateReply({ replyText, language, userMessage }) {
  const lang = cleanStr(language) || "en";
  if (!replyText) return replyText;

  if (lang.toLowerCase().startsWith("en")) return replyText;

  const t = String(process.env.CHAT_TRANSLATE || "on").toLowerCase();
  if (["0", "off", "false", "no"].includes(t)) return replyText;

  if (!process.env.OPENAI_API_KEY) return replyText;

  const system =
    "You are a translator for a fabric catalogue chat assistant. " +
    "Translate the assistant reply to the same language as the user. " +
    "DO NOT add new information. " +
    "Keep product names, fabric codes, GSM, cm, technical terms, and ALL URLs exactly unchanged. " +
    "Keep the same meaning and short friendly tone.";

  const user =
    `User language code: ${lang}\n` +
    `User message (for style only): ${userMessage}\n\n` +
    `Assistant reply to translate:\n${replyText}`;

  try {
    const translated = await openaiText(system, user);
    const out = cleanStr(translated);
    return out || replyText;
  } catch {
    return replyText;
  }
}

/* ------------------------------ CONTACT FLOW (STEP-BY-STEP) ------------------------------ */
/**
 * NOTE:
 * - We do NOT ask salutationName.
 * - We auto-fill salutationName ONLY if user explicitly writes Mr/Ms/Dr etc,
 *   otherwise (optional) use CHAT_DEFAULT_SALUTATION from .env.
 */
const CONTACT_FIELDS_FLOW = [
  { key: "firstName", q: "What’s your first name?" },
  { key: "lastName", q: "And your last name?" },
  { key: "phoneNumber", q: "What’s your WhatsApp/phone number?" },
  { key: "emailAddress", q: "What’s your email address?" },
  { key: "accountName", q: "Company/brand name?" },
  {
    key: "cBusinessType",
    q: "Business type? (Garment manufacturer / Trader / Brand / Exporter / Other)",
  },
  {
    key: "cFabricCategory",
    q: "Which fabric category are you interested in? (Woven / Knits / Denim / Other)",
  },
  { key: "addressCountry", q: "Which country are you in?" },
  { key: "addressState", q: "State?" },
  { key: "addressCity", q: "City?" },
  { key: "addressStreet", q: "Street/area address (optional)?" },
  { key: "addressPostalCode", q: "Postal code (optional)?" },
  { key: "opportunityAmountCurrency", q: "Preferred currency? (INR / USD / EUR)" },
  { key: "opportunityAmount", q: "Approximate order budget/amount? (number)" },
];

function normalizePhone(s) {
  const v = cleanStr(s);
  if (!v) return "";
  return v.replace(/[^\d+]/g, "");
}

function extractEmailFromText(text) {
  const s = String(text || "");
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function extractPhoneFromText(text) {
  const s = String(text || "");
  const m = s.match(/(\+?\d[\d\s-]{8,}\d)/);
  return m ? normalizePhone(m[1]) : "";
}

function normalizeNameText(s) {
  // keep letters/numbers/spaces/dots (unicode)
  return cleanStr(s)
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNameFromText(message) {
  const raw = String(message || "");
  const m = raw;

  const patterns = [
    /(?:^|\b)(?:my name is|i am|i'm|this is|name is)\s+([^.,\n\r]+)/i,
    /(?:^|\b)name\s*[:\-]\s*([^.,\n\r]+)/i,
  ];

  let cand = "";
  for (const re of patterns) {
    const mm = m.match(re);
    if (mm && mm[1]) {
      cand = mm[1];
      break;
    }
  }

  if (!cand) return { firstName: "", lastName: "", salutationName: "" };

  // handle salutations in captured name
  const cleaned = normalizeNameText(cand);
  const sal = detectSalutation(cleaned) || detectSalutation(raw);

  const noSal = cleaned.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").trim();
  const parts = noSal.split(/\s+/).filter(Boolean);

  if (!parts.length) return { firstName: "", lastName: "", salutationName: sal || "" };

  const firstName = parts[0] || "";
  const lastName = parts.length >= 2 ? parts.slice(1).join(" ") : "";

  return { firstName, lastName, salutationName: sal || "" };
}

function detectSalutation(text) {
  const s = normalizeNameText(text);
  const m = s.match(/^(mr|mrs|ms|miss|dr|prof)\.?\b/i);
  if (!m) return "";
  const v = m[1].toLowerCase();
  if (v === "mr") return "Mr.";
  if (v === "mrs") return "Mrs.";
  if (v === "ms") return "Ms.";
  if (v === "miss") return "Miss";
  if (v === "dr") return "Dr.";
  if (v === "prof") return "Prof.";
  return "";
}

function mergeContact(base, incoming) {
  const out = { ...(base || {}) };
  const src = incoming && typeof incoming === "object" ? incoming : {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v === null || v === undefined) continue;
    const s = typeof v === "number" ? v : cleanStr(v);
    if (typeof s === "string") {
      if (!s) continue;
      out[k] = s;
    } else if (typeof s === "number") {
      if (!Number.isFinite(s)) continue;
      out[k] = s;
    }
  }
  return out;
}

function hasAnyContactValue(c) {
  const x = c || {};
  return (
    !!cleanStr(x.firstName) ||
    !!cleanStr(x.lastName) ||
    !!cleanStr(x.emailAddress) ||
    !!cleanStr(x.phoneNumber) ||
    !!cleanStr(x.accountName)
  );
}

function getNextMissingField(contact) {
  const c = contact || {};
  for (const f of CONTACT_FIELDS_FLOW) {
    const k = f.key;
    if (k === "opportunityAmount") {
      if (c[k] === null || c[k] === undefined || c[k] === "") return f;
      continue;
    }
    if (!cleanStr(c[k])) return f;
  }
  return null;
}

function applyPendingField(contact, pendingKey, userMessage) {
  if (!pendingKey) return contact;

  const c = { ...(contact || {}) };
  const msg = cleanStr(userMessage);
  if (!msg) return c;

  if (pendingKey === "emailAddress") {
    const em = extractEmailFromText(msg);
    if (em) c.emailAddress = em;
    return c;
  }

  if (pendingKey === "phoneNumber") {
    const ph = extractPhoneFromText(msg);
    if (ph) c.phoneNumber = ph;
    return c;
  }

  if (pendingKey === "opportunityAmount") {
    const n = Number(String(msg).replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) c.opportunityAmount = n;
    return c;
  }

  // If we were asking firstName/lastName and user gave full name, split it
  if (pendingKey === "firstName" || pendingKey === "lastName") {
    const cleaned = normalizeNameText(msg);
    const sal = detectSalutation(cleaned);
    const noSal = cleaned.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").trim();
    const parts = noSal.split(/\s+/).filter(Boolean);

    if (sal && !cleanStr(c.salutationName)) c.salutationName = sal;

    if (parts.length >= 2) {
      c.firstName = parts[0];
      c.lastName = parts.slice(1).join(" ");
      return c;
    }

    if (parts.length === 1) {
      if (pendingKey === "firstName") c.firstName = parts[0];
      else c.lastName = parts[0];
    }
    return c;
  }

  c[pendingKey] = msg;
  return c;
}

function autoFillNameAndSalutation(contact, message) {
  let c = { ...(contact || {}) };

  // If firstName is empty, try to extract from "my name is ..."
  if (!cleanStr(c.firstName)) {
    const got = extractNameFromText(message);
    if (got.firstName) c.firstName = got.firstName;
    if (got.lastName) c.lastName = got.lastName;
    if (got.salutationName && !cleanStr(c.salutationName)) c.salutationName = got.salutationName;
  }

  // If firstName contains full name, split it
  if (cleanStr(c.firstName) && !cleanStr(c.lastName)) {
    const parts = normalizeNameText(c.firstName).split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const sal = detectSalutation(c.firstName);
      const noSal = normalizeNameText(c.firstName).replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").trim();
      const pp = noSal.split(/\s+/).filter(Boolean);
      c.firstName = pp[0] || c.firstName;
      c.lastName = pp.slice(1).join(" ") || "";
      if (sal && !cleanStr(c.salutationName)) c.salutationName = sal;
    }
  }

  // Salutation:
  // - if user explicitly wrote Mr/Ms/Dr anywhere, set it
  // - else optional default from env
  if (!cleanStr(c.salutationName)) {
    const sal = detectSalutation(message);
    if (sal) c.salutationName = sal;
  }
  if (!cleanStr(c.salutationName)) {
    const def = cleanStr(process.env.CHAT_DEFAULT_SALUTATION); // e.g. "Mr." or "Ms."
    if (def) c.salutationName = def;
  }

  return c;
}

async function upsertContactInformationToEspo({ contact, existingId }) {
  const entity = cleanStr(process.env.CHAT_CONTACT_ENTITY) || "ContactInformation";

  const payload = {
    salutationName: cleanStr(contact?.salutationName) || undefined,
    firstName: cleanStr(contact?.firstName) || undefined,
    lastName: cleanStr(contact?.lastName) || undefined,
    middleName: cleanStr(contact?.middleName) || undefined,
    emailAddress: cleanStr(contact?.emailAddress) || undefined,
    phoneNumber: cleanStr(contact?.phoneNumber) || undefined,
    accountName: cleanStr(contact?.accountName) || undefined,
    addressStreet: cleanStr(contact?.addressStreet) || undefined,
    addressCity: cleanStr(contact?.addressCity) || undefined,
    addressState: cleanStr(contact?.addressState) || undefined,
    addressCountry: cleanStr(contact?.addressCountry) || undefined,
    addressPostalCode: cleanStr(contact?.addressPostalCode) || undefined,
    opportunityAmountCurrency: cleanStr(contact?.opportunityAmountCurrency) || undefined,
    opportunityAmount:
      contact?.opportunityAmount !== null &&
      contact?.opportunityAmount !== undefined &&
      contact?.opportunityAmount !== ""
        ? Number(contact.opportunityAmount)
        : undefined,
    cBusinessType: cleanStr(contact?.cBusinessType) || undefined,
    cFabricCategory: cleanStr(contact?.cFabricCategory) || undefined,
  };

  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  if (!Object.keys(payload).length) {
    return { ok: false, skipped: true, id: existingId || null, entity };
  }

  try {
    if (existingId) {
      const updated = await espoRequest(`/${entity}/${existingId}`, {
        method: "PUT",
        body: payload,
      });
      return { ok: true, id: updated?.id || existingId, entity, updated: true };
    }

    const created = await espoRequest(`/${entity}`, {
      method: "POST",
      body: payload,
    });

    return { ok: true, id: created?.id || null, entity, created: true };
  } catch (e) {
    console.warn("[chat] contactinformation upsert failed:", e?.status, e?.data || e?.message);
    return { ok: false, id: existingId || null, entity, error: e?.message || "failed" };
  }
}

/* ------------------------------ intent parsing ------------------------------ */
async function parseUserMessageWithOpenAI({ message, context }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string" },
      intent: {
        type: "string",
        enum: ["availability", "details", "recommend", "lead", "smalltalk", "unknown"],
      },
      detail: { type: "string", enum: ["auto", "yesno", "short", "long"] },
      refersToPrevious: { type: "boolean" },
      query: {
        type: "object",
        additionalProperties: false,
        properties: {
          keywords: { type: "array", items: { type: "string" } },
          color: { type: ["string", "null"] },
          weave: { type: ["string", "null"] },
          design: { type: ["string", "null"] },
          structure: { type: ["string", "null"] },
          content: { type: "array", items: { type: "string" } },
          gsm: {
            type: "object",
            additionalProperties: false,
            properties: { min: { type: ["number", "null"] }, max: { type: ["number", "null"] } },
            required: ["min", "max"],
          },
        },
        required: ["keywords", "color", "weave", "design", "structure", "content", "gsm"],
      },

      contact: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          salutationName: { type: ["string", "null"] },
          firstName: { type: ["string", "null"] },
          lastName: { type: ["string", "null"] },
          middleName: { type: ["string", "null"] },
          emailAddress: { type: ["string", "null"] },
          phoneNumber: { type: ["string", "null"] },
          accountName: { type: ["string", "null"] },
          addressStreet: { type: ["string", "null"] },
          addressCity: { type: ["string", "null"] },
          addressState: { type: ["string", "null"] },
          addressCountry: { type: ["string", "null"] },
          addressPostalCode: { type: ["string", "null"] },
          opportunityAmountCurrency: { type: ["string", "null"] },
          opportunityAmount: { type: ["number", "null"] },
          cBusinessType: { type: ["string", "null"] },
          cFabricCategory: { type: ["string", "null"] },
        },
        required: [
          "salutationName",
          "firstName",
          "lastName",
          "middleName",
          "emailAddress",
          "phoneNumber",
          "accountName",
          "addressStreet",
          "addressCity",
          "addressState",
          "addressCountry",
          "addressPostalCode",
          "opportunityAmountCurrency",
          "opportunityAmount",
          "cBusinessType",
          "cFabricCategory",
        ],
      },
    },
    required: ["language", "intent", "detail", "refersToPrevious", "query", "contact"],
  };

  const pendingField = cleanStr(context?.contactFlow?.pendingField);

  const system =
    "You are a routing classifier for a fabric catalogue chat assistant. " +
    "Detect the user's language and set language to a short code like en/hi/gu/ar/fr/es. " +
    "Decide the user intent and extract search cues. " +
    "Output ONLY JSON matching the schema. " +
    "If user asks if fabric exists -> intent=availability and detail=yesno. " +
    "If user asks for more info/details -> intent=details and detail=short/long. " +
    "If user wants suggestions -> intent=recommend. " +
    "If user wants price/quote/contact -> intent=lead. " +
    "If user refers to it/this/that and context has previous product -> refersToPrevious=true. " +
    "For non-English queries, extract keywords in English if possible (to match English catalogue). " +
    (pendingField
      ? `IMPORTANT: The context indicates we are currently collecting "${pendingField}". If the user message contains an answer, put it into contact.${pendingField}.`
      : "");

  const user =
    `User message: ${message}\n\n` +
    `Context (may be empty): ${safeJson(context || {})}`;

  return openaiJson("chat_action", schema, system, user);
}

function heuristicIntent(message, mode) {
  const m = norm(message);
  const wantsLong =
    mode === "long" || m.includes("long") || m.includes("full") || m.includes("detail") || m.includes("describe");
  const wantsShort =
    mode === "short" || m.includes("short") || m.includes("summary") || m.includes("brief");
  const detail = wantsLong ? "long" : wantsShort ? "short" : "auto";

  if (m.includes("tell me more") || m.includes("details") || m.includes("more about") || m.includes("spec")) {
    return { intent: "details", detail };
  }
  if (m.includes("do you have") || m.includes("available") || m.includes("in stock") || m.startsWith("is ") || m.includes("have ")) {
    return { intent: "availability", detail };
  }
  if (m.includes("recommend") || m.includes("suggest") || m.includes("best") || m.includes("options")) {
    return { intent: "recommend", detail };
  }
  if (m.includes("contact") || m.includes("call me") || m.includes("whatsapp") || m.includes("price") || m.includes("quote")) {
    return { intent: "lead", detail };
  }
  if (m === "hi" || m === "hello" || m.includes("hii")) {
    return { intent: "smalltalk", detail };
  }
  return { intent: "unknown", detail };
}

function normalizeDetail(actionDetail, requestedMode) {
  const m = requestedMode === "short" || requestedMode === "long" ? requestedMode : null;
  if (m) return m;
  if (actionDetail === "short" || actionDetail === "long") return actionDetail;
  return "auto";
}

/* ------------------------------ product matching ------------------------------ */
function buildProductText(p) {
  const parts = [];
  parts.push(pickFirstNonEmpty(p.name, p.productTitle));
  parts.push(pickFirstNonEmpty(p.fabricCode, p.vendorFabricCode));
  parts.push(pickFirstNonEmpty(p.category));
  parts.push(toArr(p.color).map(cleanStr).join(" "));
  parts.push(toArr(p.content).map(cleanStr).join(" "));
  parts.push(toArr(p.finish).map(cleanStr).join(" "));
  parts.push(toArr(p.structure).map(cleanStr).join(" "));
  parts.push(toArr(p.design).map(cleanStr).join(" "));
  parts.push(pickFirstNonEmpty(p.productslug));
  parts.push(pickFirstNonEmpty(p.description));
  parts.push(pickFirstNonEmpty(p.fullProductDescription));
  parts.push(toArr(p.keywords).map(cleanStr).join(" "));
  return norm(parts.filter(Boolean).join(" \n "));
}

function scoreProduct(p, query) {
  const text = buildProductText(p);
  let score = 0;

  const tokens = [];
  if (query?.keywords?.length) tokens.push(...query.keywords);
  if (query?.color) tokens.push(query.color);
  if (query?.weave) tokens.push(query.weave);
  if (query?.design) tokens.push(query.design);
  if (query?.structure) tokens.push(query.structure);
  if (Array.isArray(query?.content)) tokens.push(...query.content);

  const uniq = Array.from(new Set(tokens.map(norm).filter(Boolean)));

  for (const t of uniq) {
    if (!t || t.length < 2) continue;
    if (text.includes(t)) score += 2;
  }

  const name = norm(pickFirstNonEmpty(p.name, p.productTitle));
  const slug = norm(p.productslug);
  const code = norm(pickFirstNonEmpty(p.fabricCode, p.vendorFabricCode));

  for (const t of uniq) {
    if (!t) continue;
    if (name.includes(t)) score += 6;
    if (slug.includes(t)) score += 5;
    if (code && code.includes(t)) score += 7;
  }

  if (query?.color) {
    const colors = toArr(p.color).map(norm);
    if (colors.some((c) => c === norm(query.color))) score += 12;
  }

  if (query?.weave) {
    const structure = toArr(p.structure).map(norm);
    if (structure.some((s) => s.includes(norm(query.weave)))) score += 6;
  }

  if (query?.gsm && (query.gsm.min !== null || query.gsm.max !== null)) {
    const gsmVal = Number(p.gsm);
    if (Number.isFinite(gsmVal)) {
      const min = query.gsm.min !== null ? Number(query.gsm.min) : null;
      const max = query.gsm.max !== null ? Number(query.gsm.max) : null;
      if ((min === null || gsmVal >= min) && (max === null || gsmVal <= max)) score += 4;
    }
  }

  return score;
}

async function fetchCandidateProducts() {
  const maxSize = Number(process.env.CHAT_PRODUCT_MAX_SIZE || 200);
  const data = await espoRequest(`/CProduct`, {
    query: { maxSize, offset: 0, orderBy: "modifiedAt", order: "desc" },
  });

  const list = Array.isArray(data?.list) ? data.list : [];

  const rawTag = process.env.CHAT_REQUIRE_MERCHTAG;
  const requireTag = rawTag === undefined ? "ecatalogue" : norm(rawTag);
  const enforceTag = !!requireTag && !["none", "off", "0"].includes(requireTag);

  return enforceTag
    ? list.filter((p) => uniqList(p.merchTags, 20).map(norm).includes(requireTag))
    : list;
}

/* ------------------------------ HUMAN SUMMARIES ------------------------------ */
function stripHtmlToText(html) {
  const s = cleanStr(html);
  if (!s) return "";
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function humanShort(p) {
  const title = pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode);
  const code = getFabricCode(p);
  const url = buildFrontendUrl(p);

  const category = cleanStr(p.category);
  const color = niceJoin(p.color, ", ", 3);
  const content = niceJoin(p.content, ", ", 3);
  const weave = niceJoin(p.structure, ", ", 2) || niceJoin(p.weave, ", ", 2);
  const finish = niceFinish(p.finish, 4);
  const design = niceJoin(p.design, ", ", 2);

  const gsm = fmtNum(p.gsm);
  const width = fmtNum(p.cm);

  const parts = [];

  let first = title || "We have a matching fabric";
  if (color) first += ` (${color})`;
  parts.push(first + ".");

  if (code) parts.push(`Code: ${code}`);
  if (url) parts.push(`Link: ${url}`);

  const specBits = [];
  if (category) specBits.push(category);
  if (weave) specBits.push(weave);
  if (content) specBits.push(content);
  if (gsm) specBits.push(`${gsm} GSM`);
  if (width) specBits.push(`${width} cm width`);
  if (specBits.length) parts.push(`Specs: ${specBits.join(" · ")}.`);

  const extraBits = [];
  if (finish) extraBits.push(`Finish: ${finish}`);
  if (design) extraBits.push(`Design: ${design}`);
  if (extraBits.length) parts.push(extraBits.join(" | ") + ".");

  return parts.join("\n");
}

function humanLong(p) {
  const lines = [];
  lines.push(humanShort(p));

  const supply = cleanStr(p.supplyModel);
  const moq = cleanStr(p.salesMOQ || p.moq);
  const suitability = niceJoin(p.suitability, ", ", 6);

  const more = [];
  if (supply) more.push(`Supply model: ${supply}`);
  if (moq) more.push(`MOQ: ${moq}`);
  if (suitability) more.push(`Suggested for: ${suitability}`);
  if (more.length) lines.push("\n" + more.join("\n"));

  const desc = stripHtmlToText(p.fullProductDescription || p.description);
  if (desc) {
    const max = Number(process.env.CHAT_MAX_DESC_CHARS || 420);
    const snippet = desc.length > max ? desc.slice(0, max).trim() + "..." : desc;
    lines.push("\n" + snippet);
  }

  return lines.join("\n");
}

/* ------------------------------ main handler ------------------------------ */
async function handleChatMessage(req, res) {
  const message = cleanStr(req.body?.message);
  const mode = cleanStr(req.body?.mode) || "auto";
  const incomingContext =
    req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const sessionId = cleanStr(req.body?.sessionId) || "";

  if (!message) {
    return sendChatResponse(req, res, 400, {
      ok: false,
      error: "message is required",
      replyText: "message is required",
    });
  }

  let sessionCtx = {};
  if (sessionId) sessionCtx = SESSION_STORE.get(sessionId) || {};
  const context = { ...sessionCtx, ...incomingContext };

  const prevContact =
    context?.contactFlow?.contact && typeof context.contactFlow.contact === "object"
      ? context.contactFlow.contact
      : {};
  const prevContactId = cleanStr(context?.contactFlow?.contactInfoId);
  const pendingField = cleanStr(context?.contactFlow?.pendingField);

  let action;
  let language = "en";

  try {
    action = await parseUserMessageWithOpenAI({ message, context });
    language = cleanStr(action?.language) || "en";
  } catch {
    const h = heuristicIntent(message, mode);
    action = {
      language: detectLangFallback(message),
      ...h,
      detail: h.detail,
      refersToPrevious: false,
      query: {
        keywords: tokenize(message).slice(0, 8),
        color: null,
        weave: null,
        design: null,
        structure: null,
        content: [],
        gsm: { min: null, max: null },
      },
      contact: null,
      _openai_error: true,
    };
    language = action.language;
  }

  const intent = action?.intent || "unknown";
  const detail = normalizeDetail(action?.detail, mode);

  // Step-by-step contact collection
  let contact = applyPendingField(prevContact, pendingField, message);

  // Quick heuristics even without OpenAI
  if (!cleanStr(contact.emailAddress)) {
    const em = extractEmailFromText(message);
    if (em) contact.emailAddress = em;
  }
  if (!cleanStr(contact.phoneNumber)) {
    const ph = extractPhoneFromText(message);
    if (ph) contact.phoneNumber = ph;
  }

  // Merge extracted contact (OpenAI)
  if (action?.contact && typeof action.contact === "object") {
    contact = mergeContact(contact, action.contact);
  }

  // IMPORTANT FIX: if user said "my name is ..." then do NOT ask firstName again
  contact = autoFillNameAndSalutation(contact, message);

  // Save/update ContactInformation whenever we have anything useful
  let contactInfoId = prevContactId;
  if (hasAnyContactValue(contact)) {
    const saved = await upsertContactInformationToEspo({
      contact,
      existingId: contactInfoId || null,
    });
    if (saved.ok && saved.id) contactInfoId = saved.id;
  }

  /* ------------------------------ Product logic ------------------------------ */
  let products = [];
  try {
    products = await fetchCandidateProducts();
  } catch (e) {
    const out = {
      ok: false,
      error: "Failed to fetch catalogue data from EspoCRM",
      replyText: "I’m unable to check the catalogue right now. Please try again in a minute.",
      meta: { ts: nowIso(), intent, language, openaiUsed: !action?._openai_error },
      details: e?.data || e?.message,
    };

    out.replyText = await maybeTranslateReply({ replyText: out.replyText, language, userMessage: message });
    return sendChatResponse(req, res, 502, out);
  }

  const query = action?.query || {};
  const ranked = products
    .map((p) => ({ p, score: scoreProduct(p, query) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0]?.p || null;
  const topScore = ranked[0]?.score || 0;

  const minScore = Number(process.env.CHAT_MIN_SCORE || 10);
  const hasMatch = !!top && topScore >= minScore;

  const ctxIds = Array.isArray(context?.lastProductIds) ? context.lastProductIds : [];
  const refersToPrev = !!action?.refersToPrevious;
  let focused = top;

  if (refersToPrev && ctxIds.length) {
    const byId = new Map(ranked.map(({ p }) => [p.id, p]));
    focused = byId.get(ctxIds[0]) || top;
  }

  const suggestions = ranked
    .filter((x) => x.score > 0)
    .slice(0, 6)
    .map(({ p }) => {
      const title = pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode);
      const code = getFabricCode(p);
      const url = buildFrontendUrl(p);
      const label = code ? `${code} — ${title}` : title;
      return { id: p.id, label, code, url };
    });

  const m = norm(message);
  const askedDetailNow =
    m.includes("detail") ||
    m.includes("details") ||
    m.includes("tell me more") ||
    m.includes("describe") ||
    m.includes("about it");

  let replyText = "";
  let nextContext = { ...context, lastIntent: intent };

  if (intent === "availability") {
    if (hasMatch) {
      if (askedDetailNow || detail === "short" || detail === "long") {
        const p = focused || top;
        replyText =
          "Yes — we have it.\n\n" +
          (detail === "long" ? humanLong(p) : humanShort(p)) +
          "\n\nWant price/MOQ or should I suggest 2–3 similar options?";
      } else {
        replyText = "Yes — we have matching fabrics in our catalogue. Do you want details?";
      }

      nextContext = {
        ...nextContext,
        lastProductIds: suggestions.map((s) => s.id),
        lastProduct: focused
          ? { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name) }
          : null,
      };
    } else {
      replyText =
        "I couldn’t find an exact match in our catalogue. Can you share GSM, content (cotton/poly), and weave (poplin/twill/denim)?";
      nextContext = { ...nextContext, lastProductIds: [] };
    }
  } else if (intent === "details") {
    if (!hasMatch && !refersToPrev) {
      replyText = "Which fabric should I describe? Share the name/code/slug (or color + weave + GSM).";
    } else {
      const p = focused;
      replyText = p ? (detail === "long" ? humanLong(p) : humanShort(p)) : "Which fabric should I describe?";
      if (p) {
        nextContext = {
          ...nextContext,
          lastProductIds: [p.id],
          lastProduct: { id: p.id, slug: p.productslug, name: pickFirstNonEmpty(p.productTitle, p.name) },
        };
      }
    }
  } else if (intent === "recommend") {
    if (hasMatch) {
      const top3 = ranked
        .filter((x) => x.score > 0)
        .slice(0, 3)
        .map(({ p }) => {
          const title = pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode);
          const code = getFabricCode(p);
          const url = buildFrontendUrl(p);

          const gsm = fmtNum(p.gsm);
          const color = niceJoin(p.color, ", ", 2);
          const meta = [cleanStr(p.category), gsm ? `${gsm} GSM` : "", color].filter(Boolean).join(" · ");

          const head = `${code ? `${code} — ` : ""}${title}${meta ? ` (${meta})` : ""}`;
          return url ? `• ${head}\n  ${url}` : `• ${head}`;
        });

      replyText = `Here are a few matching options:\n${top3.join("\n")}\n\nWant details for the best match?`;
      nextContext = {
        ...nextContext,
        lastProductIds: suggestions.map((s) => s.id),
        lastProduct: focused
          ? { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name) }
          : null,
      };
    } else {
      replyText = "I couldn’t find close matches. Tell me color, GSM range, content, and end-use (shirts/dresses/uniforms).";
      nextContext = { ...nextContext, lastProductIds: [] };
    }
  } else {
    replyText = "Tell me what fabric you’re looking for (color, weave/structure, GSM, content). I’ll check our catalogue.";
  }

  // Ask ONE missing contact question along with the response
  const shouldAskContact = intent === "availability" || intent === "details" || intent === "recommend";

  // Re-evaluate missing fields AFTER auto-fill name
  const nextMissing = shouldAskContact ? getNextMissingField(contact) : null;
  const nextPendingField = nextMissing ? nextMissing.key : "";

  if (shouldAskContact && nextMissing) {
    replyText = `${replyText}\n\n${nextMissing.q}`;
  }

  nextContext = {
    ...nextContext,
    contactFlow: {
      contact,
      contactInfoId: contactInfoId || null,
      pendingField: nextPendingField || "",
      lastAskedAt: nowIso(),
    },
  };

  const out = {
    ok: true,
    replyText,
    suggestions,
    context: nextContext,
    meta: { ts: nowIso(), intent, topScore, language, openaiUsed: !action?._openai_error },
  };

  if (sessionId) SESSION_STORE.set(sessionId, nextContext);

  out.replyText = await maybeTranslateReply({
    replyText: out.replyText,
    language,
    userMessage: message,
  });

  return sendChatResponse(req, res, 200, out);
}

module.exports = { handleChatMessage };
