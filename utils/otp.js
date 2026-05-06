const crypto = require("crypto");

/**
 * Generate a random 6-digit OTP
 */
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // 6-digit OTP
}

/**
 * Hash OTP with user ID for security
 */
function hashOtp(otp, userId) {
  const secret = process.env.OTP_SECRET;
  if (!secret) throw new Error("OTP_SECRET missing in environment variables");

  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${otp}`)
    .digest("hex");
}

/**
 * Timing-safe comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * Parse EspoCRM datetime format to JavaScript Date
 * EspoCRM typically returns: "YYYY-MM-DD HH:mm:ss"
 */
function parseEspoDate(str) {
  if (!str) return null;
  // Convert "2026-02-14 06:59:44" -> "2026-02-14T06:59:44"
  const iso = String(str).replace(" ", "T");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format JavaScript Date to EspoCRM datetime format
 * Returns: "YYYY-MM-DD HH:mm:ss"
 */
function formatEspoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
  generateOtp,
  hashOtp,
  timingSafeEqual,
  parseEspoDate,
  formatEspoDate,
};
