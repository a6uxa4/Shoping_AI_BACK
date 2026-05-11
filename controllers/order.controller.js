const { Cart } = require("../models/cart.model");
const { Order } = require("../models/order.model");
const { Product } = require("../models/product.model");
const { sendEmail } = require("../services/email.service");

const checkout = async (req, res, next) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      city,
      country,
      postalCode,
      comment,
    } = req.body || {};

    if (
      !customerName ||
      !customerEmail ||
      !customerPhone ||
      !shippingAddress ||
      !city ||
      !country ||
      !postalCode
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill in recipient details and shipping address",
      });
    }

    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart || !cart.items.length) {
      return res.status(400).json({ success: false, message: "Your cart is empty" });
    }

    const orderItems = [];
    let totalAmount = 0;

    for (const cartItem of cart.items) {
      const product = await Product.findById(cartItem.productId);
      if (!product) {
        return res.status(400).json({ success: false, message: "One of the products is no longer available" });
      }
      const variant = (product.variants || []).find(
        (v) =>
          v.size.toLowerCase() === cartItem.size.toLowerCase() &&
          v.color.toLowerCase() === cartItem.color.toLowerCase(),
      );
      if (!variant) {
        return res.status(400).json({
          success: false,
          message: `Variant ${cartItem.size}/${cartItem.color} is not available for ${product.title}`,
        });
      }
      if (variant.stock < cartItem.quantity) {
        return res.status(400).json({
          success: false,
          message: `Not enough stock for ${product.title} (${cartItem.size}, ${cartItem.color})`,
        });
      }

      variant.stock -= cartItem.quantity;
      await product.save();

      const lineTotal = cartItem.quantity * variant.price;
      totalAmount += lineTotal;
      orderItems.push({
        productId: product._id,
        title: product.title,
        size: cartItem.size,
        color: cartItem.color,
        quantity: cartItem.quantity,
        price: variant.price,
        lineTotal,
      });
    }

    const order = await Order.create({
      userId: req.user._id,
      customerName: String(customerName).trim(),
      customerEmail: String(customerEmail).trim().toLowerCase(),
      customerPhone: String(customerPhone).trim(),
      shippingAddress: String(shippingAddress).trim(),
      city: String(city).trim(),
      country: String(country).trim(),
      postalCode: String(postalCode).trim(),
      comment: comment != null ? String(comment).trim() : "",
      items: orderItems,
      totalAmount,
      status: "PLACED",
    });

    cart.items = [];
    await cart.save();

    await sendEmail({
      to: order.customerEmail,
      subject: `Order #${order._id} has been placed`,
      text:
        `Hello ${order.customerName},\n\n` +
        `Your order has been placed successfully.\n` +
        `Total: ${order.totalAmount}\n` +
        `Status: ${order.status}\n\n` +
        `Thank you for your purchase!`,
    });

    return res.status(201).json({ success: true, data: { order } });
  } catch (err) {
    next(err);
  }
};

const getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: { orders } });
  } catch (err) {
    next(err);
  }
};

module.exports = { checkout, getMyOrders };
