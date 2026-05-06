// routes/adminChat.js
const express = require("express");
const { handleAdminChatMessage } = require("../controller/adminChatController");

function createAdminChatRoutes() {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ ok: true, feature: "admin-chat" });
  });

  router.post("/message", handleAdminChatMessage);

  return router;
}

module.exports = createAdminChatRoutes;
