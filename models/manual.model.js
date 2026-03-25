const mongoose = require("mongoose");

/**
 * Справочник категорий товара.
 * Создаёт и редактирует только SUPER_ADMIN.
 * Поля: название (name), id (_id).
 */
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

categorySchema.index({ name: 1 }, { unique: true });

const Category = mongoose.model("Category", categorySchema);

module.exports = { Category };
