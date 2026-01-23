// controller/chatController.js
const { espoRequest } = require("./espoClient");

/**
 * In-memory conversation state (optional).
 * NOTE: In serverless environments this may reset; the frontend should pass back `context`.
 */
const SESSION_STORE = globalThis.__AGE_CHAT_SESSIONS || new Map();
globalThis.__AGE_CHAT_SESSIONS = SESSION_STORE;

const DEFAULT_LEAD_CAPTURE_URL =
  "https://espo.egport.com/api/v1/LeadCapture/a4624c9bb58b8b755e3d94f1a25fc9be";

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
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

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return "{}";
  }
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = cleanStr(v);
    if (s) return s;
  }
  return "";
}

/** ----------------------------- FRONTEND URL helpers ----------------------------- **/

function joinUrl(base, slug) {
  const b = cleanStr(base);
  const s = cleanStr(slug);
  if (!b || !s) return "";
  const bb = b.endsWith("/") ? b.slice(0, -1) : b;
  const ss = s.startsWith("/") ? s.slice(1) : s;
  return `${bb}/${ss}`;
}

function getFrontendUrlForProduct(p) {
  const base = cleanStr(process.env.AGE_FRONTEND_URL);
  const slug = cleanStr(p?.productslug);
  if (!base || !slug) return "";
  return joinUrl(base, slug);
}

function getFabricCode(p) {
  return pickFirstNonEmpty(p?.fabricCode, p?.vendorFabricCode);
}

/** ----------------------------- Product text & scoring ----------------------------- **/

function buildProductText(p) {
  const parts = [];
  parts.push(pickFirstNonEmpty(p.name, p.productTitle));
  parts.push(getFabricCode(p));
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
  const code = norm(getFabricCode(p));
  for (const t of uniq) {
    if (!t) continue;
    if (name.includes(t)) score += 6;
    if (slug.includes(t)) score += 5;
    if (code && code.includes(t)) score += 7;
  }

  // Strong boosts for exact-ish matches on arrays
  if (query?.color) {
    const colors = toArr(p.color).map(norm);
    if (colors.some((c) => c === norm(query.color))) score += 12;
  }

  if (query?.weave) {
    const structure = toArr(p.structure).map(norm);
    if (structure.some((s) => s.includes(norm(query.weave)))) score += 6;
  }

  // Numeric range soft match (if product has gsm)
  if (query?.gsm && (query.gsm.min !== null || query.gsm.max !== null)) {
    const gsmVal = Number(p.gsm);
    if (Number.isFinite(gsmVal)) {
      const min = query.gsm.min !== null ? Number(query.gsm.min) : null;
      const max = query.gsm.max !== null ? Number(query.gsm.max) : null;
      if ((min === null || gsmVal >= min) && (max === null || gsmVal <= max)) {
        score += 4;
      }
    }
  }

  return score;
}

async function fetchCandidateProducts() {
  // Pull a manageable set, then rank locally.
  const maxSize = Number(process.env.CHAT_PRODUCT_MAX_SIZE || 200);
  const data = await espoRequest(`/CProduct`, {
    query: {
      maxSize,
      offset: 0,
      orderBy: "modifiedAt",
      order: "desc",
    },
  });

  const list = Array.isArray(data?.list) ? data.list : [];

  // Optional: keep only products intended for catalogue.
  const rawTag = process.env.CHAT_REQUIRE_MERCHTAG;
  const requireTag = rawTag === undefined ? "ecatalogue" : norm(rawTag);
  const enforceTag = !!requireTag && !["none", "off", "0"].includes(requireTag);

  const filtered = enforceTag
    ? list.filter((p) => {
        const tags = toArr(p.merchTags).map(norm);
        return tags.includes(requireTag);
      })
    : list;

  return filtered;
}

/** ----------------------------- OpenAI helpers ----------------------------- **/

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
  } catch (e) {
    const err = new Error("Failed to parse OpenAI JSON output");
    err.status = 502;
    err.data = { raw: text };
    throw err;
  }
}

async function openaiText(system, user, maxTokens = 300) {
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
    max_output_tokens: Number(maxTokens || 300),
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

  return cleanStr(extractOutputText(json));
}

/** ----------------------------- Contact extraction & merge ----------------------------- **/

function digitsOnlyPhone(s) {
  const raw = cleanStr(s);
  if (!raw) return "";
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  // keep + if provided
  return hasPlus ? `+${digits}` : digits;
}

function extractEmailHeuristic(text) {
  const m = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function extractPhoneHeuristic(text) {
  const m = String(text || "").match(/(\+?\d[\d\s\-()]{8,}\d)/);
  return m ? digitsOnlyPhone(m[1]) : "";
}

function extractNameHeuristic(text) {
  const t = cleanStr(text);
  if (!t) return "";

  const m1 = t.match(/\bmy name is\s+([^,.;\d]+)\b/i);
  if (m1) return cleanStr(m1[1]);

  const m2 = t.match(/\bi am\s+([^,.;\d]+)\b/i);
  if (m2) {
    const candidate = cleanStr(m2[1]);
    // avoid "i am looking..." etc.
    if (candidate && candidate.split(/\s+/).length <= 4) return candidate;
  }

  return "";
}

function parseSalutation(nameText) {
  const s = norm(nameText);
  if (!s) return null;
  if (s.includes("mr ")) return "Mr.";
  if (s.includes("mrs ")) return "Mrs.";
  if (s.includes("ms ")) return "Ms.";
  if (s.includes("miss ")) return "Ms.";
  if (s.includes("dr ")) return "Dr.";
  return null;
}

function splitNameParts(fullName) {
  const n = cleanStr(fullName).replace(/\s+/g, " ").trim();
  if (!n) return { firstName: null, middleName: null, lastName: null };
  const parts = n.split(" ").filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], middleName: null, lastName: null };
  if (parts.length === 2) return { firstName: parts[0], middleName: null, lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(" "), lastName: parts[parts.length - 1] };
}

function cleanNullString(v) {
  const s = cleanStr(v);
  return s ? s : null;
}

function mergeContactInfo(base, incoming) {
  const b = base && typeof base === "object" ? base : {};
  const i = incoming && typeof incoming === "object" ? incoming : {};

  const out = { ...b };

  // Merge string-ish fields: only fill if missing
  const fields = [
    "salutationName",
    "firstName",
    "middleName",
    "lastName",
    "emailAddress",
    "phoneNumber",
    "accountName",
    "addressStreet",
    "addressCity",
    "addressState",
    "addressCountry",
    "addressPostalCode",
    "opportunityAmountCurrency",
    "cBusinessType",
    "cFabricCategory",
  ];

  for (const f of fields) {
    if (!cleanStr(out[f]) && cleanStr(i[f])) out[f] = cleanStr(i[f]);
  }

  // numeric
  if ((out.opportunityAmount === null || out.opportunityAmount === undefined || out.opportunityAmount === "") &&
      (i.opportunityAmount !== null && i.opportunityAmount !== undefined && i.opportunityAmount !== "")) {
    const n = Number(i.opportunityAmount);
    out.opportunityAmount = Number.isFinite(n) ? n : out.opportunityAmount;
  }

  // normalize phone
  if (cleanStr(out.phoneNumber)) out.phoneNumber = digitsOnlyPhone(out.phoneNumber);

  return out;
}

function enrichContactFromHeuristics(message, contactInfo) {
  const c = { ...(contactInfo || {}) };

  const email = extractEmailHeuristic(message);
  const phone = extractPhoneHeuristic(message);
  const fullName = extractNameHeuristic(message);
  const sal = parseSalutation(message);

  if (!cleanStr(c.emailAddress) && email) c.emailAddress = email;
  if (!cleanStr(c.phoneNumber) && phone) c.phoneNumber = phone;

  if (!cleanStr(c.salutationName) && sal) c.salutationName = sal;

  if (!cleanStr(c.firstName) && fullName) {
    const parts = splitNameParts(fullName);
    if (parts.firstName) c.firstName = parts.firstName;
    if (parts.middleName) c.middleName = parts.middleName;
    if (parts.lastName) c.lastName = parts.lastName;
  }

  return c;
}

function contactHasAny(c) {
  return (
    !!cleanStr(c?.firstName) ||
    !!cleanStr(c?.lastName) ||
    !!cleanStr(c?.emailAddress) ||
    !!cleanStr(c?.phoneNumber) ||
    !!cleanStr(c?.accountName)
  );
}

/** Ask ONE field at a time (step-by-step) */
function nextMissingContactField(contactInfo) {
  const c = contactInfo || {};

  // Don’t ask salutation; auto if found, else skip.
  const order = [
    "firstName",
    "accountName",
    "cBusinessType",
    "phoneNumber",
    "emailAddress",
    "addressCity",
    "addressState",
    "addressCountry",
    "addressPostalCode",
    "cFabricCategory",
    // optional money fields last
    "opportunityAmountCurrency",
    "opportunityAmount",
  ];

  for (const f of order) {
    if (f === "opportunityAmount") {
      if (c.opportunityAmount === null || c.opportunityAmount === undefined || c.opportunityAmount === "") return f;
      continue;
    }
    if (!cleanStr(c[f])) return f;
  }
  return null;
}

function englishQuestionForField(field) {
  switch (field) {
    case "firstName":
      return "What’s your first name?";
    case "accountName":
      return "Which company are you from?";
    case "cBusinessType":
      return "What best describes you (brand / garment manufacturer / trader / exporter)?";
    case "phoneNumber":
      return "What’s your WhatsApp/phone number?";
    case "emailAddress":
      return "What’s your email address?";
    case "addressCity":
      return "Which city are you in?";
    case "addressState":
      return "Which state/region are you in?";
    case "addressCountry":
      return "Which country are you in?";
    case "addressPostalCode":
      return "What’s your postal/ZIP code?";
    case "cFabricCategory":
      return "Which fabric category are you mainly looking for (woven/knit/denim/poplin etc.)?";
    case "opportunityAmountCurrency":
      return "Which currency should we use for quotes (INR/USD/EUR)?";
    case "opportunityAmount":
      return "What’s your expected order value / budget (approx.)?";
    default:
      return "";
  }
}

/** ----------------------------- Intent parsing (OpenAI) ----------------------------- **/

function heuristicIntent(message, mode) {
  const m = norm(message);
  const wantsLong =
    mode === "long" ||
    m.includes("long") ||
    m.includes("full") ||
    m.includes("detail") ||
    m.includes("describe");
  const wantsShort =
    mode === "short" ||
    m.includes("short") ||
    m.includes("summary") ||
    m.includes("brief");
  const detail = wantsLong ? "long" : wantsShort ? "short" : "auto";

  if (m.includes("tell me more") || m.includes("details") || m.includes("more about") || m.includes("spec")) {
    return { intent: "details", detail };
  }
  if (m.includes("do you have") || m.includes("available") || m.includes("in stock") || m.startsWith("is ") || m.includes("have ")) {
    return { intent: "availability", detail: "yesno" };
  }
  if (m.includes("recommend") || m.includes("suggest") || m.includes("best") || m.includes("options") || m.includes("list")) {
    return { intent: "recommend", detail };
  }
  if (m.includes("contact") || m.includes("call me") || m.includes("whatsapp") || m.includes("price") || m.includes("quote")) {
    return { intent: "lead", detail };
  }
  return { intent: "unknown", detail };
}

function normalizeDetail(actionDetail, requestedMode) {
  const m = requestedMode === "short" || requestedMode === "long" ? requestedMode : null;
  if (m) return m;
  if (actionDetail === "short" || actionDetail === "long" || actionDetail === "yesno") return actionDetail;
  return "auto";
}

async function parseUserMessageWithOpenAI({ message, context }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string" }, // BCP-47 like "en", "hi", "gu", "ar", etc.
      intent: {
        type: "string",
        enum: ["availability", "details", "recommend", "lead", "smalltalk", "unknown"],
      },
      detail: {
        type: "string",
        enum: ["auto", "yesno", "short", "long"],
      },
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
            properties: {
              min: { type: ["number", "null"] },
              max: { type: ["number", "null"] },
            },
            required: ["min", "max"],
          },
        },
        required: ["keywords", "color", "weave", "design", "structure", "content", "gsm"],
      },
      contactInfo: {
        type: "object",
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
    required: ["language", "intent", "detail", "refersToPrevious", "query", "contactInfo"],
  };

  const system =
    "You are a routing + extraction engine for a fabric catalogue chat assistant.\n" +
    "Return ONLY JSON matching the schema.\n" +
    "1) Detect the user's language as a BCP-47 code (e.g., en, hi, gu, ar).\n" +
    "2) intent rules:\n" +
    " - If asking if a fabric exists/available => intent=availability, detail=yesno.\n" +
    " - If asking to know more/spec/details => intent=details, detail=short/long depending on words.\n" +
    " - If asking for suggestions/options/list => intent=recommend.\n" +
    " - If asking price/quote/contact/call/WhatsApp => intent=lead.\n" +
    " - Greetings/small talk => smalltalk.\n" +
    "3) Extract search cues (color/weave/content/keywords). IMPORTANT: translate these cues into ENGLISH when possible so matching works against an English product database.\n" +
    "4) Extract contactInfo fields from the user's message if present (name, email, phone, company, city/country, etc.). If unknown, set null.\n" +
    "5) If the user refers to 'it/this/that' and context indicates a previous product, set refersToPrevious=true.";

  const user =
    `User message: ${message}\n\n` +
    `Context (may be empty): ${safeJson(context || {})}`;

  return openaiJson("chat_action_v2", schema, system, user);
}

/** ----------------------------- LeadCapture save/update ----------------------------- **/

function getLeadCaptureUrl() {
  return cleanStr(process.env.LEAD_CAPTURE_URL) || DEFAULT_LEAD_CAPTURE_URL;
}

function getSessionCloseMs() {
  const mins = Number(process.env.CHAT_SESSION_CLOSE_MINUTES || 45);
  return Math.max(5, mins) * 60 * 1000;
}

function buildLeadCapturePayload(contactInfo, extra = {}) {
  const c = contactInfo || {};

  const payload = {
    salutationName: cleanNullString(c.salutationName),
    firstName: cleanNullString(c.firstName),
    lastName: cleanNullString(c.lastName),
    middleName: cleanNullString(c.middleName),
    emailAddress: cleanNullString(c.emailAddress),
    phoneNumber: cleanNullString(c.phoneNumber),
    accountName: cleanNullString(c.accountName),
    addressStreet: cleanNullString(c.addressStreet),
    addressCity: cleanNullString(c.addressCity),
    addressState: cleanNullString(c.addressState),
    addressCountry: cleanNullString(c.addressCountry),
    addressPostalCode: cleanNullString(c.addressPostalCode),
    opportunityAmountCurrency: cleanNullString(c.opportunityAmountCurrency),
    opportunityAmount:
      c.opportunityAmount === null || c.opportunityAmount === undefined || c.opportunityAmount === ""
        ? null
        : Number(c.opportunityAmount),
    cBusinessType: cleanNullString(c.cBusinessType),
    cFabricCategory: cleanNullString(c.cFabricCategory),

    // Extra allowed fields (only if your LeadCapture endpoint accepts them)
    ...extra,
  };

  // Remove null/invalid numeric
  if (payload.opportunityAmount !== null && !Number.isFinite(payload.opportunityAmount)) {
    payload.opportunityAmount = null;
  }

  // Remove keys with null to keep payload clean
  Object.keys(payload).forEach((k) => {
    if (payload[k] === null || payload[k] === undefined || payload[k] === "") delete payload[k];
  });

  return payload;
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await resp.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, text, data };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Upsert strategy:
 * - If we have a stored LeadCapture record id => try Espo PUT /LeadCapture/:id
 * - Otherwise (or if PUT fails) => POST to the provided LeadCapture URL (token endpoint)
 *   and try to read an id from response (if present).
 *
 * This never breaks chat flow; failures are logged only.
 */
async function upsertLeadCapture({ leadCaptureId, sessionId, contactInfo, interest }) {
  const payload = buildLeadCapturePayload(contactInfo, {
    // helpful link fields (only if your endpoint accepts; safe to remove if it rejects unknown fields)
    sessionId: cleanStr(sessionId) || undefined,
    lastInterest: cleanStr(interest || "") || undefined,
  });

  if (!Object.keys(payload).length) return { ok: false, skipped: true, id: leadCaptureId || null };

  // 1) Try update by id via official Espo API (requires ESPO_API_KEY configured in backend)
  if (cleanStr(leadCaptureId)) {
    try {
      const updated = await espoRequest(`/LeadCapture/${leadCaptureId}`, { method: "PUT", body: payload });
      return { ok: true, id: updated?.id || leadCaptureId, mode: "put" };
    } catch (e) {
      // fall through to POST token endpoint
      console.warn("[LeadCapture] PUT failed, fallback to POST:", e?.status, e?.data || e?.message);
    }
  }

  // 2) Create/Upsert via the token endpoint (your provided URL)
  try {
    const url = getLeadCaptureUrl();
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Try to discover id in common shapes
    const id =
      resp?.data?.id ||
      resp?.data?.leadCaptureId ||
      resp?.data?.result?.id ||
      resp?.data?.data?.id ||
      null;

    return { ok: resp.ok, id, mode: "post", status: resp.status };
  } catch (e) {
    console.warn("[LeadCapture] POST failed:", e?.message || e);
    return { ok: false, id: null, mode: "post_error" };
  }
}

/** ----------------------------- Reply composition ----------------------------- **/

function buildSuggestions(ranked) {
  // Only suggestions with fabric code (as requested)
  const items = ranked
    .filter((x) => x.score > 0)
    .map(({ p }) => {
      const code = getFabricCode(p);
      const slug = cleanStr(p.productslug);
      const url = getFrontendUrlForProduct(p);
      if (!code) return null;
      const title = pickFirstNonEmpty(p.productTitle, p.name, code);
      const label = `${title}${code ? ` (Code: ${code})` : ""}${url ? `\n${url}` : ""}`;
      return {
        id: p.id,
        fabricCode: code,
        slug,
        url,
        label,
        title,
      };
    })
    .filter(Boolean);

  // Keep top 6
  return items.slice(0, 6);
}

function productFacts(p) {
  if (!p) return null;
  return {
    id: p.id || null,
    title: pickFirstNonEmpty(p.productTitle, p.name, getFabricCode(p)),
    fabricCode: getFabricCode(p) || null,
    slug: cleanStr(p.productslug) || null,
    url: getFrontendUrlForProduct(p) || null,
    category: cleanStr(p.category) || null,
    gsm: p.gsm !== null && p.gsm !== undefined ? String(p.gsm) : null,
    cm: p.cm !== null && p.cm !== undefined ? String(p.cm) : null,
    content: toArr(p.content).map(cleanStr).filter(Boolean).slice(0, 10),
    structure: toArr(p.structure).map(cleanStr).filter(Boolean).slice(0, 10),
    finish: toArr(p.finish).map(cleanStr).filter(Boolean).slice(0, 10),
    design: toArr(p.design).map(cleanStr).filter(Boolean).slice(0, 10),
    colors: toArr(p.color).map(cleanStr).filter(Boolean).slice(0, 10),
    supplyModel: cleanStr(p.supplyModel) || null,
    moq: cleanStr(p.salesMOQ || p.moq) || null,
    // Keep description short for LLM
    description: (() => {
      const desc = cleanStr(p.fullProductDescription || p.description);
      if (!desc) return null;
      const plain = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!plain) return null;
      const max = Number(process.env.CHAT_MAX_DESC_CHARS || 350);
      return plain.length > max ? plain.slice(0, max).trim() + "..." : plain;
    })(),
  };
}

async function buildFinalReplyText({
  userMessage,
  language,
  plan,
  askField,
  openaiAvailable,
}) {
  const askEn = askField ? englishQuestionForField(askField) : "";

  // If OpenAI exists => reply in user's language, human tone, no JSON.
  if (openaiAvailable) {
    const system =
      "You are a helpful fabric catalogue assistant.\n" +
      "RULES:\n" +
      "- Reply in the SAME language as the user's message.\n" +
      "- Be natural and human.\n" +
      "- Use ONLY the facts provided in ReplyPlan. Do NOT invent.\n" +
      "- Do NOT output JSON.\n" +
      "- If ReplyPlan includes product URLs, include them.\n" +
      "- If there is a ContactQuestion, ask ONLY that ONE question at the end (short).\n";

    const user =
      `UserMessageLanguage: ${cleanStr(language) || "auto"}\n` +
      `UserMessage: ${userMessage}\n\n` +
      `ReplyPlan (facts you must follow):\n${safeJson(plan)}\n\n` +
      `ContactQuestion (ask this ONE question at the end, in user's language; if empty, don't ask):\n${askEn}`;

    const txt = await openaiText(system, user, 420);
    const out = cleanStr(txt);
    if (out) return out;
  }

  // Fallback (English)
  let reply = cleanStr(plan?.fallbackText) || "Tell me what fabric you’re looking for (color, weave/structure, GSM, content).";
  if (askEn) reply = `${reply}\n\n${askEn}`;
  return reply;
}

/** ----------------------------- Response format ----------------------------- **/

function wantsJsonResponse(req) {
  const q = (req.query || {});
  if (q.format === "json" || q.json === "1") return true;
  return false;
}

function sendReply(res, req, replyText, outJson) {
  if (wantsJsonResponse(req)) return res.json(outJson);
  return res.type("text/plain").send(replyText);
}

/** ----------------------------- Main controller ----------------------------- **/

async function handleChatMessage(req, res) {
  const message = cleanStr(req.body?.message);
  const mode = cleanStr(req.body?.mode) || "auto";
  const incomingContext = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const sessionId = cleanStr(req.body?.sessionId) || "";

  if (!message) {
    return res.status(400).json({ ok: false, error: "message is required" });
  }

  // Merge session context (optional) with the incoming context
  let sessionCtx = {};
  if (sessionId) {
    sessionCtx = SESSION_STORE.get(sessionId) || {};
  }
  let context = { ...sessionCtx, ...incomingContext };

  // session close logic
  const closeMs = getSessionCloseMs();
  const lastSeen = Number(context?.sessionLastSeenAt || 0);
  const isClosed = lastSeen && nowMs() - lastSeen > closeMs;

  if (isClosed) {
    // start new conversation thread
    context = {
      ...context,
      // reset lead record for new chat
      leadCapture: { id: null, startedAt: nowIso(), lastUpsertAt: null },
      // keep contactInfo (optional). If you want to clear it, set {} here.
      contactInfo: context.contactInfo || {},
      lastProductIds: [],
      lastProduct: null,
      lastIntent: null,
    };
  }

  // OpenAI parse (optional)
  let action;
  let openaiUsedParse = false;

  try {
    action = await parseUserMessageWithOpenAI({ message, context });
    openaiUsedParse = true;
  } catch (e) {
    // OpenAI optional: fall back to heuristics
    const h = heuristicIntent(message, mode);
    action = {
      language: "en",
      ...h,
      detail: h.detail,
      refersToPrevious: false,
      query: {
        keywords: [],
        color: null,
        weave: null,
        design: null,
        structure: null,
        content: [],
        gsm: { min: null, max: null },
      },
      contactInfo: {
        salutationName: null,
        firstName: null,
        lastName: null,
        middleName: null,
        emailAddress: null,
        phoneNumber: null,
        accountName: null,
        addressStreet: null,
        addressCity: null,
        addressState: null,
        addressCountry: null,
        addressPostalCode: null,
        opportunityAmountCurrency: null,
        opportunityAmount: null,
        cBusinessType: null,
        cFabricCategory: null,
      },
      _openai_error: true,
    };
  }

  const intent = action?.intent || "unknown";
  const detail = normalizeDetail(action?.detail, mode);
  const language = cleanStr(action?.language) || "auto";

  // Merge contact info from context + OpenAI extraction + heuristics
  const ctxContact = context?.contactInfo && typeof context.contactInfo === "object" ? context.contactInfo : {};
  let mergedContact = mergeContactInfo(ctxContact, action?.contactInfo || {});
  mergedContact = enrichContactFromHeuristics(message, mergedContact);

  // If user typed "my name is ..." but lastName missing, try split from firstName+lastName from combined phrase
  if (cleanStr(mergedContact.firstName) && !cleanStr(mergedContact.lastName)) {
    const maybeFull = cleanStr(action?.contactInfo?.firstName) || "";
    if (maybeFull && maybeFull.split(/\s+/).length >= 2) {
      const parts = splitNameParts(maybeFull);
      mergedContact.firstName = mergedContact.firstName || parts.firstName;
      mergedContact.middleName = mergedContact.middleName || parts.middleName;
      mergedContact.lastName = mergedContact.lastName || parts.lastName;
    }
  }

  // Product-related flows
  let products = [];
  try {
    products = await fetchCandidateProducts();
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "Failed to fetch catalogue data from EspoCRM",
      details: e?.data || e?.message,
    });
  }

  const query = action?.query || {};
  const ranked = products
    .map((p) => ({ p, score: scoreProduct(p, query) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0]?.p || null;
  const topScore = ranked[0]?.score || 0;

  const minScore = Number(process.env.CHAT_MIN_SCORE || 10);
  const hasMatch = !!top && topScore >= minScore;

  // Determine which product to talk about if user refers to previous
  const ctxIds = Array.isArray(context?.lastProductIds) ? context.lastProductIds : [];
  const refersToPrev = !!action?.refersToPrevious;
  let focused = top;

  if (refersToPrev && ctxIds.length) {
    const byId = new Map(ranked.map(({ p }) => [p.id, p]));
    focused = byId.get(ctxIds[0]) || top;
  }

  const suggestions = buildSuggestions(ranked);

  // Build ReplyPlan (facts)
  const plan = {
    language,
    intent,
    detail,
    hasMatch,
    topScore,
    product: focused ? productFacts(focused) : null,
    suggestions: suggestions.slice(0, 3).map((s) => ({
      id: s.id,
      title: s.title,
      fabricCode: s.fabricCode,
      url: s.url,
    })),
    fallbackText: "",
  };

  // Deterministic fallback text (English only)
  if (intent === "availability") {
    if (hasMatch) {
      plan.fallbackText = "Yes — we have matching fabrics in our catalogue. Do you want details?";
    } else {
      plan.fallbackText =
        "I couldn’t find an exact match in our catalogue. Can you share GSM, content (cotton/poly), and weave (poplin/twill/denim)?";
    }
  } else if (intent === "details") {
    if (!hasMatch && !refersToPrev) {
      plan.fallbackText = "Which fabric should I describe? Share the name/code/slug (or color + weave + GSM).";
    } else if (focused) {
      // fallback: plain facts
      const p = focused;
      const code = getFabricCode(p);
      const url = getFrontendUrlForProduct(p);
      const bits = [
        pickFirstNonEmpty(p.productTitle, p.name, code),
        code ? `Code: ${code}` : "",
        cleanStr(p.category),
        p.gsm ? `${cleanStr(p.gsm)} GSM` : "",
        toArr(p.structure).filter(Boolean).join(", "),
        toArr(p.content).filter(Boolean).join(", "),
        toArr(p.finish).filter(Boolean).join(", "),
        toArr(p.color).filter(Boolean).slice(0, 4).join(", "),
      ].filter(Boolean);
      plan.fallbackText = `${bits.join(" · ")}${url ? `\n${url}` : ""}`;
    } else {
      plan.fallbackText = "Which fabric should I describe?";
    }
  } else if (intent === "recommend") {
    if (hasMatch) {
      const top3 = ranked
        .filter((x) => x.score > 0)
        .slice(0, 3)
        .map(({ p }) => {
          const title = pickFirstNonEmpty(p.productTitle, p.name, getFabricCode(p));
          const code = getFabricCode(p);
          const url = getFrontendUrlForProduct(p);
          const meta = [cleanStr(p.category), p.gsm ? `${cleanStr(p.gsm)} GSM` : "", toArr(p.color).slice(0, 2).join(", ")]
            .filter(Boolean)
            .join(" · ");
          const line1 = `• ${title}${code ? ` (Code: ${code})` : ""}${meta ? ` — ${meta}` : ""}`;
          const line2 = url ? `${url}` : "";
          return [line1, line2].filter(Boolean).join("\n");
        });
      plan.fallbackText = `Here are a few matching options:\n${top3.join("\n")}\n\nWant details for the best match?`;
    } else {
      plan.fallbackText = "I couldn’t find close matches. Tell me color, GSM range, content, and end-use (shirts/dresses/uniforms).";
    }
  } else {
    plan.fallbackText = "Tell me what fabric you’re looking for (color, weave/structure, GSM, content). I’ll check our catalogue.";
  }

  // Update context for product memory
  let nextContext = {
    ...context,
    sessionLastSeenAt: nowMs(),
    lastIntent: intent,
    contactInfo: mergedContact,
  };

  if (intent === "availability") {
    if (hasMatch) {
      nextContext.lastProductIds = suggestions.map((s) => s.id);
      nextContext.lastProduct = focused
        ? { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name), fabricCode: getFabricCode(focused) || null }
        : null;
    } else {
      nextContext.lastProductIds = [];
      nextContext.lastProduct = null;
    }
  } else if (intent === "details") {
    if (focused) {
      nextContext.lastProductIds = [focused.id];
      nextContext.lastProduct = { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name), fabricCode: getFabricCode(focused) || null };
    }
  } else if (intent === "recommend") {
    if (hasMatch) {
      nextContext.lastProductIds = suggestions.map((s) => s.id);
      nextContext.lastProduct = focused
        ? { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name), fabricCode: getFabricCode(focused) || null }
        : null;
    } else {
      nextContext.lastProductIds = [];
      nextContext.lastProduct = null;
    }
  }

  // LeadCapture session state
  const leadCtx = (nextContext.leadCapture && typeof nextContext.leadCapture === "object") ? nextContext.leadCapture : {};
  nextContext.leadCapture = {
    id: cleanStr(leadCtx.id) || null,
    startedAt: cleanStr(leadCtx.startedAt) || nowIso(),
    lastUpsertAt: cleanStr(leadCtx.lastUpsertAt) || null,
  };

  // Choose ONE next question based on missing contact field (only if we have any interaction)
  const askField = nextMissingContactField(nextContext.contactInfo);

  // Build final reply text (localized with OpenAI if available)
  const openaiAvailable = !!cleanStr(process.env.OPENAI_API_KEY);
  let replyText = "";
  try {
    replyText = await buildFinalReplyText({
      userMessage: message,
      language,
      plan,
      askField,
      openaiAvailable,
    });
  } catch (e) {
    // final generation failed; fallback English
    replyText = cleanStr(plan.fallbackText) || "Tell me what fabric you’re looking for (color, weave/structure, GSM, content).";
    const askEn = askField ? englishQuestionForField(askField) : "";
    if (askEn) replyText = `${replyText}\n\n${askEn}`;
  }

  // Upsert LeadCapture (store ONLY user/contact info, not full reply)
  // Use interest = category or top product category
  const interest =
    cleanStr(nextContext.contactInfo?.cFabricCategory) ||
    cleanStr(query?.weave) ||
    cleanStr(query?.structure) ||
    cleanStr(focused?.category) ||
    "";

  if (sessionId || contactHasAny(nextContext.contactInfo)) {
    const up = await upsertLeadCapture({
      leadCaptureId: nextContext.leadCapture.id,
      sessionId,
      contactInfo: nextContext.contactInfo,
      interest,
    });

    if (up?.ok && cleanStr(up.id)) {
      nextContext.leadCapture.id = cleanStr(up.id);
      nextContext.leadCapture.lastUpsertAt = nowIso();
    }
  }

  // Build JSON output (only for debug if format=json)
  const outJson = {
    ok: true,
    replyText,
    suggestions: suggestions.map((s) => ({ id: s.id, label: s.label, fabricCode: s.fabricCode, url: s.url })),
    context: nextContext,
    meta: {
      ts: nowIso(),
      intent,
      topScore,
      openaiUsed: openaiUsedParse && openaiAvailable,
      responseFormat: wantsJsonResponse(req) ? "json" : "text",
      language,
      askedField: askField || null,
      leadCaptureId: nextContext?.leadCapture?.id || null,
    },
  };

  if (sessionId) SESSION_STORE.set(sessionId, nextContext);

  return sendReply(res, req, replyText, outJson);
}

module.exports = { handleChatMessage };
