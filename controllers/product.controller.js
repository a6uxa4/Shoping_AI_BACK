const { Product } = require("../models/product.model");
const { Category } = require("../models/manual.model");
const {
  queryToSearchFilters,
  describeImageForSearch,
} = require("../services/aiSearch.service");
const {
  computeHashesForImages,
} = require("../services/imageHash.service");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_CLIENT_LIMIT = 500; // клиент без пагинации — макс. кол-во товаров в ответе

function normalizeSizePrices(sizePrices) {
  if (!Array.isArray(sizePrices)) return [];
  return sizePrices
    .map((s) => ({
      size: s?.size != null ? String(s.size).trim() : "",
      price: Number(s?.price),
    }))
    .filter((s) => s.size && Number.isFinite(s.price) && s.price >= 0);
}

function normalizeVariants(variants) {
  if (!Array.isArray(variants)) return [];
  return variants
    .map((v) => ({
      size: v?.size != null ? String(v.size).trim() : "",
      color: v?.color != null ? String(v.color).trim() : "",
      price: Number(v?.price),
      stock: Math.max(0, Number(v?.stock) || 0),
      sku: v?.sku != null ? String(v.sku).trim() : "",
    }))
    .filter((v) => v.size && v.color && Number.isFinite(v.price) && v.price >= 0);
}

/**
 * Convert a Mongoose product into the API response shape.
 *
 * When `lightweight` is true, the response is trimmed for list endpoints:
 *   - only the first image is included (cards only show one),
 *   - `imageCount` is added so the UI knows there are more,
 *   - `imageHashes` is dropped (only the similarity search needs it).
 * The drawer/detail view should refetch by id to load the full gallery.
 */
function toProductResponse(doc, { lightweight = false } = {}) {
  const o = doc.toObject ? doc.toObject() : doc;
  const allImages = Array.isArray(o.images) ? o.images : [];
  const images = lightweight ? allImages.slice(0, 1) : allImages;
  return {
    id: o._id,
    storeId: o.storeId,
    title: o.title,
    category: o.category,
    categories: o.categories || (o.category ? [o.category] : []),
    sizes: o.sizes,
    sizePrices: o.sizePrices || [],
    stock: typeof o.stock === "number" ? o.stock : 0,
    material: o.material,
    description: o.description,
    price: o.price,
    colors: o.colors,
    variants: o.variants || [],
    images,
    imageCount: allImages.length,
    productionCountry: o.productionCountry,
    season: o.season,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/**
 * Строит фильтр и метаданные ИИ из req.query (общая логика для клиента и админки).
 */
async function getFilterFromRequest(req, categoriesWithId) {
  let filter = {};
  let aiUsed = false;
  let dataQuery = null;
  let describedAs = null;
  let aiFilters = null;

  if (req.query.image && String(req.query.image).trim()) {
    const base64Image = String(req.query.image).replace(/^data:image\/\w+;base64,/, "").trim();
    const mimeType = req.query.mimeType || "image/jpeg";
    describedAs = await describeImageForSearch(base64Image, mimeType);
    aiFilters = await queryToSearchFilters(describedAs, categoriesWithId);
    filter = buildFilterFromAIFilters(aiFilters);
    aiUsed = true;
  } else if ((req.query.q || req.query.query) && String(req.query.q || req.query.query).trim()) {
    const q = String(req.query.q || req.query.query).trim();
    aiFilters = await queryToSearchFilters(q, categoriesWithId);
    filter = buildFilterFromAIFilters(aiFilters);
    dataQuery = q;
    aiUsed = true;
  } else {
    if (req.query.category) {
      filter.$or = [
        { category: req.query.category },
        { categories: { $in: [req.query.category] } },
      ];
    }
    if (req.query.title && String(req.query.title).trim()) {
      filter.title = { $regex: String(req.query.title).trim(), $options: "i" };
    }
    if (req.query.minPrice != null && req.query.minPrice !== "") {
      filter.price = filter.price || {};
      filter.price.$gte = Number(req.query.minPrice) || 0;
    }
    if (req.query.maxPrice != null && req.query.maxPrice !== "") {
      filter.price = filter.price || {};
      filter.price.$lte = Number(req.query.maxPrice) || 0;
    }
    if (req.query.season && String(req.query.season).trim()) {
      filter.season = { $regex: String(req.query.season).trim(), $options: "i" };
    }
    if (req.query.material && String(req.query.material).trim()) {
      filter.material = { $regex: String(req.query.material).trim(), $options: "i" };
    }
    if (req.query.productionCountry && String(req.query.productionCountry).trim()) {
      filter.productionCountry = {
        $regex: String(req.query.productionCountry).trim(),
        $options: "i",
      };
    }
  }

  return { filter, aiUsed, dataQuery, describedAs, aiFilters };
}

/**
 * GET /api/products — для клиента: без пагинации (все подходящие товары, макс. MAX_CLIENT_LIMIT).
 * Поддерживает фильтры, ИИ по тексту (q/query), ИИ по фото (image).
 */
const getAllProducts = async (req, res, next) => {
  try {
    const categories = await Category.find().lean();
    const categoriesWithId = categories.map((c) => ({
      _id: c._id.toString(),
      name: c.name,
    }));

    let filter, aiUsed, dataQuery, describedAs, aiFilters;
    try {
      ({ filter, aiUsed, dataQuery, describedAs, aiFilters } = await getFilterFromRequest(
        req,
        categoriesWithId,
      ));
    } catch (err) {
      if (err.message && err.message.includes("OPENAI_API_KEY")) {
        return res.status(503).json({
          success: false,
          data: { message: "AI search is unavailable: OPENAI_API_KEY is not set in .env" },
        });
      }
      throw err;
    }

    const products = await Product.find(filter)
      // Slim projection — every byte over the network counts when images are
      // stored as base64 inside the document. We keep just the first image and
      // drop imageHashes (only used by image-similarity search internally).
      .select({ imageHashes: 0, "images": { $slice: 1 } })
      .sort({ createdAt: -1 })
      .limit(MAX_CLIENT_LIMIT)
      .lean();

    const data = {
      products: products.map((p) => toProductResponse(p, { lightweight: true })),
    };
    if (aiUsed) {
      data.aiUsed = true;
      if (dataQuery != null) data.query = dataQuery;
      if (describedAs != null) data.describedAs = describedAs;
      if (aiFilters && Object.keys(aiFilters).length) data.aiFilters = aiFilters;
    }

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/products/admin — для админки: с пагинацией (page, limit, total, totalPages).
 * Те же фильтры и ИИ. Только для admin / super_admin.
 */
const getProductsAdmin = async (req, res, next) => {
  try {
    const storeId = req.user?._id;
    if (!storeId) {
      return res.status(401).json({ success: false, message: "Authorization required" });
    }
    let page = Math.max(1, parseInt(req.query.page, 10) || DEFAULT_PAGE);
    let limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT),
    );

    const categories = await Category.find().lean();
    const categoriesWithId = categories.map((c) => ({
      _id: c._id.toString(),
      name: c.name,
    }));

    let filter, aiUsed, dataQuery, describedAs, aiFilters;
    try {
      ({ filter, aiUsed, dataQuery, describedAs, aiFilters } = await getFilterFromRequest(
        req,
        categoriesWithId,
      ));
    } catch (err) {
      if (err.message && err.message.includes("OPENAI_API_KEY")) {
        return res.status(503).json({
          success: false,
          data: { message: "AI search is unavailable: OPENAI_API_KEY is not set in .env" },
        });
      }
      throw err;
    }

    // Always scope admin to their store
    filter.storeId = storeId;

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .select({ imageHashes: 0, "images": { $slice: 1 } })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    const data = {
      products: products.map((p) => toProductResponse(p, { lightweight: true })),
      pagination: { page, limit, total, totalPages },
    };
    if (aiUsed) {
      data.aiUsed = true;
      if (dataQuery != null) data.query = dataQuery;
      if (describedAs != null) data.describedAs = describedAs;
      if (aiFilters && Object.keys(aiFilters).length) data.aiFilters = aiFilters;
    }

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/products/:id — один товар по ID.
 */
const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id).lean();
    if (!product) {
      return res.status(404).json({
        success: false,
        data: { message: "Product not found" },
      });
    }
    return res.json({
      success: true,
      data: { product: toProductResponse(product) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/products
 * Create a product.
 */
const createProduct = async (req, res, next) => {
  try {
    const storeId = req.user?._id;
    if (!storeId) {
      return res.status(401).json({ success: false, message: "Authorization required" });
    }
    const {
      title,
      category,
      categories,
      sizes,
      sizePrices,
      material,
      description,
      price,
      stock,
      colors,
      variants,
      images,
      productionCountry,
      season,
    } = req.body;

    const rawCategories = Array.isArray(categories) ? categories : category ? [category] : [];
    if (!title || rawCategories.length === 0) {
      return res.status(400).json({
        success: false,
        data: { message: "Provide a title and at least one category (category id)" },
      });
    }

    const categoryIds = [...new Set(rawCategories.map((id) => String(id)))];
    const categoriesFound = await Category.find({ _id: { $in: categoryIds } }).select("_id").lean();
    if (categoriesFound.length !== categoryIds.length) {
      return res.status(400).json({
        success: false,
        data: { message: "One or more categories were not found" },
      });
    }

    const normalizedSizePrices = normalizeSizePrices(sizePrices);
    let normalizedVariants = normalizeVariants(variants);

    const normalizedSizes = Array.isArray(sizes)
      ? sizes.map((s) => String(s).trim()).filter(Boolean)
      : [
          ...new Set([
            ...normalizedVariants.map((v) => v.size),
            ...normalizedSizePrices.map((s) => s.size),
          ]),
        ];

    const normalizedColors = Array.isArray(colors)
      ? colors.map((c) => String(c).trim()).filter(Boolean)
      : [...new Set(normalizedVariants.map((v) => v.color))];

    if (!normalizedVariants.length && normalizedSizePrices.length && normalizedColors.length) {
      normalizedVariants = normalizedSizePrices.flatMap((sp) =>
        normalizedColors.map((color) => ({
          size: sp.size,
          color,
          price: sp.price,
          stock: 0,
          sku: "",
        })),
      );
    }

    const basePrice =
      Number(price) > 0
        ? Number(price)
        : normalizedVariants.length
          ? Math.min(...normalizedVariants.map((v) => v.price))
          : normalizedSizePrices.length
            ? Math.min(...normalizedSizePrices.map((s) => s.price))
          : 0;

    const normalizedStock = normalizedVariants.length
      ? 0 // when variants exist, the per-variant stock is the source of truth
      : Math.max(0, Number(stock) || 0);

    const product = await Product.create({
      storeId,
      title: String(title).trim(),
      category: category || categoryIds[0],
      categories: categoryIds,
      sizes: normalizedSizes,
      sizePrices: normalizedSizePrices,
      stock: normalizedStock,
      material: material != null ? String(material).trim() : "",
      description: description != null ? String(description).trim() : "",
      price: basePrice,
      colors: normalizedColors,
      variants: normalizedVariants,
      images: Array.isArray(images) ? images : [],
      imageHashes: await computeHashesForImages(images, { maxImages: 3 }),
      productionCountry: productionCountry != null ? String(productionCountry).trim() : "",
      season: season != null ? String(season).trim() : "",
    });

    return res.status(201).json({
      success: true,
      data: { product: toProductResponse(product) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/products/:id
 * Update a product.
 */
const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const storeId = req.user?._id;
    if (!storeId) {
      return res.status(401).json({ success: false, message: "Authorization required" });
    }
    const {
      title,
      category,
      categories,
      sizes,
      sizePrices,
      material,
      description,
      price,
      stock,
      colors,
      variants,
      images,
      productionCountry,
      season,
    } = req.body;

    const product = await Product.findOne({ _id: id, storeId });
    if (!product) {
      return res.status(404).json({
        success: false,
        data: { message: "Product not found" },
      });
    }

    if (category !== undefined || categories !== undefined) {
      const rawCategories = Array.isArray(categories)
        ? categories
        : category
          ? [category]
          : [];
      if (!rawCategories.length) {
        return res.status(400).json({
          success: false,
          data: { message: "At least one category is required" },
        });
      }
      const categoryIds = [...new Set(rawCategories.map((id) => String(id)))];
      const categoriesFound = await Category.find({ _id: { $in: categoryIds } }).select("_id").lean();
      if (categoriesFound.length !== categoryIds.length) {
        return res.status(400).json({
          success: false,
          data: { message: "One or more categories were not found" },
        });
      }
      product.categories = categoryIds;
      product.category = category || categoryIds[0];
    }
    if (title !== undefined) product.title = String(title).trim();
    if (sizePrices !== undefined) {
      product.sizePrices = normalizeSizePrices(sizePrices);
      if (sizes === undefined) {
        product.sizes = [...new Set(product.sizePrices.map((s) => s.size))];
      }
      if (price === undefined && product.sizePrices.length) {
        product.price = Math.min(...product.sizePrices.map((s) => s.price));
      }
    }
    if (sizes !== undefined) {
      product.sizes = Array.isArray(sizes)
        ? sizes.map((s) => String(s).trim()).filter(Boolean)
        : product.sizes;
    }
    if (material !== undefined) product.material = String(material).trim();
    if (description !== undefined) product.description = String(description).trim();
    if (price !== undefined) product.price = Math.max(0, Number(price) || 0);
    if (stock !== undefined) product.stock = Math.max(0, Number(stock) || 0);
    if (colors !== undefined) {
      product.colors = Array.isArray(colors)
        ? colors.map((c) => String(c).trim()).filter(Boolean)
        : product.colors;
    }
    if (variants !== undefined && Array.isArray(variants)) {
      product.variants = normalizeVariants(variants);
      if (sizes === undefined) {
        product.sizes = [...new Set(product.variants.map((v) => v.size))];
      }
      if (colors === undefined) {
        product.colors = [...new Set(product.variants.map((v) => v.color))];
      }
      if (price === undefined && product.variants.length) {
        product.price = Math.min(...product.variants.map((v) => v.price));
      }
      if (sizePrices === undefined && product.variants.length) {
        const bySize = new Map();
        for (const v of product.variants) {
          const prev = bySize.get(v.size);
          if (prev == null || v.price < prev) bySize.set(v.size, v.price);
        }
        product.sizePrices = [...bySize.entries()].map(([size, p]) => ({ size, price: p }));
      }
    } else if (
      variants === undefined &&
      sizePrices !== undefined &&
      Array.isArray(colors) &&
      product.sizePrices.length &&
      product.colors.length
    ) {
      product.variants = product.sizePrices.flatMap((sp) =>
        product.colors.map((color) => ({
          size: sp.size,
          color,
          price: sp.price,
          stock: 0,
          sku: "",
        })),
      );
    }
    if (images !== undefined) {
      product.images = Array.isArray(images) ? images : product.images;
      product.imageHashes = await computeHashesForImages(product.images, { maxImages: 3 });
    }
    if (productionCountry !== undefined) product.productionCountry = String(productionCountry).trim();
    if (season !== undefined) product.season = String(season).trim();

    await product.save();

    return res.json({
      success: true,
      data: { product: toProductResponse(product) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/products/:id
 * Delete a product.
 */
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const storeId = req.user?._id;
    if (!storeId) {
      return res.status(401).json({ success: false, message: "Authorization required" });
    }
    const product = await Product.findOneAndDelete({ _id: id, storeId });
    if (!product) {
      return res.status(404).json({
        success: false,
        data: { message: "Product not found" },
      });
    }
    return res.json({
      success: true,
      data: { message: "Product deleted" },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Builds a MongoDB filter from the filter object returned by the AI.
 */
function buildFilterFromAIFilters(aiFilters) {
  const filter = {};
  if (aiFilters.title && String(aiFilters.title).trim()) {
    filter.title = { $regex: String(aiFilters.title).trim(), $options: "i" };
  }
  if (aiFilters.category) {
    filter.$or = [
      { category: aiFilters.category },
      { categories: { $in: [aiFilters.category] } },
    ];
  }
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
    const colorRegex = aiFilters.colors.map(
      (c) => new RegExp(String(c).trim(), "i")
    );
    filter.colors = { $in: colorRegex };
  }
  return filter;
}

module.exports = {
  getAllProducts,
  getProductsAdmin,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
