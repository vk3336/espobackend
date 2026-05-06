function cleanStr(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function buildPrimaryRevalidateUrl() {
  const frontendUrl = cleanStr(process.env.FRONTEND_URL);
  if (!frontendUrl) return "";

  try {
    return new URL("/api/revalidate", frontendUrl).toString();
  } catch {
    console.warn("[Revalidate] Ignoring invalid FRONTEND_URL");
    return "";
  }
}

async function revalidateFrontends() {
  const secret = cleanStr(process.env.REVALIDATE_SECRET);
  const urls = [
    buildPrimaryRevalidateUrl(),
    cleanStr(process.env.FRONTEND_B_REVALIDATE_URL),
  ].filter(Boolean);

  if (!urls.length) {
    return [];
  }

  return Promise.allSettled(
    urls.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      }),
    ),
  );
}

module.exports = { revalidateFrontends };
