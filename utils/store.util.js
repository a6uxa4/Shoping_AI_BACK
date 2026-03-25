const mongoose = require("mongoose");
const { User } = require("../models/auth.model");

async function resolveStoreId(req) {
  if (req.user?._id) return req.user._id;

  const defaultStoreId = (process.env.DEFAULT_STORE_ID || "").toString().trim();
  if (defaultStoreId && mongoose.Types.ObjectId.isValid(defaultStoreId)) {
    return defaultStoreId;
  }

  const explicitStoreName = (req.query.storeName || req.headers["x-store-name"] || "")
    .toString()
    .trim();

  let mappedStoreName = "";
  try {
    const raw = (process.env.STORE_HOST_MAP || "").toString().trim();
    if (raw) {
      const map = JSON.parse(raw);
      const hostHeader = (req.headers.host || "").toString().trim();
      const hostOnly = hostHeader.split(":")[0];
      const origin = (req.headers.origin || "").toString().trim();
      let originHost = "";
      try {
        if (origin) originHost = new URL(origin).hostname;
      } catch {
        originHost = "";
      }

      mappedStoreName =
        (originHost && map[originHost]) ||
        (hostOnly && map[hostOnly]) ||
        (req.hostname && map[req.hostname]) ||
        "";
      if (mappedStoreName) mappedStoreName = mappedStoreName.toString().trim();
    }
  } catch {
    mappedStoreName = "";
  }

  const storeName =
    explicitStoreName || mappedStoreName || (process.env.DEFAULT_STORE_NAME || "").toString().trim();

  if (!storeName) {
    // Fallbacks when no store is explicitly specified.
    // 1) If there is exactly one user in DB - use it.
    const totalUsers = await User.countDocuments({});
    if (totalUsers === 1) {
      const onlyUser = await User.findOne({}).select("_id").sort({ createdAt: 1 }).lean();
      return onlyUser?._id || null;
    }
    return null;
  }

  const storeUser = await User.findOne({ storeName }).select("_id").lean();
  return storeUser?._id || null;
}

module.exports = { resolveStoreId };

