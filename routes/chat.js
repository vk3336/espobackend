const express = require("express");

const { handleChatMessage } = require("../controller/chatController");
const { createRateLimit } = require("../middleware/rateLimit");

const chatLimiter = createRateLimit({
  windowMs: Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000),
  limit: Number(process.env.CHAT_RATE_LIMIT_MAX || 30),
  keyPrefix: "chat",
  message: "Too many chat requests. Please try again later.",
});

/**
 * Chat routes
 *
 * Mounted at: /<baseName>/chat
 *
 * POST /message
 *   body: { message: string, mode?: 'auto'|'short'|'long', context?: object, sessionId?: string }
 */
function createChatRoutes() {
  const router = express.Router();

  // Simple health check for the chat feature
  router.get("/health", (req, res) => {
    res.json({ ok: true, feature: "chat" });
  });

  router.post("/message", chatLimiter, handleChatMessage);

  return router;
}

module.exports = createChatRoutes;
