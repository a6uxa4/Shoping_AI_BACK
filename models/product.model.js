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
      type: Array,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
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
    colors: {
      type: Array,
      required: true,
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
