const OpenAI = require("openai");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * Преобразует текстовый запрос пользователя в структурированные фильтры для поиска товаров.
 * @param {string} query - Поисковый запрос на естественном языке (например: "одежда на вечер", "красное платье для лета")
 * @param {Array<{_id: string, name: string}>} categories - Список категорий из БД для сопоставления по имени
 * @returns {Promise<{title?: string, category?: string, season?: string, material?: string, colors?: string[], minPrice?: number, maxPrice?: number, productionCountry?: string}>}
 */
async function queryToSearchFilters(query, categories = []) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY не задан. Добавьте ключ в .env для ИИ-поиска.");
  }

  const categoryNames = categories.map((c) => c.name).join(", ") || "no categories";

  const systemPrompt = `You extract structured product-search filters for an online clothing store.
The user message can be in English or Russian. Extract as much as possible.

Price/budget extraction (do this whenever present):
- "under 5000", "up to 5000", "$50", "below 100", "max 200" OR Russian equivalents ("до 5000", "не дороже 5000", "5000 руб", "до 5 тысяч") -> maxPrice (number)
- "from 3000", "over 1000", "above 1000" OR Russian equivalents ("от 3000", "выше 1000") -> minPrice (number)
- "from 2000 to 5000" -> minPrice and maxPrice

Category: match the product type to the exact category name from the list. If multiple types are present, return them in categoryNames array.
Title: keywords for matching product title (type, color, occasion).

Available categories (only these names): ${categoryNames}

Return STRICTLY one JSON object (no markdown, no extra text):
{
  "title": "keywords to search by product title",
  "categoryName": "one category name from the list or empty string",
  "categoryNames": ["category1","category2"] or [],
  "season": "summer|autumn|winter|spring|demi-season or empty string",
  "material": "material if mentioned",
  "colors": ["red","blue"] or [],
  "minPrice": number or null,
  "maxPrice": number or null,
  "productionCountry": "country or empty string",
  "occasion": "evening|casual|sport|office or empty string"
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: String(query).trim() || "show all" },
    ],
    temperature: 0.2,
  });

  const text = completion.choices[0]?.message?.content?.trim() || "{}";
  let parsed;
  try {
    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return {};
  }

  const filters = {};
  if (parsed.title) filters.title = parsed.title;
  if (parsed.season) filters.season = parsed.season;
  if (parsed.material) filters.material = parsed.material;
  if (parsed.colors && Array.isArray(parsed.colors) && parsed.colors.length > 0) filters.colors = parsed.colors;
  if (parsed.minPrice != null && !Number.isNaN(Number(parsed.minPrice))) filters.minPrice = Number(parsed.minPrice);
  if (parsed.maxPrice != null && !Number.isNaN(Number(parsed.maxPrice))) filters.maxPrice = Number(parsed.maxPrice);
  if (parsed.productionCountry) filters.productionCountry = parsed.productionCountry;

  function matchCategory(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    const exact = categories.find((c) => c.name.toLowerCase() === n);
    if (exact) return exact._id.toString();
    const partial = categories.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
    return partial ? partial._id.toString() : null;
  }

  const categoryIds = [];
  if (parsed.categoryNames && Array.isArray(parsed.categoryNames) && parsed.categoryNames.length > 0) {
    for (const cn of parsed.categoryNames) {
      const id = matchCategory(cn);
      if (id && !categoryIds.includes(id)) categoryIds.push(id);
    }
  }
  if (parsed.categoryName && categoryIds.length === 0) {
    const id = matchCategory(parsed.categoryName);
    if (id) categoryIds.push(id);
  }
  if (categoryIds.length > 0) filters.categories = categoryIds;

  if (parsed.occasion && !filters.title) {
    filters.title = parsed.occasion;
  }

  return filters;
}

/**
 * По описанию изображения от Vision API формирует текстовый запрос и возвращает его (далее можно вызвать queryToSearchFilters).
 * @param {string} base64Image - base64-строка изображения (без префикса data:image/...)
 * @param {string} mimeType - например "image/jpeg"
 * @returns {Promise<string>} Текстовое описание товара для поиска
 */
async function describeImageForSearch(base64Image, mimeType = "image/jpeg") {
  if (!openai) {
    throw new Error("OPENAI_API_KEY не задан. Добавьте ключ в .env для поиска по фото.");
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this item for searching in a clothing store: type (shirt, skirt, dress, jacket, shoes, etc.), color, season, material if visible, and occasion (evening/sport/casual). Return a single short English search query, e.g. 'red evening dress' or 'warm winter jacket'.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    max_tokens: 150,
  });

  const description = completion.choices[0]?.message?.content?.trim() || "одежда";
  return description;
}

module.exports = {
  queryToSearchFilters,
  describeImageForSearch,
  isAIAvailable: () => !!openai,
};
