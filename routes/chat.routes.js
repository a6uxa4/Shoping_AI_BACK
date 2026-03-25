const express = require("express");
const chatController = require("../controllers/chat.controller");
const { optionalAuthenticate } = require("../middleware/auth.middleware");

const router = express.Router();

// Публичный чат (без токена). История по conversationId/guestId.
router.get("/", optionalAuthenticate, chatController.getConversation);
router.post("/", optionalAuthenticate, chatController.sendMessage);

module.exports = router;
