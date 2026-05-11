const { Cart } = require("../models/cart.model");
const { Product } = require("../models/product.model");

function mapCart(cart) {
  return {
    id: cart._id,
    userId: cart.userId,
    items: cart.items,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }
  return cart;
}

const getMyCart = async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user._id);
    return res.json({ success: true, data: { cart: mapCart(cart) } });
  } catch (err) {
    next(err);
  }
};

const addItemToCart = async (req, res, next) => {
  try {
    const { productId, size, color, quantity } = req.body || {};
    const qty = Math.max(1, Number(quantity) || 1);
    if (!productId || !size || !color) {
      return res.status(400).json({
        success: false,
        message: "productId, size, color and quantity are required",
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const variant = (product.variants || []).find(
      (v) =>
        String(v.size).toLowerCase() === String(size).trim().toLowerCase() &&
        String(v.color).toLowerCase() === String(color).trim().toLowerCase(),
    );
    if (!variant) {
      return res.status(400).json({
        success: false,
        message: "This size/color combination is not available",
      });
    }
    if (variant.stock < qty) {
      return res.status(400).json({
        success: false,
        message: "Not enough stock available",
      });
    }

    const cart = await getOrCreateCart(req.user._id);
    const existing = cart.items.find(
      (i) =>
        i.productId.toString() === product._id.toString() &&
        i.size.toLowerCase() === String(size).trim().toLowerCase() &&
        i.color.toLowerCase() === String(color).trim().toLowerCase(),
    );
    if (existing) {
      if (existing.quantity + qty > variant.stock) {
        return res.status(400).json({
          success: false,
          message: "Not enough stock available",
        });
      }
      existing.quantity += qty;
      existing.priceAtAdd = variant.price;
    } else {
      cart.items.push({
        productId: product._id,
        size: String(size).trim(),
        color: String(color).trim(),
        quantity: qty,
        priceAtAdd: variant.price,
      });
    }

    await cart.save();
    return res.json({ success: true, data: { cart: mapCart(cart) } });
  } catch (err) {
    next(err);
  }
};

const updateCartItem = async (req, res, next) => {
  try {
    const { itemIndex } = req.params;
    const { quantity } = req.body || {};
    const qty = Math.max(1, Number(quantity) || 1);
    const index = Number(itemIndex);

    const cart = await getOrCreateCart(req.user._id);
    if (!Number.isInteger(index) || index < 0 || index >= cart.items.length) {
      return res.status(404).json({ success: false, message: "Cart item not found" });
    }

    const item = cart.items[index];
    const product = await Product.findById(item.productId);
    if (!product) {
      return res.status(400).json({ success: false, message: "This product is no longer available" });
    }
    const variant = (product.variants || []).find(
      (v) => v.size.toLowerCase() === item.size.toLowerCase() && v.color.toLowerCase() === item.color.toLowerCase(),
    );
    if (!variant) {
      return res.status(400).json({ success: false, message: "This product variant is no longer available" });
    }
    if (variant.stock < qty) {
      return res.status(400).json({ success: false, message: "Not enough stock available" });
    }

    item.quantity = qty;
    item.priceAtAdd = variant.price;
    await cart.save();
    return res.json({ success: true, data: { cart: mapCart(cart) } });
  } catch (err) {
    next(err);
  }
};

const removeCartItem = async (req, res, next) => {
  try {
    const { itemIndex } = req.params;
    const index = Number(itemIndex);
    const cart = await getOrCreateCart(req.user._id);
    if (!Number.isInteger(index) || index < 0 || index >= cart.items.length) {
      return res.status(404).json({ success: false, message: "Cart item not found" });
    }
    cart.items.splice(index, 1);
    await cart.save();
    return res.json({ success: true, data: { cart: mapCart(cart) } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyCart, addItemToCart, updateCartItem, removeCartItem };
