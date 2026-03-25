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

function toProductResponse(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: o._id,
    storeId: o.storeId,
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
    if (req.query.category) filter.category = req.query.category;
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
          data: { message: "ИИ-поиск недоступен: не задан OPENAI_API_KEY в .env" },
        });
      }
      throw err;
    }

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(MAX_CLIENT_LIMIT)
      .lean();

    const data = {
      products: products.map((p) => toProductResponse(p)),
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
          data: { message: "ИИ-поиск недоступен: не задан OPENAI_API_KEY в .env" },
        });
      }
      throw err;
    }

    // Always scope admin to their store
    filter.storeId = storeId;

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    const data = {
      products: products.map((p) => toProductResponse(p)),
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
        data: { message: "Товар не найден" },
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
 * Создать товар.
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
      sizes,
      material,
      description,
      price,
      colors,
      images,
      productionCountry,
      season,
    } = req.body;

    if (!title || !category) {
      return res.status(400).json({
        success: false,
        data: { message: "Укажите title и category (id категории)" },
      });
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        data: { message: "Категория не найдена" },
      });
    }

    const product = await Product.create({
      storeId,
      title: String(title).trim(),
      category,
      sizes: Array.isArray(sizes) ? sizes : [],
      material: material != null ? String(material).trim() : "",
      description: description != null ? String(description).trim() : "",
      price: Number(price) || 0,
      colors: Array.isArray(colors) ? colors : [],
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
 * Обновить товар.
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
      sizes,
      material,
      description,
      price,
      colors,
      images,
      productionCountry,
      season,
    } = req.body;

    const product = await Product.findOne({ _id: id, storeId });
    if (!product) {
      return res.status(404).json({
        success: false,
        data: { message: "Товар не найден" },
      });
    }

    if (category !== undefined) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return res.status(400).json({
          success: false,
          data: { message: "Категория не найдена" },
        });
      }
      product.category = category;
    }
    if (title !== undefined) product.title = String(title).trim();
    if (sizes !== undefined) product.sizes = Array.isArray(sizes) ? sizes : product.sizes;
    if (material !== undefined) product.material = String(material).trim();
    if (description !== undefined) product.description = String(description).trim();
    if (price !== undefined) product.price = Number(price) || 0;
    if (colors !== undefined) product.colors = Array.isArray(colors) ? colors : product.colors;
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
 * Удалить товар.
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
        data: { message: "Товар не найден" },
      });
    }
    return res.json({
      success: true,
      data: { message: "Товар удалён" },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Собирает MongoDB-фильтр из объекта фильтров, возвращённого ИИ.
 */
function buildFilterFromAIFilters(aiFilters) {
  const filter = {};
  if (aiFilters.title && String(aiFilters.title).trim()) {
    filter.title = { $regex: String(aiFilters.title).trim(), $options: "i" };
  }
  if (aiFilters.category) {
    filter.category = aiFilters.category;
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
