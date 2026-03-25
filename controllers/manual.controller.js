const { Category } = require("../models/manual.model");

/**
 * GET /api/manual/categories
 * Список всех категорий (справочник). Публично, без токена.
 */
const getCategories = async (req, res, next) => {
  try {
    const list = await Category.find().sort({ name: 1 }).lean();
    return res.json({
      success: true,
      data: {
        categories: list.map((c) => ({
          id: c._id,
          name: c.name,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/manual/categories
 * Создать категорию. Только SUPER_ADMIN.
 */
const createCategory = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Укажите название категории (name)",
      });
    }
    const category = await Category.create({ name: name.trim() });
    return res.status(201).json({
      success: true,
      data: {
        category: { id: category._id, name: category.name },
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Категория с таким названием уже существует",
      });
    }
    next(err);
  }
};

/**
 * PUT /api/manual/categories/:id
 * Обновить категорию. Только SUPER_ADMIN.
 */
const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Укажите название категории (name)",
      });
    }
    const category = await Category.findByIdAndUpdate(
      id,
      { name: name.trim() },
      { new: true, runValidators: true },
    );
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Категория не найдена",
      });
    }
    return res.json({
      success: true,
      data: { category: { id: category._id, name: category.name } },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Категория с таким названием уже существует",
      });
    }
    next(err);
  }
};

/**
 * DELETE /api/manual/categories/:id
 * Удалить категорию. Только SUPER_ADMIN.
 */
const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await Category.findByIdAndDelete(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Категория не найдена",
      });
    }
    return res.json({
      success: true,
      data: { message: "Категория удалена" },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
