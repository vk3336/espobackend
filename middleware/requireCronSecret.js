function requireCronSecret(req, res, next) {
  const configuredSecret = String(process.env.CRON_SECRET || "").trim();
  const authHeader = String(req.headers.authorization || "").trim();

  if (!configuredSecret) {
    return res.status(500).json({
      success: false,
      error: "CRON_SECRET is not configured",
    });
  }

  if (authHeader !== `Bearer ${configuredSecret}`) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  return next();
}

module.exports = { requireCronSecret };
