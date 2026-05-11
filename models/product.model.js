const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // Tenant/store isolation: which store this product belongs to
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    sizes: {
      type: [String],
      default: [],
    },
    sizePrices: {
      type: [
        {
          size: { type: String, required: true, trim: true },
          price: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    title: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: false,
    },
    categories: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
      required: true,
      default: [],
    },
    material: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    // Total stock for simple products without per-variant rows. When the
    // product has variants[], that array is the source of truth and this
    // field is ignored on read (UI sums variant.stock).
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    colors: {
      type: [String],
      default: [],
    },
    variants: {
      type: [
        {
          size: { type: String, required: true, trim: true },
          color: { type: String, required: true, trim: true },
          price: { type: Number, required: true, min: 0 },
          stock: { type: Number, required: true, min: 0, default: 0 },
          sku: { type: String, trim: true },
        },
      ],
      default: [],
    },
    images: {
      type: Array,
      required: true,
    },
    // Perceptual hashes for image similarity search (aligned with images[])
    imageHashes: {
      type: [String],
      default: [],
    },
    productionCountry: {
      type: String,
      required: true,
    },
    season: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

const Product = mongoose.model("Product", productSchema);

module.exports = { Product };
