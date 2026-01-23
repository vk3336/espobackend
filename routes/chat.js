const express = require("express");

const { handleChatMessage } = require("../controller/chatController");

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

  router.post("/message", handleChatMessage);

  return router;
}

module.exports = createChatRoutes;
