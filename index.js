const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const compression = require("compression");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./public/swagger.json");

dotenv.config();
const app = express();

// Gzip responses. This is the biggest single win when products have base64
// images embedded in the documents — those compress 4-6x.
app.use(compression());

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err.message);
  });

// Index migration for guest chat (fixes the legacy unique userId_1 index)
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
    // Do not crash the server because of indexes: Mongo may lack dropIndex rights.
    console.warn("Conversation indexes init warning:", err.message || err);
  }
});

// Whitelist for local dev. Production frontends on *.vercel.app are matched
// dynamically below so preview URLs (e.g. shoping-ai-front-git-*.vercel.app)
// work without redeploying the backend.
const corsOrigins = [
  "http://localhost:3000",
  "http://10.111.70.191:3000",
  "https://shoping-ai-front.vercel.app",
];
const extraOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser tools (curl, Postman, server-to-server) where Origin
      // is undefined.
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      if (extraOrigins.includes(origin)) return cb(null, true);
      if (/\.vercel\.app$/i.test(new URL(origin).hostname)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
  }),
);

// Larger body limit so the AI image search can accept base64 photos (default ~100kb).
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

const cartRoutes = require("./routes/cart.routes");
app.use("/api/cart", cartRoutes);

const orderRoutes = require("./routes/order.routes");
app.use("/api/orders", orderRoutes);

const storeRequestRoutes = require("./routes/storeRequest.routes");
app.use("/api/store-requests", storeRequestRoutes);

// SWAGGER
app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode;
  const message = err.message || "Internal Server Error";

  // OpenAI errors: quota exceeded or unpaid plan (429)
  const isOpenAIQuotaError =
    status === 429 || (message && (message.includes("quota") || message.includes("429")));
  if (isOpenAIQuotaError) {
    return res.status(503).json({
      success: false,
      message:
        "AI is temporarily unavailable: OpenAI quota exceeded. Please check your balance and plan at https://platform.openai.com/account/billing",
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

// Mongoose query logging is very noisy and costs a lot when documents are
// large (every query is JSON-stringified to the console). Opt in via env.
if (process.env.MONGOOSE_DEBUG === "true") {
  mongoose.set("debug", true);
}

// On Vercel/Netlify (serverless) we do NOT call listen() — the platform wraps
// the exported app as a single function handler. Listening locally is OK.
if (!process.env.VERCEL) {
  const server = app.listen(PORT, "0.0.0.0", () => {
    const host = getLocalIP();
    console.log(`Server listening on port ${PORT}`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://${host}:${PORT}  <- for the frontend`);
  });

  // Allow long-running AI / image upload requests. Node defaults to 5 min
  // requestTimeout, but headersTimeout is only 60 s, so we raise both.
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 5 * 60 * 1000;
  server.keepAliveTimeout = 65 * 1000;
}

module.exports = app;
