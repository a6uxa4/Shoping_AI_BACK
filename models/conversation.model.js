const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    productIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Для гостевого чата без авторизации
    guestId: {
      type: String,
      required: false,
      trim: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// У пользователя — одна беседа. Для гостя — одна беседа на guestId.
conversationSchema.index({ userId: 1 }, { unique: true, sparse: true });
conversationSchema.index({ guestId: 1 }, { unique: true, sparse: true });

const Conversation = mongoose.model("Conversation", conversationSchema);

module.exports = { Conversation };
