const express = require("express");
const productController = require("../controllers/product.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { ROLES } = require("../models/auth.model");

const router = express.Router();

// Главная/каталог: публично, без токена — показывает все товары (без пагинации)
router.get("/", productController.getAllProducts);

// Админка: список с пагинацией (page, limit, total, totalPages)
router.get(
  "/admin",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.getProductsAdmin,
);

// Один товар по ID — публично, без токена
router.get("/:id", productController.getProductById);

// Создать / обновить / удалить товар — авторизованный admin или super_admin
router.post(
  "/",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.createProduct,
);
router.put(
  "/:id",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.updateProduct,
);
router.delete(
  "/:id",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.deleteProduct,
);

module.exports = router;
