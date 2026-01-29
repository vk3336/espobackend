// controller/chatController.js
const { espoRequest } = require("./espoClient");

/**
 * In-memory conversation state (optional).
 * NOTE: In serverless environments this may reset; frontend should pass back `context`.
 */
const SESSION_STORE = globalThis.__AGE_CHAT_SESSIONS || new Map();
globalThis.__AGE_CHAT_SESSIONS = SESSION_STORE;

/** We will store leads in Espo "Lead" entity */
const LEAD_ENTITY = "Lead";

/* ------------------------------ tiny utils ------------------------------ */
function nowIso() {
  return new Date().toISOString();
}

function cleanStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
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

function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = cleanStr(v);
    if (s) return s;
  }
  return "";
}

function stripHtml(html) {
  const s = String(html || "");
  // simple + safe enough for snippets
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseCsvEnv(name) {
  const raw = cleanStr(process.env[name]);
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => cleanStr(x))
    .filter(Boolean);
}

/* ------------------------------ NEW: choose chat entities dynamically ------------------------------ */
/**
 * Priority:
 *  1) CHAT_ENTITIES (recommended)
 *  2) ESPO_ENTITIES minus Lead
 *  3) fallback => CProduct
 */
function getChatEntities() {
  const chat = parseCsvEnv("CHAT_ENTITIES");
  if (chat.length) return chat;

  const all = parseCsvEnv("ESPO_ENTITIES");
  const filtered = all.filter((e) => norm(e) !== "lead");
  if (filtered.length) return filtered;

  return ["CProduct"];
}

/** simple concurrency limiter (no deps) */
function createLimiter(max) {
  const limit = Number(max);
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;

  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= n) return;
    const job = queue.shift();
    if (!job) return;

    active++;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/* ------------------------------ NEW: env-driven reply instructions ------------------------------ */
function getChatExtraInstructions() {
  const raw = String(process.env.CHAT_EXTRA_INSTRUCTIONS || "");
  const text = raw.replace(/\\n/g, "\n").trim();
  if (!text) return "";

  const max = Number(process.env.CHAT_EXTRA_INSTRUCTIONS_MAX_CHARS || 4000);
  if (Number.isFinite(max) && max > 0 && text.length > max) {
    return text.slice(0, max);
  }
  return text;
}

/* ------------------------------ FRONTEND URL helpers ------------------------------ */
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

/**
 * Optional: per-entity base URLs (only if you set them).
 * - AGE_COLLECTION_URL
 * - AGE_BLOG_URL
 * - AGE_AUTHOR_URL
 */
function getFrontendUrlForEntity(entity, rec) {
  const e = cleanStr(entity);

  if (e === "CProduct") return getFrontendUrlForProduct(rec);

  if (e === "CCollection") {
    const base = cleanStr(process.env.AGE_COLLECTION_URL);
    const slug = pickFirstNonEmpty(rec?.collectionslug, rec?.slug, rec?.productslug);
    return base && slug ? joinUrl(base, slug) : "";
  }

  if (e === "CBlog") {
    const base = cleanStr(process.env.AGE_BLOG_URL);
    const slug = pickFirstNonEmpty(rec?.slug, rec?.blogslug);
    return base && slug ? joinUrl(base, slug) : "";
  }

  if (e === "CAuthor") {
    const base = cleanStr(process.env.AGE_AUTHOR_URL);
    const slug = pickFirstNonEmpty(rec?.slug, rec?.authorslug);
    return base && slug ? joinUrl(base, slug) : "";
  }

  return "";
}

function getFabricCode(p) {
  return pickFirstNonEmpty(p?.fabricCode, p?.vendorFabricCode);
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
  } catch {}
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

async function openaiText(system, user, maxTokens = 420) {
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
    max_output_tokens: Number(maxTokens),
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

/* ------------------------------ Contact capture helpers ------------------------------ */
/**
 * Normalize phone into something Espo validator accepts (often E.164).
 * DEFAULT_PHONE_COUNTRY_CODE example: +91
 */
function normalizePhoneForEspo(input) {
  const raw = cleanStr(input);
  if (!raw) return "";

  const defaultCC = cleanStr(process.env.DEFAULT_PHONE_COUNTRY_CODE);
  const startsPlus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";

  if (startsPlus) return `+${digits}`;
  if (digits.length === 10 && defaultCC) return `${defaultCC}${digits}`;
  if (digits.length === 11 && digits.startsWith("0") && defaultCC) return `${defaultCC}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits;
}

function digitsOnlyPhone(s) {
  return normalizePhoneForEspo(s);
}

function extractEmailHeuristic(text) {
  const m = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function extractPhoneHeuristic(text) {
  const m = String(text || "").match(/(\+?\d[\d\s\-()]{8,}\d)/);
  return m ? normalizePhoneForEspo(m[1]) : "";
}

function extractNameHeuristic(text) {
  const t = cleanStr(text);
  if (!t) return "";
  const m1 = t.match(/\bmy name is\s+([^,.;\d]+)\b/i);
  if (m1) return cleanStr(m1[1]);
  const m2 = t.match(/\bi am\s+([^,.;\d]+)\b/i);
  if (m2) {
    const candidate = cleanStr(m2[1]);
    if (candidate && candidate.split(/\s+/).length <= 4) return candidate;
  }
  return "";
}

function parseSalutation(nameText) {
  const s = norm(nameText);
  if (!s) return null;
  if (s.includes("mr ")) return "Mr.";
  if (s.includes("mrs ")) return "Mrs.";
  if (s.includes("ms ") || s.includes("miss ")) return "Ms.";
  if (s.includes("dr ")) return "Dr.";
  return null;
}

function splitNameParts(fullName) {
  const n = cleanStr(fullName).replace(/\s+/g, " ").trim();
  if (!n) return { firstName: null, middleName: null, lastName: null };
  const parts = n.split(" ").filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], middleName: null, lastName: null };
  if (parts.length === 2) return { firstName: parts[0], middleName: null, lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function mergeContactInfo(base, incoming) {
  const b = base && typeof base === "object" ? base : {};
  const i = incoming && typeof incoming === "object" ? incoming : {};
  const out = { ...b };

  const fields = [
    "source",
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

  if (
    (out.opportunityAmount === null || out.opportunityAmount === undefined || out.opportunityAmount === "") &&
    (i.opportunityAmount !== null && i.opportunityAmount !== undefined && i.opportunityAmount !== "")
  ) {
    const n = Number(i.opportunityAmount);
    out.opportunityAmount = Number.isFinite(n) ? n : out.opportunityAmount;
  }

  if (cleanStr(out.phoneNumber)) out.phoneNumber = normalizePhoneForEspo(out.phoneNumber);
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

function hasAnyContactData(c) {
  return (
    !!cleanStr(c?.firstName) ||
    !!cleanStr(c?.lastName) ||
    !!cleanStr(c?.emailAddress) ||
    !!cleanStr(c?.phoneNumber) ||
    !!cleanStr(c?.accountName) ||
    !!cleanStr(c?.addressCountry) ||
    !!cleanStr(c?.addressCity) ||
    !!cleanStr(c?.cBusinessType) ||
    !!cleanStr(c?.cFabricCategory)
  );
}

function nextMissingContactField(contactInfo) {
  const c = contactInfo || {};
  const order = [
    "firstName",
    "accountName",
    "phoneNumber",
    "emailAddress",
    "addressCountry",
    "addressCity",
    "cBusinessType",
    "cFabricCategory",
  ];
  for (const f of order) {
    if (!cleanStr(c[f])) return f;
  }
  return null;
}

function questionForField(field) {
  switch (field) {
    case "firstName":
      return "What’s your first name?";
    case "accountName":
      return "Which company are you from?";
    case "phoneNumber":
      return "What’s your WhatsApp/phone number?";
    case "emailAddress":
      return "What’s your email address?";
    case "addressCountry":
      return "Which country are you in?";
    case "addressCity":
      return "Which city are you in?";
    case "cBusinessType":
      return "What best describes you (brand / garment manufacturer / trader / exporter)?";
    case "cFabricCategory":
      return "Which fabric category are you mainly looking for (woven/knit/denim/poplin etc.)?";
    default:
      return "";
  }
}

/* ------------------------------ Espo phone/email helpers ------------------------------ */
function buildPhoneNumberData(phoneNumber) {
  const p = normalizePhoneForEspo(phoneNumber);
  if (!p) return undefined;
  return [{ phoneNumber: p, primary: true, type: "Mobile" }];
}

function buildEmailAddressData(emailAddress) {
  const e = cleanStr(emailAddress);
  if (!e) return undefined;
  return [{ emailAddress: e, primary: true, type: "Work" }];
}

/* ------------------------------ Lead upsert ------------------------------ */
function buildLeadPayload(contactInfo) {
  const c = contactInfo || {};
  const source = "Chat Bot";

  const fullName = [cleanStr(c.firstName), cleanStr(c.middleName), cleanStr(c.lastName)]
    .filter(Boolean)
    .join(" ")
    .trim();

  const name = fullName || cleanStr(c.accountName) || "Chat Visitor";
  const assignedUserId = cleanStr(process.env.ESPO_ASSIGNED_USER_ID) || undefined;
  const normalizedPhone = normalizePhoneForEspo(c.phoneNumber);

  const payload = {
    source,
    name,
    assignedUserId,

    salutationName: cleanStr(c.salutationName) || undefined,
    firstName: cleanStr(c.firstName) || undefined,
    middleName: cleanStr(c.middleName) || undefined,
    lastName: cleanStr(c.lastName) || undefined,

    phoneNumberData: buildPhoneNumberData(normalizedPhone),
    emailAddressData: buildEmailAddressData(c.emailAddress),

    phoneNumber: normalizedPhone ? normalizedPhone : undefined,
    emailAddress: cleanStr(c.emailAddress) || undefined,

    accountName: cleanStr(c.accountName) || undefined,

    addressStreet: cleanStr(c.addressStreet) || undefined,
    addressCity: cleanStr(c.addressCity) || undefined,
    addressState: cleanStr(c.addressState) || undefined,
    addressCountry: cleanStr(c.addressCountry) || undefined,
    addressPostalCode: cleanStr(c.addressPostalCode) || undefined,

    opportunityAmountCurrency: cleanStr(c.opportunityAmountCurrency) || undefined,
    opportunityAmount:
      c.opportunityAmount === null || c.opportunityAmount === undefined || c.opportunityAmount === ""
        ? undefined
        : Number(c.opportunityAmount),

    cBusinessType: cleanStr(c.cBusinessType) || undefined,
    cFabricCategory: cleanStr(c.cFabricCategory) || undefined,

    description: `Chat lead updated @ ${nowIso()}`,
  };

  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  if (payload.opportunityAmount !== undefined && !Number.isFinite(payload.opportunityAmount)) delete payload.opportunityAmount;

  return payload;
}

async function leadCreate(payload) {
  return espoRequest(`/${LEAD_ENTITY}`, { method: "POST", body: payload });
}

async function leadUpdate(id, payload) {
  try {
    return await espoRequest(`/${LEAD_ENTITY}/${id}`, { method: "PUT", body: payload });
  } catch (e) {
    if (e?.status === 405 || e?.status === 400) {
      return espoRequest(`/${LEAD_ENTITY}/${id}`, { method: "PATCH", body: payload });
    }
    throw e;
  }
}

async function upsertLeadSingleRecord(context, contactInfo) {
  const src = cleanStr(contactInfo?.source) || "Chat Bot";
  if (src !== "Chat Bot") return { ok: true, skipped: true, reason: "source_not_chatbot" };
  if (!hasAnyContactData(contactInfo)) return { ok: true, skipped: true, reason: "no_contact_yet" };

  const payload = buildLeadPayload(contactInfo);
  const existingId = cleanStr(context?.leadId) || cleanStr(context?.leadCaptureId);

  if (existingId) {
    try {
      await leadUpdate(existingId, payload);
      context.leadId = existingId;
      return { ok: true, mode: "update", id: existingId };
    } catch (e) {
      return {
        ok: false,
        mode: "update_failed",
        id: existingId,
        status: e?.status || null,
        error: e?.data || e?.message || String(e),
      };
    }
  }

  const created = await leadCreate(payload);
  const newId = cleanStr(created?.id);
  if (newId) {
    context.leadId = newId;
    return { ok: true, mode: "create", id: newId };
  }

  return { ok: false, mode: "create_no_id", id: null, raw: created };
}

/* ------------------------------ Product fetching & scoring ------------------------------ */
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
  parts.push(stripHtml(pickFirstNonEmpty(p.description)));
  parts.push(stripHtml(pickFirstNonEmpty(p.fullProductDescription)));
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

/* ------------------------------ NEW: multi-entity knowledge items ------------------------------ */
function itemKey(entity, id) {
  const e = cleanStr(entity);
  const i = cleanStr(id);
  return e && i ? `${e}:${i}` : "";
}

function getItemTitle(entity, rec) {
  if (entity === "CProduct") return pickFirstNonEmpty(rec?.productTitle, rec?.name, getFabricCode(rec));
  return pickFirstNonEmpty(rec?.title, rec?.name, rec?.subject, rec?.heading, rec?.label);
}

function buildGenericRecordText(entity, rec) {
  const parts = [];
  parts.push(entity);

  // prioritized common fields (fast wins)
  const priorityKeys = [
    "title",
    "name",
    "subject",
    "heading",
    "slug",
    "productslug",
    "collectionslug",
    "blogslug",
    "authorslug",
    "category",
    "tags",
    "keywords",
    "email",
    "emailAddress",
    "phone",
    "phoneNumber",
    "website",
    "address",
    "addressStreet",
    "addressCity",
    "addressState",
    "addressCountry",
    "description",
    "shortDescription",
    "content",
    "body",
    "text",
    "fullDescription",
  ];

  for (const k of priorityKeys) {
    const v = rec?.[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string") parts.push(stripHtml(v));
    else if (typeof v === "number") parts.push(String(v));
    else if (Array.isArray(v)) parts.push(v.map((x) => stripHtml(cleanStr(x))).filter(Boolean).join(" "));
  }

  // include a little extra: any short primitive fields
  try {
    const keys = Object.keys(rec || {});
    for (const k of keys) {
      if (priorityKeys.includes(k)) continue;
      const v = rec?.[k];
      if (v === null || v === undefined) continue;
      if (typeof v === "string") {
        const s = stripHtml(v);
        if (s && s.length <= 120) parts.push(s);
      } else if (typeof v === "number" || typeof v === "boolean") {
        parts.push(String(v));
      } else if (Array.isArray(v)) {
        const s = v.map((x) => stripHtml(cleanStr(x))).filter(Boolean).join(" ");
        if (s && s.length <= 180) parts.push(s);
      }
    }
  } catch {}

  return norm(parts.filter(Boolean).join(" \n "));
}

function scoreGeneric(entity, rec, query) {
  const text = buildGenericRecordText(entity, rec);
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

  // boost if token hits the title/slug-like fields
  const title = norm(getItemTitle(entity, rec));
  const slug = norm(pickFirstNonEmpty(rec?.slug, rec?.productslug, rec?.collectionslug, rec?.blogslug, rec?.authorslug));
  for (const t of uniq) {
    if (!t) continue;
    if (title.includes(t)) score += 6;
    if (slug.includes(t)) score += 5;
  }

  return score;
}

function scoreItem(item, query) {
  if (!item) return 0;
  if (item.entity === "CProduct") return scoreProduct(item.record, query);
  return scoreGeneric(item.entity, item.record, query);
}

/**
 * Fetch list for an entity safely:
 * - tries with orderBy/order; if it fails, retries without sorting fields
 */
async function fetchEntityList(entity) {
  const e = cleanStr(entity);
  if (!e) return [];

  const maxSizeDefault = Number(process.env.CHAT_ENTITY_MAX_SIZE || 120);
  const perEntityKey = `CHAT_MAX_SIZE_${e.toUpperCase()}`;
  const maxSize = Number(process.env[perEntityKey] || maxSizeDefault);

  const orderBy = cleanStr(process.env.CHAT_ENTITY_ORDER_BY || "modifiedAt");
  const order = cleanStr(process.env.CHAT_ENTITY_ORDER || "desc");

  try {
    const data = await espoRequest(`/${e}`, {
      query: { maxSize, offset: 0, orderBy, order },
    });
    return Array.isArray(data?.list) ? data.list : [];
  } catch (err1) {
    // fallback: no orderBy
    const data = await espoRequest(`/${e}`, {
      query: { maxSize, offset: 0 },
    });
    return Array.isArray(data?.list) ? data.list : [];
  }
}

/**
 * NEW: fetch from ALL chat entities + return unified "items"
 * Each item: { entity, id, record }
 */
async function fetchCandidateItems() {
  const entities = getChatEntities();

  const concurrency = Number(process.env.CHAT_ENTITY_CONCURRENCY || 3);
  const limit = createLimiter(concurrency);

  const all = [];
  const errors = [];

  await Promise.all(
    entities.map((entity) =>
      limit(async () => {
        try {
          const list = await fetchEntityList(entity);

          // Optional: keep your merchTag enforcement only for CProduct
          if (entity === "CProduct") {
            const rawTag = process.env.CHAT_REQUIRE_MERCHTAG;
            const requireTag = rawTag === undefined ? "ecatalogue" : norm(rawTag);
            const enforceTag = !!requireTag && !["none", "off", "0"].includes(requireTag);

            const filtered = enforceTag
              ? list.filter((p) => toArr(p.merchTags).map(norm).includes(requireTag))
              : list;

            for (const rec of filtered) {
              const id = cleanStr(rec?.id);
              if (!id) continue;
              all.push({ entity, id, record: rec });
            }
          } else {
            for (const rec of list) {
              const id = cleanStr(rec?.id);
              if (!id) continue;
              all.push({ entity, id, record: rec });
            }
          }
        } catch (e) {
          errors.push({ entity, status: e?.status || null, error: e?.data || e?.message || String(e) });
        }
      })
    )
  );

  return { items: all, errors };
}

/* ------------------------------ OpenAI parse schema ------------------------------ */
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
      contactInfo: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: ["string", "null"] },
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
          "source",
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
    "You are a routing + extraction engine for a fabric catalogue assistant. Return ONLY JSON.\n" +
    "- Detect language (en, hi, gu, etc.).\n" +
    "- If asking if fabric exists => availability + detail=yesno.\n" +
    "- If asking for more/specs => details.\n" +
    "- If asking for list/suggestions => recommend.\n" +
    "- If asking quote/price/contact => lead.\n" +
    "- Extract contactInfo fields if present.\n" +
    "IMPORTANT: translate search cues (color/weave/keywords) into English if possible for matching.";

  const user = `User message: ${message}\nContext: ${safeJson(context || {})}`;
  return openaiJson("chat_action_v3", schema, system, user);
}

function normalizeDetail(actionDetail, requestedMode) {
  const m = requestedMode === "short" || requestedMode === "long" ? requestedMode : null;
  if (m) return m;
  if (actionDetail === "short" || actionDetail === "long" || actionDetail === "yesno") return actionDetail;
  return "auto";
}

/* ------------------------------ NEW: details formatting for non-product entities ------------------------------ */
function pickDisplayPairs(entity, rec) {
  const r = rec || {};
  const pairs = [];

  // try common "contact/company" style fields first
  const candidates = [
    ["website", "Website"],
    ["url", "URL"],
    ["email", "Email"],
    ["emailAddress", "Email"],
    ["phone", "Phone"],
    ["phoneNumber", "Phone"],
    ["whatsapp", "WhatsApp"],
    ["address", "Address"],
    ["addressStreet", "Street"],
    ["addressCity", "City"],
    ["addressState", "State"],
    ["addressCountry", "Country"],
    ["description", "Description"],
    ["shortDescription", "Description"],
    ["content", "Content"],
    ["body", "Content"],
    ["text", "Content"],
  ];

  for (const [key, label] of candidates) {
    const v = r?.[key];
    if (v === null || v === undefined) continue;

    if (typeof v === "string") {
      const s = stripHtml(v);
      if (!s) continue;
      pairs.push([label, s.length > 260 ? `${s.slice(0, 260)}…` : s]);
    } else if (typeof v === "number") {
      pairs.push([label, String(v)]);
    } else if (Array.isArray(v)) {
      const s = v.map((x) => stripHtml(cleanStr(x))).filter(Boolean).join(", ");
      if (s) pairs.push([label, s.length > 260 ? `${s.slice(0, 260)}…` : s]);
    }
    if (pairs.length >= 6) break;
  }

  // If still empty, pick a few short primitive fields
  if (pairs.length < 2) {
    try {
      const keys = Object.keys(r);
      for (const k of keys) {
        const v = r?.[k];
        if (v === null || v === undefined) continue;
        if (typeof v === "string") {
          const s = stripHtml(v);
          if (!s || s.length > 140) continue;
          pairs.push([k, s]);
        } else if (typeof v === "number" || typeof v === "boolean") {
          pairs.push([k, String(v)]);
        }
        if (pairs.length >= 6) break;
      }
    } catch {}
  }

  return pairs;
}

function buildNonProductDetailsReply(entity, rec) {
  const title = getItemTitle(entity, rec) || `${entity} info`;
  const lines = [title];

  const pairs = pickDisplayPairs(entity, rec);
  for (const [k, v] of pairs) {
    lines.push(`${k}: ${v}`);
  }

  const url = getFrontendUrlForEntity(entity, rec);
  if (url) lines.push(url);

  return lines.join("\n");
}

/* ------------------------------ main handler ------------------------------ */
async function handleChatMessage(req, res) {
  const message = cleanStr(req.body?.message);
  const mode = cleanStr(req.body?.mode) || "auto";
  const incomingContext = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const sessionId = cleanStr(req.body?.sessionId) || "";

  if (!message) return res.status(400).json({ ok: false, error: "message is required" });

  let sessionCtx = {};
  if (sessionId) sessionCtx = SESSION_STORE.get(sessionId) || {};
  const context = { ...sessionCtx, ...incomingContext };

  // 1) Parse intent + contact + query
  let action;
  let openaiParseOk = true;
  try {
    action = await parseUserMessageWithOpenAI({ message, context });
  } catch {
    openaiParseOk = false;
    action = {
      language: "en",
      intent: "unknown",
      detail: "auto",
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
        source: null,
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

  // 2) Merge contact info
  const ctxContact = context?.contactInfo && typeof context.contactInfo === "object" ? context.contactInfo : {};
  let mergedContact = mergeContactInfo(ctxContact, action?.contactInfo || {});
  mergedContact = enrichContactFromHeuristics(message, mergedContact);
  mergedContact.source = "Chat Bot";

  // 3) Preserve leadId
  const nextContext = {
    ...context,
    contactInfo: mergedContact,
    leadId: cleanStr(context?.leadId) || cleanStr(context?.leadCaptureId) || null,
    lastIntent: intent,

    // NEW: multi-entity memory
    lastItems: Array.isArray(context?.lastItems) ? context.lastItems : [],
  };

  // 4) Upsert Lead
  try {
    await upsertLeadSingleRecord(nextContext, mergedContact);
  } catch (e) {
    console.warn("[Lead] upsert failed:", e?.status, e?.data || e?.message || e);
  }

  // 5) Fetch multi-entity knowledge
  let items = [];
  let fetchErrors = [];
  try {
    const r = await fetchCandidateItems();
    items = r.items || [];
    fetchErrors = r.errors || [];
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "Failed to fetch catalogue/knowledge data from EspoCRM",
      details: e?.data || e?.message,
    });
  }

  if (!items.length) {
    return res.status(502).json({
      ok: false,
      error: "No chat entities returned any records",
      details: fetchErrors.length ? fetchErrors : undefined,
    });
  }

  const query = action?.query || {};

  const rankedAll = items
    .map((it) => ({ it, score: scoreItem(it, query) }))
    .sort((a, b) => b.score - a.score);

  const rankedProducts = rankedAll.filter((x) => x.it?.entity === "CProduct");

  const topAll = rankedAll[0]?.it || null;
  const topAllScore = rankedAll[0]?.score || 0;

  const topProduct = rankedProducts[0]?.it || null;
  const topProductScore = rankedProducts[0]?.score || 0;

  const minScore = Number(process.env.CHAT_MIN_SCORE || 10);
  const hasAnyMatch = !!topAll && topAllScore >= minScore;
  const hasProductMatch = !!topProduct && topProductScore >= minScore;

  // Previous focus logic (multi-entity)
  const lastItems = Array.isArray(nextContext?.lastItems) ? nextContext.lastItems : [];
  const refersToPrev = !!action?.refersToPrevious;

  let focused = topAll;

  if (refersToPrev && lastItems.length) {
    const wanted = lastItems[0];
    const key = itemKey(wanted?.entity, wanted?.id);
    if (key) {
      const map = new Map(rankedAll.map(({ it }) => [itemKey(it.entity, it.id), it]));
      focused = map.get(key) || topAll;
    }
  }

  // Suggestions (keep old product-only shape for frontend safety)
  const suggestions = rankedProducts
    .filter((x) => x.score > 0)
    .slice(0, 6)
    .map(({ it }) => {
      const p = it.record;
      return {
        id: p.id,
        fabricCode: getFabricCode(p) || "",
        url: getFrontendUrlForProduct(p) || "",
        slug: cleanStr(p.productslug),
        label: pickFirstNonEmpty(p.productTitle, p.name, getFabricCode(p)),
      };
    })
    .filter((s) => !!cleanStr(s.fabricCode));

  // Optional: multi-entity suggestions for future frontend upgrade
  const suggestionsV2 = rankedAll
    .filter((x) => x.score > 0)
    .slice(0, 10)
    .map(({ it, score }) => ({
      entity: it.entity,
      id: it.id,
      label: getItemTitle(it.entity, it.record) || `${it.entity} ${it.id}`,
      url: getFrontendUrlForEntity(it.entity, it.record) || "",
      score,
    }));

  // Remember context IDs
  if (intent === "availability" || intent === "recommend") {
    // keep old behavior for products
    nextContext.lastProductIds = suggestions.map((s) => s.id);
    nextContext.lastProduct = topProduct
      ? { id: topProduct.id, slug: topProduct.record?.productslug, name: getItemTitle("CProduct", topProduct.record) }
      : null;

    // new multi-entity memory (prefer product suggestions if any, else best overall)
    const remember = suggestionsV2.slice(0, 6).map((s) => ({ entity: s.entity, id: s.id }));
    nextContext.lastItems = remember.length ? remember : topAll ? [{ entity: topAll.entity, id: topAll.id }] : [];
  } else if (intent === "details") {
    nextContext.lastItems = focused ? [{ entity: focused.entity, id: focused.id }] : [];
    if (focused?.entity === "CProduct") {
      nextContext.lastProductIds = [focused.id];
      nextContext.lastProduct = {
        id: focused.id,
        slug: focused.record?.productslug,
        name: getItemTitle("CProduct", focused.record),
      };
    }
  }

  // 6) Reply (extended to support non-product entities)
  let baseReply = "";
  if (intent === "availability") {
    baseReply = hasProductMatch
      ? "Yes — we have matching fabrics in our catalogue. Do you want details?"
      : "I couldn’t find an exact match in our catalogue. Can you share GSM, content (cotton/poly), and weave (poplin/twill/denim)?";
  } else if (intent === "recommend") {
    if (hasProductMatch) {
      const top3 = rankedProducts
        .filter((x) => x.score > 0)
        .slice(0, 3)
        .map(({ it }) => {
          const p = it.record;
          const title = pickFirstNonEmpty(p.productTitle, p.name, getFabricCode(p));
          const code = getFabricCode(p);
          const url = getFrontendUrlForProduct(p);
          const meta = [cleanStr(p.category), p.gsm ? `${cleanStr(p.gsm)} GSM` : "", toArr(p.color).slice(0, 2).join(", ")]
            .filter(Boolean)
            .join(" · ");
          return `• ${title}${meta ? ` — ${meta}` : ""}\n  Fabric Code: ${code || "-"}\n  ${url || ""}`.trim();
        });

      baseReply = `Here are a few matching options:\n${top3.join("\n")}\n\nWant details for the best match?`;
    } else {
      baseReply = "I couldn’t find close matches. Tell me color, GSM range, content, and end-use (shirts/dresses/uniforms).";
    }
  } else if (intent === "details") {
    if (!focused) {
      baseReply = "Which item should I describe? Share the name/title (or a keyword).";
    } else if (focused.entity === "CProduct") {
      const p = focused.record;
      const lines = [];
      lines.push(pickFirstNonEmpty(p.productTitle, p.name, getFabricCode(p)));
      const code = getFabricCode(p);
      if (code) lines.push(`Fabric Code: ${code}`);

      const bits = [];
      if (p.category) bits.push(cleanStr(p.category));
      if (p.gsm) bits.push(`${cleanStr(p.gsm)} GSM`);
      const content = toArr(p.content).filter(Boolean).join(", ");
      if (content) bits.push(content);
      const structure = toArr(p.structure).filter(Boolean).join(", ");
      if (structure) bits.push(structure);
      const finish = toArr(p.finish).filter(Boolean).join(", ");
      if (finish) bits.push(finish);
      const colors = toArr(p.color).filter(Boolean).slice(0, 4).join(", ");
      if (colors) bits.push(colors);
      if (bits.length) lines.push(bits.join(" · "));

      const url = getFrontendUrlForProduct(p);
      if (url) lines.push(url);

      baseReply = lines.join("\n");
    } else {
      // NEW: non-product detail response
      baseReply = buildNonProductDetailsReply(focused.entity, focused.record);
    }
  } else {
    // Unknown/smalltalk/etc: if we have any non-product match, show it briefly
    if (hasAnyMatch && topAll) {
      if (topAll.entity === "CProduct") {
        baseReply = "Tell me what fabric you’re looking for (color, weave/structure, GSM, content). I’ll check our catalogue.";
      } else {
        baseReply = buildNonProductDetailsReply(topAll.entity, topAll.record);
      }
    } else {
      baseReply = "Tell me what you’re looking for (fabric details or company-related query). I’ll check and respond.";
    }
  }

  const missingField = nextMissingContactField(mergedContact);
  const askOne = missingField ? questionForField(missingField) : "";
  const plan = { reply: baseReply, askOne };

  let replyText = "";
  const openaiAvailable = !!cleanStr(process.env.OPENAI_API_KEY);

  if (openaiAvailable) {
    try {
      const extra = getChatExtraInstructions();

      const system =
        "You are a helpful fabric catalogue assistant.\n" +
        "Reply in the SAME language as the user.\n" +
        "Be natural and human.\n" +
        "Do NOT output JSON.\n" +
        "Use only the facts in ReplyPlan.\n" +
        "If ContactQuestion is present, ask ONLY that ONE question at the end." +
        (extra ? `\n\n---\nExtra instructions (from env):\n${extra}` : "");

      const user = `User message: ${message}\n\nReplyPlan: ${safeJson(plan)}\n\nContactQuestion: ${askOne}`;
      replyText = await openaiText(system, user, 420);
    } catch {
      replyText = baseReply + (askOne ? `\n\n${askOne}` : "");
    }
  } else {
    replyText = baseReply + (askOne ? `\n\n${askOne}` : "");
  }

  const out = {
    ok: true,
    replyText,

    // keep old field for frontend compatibility
    suggestions,

    // NEW: multi-entity suggestions (optional)
    suggestionsV2,

    context: nextContext,
    meta: {
      ts: nowIso(),
      intent,
      topScore: topAllScore,
      openaiUsed: openaiParseOk && openaiAvailable,
      leadId: cleanStr(nextContext.leadId) || null,
      language,
      detail,

      // NEW: debug info (safe)
      chatEntities: getChatEntities(),
      fetchErrors: fetchErrors.length ? fetchErrors : undefined,
    },
  };

  if (sessionId) SESSION_STORE.set(sessionId, nextContext);
  return res.json(out);
}

module.exports = { handleChatMessage };
