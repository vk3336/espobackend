const { espoRequest } = require("./espoClient");

/**
 * In-memory conversation state (optional).
 * NOTE: In serverless environments this may reset; the frontend should pass back `context`.
 */
const SESSION_STORE = globalThis.__AGE_CHAT_SESSIONS || new Map();
globalThis.__AGE_CHAT_SESSIONS = SESSION_STORE;

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

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = cleanStr(v);
    if (s) return s;
  }
  return "";
}

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
  // Default is "ecatalogue" (matching existing search logic), but you can disable by setting
  // CHAT_REQUIRE_MERCHTAG to "none"/"off"/"0".
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

function formatShortSummary(p) {
  const lines = [];
  const title = pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode);
  if (title) lines.push(title);

  const bits = [];
  if (p.category) bits.push(cleanStr(p.category));
  if (p.gsm) bits.push(`${cleanStr(p.gsm)} GSM`);
  if (p.cm) bits.push(`${cleanStr(p.cm)} cm`);
  const content = toArr(p.content).filter(Boolean).join(", ");
  if (content) bits.push(content);
  const structure = toArr(p.structure).filter(Boolean).join(", ");
  if (structure) bits.push(structure);
  const finish = toArr(p.finish).filter(Boolean).join(", ");
  if (finish) bits.push(finish);
  const color = toArr(p.color).filter(Boolean).slice(0, 4).join(", ");
  if (color) bits.push(color);

  if (bits.length) lines.push(bits.join(" · "));

  if (p.productslug) {
    lines.push(`Slug: ${cleanStr(p.productslug)}`);
  }

  return lines.join("\n");
}

function formatLongSummary(p) {
  const lines = [];
  lines.push(formatShortSummary(p));

  const more = [];
  const supply = cleanStr(p.supplyModel);
  if (supply) more.push(`Supply model: ${supply}`);

  const design = toArr(p.design).filter(Boolean).join(", ");
  if (design) more.push(`Design: ${design}`);

  const suitability = toArr(p.suitability).filter(Boolean).slice(0, 8).join(", ");
  if (suitability) more.push(`Suitability: ${suitability}`);

  const moq = cleanStr(p.salesMOQ || p.moq);
  if (moq) more.push(`MOQ: ${moq}`);

  if (more.length) {
    lines.push("\n" + more.join("\n"));
  }

  // Optional: include a trimmed description from the product's own fields
  const desc = cleanStr(p.fullProductDescription || p.description);
  if (desc) {
    const plain = desc
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) {
      const max = Number(process.env.CHAT_MAX_DESC_CHARS || 450);
      const snippet = plain.length > max ? plain.slice(0, max).trim() + "..." : plain;
      lines.push("\n" + snippet);
    }
  }

  return lines.join("\n");
}

function heuristicIntent(message, mode) {
  const m = norm(message);
  const wantsLong = mode === "long" || m.includes("long") || m.includes("full") || m.includes("detail") || m.includes("describe");
  const wantsShort = mode === "short" || m.includes("short") || m.includes("summary") || m.includes("brief");
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
  return { intent: "unknown", detail };
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
    "Your job is to decide the user's intent and extract search cues. " +
    "Only output JSON that matches the schema. " +
    "If the user asks if a fabric exists, intent=availability and detail=yesno. " +
    "If the user asks to know more about a fabric, intent=details and detail=short or long depending on their words. " +
    "If the user wants suggestions, intent=recommend. " +
    "If the user wants price/quote/contact/call/WhatsApp, intent=lead. " +
    "If they refer to 'it/this/that one' and context indicates a previous product, set refersToPrevious=true.";

  const user =
    `User message: ${message}\n\n` +
    `Context (may be empty): ${safeJson(context || {})}`;

  return openaiJson("chat_action", schema, system, user);
}

function normalizeDetail(actionDetail, requestedMode) {
  const m = requestedMode === "short" || requestedMode === "long" ? requestedMode : null;
  if (m) return m;
  if (actionDetail === "short" || actionDetail === "long") return actionDetail;
  return "auto";
}

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

  // Remove undefined keys
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  try {
    const created = await espoRequest(`/${entity}`, { method: "POST", body: payload });
    return { ok: true, id: created?.id || null, entity };
  } catch (e) {
    console.warn("[chat] lead create failed:", e?.status, e?.data || e?.message);
    return { ok: false, entity, error: e?.message || "failed" };
  }
}

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
  const context = { ...sessionCtx, ...incomingContext };

  let action;
  try {
    action = await parseUserMessageWithOpenAI({ message, context });
  } catch (e) {
    // OpenAI optional: fall back to heuristics
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

  // Lead capture: if contact is present, attempt to save it
  if (intent === "lead") {
    const c = action?.contact || null;
    const hasAnyContact =
      !!cleanStr(c?.email) || !!cleanStr(c?.phone) || !!cleanStr(c?.name);

    if (!hasAnyContact) {
      const replyText =
        "Sure — share your name, company, email, and WhatsApp/phone, and tell me what fabric you need (color, GSM, weave/structure, quantity).";
      const out = {
        ok: true,
        replyText,
        context: { ...context, leadStage: "awaiting_contact", lastIntent: "lead" },
        meta: { ts: nowIso() },
      };
      if (sessionId) SESSION_STORE.set(sessionId, out.context);
      return res.json(out);
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
    return res.json(out);
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

  let replyText = "";
  let nextContext = { ...context, lastIntent: intent };

  // Prepare a compact suggestion list for the UI
  const suggestions = ranked
    .filter((x) => x.score > 0)
    .slice(0, 6)
    .map(({ p }) => ({ id: p.id, label: pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode) }));

  if (intent === "availability") {
    if (hasMatch) {
      replyText = "Yes — we have matching fabrics in our catalogue. Do you want details?";
      nextContext = {
        ...nextContext,
        lastProductIds: suggestions.map((s) => s.id),
        lastProduct: focused ? { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name) } : null,
      };
    } else {
      replyText = "I couldn’t find an exact match in our catalogue. Can you share GSM, content (cotton/poly), and weave (poplin/twill/denim)?";
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
        const isLong = detail === "long";
        replyText = isLong ? formatLongSummary(p) : formatShortSummary(p);
        nextContext = {
          ...nextContext,
          lastProductIds: [p.id],
          lastProduct: { id: p.id, slug: p.productslug, name: pickFirstNonEmpty(p.productTitle, p.name) },
        };
      }
    }
  } else if (intent === "recommend") {
    if (hasMatch) {
      const top3 = ranked.filter((x) => x.score > 0).slice(0, 3).map(({ p }) => {
        const title = pickFirstNonEmpty(p.productTitle, p.name, p.fabricCode);
        const meta = [cleanStr(p.category), p.gsm ? `${cleanStr(p.gsm)} GSM` : "", toArr(p.color).slice(0, 2).join(", ")]
          .filter(Boolean)
          .join(" · ");
        return `• ${title}${meta ? ` — ${meta}` : ""}`;
      });
      replyText = `Here are a few matching options:\n${top3.join("\n")}\n\nWant details for the best match?`;
      nextContext = {
        ...nextContext,
        lastProductIds: suggestions.map((s) => s.id),
        lastProduct: focused ? { id: focused.id, slug: focused.productslug, name: pickFirstNonEmpty(focused.productTitle, focused.name) } : null,
      };
    } else {
      replyText = "I couldn’t find close matches. Tell me color, GSM range, content, and end-use (shirts/dresses/uniforms).";
      nextContext = { ...nextContext, lastProductIds: [] };
    }
  } else {
    // Unknown/smalltalk: steer user to product flow
    replyText = "Tell me what fabric you’re looking for (color, weave/structure, GSM, content). I’ll check our catalogue.";
  }

  const out = {
    ok: true,
    replyText,
    suggestions,
    context: nextContext,
    meta: {
      ts: nowIso(),
      intent,
      topScore,
      openaiUsed: !action?._openai_error,
    },
  };

  if (sessionId) SESSION_STORE.set(sessionId, nextContext);
  return res.json(out);
}

module.exports = { handleChatMessage };
