const crypto = require("crypto");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireIntegrationKey(req, res, next) {
  if (req.session?.socialAuthed) return next();
  const configured = process.env.INTEGRATION_API_KEY || process.env.ADMIN_KEY;
  if (!configured) return res.status(503).json({ ok: false, error: "integration_key_not_configured" });
  const provided = req.get("x-api-key") || req.query.apiKey || req.body?.apiKey;
  if (!safeEqual(provided, configured)) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

module.exports = { requireIntegrationKey };
