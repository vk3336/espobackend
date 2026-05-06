const express = require("express");
const { register, login, verifyOtp } = require("../controller/authController");
const { createRateLimit } = require("../middleware/rateLimit");

const router = express.Router();
const authLimiter = createRateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  keyPrefix: "auth",
  message: "Too many authentication requests. Please try again later.",
});

/**
 * POST /auth/register
 * Register new customer account and send OTP
 * Body: { email: string, firstName?: string, lastName?: string, name?: string, phoneNumber?: string }
 */
router.post("/register", authLimiter, register);

/**
 * POST /auth/login
 * Login with existing account (sends OTP)
 * Body: { email: string }
 */
router.post("/login", authLimiter, login);

/**
 * POST /auth/verify-otp
 * Verify OTP code
 * Body: { email: string, otp: string }
 */
router.post("/verify-otp", authLimiter, verifyOtp);

/**
 * GET /auth/health
 * Health check for auth routes
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Auth service is running",
    endpoints: {
      register: "POST /auth/register",
      login: "POST /auth/login",
      verifyOtp: "POST /auth/verify-otp",
    },
  });
});

module.exports = router;
