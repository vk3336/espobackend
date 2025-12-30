// espoClient.js
async function espoRequest(path, { method = "GET", body, query } = {}) {
  const base = process.env.ESPO_BASE_URL.replace(/\/$/, "");
  const prefix = process.env.ESPO_API_PREFIX || "/api/v1";

  const url = new URL(base + prefix + path);

  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "")
        url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.ESPO_API_KEY, // keep secret on server
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const err = new Error("EspoCRM request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

module.exports = { espoRequest };
