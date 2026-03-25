const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./public/swagger.json");

dotenv.config();
const app = express();

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err.message);
  });

// Миграция индексов для гостевого чата (исправляет старый уникальный индекс userId_1)
mongoose.connection.on("connected", async () => {
  try {
    const { Conversation } = require("./models/conversation.model");
    const indexes = await Conversation.collection.indexes();
    const hasLegacyUserIdUnique = indexes.some(
      (i) => i.name === "userId_1" && i.unique === true && !i.sparse
    );
    if (hasLegacyUserIdUnique) {
      await Conversation.collection.dropIndex("userId_1");
    }
    await Conversation.collection.createIndex(
      { userId: 1 },
      { unique: true, sparse: true, name: "userId_1" }
    );
    await Conversation.collection.createIndex(
      { guestId: 1 },
      { unique: true, sparse: true, name: "guestId_1" }
    );
  } catch (err) {
    // Не валим сервер из-за индексов: Mongo может быть без прав dropIndex
    console.warn("Conversation indexes init warning:", err.message || err);
  }
});

const corsOrigins = ["http://localhost:3000", "http://10.111.70.191:3000"];

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  }),
);

// Увеличен лимит для загрузки base64-фото при ИИ-поиске (по умолчанию ~100kb)
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// API
const authRoutes = require("./routes/auth.routes");
app.use("/api/auth", authRoutes);

const userRoutes = require("./routes/user.routes");
app.use("/api/users", userRoutes);

const manualRoutes = require("./routes/manual.routes");
app.use("/api/manual", manualRoutes);

const productRoutes = require("./routes/product.routes");
app.use("/api/products", productRoutes);

const chatRoutes = require("./routes/chat.routes");
app.use("/api/chat", chatRoutes);

// SWAGGER
app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode;
  const message = err.message || "Internal Server Error";

  // Ошибки OpenAI: квота исчерпана или нет оплаты (429)
  const isOpenAIQuotaError =
    status === 429 || (message && (message.includes("quota") || message.includes("429")));
  if (isOpenAIQuotaError) {
    return res.status(503).json({
      success: false,
      message:
        "ИИ временно недоступен: исчерпана квота OpenAI. Проверьте баланс и тариф на https://platform.openai.com/account/billing",
      statusCode: 503,
    });
  }

  const statusCode = status || err.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message,
    statusCode,
  });
});

const PORT = process.env.PORT || 8080;
const os = require("os");

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

app.listen(PORT, "0.0.0.0", () => {
  const host = getLocalIP();
  console.log(`Server listening on port ${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${host}:${PORT}  ← для фронта`);
});

mongoose.set("debug", true);
