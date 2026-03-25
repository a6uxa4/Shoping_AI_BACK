const { Conversation } = require("../models/conversation.model");
const { getChatResponse } = require("../services/chat.service");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { resolveStoreId } = require("../utils/store.util");

const MAX_HISTORY_MESSAGES = 30;

function isValidObjectId(id) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

/**
 * GET /api/chat — история диалога текущего пользователя.
 */
const getConversation = async (req, res, next) => {
  try {
    const conversationId = req.query.conversationId;
    const guestId = req.query.guestId;

    let conv = null;
    if (req.user?._id) {
      conv = await Conversation.findOne({ userId: req.user._id }).lean();
    } else if (isValidObjectId(conversationId)) {
      conv = await Conversation.findById(conversationId).lean();
    } else if (guestId && String(guestId).trim()) {
      conv = await Conversation.findOne({ guestId: String(guestId).trim() }).lean();
    }

    if (!conv) {
      return res.json({
        success: true,
        data: { messages: [], conversationId: null, guestId: null },
      });
    }
    const messages = (conv.messages || []).slice(-MAX_HISTORY_MESSAGES).map((m) => ({
      role: m.role,
      content: m.content,
      productIds: m.productIds || [],
    }));
    return res.json({
      success: true,
      data: { messages, conversationId: conv._id, guestId: conv.guestId || null },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat — отправить сообщение боту (текст и/или фото). Бот ответит и может приложить подборку товаров.
 * Body: { message: string, image?: string (base64), mimeType?: string, conversationId?: string, guestId?: string }
 */
const sendMessage = async (req, res, next) => {
  try {
    let aborted = false;
    req.on("aborted", () => {
      aborted = true;
      console.warn("Chat request aborted by client");
    });

    const { message, image, mimeType, conversationId, guestId } = req.body || {};

    if (!message && !(image && String(image).trim())) {
      return res.status(400).json({
        success: false,
        data: { message: "Укажите message (текст) и/или image (base64 фото)." },
      });
    }

    let conv = null;
    let effectiveGuestId = guestId && String(guestId).trim() ? String(guestId).trim() : null;

    if (req.user?._id) {
      conv = await Conversation.findOne({ userId: req.user._id });
      if (!conv) conv = await Conversation.create({ userId: req.user._id, messages: [] });
    } else if (isValidObjectId(conversationId)) {
      conv = await Conversation.findById(conversationId);
      if (conv && conv.userId) {
        // Не даём писать в "чужую" авторизованную беседу без токена
        conv = null;
      }
    } else if (effectiveGuestId) {
      conv = await Conversation.findOne({ guestId: effectiveGuestId });
    }

    if (!conv) {
      if (!effectiveGuestId) effectiveGuestId = crypto.randomUUID();
      conv = await Conversation.create({ guestId: effectiveGuestId, messages: [] });
    }

    const history = (conv.messages || []).slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const storeId = await resolveStoreId(req);

    const { message: assistantMessage, products } = await getChatResponse(
      message || "",
      image,
      mimeType,
      history,
      storeId
    );

    // If the client already canceled the request, don't waste time writing to DB.
    if (aborted) return;

    const productIds = (products || []).map((p) => p.id);

    conv.messages.push({
      role: "user",
      content: message || "[фото]",
    });
    conv.messages.push({
      role: "assistant",
      content: assistantMessage,
      productIds,
    });
    if (conv.messages.length > 50) {
      conv.messages = conv.messages.slice(-50);
    }
    await conv.save();

    return res.json({
      success: true,
      data: {
        message: assistantMessage,
        products: products || [],
        conversationId: conv._id,
        guestId: conv.guestId || null,
      },
    });
  } catch (err) {
    if (err.message && err.message.includes("OPENAI_API_KEY")) {
      return res.status(503).json({
        success: false,
        data: { message: "Чат недоступен: не задан OPENAI_API_KEY в .env" },
      });
    }
    next(err);
  }
};

module.exports = {
  getConversation,
  sendMessage,
};
