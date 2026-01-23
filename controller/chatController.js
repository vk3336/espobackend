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

  // If client explicitly requests JSON via Accept header
  const accept = String(req.headers?.accept || "").toLowerCase();
  if (accept.includes("application/json")) return true;

  return false; // default plain text
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
    .replace(/[^a-z0-9]+/g, " ")
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
  // "Chemical - Mercerized" -> "Mercerized"
  const v = cleanStr(s);
  if (!v) return "";
  const parts = v.split("-").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1]; // last chunk usually best
  return v;
}

function niceJoin(arr, sep = ", ", limit = 6) {
  const u = uniqList(arr, limit);
  return u.join(sep);
}

function niceFinish(arr, limit = 6) {
  const cleaned = uniqList(arr, limit).map(cleanFinishLabel).filter(Boolean);
  // dedupe again after cleaning
  return uniqList(cleaned, limit).join(", ");
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = cleanStr(v);
    if (s) return s;
  }
  return "";
}

/* ------------------------------ OpenAI structured parse (intent only) ------------------------------ */
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

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return "{}";
  }
}

async function parseUserMessageWithOpenAI({ message, context }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
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
          name: { type: ["string", "null"] },
          company: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
        },
        required: ["name", "company", "email", "phone", "country"],
      },
    },
    required: ["intent", "detail", "refersToPrevious", "query", "contact"],
  };

  const system =
    "You are a routing classifier for a fabric catalogue chat assistant. " +
    "Decide user intent and extract search cues. Output ONLY JSON matching the schema. " +
    "If user asks if fabric exists -> intent=availability and detail=yesno. " +
    "If user asks for more info/details -> intent=details and detail=short/long. " +
    "If user wants suggestions -> intent=recommend. " +
    "If user wants price/quote/contact -> intent=lead. " +
    "If user refers to it/this/that and context has previous product -> refersToPrevious=true.";

  const user =
    `User message: ${message}\n\n` +
    `Context (may be empty): ${safeJson(context || {})}`;

  return openaiJson("chat_action", schema, system, user);
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

/* ------------------------------ HUMAN SUMMARIES (this is the main fix) ------------------------------ */
function humanShort(p) {
  const title = pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode);
  const code = pickFirstNonEmpty(p.fabricCode, p.vendorFabricCode);
  const category = cleanStr(p.category);

  const color = niceJoin(p.color, ", ", 3);
  const content = niceJoin(p.content, ", ", 3);
  const weave = niceJoin(p.structure, ", ", 2) || niceJoin(p.weave, ", ", 2);
  const finish = niceFinish(p.finish, 4);
  const design = niceJoin(p.design, ", ", 2);

  const gsm = fmtNum(p.gsm);
  const width = fmtNum(p.cm);

  const parts = [];

  // 1) First human line
  let first = title || "We have a matching fabric";
  if (color) first += ` (${color})`;
  if (code && (!title || !title.toLowerCase().includes(code.toLowerCase()))) {
    first += ` — Code: ${code}`;
  }
  parts.push(first + ".");

  // 2) Specs sentence
  const specBits = [];
  if (category) specBits.push(category);
  if (weave) specBits.push(weave);
  if (content) specBits.push(content);
  if (gsm) specBits.push(`${gsm} GSM`);
  if (width) specBits.push(`${width} cm width`);
  if (specBits.length) parts.push(`Specs: ${specBits.join(" · ")}.`);

  // 3) Finish/design sentence
  const extraBits = [];
  if (finish) extraBits.push(`Finish: ${finish}`);
  if (design) extraBits.push(`Design: ${design}`);
  if (extraBits.length) parts.push(extraBits.join(" | ") + ".");

  return parts.join("\n");
}

function stripHtmlToText(html) {
  const s = cleanStr(html);
  if (!s) return "";
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

/* ------------------------------ intent fallback ------------------------------ */
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

/* ------------------------------ lead save ------------------------------ */
async function saveLeadToEspo(contact, notes) {
  const entity = cleanStr(process.env.CHAT_LEAD_ENTITY) || "Lead";
  const accountField = cleanStr(process.env.CHAT_LEAD_ACCOUNT_FIELD) || "accountName";

  const payload = {
    firstName: (cleanStr(contact?.name) || "").split(" ")[0] || "Visitor",
    lastName: (cleanStr(contact?.name) || "").split(" ").slice(1).join(" ") || "",
    [accountField]: cleanStr(contact?.company) || undefined,
    emailAddress: cleanStr(contact?.email) || undefined,
    phoneNumber: cleanStr(contact?.phone) || undefined,
    description: cleanStr(notes) || undefined,
  };

  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  try {
    const created = await espoRequest(`/${entity}`, { method: "POST", body: payload });
    return { ok: true, id: created?.id || null, entity };
  } catch (e) {
    console.warn("[chat] lead create failed:", e?.status, e?.data || e?.message);
    return { ok: false, entity, error: e?.message || "failed" };
  }
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

  // Merge session context (optional) with the incoming context
  let sessionCtx = {};
  if (sessionId) sessionCtx = SESSION_STORE.get(sessionId) || {};
  const context = { ...sessionCtx, ...incomingContext };

  let action;
  try {
    action = await parseUserMessageWithOpenAI({ message, context });
  } catch {
    action = {
      ...heuristicIntent(message, mode),
      detail: heuristicIntent(message, mode).detail,
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
  }

  const intent = action?.intent || "unknown";
  const detail = normalizeDetail(action?.detail, mode);

  // Lead capture
  if (intent === "lead") {
    const c = action?.contact || null;
    const hasAnyContact = !!cleanStr(c?.email) || !!cleanStr(c?.phone) || !!cleanStr(c?.name);

    if (!hasAnyContact) {
      const replyText =
        "Sure — share your name, company, email, and WhatsApp/phone. Also tell me the fabric you need (color, GSM, weave/structure, quantity).";
      const out = {
        ok: true,
        replyText,
        context: { ...context, leadStage: "awaiting_contact", lastIntent: "lead" },
        meta: { ts: nowIso() },
      };
      if (sessionId) SESSION_STORE.set(sessionId, out.context);
      return sendChatResponse(req, res, 200, out);
    }

    const saved = await saveLeadToEspo(c, `Chat lead @ ${nowIso()}\n\nUser: ${message}`);
    const replyText = saved.ok
      ? "Thanks — got it. Our team will contact you shortly. Meanwhile, tell me the fabric details you need (color, GSM, content, finish, usage)."
      : "Thanks — got it. I saved your details for follow-up. Now tell me the fabric details you need (color, GSM, content, finish, usage).";

    const out = {
      ok: true,
      replyText,
      context: {
        ...context,
        leadStage: "captured",
        lead: { ...c, savedTo: saved.entity, savedOk: saved.ok, id: saved.id || null },
        lastIntent: "lead",
      },
      meta: { ts: nowIso() },
    };
    if (sessionId) SESSION_STORE.set(sessionId, out.context);
    return sendChatResponse(req, res, 200, out);
  }

  // Fetch products
  let products = [];
  try {
    products = await fetchCandidateProducts();
  } catch (e) {
    return sendChatResponse(req, res, 502, {
      ok: false,
      error: "Failed to fetch catalogue data from EspoCRM",
      replyText: "I’m unable to check the catalogue right now. Please try again in a minute.",
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
    .map(({ p }) => ({ id: p.id, label: pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode) }));

  // If user asks availability + detail in the same message, give details directly.
  const m = norm(message);
  const askedDetailNow =
    m.includes("detail") || m.includes("details") || m.includes("tell me more") || m.includes("describe") || m.includes("about it");

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
      if (!p) {
        replyText = "Which fabric should I describe?";
      } else {
        replyText = detail === "long" ? humanLong(p) : humanShort(p);
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
          const gsm = fmtNum(p.gsm);
          const color = niceJoin(p.color, ", ", 2);
          const meta = [cleanStr(p.category), gsm ? `${gsm} GSM` : "", color].filter(Boolean).join(" · ");
          return `• ${title}${meta ? ` — ${meta}` : ""}`;
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

  const out = {
    ok: true,
    replyText,
    suggestions,
    context: nextContext,
    meta: { ts: nowIso(), intent, topScore, openaiUsed: !action?._openai_error },
  };

  if (sessionId) SESSION_STORE.set(sessionId, nextContext);
  return sendChatResponse(req, res, 200, out);
}

module.exports = { handleChatMessage };
