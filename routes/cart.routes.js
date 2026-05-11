const express = require("express");
const cartController = require("../controllers/cart.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/me", authenticate, cartController.getMyCart);
router.post("/items", authenticate, cartController.addItemToCart);
router.put("/items/:itemIndex", authenticate, cartController.updateCartItem);
router.delete("/items/:itemIndex", authenticate, cartController.removeCartItem);

module.exports = router;
