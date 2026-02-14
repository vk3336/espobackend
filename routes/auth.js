const express = require("express");
const { register, login, verifyOtp } = require("../controller/authController");

const router = express.Router();

/**
 * POST /auth/register
 * Register new customer account and send OTP
 * Body: { email: string, firstName?: string, lastName?: string, name?: string, phoneNumber?: string }
 */
router.post("/register", register);

/**
 * POST /auth/login
 * Login with existing account (sends OTP)
 * Body: { email: string }
 */
router.post("/login", login);

/**
 * POST /auth/verify-otp
 * Verify OTP code
 * Body: { email: string, otp: string }
 */
router.post("/verify-otp", verifyOtp);

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
