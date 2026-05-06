const { timingSafeEqual } = require("crypto");

function tokensMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireAdminToken(req, res, next) {
  const configuredToken = String(process.env.ADMIN_API_TOKEN || "");

  if (!configuredToken) {
    return res.status(500).json({
      success: false,
      error: "ADMIN_API_TOKEN is not configured",
    });
  }

  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  const providedToken = bearerToken || headerToken;

  if (!providedToken || !tokensMatch(providedToken, configuredToken)) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  return next();
}

module.exports = { requireAdminToken };
