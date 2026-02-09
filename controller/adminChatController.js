// controller/adminChatController.js
const ExcelJS = require("exceljs");
const { espoRequest } = require("./espoClient");

/* ------------------------------ constants (NO extra .env) ------------------------------ */
const PAGE_SIZE = 200; // Espo paging
const HARD_MAX_ROWS = 10000; // safety cap to avoid OOM

// ✅ Always generate Excel (small or large)
const ALWAYS_ATTACH_EXCEL = true;

// ✅ Keep chat UI light: show only preview rows in replyText (full data in Excel)
const PREVIEW_ROWS = 35;

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
function stripHtml(html) {
  const s = String(html || "");
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function truncate(s, max = 160) {
  const t = cleanStr(s);
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
function stringifyCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return truncate(stripHtml(v), 180);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return truncate(
      v
        .map((x) => stripHtml(cleanStr(x)))
        .filter(Boolean)
        .join(", "),
      200,
    );
  }
  if (typeof v === "object") return truncate(JSON.stringify(v), 200);
  return truncate(String(v), 180);
}
function isNullishValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return cleanStr(v) === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/* ------------------------------ admin entities (ONLY ADMIN_CHAT_ENTITIES) ------------------------------ */
function getAdminEntities() {
  const raw = cleanStr(process.env.ADMIN_CHAT_ENTITIES);
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => cleanStr(x))
    .filter(Boolean);
}
function normalizeEntityName(requested) {
  const req = cleanStr(requested);
  if (!req) return "";
  const allowed = getAdminEntities();
  const found = allowed.find((e) => norm(e) === norm(req));
  return found || "";
}

/* ------------------------------ Espo fetch (auto paging) ------------------------------ */
async function fetchAllRecords(entity) {
  const e = cleanStr(entity);
  if (!e) return { list: [], truncated: false };

  let offset = 0;
  const all = [];
  let truncated = false;

  while (true) {
    const data = await espoRequest(`/${e}`, {
      query: {
        maxSize: PAGE_SIZE,
        offset,
        orderBy: "modifiedAt",
        order: "desc",
      },
    });

    const list = Array.isArray(data?.list) ? data.list : [];
    all.push(...list);

    if (all.length >= HARD_MAX_ROWS) {
      truncated = true;
      break;
    }
    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { list: all.slice(0, HARD_MAX_ROWS), truncated };
}

async function fetchRecord(entity, id) {
  const e = cleanStr(entity);
  const rid = cleanStr(id);
  if (!e || !rid) return null;
  return espoRequest(`/${e}/${rid}`, { method: "GET" });
}

/* ------------------------------ markdown table ------------------------------ */
function escapePipe(s) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}
function toMarkdownTable(columns, rows) {
  const cols = columns.map((c) => escapePipe(c));
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = (rows || [])
    .map(
      (r) => `| ${columns.map((c) => escapePipe(r?.[c] ?? "")).join(" | ")} |`,
    )
    .join("\n");
  return [header, sep, body].filter(Boolean).join("\n");
}

/* ------------------------------ Excel export (INLINE: base64) ------------------------------ */
async function makeExcelBase64({ filename, sheets }) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  for (const sh of sheets || []) {
    const ws = wb.addWorksheet(sh.name || "Sheet");
    ws.columns = (sh.columns || []).map((c) => ({
      header: c,
      key: c,
      width: Math.min(70, Math.max(12, String(c).length + 6)),
    }));

    for (const row of sh.rows || []) ws.addRow(row);

    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // nicer filters
    try {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: (sh.columns || []).length || 1 },
      };
    } catch {
      // Ignore autoFilter errors
    }
  }

  const arr = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arr);

  return {
    kind: "xlsx", // ✅ IMPORTANT: your frontend checks download.kind === "xlsx"
    filename,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: buffer.toString("base64"),
  };
}

function shouldAttachExcel(rows, colsCount, wantsExcel) {
  if (ALWAYS_ATTACH_EXCEL) return true;
  if (wantsExcel) return true;
  // old thresholds removed because you want ALWAYS
  return false;
}

/* ------------------------------ OpenAI parse (optional; only for intent routing) ------------------------------ */
function extractOutputText(openaiResponseJson) {
  try {
    const out = openaiResponseJson?.output || [];
    for (const item of out) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string")
            {return c.text;}
        }
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return "";
}
async function openaiJson(schemaName, schema, system, user) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const body = {
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_output_tokens: 250,
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
    const e = new Error("OpenAI parse failed");
    e.status = resp.status;
    e.data = json;
    throw e;
  }

  const text = extractOutputText(json);
  return JSON.parse(text);
}

/* ------------------------------ Admin intent parsing ------------------------------ */
function heuristicParse(message) {
  const m = norm(message);
  const allowed = getAdminEntities();

  let entity = "";
  for (const e of allowed) {
    if (m.includes(norm(e))) {
      entity = e;
      break;
    }
  }

  const idMatch = String(message || "").match(/\b[a-zA-Z0-9]{15,}\b/);
  const id = idMatch ? idMatch[0] : null;

  let intent = "unknown";
  if (m.includes("null") || m.includes("missing") || m.includes("empty"))
    {intent = "audit_nulls";}
  else if (
    m.includes("detail") ||
    m.includes("show record") ||
    (m.includes("id") && id)
  )
    {intent = "detail";}
  else if (m.includes("fields") || m.includes("columns"))
    {intent = "field_summary";}
  else if (m.includes("list") || m.includes("show") || m.includes("all"))
    {intent = "list";}

  const wantsExcel =
    m.includes("excel") || m.includes("export") || m.includes("sheet");
  return { intent, entity, id, wantsExcel, usedOpenAI: false };
}

async function parseAdminMessage(message) {
  if (!cleanStr(process.env.OPENAI_API_KEY)) return heuristicParse(message);

  const allowed = getAdminEntities();
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: ["audit_nulls", "list", "detail", "field_summary", "unknown"],
      },
      entity: { type: ["string", "null"] },
      id: { type: ["string", "null"] },
      wantsExcel: { type: "boolean" },
    },
    required: ["intent", "entity", "id", "wantsExcel"],
  };

  const system =
    "You are an admin audit router. Return ONLY JSON.\n" +
    "Pick intent:\n" +
    "- audit_nulls: user asks missing/null fields\n" +
    "- list: user asks list/all records\n" +
    "- detail: user asks one record details (often by id)\n" +
    "- field_summary: user asks fields/columns\n" +
    "Entity must be one of AllowedEntities.\n" +
    "If user wants excel/export, wantsExcel=true.";

  const user = `AllowedEntities: ${safeJson(allowed)}\nAdmin message: ${message}`;

  try {
    const r = await openaiJson(
      "admin_audit_action_inline_excel",
      schema,
      system,
      user,
    );
    return { ...r, usedOpenAI: true };
  } catch {
    return heuristicParse(message);
  }
}

/* ------------------------------ audit helpers ------------------------------ */
function getTitle(entity, rec) {
  if (!rec) return "";
  if (entity === "CProduct") {
    return (
      cleanStr(rec.productTitle) ||
      cleanStr(rec.name) ||
      cleanStr(rec.fabricCode) ||
      ""
    );
  }
  return (
    cleanStr(rec.title) ||
    cleanStr(rec.name) ||
    cleanStr(rec.subject) ||
    cleanStr(rec.heading) ||
    ""
  );
}

function collectColumns(records, { sample = 60 } = {}) {
  const set = new Set(["id"]);
  const s = records.slice(0, sample);
  for (const r of s) Object.keys(r || {}).forEach((k) => set.add(k));
  const cols = Array.from(set).filter(Boolean);
  cols.sort((a, b) => (a === "id" ? -1 : b === "id" ? 1 : a.localeCompare(b)));
  return cols;
}

/**
 * ✅ IMPORTANT CHANGE:
 * - We generate PER-RECORD rows for Excel without truncation.
 * - Field Summary stays optional (2nd sheet), but Per Record is sheet #1.
 */
function computeNullAudit(entity, records) {
  const cols = collectColumns(records, {
    sample: Math.min(120, records.length),
  })
    .filter((c) => c !== "id")
    .sort((a, b) => a.localeCompare(b));

  const perFieldMissing = new Map();
  const perRecordPreview = [];
  const perRecordExcel = [];

  for (const r of records) {
    const id = cleanStr(r?.id);
    if (!id) continue;

    const missing = [];
    for (const f of cols) {
      if (isNullishValue(r?.[f])) missing.push(f);
    }
    for (const f of missing)
      {perFieldMissing.set(f, (perFieldMissing.get(f) || 0) + 1);}

    const title = cleanStr(getTitle(entity, r));

    // For Excel: FULL list (no truncate)
    perRecordExcel.push({
      ID: id,
      Title: title,
      MissingCount: String(missing.length),
      MissingFields: missing.join(", "),
    });

    // For chat preview: trimmed text (fast UI)
    perRecordPreview.push({
      ID: id,
      Title: truncate(title, 80),
      MissingCount: String(missing.length),
      MissingFields: truncate(missing.join(", "), 260),
    });
  }

  const total = perRecordExcel.length || 1;
  const fieldRows = Array.from(perFieldMissing.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => ({
      Field: field,
      MissingCount: String(count),
      MissingPct: `${Math.round((count / total) * 100)}%`,
    }));

  return { fieldRows, perRecordPreview, perRecordExcel };
}

/* ------------------------------ main handler ------------------------------ */
async function handleAdminChatMessage(req, res) {
  const message = cleanStr(req.body?.message);
  if (!message)
    {return res.status(400).json({ ok: false, error: "message is required" });}

  const allowed = getAdminEntities();

  // If env missing: still return an Excel so you always have download
  if (!allowed.length) {
    const rows = [
      { Error: "ADMIN_CHAT_ENTITIES is missing in .env" },
      {
        Example: "ADMIN_CHAT_ENTITIES=CProduct,CCollection,CCompanyInformation",
      },
    ];

    const md =
      toMarkdownTable(["Error"], [{ Error: rows[0].Error }]) +
      "\n\n" +
      toMarkdownTable(["Example"], [{ Example: rows[1].Example }]);

    const download = await makeExcelBase64({
      filename: `AdminChat_error_${nowIso().slice(0, 10)}.xlsx`,
      sheets: [
        {
          name: "Error",
          columns: ["Error", "Example"],
          rows: [{ Error: rows[0].Error, Example: rows[1].Example }],
        },
      ],
    });

    return res.json({
      ok: true,
      replyText: md,
      tables: [
        {
          name: "Error",
          columns: ["Error", "Example"],
          rows: [{ Error: rows[0].Error, Example: rows[1].Example }],
        },
      ],
      download,
      meta: {
        ts: nowIso(),
        intent: "unknown",
        targetEntity: null,
        usedOpenAI: false,
      },
    });
  }

  const action = await parseAdminMessage(message);
  const intent = cleanStr(action?.intent) || "unknown";
  const wantsExcel = !!action?.wantsExcel;
  const usedOpenAI = !!action?.usedOpenAI;

  const entity = normalizeEntityName(action?.entity);

  // If entity not detected: show allowed + excel
  if (!entity) {
    const rows = allowed.map((e) => ({ Entity: e }));
    const md = toMarkdownTable(["Entity"], rows.slice(0, PREVIEW_ROWS));

    const download = await makeExcelBase64({
      filename: `AllowedEntities_${nowIso().slice(0, 10)}.xlsx`,
      sheets: [{ name: "AllowedEntities", columns: ["Entity"], rows }],
    });

    return res.json({
      ok: true,
      replyText: md,
      tables: [{ name: "AllowedEntities", columns: ["Entity"], rows }],
      download,
      meta: { ts: nowIso(), intent: "unknown", targetEntity: null, usedOpenAI },
    });
  }

  /* ---------------- field summary ---------------- */
  if (intent === "field_summary") {
    const { list, truncated } = await fetchAllRecords(entity);
    const cols = collectColumns(list, { sample: Math.min(200, list.length) })
      .filter((c) => c !== "id")
      .sort((a, b) => a.localeCompare(b));

    const rows = [{ Field: "id" }, ...cols.map((c) => ({ Field: c }))];
    const preview = rows.slice(0, PREVIEW_ROWS);

    const md =
      toMarkdownTable(["Field"], preview) +
      (rows.length > PREVIEW_ROWS
        ? `\n\n(Preview: ${PREVIEW_ROWS}/${rows.length}. Full in Excel.)`
        : "");

    const download = shouldAttachExcel(rows.length, 1, wantsExcel)
      ? await makeExcelBase64({
          filename: `${entity}_fields_${nowIso().slice(0, 10)}.xlsx`,
          sheets: [{ name: "Fields", columns: ["Field"], rows }],
        })
      : null;

    return res.json({
      ok: true,
      replyText: md,
      tables: [{ name: "Fields", columns: ["Field"], rows }],
      download,
      meta: {
        ts: nowIso(),
        intent,
        targetEntity: entity,
        truncated,
        usedOpenAI,
      },
    });
  }

  /* ---------------- detail ---------------- */
  if (intent === "detail") {
    const id = cleanStr(action?.id);
    if (!id) {
      const rows = [
        { Entity: entity, Error: "Please include record id for detail." },
      ];
      const md = toMarkdownTable(["Entity", "Error"], rows);

      const download = await makeExcelBase64({
        filename: `${entity}_detail_error_${nowIso().slice(0, 10)}.xlsx`,
        sheets: [{ name: "Error", columns: ["Entity", "Error"], rows }],
      });

      return res.json({
        ok: true,
        replyText: md,
        tables: [{ name: "Error", columns: ["Entity", "Error"], rows }],
        download,
        meta: {
          ts: nowIso(),
          intent,
          targetEntity: entity,
          id: null,
          usedOpenAI,
        },
      });
    }

    const rec = await fetchRecord(entity, id).catch(() => null);
    if (!rec) {
      const rows = [
        { Entity: entity, ID: id, Error: "Record not found / fetch failed." },
      ];
      const md = toMarkdownTable(["Entity", "ID", "Error"], rows);

      const download = await makeExcelBase64({
        filename: `${entity}_detail_${id}_not_found.xlsx`,
        sheets: [{ name: "Error", columns: ["Entity", "ID", "Error"], rows }],
      });

      return res.json({
        ok: true,
        replyText: md,
        tables: [{ name: "Error", columns: ["Entity", "ID", "Error"], rows }],
        download,
        meta: { ts: nowIso(), intent, targetEntity: entity, id, usedOpenAI },
      });
    }

    const keys = Object.keys(rec || {}).sort((a, b) => a.localeCompare(b));
    const rows = keys.map((k) => ({ Field: k, Value: stringifyCell(rec[k]) }));
    const preview = rows.slice(0, PREVIEW_ROWS);

    const md =
      toMarkdownTable(["Field", "Value"], preview) +
      (rows.length > PREVIEW_ROWS
        ? `\n\n(Preview: ${PREVIEW_ROWS}/${rows.length}. Full in Excel.)`
        : "");

    const download = await makeExcelBase64({
      filename: `${entity}_detail_${id}.xlsx`,
      sheets: [{ name: "Detail", columns: ["Field", "Value"], rows }],
    });

    return res.json({
      ok: true,
      replyText: md,
      tables: [{ name: "Detail", columns: ["Field", "Value"], rows }],
      download,
      meta: { ts: nowIso(), intent, targetEntity: entity, id, usedOpenAI },
    });
  }

  /* ---------------- audit nulls ---------------- */
  if (intent === "audit_nulls") {
    const { list, truncated } = await fetchAllRecords(entity);
    const { fieldRows, perRecordPreview, perRecordExcel } = computeNullAudit(
      entity,
      list,
    );

    // ✅ Show PER-RECORD preview in chat (this is what you want to understand)
    const preview = perRecordPreview.slice(0, PREVIEW_ROWS);

    const mdPerRecord =
      toMarkdownTable(
        ["ID", "Title", "MissingCount", "MissingFields"],
        preview.length
          ? preview
          : [{ ID: "-", Title: "-", MissingCount: "0", MissingFields: "-" }],
      ) +
      (perRecordExcel.length > PREVIEW_ROWS
        ? `\n\n(Preview: ${PREVIEW_ROWS}/${perRecordExcel.length}. Full in Excel.)`
        : "");

    // ✅ Excel: sheet#1 = Per Record (FULL, not truncated)
    // ✅ Excel: sheet#2 = Field Summary (optional, but not first)
    const download = await makeExcelBase64({
      filename: `${entity}_null_audit_${nowIso().slice(0, 10)}.xlsx`,
      sheets: [
        {
          name: "Per Record",
          columns: ["ID", "Title", "MissingCount", "MissingFields"],
          rows: perRecordExcel,
        },
        {
          name: "Field Summary",
          columns: ["Field", "MissingCount", "MissingPct"],
          rows: fieldRows,
        },
      ],
    });

    return res.json({
      ok: true,
      replyText: mdPerRecord,
      tables: [
        {
          name: "PerRecord",
          columns: ["ID", "Title", "MissingCount", "MissingFields"],
          rows: perRecordExcel,
        },
        {
          name: "FieldSummary",
          columns: ["Field", "MissingCount", "MissingPct"],
          rows: fieldRows,
        },
      ],
      download,
      meta: {
        ts: nowIso(),
        intent,
        targetEntity: entity,
        totalRecords: perRecordExcel.length,
        truncated,
        usedOpenAI,
      },
    });
  }

  /* ---------------- list (default) ---------------- */
  const { list, truncated } = await fetchAllRecords(entity);

  const cols = collectColumns(list, { sample: Math.min(60, list.length) });
  const rows = list.map((r) => {
    const obj = {};
    for (const c of cols) obj[c] = stringifyCell(r?.[c]);
    return obj;
  });

  const preview = rows.slice(0, PREVIEW_ROWS);
  const md =
    toMarkdownTable(cols, preview) +
    (rows.length > PREVIEW_ROWS
      ? `\n\n(Preview: ${PREVIEW_ROWS}/${rows.length}. Full in Excel.)`
      : "");

  const download = await makeExcelBase64({
    filename: `${entity}_list_${nowIso().slice(0, 10)}.xlsx`,
    sheets: [{ name: "List", columns: cols, rows }],
  });

  return res.json({
    ok: true,
    replyText: md,
    tables: [{ name: "List", columns: cols, rows }],
    download,
    meta: {
      ts: nowIso(),
      intent: "list",
      targetEntity: entity,
      totalRows: rows.length,
      truncated,
      usedOpenAI,
    },
  });
}

module.exports = { handleAdminChatMessage };
