const OpenAI = require("openai");
const { Product } = require("../models/product.model");
const { Category } = require("../models/manual.model");
const {
  queryToSearchFilters,
  describeImageForSearch,
} = require("./aiSearch.service");
const {
  bufferFromImageInput,
  computeDHashHex,
  computePHashHex,
  computeHashesForImages,
  typedHammingDistance64,
} = require("./imageHash.service");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MAX_PRODUCTS_IN_CHAT = 24;

function buildFilterFromAIFilters(aiFilters) {
  const filter = {};
  const orParts = [];
  const titleStr = aiFilters.title && String(aiFilters.title).trim();
  if (titleStr) {
    const words = titleStr.split(/\s+/).filter(Boolean);
    words.forEach((w) => orParts.push({ title: { $regex: w, $options: "i" } }));
  }
  const categoryIds = aiFilters.categories && Array.isArray(aiFilters.categories) ? aiFilters.categories : (aiFilters.category ? [aiFilters.category] : []);
  if (categoryIds.length > 0) orParts.push({ category: { $in: categoryIds } });
  if (orParts.length > 0) filter.$or = orParts;
  if (aiFilters.minPrice != null || aiFilters.maxPrice != null) {
    filter.price = {};
    if (aiFilters.minPrice != null) filter.price.$gte = Number(aiFilters.minPrice);
    if (aiFilters.maxPrice != null) filter.price.$lte = Number(aiFilters.maxPrice);
  }
  if (aiFilters.season && String(aiFilters.season).trim()) {
    filter.season = { $regex: String(aiFilters.season).trim(), $options: "i" };
  }
  if (aiFilters.material && String(aiFilters.material).trim()) {
    filter.material = { $regex: String(aiFilters.material).trim(), $options: "i" };
  }
  if (aiFilters.productionCountry && String(aiFilters.productionCountry).trim()) {
    filter.productionCountry = {
      $regex: String(aiFilters.productionCountry).trim(),
      $options: "i",
    };
  }
  if (aiFilters.colors && Array.isArray(aiFilters.colors) && aiFilters.colors.length > 0) {
    const colorRegex = aiFilters.colors.map((c) => new RegExp(String(c).trim(), "i"));
    filter.colors = { $in: colorRegex };
  }
  return filter;
}

function buildStoreScopeOrLegacyClause(storeId) {
  if (!storeId) return null;
  return {
    $or: [{ storeId }, { storeId: { $exists: false } }, { storeId: null }],
  };
}

function buildRelaxedTextFilterFromQuery(text) {
  const q = String(text || "").trim();
  if (!q) return {};
  const words = q
    .toLowerCase()
    .split(/[\s,.;:!?()"'«»]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (words.length === 0) return {};
  const regexes = words.map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const fields = ["title", "description", "material", "season", "productionCountry"];
  const orParts = [];
  for (const r of regexes) {
    for (const f of fields) {
      orParts.push({ [f]: { $regex: r } });
    }
    // Some fields are arrays (e.g. colors) — allow regex match within array items.
    orParts.push({ colors: { $in: [r] } });
  }

  if (orParts.length === 0) return {};
  return {
    $or: orParts,
  };
}

function toProductResponse(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: o._id,
    title: o.title,
    category: o.category,
    sizes: o.sizes,
    material: o.material,
    description: o.description,
    price: o.price,
    colors: o.colors,
    images: o.images,
    productionCountry: o.productionCountry,
    season: o.season,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/**
 * Подбор товаров по текстовому запросу или по описанию фото.
 */
async function searchProductsByQuery(queryText, limit = MAX_PRODUCTS_IN_CHAT, storeId = null) {
  const categories = await Category.find().lean();
  const categoriesWithId = categories.map((c) => ({
    _id: c._id.toString(),
    name: c.name,
  }));
  const aiFilters = await queryToSearchFilters(queryText, categoriesWithId);
  const filter = buildFilterFromAIFilters(aiFilters);
  // Backward-compatibility: older products may have no storeId.
  // If storeId is resolved, include both store-scoped products and legacy unscoped ones.
  if (storeId) {
    const scopeClause = buildStoreScopeOrLegacyClause(storeId);
    if (scopeClause) {
      filter.$and = filter.$and || [];
      filter.$and.push(scopeClause);
    }
  }
  const products = await Product.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return products.map((p) => toProductResponse(p));
}

/**
 * Подбор товаров по визуальной похожести (perceptual hash).
 * Возвращает товары, отсортированные по близости (distance: меньше = ближе).
 */
async function searchProductsByImageSimilarity(imageInput, limit = MAX_PRODUCTS_IN_CHAT, storeId = null) {
  const queryBuf = await bufferFromImageInput(imageInput, { maxBytes: 5 * 1024 * 1024 });
  if (!queryBuf) return { products: [], queryHash: null };

  const queryD = await computeDHashHex(queryBuf);
  const queryP = await computePHashHex(queryBuf);
  const queryHashes = [];
  if (queryD) queryHashes.push("d:" + queryD);
  if (queryP) queryHashes.push("p:" + queryP);
  if (queryHashes.length === 0) return { products: [], queryHash: null };

  // 64-bit dHash distance: 0 = identical, 64 = completely different.
  // This cutoff prevents returning "random" products when nothing is visually close.
  const MAX_DISTANCE = 16;
  const WINDOW_FROM_BEST = 6;

  const scopeClause = buildStoreScopeOrLegacyClause(storeId);
  const baseFilter = { images: { $exists: true, $type: "array", $ne: [] } };
  const filter = scopeClause ? { $and: [scopeClause, baseFilter] } : baseFilter;

  const candidates = await Product.find(filter)
    .select({
      storeId: 1,
      title: 1,
      category: 1,
      sizes: 1,
      material: 1,
      description: 1,
      price: 1,
      colors: 1,
      images: 1,
      imageHashes: 1,
      productionCountry: 1,
      season: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .limit(2000)
    .lean();

  const scored = [];
  for (const p of candidates) {
    let hashes = Array.isArray(p.imageHashes) ? p.imageHashes : [];
    if (hashes.length === 0) {
      hashes = await computeHashesForImages(p.images, { maxImages: 2 });
      if (hashes.length > 0) {
        Product.updateOne({ _id: p._id }, { $set: { imageHashes: hashes } }).catch(() => {});
      }
    }
    let best = Number.POSITIVE_INFINITY;
    for (const qh of queryHashes) {
      for (const h of hashes) {
        const d = typedHammingDistance64(qh, h);
        if (d < best) best = d;
      }
    }
    if (Number.isFinite(best)) scored.push({ product: p, distance: best });
  }

  scored.sort((a, b) => a.distance - b.distance);
  const bestDistance = scored.length ? scored[0].distance : Number.POSITIVE_INFINITY;
  const adaptiveCutoff = Math.min(MAX_DISTANCE, bestDistance + WINDOW_FROM_BEST);
  const filtered = scored.filter((x) => x.distance <= adaptiveCutoff);
  const top = filtered.slice(0, limit).map((x) => toProductResponse(x.product));
  return { products: top, queryHash: queryHashes[0], bestDistance, cutoff: adaptiveCutoff };
}

const SYSTEM_PROMPT = `You are a friendly fashion sales assistant for a clothing store. Always reply in English, short and to the point.
- On greeting, say hello and ask what the customer is looking for.
- If the customer describes an item (shirt, skirt, dress, jacket, jeans, etc.) or sends a photo, we will search and return products. Briefly say you found a few options and invite them to check the products below.
- Never invent product names or prices — they will be provided in a separate list.
- If they sent a photo, say you found similar items based on the photo.
- Reply in 1–3 short sentences, no long lists.`;

// Keywords that clearly mean "search products" (no model call needed). Keep RU+EN.
const PRODUCT_KEYWORDS = [
  "shirt", "skirt", "dress", "jacket", "coat", "jeans", "pants", "trousers", "shoes",
  "sneakers", "boots", "t-shirt", "tshirt", "blouse", "shorts", "suit", "bag",
  "accessories", "clothes", "clothing", "find", "show", "search", "looking for", "want",
  "$", "€", "£", "under ", "below ", "up to ", "max", "budget", "price",
];

const CLASSIFY_PROMPT = `Reply with exactly one word: SEARCH or CHAT.
SEARCH = the user wants to find/browse products: mentions clothing/shoes (shirt, skirt, dress, jacket, jeans, etc.) OR mentions a budget/price OR asks to show/find something. One or multiple product words is always SEARCH.
CHAT = greeting/thanks/bye or general talk without asking for products.
User message: `;

/**
 * Определяет, нужно ли искать товары по сообщению, или просто ответить (общение).
 * Фото — всегда SEARCH. Если в тексте есть слова-названия товаров — SEARCH без вызова модели.
 */
async function needProductSearch(userMessage, hasImage) {
  if (hasImage) return true;
  const text = String(userMessage || "").trim().toLowerCase();
  if (!text) return false;
  const hasProductKeyword = PRODUCT_KEYWORDS.some((kw) => text.includes(kw));
  if (hasProductKeyword) return true;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: CLASSIFY_PROMPT + text }],
    temperature: 0,
    max_tokens: 10,
  });
  const answer = (completion.choices[0]?.message?.content || "").trim().toUpperCase();
  return answer.startsWith("SEARCH");
}

/**
 * Формирует ответ бота: текст от GPT + подбор товаров только если клиент реально просит подбор (не при приветствии).
 */
async function getChatResponse(userMessage, imageBase64, mimeType, history = [], storeId = null) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY не задан. Добавьте ключ в .env для чата.");
  }

  let products = [];
  const hasImage = !!(imageBase64 && String(imageBase64).trim());
  const doSearch = hasImage || (await needProductSearch(userMessage, hasImage));

  if (doSearch && hasImage) {
    // 1) Try true "image-to-image" similarity first (no OpenAI needed).
    const sim = await searchProductsByImageSimilarity(imageBase64, MAX_PRODUCTS_IN_CHAT, storeId);
    products = sim.products || [];

    // 2) Fallback to Vision → text → filters if nothing visually similar found.
    const weakSimilarity =
      !products.length || (typeof sim.bestDistance === "number" && sim.bestDistance > 16);
    const imageStr = String(imageBase64 || "").trim();
    const looksLikeUrl = /^https?:\/\//i.test(imageStr);
    if (weakSimilarity && !looksLikeUrl) {
      const base64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, "").trim();
      const searchQuery = await describeImageForSearch(base64, mimeType || "image/jpeg");
      products = await searchProductsByQuery(searchQuery, MAX_PRODUCTS_IN_CHAT, storeId);

      // Fallback: if AI filters were too strict and nothing matched, try a relaxed keyword search.
      if (!products.length && searchQuery) {
        const relaxed = buildRelaxedTextFilterFromQuery(searchQuery);
        const scopeClause = buildStoreScopeOrLegacyClause(storeId);
        const fallbackFilter =
          scopeClause && Object.keys(relaxed).length
            ? { $and: [scopeClause, relaxed] }
            : scopeClause
              ? scopeClause
              : relaxed;
        if (Object.keys(fallbackFilter).length) {
          const fallbackProducts = await Product.find(fallbackFilter)
            .sort({ createdAt: -1 })
            .limit(MAX_PRODUCTS_IN_CHAT)
            .lean();
          products = fallbackProducts.map((p) => toProductResponse(p));
        }
      }
    }
  } else if (doSearch && userMessage && String(userMessage).trim()) {
    products = await searchProductsByQuery(String(userMessage).trim(), MAX_PRODUCTS_IN_CHAT, storeId);
  }

  const productListText =
    products.length > 0
      ? products
          .map((p, i) => `${i + 1}. ${p.title} — ${p.price} ₽ (id: ${p.id})`)
          .join("\n")
      : "";

  const userContent = productListText
    ? `Customer message: ${userMessage || "[sent a photo]"}\n\nFound products (mention briefly that you found options; do not invent names/prices):\n${productListText}`
    : hasImage
      ? "Customer sent a photo. No matching products were found."
      : (userMessage || "Customer sent a message.");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.6,
    max_tokens: 400,
  });

  const message = completion.choices[0]?.message?.content?.trim() || "How else can I help?";

  return { message, products };
}

module.exports = {
  getChatResponse,
  searchProductsByQuery,
};